import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import DictionaryPopup from "./DictionaryPopup";
import EpubViewer from "./EpubViewer";
import HomeScreen from "./HomeScreen";
import PdfViewer from "./PdfViewer";
import SettingsScreen from "./SettingsScreen";
import Sidebar from "./Sidebar";
import Toolbar from "./Toolbar";
import {
  createBookmark,
  createHighlight,
  deleteBookmark,
  deleteHighlight,
  downloadRecommendedDictionary,
  getReadingPosition,
  importYomitanDictionary,
  listBookmarks,
  listDictionarySources,
  listHighlights,
  listRecentDocuments,
  lookupTerm,
  openDocumentRecord,
  readDocumentBytes,
  saveReadingPosition,
  updateBookmarkNote,
  updateHighlightNote,
} from "../services/tauri";
import type {
  BookmarkRecord,
  DictionaryDownloadProgress,
  DictionarySourceRecord,
  DocumentRecord,
  EpubNavigationTarget,
  EpubViewerCommand,
  EpubViewerLocation,
  EpubTocItem,
  HighlightColor,
  HighlightRecord,
  LookupResult,
  PdfOutlineItem,
  ReaderLookupRequest,
  ReaderTextSelection,
} from "../types";
import { clamp } from "../utils/format";

type AlertState = {
  kind: "success" | "danger";
  message: string;
} | null;

type ScrollTarget = {
  pageIndex: number;
  token: number;
};

type LookupPopupState = {
  query: string;
  x: number;
  y: number;
  loading: boolean;
  error: string | null;
  result: LookupResult | null;
} | null;

const DEFAULT_ZOOM = 1;

function ShioriShell() {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const scrollTargetTokenRef = useRef(0);
  const epubTargetTokenRef = useRef(0);
  const epubCommandTokenRef = useRef(0);
  const lookupTokenRef = useRef(0);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [activeDocument, setActiveDocument] = useState<DocumentRecord | null>(null);
  const [documentData, setDocumentData] = useState<Uint8Array | null>(null);
  const [outline, setOutline] = useState<PdfOutlineItem[]>([]);
  const [epubToc, setEpubToc] = useState<EpubTocItem[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkRecord[]>([]);
  const [highlights, setHighlights] = useState<HighlightRecord[]>([]);
  const [dictionarySources, setDictionarySources] = useState<DictionarySourceRecord[]>([]);
  const [lookupPopup, setLookupPopup] = useState<LookupPopupState>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dictionaryDownloadKey, setDictionaryDownloadKey] = useState<string | null>(null);
  const [dictionaryDownloadProgress, setDictionaryDownloadProgress] =
    useState<DictionaryDownloadProgress | null>(null);
  const [activeSelection, setActiveSelection] = useState<ReaderTextSelection | null>(null);
  const [highlightColor, setHighlightColor] = useState<HighlightColor>("#facc15");
  const [pageCount, setPageCount] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [scrollTarget, setScrollTarget] = useState<ScrollTarget | null>(null);
  const [epubLocator, setEpubLocator] = useState<string | null>(null);
  const [epubHref, setEpubHref] = useState("");
  const [epubProgress, setEpubProgress] = useState(0);
  const [epubAtStart, setEpubAtStart] = useState(true);
  const [epubAtEnd, setEpubAtEnd] = useState(false);
  const [epubTarget, setEpubTarget] = useState<EpubNavigationTarget | null>(null);
  const [epubCommand, setEpubCommand] = useState<EpubViewerCommand | null>(null);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState<AlertState>(null);

  const activeKind = activeDocument?.kind ?? null;
  const isPdf = activeKind === "pdf";
  const isEpub = activeKind === "epub";
  const activeTitle = activeDocument?.title ?? "";
  const pageNumber = pageCount > 0 ? pageIndex + 1 : 0;
  const isHome = !activeDocument;
  const isSettings = settingsOpen;
  const activeTocItems = isEpub ? epubToc : outline;

  const loadRecent = useCallback(async () => {
    const recentDocuments = await listRecentDocuments(50);
    setDocuments(recentDocuments);

    return recentDocuments;
  }, []);

  const loadAnnotations = useCallback(async (documentId: string) => {
    const [nextBookmarks, nextHighlights] = await Promise.all([
      listBookmarks(documentId),
      listHighlights(documentId),
    ]);

    setBookmarks(nextBookmarks);
    setHighlights(nextHighlights);
  }, []);

  const loadDictionaries = useCallback(async () => {
    const sources = await listDictionarySources();
    setDictionarySources(sources);

    return sources;
  }, []);

  const showError = useCallback((message: string) => {
    setAlert({ kind: "danger", message });
  }, []);

  const resetShioriState = useCallback(() => {
    setActiveDocument(null);
    setDocumentData(null);
    setOutline([]);
    setEpubToc([]);
    setBookmarks([]);
    setHighlights([]);
    setLookupPopup(null);
    setSettingsOpen(false);
    setDictionaryDownloadProgress(null);
    setActiveSelection(null);
    setPageCount(0);
    setPageIndex(0);
    setScrollTarget(null);
    setEpubLocator(null);
    setEpubHref("");
    setEpubProgress(0);
    setEpubAtStart(true);
    setEpubAtEnd(false);
    setEpubTarget(null);
    setEpubCommand(null);
    setZoom(DEFAULT_ZOOM);
  }, []);

  const openRegisteredDocument = useCallback(
    async (document: DocumentRecord) => {
      setLoading(true);
      setAlert(null);

      try {
        const bytes = await readDocumentBytes(document.filePath);
        const savedPosition = await getReadingPosition(document.id);
        const savedZoom = savedPosition?.zoom ?? DEFAULT_ZOOM;

        setActiveDocument(document);
        setDocumentData(bytes);
        setSettingsOpen(false);
        setOutline([]);
        setEpubToc([]);
        setBookmarks([]);
        setHighlights([]);
        setActiveSelection(null);
        setPageCount(0);
        setZoom(savedZoom);

        try {
          await loadAnnotations(document.id);
        } catch (error) {
          setBookmarks([]);
          setHighlights([]);
          console.error("Failed to load annotations", error);
          setAlert({ kind: "danger", message: "Documento aberto, mas nao foi possivel carregar anotacoes." });
        }

        if (document.kind === "pdf") {
          const savedPageIndex = savedPosition?.pageIndex ?? 0;
          setPageIndex(savedPageIndex);
          setEpubLocator(null);
          setEpubHref("");
          setEpubProgress(0);
          setEpubAtStart(true);
          setEpubAtEnd(false);
          setEpubTarget(null);
          setEpubCommand(null);
          scrollTargetTokenRef.current += 1;
          setScrollTarget({
            pageIndex: savedPageIndex,
            token: scrollTargetTokenRef.current,
          });
          return;
        }

        setPageIndex(0);
        setScrollTarget(null);
        setEpubLocator(savedPosition?.locatorType === "epub_cfi" ? savedPosition.locator : null);
        setEpubHref("");
        setEpubProgress(savedPosition?.progress ?? 0);
        setEpubAtStart(true);
        setEpubAtEnd(false);
        setEpubTarget(null);
        setEpubCommand(null);
      } catch (error) {
        showError(error instanceof Error ? error.message : "Nao foi possivel abrir o documento.");
      } finally {
        setLoading(false);
      }
    },
    [loadAnnotations, showError],
  );

  const refreshRecent = useCallback(async () => {
    setLoading(true);
    setAlert(null);

    try {
      await loadRecent();
    } catch (error) {
      showError(error instanceof Error ? error.message : "Nao foi possivel carregar recentes.");
    } finally {
      setLoading(false);
    }
  }, [loadRecent, showError]);

  const refreshDictionaries = useCallback(async () => {
    try {
      await loadDictionaries();
    } catch (error) {
      console.error("Failed to load dictionaries", error);
    }
  }, [loadDictionaries]);

  const openSettings = useCallback(() => {
    setLookupPopup(null);
    setSettingsOpen(true);
  }, []);

  const chooseDocumentFile = useCallback(async () => {
    setLoading(true);
    setAlert(null);

    try {
      const selectedPath = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "PDF ou EPUB", extensions: ["pdf", "epub"] }],
      });

      if (typeof selectedPath !== "string") {
        return;
      }

      const document = await openDocumentRecord(selectedPath);
      await loadRecent();
      await openRegisteredDocument(document);
      setAlert({ kind: "success", message: `${document.kind.toUpperCase()} aberto: ${document.title}` });
    } catch (error) {
      showError(error instanceof Error ? error.message : "Nao foi possivel abrir o arquivo.");
    } finally {
      setLoading(false);
    }
  }, [loadRecent, openRegisteredDocument, showError]);

  const chooseDictionaryFile = useCallback(async () => {
    setLoading(true);
    setAlert(null);

    try {
      const selectedPath = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Dicionario Yomitan", extensions: ["zip"] }],
      });

      if (typeof selectedPath !== "string") {
        return;
      }

      const result = await importYomitanDictionary(selectedPath);
      await loadDictionaries();
      setAlert({
        kind: "success",
        message: `${result.source.name} importado: ${result.termCount} termos, ${result.kanjiCount} kanji, ${result.metaCount} metadados.`,
      });
    } catch (error) {
      showError(error instanceof Error ? error.message : "Nao foi possivel importar o dicionario.");
    } finally {
      setLoading(false);
    }
  }, [loadDictionaries, showError]);

  const downloadDictionary = useCallback(
    async (key: string) => {
      setDictionaryDownloadKey(key);
      setDictionaryDownloadProgress({
        key,
        downloadedBytes: 0,
        totalBytes: null,
        progress: null,
        phase: "starting",
        importedRows: null,
        totalRows: null,
        stage: null,
      });
      setLoading(true);
      setAlert(null);

      try {
        const result = await downloadRecommendedDictionary(key);
        await loadDictionaries();
        setAlert({
          kind: "success",
          message: `${result.source.name} instalado: ${result.termCount} termos, ${result.kanjiCount} kanji, ${result.metaCount} metadados.`,
        });
      } catch (error) {
        showError(error instanceof Error ? error.message : "Nao foi possivel baixar o dicionario.");
      } finally {
        setDictionaryDownloadKey(null);
        setDictionaryDownloadProgress(null);
        setLoading(false);
      }
    },
    [loadDictionaries, showError],
  );

  const boundedPageIndex = useMemo(
    () => clamp(pageIndex, 0, Math.max(0, pageCount - 1)),
    [pageCount, pageIndex],
  );

  const requestPage = useCallback(
    (nextPageIndex: number) => {
      if (!isPdf) {
        return;
      }

      const boundedIndex = clamp(nextPageIndex, 0, Math.max(0, pageCount - 1));
      scrollTargetTokenRef.current += 1;
      setPageIndex(boundedIndex);
      setScrollTarget({
        pageIndex: boundedIndex,
        token: scrollTargetTokenRef.current,
      });
    },
    [isPdf, pageCount],
  );

  const requestEpubHref = useCallback((href: string) => {
    epubTargetTokenRef.current += 1;
    setEpubTarget({
      href,
      token: epubTargetTokenRef.current,
    });
  }, []);

  const handleTextSelection = useCallback(
    (selection: ReaderTextSelection | null) => {
      if (!selection || selection.documentKind !== activeDocument?.kind) {
        setActiveSelection(null);
        return;
      }

      setActiveSelection(selection);
    },
    [activeDocument?.kind],
  );

  const runLookup = useCallback(
    async (request: ReaderLookupRequest) => {
      if (dictionarySources.length === 0) {
        setLookupPopup({
          query: request.query,
          x: request.clientX,
          y: request.clientY,
          loading: false,
          error: "Abra Configuracoes e baixe Jitendex, KANJIDIC ou Jiten antes de consultar.",
          result: null,
        });
        return;
      }

      const token = lookupTokenRef.current + 1;
      lookupTokenRef.current = token;
      setLookupPopup({
        query: request.query,
        x: request.clientX,
        y: request.clientY,
        loading: true,
        error: null,
        result: null,
      });

      try {
        const result = await lookupTerm({
          query: request.query,
          documentId: activeDocument?.id ?? null,
          sentence: request.sentence,
          selectedText: request.selectedText,
        });

        if (lookupTokenRef.current !== token) {
          return;
        }

        setLookupPopup({
          query: request.query,
          x: request.clientX,
          y: request.clientY,
          loading: false,
          error: null,
          result,
        });
      } catch (error) {
        if (lookupTokenRef.current !== token) {
          return;
        }

        setLookupPopup({
          query: request.query,
          x: request.clientX,
          y: request.clientY,
          loading: false,
          error: error instanceof Error ? error.message : "Nao foi possivel consultar o dicionario.",
          result: null,
        });
      }
    },
    [activeDocument?.id, dictionarySources.length],
  );

  const lookupKanjiFromPopup = useCallback(
    (character: string) => {
      if (!lookupPopup) {
        return;
      }

      void runLookup({
        query: character,
        sentence: null,
        selectedText: character,
        clientX: lookupPopup.x,
        clientY: lookupPopup.y,
      });
    },
    [lookupPopup, runLookup],
  );

  const requestEpubCommand = useCallback((action: EpubViewerCommand["action"]) => {
    epubCommandTokenRef.current += 1;
    setEpubCommand({
      action,
      token: epubCommandTokenRef.current,
    });
  }, []);

  const handlePdfDocumentLoaded = useCallback(
    (nextPageCount: number, nextOutline: PdfOutlineItem[]) => {
      setPageCount(nextPageCount);
      setOutline(nextOutline);
      setPageIndex((currentPageIndex) => clamp(currentPageIndex, 0, Math.max(0, nextPageCount - 1)));
    },
    [],
  );

  const handleEpubDocumentLoaded = useCallback((nextToc: EpubTocItem[]) => {
    setEpubToc(nextToc);
  }, []);

  const handleEpubLocationChange = useCallback((location: EpubViewerLocation) => {
    setEpubLocator(location.cfi);
    setEpubHref(location.href);
    setEpubProgress(location.progress);
    setEpubAtStart(location.atStart);
    setEpubAtEnd(location.atEnd);
  }, []);

  const saveCurrentPosition = useCallback(async () => {
    if (!activeDocument) {
      return;
    }

    if (activeDocument.kind === "pdf") {
      if (pageCount < 1 || !viewportRef.current) {
        return;
      }

      const viewport = viewportRef.current;
      await saveReadingPosition({
        documentId: activeDocument.id,
        locatorType: "pdf_page",
        locator: String(boundedPageIndex + 1),
        pageIndex: boundedPageIndex,
        scrollX: viewport.scrollLeft,
        scrollY: viewport.scrollTop,
        zoom,
        progress: pageCount > 1 ? boundedPageIndex / (pageCount - 1) : 0,
      });
      return;
    }

    if (!epubLocator) {
      return;
    }

    await saveReadingPosition({
      documentId: activeDocument.id,
      locatorType: "epub_cfi",
      locator: epubLocator,
      pageIndex: null,
      scrollX: 0,
      scrollY: 0,
      zoom,
      progress: epubProgress,
    });
  }, [activeDocument, boundedPageIndex, epubLocator, epubProgress, pageCount, zoom]);

  useEffect(() => {
    void refreshRecent();
    void refreshDictionaries();
  }, []);

  useEffect(() => {
    let unlistenDownloadProgress: (() => void) | null = null;
    let cancelled = false;

    void listen<DictionaryDownloadProgress>("dictionary-download-progress", (event) => {
      setDictionaryDownloadProgress(event.payload);
    })
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
          return;
        }

        unlistenDownloadProgress = unlisten;
      })
      .catch((error) => {
        console.error("Failed to listen for dictionary download progress", error);
      });

    return () => {
      cancelled = true;
      unlistenDownloadProgress?.();
    };
  }, []);

  useEffect(() => {
    if (!activeDocument) {
      return;
    }

    if (activeDocument.kind === "pdf" && pageCount < 1) {
      return;
    }

    if (activeDocument.kind === "epub" && !epubLocator) {
      return;
    }

    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = window.setTimeout(() => {
      void saveCurrentPosition().catch((error) => {
        console.error("Failed to autosave reading position", error);
      });
    }, 550);

    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [activeDocument, boundedPageIndex, epubLocator, epubProgress, pageCount, saveCurrentPosition, zoom]);

  function handlePageNumberChange(nextPageNumber: number) {
    if (!Number.isFinite(nextPageNumber)) {
      return;
    }

    requestPage(Math.round(nextPageNumber) - 1);
  }

  function handleZoomChange(nextZoom: number) {
    setZoom(nextZoom);

    if (isPdf) {
      scrollTargetTokenRef.current += 1;
      setScrollTarget({
        pageIndex: boundedPageIndex,
        token: scrollTargetTokenRef.current,
      });
    }
  }

  function currentLocation() {
    if (!activeDocument) {
      return null;
    }

    if (activeDocument.kind === "pdf") {
      if (pageCount < 1) {
        return null;
      }

      const locator = String(boundedPageIndex + 1);

      return {
        locatorType: "pdf_page" as const,
        locator,
        label: `Pagina ${locator}`,
      };
    }

    if (!epubLocator) {
      return null;
    }

    return {
      locatorType: "epub_cfi" as const,
      locator: epubLocator,
      label: `EPUB ${Math.round(epubProgress * 100)}%`,
    };
  }

  async function handleCreateBookmark() {
    if (!activeDocument) {
      return;
    }

    const location = currentLocation();
    if (!location) {
      showError("Nao foi possivel identificar a localizacao atual.");
      return;
    }

    try {
      const bookmark = await createBookmark({
        documentId: activeDocument.id,
        locatorType: location.locatorType,
        locator: location.locator,
        label: location.label,
        note: null,
      });
      setBookmarks((current) => [...current, bookmark]);
      setAlert({ kind: "success", message: "Favorito salvo." });
    } catch (error) {
      showError(error instanceof Error ? error.message : "Nao foi possivel salvar favorito.");
    }
  }

  async function handleCreateHighlight() {
    if (!activeDocument || !activeSelection) {
      showError("Selecione um trecho antes de criar a marcacao.");
      return;
    }

    try {
      const highlight = await createHighlight({
        documentId: activeDocument.id,
        locatorType: activeSelection.locatorType,
        locator: activeSelection.locator,
        selectedText: activeSelection.selectedText,
        contextBefore: null,
        contextAfter: null,
        rangeJson: activeSelection.rangeJson,
        color: highlightColor,
        note: null,
      });
      setHighlights((current) => [...current, highlight]);
      setActiveSelection(null);
      setAlert({ kind: "success", message: "Marcacao salva." });
    } catch (error) {
      showError(error instanceof Error ? error.message : "Nao foi possivel salvar marcacao.");
    }
  }

  async function handleUpdateBookmarkNote(bookmarkId: string, note: string) {
    try {
      const updated = await updateBookmarkNote(bookmarkId, note.trim() || null);
      setBookmarks((current) => current.map((bookmark) => (bookmark.id === updated.id ? updated : bookmark)));
      setAlert({ kind: "success", message: "Nota do favorito salva." });
    } catch (error) {
      showError(error instanceof Error ? error.message : "Nao foi possivel salvar nota.");
    }
  }

  async function handleUpdateHighlightNote(highlightId: string, note: string) {
    try {
      const updated = await updateHighlightNote(highlightId, note.trim() || null);
      setHighlights((current) => current.map((highlight) => (highlight.id === updated.id ? updated : highlight)));
      setAlert({ kind: "success", message: "Nota da marcacao salva." });
    } catch (error) {
      showError(error instanceof Error ? error.message : "Nao foi possivel salvar nota.");
    }
  }

  async function handleDeleteBookmark(bookmarkId: string) {
    try {
      await deleteBookmark(bookmarkId);
      setBookmarks((current) => current.filter((bookmark) => bookmark.id !== bookmarkId));
      setAlert({ kind: "success", message: "Favorito removido." });
    } catch (error) {
      showError(error instanceof Error ? error.message : "Nao foi possivel remover favorito.");
    }
  }

  async function handleDeleteHighlight(highlightId: string) {
    try {
      await deleteHighlight(highlightId);
      setHighlights((current) => current.filter((highlight) => highlight.id !== highlightId));
      setAlert({ kind: "success", message: "Marcacao removida." });
    } catch (error) {
      showError(error instanceof Error ? error.message : "Nao foi possivel remover marcacao.");
    }
  }

  function navigateLocator(locatorType: "pdf_page" | "epub_cfi", locator: string) {
    if (locatorType === "pdf_page") {
      const pageNumber = Number(locator);
      if (Number.isFinite(pageNumber)) {
        requestPage(pageNumber - 1);
      }
      return;
    }

    requestEpubHref(locator);
  }

  function handleViewportScroll() {
    if (!activeDocument || activeDocument.kind !== "pdf" || pageCount < 1) {
      return;
    }

    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = window.setTimeout(() => {
      void saveCurrentPosition().catch((error) => {
        console.error("Failed to autosave reading scroll", error);
      });
    }, 700);
  }

  const canNavigatePrevious = isPdf
    ? pageCount > 0 && pageNumber > 1
    : isEpub && Boolean(epubLocator) && !epubAtStart;
  const canNavigateNext = isPdf
    ? pageCount > 0 && pageNumber < pageCount
    : isEpub && Boolean(epubLocator) && !epubAtEnd;

  return (
    <main className="shiori-app-shell">
      {isHome || isSettings ? null : (
        <Toolbar
          documentKind={activeKind}
          title={activeTitle}
          pageNumber={pageNumber}
          pageCount={pageCount}
          epubProgress={epubProgress}
          zoom={zoom}
          sidebarOpen={sidebarOpen}
          loading={loading}
          isHome={isHome}
          canNavigatePrevious={canNavigatePrevious}
          canNavigateNext={canNavigateNext}
          canCreateHighlight={Boolean(activeSelection)}
          activeHighlightColor={highlightColor}
          onOpenFile={() => void chooseDocumentFile()}
          onOpenSettings={openSettings}
          onRefresh={() => void refreshRecent()}
          onHome={resetShioriState}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
          onPreviousPage={() => {
            if (isEpub) {
              requestEpubCommand("previous");
              return;
            }

            requestPage(boundedPageIndex - 1);
          }}
          onNextPage={() => {
            if (isEpub) {
              requestEpubCommand("next");
              return;
            }

            requestPage(boundedPageIndex + 1);
          }}
          onPageNumberChange={handlePageNumberChange}
          onCreateBookmark={() => void handleCreateBookmark()}
          onCreateHighlight={() => void handleCreateHighlight()}
          onChangeHighlightColor={setHighlightColor}
          onZoomIn={() => handleZoomChange(clamp(Number((zoom + 0.1).toFixed(2)), 0.4, 3))}
          onZoomOut={() => handleZoomChange(clamp(Number((zoom - 0.1).toFixed(2)), 0.4, 3))}
        />
      )}

      {alert ? <div className={`shiori-alert ${alert.kind}`}>{alert.message}</div> : null}

      {isSettings ? (
        <SettingsScreen
          sources={dictionarySources}
          loading={loading}
          downloadKey={dictionaryDownloadKey}
          downloadProgress={dictionaryDownloadProgress}
          onBack={() => setSettingsOpen(false)}
          onDownloadDictionary={(key) => void downloadDictionary(key)}
          onImportDictionary={() => void chooseDictionaryFile()}
        />
      ) : isHome ? (
        <HomeScreen
          documents={documents}
          loading={loading}
          onOpenFile={() => void chooseDocumentFile()}
          onOpenSettings={openSettings}
          onRefresh={() => void refreshRecent()}
          onSelectDocument={(document) => void openRegisteredDocument(document)}
        />
      ) : (
        <section className={`shiori-workspace ${sidebarOpen ? "" : "sidebar-closed"}`}>
          {sidebarOpen ? (
            <Sidebar
              documents={documents}
              selectedDocumentId={activeDocument?.id ?? ""}
              documentKind={activeKind}
              tocItems={activeTocItems}
              pageIndex={boundedPageIndex}
              activeTocHref={epubHref}
              bookmarks={bookmarks}
              highlights={highlights}
              onSelectDocument={(document) => void openRegisteredDocument(document)}
              onNavigatePage={requestPage}
              onNavigateHref={requestEpubHref}
              onNavigateBookmark={(bookmark) => navigateLocator(bookmark.locatorType, bookmark.locator)}
              onNavigateHighlight={(highlight) => navigateLocator(highlight.locatorType, highlight.locator)}
              onUpdateBookmarkNote={(bookmarkId, note) => void handleUpdateBookmarkNote(bookmarkId, note)}
              onUpdateHighlightNote={(highlightId, note) => void handleUpdateHighlightNote(highlightId, note)}
              onDeleteBookmark={(bookmarkId) => void handleDeleteBookmark(bookmarkId)}
              onDeleteHighlight={(highlightId) => void handleDeleteHighlight(highlightId)}
            />
          ) : null}

          <div
            ref={viewportRef}
            className={`shiori-viewport ${isEpub ? "epub-viewport" : ""}`}
            onScroll={handleViewportScroll}
          >
            {isPdf ? (
              <PdfViewer
                data={documentData}
                pageIndex={boundedPageIndex}
                zoom={zoom}
                scrollTarget={scrollTarget}
                highlights={highlights}
                onDocumentLoaded={handlePdfDocumentLoaded}
                onRenderError={showError}
                onLookupRequest={(request) => void runLookup(request)}
                onTextSelection={handleTextSelection}
                onVisiblePageChange={setPageIndex}
              />
            ) : (
              <EpubViewer
                data={documentData}
                initialCfi={epubLocator}
                navigationTarget={epubTarget}
                command={epubCommand}
                zoom={zoom}
                highlights={highlights}
                onDocumentLoaded={handleEpubDocumentLoaded}
                onLocationChange={handleEpubLocationChange}
                onRenderError={showError}
                onLookupRequest={(request) => void runLookup(request)}
                onTextSelection={handleTextSelection}
              />
            )}
          </div>
        </section>
      )}

      {lookupPopup && !isSettings ? (
        <DictionaryPopup
          result={lookupPopup.result}
          loading={lookupPopup.loading}
          error={lookupPopup.error}
          query={lookupPopup.query}
          x={lookupPopup.x}
          y={lookupPopup.y}
          onClose={() => setLookupPopup(null)}
          onLookupKanji={lookupKanjiFromPopup}
        />
      ) : null}
    </main>
  );
}

export default ShioriShell;
