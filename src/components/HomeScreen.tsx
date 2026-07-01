import { useEffect, useState } from "react";
import ePub from "epubjs";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import shioriLogoUrl from "../../shiori-logo.svg?url";
import { BookOpen, Clock, FilePlus, FileText, RefreshCw, Settings } from "lucide-react";
import { readDocumentBytes } from "../services/tauri";
import type { DocumentRecord } from "../types";
import { formatDate } from "../utils/format";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const THUMBNAIL_CACHE_PREFIX = "shiori:thumbnail:v1:";
const THUMBNAIL_CACHE_INDEX_KEY = "shiori:thumbnail:index:v1";
const THUMBNAIL_CACHE_LIMIT = 16;
const THUMBNAIL_MAX_WIDTH = 360;
const THUMBNAIL_MAX_HEIGHT = 480;
const THUMBNAIL_QUALITY = 0.72;

type HomeScreenProps = {
  documents: DocumentRecord[];
  loading: boolean;
  onOpenFile: () => void;
  onOpenSettings: () => void;
  onRefresh: () => void;
  onSelectDocument: (document: DocumentRecord) => void;
};

function getFileName(filePath: string) {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

function bytesToArrayBuffer(data: Uint8Array) {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);

  return copy.buffer;
}

function thumbnailCacheKey(document: DocumentRecord) {
  return `${THUMBNAIL_CACHE_PREFIX}${document.id}:${document.fileHash}:${document.updatedAt}`;
}

function readThumbnailCache(document: DocumentRecord) {
  try {
    return localStorage.getItem(thumbnailCacheKey(document));
  } catch {
    return null;
  }
}

function readThumbnailCacheIndex() {
  try {
    const rawIndex = localStorage.getItem(THUMBNAIL_CACHE_INDEX_KEY);
    const parsedIndex = rawIndex ? JSON.parse(rawIndex) : [];

    return Array.isArray(parsedIndex)
      ? parsedIndex.filter((key): key is string => typeof key === "string")
      : [];
  } catch {
    return [];
  }
}

function saveThumbnailCache(document: DocumentRecord, dataUrl: string) {
  const cacheKey = thumbnailCacheKey(document);
  const staleDocumentPrefix = `${THUMBNAIL_CACHE_PREFIX}${document.id}:`;
  const previousIndex = readThumbnailCacheIndex();
  const staleKeys = previousIndex.filter(
    (key) => key !== cacheKey && key.startsWith(staleDocumentPrefix),
  );
  const nextIndex = [
    cacheKey,
    ...previousIndex.filter((key) => key !== cacheKey && !staleKeys.includes(key)),
  ].slice(0, THUMBNAIL_CACHE_LIMIT);
  const prunedKeys = previousIndex.filter((key) => !nextIndex.includes(key));

  try {
    for (const key of [...staleKeys, ...prunedKeys]) {
      localStorage.removeItem(key);
    }

    localStorage.setItem(cacheKey, dataUrl);
    localStorage.setItem(THUMBNAIL_CACHE_INDEX_KEY, JSON.stringify(nextIndex));
  } catch {
    const keysToDrop = nextIndex.slice(Math.max(1, Math.floor(THUMBNAIL_CACHE_LIMIT / 2)));
    for (const key of keysToDrop) {
      localStorage.removeItem(key);
    }

    try {
      localStorage.setItem(cacheKey, dataUrl);
      localStorage.setItem(
        THUMBNAIL_CACHE_INDEX_KEY,
        JSON.stringify(nextIndex.filter((key) => !keysToDrop.includes(key))),
      );
    } catch {
      localStorage.removeItem(cacheKey);
    }
  }
}

async function createPdfThumbnail(data: Uint8Array) {
  const loadingTask = pdfjsLib.getDocument({ data: data.slice() });
  const pdf = await loadingTask.promise;

  try {
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const scale = Math.min(THUMBNAIL_MAX_WIDTH / viewport.width, THUMBNAIL_MAX_HEIGHT / viewport.height);
    const thumbnailViewport = page.getViewport({ scale });
    const outputScale = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      return null;
    }

    canvas.width = Math.floor(thumbnailViewport.width * outputScale);
    canvas.height = Math.floor(thumbnailViewport.height * outputScale);
    context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, thumbnailViewport.width, thumbnailViewport.height);

    await page.render({
      canvas,
      canvasContext: context,
      viewport: thumbnailViewport,
    }).promise;

    return canvas.toDataURL("image/jpeg", THUMBNAIL_QUALITY);
  } finally {
    await pdf.cleanup();
    await loadingTask.destroy();
  }
}

async function createImageThumbnail(blob: Blob) {
  const objectUrl = URL.createObjectURL(blob);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error("Nao foi possivel carregar a capa do EPUB."));
      nextImage.src = objectUrl;
    });
    const imageWidth = image.naturalWidth || image.width;
    const imageHeight = image.naturalHeight || image.height;

    if (imageWidth < 1 || imageHeight < 1) {
      return null;
    }

    const scale = Math.min(THUMBNAIL_MAX_WIDTH / imageWidth, THUMBNAIL_MAX_HEIGHT / imageHeight, 1);
    const width = Math.max(1, Math.round(imageWidth * scale));
    const height = Math.max(1, Math.round(imageHeight * scale));
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      return null;
    }

    canvas.width = width;
    canvas.height = height;
    context.fillStyle = "#f8fafc";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    return canvas.toDataURL("image/jpeg", THUMBNAIL_QUALITY);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function createEpubThumbnail(data: Uint8Array) {
  const book = ePub(bytesToArrayBuffer(data), {
    openAs: "binary",
    replacements: "blobUrl",
  });

  try {
    await book.opened;
    const coverUrl = await book.coverUrl();

    if (!coverUrl) {
      return null;
    }

    const response = await fetch(coverUrl);
    if (!response.ok) {
      return null;
    }

    return createImageThumbnail(await response.blob());
  } finally {
    book.destroy();
  }
}

function DocumentPreview({ document }: { document: DocumentRecord }) {
  const isEpub = document.kind === "epub";
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(() => readThumbnailCache(document));
  const previewLines = isEpub ? ["目次", "本文", "栞", "章"] : ["", "", "", ""];

  useEffect(() => {
    let cancelled = false;

    async function loadThumbnail() {
      const cachedThumbnail = readThumbnailCache(document);
      if (cachedThumbnail) {
        setThumbnailUrl(cachedThumbnail);
        return;
      }

      setThumbnailUrl(null);

      try {
        const bytes = await readDocumentBytes(document.filePath);
        const nextThumbnail =
          document.kind === "pdf"
            ? await createPdfThumbnail(bytes)
            : await createEpubThumbnail(bytes);

        if (!nextThumbnail || cancelled) {
          return;
        }

        saveThumbnailCache(document, nextThumbnail);
        setThumbnailUrl(nextThumbnail);
      } catch {
        setThumbnailUrl(null);
      }
    }

    void loadThumbnail();

    return () => {
      cancelled = true;
    };
  }, [document]);

  return (
    <span
      aria-hidden="true"
      className={`shiori-document-preview ${isEpub ? "is-epub" : "is-pdf"} ${
        thumbnailUrl ? "has-thumbnail" : ""
      }`}
    >
      {thumbnailUrl ? (
        <img className="shiori-preview-image" draggable={false} src={thumbnailUrl} alt="" />
      ) : null}
      <span className="shiori-preview-surface">
        <span className="shiori-preview-type">{document.kind.toUpperCase()}</span>
        <span className="shiori-preview-title">{document.title}</span>
        <span className={isEpub ? "shiori-preview-columns" : "shiori-preview-lines"}>
          {previewLines.map((line, index) => (
            <i key={`${document.id}-preview-${index}`}>{line}</i>
          ))}
        </span>
      </span>
    </span>
  );
}

function HomeScreen({
  documents,
  loading,
  onOpenFile,
  onOpenSettings,
  onRefresh,
  onSelectDocument,
}: HomeScreenProps) {
  return (
    <section className="shiori-home" aria-labelledby="shiori-library-title">
      <header className="shiori-home-header">
        <div className="shiori-home-brand">
          <span className="shiori-home-mark" aria-hidden="true">
            <img src={shioriLogoUrl} alt="" />
          </span>
          <div>
            <span className="shiori-home-kicker">Shiori</span>
            <h1 id="shiori-library-title">Biblioteca</h1>
            <p>Continue seus PDFs e EPUBs recentes em uma tela limpa e rápida.</p>
          </div>
        </div>

        <div className="shiori-home-actions">
          <button className="shiori-home-primary" disabled={loading} type="button" onClick={onOpenFile}>
            <FilePlus size={16} />
            Abrir PDF/EPUB
          </button>
          <button
            aria-label="Atualizar recentes"
            className="secondary"
            disabled={loading}
            type="button"
            onClick={onRefresh}
          >
            <RefreshCw size={16} />
          </button>
          <button
            aria-label="Configuracoes"
            className="secondary"
            disabled={loading}
            type="button"
            onClick={onOpenSettings}
          >
            <Settings size={16} />
          </button>
        </div>
      </header>

      {documents.length === 0 ? (
        <div className="shiori-home-empty">
          <span className="shiori-home-empty-icon" aria-hidden="true">
            <FileText size={34} />
          </span>
          <h2>Nenhum documento recente</h2>
          <p>Abra um PDF ou EPUB para ele aparecer aqui e continuar de onde parou.</p>
          <button disabled={loading} type="button" onClick={onOpenFile}>
            <FilePlus size={16} />
            Abrir documento
          </button>
        </div>
      ) : (
        <>
          <div className="shiori-library-heading">
            <div>
              <h2>Abertos recentemente</h2>
              <span>{documents.length} documento{documents.length === 1 ? "" : "s"}</span>
            </div>
          </div>

          <div className="shiori-recent-grid">
            {documents.map((document) => (
              <button
                key={document.id}
                className="shiori-recent-card"
                type="button"
                onClick={() => onSelectDocument(document)}
              >
                <DocumentPreview document={document} />
                <span className="shiori-recent-info">
                  <span className="shiori-recent-kind">
                    {document.kind === "epub" ? <BookOpen size={13} /> : <FileText size={13} />}
                    {document.kind.toUpperCase()}
                  </span>
                  <span className="shiori-recent-title">{document.title}</span>
                  <span className="shiori-recent-path">{getFileName(document.filePath)}</span>
                  <span className="shiori-recent-meta">
                    <Clock size={12} />
                    {formatDate(document.lastOpenedAt)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export default HomeScreen;
