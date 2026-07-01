mod annotations;
mod db;
mod documents;

use std::path::PathBuf;

#[derive(Clone)]
struct AppState {
    db_path: PathBuf,
}

impl AppState {
    fn new() -> Result<Self, String> {
        let db_path = db::default_db_path();
        db::initialize_database(&db_path)?;

        Ok(Self { db_path })
    }
}

#[tauri::command]
fn open_document_record(
    file_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<documents::DocumentRecord, String> {
    documents::open_document_record(&state.db_path, file_path)
}

#[tauri::command]
fn list_recent_documents(
    limit: Option<u32>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<documents::DocumentRecord>, String> {
    documents::list_recent_documents(&state.db_path, limit)
}

#[tauri::command]
fn save_reading_position(
    input: documents::SaveReadingPositionInput,
    state: tauri::State<'_, AppState>,
) -> Result<documents::ReadingPosition, String> {
    documents::save_reading_position(&state.db_path, input)
}

#[tauri::command]
fn get_reading_position(
    document_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Option<documents::ReadingPosition>, String> {
    documents::get_reading_position(&state.db_path, document_id)
}

#[tauri::command]
fn read_document_bytes(file_path: String) -> Result<Vec<u8>, String> {
    documents::read_document_bytes(file_path)
}

#[tauri::command]
fn list_bookmarks(
    document_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<annotations::BookmarkRecord>, String> {
    annotations::list_bookmarks(&state.db_path, document_id)
}

#[tauri::command]
fn create_bookmark(
    input: annotations::CreateBookmarkInput,
    state: tauri::State<'_, AppState>,
) -> Result<annotations::BookmarkRecord, String> {
    annotations::create_bookmark(&state.db_path, input)
}

#[tauri::command]
fn update_bookmark_note(
    input: annotations::UpdateBookmarkNoteInput,
    state: tauri::State<'_, AppState>,
) -> Result<annotations::BookmarkRecord, String> {
    annotations::update_bookmark_note(&state.db_path, input)
}

#[tauri::command]
fn delete_bookmark(id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    annotations::delete_bookmark(&state.db_path, id)
}

#[tauri::command]
fn list_highlights(
    document_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<annotations::HighlightRecord>, String> {
    annotations::list_highlights(&state.db_path, document_id)
}

#[tauri::command]
fn create_highlight(
    input: annotations::CreateHighlightInput,
    state: tauri::State<'_, AppState>,
) -> Result<annotations::HighlightRecord, String> {
    annotations::create_highlight(&state.db_path, input)
}

#[tauri::command]
fn update_highlight_note(
    input: annotations::UpdateHighlightNoteInput,
    state: tauri::State<'_, AppState>,
) -> Result<annotations::HighlightRecord, String> {
    annotations::update_highlight_note(&state.db_path, input)
}

#[tauri::command]
fn delete_highlight(id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    annotations::delete_highlight(&state.db_path, id)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState::new().expect("failed to initialize Shiori storage");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            open_document_record,
            list_recent_documents,
            save_reading_position,
            get_reading_position,
            read_document_bytes,
            list_bookmarks,
            create_bookmark,
            update_bookmark_note,
            delete_bookmark,
            list_highlights,
            create_highlight,
            update_highlight_note,
            delete_highlight
        ])
        .run(tauri::generate_context!())
        .expect("error while running Shiori");
}
