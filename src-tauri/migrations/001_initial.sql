CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pdf', 'epub')),
  file_path TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_opened_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_file_path ON documents(file_path);
CREATE INDEX IF NOT EXISTS idx_documents_last_opened_at ON documents(last_opened_at DESC);

CREATE TABLE IF NOT EXISTS reading_positions (
  document_id TEXT PRIMARY KEY,
  locator_type TEXT NOT NULL CHECK (locator_type IN ('pdf_page', 'epub_cfi')),
  locator TEXT NOT NULL,
  page_index INTEGER,
  scroll_x REAL NOT NULL DEFAULT 0,
  scroll_y REAL NOT NULL DEFAULT 0,
  zoom REAL NOT NULL DEFAULT 1,
  progress REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  locator_type TEXT NOT NULL,
  locator TEXT NOT NULL,
  label TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_document_id ON bookmarks(document_id);

CREATE TABLE IF NOT EXISTS highlights (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  locator_type TEXT NOT NULL,
  locator TEXT NOT NULL,
  selected_text TEXT NOT NULL,
  context_before TEXT,
  context_after TEXT,
  range_json TEXT NOT NULL,
  color TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_highlights_document_id ON highlights(document_id);

CREATE TABLE IF NOT EXISTS dictionary_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  format TEXT NOT NULL,
  revision TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 100,
  imported_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dictionary_terms (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  expression TEXT NOT NULL,
  reading TEXT,
  sequence INTEGER,
  score INTEGER DEFAULT 0,
  term_json TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES dictionary_sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dictionary_terms_expression_reading
  ON dictionary_terms(expression, reading);

CREATE TABLE IF NOT EXISTS lookup_history (
  id TEXT PRIMARY KEY,
  document_id TEXT,
  expression TEXT NOT NULL,
  reading TEXT,
  sentence TEXT,
  selected_text TEXT,
  anki_note_id INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_lookup_history_created_at ON lookup_history(created_at DESC);

CREATE TABLE IF NOT EXISTS anki_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  deck_name TEXT NOT NULL,
  model_name TEXT NOT NULL,
  field_mapping_json TEXT NOT NULL,
  tags TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
