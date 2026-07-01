CREATE TABLE IF NOT EXISTS dictionary_kanji (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  character TEXT NOT NULL,
  onyomi TEXT,
  kunyomi TEXT,
  tags TEXT,
  meanings_json TEXT NOT NULL,
  stats_json TEXT NOT NULL,
  kanji_json TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES dictionary_sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dictionary_kanji_character
  ON dictionary_kanji(character);

CREATE INDEX IF NOT EXISTS idx_dictionary_kanji_source_id
  ON dictionary_kanji(source_id);

CREATE TABLE IF NOT EXISTS dictionary_term_meta (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  expression TEXT NOT NULL,
  reading TEXT,
  mode TEXT NOT NULL,
  data_json TEXT NOT NULL,
  meta_json TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES dictionary_sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dictionary_term_meta_expression_mode
  ON dictionary_term_meta(expression, mode);

CREATE INDEX IF NOT EXISTS idx_dictionary_term_meta_source_id
  ON dictionary_term_meta(source_id);
