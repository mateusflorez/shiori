import { BookMarked, Files, ListTree } from "lucide-react";
import type { DocumentKind, DocumentRecord, DocumentTocItem } from "../types";
import { formatDate } from "../utils/format";

type SidebarProps = {
  documents: DocumentRecord[];
  selectedDocumentId: string;
  documentKind: DocumentKind | null;
  tocItems: DocumentTocItem[];
  pageIndex: number;
  activeTocHref: string;
  onSelectDocument: (document: DocumentRecord) => void;
  onNavigatePage: (pageIndex: number) => void;
  onNavigateHref: (href: string) => void;
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

function Sidebar({
  documents,
  selectedDocumentId,
  documentKind,
  tocItems,
  pageIndex,
  activeTocHref,
  onSelectDocument,
  onNavigatePage,
  onNavigateHref,
}: SidebarProps) {
  const emptyRecentText = "Nenhum documento aberto ainda.";
  const emptyTocText =
    documentKind === "epub"
      ? "Este EPUB nao informou um sumario."
      : "Este PDF nao informou um sumario.";

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
        <p className="shiori-muted">Favoritos entram na Fase 4.</p>
      </section>
    </aside>
  );
}

export default Sidebar;
