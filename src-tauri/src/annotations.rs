use crate::db;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_LABEL_LEN: usize = 160;
const MAX_NOTE_LEN: usize = 2_000;
const MAX_SELECTED_TEXT_LEN: usize = 8_000;
const MAX_RANGE_JSON_LEN: usize = 40_000;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkRecord {
    id: String,
    document_id: String,
    locator_type: String,
    locator: String,
    label: Option<String>,
    note: Option<String>,
    created_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HighlightRecord {
    id: String,
    document_id: String,
    locator_type: String,
    locator: String,
    selected_text: String,
    context_before: Option<String>,
    context_after: Option<String>,
    range_json: String,
    color: String,
    note: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBookmarkInput {
    document_id: String,
    locator_type: String,
    locator: String,
    label: Option<String>,
    note: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateHighlightInput {
    document_id: String,
    locator_type: String,
    locator: String,
    selected_text: String,
    context_before: Option<String>,
    context_after: Option<String>,
    range_json: String,
    color: String,
    note: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBookmarkNoteInput {
    id: String,
    note: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateHighlightNoteInput {
    id: String,
    note: Option<String>,
}

pub fn list_bookmarks(db_path: &Path, document_id: String) -> Result<Vec<BookmarkRecord>, String> {
    let document_id = normalize_required(&document_id, "Informe um document_id valido.")?;
    let connection = db::open_connection(db_path)?;
    ensure_document_exists(&connection, &document_id)?;

    let mut statement = connection
        .prepare(
            "
            SELECT id, document_id, locator_type, locator, label, note, created_at
            FROM bookmarks
            WHERE document_id = ?1
            ORDER BY created_at ASC
            ",
        )
        .map_err(|error| format!("Nao foi possivel listar favoritos: {error}"))?;

    let rows = statement
        .query_map([document_id], map_bookmark_record)
        .map_err(|error| format!("Nao foi possivel consultar favoritos: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Nao foi possivel ler favoritos: {error}"))
}

pub fn create_bookmark(
    db_path: &Path,
    input: CreateBookmarkInput,
) -> Result<BookmarkRecord, String> {
    validate_bookmark_input(&input)?;

    let connection = db::open_connection(db_path)?;
    ensure_document_exists(&connection, input.document_id.trim())?;

    let now = db::now_timestamp();
    let label = normalize_optional(input.label);
    let note = normalize_optional_note(input.note)?;
    let id = annotation_id("bookmark", &[&input.document_id, &input.locator, &now]);

    connection
        .execute(
            "
            INSERT INTO bookmarks (id, document_id, locator_type, locator, label, note, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ",
            params![
                id,
                input.document_id.trim(),
                input.locator_type.trim(),
                input.locator.trim(),
                label,
                note,
                now
            ],
        )
        .map_err(|error| format!("Nao foi possivel salvar favorito: {error}"))?;

    get_bookmark_by_id(&connection, &id)?
        .ok_or_else(|| "Favorito salvo, mas nao encontrado no banco local.".to_string())
}

pub fn update_bookmark_note(
    db_path: &Path,
    input: UpdateBookmarkNoteInput,
) -> Result<BookmarkRecord, String> {
    let id = normalize_required(&input.id, "Informe um favorito valido.")?;
    let note = normalize_optional_note(input.note)?;
    let connection = db::open_connection(db_path)?;

    let changed = connection
        .execute(
            "UPDATE bookmarks SET note = ?1 WHERE id = ?2",
            params![note, id],
        )
        .map_err(|error| format!("Nao foi possivel atualizar nota do favorito: {error}"))?;

    if changed == 0 {
        return Err("Favorito nao encontrado.".to_string());
    }

    get_bookmark_by_id(&connection, &id)?
        .ok_or_else(|| "Favorito atualizado, mas nao encontrado no banco local.".to_string())
}

pub fn delete_bookmark(db_path: &Path, id: String) -> Result<(), String> {
    let id = normalize_required(&id, "Informe um favorito valido.")?;
    let connection = db::open_connection(db_path)?;
    let changed = connection
        .execute("DELETE FROM bookmarks WHERE id = ?1", [id])
        .map_err(|error| format!("Nao foi possivel remover favorito: {error}"))?;

    if changed == 0 {
        Err("Favorito nao encontrado.".to_string())
    } else {
        Ok(())
    }
}

pub fn list_highlights(
    db_path: &Path,
    document_id: String,
) -> Result<Vec<HighlightRecord>, String> {
    let document_id = normalize_required(&document_id, "Informe um document_id valido.")?;
    let connection = db::open_connection(db_path)?;
    ensure_document_exists(&connection, &document_id)?;

    let mut statement = connection
        .prepare(
            "
            SELECT id, document_id, locator_type, locator, selected_text, context_before,
              context_after, range_json, color, note, created_at, updated_at
            FROM highlights
            WHERE document_id = ?1
            ORDER BY created_at ASC
            ",
        )
        .map_err(|error| format!("Nao foi possivel listar marcacoes: {error}"))?;

    let rows = statement
        .query_map([document_id], map_highlight_record)
        .map_err(|error| format!("Nao foi possivel consultar marcacoes: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Nao foi possivel ler marcacoes: {error}"))
}

pub fn create_highlight(
    db_path: &Path,
    input: CreateHighlightInput,
) -> Result<HighlightRecord, String> {
    validate_highlight_input(&input)?;

    let connection = db::open_connection(db_path)?;
    ensure_document_exists(&connection, input.document_id.trim())?;

    let now = db::now_timestamp();
    let context_before = normalize_optional(input.context_before);
    let context_after = normalize_optional(input.context_after);
    let note = normalize_optional_note(input.note)?;
    let id = annotation_id(
        "highlight",
        &[
            &input.document_id,
            &input.locator,
            &input.selected_text,
            &input.range_json,
            &now,
        ],
    );

    connection
        .execute(
            "
            INSERT INTO highlights (
              id, document_id, locator_type, locator, selected_text, context_before,
              context_after, range_json, color, note, created_at, updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)
            ",
            params![
                id,
                input.document_id.trim(),
                input.locator_type.trim(),
                input.locator.trim(),
                input.selected_text.trim(),
                context_before,
                context_after,
                input.range_json.trim(),
                input.color.trim(),
                note,
                now
            ],
        )
        .map_err(|error| format!("Nao foi possivel salvar marcacao: {error}"))?;

    get_highlight_by_id(&connection, &id)?
        .ok_or_else(|| "Marcacao salva, mas nao encontrada no banco local.".to_string())
}

pub fn update_highlight_note(
    db_path: &Path,
    input: UpdateHighlightNoteInput,
) -> Result<HighlightRecord, String> {
    let id = normalize_required(&input.id, "Informe uma marcacao valida.")?;
    let note = normalize_optional_note(input.note)?;
    let now = db::now_timestamp();
    let connection = db::open_connection(db_path)?;

    let changed = connection
        .execute(
            "UPDATE highlights SET note = ?1, updated_at = ?2 WHERE id = ?3",
            params![note, now, id],
        )
        .map_err(|error| format!("Nao foi possivel atualizar nota da marcacao: {error}"))?;

    if changed == 0 {
        return Err("Marcacao nao encontrada.".to_string());
    }

    get_highlight_by_id(&connection, &id)?
        .ok_or_else(|| "Marcacao atualizada, mas nao encontrada no banco local.".to_string())
}

pub fn delete_highlight(db_path: &Path, id: String) -> Result<(), String> {
    let id = normalize_required(&id, "Informe uma marcacao valida.")?;
    let connection = db::open_connection(db_path)?;
    let changed = connection
        .execute("DELETE FROM highlights WHERE id = ?1", [id])
        .map_err(|error| format!("Nao foi possivel remover marcacao: {error}"))?;

    if changed == 0 {
        Err("Marcacao nao encontrada.".to_string())
    } else {
        Ok(())
    }
}

fn validate_bookmark_input(input: &CreateBookmarkInput) -> Result<(), String> {
    validate_location(&input.document_id, &input.locator_type, &input.locator)?;
    validate_optional_len(input.label.as_deref(), MAX_LABEL_LEN, "label")?;
    let _ = normalize_optional_note(input.note.clone())?;

    Ok(())
}

fn validate_highlight_input(input: &CreateHighlightInput) -> Result<(), String> {
    validate_location(&input.document_id, &input.locator_type, &input.locator)?;

    let selected_text = input.selected_text.trim();
    if selected_text.is_empty() {
        return Err("Selecione um trecho antes de criar a marcacao.".to_string());
    }

    if selected_text.chars().count() > MAX_SELECTED_TEXT_LEN {
        return Err("O trecho selecionado e longo demais para uma marcacao.".to_string());
    }

    if input.range_json.trim().is_empty() {
        return Err("Informe os dados de posicao da marcacao.".to_string());
    }

    if input.range_json.chars().count() > MAX_RANGE_JSON_LEN {
        return Err("Os dados de posicao da marcacao sao grandes demais.".to_string());
    }

    if !matches!(
        input.color.trim(),
        "#facc15" | "#60a5fa" | "#34d399" | "#fb7185"
    ) {
        return Err("Cor de marcacao invalida.".to_string());
    }

    validate_optional_len(
        input.context_before.as_deref(),
        MAX_SELECTED_TEXT_LEN,
        "context_before",
    )?;
    validate_optional_len(
        input.context_after.as_deref(),
        MAX_SELECTED_TEXT_LEN,
        "context_after",
    )?;
    let _ = normalize_optional_note(input.note.clone())?;

    Ok(())
}

fn validate_location(document_id: &str, locator_type: &str, locator: &str) -> Result<(), String> {
    if document_id.trim().is_empty() {
        return Err("Informe um document_id valido.".to_string());
    }

    if !matches!(locator_type.trim(), "pdf_page" | "epub_cfi") {
        return Err("locator_type deve ser pdf_page ou epub_cfi.".to_string());
    }

    if locator.trim().is_empty() {
        return Err("Informe um locator valido.".to_string());
    }

    Ok(())
}

fn validate_optional_len(value: Option<&str>, max_len: usize, field: &str) -> Result<(), String> {
    if value.unwrap_or_default().trim().chars().count() > max_len {
        return Err(format!("{field} e longo demais."));
    }

    Ok(())
}

fn normalize_required(value: &str, message: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        Err(message.to_string())
    } else {
        Ok(value.to_string())
    }
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

fn normalize_optional_note(value: Option<String>) -> Result<Option<String>, String> {
    validate_optional_len(value.as_deref(), MAX_NOTE_LEN, "note")?;

    Ok(normalize_optional(value))
}

fn ensure_document_exists(connection: &Connection, document_id: &str) -> Result<(), String> {
    let exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM documents WHERE id = ?1)",
            [document_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("Nao foi possivel validar documento: {error}"))?;

    if exists {
        Ok(())
    } else {
        Err("Documento nao encontrado.".to_string())
    }
}

fn get_bookmark_by_id(connection: &Connection, id: &str) -> Result<Option<BookmarkRecord>, String> {
    connection
        .query_row(
            "
            SELECT id, document_id, locator_type, locator, label, note, created_at
            FROM bookmarks
            WHERE id = ?1
            ",
            [id],
            map_bookmark_record,
        )
        .optional()
        .map_err(|error| format!("Nao foi possivel carregar favorito: {error}"))
}

fn get_highlight_by_id(
    connection: &Connection,
    id: &str,
) -> Result<Option<HighlightRecord>, String> {
    connection
        .query_row(
            "
            SELECT id, document_id, locator_type, locator, selected_text, context_before,
              context_after, range_json, color, note, created_at, updated_at
            FROM highlights
            WHERE id = ?1
            ",
            [id],
            map_highlight_record,
        )
        .optional()
        .map_err(|error| format!("Nao foi possivel carregar marcacao: {error}"))
}

fn map_bookmark_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<BookmarkRecord> {
    Ok(BookmarkRecord {
        id: row.get(0)?,
        document_id: row.get(1)?,
        locator_type: row.get(2)?,
        locator: row.get(3)?,
        label: row.get(4)?,
        note: row.get(5)?,
        created_at: row.get(6)?,
    })
}

fn map_highlight_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<HighlightRecord> {
    Ok(HighlightRecord {
        id: row.get(0)?,
        document_id: row.get(1)?,
        locator_type: row.get(2)?,
        locator: row.get(3)?,
        selected_text: row.get(4)?,
        context_before: row.get(5)?,
        context_after: row.get(6)?,
        range_json: row.get(7)?,
        color: row.get(8)?,
        note: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn annotation_id(prefix: &str, parts: &[&str]) -> String {
    let mut hasher = Sha256::new();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default()
        .to_string();

    hasher.update(prefix.as_bytes());
    hasher.update(b"\0");
    hasher.update(nanos.as_bytes());
    for part in parts {
        hasher.update(b"\0");
        hasher.update(part.as_bytes());
    }

    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<Vec<_>>()
        .join("")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    struct TestPaths {
        root: PathBuf,
        db_path: PathBuf,
        document_id: String,
    }

    fn test_paths() -> TestPaths {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("shiori-annotations-test-{suffix}"));
        fs::create_dir_all(&root).unwrap();
        let db_path = root.join("shiori.sqlite3");
        let document_id = "doc-1".to_string();

        db::initialize_database(&db_path).unwrap();
        let connection = db::open_connection(&db_path).unwrap();
        connection
            .execute(
                "
                INSERT INTO documents (
                  id, title, kind, file_path, file_hash, created_at, updated_at, last_opened_at
                )
                VALUES (?1, 'Sample', 'pdf', 'C:\\sample.pdf', 'hash', ?2, ?2, ?2)
                ",
                params![document_id, db::now_timestamp()],
            )
            .unwrap();

        TestPaths {
            root,
            db_path,
            document_id,
        }
    }

    #[test]
    fn creates_lists_and_updates_bookmark_note() {
        let paths = test_paths();
        let bookmark = create_bookmark(
            &paths.db_path,
            CreateBookmarkInput {
                document_id: paths.document_id.clone(),
                locator_type: "pdf_page".to_string(),
                locator: "3".to_string(),
                label: Some("Pagina 3".to_string()),
                note: None,
            },
        )
        .unwrap();

        let updated = update_bookmark_note(
            &paths.db_path,
            UpdateBookmarkNoteInput {
                id: bookmark.id,
                note: Some("Revisar exemplo".to_string()),
            },
        )
        .unwrap();
        let bookmarks = list_bookmarks(&paths.db_path, paths.document_id).unwrap();

        assert_eq!(bookmarks.len(), 1);
        assert_eq!(updated.note.as_deref(), Some("Revisar exemplo"));
        let _ = fs::remove_dir_all(paths.root);
    }

    #[test]
    fn creates_lists_updates_and_deletes_highlight() {
        let paths = test_paths();
        let highlight = create_highlight(
            &paths.db_path,
            CreateHighlightInput {
                document_id: paths.document_id.clone(),
                locator_type: "pdf_page".to_string(),
                locator: "2".to_string(),
                selected_text: "日本語".to_string(),
                context_before: None,
                context_after: None,
                range_json: "{\"kind\":\"pdf\",\"pageIndex\":1,\"rects\":[]}".to_string(),
                color: "#facc15".to_string(),
                note: None,
            },
        )
        .unwrap();

        let updated = update_highlight_note(
            &paths.db_path,
            UpdateHighlightNoteInput {
                id: highlight.id.clone(),
                note: Some("Palavra importante".to_string()),
            },
        )
        .unwrap();
        delete_highlight(&paths.db_path, highlight.id).unwrap();
        let highlights = list_highlights(&paths.db_path, paths.document_id).unwrap();

        assert_eq!(updated.note.as_deref(), Some("Palavra importante"));
        assert!(highlights.is_empty());
        let _ = fs::remove_dir_all(paths.root);
    }
}
