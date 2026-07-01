import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type {
  HighlightRecord,
  HighlightRect,
  PdfOutlineItem,
  ReaderLookupRequest,
  ReaderTextSelection,
} from "../types";
import { extractLookupContext } from "../utils/japanese";

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
  highlights: HighlightRecord[];
  onDocumentLoaded: (pageCount: number, outline: PdfOutlineItem[]) => void;
  onRenderError: (message: string) => void;
  onLookupRequest: (request: ReaderLookupRequest) => void;
  onTextSelection: (selection: ReaderTextSelection | null) => void;
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
  highlights: HighlightRecord[];
  onRenderError: (message: string) => void;
};

type ParsedPdfHighlight = {
  id: string;
  color: string;
  rects: HighlightRect[];
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

function clampUnit(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

function normalizeSelectedText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function relativeRect(rect: DOMRect, containerRect: DOMRect): HighlightRect | null {
  if (rect.width < 1 || rect.height < 1 || containerRect.width < 1 || containerRect.height < 1) {
    return null;
  }

  const left = Math.max(rect.left, containerRect.left);
  const right = Math.min(rect.right, containerRect.right);
  const top = Math.max(rect.top, containerRect.top);
  const bottom = Math.min(rect.bottom, containerRect.bottom);

  if (right <= left || bottom <= top) {
    return null;
  }

  return {
    x: clampUnit((left - containerRect.left) / containerRect.width),
    y: clampUnit((top - containerRect.top) / containerRect.height),
    width: clampUnit((right - left) / containerRect.width),
    height: clampUnit((bottom - top) / containerRect.height),
  };
}

function capturePdfTextSelection(stage: HTMLElement | null): ReaderTextSelection | null {
  const selection = window.getSelection();
  const selectedText = normalizeSelectedText(selection?.toString() ?? "");

  if (!stage || !selection || selection.rangeCount === 0 || selection.isCollapsed || !selectedText) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const pageElements = Array.from(stage.querySelectorAll<HTMLElement>("[data-page-index]"));
  const rectsByPage = new Map<number, HighlightRect[]>();

  for (const clientRect of Array.from(range.getClientRects())) {
    for (const pageElement of pageElements) {
      const pageIndex = Number(pageElement.dataset.pageIndex);
      const pageRect = pageElement.getBoundingClientRect();
      const rect = relativeRect(clientRect, pageRect);

      if (!rect || !Number.isInteger(pageIndex)) {
        continue;
      }

      rectsByPage.set(pageIndex, [...(rectsByPage.get(pageIndex) ?? []), rect]);
    }
  }

  const firstPageIndex = Array.from(rectsByPage.keys()).sort((left, right) => left - right)[0];
  if (!Number.isInteger(firstPageIndex)) {
    return null;
  }

  const rects = rectsByPage.get(firstPageIndex) ?? [];
  if (rects.length === 0) {
    return null;
  }

  return {
    documentKind: "pdf",
    locatorType: "pdf_page",
    locator: String(firstPageIndex + 1),
    selectedText,
    rangeJson: JSON.stringify({
      kind: "pdf",
      pageIndex: firstPageIndex,
      rects,
    }),
  };
}

function parsePdfHighlights(highlights: HighlightRecord[], pageIndex: number): ParsedPdfHighlight[] {
  return highlights.flatMap((highlight) => {
    try {
      const parsed = JSON.parse(highlight.rangeJson) as { kind?: string; pageIndex?: number; rects?: HighlightRect[] };
      if (parsed.kind !== "pdf" || parsed.pageIndex !== pageIndex || !Array.isArray(parsed.rects)) {
        return [];
      }

      return [
        {
          id: highlight.id,
          color: highlight.color,
          rects: parsed.rects.filter(
            (rect) =>
              Number.isFinite(rect.x) &&
              Number.isFinite(rect.y) &&
              Number.isFinite(rect.width) &&
              Number.isFinite(rect.height),
          ),
        },
      ];
    } catch {
      return [];
    }
  });
}

function PdfPageView({
  pdf,
  pageIndex,
  baseSize,
  zoom,
  shouldRender,
  highlights,
  onRenderError,
}: PdfPageViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const renderTokenRef = useRef(0);
  const [rendered, setRendered] = useState(false);

  const scaledWidth = Math.floor(baseSize.width * zoom);
  const scaledHeight = Math.floor(baseSize.height * zoom);
  const pageHighlights = useMemo(() => parsePdfHighlights(highlights, pageIndex), [highlights, pageIndex]);

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
          {pageHighlights.length > 0 ? (
            <div className="pdf-highlight-layer" aria-hidden="true">
              {pageHighlights.flatMap((highlight) =>
                highlight.rects.map((rect, rectIndex) => (
                  <span
                    key={`${highlight.id}-${rectIndex}`}
                    style={{
                      left: `${rect.x * 100}%`,
                      top: `${rect.y * 100}%`,
                      width: `${rect.width * 100}%`,
                      height: `${rect.height * 100}%`,
                      backgroundColor: highlight.color,
                    }}
                  />
                )),
              )}
            </div>
          ) : null}
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
  highlights,
  onDocumentLoaded,
  onRenderError,
  onLookupRequest,
  onTextSelection,
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

  const reportTextSelection = useCallback(() => {
    onTextSelection(capturePdfTextSelection(stageRef.current));
  }, [onTextSelection]);

  const handleLookupPointerDown = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!event.shiftKey) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const target = event.target as HTMLElement | null;
      const context = extractLookupContext(
        document,
        event.clientX,
        event.clientY,
        target?.textContent ?? "",
      );

      if (!context) {
        return;
      }

      window.getSelection()?.removeAllRanges();
      onLookupRequest({
        ...context,
        selectedText: context.query,
        clientX: event.clientX,
        clientY: event.clientY,
      });
    },
    [onLookupRequest],
  );

  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    async function loadPdf() {
      if (!data) {
        setPdf(null);
        setPageSizes([]);
        onTextSelection(null);
        onDocumentLoaded(0, []);
        return;
      }

      setLoading(true);
      setPdf(null);
      setPageSizes([]);
      onTextSelection(null);

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
  }, [data, onDocumentLoaded, onRenderError, onTextSelection]);

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
    <div
      ref={stageRef}
      className="pdf-viewer-stage"
      aria-busy={loading}
      onKeyUp={reportTextSelection}
      onMouseDown={handleLookupPointerDown}
      onMouseUp={reportTextSelection}
    >
      {loading ? <div className="pdf-loading">Carregando PDF...</div> : null}
      {pdf && pageSizes.length === pageCount
        ? pageSizes.map((baseSize, index) => (
            <PdfPageView
              key={index}
              pdf={pdf}
              pageIndex={index}
              baseSize={baseSize}
              zoom={zoom}
              highlights={highlights}
              shouldRender={renderedPageIndexes.has(index) || pageDistance(index, pageIndex) <= 2}
              onRenderError={onRenderError}
            />
          ))
        : null}
    </div>
  );
}

export default PdfViewer;
