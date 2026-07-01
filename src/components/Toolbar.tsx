import {
  BookmarkPlus,
  ChevronLeft,
  ChevronRight,
  FilePlus,
  Highlighter,
  Home,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Settings,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { DocumentKind, HighlightColor } from "../types";

type ToolbarProps = {
  documentKind: DocumentKind | null;
  title: string;
  pageNumber: number;
  pageCount: number;
  epubProgress: number;
  zoom: number;
  sidebarOpen: boolean;
  loading: boolean;
  isHome: boolean;
  canNavigatePrevious: boolean;
  canNavigateNext: boolean;
  canCreateHighlight: boolean;
  activeHighlightColor: HighlightColor;
  onOpenFile: () => void;
  onOpenSettings: () => void;
  onRefresh: () => void;
  onHome: () => void;
  onToggleSidebar: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onPageNumberChange: (pageNumber: number) => void;
  onCreateBookmark: () => void;
  onCreateHighlight: () => void;
  onChangeHighlightColor: (color: HighlightColor) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
};

const HIGHLIGHT_COLORS: HighlightColor[] = ["#facc15", "#60a5fa", "#34d399", "#fb7185"];

function Toolbar({
  documentKind,
  title,
  pageNumber,
  pageCount,
  epubProgress,
  zoom,
  sidebarOpen,
  loading,
  isHome,
  canNavigatePrevious,
  canNavigateNext,
  canCreateHighlight,
  activeHighlightColor,
  onOpenFile,
  onOpenSettings,
  onRefresh,
  onHome,
  onToggleSidebar,
  onPreviousPage,
  onNextPage,
  onPageNumberChange,
  onCreateBookmark,
  onCreateHighlight,
  onChangeHighlightColor,
  onZoomIn,
  onZoomOut,
}: ToolbarProps) {
  const isPdf = documentKind === "pdf";
  const isEpub = documentKind === "epub";
  const canZoom = isPdf || isEpub;

  return (
    <header className="shiori-toolbar">
      <div className="shiori-toolbar-group">
        <button
          aria-label="Home"
          className="shiori-icon-button"
          disabled={isHome}
          type="button"
          onClick={onHome}
        >
          <Home size={17} />
        </button>
        <button
          aria-label={sidebarOpen ? "Ocultar barra lateral" : "Mostrar barra lateral"}
          className="shiori-icon-button"
          disabled={isHome}
          type="button"
          onClick={onToggleSidebar}
        >
          {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>
        <button disabled={loading} type="button" onClick={onOpenFile}>
          <FilePlus size={17} />
          Abrir PDF/EPUB
        </button>
        <button
          aria-label="Configuracoes"
          className="shiori-icon-button"
          disabled={loading}
          type="button"
          onClick={onOpenSettings}
        >
          <Settings size={17} />
        </button>
        <button
          aria-label="Atualizar recentes"
          className="shiori-icon-button"
          disabled={loading}
          type="button"
          onClick={onRefresh}
        >
          <RefreshCw size={17} />
        </button>
      </div>

      <div className="shiori-toolbar-title" title={title}>
        {title || "Nenhum documento aberto"}
      </div>

      <div className="shiori-toolbar-group shiori-page-controls">
        <button
          aria-label={isEpub ? "Voltar no EPUB" : "Pagina anterior"}
          className="shiori-icon-button"
          disabled={!canNavigatePrevious}
          type="button"
          onClick={onPreviousPage}
        >
          <ChevronLeft size={18} />
        </button>
        {isPdf ? (
          <label>
            <span>Pagina</span>
            <input
              min="1"
              max={Math.max(1, pageCount)}
              type="number"
              value={pageCount > 0 ? pageNumber : 0}
              disabled={pageCount < 1}
              onChange={(event) => onPageNumberChange(Number(event.currentTarget.value))}
            />
            <strong>/ {pageCount || 0}</strong>
          </label>
        ) : (
          <div className="shiori-progress-control">
            <span>{isEpub ? "Progresso" : "Pagina"}</span>
            <strong>{isEpub ? `${Math.round(epubProgress * 100)}%` : "0%"}</strong>
          </div>
        )}
        <button
          aria-label={isEpub ? "Avancar no EPUB" : "Proxima pagina"}
          className="shiori-icon-button"
          disabled={!canNavigateNext}
          type="button"
          onClick={onNextPage}
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="shiori-toolbar-group">
        <button
          aria-label="Favoritar localizacao atual"
          className="shiori-icon-button"
          disabled={isHome}
          type="button"
          onClick={onCreateBookmark}
        >
          <BookmarkPlus size={17} />
        </button>
        <div className="shiori-highlight-colors" aria-label="Cor da marcacao">
          {HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color}
              aria-label={`Usar cor ${color}`}
              className={color === activeHighlightColor ? "is-active" : ""}
              disabled={isHome}
              style={{ background: color }}
              type="button"
              onClick={() => onChangeHighlightColor(color)}
            />
          ))}
        </div>
        <button
          aria-label="Marcar selecao"
          className="shiori-icon-button"
          disabled={!canCreateHighlight}
          type="button"
          onClick={onCreateHighlight}
        >
          <Highlighter size={17} />
        </button>
        <button
          aria-label="Diminuir zoom"
          className="shiori-icon-button"
          disabled={!canZoom}
          type="button"
          onClick={onZoomOut}
        >
          <ZoomOut size={17} />
        </button>
        <span className="shiori-zoom-label">{Math.round(zoom * 100)}%</span>
        <button
          aria-label="Aumentar zoom"
          className="shiori-icon-button"
          disabled={!canZoom}
          type="button"
          onClick={onZoomIn}
        >
          <ZoomIn size={17} />
        </button>
      </div>
    </header>
  );
}

export default Toolbar;
