import { invoke } from "@tauri-apps/api/core";
import type {
  BookmarkRecord,
  CreateBookmarkInput,
  CreateHighlightInput,
  DocumentRecord,
  HighlightRecord,
  ReadingPosition,
  SaveReadingPositionInput,
} from "../types";

export async function openDocumentRecord(filePath: string) {
  return invoke<DocumentRecord>("open_document_record", { filePath });
}

export async function listRecentDocuments(limit = 25) {
  return invoke<DocumentRecord[]>("list_recent_documents", { limit });
}

export async function getReadingPosition(documentId: string) {
  return invoke<ReadingPosition | null>("get_reading_position", { documentId });
}

export async function saveReadingPosition(input: SaveReadingPositionInput) {
  return invoke<ReadingPosition>("save_reading_position", { input });
}

export async function readDocumentBytes(filePath: string) {
  const bytes = await invoke<number[]>("read_document_bytes", { filePath });

  return new Uint8Array(bytes);
}

export async function listBookmarks(documentId: string) {
  return invoke<BookmarkRecord[]>("list_bookmarks", { documentId });
}

export async function createBookmark(input: CreateBookmarkInput) {
  return invoke<BookmarkRecord>("create_bookmark", { input });
}

export async function updateBookmarkNote(id: string, note: string | null) {
  return invoke<BookmarkRecord>("update_bookmark_note", { input: { id, note } });
}

export async function deleteBookmark(id: string) {
  return invoke<void>("delete_bookmark", { id });
}

export async function listHighlights(documentId: string) {
  return invoke<HighlightRecord[]>("list_highlights", { documentId });
}

export async function createHighlight(input: CreateHighlightInput) {
  return invoke<HighlightRecord>("create_highlight", { input });
}

export async function updateHighlightNote(id: string, note: string | null) {
  return invoke<HighlightRecord>("update_highlight_note", { input: { id, note } });
}

export async function deleteHighlight(id: string) {
  return invoke<void>("delete_highlight", { id });
}
