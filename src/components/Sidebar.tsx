import { BookMarked, Files, Highlighter, ListTree, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  BookmarkRecord,
  DocumentKind,
  DocumentRecord,
  DocumentTocItem,
  HighlightRecord,
} from "../types";
import { formatDate } from "../utils/format";

type SidebarProps = {
  documents: DocumentRecord[];
  selectedDocumentId: string;
  documentKind: DocumentKind | null;
  tocItems: DocumentTocItem[];
  pageIndex: number;
  activeTocHref: string;
  bookmarks: BookmarkRecord[];
  highlights: HighlightRecord[];
  onSelectDocument: (document: DocumentRecord) => void;
  onNavigatePage: (pageIndex: number) => void;
  onNavigateHref: (href: string) => void;
  onNavigateBookmark: (bookmark: BookmarkRecord) => void;
  onNavigateHighlight: (highlight: HighlightRecord) => void;
  onUpdateBookmarkNote: (bookmarkId: string, note: string) => void;
  onUpdateHighlightNote: (highlightId: string, note: string) => void;
  onDeleteBookmark: (bookmarkId: string) => void;
  onDeleteHighlight: (highlightId: string) => void;
};

function renderOutlineItems(
  items: DocumentTocItem[],
  documentKind: DocumentKind | null,
  pageIndex: number,
  activeTocHref: string,
  onNavigatePage: (pageIndex: number) => void,
  onNavigateHref: (href: string) => void,
) {
  return items.map((item) => {
    const isPdf = documentKind === "pdf";
    const isActive = isPdf ? item.pageIndex === pageIndex : item.href === activeTocHref;
    const disabled = isPdf ? item.pageIndex === null : !item.href;

    return (
      <li key={item.id}>
        <button
          className={isActive ? "is-active" : ""}
          disabled={disabled}
          type="button"
          onClick={() => {
            if (isPdf && item.pageIndex !== null) {
              onNavigatePage(item.pageIndex);
              return;
            }

            if (!isPdf && item.href) {
              onNavigateHref(item.href);
            }
          }}
        >
          {item.title}
        </button>
        {item.items.length > 0 ? (
          <ul>
            {renderOutlineItems(
              item.items,
              documentKind,
              pageIndex,
              activeTocHref,
              onNavigatePage,
              onNavigateHref,
            )}
          </ul>
        ) : null}
      </li>
    );
  });
}

function draftKey(kind: "bookmark" | "highlight", id: string) {
  return `${kind}:${id}`;
}

function locatorLabel(documentKind: DocumentKind | null, locator: string) {
  if (documentKind === "pdf") {
    return `Pagina ${locator}`;
  }

  return "Localizacao EPUB";
}

function highlightPreview(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (normalized.length <= 90) {
    return normalized;
  }

  return `${normalized.slice(0, 87)}...`;
}

function Sidebar({
  documents,
  selectedDocumentId,
  documentKind,
  tocItems,
  pageIndex,
  activeTocHref,
  bookmarks,
  highlights,
  onSelectDocument,
  onNavigatePage,
  onNavigateHref,
  onNavigateBookmark,
  onNavigateHighlight,
  onUpdateBookmarkNote,
  onUpdateHighlightNote,
  onDeleteBookmark,
  onDeleteHighlight,
}: SidebarProps) {
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const emptyRecentText = "Nenhum documento aberto ainda.";
  const emptyTocText =
    documentKind === "epub"
      ? "Este EPUB nao informou um sumario."
      : "Este PDF nao informou um sumario.";

  useEffect(() => {
    setDraftNotes((current) => {
      const next: Record<string, string> = {};

      for (const bookmark of bookmarks) {
        const key = draftKey("bookmark", bookmark.id);
        next[key] = current[key] ?? bookmark.note ?? "";
      }

      for (const highlight of highlights) {
        const key = draftKey("highlight", highlight.id);
        next[key] = current[key] ?? highlight.note ?? "";
      }

      return next;
    });
  }, [bookmarks, highlights]);

  function updateDraftNote(key: string, value: string) {
    setDraftNotes((current) => ({
      ...current,
      [key]: value,
    }));
  }

  return (
    <aside className="shiori-sidebar" aria-label="Navegacao do documento">
      <section>
        <div className="shiori-section-title">
          <Files size={16} />
          <h2>Recentes</h2>
        </div>

        <div className="shiori-document-list">
          {documents.length === 0 ? (
            <p className="shiori-muted">{emptyRecentText}</p>
          ) : (
            documents.map((document) => (
              <button
                key={document.id}
                className={document.id === selectedDocumentId ? "is-active" : ""}
                type="button"
                onClick={() => onSelectDocument(document)}
              >
                <strong>{document.title}</strong>
                <span>{document.kind.toUpperCase()}</span>
                <small>{formatDate(document.lastOpenedAt)}</small>
              </button>
            ))
          )}
        </div>
      </section>

      <section>
        <div className="shiori-section-title">
          <ListTree size={16} />
          <h2>Sumario</h2>
        </div>

        {tocItems.length === 0 ? (
          <p className="shiori-muted">{emptyTocText}</p>
        ) : (
          <nav className="shiori-outline" aria-label="Sumario do documento">
            <ul>
              {renderOutlineItems(
                tocItems,
                documentKind,
                pageIndex,
                activeTocHref,
                onNavigatePage,
                onNavigateHref,
              )}
            </ul>
          </nav>
        )}
      </section>

      <section>
        <div className="shiori-section-title">
          <BookMarked size={16} />
          <h2>Favoritos</h2>
        </div>

        {bookmarks.length === 0 ? (
          <p className="shiori-muted">Nenhum favorito neste documento.</p>
        ) : (
          <div className="shiori-annotation-list">
            {bookmarks.map((bookmark) => {
              const key = draftKey("bookmark", bookmark.id);
              const note = draftNotes[key] ?? "";

              return (
                <article key={bookmark.id} className="shiori-annotation-item">
                  <button
                    className="shiori-annotation-jump"
                    type="button"
                    onClick={() => onNavigateBookmark(bookmark)}
                  >
                    <strong>{bookmark.label || locatorLabel(documentKind, bookmark.locator)}</strong>
                    <span>{formatDate(bookmark.createdAt)}</span>
                  </button>
                  <textarea
                    aria-label="Nota do favorito"
                    placeholder="Nota curta"
                    value={note}
                    onChange={(event) => updateDraftNote(key, event.currentTarget.value)}
                  />
                  <div className="shiori-annotation-actions">
                    <button
                      aria-label="Salvar nota do favorito"
                      type="button"
                      onClick={() => onUpdateBookmarkNote(bookmark.id, note)}
                    >
                      <Save size={14} />
                    </button>
                    <button
                      aria-label="Remover favorito"
                      type="button"
                      onClick={() => onDeleteBookmark(bookmark.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <div className="shiori-section-title">
          <Highlighter size={16} />
          <h2>Marcacoes</h2>
        </div>

        {highlights.length === 0 ? (
          <p className="shiori-muted">Selecione um trecho e use o marcador na barra superior.</p>
        ) : (
          <div className="shiori-annotation-list">
            {highlights.map((highlight) => {
              const key = draftKey("highlight", highlight.id);
              const note = draftNotes[key] ?? "";

              return (
                <article key={highlight.id} className="shiori-annotation-item">
                  <button
                    className="shiori-annotation-jump with-color"
                    type="button"
                    onClick={() => onNavigateHighlight(highlight)}
                  >
                    <span className="shiori-annotation-color" style={{ backgroundColor: highlight.color }} />
                    <strong>{highlightPreview(highlight.selectedText)}</strong>
                    <span>{locatorLabel(documentKind, highlight.locator)}</span>
                  </button>
                  <textarea
                    aria-label="Nota da marcacao"
                    placeholder="Nota curta"
                    value={note}
                    onChange={(event) => updateDraftNote(key, event.currentTarget.value)}
                  />
                  <div className="shiori-annotation-actions">
                    <button
                      aria-label="Salvar nota da marcacao"
                      type="button"
                      onClick={() => onUpdateHighlightNote(highlight.id, note)}
                    >
                      <Save size={14} />
                    </button>
                    <button
                      aria-label="Remover marcacao"
                      type="button"
                      onClick={() => onDeleteHighlight(highlight.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </aside>
  );
}

export default Sidebar;
