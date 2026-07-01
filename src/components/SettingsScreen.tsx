import { ArrowLeft, CheckCircle2, Download, ExternalLink, Loader2, Upload } from "lucide-react";
import type { DictionaryDownloadProgress, DictionarySourceRecord } from "../types";

type RecommendedDictionaryKey = "jitendex" | "kanjidic" | "jiten";

type RecommendedDictionary = {
  key: RecommendedDictionaryKey;
  category: "Term Dictionaries" | "Kanji Dictionaries" | "Frequency Dictionaries";
  name: string;
  description: string;
  homepage: string;
  metric: "terms" | "kanji" | "frequency";
};

type SettingsScreenProps = {
  sources: DictionarySourceRecord[];
  loading: boolean;
  downloadKey: string | null;
  downloadProgress: DictionaryDownloadProgress | null;
  onBack: () => void;
  onDownloadDictionary: (key: RecommendedDictionaryKey) => void;
  onImportDictionary: () => void;
};

const RECOMMENDED_DICTIONARIES: RecommendedDictionary[] = [
  {
    key: "jitendex",
    category: "Term Dictionaries",
    name: "Jitendex",
    description:
      "Dicionario japones-ingles com exemplos, notas de uso, etimologia, referencias cruzadas e antonimos.",
    homepage: "https://jitendex.org",
    metric: "terms",
  },
  {
    key: "kanjidic",
    category: "Kanji Dictionaries",
    name: "KANJIDIC",
    description:
      "Dicionario ingles de kanji com leituras, significados, diagramas de tracos, frequencia, grau e JLPT.",
    homepage: "https://github.com/yomidevs/jmdict-yomitan",
    metric: "kanji",
  },
  {
    key: "jiten",
    category: "Frequency Dictionaries",
    name: "Jiten",
    description: "Dicionario de frequencia baseado no corpus de estatisticas de midia em jiten.moe.",
    homepage: "https://jiten.moe",
    metric: "frequency",
  },
];

const DICTIONARY_CATEGORIES = ["Term Dictionaries", "Kanji Dictionaries", "Frequency Dictionaries"] as const;

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findInstalledSource(sources: DictionarySourceRecord[], dictionary: RecommendedDictionary) {
  const key = normalizeName(dictionary.key);
  const name = normalizeName(dictionary.name);

  return sources.find((source) => {
    const sourceName = normalizeName(source.name);

    return sourceName.includes(key) || sourceName.includes(name);
  });
}

function metricValue(source: DictionarySourceRecord | undefined, metric: RecommendedDictionary["metric"]) {
  if (!source) {
    return 0;
  }

  if (metric === "terms") {
    return source.termCount;
  }

  if (metric === "kanji") {
    return source.kanjiCount;
  }

  return source.metaCount;
}

function metricLabel(metric: RecommendedDictionary["metric"]) {
  if (metric === "terms") {
    return "termos";
  }

  if (metric === "kanji") {
    return "kanji";
  }

  return "frequencias";
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("pt-BR")} KB`;
  }

  return `${(bytes / (1024 * 1024)).toLocaleString("pt-BR", {
    maximumFractionDigits: 1,
  })} MB`;
}

function progressLabel(progress: DictionaryDownloadProgress | null) {
  if (!progress || progress.phase === "starting") {
    return "Conectando...";
  }

  if (progress.phase === "importing") {
    const stage = progress.stage ?? "Importando no banco local";

    if (progress.importedRows !== null && progress.totalRows !== null && progress.totalRows > 0) {
      const percent = progress.progress === null ? null : Math.round(progress.progress * 100);
      const unit = stage.startsWith("Preparando") ? "bancos" : "entradas";
      const prefix = percent === null ? "" : `${percent}% · `;

      return `${stage}: ${prefix}${progress.importedRows.toLocaleString("pt-BR")} de ${progress.totalRows.toLocaleString("pt-BR")} ${unit}`;
    }

    return `${stage}...`;
  }

  if (progress.phase === "done") {
    return "Finalizando...";
  }

  if (progress.progress !== null) {
    const percent = Math.round(progress.progress * 100);
    const total = progress.totalBytes ? ` de ${formatBytes(progress.totalBytes)}` : "";

    return `${percent}% · ${formatBytes(progress.downloadedBytes)}${total}`;
  }

  return `${formatBytes(progress.downloadedBytes)} baixados`;
}

function SettingsScreen({
  sources,
  loading,
  downloadKey,
  downloadProgress,
  onBack,
  onDownloadDictionary,
  onImportDictionary,
}: SettingsScreenProps) {
  const busy = loading || Boolean(downloadKey);

  return (
    <section className="shiori-settings" aria-labelledby="shiori-settings-title">
      <header className="shiori-settings-header">
        <button className="shiori-settings-back" type="button" onClick={onBack}>
          <ArrowLeft size={17} />
          Voltar
        </button>
        <div>
          <span>Shiori</span>
          <h1 id="shiori-settings-title">Configuracoes</h1>
          <p>Baixe os dicionarios locais usados pelo lookup com Shift+clique.</p>
        </div>
      </header>

      <div className="shiori-settings-layout">
        <section className="shiori-settings-section" aria-labelledby="shiori-recommended-dictionaries">
          <div className="shiori-settings-section-head">
            <div>
              <h2 id="shiori-recommended-dictionaries">Dicionarios recomendados</h2>
              <p>Use Jitendex para termos, KANJIDIC para kanji e Jiten para frequencia.</p>
            </div>
            <button className="shiori-settings-secondary" disabled={busy} type="button" onClick={onImportDictionary}>
              <Upload size={15} />
              Importar ZIP
            </button>
          </div>

          {DICTIONARY_CATEGORIES.map((category) => (
            <div key={category} className="shiori-dictionary-category">
              <h3>{category}</h3>

              <div className="shiori-recommended-list">
                {RECOMMENDED_DICTIONARIES.filter((dictionary) => dictionary.category === category).map(
                  (dictionary) => {
                    const installedSource = findInstalledSource(sources, dictionary);
                    const installed = Boolean(installedSource);
                    const count = metricValue(installedSource, dictionary.metric);
                    const isDownloading = downloadKey === dictionary.key;
                    const activeProgress =
                      isDownloading && downloadProgress?.key === dictionary.key ? downloadProgress : null;
                    const progressPercent =
                      activeProgress?.progress === null || activeProgress?.progress === undefined
                        ? null
                        : Math.round(activeProgress.progress * 100);
                    const progressIndeterminate =
                      progressPercent === null ||
                      Boolean(activeProgress?.stage?.startsWith("Preparando")) ||
                      (activeProgress?.phase === "importing" && !activeProgress.stage);
                    const buttonLabel =
                      isDownloading && activeProgress?.phase === "importing"
                        ? "Importando"
                        : isDownloading
                          ? "Baixando"
                          : installed
                            ? "Atualizar"
                            : "Baixar";

                    return (
                      <article key={dictionary.key} className="shiori-recommended-dictionary">
                        <div className="shiori-recommended-main">
                          <div className="shiori-recommended-title">
                            <strong>{dictionary.name}</strong>
                            {installed ? (
                              <span className="shiori-installed-badge">
                                <CheckCircle2 size={13} />
                                Instalado
                              </span>
                            ) : null}
                          </div>
                          <p>{dictionary.description}</p>
                          <a href={dictionary.homepage} target="_blank" rel="noreferrer">
                            Homepage
                            <ExternalLink size={12} />
                          </a>
                        </div>

                        <div className="shiori-recommended-status">
                          <span>
                            {installed
                              ? `${count.toLocaleString("pt-BR")} ${metricLabel(dictionary.metric)}`
                              : "Nao instalado"}
                          </span>
                          <button
                            disabled={busy}
                            type="button"
                            onClick={() => onDownloadDictionary(dictionary.key)}
                          >
                            {isDownloading ? <Loader2 className="shiori-spin" size={15} /> : <Download size={15} />}
                            {buttonLabel}
                          </button>
                        </div>

                        {isDownloading ? (
                          <div className="shiori-recommended-progress-row">
                            <div
                              aria-label={`Progresso da instalacao de ${dictionary.name}`}
                              aria-valuemax={100}
                              aria-valuemin={0}
                              aria-valuenow={progressIndeterminate ? undefined : (progressPercent ?? undefined)}
                              className={`shiori-download-progress ${
                                progressIndeterminate ? "is-indeterminate" : ""
                              }`}
                              role="progressbar"
                            >
                              <span
                                style={
                                  progressIndeterminate
                                    ? undefined
                                    : { width: `${Math.max(2, progressPercent ?? 0)}%` }
                                }
                              />
                            </div>
                            <small className="shiori-download-progress-label">
                              {progressLabel(activeProgress)}
                            </small>
                          </div>
                        ) : null}
                      </article>
                    );
                  },
                )}
              </div>
            </div>
          ))}
        </section>

        <aside className="shiori-settings-summary" aria-label="Dicionarios locais">
          <h2>Dicionarios locais</h2>
          {sources.length === 0 ? (
            <p>Nenhum dicionario instalado ainda.</p>
          ) : (
            <div className="shiori-installed-list">
              {sources.map((source) => (
                <div key={source.id} className="shiori-installed-source">
                  <strong>{source.name}</strong>
                  <span>
                    {source.termCount.toLocaleString("pt-BR")} termos ·{" "}
                    {source.kanjiCount.toLocaleString("pt-BR")} kanji ·{" "}
                    {source.metaCount.toLocaleString("pt-BR")} metadados
                  </span>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

export default SettingsScreen;
