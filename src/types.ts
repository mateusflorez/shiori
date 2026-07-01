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
