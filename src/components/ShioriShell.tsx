import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import EpubViewer from "./EpubViewer";
import HomeScreen from "./HomeScreen";
import PdfViewer from "./PdfViewer";
import Sidebar from "./Sidebar";
import Toolbar from "./Toolbar";
import {
  getReadingPosition,
  listRecentDocuments,
  openDocumentRecord,
  readDocumentBytes,
  saveReadingPosition,
} from "../services/tauri";
import type {
  DocumentRecord,
  EpubNavigationTarget,
  EpubViewerCommand,
  EpubViewerLocation,
  EpubTocItem,
  PdfOutlineItem,
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

const DEFAULT_ZOOM = 1;

function ShioriShell() {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const scrollTargetTokenRef = useRef(0);
  const epubTargetTokenRef = useRef(0);
  const epubCommandTokenRef = useRef(0);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [activeDocument, setActiveDocument] = useState<DocumentRecord | null>(null);
  const [documentData, setDocumentData] = useState<Uint8Array | null>(null);
  const [outline, setOutline] = useState<PdfOutlineItem[]>([]);
  const [epubToc, setEpubToc] = useState<EpubTocItem[]>([]);
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
  const activeTocItems = isEpub ? epubToc : outline;

  const loadRecent = useCallback(async () => {
    const recentDocuments = await listRecentDocuments(50);
    setDocuments(recentDocuments);

    return recentDocuments;
  }, []);

  const showError = useCallback((message: string) => {
    setAlert({ kind: "danger", message });
  }, []);

  const resetShioriState = useCallback(() => {
    setActiveDocument(null);
    setDocumentData(null);
    setOutline([]);
    setEpubToc([]);
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
        setOutline([]);
        setEpubToc([]);
        setPageCount(0);
        setZoom(savedZoom);

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
    [showError],
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
      {isHome ? null : (
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
          onOpenFile={() => void chooseDocumentFile()}
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
          onZoomIn={() => handleZoomChange(clamp(Number((zoom + 0.1).toFixed(2)), 0.4, 3))}
          onZoomOut={() => handleZoomChange(clamp(Number((zoom - 0.1).toFixed(2)), 0.4, 3))}
        />
      )}

      {alert ? <div className={`shiori-alert ${alert.kind}`}>{alert.message}</div> : null}

      {isHome ? (
        <HomeScreen
          documents={documents}
          loading={loading}
          onOpenFile={() => void chooseDocumentFile()}
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
              onSelectDocument={(document) => void openRegisteredDocument(document)}
              onNavigatePage={requestPage}
              onNavigateHref={requestEpubHref}
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
                onDocumentLoaded={handlePdfDocumentLoaded}
                onRenderError={showError}
                onVisiblePageChange={setPageIndex}
              />
            ) : (
              <EpubViewer
                data={documentData}
                initialCfi={epubLocator}
                navigationTarget={epubTarget}
                command={epubCommand}
                zoom={zoom}
                onDocumentLoaded={handleEpubDocumentLoaded}
                onLocationChange={handleEpubLocationChange}
                onRenderError={showError}
              />
            )}
          </div>
        </section>
      )}
    </main>
  );
}

export default ShioriShell;
