export type DocumentKind = "pdf" | "epub";

export type DocumentRecord = {
  id: string;
  title: string;
  kind: DocumentKind;
  filePath: string;
  fileHash: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
};

export type LocatorType = "pdf_page" | "epub_cfi";

export type ReadingPosition = {
  documentId: string;
  locatorType: LocatorType;
  locator: string;
  pageIndex: number | null;
  scrollX: number;
  scrollY: number;
  zoom: number;
  progress: number;
  updatedAt: string;
};

export type SaveReadingPositionInput = Omit<ReadingPosition, "updatedAt">;

export type DocumentTocItem = {
  id: string;
  title: string;
  href: string | null;
  pageIndex: number | null;
  items: DocumentTocItem[];
};

export type PdfOutlineItem = DocumentTocItem;

export type EpubTocItem = DocumentTocItem;

export type EpubViewerLocation = {
  cfi: string;
  href: string;
  progress: number;
  displayedPage: number;
  displayedTotal: number;
  atStart: boolean;
  atEnd: boolean;
};

export type EpubNavigationTarget = {
  href: string;
  token: number;
};

export type EpubViewerCommand = {
  action: "previous" | "next";
  token: number;
};

export type HighlightColor = "#facc15" | "#60a5fa" | "#34d399" | "#fb7185";

export type HighlightRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfHighlightRange = {
  kind: "pdf";
  pageIndex: number;
  rects: HighlightRect[];
};

export type EpubHighlightRange = {
  kind: "epub";
  href: string;
  sectionIndex: number;
  sectionProgress: number;
  rects: HighlightRect[];
};

export type HighlightRange = PdfHighlightRange | EpubHighlightRange;

export type ReaderTextSelection = {
  documentKind: DocumentKind;
  locatorType: LocatorType;
  locator: string;
  selectedText: string;
  rangeJson: string;
};

export type BookmarkRecord = {
  id: string;
  documentId: string;
  locatorType: LocatorType;
  locator: string;
  label: string | null;
  note: string | null;
  createdAt: string;
};

export type HighlightRecord = {
  id: string;
  documentId: string;
  locatorType: LocatorType;
  locator: string;
  selectedText: string;
  contextBefore: string | null;
  contextAfter: string | null;
  rangeJson: string;
  color: HighlightColor;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateBookmarkInput = {
  documentId: string;
  locatorType: LocatorType;
  locator: string;
  label: string | null;
  note: string | null;
};

export type CreateHighlightInput = {
  documentId: string;
  locatorType: LocatorType;
  locator: string;
  selectedText: string;
  contextBefore: string | null;
  contextAfter: string | null;
  rangeJson: string;
  color: HighlightColor;
  note: string | null;
};

export type DictionarySourceRecord = {
  id: string;
  name: string;
  format: string;
  revision: string | null;
  enabled: boolean;
  priority: number;
  importedAt: string;
  termCount: number;
  kanjiCount: number;
  metaCount: number;
};

export type ImportDictionaryResult = {
  source: DictionarySourceRecord;
  termCount: number;
  kanjiCount: number;
  metaCount: number;
};

export type DictionaryDownloadProgress = {
  key: string;
  downloadedBytes: number;
  totalBytes: number | null;
  progress: number | null;
  phase: "starting" | "downloading" | "importing" | "done";
  importedRows: number | null;
  totalRows: number | null;
  stage: string | null;
};

export type LookupTermInput = {
  query: string;
  documentId: string | null;
  sentence: string | null;
  selectedText: string | null;
};

export type LookupTermEntry = {
  id: string;
  sourceId: string;
  sourceName: string;
  expression: string;
  reading: string | null;
  score: number | null;
  sequence: number | null;
  definitionTags: string[];
  termTags: string[];
  glossary: string[];
  rawJson: string;
};

export type LookupKanjiEntry = {
  id: string;
  sourceId: string;
  sourceName: string;
  character: string;
  onyomi: string[];
  kunyomi: string[];
  tags: string[];
  meanings: string[];
  stats: unknown;
  rawJson: string;
};

export type LookupFrequencyEntry = {
  id: string;
  sourceId: string;
  sourceName: string;
  expression: string;
  reading: string | null;
  displayValue: string;
  sortValue: number | null;
  rawJson: string;
};

export type LookupResult = {
  query: string;
  matchedText: string;
  terms: LookupTermEntry[];
  kanji: LookupKanjiEntry[];
  frequencies: LookupFrequencyEntry[];
};

export type ReaderLookupRequest = {
  query: string;
  sentence: string | null;
  selectedText: string | null;
  clientX: number;
  clientY: number;
};
