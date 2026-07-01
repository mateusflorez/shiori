import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ePub, { type Book, type NavItem } from "epubjs";
import type {
  EpubNavigationTarget,
  EpubViewerCommand,
  EpubViewerLocation,
  EpubTocItem,
  HighlightRecord,
  HighlightRect,
  ReaderLookupRequest,
  ReaderTextSelection,
} from "../types";
import { clamp } from "../utils/format";
import { extractLookupContext } from "../utils/japanese";

type EpubViewerProps = {
  data: Uint8Array | null;
  initialCfi: string | null;
  navigationTarget: EpubNavigationTarget | null;
  command: EpubViewerCommand | null;
  zoom: number;
  highlights: HighlightRecord[];
  onDocumentLoaded: (toc: EpubTocItem[]) => void;
  onLocationChange: (location: EpubViewerLocation) => void;
  onRenderError: (message: string) => void;
  onLookupRequest: (request: ReaderLookupRequest) => void;
  onTextSelection: (selection: ReaderTextSelection | null) => void;
};

type EpubSection = {
  index: number;
  href: string;
  linear?: boolean;
  render: (request?: Function) => Promise<string>;
};

type RenderedSection = {
  section: EpubSection;
  title: string;
};

type ParsedLocator = {
  href: string;
  sectionProgress: number;
};

type PendingScroll = ParsedLocator & {
  behavior: ScrollBehavior;
};

type ParsedEpubHighlight = {
  id: string;
  color: string;
  rects: HighlightRect[];
};

const SCROLL_LOCATOR_PREFIX = "shiori-scroll:";
const MIN_SECTION_HEIGHT = 180;

function bytesToArrayBuffer(data: Uint8Array) {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);

  return copy.buffer;
}

function normalizeToc(items: NavItem[] = [], parentId = "epub-toc"): EpubTocItem[] {
  return items.map((item, index) => {
    const id = item.id || `${parentId}-${index}`;

    return {
      id,
      title: item.label || "Sem titulo",
      href: item.href || null,
      pageIndex: null,
      items: normalizeToc(item.subitems || [], id),
    };
  });
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function stripHash(href: string) {
  return href.split("#")[0] || href;
}

function normalizeHref(href: string) {
  return decodeURIComponent(stripHash(href)).replace(/^\/+/, "");
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

function sectionTitle(section: EpubSection, tocItems: EpubTocItem[]) {
  const sectionHref = normalizeHref(section.href);
  const stack = [...tocItems];

  while (stack.length > 0) {
    const item = stack.shift();
    if (!item) {
      continue;
    }

    if (item.href && normalizeHref(item.href) === sectionHref) {
      return item.title;
    }

    stack.push(...item.items);
  }

  return section.href || `Secao ${section.index + 1}`;
}

function createScrollLocator(href: string, sectionProgress: number) {
  return `${SCROLL_LOCATOR_PREFIX}${encodeURIComponent(href)}:${sectionProgress.toFixed(5)}`;
}

function parseScrollLocator(locator: string | null): ParsedLocator | null {
  if (!locator?.trim()) {
    return null;
  }

  const trimmedLocator = locator.trim();
  if (!trimmedLocator.startsWith(SCROLL_LOCATOR_PREFIX)) {
    return {
      href: trimmedLocator,
      sectionProgress: 0,
    };
  }

  const rawPayload = trimmedLocator.slice(SCROLL_LOCATOR_PREFIX.length);
  const separatorIndex = rawPayload.lastIndexOf(":");

  if (separatorIndex < 0) {
    return null;
  }

  const href = decodeURIComponent(rawPayload.slice(0, separatorIndex));
  const sectionProgress = Number(rawPayload.slice(separatorIndex + 1));

  return {
    href,
    sectionProgress: Number.isFinite(sectionProgress) ? clamp(sectionProgress, 0, 1) : 0,
  };
}

function sectionIndexForTarget(book: Book | null, sections: RenderedSection[], href: string) {
  try {
    const section = book?.spine.get(href) as EpubSection | undefined;
    if (typeof section?.index === "number") {
      const index = sections.findIndex((item) => item.section.index === section.index);
      if (index >= 0) {
        return index;
      }
    }
  } catch {
    // Fall back to normalized href matching below.
  }

  const normalizedTarget = normalizeHref(href);
  return sections.findIndex((item) => {
    const normalizedSection = normalizeHref(item.section.href);

    return (
      normalizedSection === normalizedTarget ||
      normalizedTarget.endsWith(normalizedSection) ||
      normalizedSection.endsWith(normalizedTarget)
    );
  });
}

function captureEpubTextSelection(
  frameDocument: Document,
  iframe: HTMLIFrameElement | null,
  section: EpubSection,
): ReaderTextSelection | null {
  const selection = frameDocument.getSelection();
  const selectedText = normalizeSelectedText(selection?.toString() ?? "");

  if (!iframe || !selection || selection.rangeCount === 0 || selection.isCollapsed || !selectedText) {
    return null;
  }

  const frameWidth = iframe.clientWidth;
  const frameHeight = iframe.clientHeight;
  const range = selection.getRangeAt(0);
  const rects = Array.from(range.getClientRects()).flatMap((rect) => {
    if (rect.width < 1 || rect.height < 1 || frameWidth < 1 || frameHeight < 1) {
      return [];
    }

    return [
      {
        x: clampUnit(rect.left / frameWidth),
        y: clampUnit(rect.top / frameHeight),
        width: clampUnit(rect.width / frameWidth),
        height: clampUnit(rect.height / frameHeight),
      },
    ];
  });

  if (rects.length === 0) {
    return null;
  }

  const firstRect = rects[0];
  const sectionProgress = clampUnit(firstRect.y + firstRect.height / 2);

  return {
    documentKind: "epub",
    locatorType: "epub_cfi",
    locator: createScrollLocator(section.href, sectionProgress),
    selectedText,
    rangeJson: JSON.stringify({
      kind: "epub",
      href: section.href,
      sectionIndex: section.index,
      sectionProgress,
      rects,
    }),
  };
}

function parseEpubHighlights(highlights: HighlightRecord[], section: EpubSection): ParsedEpubHighlight[] {
  const normalizedSectionHref = normalizeHref(section.href);

  return highlights.flatMap((highlight) => {
    try {
      const parsed = JSON.parse(highlight.rangeJson) as {
        kind?: string;
        href?: string;
        sectionIndex?: number;
        rects?: HighlightRect[];
      };
      const sameSection =
        parsed.sectionIndex === section.index ||
        (typeof parsed.href === "string" && normalizeHref(parsed.href) === normalizedSectionHref);

      if (parsed.kind !== "epub" || !sameSection || !Array.isArray(parsed.rects)) {
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

function iframeShioriCss(zoom: number) {
  return `
    html,
    body {
      width: auto !important;
      height: auto !important;
      min-width: 0 !important;
      max-width: none !important;
      margin: 0 !important;
      overflow: hidden !important;
      background: #ffffff !important;
      writing-mode: horizontal-tb !important;
      -webkit-writing-mode: horizontal-tb !important;
      -epub-writing-mode: horizontal-tb !important;
      direction: ltr !important;
      text-orientation: mixed !important;
      column-count: auto !important;
      column-width: auto !important;
      column-gap: normal !important;
      -webkit-column-count: auto !important;
      -webkit-column-width: auto !important;
      -webkit-column-gap: normal !important;
    }

    html {
      overflow: hidden !important;
      background: #ffffff !important;
    }

    body {
      box-sizing: border-box;
      margin: 0 !important;
      padding: 24px 28px 30px !important;
      color: #1b2333 !important;
      background: #ffffff !important;
      font-family: "Yu Gothic", "Yu Gothic UI", "Meiryo", "MS PGothic", "Segoe UI", sans-serif !important;
      font-size: ${Math.round(zoom * 100)}% !important;
      line-height: 1.78 !important;
      overflow: hidden !important;
      text-align: left !important;
    }

    body *,
    body *::before,
    body *::after {
      max-width: 100% !important;
      writing-mode: horizontal-tb !important;
      -webkit-writing-mode: horizontal-tb !important;
      -epub-writing-mode: horizontal-tb !important;
      direction: ltr !important;
      text-orientation: mixed !important;
      column-count: auto !important;
      column-width: auto !important;
      column-gap: normal !important;
      -webkit-column-count: auto !important;
      -webkit-column-width: auto !important;
      -webkit-column-gap: normal !important;
    }

    p,
    div,
    section,
    article,
    main {
      margin-block: 0.72em !important;
    }

    br {
      line-height: 1.78 !important;
    }

    img, svg, video, canvas {
      max-width: 100% !important;
      height: auto;
    }

    a {
      color: inherit !important;
      text-decoration: none !important;
    }

    ::selection {
      background: rgba(33, 86, 217, 0.22);
    }
  `;
}

type EpubSectionFrameProps = {
  request: Function;
  section: EpubSection;
  zoom: number;
  highlights: HighlightRecord[];
  onContentWheel: (deltaX: number, deltaY: number) => void;
  onFrameReady: (sectionIndex: number) => void;
  onRegisterElement: (sectionIndex: number, element: HTMLElement | null) => void;
  onRenderError: (message: string) => void;
  onLookupRequest: (request: ReaderLookupRequest) => void;
  onTextSelection: (selection: ReaderTextSelection | null) => void;
};

function EpubSectionFrame({
  request,
  section,
  zoom,
  highlights,
  onContentWheel,
  onFrameReady,
  onRegisterElement,
  onRenderError,
  onLookupRequest,
  onTextSelection,
}: EpubSectionFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const selectionCleanupRef = useRef<(() => void) | null>(null);
  const [srcDoc, setSrcDoc] = useState("");
  const [height, setHeight] = useState(MIN_SECTION_HEIGHT);
  const sectionHighlights = useMemo(() => parseEpubHighlights(highlights, section), [highlights, section]);

  const measure = useCallback(() => {
    const frameDocument = iframeRef.current?.contentDocument;

    if (!frameDocument) {
      return;
    }

    const documentElement = frameDocument.documentElement;
    const body = frameDocument.body;
    const nextHeight = Math.max(
      MIN_SECTION_HEIGHT,
      documentElement.scrollHeight,
      documentElement.offsetHeight,
      body?.scrollHeight ?? 0,
      body?.offsetHeight ?? 0,
    );
    setHeight(nextHeight);
    onFrameReady(section.index);
  }, [onFrameReady, section.index]);

  useEffect(() => {
    let cancelled = false;

    async function renderSection() {
      try {
        const output = await section.render(request);

        if (!cancelled) {
          setSrcDoc(output);
        }
      } catch (error) {
        if (!cancelled) {
          onRenderError(errorMessage(error, "Nao foi possivel renderizar uma secao do EPUB."));
        }
      }
    }

    void renderSection();

    return () => {
      cancelled = true;
    };
  }, [onRenderError, request, section]);

  useEffect(() => {
    const frameDocument = iframeRef.current?.contentDocument;
    const styleElement = frameDocument?.getElementById("shiori-epub-style") as HTMLStyleElement | null;

    if (styleElement) {
      styleElement.textContent = iframeShioriCss(zoom);
    }

    measure();
  }, [measure, zoom]);

  function handleLoad() {
    const frameDocument = iframeRef.current?.contentDocument;

    if (!frameDocument) {
      return;
    }

    let styleElement = frameDocument.getElementById("shiori-epub-style") as HTMLStyleElement | null;
    if (!styleElement) {
      styleElement = frameDocument.createElement("style");
      styleElement.id = "shiori-epub-style";
      frameDocument.head.appendChild(styleElement);
    }
    styleElement.textContent = iframeShioriCss(zoom);

    frameDocument.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        onContentWheel(event.deltaX, event.deltaY);
      },
      { passive: false },
    );

    selectionCleanupRef.current?.();
    const emitSelection = () => {
      onTextSelection(captureEpubTextSelection(frameDocument, iframeRef.current, section));
    };
    const emitLookup = (event: MouseEvent) => {
      if (!event.shiftKey) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const context = extractLookupContext(
        frameDocument,
        event.clientX,
        event.clientY,
        (event.target as HTMLElement | null)?.textContent ?? "",
      );

      if (!context) {
        return;
      }

      const iframeRect = iframeRef.current?.getBoundingClientRect();
      frameDocument.getSelection()?.removeAllRanges();
      onLookupRequest({
        ...context,
        selectedText: context.query,
        clientX: (iframeRect?.left ?? 0) + event.clientX,
        clientY: (iframeRect?.top ?? 0) + event.clientY,
      });
    };
    frameDocument.addEventListener("mouseup", emitSelection);
    frameDocument.addEventListener("keyup", emitSelection);
    frameDocument.addEventListener("mousedown", emitLookup);
    selectionCleanupRef.current = () => {
      frameDocument.removeEventListener("mouseup", emitSelection);
      frameDocument.removeEventListener("keyup", emitSelection);
      frameDocument.removeEventListener("mousedown", emitLookup);
    };

    for (const image of Array.from(frameDocument.images)) {
      image.addEventListener("load", measure, { once: true });
    }

    resizeObserverRef.current?.disconnect();
    if (frameDocument.body) {
      resizeObserverRef.current = new ResizeObserver(measure);
      resizeObserverRef.current.observe(frameDocument.body);
    }

    window.setTimeout(measure, 0);
    window.setTimeout(measure, 200);
  }

  useEffect(() => {
    return () => {
      selectionCleanupRef.current?.();
      resizeObserverRef.current?.disconnect();
    };
  }, []);

  return (
    <article
      ref={(element) => onRegisterElement(section.index, element)}
      className="epub-section-frame"
      data-section-index={section.index}
    >
      {!srcDoc ? <div className="epub-section-placeholder">Carregando secao...</div> : null}
      <iframe
        ref={iframeRef}
        title={`EPUB secao ${section.index + 1}`}
        sandbox="allow-same-origin"
        srcDoc={srcDoc}
        style={{ height }}
        onLoad={handleLoad}
      />
      {sectionHighlights.length > 0 ? (
        <div className="epub-highlight-layer" aria-hidden="true">
          {sectionHighlights.flatMap((highlight) =>
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
    </article>
  );
}

function EpubViewer({
  data,
  initialCfi,
  navigationTarget,
  command,
  zoom,
  highlights,
  onDocumentLoaded,
  onLocationChange,
  onRenderError,
  onLookupRequest,
  onTextSelection,
}: EpubViewerProps) {
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const sectionElementsRef = useRef(new Map<number, HTMLElement>());
  const bookRef = useRef<Book | null>(null);
  const initialCfiRef = useRef<string | null>(initialCfi);
  const pendingScrollRef = useRef<PendingScroll | null>(null);
  const locationFrameRef = useRef(0);
  const [sections, setSections] = useState<RenderedSection[]>([]);
  const [request, setRequest] = useState<Function | null>(null);
  const [loading, setLoading] = useState(false);

  initialCfiRef.current = initialCfi;

  const updateLocation = useCallback(() => {
    const scrollRoot = scrollRootRef.current;

    if (!scrollRoot || sections.length === 0) {
      return;
    }

    const focusY = scrollRoot.scrollTop + Math.min(scrollRoot.clientHeight * 0.36, 280);
    let activeSection = sections[0];
    let activeElement = sectionElementsRef.current.get(activeSection.section.index);

    for (const item of sections) {
      const element = sectionElementsRef.current.get(item.section.index);
      if (!element) {
        continue;
      }

      const top = element.offsetTop;
      const bottom = top + element.offsetHeight;
      if (top <= focusY && bottom >= focusY) {
        activeSection = item;
        activeElement = element;
        break;
      }
    }

    const maxScrollTop = Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight);
    const globalProgress = maxScrollTop > 0 ? scrollRoot.scrollTop / maxScrollTop : 0;
    const sectionTop = activeElement?.offsetTop ?? 0;
    const sectionHeight = Math.max(1, activeElement?.offsetHeight ?? 1);
    const sectionProgress = clamp((focusY - sectionTop) / sectionHeight, 0, 1);

    onLocationChange({
      cfi: createScrollLocator(activeSection.section.href, sectionProgress),
      href: activeSection.section.href,
      progress: clamp(globalProgress, 0, 1),
      displayedPage: sections.findIndex((item) => item.section.index === activeSection.section.index) + 1,
      displayedTotal: sections.length,
      atStart: scrollRoot.scrollTop <= 2,
      atEnd: scrollRoot.scrollTop >= maxScrollTop - 2,
    });
  }, [onLocationChange, sections]);

  const tryPendingScroll = useCallback(() => {
    const pendingScroll = pendingScrollRef.current;
    const scrollRoot = scrollRootRef.current;

    if (!pendingScroll || !scrollRoot || sections.length === 0) {
      return;
    }

    const sectionIndex = sectionIndexForTarget(bookRef.current, sections, pendingScroll.href);
    if (sectionIndex < 0) {
      pendingScrollRef.current = null;
      return;
    }

    const section = sections[sectionIndex];
    const element = sectionElementsRef.current.get(section.section.index);
    if (!element || element.offsetHeight <= 0) {
      return;
    }

    const top = element.offsetTop + Math.max(0, element.offsetHeight - scrollRoot.clientHeight) * pendingScroll.sectionProgress;
    scrollRoot.scrollTo({
      top,
      behavior: pendingScroll.behavior,
    });
    pendingScrollRef.current = null;
    window.requestAnimationFrame(updateLocation);
  }, [sections, updateLocation]);

  const queueScrollToLocator = useCallback(
    (locator: string | null, behavior: ScrollBehavior) => {
      const parsedLocator = parseScrollLocator(locator);

      if (!parsedLocator) {
        return;
      }

      pendingScrollRef.current = {
        ...parsedLocator,
        behavior,
      };
      window.requestAnimationFrame(tryPendingScroll);
    },
    [tryPendingScroll],
  );

  const handleScroll = useCallback(() => {
    window.cancelAnimationFrame(locationFrameRef.current);
    locationFrameRef.current = window.requestAnimationFrame(updateLocation);
  }, [updateLocation]);

  const handleContentWheel = useCallback((deltaX: number, deltaY: number) => {
    const scrollRoot = scrollRootRef.current;

    if (!scrollRoot) {
      return;
    }

    scrollRoot.scrollBy({
      left: deltaX,
      top: deltaY,
      behavior: "auto",
    });
  }, []);

  const registerElement = useCallback((sectionIndex: number, element: HTMLElement | null) => {
    if (element) {
      sectionElementsRef.current.set(sectionIndex, element);
    } else {
      sectionElementsRef.current.delete(sectionIndex);
    }
  }, []);

  const handleFrameReady = useCallback(() => {
    tryPendingScroll();
    updateLocation();
  }, [tryPendingScroll, updateLocation]);

  useEffect(() => {
    let cancelled = false;
    let book: Book | null = null;

    async function loadBook() {
      if (!data) {
        onDocumentLoaded([]);
        onTextSelection(null);
        setSections([]);
        setRequest(null);
        return;
      }

      setLoading(true);
      setSections([]);
      setRequest(null);
      onTextSelection(null);
      sectionElementsRef.current.clear();
      pendingScrollRef.current = null;

      try {
        book = ePub(bytesToArrayBuffer(data), {
          openAs: "binary",
          replacements: "blobUrl",
        });
        bookRef.current = book;
        await book.opened;

        if (cancelled) {
          return;
        }

        const navigation = await book.loaded.navigation.catch(() => null);
        const tocItems = normalizeToc(navigation?.toc || []);
        onDocumentLoaded(tocItems);

        const collectedSections: EpubSection[] = [];
        book.spine.each((section: EpubSection) => {
          if (section.linear !== false) {
            collectedSections.push(section);
          }
        });

        setSections(
          collectedSections.map((section) => ({
            section,
            title: sectionTitle(section, tocItems),
          })),
        );
        setRequest(() => book?.load.bind(book));
        const parsedInitialLocator = parseScrollLocator(initialCfiRef.current);
        if (parsedInitialLocator) {
          pendingScrollRef.current = {
            ...parsedInitialLocator,
            behavior: "auto",
          };
        }
      } catch (error) {
        if (!cancelled) {
          onRenderError(errorMessage(error, "Nao foi possivel abrir o EPUB."));
          onDocumentLoaded([]);
          setSections([]);
          setRequest(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadBook();

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(locationFrameRef.current);
      book?.destroy();
      if (bookRef.current === book) {
        bookRef.current = null;
      }
    };
  }, [data, onDocumentLoaded, onRenderError, onTextSelection]);

  useEffect(() => {
    window.requestAnimationFrame(tryPendingScroll);
  }, [sections, tryPendingScroll]);

  useEffect(() => {
    if (!navigationTarget) {
      return;
    }

    queueScrollToLocator(navigationTarget.href, "smooth");
  }, [navigationTarget, queueScrollToLocator]);

  useEffect(() => {
    const scrollRoot = scrollRootRef.current;

    if (!scrollRoot || !command) {
      return;
    }

    scrollRoot.scrollBy({
      top: command.action === "next" ? scrollRoot.clientHeight * 0.86 : -scrollRoot.clientHeight * 0.86,
      behavior: "smooth",
    });
  }, [command]);

  if (!data) {
    return (
      <div className="shiori-empty-state">
        <h2>Abra um EPUB para comecar</h2>
        <p>O app vai registrar o documento e salvar automaticamente a localizacao.</p>
      </div>
    );
  }

  return (
    <div className="epub-viewer-stage" aria-busy={loading}>
      {loading ? <div className="epub-loading">Carregando EPUB...</div> : null}
      <div ref={scrollRootRef} className="epub-scroll-root" onScroll={handleScroll}>
        <div className="epub-document-flow">
          {request
            ? sections.map(({ section }) => (
            <EpubSectionFrame
              key={`${section.index}-${section.href}`}
              request={request}
              section={section}
              zoom={zoom}
              highlights={highlights}
              onContentWheel={handleContentWheel}
              onFrameReady={handleFrameReady}
              onRegisterElement={registerElement}
              onRenderError={onRenderError}
              onLookupRequest={onLookupRequest}
              onTextSelection={onTextSelection}
            />
              ))
            : null}
          {!loading && sections.length === 0 ? (
            <div className="shiori-empty-state">
              <h2>EPUB sem conteudo linear</h2>
              <p>O arquivo abriu, mas nao informou secoes legiveis no spine.</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default EpubViewer;
