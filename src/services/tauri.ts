import { invoke } from "@tauri-apps/api/core";
import type { DocumentRecord, ReadingPosition, SaveReadingPositionInput } from "../types";

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
