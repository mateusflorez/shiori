import { ChevronLeft, ChevronRight, Kanban, Search, X } from "lucide-react";
import type { LookupKanjiEntry, LookupResult } from "../types";
import { isKanji } from "../utils/japanese";

type DictionaryPopupProps = {
  result: LookupResult | null;
  loading: boolean;
  error: string | null;
  query: string;
  x: number;
  y: number;
  onClose: () => void;
  onLookupKanji: (character: string) => void;
};

function popupPosition(x: number, y: number) {
  const width = 410;
  const height = 330;
  const margin = 10;

  return {
    left: Math.max(margin, Math.min(x + 12, window.innerWidth - width - margin)),
    top: Math.max(margin, Math.min(y + 12, window.innerHeight - height - margin)),
  };
}

function renderClickableText(text: string, onLookupKanji: (character: string) => void) {
  return Array.from(text).map((character, index) =>
    isKanji(character) ? (
      <button
        key={`${character}-${index}`}
        className="shiori-dictionary-kanji-link"
        type="button"
        onClick={() => onLookupKanji(character)}
      >
        {character}
      </button>
    ) : (
      <span key={`${character}-${index}`}>{character}</span>
    ),
  );
}

function statValue(stats: unknown, key: string) {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) {
    return null;
  }

  const value = (stats as Record<string, unknown>)[key];

  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  return null;
}

function KanjiBlock({ kanji, onLookupKanji }: { kanji: LookupKanjiEntry; onLookupKanji: (character: string) => void }) {
  const frequency = statValue(kanji.stats, "frequency") ?? statValue(kanji.stats, "freq");

  return (
    <section className="shiori-dictionary-kanji">
      <div className="shiori-dictionary-kanji-head">
        <button type="button" onClick={() => onLookupKanji(kanji.character)}>
          {kanji.character}
        </button>
        <div>
          <span>{kanji.sourceName}</span>
          <strong>{kanji.tags.join(" ") || "kanji"}</strong>
        </div>
      </div>
      <div className="shiori-dictionary-grid">
        <span>Meaning</span>
        <span>Readings</span>
        <span>Statistics</span>
        <p>{kanji.meanings.join("; ") || "Sem significado informado."}</p>
        <p>
          {[...kanji.onyomi, ...kanji.kunyomi].join(" / ") || "Sem leitura informada."}
        </p>
        <p>{frequency ? `Frequency ${frequency}` : "Sem estatistica."}</p>
      </div>
    </section>
  );
}

function DictionaryPopup({
  result,
  loading,
  error,
  query,
  x,
  y,
  onClose,
  onLookupKanji,
}: DictionaryPopupProps) {
  const position = popupPosition(x, y);
  const terms = result?.terms ?? [];
  const kanji = result?.kanji ?? [];
  const frequencies = result?.frequencies ?? [];

  return (
    <aside
      className="shiori-dictionary-popup"
      style={{ left: position.left, top: position.top }}
      aria-label="Lookup de dicionario"
    >
      <header>
        <div className="shiori-dictionary-nav" aria-hidden="true">
          <ChevronLeft size={18} />
          <ChevronRight size={18} />
        </div>
        <button aria-label="Fechar lookup" type="button" onClick={onClose}>
          <X size={18} />
        </button>
      </header>

      <div className="shiori-dictionary-body">
        {loading ? (
          <div className="shiori-dictionary-state">
            <Search size={20} />
            Consultando {query}...
          </div>
        ) : null}

        {!loading && error ? (
          <div className="shiori-dictionary-state danger">{error}</div>
        ) : null}

        {!loading && !error && result && terms.length === 0 && kanji.length === 0 ? (
          <div className="shiori-dictionary-state">Nenhuma entrada local para {result.query}.</div>
        ) : null}

        {!loading && !error && terms.length > 0 ? (
          <section className="shiori-dictionary-terms">
            {terms.map((term) => (
              <article key={term.id} className="shiori-dictionary-term">
                <div className="shiori-dictionary-term-head">
                  <div>
                    <span className="shiori-dictionary-reading">{term.reading || term.expression}</span>
                    <h2>{renderClickableText(term.expression, onLookupKanji)}</h2>
                  </div>
                  <span>{term.sourceName}</span>
                </div>

                <div className="shiori-dictionary-tags">
                  {[...term.definitionTags, ...term.termTags].slice(0, 8).map((tag) => (
                    <span key={`${term.id}-${tag}`}>{tag}</span>
                  ))}
                </div>

                <ol>
                  {term.glossary.slice(0, 8).map((item, index) => (
                    <li key={`${term.id}-gloss-${index}`}>{renderClickableText(item, onLookupKanji)}</li>
                  ))}
                </ol>
              </article>
            ))}
          </section>
        ) : null}

        {!loading && !error && frequencies.length > 0 ? (
          <section className="shiori-dictionary-frequency">
            <h3>Frequency</h3>
            {frequencies.map((frequency) => (
              <span key={frequency.id}>
                {frequency.sourceName} {frequency.displayValue}
              </span>
            ))}
          </section>
        ) : null}

        {!loading && !error && kanji.length > 0 ? (
          <section className="shiori-dictionary-kanji-list">
            <div className="shiori-dictionary-section-label">
              <Kanban size={14} />
              Kanji
            </div>
            {kanji.map((entry) => (
              <KanjiBlock key={entry.id} kanji={entry} onLookupKanji={onLookupKanji} />
            ))}
          </section>
        ) : null}
      </div>
    </aside>
  );
}

export default DictionaryPopup;
