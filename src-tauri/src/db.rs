use chrono::{SecondsFormat, Utc};
use rusqlite::Connection;
use std::{
    fs,
    path::{Path, PathBuf},
};

const APP_DATA_DIR_NAME: &str = "Shiori";
const DB_FILE_NAME: &str = "shiori.sqlite3";

pub fn default_db_path() -> PathBuf {
    if let Some(app_data) = std::env::var_os("APPDATA") {
        return PathBuf::from(app_data)
            .join(APP_DATA_DIR_NAME)
            .join(DB_FILE_NAME);
    }

    PathBuf::from(APP_DATA_DIR_NAME).join(DB_FILE_NAME)
}

pub fn open_connection(db_path: &Path) -> Result<Connection, String> {
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Nao foi possivel criar pasta de dados: {error}"))?;
    }

    let connection = Connection::open(db_path)
        .map_err(|error| format!("Nao foi possivel abrir banco local: {error}"))?;
    connection
        .execute_batch(
            "
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;
            ",
        )
        .map_err(|error| format!("Nao foi possivel configurar banco local: {error}"))?;

    Ok(connection)
}

pub fn initialize_database(db_path: &Path) -> Result<(), String> {
    let connection = open_connection(db_path)?;

    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS schema_migrations (
              version INTEGER PRIMARY KEY,
              applied_at TEXT NOT NULL
            );
            ",
        )
        .map_err(|error| format!("Nao foi possivel preparar migracoes: {error}"))?;

    apply_migration(
        &connection,
        1,
        include_str!("../migrations/001_initial.sql"),
    )
}

fn apply_migration(connection: &Connection, version: i64, sql: &str) -> Result<(), String> {
    let already_applied: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = ?1)",
            [version],
            |row| row.get(0),
        )
        .map_err(|error| format!("Nao foi possivel consultar migracoes: {error}"))?;

    if already_applied {
        return Ok(());
    }

    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| format!("Nao foi possivel iniciar migracao: {error}"))?;
    transaction
        .execute_batch(sql)
        .map_err(|error| format!("Nao foi possivel aplicar migracao {version}: {error}"))?;
    transaction
        .execute(
            "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
            (version, now_timestamp()),
        )
        .map_err(|error| format!("Nao foi possivel registrar migracao {version}: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Nao foi possivel finalizar migracao {version}: {error}"))
}

pub fn now_timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_db_path() -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir()
            .join(format!("shiori-db-test-{suffix}"))
            .join(DB_FILE_NAME)
    }

    #[test]
    fn initializes_database_with_first_migration() {
        let path = temp_db_path();

        initialize_database(&path).unwrap();

        let connection = open_connection(&path).unwrap();
        let migration_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        let documents_exists: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'documents')",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(migration_count, 1);
        assert!(documents_exists);
    }
}
