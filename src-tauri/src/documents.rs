use crate::db;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
};

const DEFAULT_RECENT_LIMIT: u32 = 25;
const MAX_RECENT_LIMIT: u32 = 100;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentRecord {
    id: String,
    title: String,
    kind: String,
    file_path: String,
    file_hash: String,
    created_at: String,
    updated_at: String,
    last_opened_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveReadingPositionInput {
    document_id: String,
    locator_type: String,
    locator: String,
    page_index: Option<i64>,
    scroll_x: f64,
    scroll_y: f64,
    zoom: f64,
    progress: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingPosition {
    document_id: String,
    locator_type: String,
    locator: String,
    page_index: Option<i64>,
    scroll_x: f64,
    scroll_y: f64,
    zoom: f64,
    progress: f64,
    updated_at: String,
}

pub fn open_document_record(db_path: &Path, file_path: String) -> Result<DocumentRecord, String> {
    let document_path = normalize_document_path(&file_path)?;
    let kind = detect_document_kind(&document_path)?;
    let title = document_title(&document_path)?;
    let file_hash = sha256_file(&document_path)?;
    let canonical_path = document_path.to_string_lossy().to_string();
    let document_id = document_id(&kind, &canonical_path);
    let now = db::now_timestamp();
    let connection = db::open_connection(db_path)?;

    connection
        .execute(
            "
            INSERT INTO documents (
              id, title, kind, file_path, file_hash, created_at, updated_at, last_opened_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?6)
            ON CONFLICT(id) DO UPDATE SET
              title = excluded.title,
              kind = excluded.kind,
              file_path = excluded.file_path,
              file_hash = excluded.file_hash,
              updated_at = excluded.updated_at,
              last_opened_at = excluded.last_opened_at
            ",
            params![document_id, title, kind, canonical_path, file_hash, now],
        )
        .map_err(|error| format!("Nao foi possivel salvar documento: {error}"))?;

    get_document_by_id(&connection, &document_id)?
        .ok_or_else(|| "Documento salvo, mas nao encontrado no banco local.".to_string())
}

pub fn list_recent_documents(
    db_path: &Path,
    limit: Option<u32>,
) -> Result<Vec<DocumentRecord>, String> {
    let connection = db::open_connection(db_path)?;
    let limit = limit
        .unwrap_or(DEFAULT_RECENT_LIMIT)
        .clamp(1, MAX_RECENT_LIMIT);
    let mut statement = connection
        .prepare(
            "
            SELECT id, title, kind, file_path, file_hash, created_at, updated_at, last_opened_at
            FROM documents
            ORDER BY COALESCE(last_opened_at, updated_at) DESC, title ASC
            LIMIT ?1
            ",
        )
        .map_err(|error| format!("Nao foi possivel listar documentos: {error}"))?;

    let rows = statement
        .query_map([i64::from(limit)], map_document_record)
        .map_err(|error| format!("Nao foi possivel consultar documentos: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Nao foi possivel ler documentos: {error}"))
}

pub fn save_reading_position(
    db_path: &Path,
    input: SaveReadingPositionInput,
) -> Result<ReadingPosition, String> {
    validate_reading_position(&input)?;

    let connection = db::open_connection(db_path)?;
    ensure_document_exists(&connection, &input.document_id)?;

    let now = db::now_timestamp();
    connection
        .execute(
            "
            INSERT INTO reading_positions (
              document_id, locator_type, locator, page_index, scroll_x, scroll_y, zoom, progress, updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(document_id) DO UPDATE SET
              locator_type = excluded.locator_type,
              locator = excluded.locator,
              page_index = excluded.page_index,
              scroll_x = excluded.scroll_x,
              scroll_y = excluded.scroll_y,
              zoom = excluded.zoom,
              progress = excluded.progress,
              updated_at = excluded.updated_at
            ",
            params![
                input.document_id,
                input.locator_type,
                input.locator,
                input.page_index,
                input.scroll_x,
                input.scroll_y,
                input.zoom,
                input.progress,
                now
            ],
        )
        .map_err(|error| format!("Nao foi possivel salvar posicao: {error}"))?;

    get_reading_position(db_path, input.document_id)?
        .ok_or_else(|| "Posicao salva, mas nao encontrada no banco local.".to_string())
}

pub fn get_reading_position(
    db_path: &Path,
    document_id: String,
) -> Result<Option<ReadingPosition>, String> {
    if document_id.trim().is_empty() {
        return Err("Informe um document_id valido.".to_string());
    }

    let connection = db::open_connection(db_path)?;
    connection
        .query_row(
            "
            SELECT document_id, locator_type, locator, page_index, scroll_x, scroll_y, zoom, progress, updated_at
            FROM reading_positions
            WHERE document_id = ?1
            ",
            [document_id.trim()],
            map_reading_position,
        )
        .optional()
        .map_err(|error| format!("Nao foi possivel carregar posicao: {error}"))
}

pub fn read_document_bytes(file_path: String) -> Result<Vec<u8>, String> {
    let document_path = normalize_document_path(&file_path)?;
    let _ = detect_document_kind(&document_path)?;

    fs::read(document_path).map_err(|error| format!("Nao foi possivel ler documento: {error}"))
}

fn normalize_document_path(file_path: &str) -> Result<PathBuf, String> {
    let trimmed_path = file_path.trim();
    if trimmed_path.is_empty() {
        return Err("Informe o caminho de um PDF ou EPUB local.".to_string());
    }

    let path = PathBuf::from(trimmed_path);
    if !path.exists() {
        return Err("Arquivo nao encontrado.".to_string());
    }

    if !path.is_file() {
        return Err("O caminho informado nao aponta para um arquivo.".to_string());
    }

    path.canonicalize()
        .map_err(|error| format!("Nao foi possivel normalizar caminho do arquivo: {error}"))
}

fn detect_document_kind(path: &Path) -> Result<String, String> {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    match extension.as_str() {
        "pdf" => Ok("pdf".to_string()),
        "epub" => Ok("epub".to_string()),
        _ => Err("Formato nao suportado. Use PDF ou EPUB.".to_string()),
    }
}

fn document_title(path: &Path) -> Result<String, String> {
    path.file_stem()
        .and_then(|title| title.to_str())
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "Nao foi possivel inferir o titulo do documento.".to_string())
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file =
        File::open(path).map_err(|error| format!("Nao foi possivel abrir arquivo: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 16 * 1024];

    loop {
        let bytes_read = file
            .read(&mut buffer)
            .map_err(|error| format!("Nao foi possivel ler arquivo: {error}"))?;
        if bytes_read == 0 {
            break;
        }

        hasher.update(&buffer[..bytes_read]);
    }

    Ok(hex_digest(hasher.finalize().as_slice()))
}

fn document_id(kind: &str, canonical_path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(kind.as_bytes());
    hasher.update(b"\0");
    hasher.update(canonical_path.as_bytes());

    hex_digest(hasher.finalize().as_slice())
}

fn hex_digest(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<Vec<_>>()
        .join("")
}

fn validate_reading_position(input: &SaveReadingPositionInput) -> Result<(), String> {
    if input.document_id.trim().is_empty() {
        return Err("Informe um document_id valido.".to_string());
    }

    if !matches!(input.locator_type.as_str(), "pdf_page" | "epub_cfi") {
        return Err("locator_type deve ser pdf_page ou epub_cfi.".to_string());
    }

    if input.locator.trim().is_empty() {
        return Err("Informe um locator valido.".to_string());
    }

    if input.zoom <= 0.0 || !input.zoom.is_finite() {
        return Err("zoom deve ser maior que zero.".to_string());
    }

    if !(0.0..=1.0).contains(&input.progress) || !input.progress.is_finite() {
        return Err("progress deve ficar entre 0 e 1.".to_string());
    }

    if !input.scroll_x.is_finite() || !input.scroll_y.is_finite() {
        return Err("scroll_x e scroll_y precisam ser numeros validos.".to_string());
    }

    Ok(())
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
        Err("Documento nao encontrado. Registre o documento antes de salvar posicao.".to_string())
    }
}

fn get_document_by_id(
    connection: &Connection,
    document_id: &str,
) -> Result<Option<DocumentRecord>, String> {
    connection
        .query_row(
            "
            SELECT id, title, kind, file_path, file_hash, created_at, updated_at, last_opened_at
            FROM documents
            WHERE id = ?1
            ",
            [document_id],
            map_document_record,
        )
        .optional()
        .map_err(|error| format!("Nao foi possivel carregar documento: {error}"))
}

fn map_document_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<DocumentRecord> {
    Ok(DocumentRecord {
        id: row.get(0)?,
        title: row.get(1)?,
        kind: row.get(2)?,
        file_path: row.get(3)?,
        file_hash: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        last_opened_at: row.get(7)?,
    })
}

fn map_reading_position(row: &rusqlite::Row<'_>) -> rusqlite::Result<ReadingPosition> {
    Ok(ReadingPosition {
        document_id: row.get(0)?,
        locator_type: row.get(1)?,
        locator: row.get(2)?,
        page_index: row.get(3)?,
        scroll_x: row.get(4)?,
        scroll_y: row.get(5)?,
        zoom: row.get(6)?,
        progress: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    struct TestPaths {
        root: PathBuf,
        db_path: PathBuf,
        pdf_path: PathBuf,
    }

    fn test_paths() -> TestPaths {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("shiori-documents-test-{suffix}"));
        fs::create_dir_all(&root).unwrap();
        let pdf_path = root.join("sample.pdf");
        fs::write(&pdf_path, b"%PDF-1.4\nsample").unwrap();

        TestPaths {
            db_path: root.join("shiori.sqlite3"),
            root,
            pdf_path,
        }
    }

    #[test]
    fn opens_document_and_lists_recent_documents() {
        let paths = test_paths();
        db::initialize_database(&paths.db_path).unwrap();

        let document =
            open_document_record(&paths.db_path, paths.pdf_path.to_string_lossy().to_string())
                .unwrap();
        let recent = list_recent_documents(&paths.db_path, Some(10)).unwrap();

        assert_eq!(document.title, "sample");
        assert_eq!(document.kind, "pdf");
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].id, document.id);
        let _ = fs::remove_dir_all(paths.root);
    }

    #[test]
    fn saves_and_loads_reading_position() {
        let paths = test_paths();
        db::initialize_database(&paths.db_path).unwrap();

        let document =
            open_document_record(&paths.db_path, paths.pdf_path.to_string_lossy().to_string())
                .unwrap();
        let saved = save_reading_position(
            &paths.db_path,
            SaveReadingPositionInput {
                document_id: document.id.clone(),
                locator_type: "pdf_page".to_string(),
                locator: "12".to_string(),
                page_index: Some(11),
                scroll_x: 0.0,
                scroll_y: 250.0,
                zoom: 1.25,
                progress: 0.42,
            },
        )
        .unwrap();
        let loaded = get_reading_position(&paths.db_path, document.id)
            .unwrap()
            .unwrap();

        assert_eq!(saved.locator, "12");
        assert_eq!(loaded.page_index, Some(11));
        assert_eq!(loaded.zoom, 1.25);
        let _ = fs::remove_dir_all(paths.root);
    }

    #[test]
    fn reads_supported_document_bytes() {
        let paths = test_paths();

        let bytes = read_document_bytes(paths.pdf_path.to_string_lossy().to_string()).unwrap();

        assert!(bytes.starts_with(b"%PDF"));
        let _ = fs::remove_dir_all(paths.root);
    }
}
