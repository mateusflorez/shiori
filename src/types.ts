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
