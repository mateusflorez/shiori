import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { PdfOutlineItem } from "../types";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

type PageSize = {
  width: number;
  height: number;
};

type ScrollTarget = {
  pageIndex: number;
  token: number;
};

type PdfViewerProps = {
  data: Uint8Array | null;
  pageIndex: number;
  zoom: number;
  scrollTarget: ScrollTarget | null;
  onDocumentLoaded: (pageCount: number, outline: PdfOutlineItem[]) => void;
  onRenderError: (message: string) => void;
  onVisiblePageChange: (pageIndex: number) => void;
};

type PdfOutlineNode = {
  title: string;
  dest: string | Array<unknown> | null;
  items: PdfOutlineNode[];
};

type PdfPageViewProps = {
  pdf: PDFDocumentProxy;
  pageIndex: number;
  baseSize: PageSize;
  zoom: number;
  shouldRender: boolean;
  onRenderError: (message: string) => void;
};

async function resolveOutlinePageIndex(pdf: PDFDocumentProxy, dest: PdfOutlineNode["dest"]) {
  if (!dest) {
    return null;
  }

  const explicitDestination = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
  const firstDestinationItem = explicitDestination?.[0];

  if (!firstDestinationItem) {
    return null;
  }

  try {
    if (typeof firstDestinationItem === "object") {
      return await pdf.getPageIndex(
        firstDestinationItem as Parameters<PDFDocumentProxy["getPageIndex"]>[0],
      );
    }

    if (typeof firstDestinationItem === "number") {
      return firstDestinationItem;
    }
  } catch {
    return null;
  }

  return null;
}

async function normalizeOutline(
  pdf: PDFDocumentProxy,
  nodes: PdfOutlineNode[],
  parentId = "outline",
): Promise<PdfOutlineItem[]> {
  return Promise.all(
    nodes.map(async (node, index) => {
      const id = `${parentId}-${index}`;

      return {
        id,
        title: node.title || "Sem titulo",
        href: null,
        pageIndex: await resolveOutlinePageIndex(pdf, node.dest),
        items: await normalizeOutline(pdf, node.items || [], id),
      };
    }),
  );
}

function pageDistance(pageIndex: number, currentPageIndex: number) {
  return Math.abs(pageIndex - currentPageIndex);
}

function isExpectedAbort(error: unknown) {
  return error instanceof Error && /abort|aborted/i.test(error.message);
}

function PdfPageView({
  pdf,
  pageIndex,
  baseSize,
  zoom,
  shouldRender,
  onRenderError,
}: PdfPageViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const renderTokenRef = useRef(0);
  const [rendered, setRendered] = useState(false);

  const scaledWidth = Math.floor(baseSize.width * zoom);
  const scaledHeight = Math.floor(baseSize.height * zoom);

  useEffect(() => {
    if (!shouldRender) {
      setRendered(false);
      return;
    }

    let cancelled = false;
    const token = renderTokenRef.current + 1;
    renderTokenRef.current = token;

    async function renderPage() {
      if (!canvasRef.current || !textLayerRef.current) {
        return;
      }

      try {
        const page: PDFPageProxy = await pdf.getPage(pageIndex + 1);
        if (cancelled || token !== renderTokenRef.current) {
          return;
        }

        const viewport = page.getViewport({ scale: zoom });
        const outputScale = window.devicePixelRatio || 1;
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");
        const textLayer = textLayerRef.current;

        if (!context) {
          throw new Error("Canvas indisponivel para renderizar PDF.");
        }

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
        context.clearRect(0, 0, viewport.width, viewport.height);

        textLayer.replaceChildren();
        textLayer.style.width = `${Math.floor(viewport.width)}px`;
        textLayer.style.height = `${Math.floor(viewport.height)}px`;

        const renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport,
        });
        await renderTask.promise;

        if (cancelled || token !== renderTokenRef.current) {
          return;
        }

        const textContent = await page.getTextContent();
        const layer = new pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: textLayer,
          viewport,
        });
        await layer.render();

        if (!cancelled) {
          setRendered(true);
        }
      } catch (error) {
        if (!cancelled) {
          onRenderError(error instanceof Error ? error.message : "Nao foi possivel renderizar pagina.");
        }
      }
    }

    void renderPage();

    return () => {
      cancelled = true;
    };
  }, [onRenderError, pageIndex, pdf, shouldRender, zoom]);

  return (
    <article
      className="pdf-page"
      data-page-index={pageIndex}
      style={{
        width: scaledWidth,
        height: scaledHeight,
      }}
    >
      <div className="pdf-page-number">{pageIndex + 1}</div>
      {shouldRender ? (
        <>
          {!rendered ? <div className="pdf-page-placeholder">Renderizando...</div> : null}
          <canvas ref={canvasRef} />
          <div ref={textLayerRef} className="textLayer pdf-text-layer" />
        </>
      ) : (
        <div className="pdf-page-placeholder">Pagina {pageIndex + 1}</div>
      )}
    </article>
  );
}

function PdfViewer({
  data,
  pageIndex,
  zoom,
  scrollTarget,
  onDocumentLoaded,
  onRenderError,
  onVisiblePageChange,
}: PdfViewerProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const lastReportedPageRef = useRef(pageIndex);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageSizes, setPageSizes] = useState<PageSize[]>([]);
  const [loading, setLoading] = useState(false);

  const pageCount = pdf?.numPages ?? 0;

  const renderedPageIndexes = useMemo(() => {
    const indexes = new Set<number>();

    for (let index = Math.max(0, pageIndex - 2); index <= Math.min(pageCount - 1, pageIndex + 2); index += 1) {
      indexes.add(index);
    }

    return indexes;
  }, [pageCount, pageIndex]);

  const updateVisiblePage = useCallback(() => {
    const stage = stageRef.current;
    const scrollRoot = stage?.parentElement;

    if (!stage || !scrollRoot || pageCount < 1) {
      return;
    }

    const focusY = scrollRoot.scrollTop + Math.min(scrollRoot.clientHeight * 0.38, 260);
    const pageElements = Array.from(stage.querySelectorAll<HTMLElement>("[data-page-index]"));
    let closestPageIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const element of pageElements) {
      const pageTop = element.offsetTop;
      const pageBottom = pageTop + element.offsetHeight;
      const elementPageIndex = Number(element.dataset.pageIndex ?? 0);

      if (pageTop <= focusY && pageBottom >= focusY) {
        closestPageIndex = elementPageIndex;
        closestDistance = 0;
        break;
      }

      const distance = Math.min(Math.abs(pageTop - focusY), Math.abs(pageBottom - focusY));
      if (distance < closestDistance) {
        closestDistance = distance;
        closestPageIndex = elementPageIndex;
      }
    }

    if (closestPageIndex !== lastReportedPageRef.current) {
      lastReportedPageRef.current = closestPageIndex;
      onVisiblePageChange(closestPageIndex);
    }
  }, [onVisiblePageChange, pageCount]);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    async function loadPdf() {
      if (!data) {
        setPdf(null);
        setPageSizes([]);
        onDocumentLoaded(0, []);
        return;
      }

      setLoading(true);
      setPdf(null);
      setPageSizes([]);

      try {
        loadingTask = pdfjsLib.getDocument({ data: data.slice() });
        const loadedPdf = await loadingTask.promise;

        if (cancelled) {
          return;
        }

        const sizes: PageSize[] = [];
        for (let pageNumber = 1; pageNumber <= loadedPdf.numPages; pageNumber += 1) {
          const page = await loadedPdf.getPage(pageNumber);
          const viewport = page.getViewport({ scale: 1 });
          sizes.push({
            width: Math.floor(viewport.width),
            height: Math.floor(viewport.height),
          });
        }

        if (cancelled) {
          return;
        }

        const rawOutline = ((await loadedPdf.getOutline()) || []) as PdfOutlineNode[];
        const outline = await normalizeOutline(loadedPdf, rawOutline);

        setPdf(loadedPdf);
        setPageSizes(sizes);
        onDocumentLoaded(loadedPdf.numPages, outline);
      } catch (error) {
        if (cancelled || isExpectedAbort(error)) {
          return;
        }

        onRenderError(error instanceof Error ? error.message : "Nao foi possivel abrir o PDF.");
        onDocumentLoaded(0, []);
        setPdf(null);
        setPageSizes([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadPdf();

    return () => {
      cancelled = true;
      void loadingTask?.destroy();
    };
  }, [data, onDocumentLoaded, onRenderError]);

  useEffect(() => {
    const stage = stageRef.current;
    const scrollRoot = stage?.parentElement;

    if (!scrollRoot || pageCount < 1) {
      return;
    }

    let frameId = 0;
    const handleScroll = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(updateVisiblePage);
    };

    scrollRoot.addEventListener("scroll", handleScroll, { passive: true });
    updateVisiblePage();

    return () => {
      window.cancelAnimationFrame(frameId);
      scrollRoot.removeEventListener("scroll", handleScroll);
    };
  }, [pageCount, updateVisiblePage, zoom]);

  useEffect(() => {
    if (!scrollTarget || pageCount < 1) {
      return;
    }

    const targetIndex = Math.max(0, Math.min(pageCount - 1, scrollTarget.pageIndex));

    window.requestAnimationFrame(() => {
      const target = stageRef.current?.querySelector<HTMLElement>(`[data-page-index="${targetIndex}"]`);
      target?.scrollIntoView({ block: "start" });
      lastReportedPageRef.current = targetIndex;
      onVisiblePageChange(targetIndex);
    });
  }, [onVisiblePageChange, pageCount, scrollTarget, zoom]);

  if (!data) {
    return (
      <div className="shiori-empty-state">
        <h2>Abra um PDF para comecar</h2>
        <p>O app vai registrar o documento e salvar automaticamente a pagina e o zoom.</p>
      </div>
    );
  }

  return (
    <div ref={stageRef} className="pdf-viewer-stage" aria-busy={loading}>
      {loading ? <div className="pdf-loading">Carregando PDF...</div> : null}
      {pdf && pageSizes.length === pageCount
        ? pageSizes.map((baseSize, index) => (
            <PdfPageView
              key={index}
              pdf={pdf}
              pageIndex={index}
              baseSize={baseSize}
              zoom={zoom}
              shouldRender={renderedPageIndexes.has(index) || pageDistance(index, pageIndex) <= 2}
              onRenderError={onRenderError}
            />
          ))
        : null}
    </div>
  );
}

export default PdfViewer;
