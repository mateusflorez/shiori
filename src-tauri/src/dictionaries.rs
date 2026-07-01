use crate::db;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Cursor, Read, Seek},
    path::{Path, PathBuf},
    time::Duration,
};
use zip::ZipArchive;

const MAX_LOOKUP_QUERY_CHARS: usize = 48;
const MAX_LOOKUP_PREFIX_CHARS: usize = 24;
const MAX_LOOKUP_RESULTS: usize = 24;
const IMPORT_PROGRESS_BATCH_SIZE: u64 = 1_000;

struct RecommendedDictionary {
    key: &'static str,
    url: &'static str,
    fallback_name: &'static str,
}

const RECOMMENDED_DICTIONARIES: &[RecommendedDictionary] = &[
    RecommendedDictionary {
        key: "jitendex",
        url: "https://github.com/stephenmk/stephenmk.github.io/releases/latest/download/jitendex-yomitan.zip",
        fallback_name: "Jitendex",
    },
    RecommendedDictionary {
        key: "kanjidic",
        url: "https://github.com/yomidevs/jmdict-yomitan/releases/latest/download/kanjidic_english.zip",
        fallback_name: "KANJIDIC",
    },
    RecommendedDictionary {
        key: "jiten",
        url: "https://api.jiten.moe/api/frequency-list/download?downloadType=yomitan",
        fallback_name: "Jiten",
    },
];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionarySourceRecord {
    id: String,
    name: String,
    format: String,
    revision: Option<String>,
    enabled: bool,
    priority: i64,
    imported_at: String,
    term_count: i64,
    kanji_count: i64,
    meta_count: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDictionaryResult {
    source: DictionarySourceRecord,
    term_count: usize,
    kanji_count: usize,
    meta_count: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryDownloadProgress {
    key: String,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    progress: Option<f64>,
    phase: String,
    imported_rows: Option<u64>,
    total_rows: Option<u64>,
    stage: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LookupTermInput {
    query: String,
    document_id: Option<String>,
    sentence: Option<String>,
    selected_text: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LookupResult {
    query: String,
    matched_text: String,
    terms: Vec<LookupTermEntry>,
    kanji: Vec<LookupKanjiEntry>,
    frequencies: Vec<LookupFrequencyEntry>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LookupTermEntry {
    id: String,
    source_id: String,
    source_name: String,
    expression: String,
    reading: Option<String>,
    score: Option<i64>,
    sequence: Option<i64>,
    definition_tags: Vec<String>,
    term_tags: Vec<String>,
    glossary: Vec<String>,
    raw_json: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LookupKanjiEntry {
    id: String,
    source_id: String,
    source_name: String,
    character: String,
    onyomi: Vec<String>,
    kunyomi: Vec<String>,
    tags: Vec<String>,
    meanings: Vec<String>,
    stats: Value,
    raw_json: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LookupFrequencyEntry {
    id: String,
    source_id: String,
    source_name: String,
    expression: String,
    reading: Option<String>,
    display_value: String,
    sort_value: Option<f64>,
    raw_json: String,
}

#[derive(Clone, Debug)]
struct TermRow {
    id: String,
    source_id: String,
    source_name: String,
    expression: String,
    reading: Option<String>,
    score: Option<i64>,
    sequence: Option<i64>,
    term_json: String,
}

pub fn import_yomitan_dictionary(
    db_path: &Path,
    file_path: String,
) -> Result<ImportDictionaryResult, String> {
    let dictionary_path = normalize_zip_path(&file_path)?;
    let file = File::open(&dictionary_path)
        .map_err(|error| format!("Nao foi possivel abrir dicionario: {error}"))?;
    let fallback_name = dictionary_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Dicionario Yomitan");

    let mut noop_progress = |_progress: DictionaryDownloadProgress| {};
    import_yomitan_archive(db_path, file, fallback_name, None, &mut noop_progress)
}

pub fn download_recommended_dictionary(
    db_path: &Path,
    key: String,
    mut on_progress: impl FnMut(DictionaryDownloadProgress),
) -> Result<ImportDictionaryResult, String> {
    let key = key.trim();
    let dictionary = RECOMMENDED_DICTIONARIES
        .iter()
        .find(|dictionary| dictionary.key == key)
        .ok_or_else(|| "Dicionario recomendado desconhecido.".to_string())?;
    on_progress(download_progress(key, 0, None, "starting"));
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|error| format!("Nao foi possivel preparar download: {error}"))?;
    let response = client
        .get(dictionary.url)
        .header(reqwest::header::USER_AGENT, "Shiori/0.1")
        .send()
        .map_err(|error| format!("Nao foi possivel baixar dicionario: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download de {} falhou com status {}.",
            dictionary.fallback_name,
            response.status()
        ));
    }

    let total_bytes = response.content_length();
    let bytes = read_response_bytes(response, key, total_bytes, &mut on_progress)?;
    let downloaded_bytes = bytes.len() as u64;
    on_progress(download_progress(
        key,
        downloaded_bytes,
        total_bytes,
        "importing",
    ));
    let result = import_yomitan_archive(
        db_path,
        Cursor::new(bytes),
        dictionary.fallback_name,
        Some(key),
        &mut on_progress,
    )?;
    on_progress(download_progress(
        key,
        downloaded_bytes,
        total_bytes,
        "done",
    ));

    Ok(result)
}

fn read_response_bytes(
    mut response: reqwest::blocking::Response,
    key: &str,
    total_bytes: Option<u64>,
    on_progress: &mut impl FnMut(DictionaryDownloadProgress),
) -> Result<Vec<u8>, String> {
    let mut bytes =
        Vec::with_capacity(total_bytes.unwrap_or_default().min(64 * 1024 * 1024) as usize);
    let mut buffer = [0_u8; 64 * 1024];
    let mut downloaded_bytes = 0_u64;
    let mut last_emitted_bytes = 0_u64;

    loop {
        let read = response
            .read(&mut buffer)
            .map_err(|error| format!("Nao foi possivel ler download do dicionario: {error}"))?;
        if read == 0 {
            break;
        }

        bytes.extend_from_slice(&buffer[..read]);
        downloaded_bytes += read as u64;

        if downloaded_bytes.saturating_sub(last_emitted_bytes) >= 256 * 1024 {
            last_emitted_bytes = downloaded_bytes;
            on_progress(download_progress(
                key,
                downloaded_bytes,
                total_bytes,
                "downloading",
            ));
        }
    }

    on_progress(download_progress(
        key,
        downloaded_bytes,
        total_bytes,
        "downloading",
    ));

    Ok(bytes)
}

fn download_progress(
    key: &str,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    phase: &str,
) -> DictionaryDownloadProgress {
    let progress = total_bytes
        .filter(|total| *total > 0)
        .map(|total| (downloaded_bytes as f64 / total as f64).clamp(0.0, 1.0));

    DictionaryDownloadProgress {
        key: key.to_string(),
        downloaded_bytes,
        total_bytes,
        progress,
        phase: phase.to_string(),
        imported_rows: None,
        total_rows: None,
        stage: None,
    }
}

fn import_progress(
    key: &str,
    imported_rows: u64,
    total_rows: u64,
    stage: &str,
) -> DictionaryDownloadProgress {
    let progress = if total_rows > 0 {
        Some((imported_rows as f64 / total_rows as f64).clamp(0.0, 1.0))
    } else {
        None
    };

    DictionaryDownloadProgress {
        key: key.to_string(),
        downloaded_bytes: 0,
        total_bytes: None,
        progress,
        phase: "importing".to_string(),
        imported_rows: Some(imported_rows),
        total_rows: Some(total_rows),
        stage: Some(stage.to_string()),
    }
}

fn emit_import_progress(
    progress_key: Option<&str>,
    on_progress: &mut impl FnMut(DictionaryDownloadProgress),
    imported_rows: u64,
    total_rows: u64,
    stage: &str,
) {
    if let Some(key) = progress_key {
        on_progress(import_progress(key, imported_rows, total_rows, stage));
    }
}

fn maybe_emit_import_progress(
    progress_key: Option<&str>,
    on_progress: &mut impl FnMut(DictionaryDownloadProgress),
    imported_rows: u64,
    total_rows: u64,
    last_emitted_rows: &mut u64,
    stage: &str,
) {
    if imported_rows.saturating_sub(*last_emitted_rows) < IMPORT_PROGRESS_BATCH_SIZE
        && imported_rows < total_rows
    {
        return;
    }

    *last_emitted_rows = imported_rows;
    emit_import_progress(progress_key, on_progress, imported_rows, total_rows, stage);
}

fn count_import_rows<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    progress_key: Option<&str>,
    on_progress: &mut impl FnMut(DictionaryDownloadProgress),
    term_bank_names: &[String],
    kanji_bank_names: &[String],
    meta_bank_names: &[String],
) -> Result<u64, String> {
    let total_banks =
        (term_bank_names.len() + kanji_bank_names.len() + meta_bank_names.len()) as u64;
    let mut counted_banks = 0;
    let mut total_rows = 0;

    emit_import_progress(
        progress_key,
        on_progress,
        counted_banks,
        total_banks,
        "Preparando importacao",
    );

    total_rows += count_bank_rows(
        archive,
        progress_key,
        on_progress,
        term_bank_names,
        &mut counted_banks,
        total_banks,
        "Preparando termos",
    )?;
    total_rows += count_bank_rows(
        archive,
        progress_key,
        on_progress,
        kanji_bank_names,
        &mut counted_banks,
        total_banks,
        "Preparando kanji",
    )?;
    total_rows += count_bank_rows(
        archive,
        progress_key,
        on_progress,
        meta_bank_names,
        &mut counted_banks,
        total_banks,
        "Preparando frequencias",
    )?;

    Ok(total_rows)
}

fn count_bank_rows<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    progress_key: Option<&str>,
    on_progress: &mut impl FnMut(DictionaryDownloadProgress),
    bank_names: &[String],
    counted_banks: &mut u64,
    total_banks: u64,
    stage: &str,
) -> Result<u64, String> {
    let mut total_rows = 0;

    for bank_name in bank_names {
        let rows = read_zip_json(archive, bank_name)?;
        total_rows += rows.as_array().map(|items| items.len() as u64).unwrap_or(0);
        *counted_banks += 1;
        emit_import_progress(
            progress_key,
            on_progress,
            *counted_banks,
            total_banks,
            stage,
        );
    }

    Ok(total_rows)
}

fn import_yomitan_archive<R: Read + Seek>(
    db_path: &Path,
    reader: R,
    fallback_name: &str,
    progress_key: Option<&str>,
    on_progress: &mut impl FnMut(DictionaryDownloadProgress),
) -> Result<ImportDictionaryResult, String> {
    let mut archive =
        ZipArchive::new(reader).map_err(|error| format!("ZIP de dicionario invalido: {error}"))?;
    let index_json = read_zip_json(&mut archive, "index.json")?;
    let source_name =
        string_field(&index_json, "title").unwrap_or_else(|| fallback_name.to_string());
    let revision = string_field(&index_json, "revision");
    let format = string_field(&index_json, "format").unwrap_or_else(|| "yomitan".to_string());
    let source_id = stable_id(
        "dictionary-source",
        &[
            &source_name,
            revision.as_deref().unwrap_or_default(),
            &db::now_timestamp(),
        ],
    );
    let file_names = archive_file_names(&mut archive);
    let term_bank_names = matching_bank_names(&file_names, "term_bank_");
    let kanji_bank_names = matching_bank_names(&file_names, "kanji_bank_");
    let meta_bank_names = matching_bank_names(&file_names, "term_meta_bank_");
    let import_total_rows = count_import_rows(
        &mut archive,
        progress_key,
        on_progress,
        &term_bank_names,
        &kanji_bank_names,
        &meta_bank_names,
    )?;
    let mut processed_rows = 0_u64;
    let mut last_emitted_rows = 0_u64;

    let connection = db::open_connection(db_path)?;
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| format!("Nao foi possivel iniciar importacao: {error}"))?;
    transaction
        .execute(
            "DELETE FROM dictionary_sources WHERE name = ?1 AND format = ?2",
            params![source_name, format],
        )
        .map_err(|error| format!("Nao foi possivel substituir dicionario antigo: {error}"))?;

    let imported_at = db::now_timestamp();
    transaction
        .execute(
            "
            INSERT INTO dictionary_sources (id, name, format, revision, enabled, priority, imported_at)
            VALUES (?1, ?2, ?3, ?4, 1, 100, ?5)
            ",
            params![source_id, source_name, format, revision, imported_at],
        )
        .map_err(|error| format!("Nao foi possivel registrar fonte do dicionario: {error}"))?;

    let mut term_count = 0;
    let mut kanji_count = 0;
    let mut meta_count = 0;

    {
        let mut statement = transaction
            .prepare(
                "
                INSERT INTO dictionary_terms (id, source_id, expression, reading, sequence, score, term_json)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                ",
            )
            .map_err(|error| format!("Nao foi possivel preparar termos: {error}"))?;

        emit_import_progress(
            progress_key,
            on_progress,
            processed_rows,
            import_total_rows,
            "Importando termos",
        );

        for bank_name in &term_bank_names {
            let rows = read_zip_json(&mut archive, bank_name)?;
            let Some(row_values) = rows.as_array() else {
                continue;
            };

            for (index, row) in row_values.iter().enumerate() {
                processed_rows += 1;
                maybe_emit_import_progress(
                    progress_key,
                    on_progress,
                    processed_rows,
                    import_total_rows,
                    &mut last_emitted_rows,
                    "Importando termos",
                );

                let Some(items) = row.as_array() else {
                    continue;
                };
                let Some(expression) = items.first().and_then(Value::as_str).map(str::trim) else {
                    continue;
                };
                if expression.is_empty() {
                    continue;
                }

                let reading = items
                    .get(1)
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty());
                let score = items.get(4).and_then(Value::as_i64);
                let sequence = items.get(6).and_then(Value::as_i64);
                let id = stable_id(
                    "term",
                    &[
                        &source_id,
                        bank_name.as_str(),
                        &index.to_string(),
                        expression,
                    ],
                );
                statement
                    .execute(params![
                        id,
                        source_id,
                        expression,
                        reading,
                        sequence,
                        score,
                        row.to_string()
                    ])
                    .map_err(|error| format!("Nao foi possivel importar termo: {error}"))?;
                term_count += 1;
            }
        }
    }

    {
        let mut statement = transaction
            .prepare(
                "
                INSERT INTO dictionary_kanji (
                  id, source_id, character, onyomi, kunyomi, tags, meanings_json, stats_json, kanji_json
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                ",
            )
            .map_err(|error| format!("Nao foi possivel preparar kanji: {error}"))?;

        emit_import_progress(
            progress_key,
            on_progress,
            processed_rows,
            import_total_rows,
            "Importando kanji",
        );

        for bank_name in &kanji_bank_names {
            let rows = read_zip_json(&mut archive, bank_name)?;
            let Some(row_values) = rows.as_array() else {
                continue;
            };

            for (index, row) in row_values.iter().enumerate() {
                processed_rows += 1;
                maybe_emit_import_progress(
                    progress_key,
                    on_progress,
                    processed_rows,
                    import_total_rows,
                    &mut last_emitted_rows,
                    "Importando kanji",
                );

                let Some(items) = row.as_array() else {
                    continue;
                };
                let Some(character) = items.first().and_then(Value::as_str).map(str::trim) else {
                    continue;
                };
                if character.is_empty() {
                    continue;
                }

                let meanings = items.get(4).cloned().unwrap_or(Value::Array(Vec::new()));
                let stats = items
                    .get(5)
                    .cloned()
                    .unwrap_or(Value::Object(Default::default()));
                let id = stable_id(
                    "kanji",
                    &[
                        &source_id,
                        bank_name.as_str(),
                        &index.to_string(),
                        character,
                    ],
                );
                statement
                    .execute(params![
                        id,
                        source_id,
                        character,
                        value_to_space_joined(items.get(1)),
                        value_to_space_joined(items.get(2)),
                        value_to_space_joined(items.get(3)),
                        meanings.to_string(),
                        stats.to_string(),
                        row.to_string()
                    ])
                    .map_err(|error| format!("Nao foi possivel importar kanji: {error}"))?;
                kanji_count += 1;
            }
        }
    }

    {
        let mut statement = transaction
            .prepare(
                "
                INSERT INTO dictionary_term_meta (id, source_id, expression, reading, mode, data_json, meta_json)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                ",
            )
            .map_err(|error| format!("Nao foi possivel preparar metadados: {error}"))?;

        emit_import_progress(
            progress_key,
            on_progress,
            processed_rows,
            import_total_rows,
            "Importando frequencias",
        );

        for bank_name in &meta_bank_names {
            let rows = read_zip_json(&mut archive, bank_name)?;
            let Some(row_values) = rows.as_array() else {
                continue;
            };

            for (index, row) in row_values.iter().enumerate() {
                processed_rows += 1;
                maybe_emit_import_progress(
                    progress_key,
                    on_progress,
                    processed_rows,
                    import_total_rows,
                    &mut last_emitted_rows,
                    "Importando frequencias",
                );

                let Some(items) = row.as_array() else {
                    continue;
                };
                let Some(expression) = items.first().and_then(Value::as_str).map(str::trim) else {
                    continue;
                };
                if expression.is_empty() {
                    continue;
                }

                let (reading, mode, data) = parse_meta_bank_row(items);
                let Some(mode) = mode else {
                    continue;
                };
                let data = data.cloned().unwrap_or(Value::Null);
                let id = stable_id(
                    "term-meta",
                    &[
                        &source_id,
                        bank_name.as_str(),
                        &index.to_string(),
                        expression,
                        mode,
                    ],
                );
                statement
                    .execute(params![
                        id,
                        source_id,
                        expression,
                        reading,
                        mode,
                        data.to_string(),
                        row.to_string()
                    ])
                    .map_err(|error| format!("Nao foi possivel importar metadados: {error}"))?;
                meta_count += 1;
            }
        }
    }

    emit_import_progress(
        progress_key,
        on_progress,
        import_total_rows,
        import_total_rows,
        "Finalizando importacao",
    );

    transaction
        .commit()
        .map_err(|error| format!("Nao foi possivel finalizar importacao: {error}"))?;

    let source = get_dictionary_source(db_path, source_id)?
        .ok_or_else(|| "Dicionario importado, mas nao encontrado no banco local.".to_string())?;

    Ok(ImportDictionaryResult {
        source,
        term_count,
        kanji_count,
        meta_count,
    })
}

pub fn list_dictionary_sources(db_path: &Path) -> Result<Vec<DictionarySourceRecord>, String> {
    let connection = db::open_connection(db_path)?;
    let mut statement = connection
        .prepare(
            "
            SELECT
              s.id,
              s.name,
              s.format,
              s.revision,
              s.enabled,
              s.priority,
              s.imported_at,
              (SELECT COUNT(*) FROM dictionary_terms t WHERE t.source_id = s.id) AS term_count,
              (SELECT COUNT(*) FROM dictionary_kanji k WHERE k.source_id = s.id) AS kanji_count,
              (SELECT COUNT(*) FROM dictionary_term_meta m WHERE m.source_id = s.id) AS meta_count
            FROM dictionary_sources s
            ORDER BY s.priority ASC, s.imported_at DESC, s.name ASC
            ",
        )
        .map_err(|error| format!("Nao foi possivel listar dicionarios: {error}"))?;

    let rows = statement
        .query_map([], map_dictionary_source)
        .map_err(|error| format!("Nao foi possivel consultar dicionarios: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Nao foi possivel ler dicionarios: {error}"))
}

pub fn lookup_term(db_path: &Path, input: LookupTermInput) -> Result<LookupResult, String> {
    let query = normalize_lookup_query(&input.query)?;
    let connection = db::open_connection(db_path)?;
    let terms = lookup_terms(&connection, &query)?;
    let matched_text = terms
        .first()
        .map(|term| term.expression.clone())
        .unwrap_or_else(|| query.clone());
    let kanji = lookup_kanji_entries(&connection, &query)?;
    let frequencies = lookup_frequency_entries(&connection, &terms, &query)?;

    if !terms.is_empty() || !kanji.is_empty() {
        save_lookup_history(&connection, &input, &matched_text)?;
    }

    Ok(LookupResult {
        query,
        matched_text,
        terms,
        kanji,
        frequencies,
    })
}

fn lookup_terms(connection: &Connection, query: &str) -> Result<Vec<LookupTermEntry>, String> {
    let candidates = lookup_candidates(query);

    for candidate in candidates {
        let rows = select_term_rows(connection, &candidate)?;
        if rows.is_empty() {
            continue;
        }

        return rows
            .into_iter()
            .map(term_row_to_lookup_entry)
            .collect::<Result<Vec<_>, _>>();
    }

    Ok(Vec::new())
}

fn select_term_rows(connection: &Connection, candidate: &str) -> Result<Vec<TermRow>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT t.id, t.source_id, s.name, t.expression, t.reading, t.score, t.sequence, t.term_json
            FROM dictionary_terms t
            JOIN dictionary_sources s ON s.id = t.source_id
            WHERE s.enabled = 1
              AND (t.expression = ?1 OR t.reading = ?1)
            ORDER BY s.priority ASC, COALESCE(t.score, 0) DESC, s.name ASC
            LIMIT ?2
            ",
        )
        .map_err(|error| format!("Nao foi possivel preparar lookup: {error}"))?;
    let rows = statement
        .query_map(params![candidate, MAX_LOOKUP_RESULTS as i64], |row| {
            Ok(TermRow {
                id: row.get(0)?,
                source_id: row.get(1)?,
                source_name: row.get(2)?,
                expression: row.get(3)?,
                reading: row.get(4)?,
                score: row.get(5)?,
                sequence: row.get(6)?,
                term_json: row.get(7)?,
            })
        })
        .map_err(|error| format!("Nao foi possivel consultar termos: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Nao foi possivel ler termos: {error}"))
}

fn term_row_to_lookup_entry(row: TermRow) -> Result<LookupTermEntry, String> {
    let value: Value = serde_json::from_str(&row.term_json)
        .map_err(|error| format!("Nao foi possivel ler JSON do termo: {error}"))?;
    let items = value.as_array();
    let definition_tags = tags_from_value(items.and_then(|items| items.get(2)));
    let glossary = glossary_from_value(items.and_then(|items| items.get(5)));
    let term_tags = tags_from_value(items.and_then(|items| items.get(7)));

    Ok(LookupTermEntry {
        id: row.id,
        source_id: row.source_id,
        source_name: row.source_name,
        expression: row.expression,
        reading: row.reading,
        score: row.score,
        sequence: row.sequence,
        definition_tags,
        term_tags,
        glossary,
        raw_json: row.term_json,
    })
}

fn lookup_kanji_entries(
    connection: &Connection,
    query: &str,
) -> Result<Vec<LookupKanjiEntry>, String> {
    let characters = unique_kanji(query);
    if characters.is_empty() {
        return Ok(Vec::new());
    }

    let mut output = Vec::new();
    let mut statement = connection
        .prepare(
            "
            SELECT k.id, k.source_id, s.name, k.character, k.onyomi, k.kunyomi, k.tags,
              k.meanings_json, k.stats_json, k.kanji_json
            FROM dictionary_kanji k
            JOIN dictionary_sources s ON s.id = k.source_id
            WHERE s.enabled = 1
              AND k.character = ?1
            ORDER BY s.priority ASC, s.name ASC
            LIMIT 8
            ",
        )
        .map_err(|error| format!("Nao foi possivel preparar lookup de kanji: {error}"))?;

    for character in characters {
        let rows = statement
            .query_map([character.to_string()], |row| {
                let meanings_json: String = row.get(7)?;
                let stats_json: String = row.get(8)?;

                Ok(LookupKanjiEntry {
                    id: row.get(0)?,
                    source_id: row.get(1)?,
                    source_name: row.get(2)?,
                    character: row.get(3)?,
                    onyomi: split_whitespace(row.get::<_, Option<String>>(4)?.as_deref()),
                    kunyomi: split_whitespace(row.get::<_, Option<String>>(5)?.as_deref()),
                    tags: split_whitespace(row.get::<_, Option<String>>(6)?.as_deref()),
                    meanings: string_list_from_json(&meanings_json),
                    stats: serde_json::from_str(&stats_json).unwrap_or(Value::Null),
                    raw_json: row.get(9)?,
                })
            })
            .map_err(|error| format!("Nao foi possivel consultar kanji: {error}"))?;

        output.extend(
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("Nao foi possivel ler kanji: {error}"))?,
        );
    }

    Ok(output)
}

fn lookup_frequency_entries(
    connection: &Connection,
    terms: &[LookupTermEntry],
    query: &str,
) -> Result<Vec<LookupFrequencyEntry>, String> {
    let mut expressions = terms
        .iter()
        .flat_map(|term| [Some(term.expression.as_str()), term.reading.as_deref()])
        .flatten()
        .map(str::to_string)
        .collect::<Vec<_>>();
    expressions.push(query.to_string());
    expressions.sort();
    expressions.dedup();

    let mut output = Vec::new();
    let mut statement = connection
        .prepare(
            "
            SELECT m.id, m.source_id, s.name, m.expression, m.reading, m.data_json, m.meta_json
            FROM dictionary_term_meta m
            JOIN dictionary_sources s ON s.id = m.source_id
            WHERE s.enabled = 1
              AND m.mode = 'freq'
              AND m.expression = ?1
            ORDER BY s.priority ASC, s.name ASC
            LIMIT 12
            ",
        )
        .map_err(|error| format!("Nao foi possivel preparar frequencia: {error}"))?;

    for expression in expressions {
        let rows = statement
            .query_map([expression], |row| {
                let data_json: String = row.get(5)?;
                let data: Value = serde_json::from_str(&data_json).unwrap_or(Value::Null);
                let (display_value, sort_value) = frequency_display(&data);

                Ok(LookupFrequencyEntry {
                    id: row.get(0)?,
                    source_id: row.get(1)?,
                    source_name: row.get(2)?,
                    expression: row.get(3)?,
                    reading: row.get(4)?,
                    display_value,
                    sort_value,
                    raw_json: row.get(6)?,
                })
            })
            .map_err(|error| format!("Nao foi possivel consultar frequencia: {error}"))?;
        output.extend(
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("Nao foi possivel ler frequencia: {error}"))?,
        );
    }

    output.sort_by(|left, right| {
        left.sort_value
            .partial_cmp(&right.sort_value)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    output.truncate(16);

    Ok(output)
}

fn save_lookup_history(
    connection: &Connection,
    input: &LookupTermInput,
    expression: &str,
) -> Result<(), String> {
    let id = stable_id("lookup-history", &[expression, &db::now_timestamp()]);
    connection
        .execute(
            "
            INSERT INTO lookup_history (id, document_id, expression, sentence, selected_text, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ",
            params![
                id,
                input.document_id.as_deref().map(str::trim).filter(|value| !value.is_empty()),
                expression,
                input.sentence.as_deref().map(str::trim).filter(|value| !value.is_empty()),
                input.selected_text.as_deref().map(str::trim).filter(|value| !value.is_empty()),
                db::now_timestamp()
            ],
        )
        .map(|_| ())
        .map_err(|error| format!("Nao foi possivel salvar historico de lookup: {error}"))
}

fn get_dictionary_source(
    db_path: &Path,
    source_id: String,
) -> Result<Option<DictionarySourceRecord>, String> {
    let connection = db::open_connection(db_path)?;
    connection
        .query_row(
            "
            SELECT
              s.id,
              s.name,
              s.format,
              s.revision,
              s.enabled,
              s.priority,
              s.imported_at,
              (SELECT COUNT(*) FROM dictionary_terms t WHERE t.source_id = s.id) AS term_count,
              (SELECT COUNT(*) FROM dictionary_kanji k WHERE k.source_id = s.id) AS kanji_count,
              (SELECT COUNT(*) FROM dictionary_term_meta m WHERE m.source_id = s.id) AS meta_count
            FROM dictionary_sources s
            WHERE s.id = ?1
            ",
            [source_id],
            map_dictionary_source,
        )
        .optional()
        .map_err(|error| format!("Nao foi possivel carregar dicionario: {error}"))
}

fn map_dictionary_source(row: &rusqlite::Row<'_>) -> rusqlite::Result<DictionarySourceRecord> {
    let enabled: i64 = row.get(4)?;

    Ok(DictionarySourceRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        format: row.get(2)?,
        revision: row.get(3)?,
        enabled: enabled != 0,
        priority: row.get(5)?,
        imported_at: row.get(6)?,
        term_count: row.get(7)?,
        kanji_count: row.get(8)?,
        meta_count: row.get(9)?,
    })
}

fn normalize_zip_path(file_path: &str) -> Result<PathBuf, String> {
    let trimmed_path = file_path.trim();
    if trimmed_path.is_empty() {
        return Err("Informe o caminho de um ZIP Yomitan.".to_string());
    }

    let path = PathBuf::from(trimmed_path);
    if !path.exists() {
        return Err("Arquivo de dicionario nao encontrado.".to_string());
    }

    if !path.is_file() {
        return Err("O caminho do dicionario nao aponta para um arquivo.".to_string());
    }

    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if extension != "zip" {
        return Err("Importe um dicionario Yomitan em formato .zip.".to_string());
    }

    path.canonicalize()
        .map_err(|error| format!("Nao foi possivel normalizar caminho do dicionario: {error}"))
}

fn read_zip_json<R: Read + Seek>(archive: &mut ZipArchive<R>, name: &str) -> Result<Value, String> {
    let mut file = archive
        .by_name(name)
        .map_err(|error| format!("Nao foi possivel abrir {name} no ZIP: {error}"))?;
    let mut contents = String::new();
    file.read_to_string(&mut contents)
        .map_err(|error| format!("Nao foi possivel ler {name}: {error}"))?;

    serde_json::from_str(&contents)
        .map_err(|error| format!("{name} nao contem JSON valido: {error}"))
}

fn archive_file_names<R: Read + Seek>(archive: &mut ZipArchive<R>) -> Vec<String> {
    (0..archive.len())
        .filter_map(|index| {
            archive
                .by_index(index)
                .ok()
                .map(|file| file.name().to_string())
        })
        .collect()
}

fn matching_bank_names(file_names: &[String], prefix: &str) -> Vec<String> {
    let mut names = file_names
        .iter()
        .filter(|name| {
            let base_name = name.rsplit('/').next().unwrap_or(name);

            base_name.starts_with(prefix) && base_name.ends_with(".json")
        })
        .cloned()
        .collect::<Vec<_>>();
    names.sort_by_key(|name| bank_number(name));
    names
}

fn bank_number(name: &str) -> usize {
    let base_name = name.rsplit('/').next().unwrap_or(name);
    base_name
        .chars()
        .filter(char::is_ascii_digit)
        .collect::<String>()
        .parse()
        .unwrap_or(0)
}

fn string_field(value: &Value, field: &str) -> Option<String> {
    value
        .get(field)
        .and_then(|value| match value {
            Value::String(text) => Some(text.trim().to_string()),
            Value::Number(number) => Some(number.to_string()),
            _ => None,
        })
        .filter(|value| !value.is_empty())
}

fn parse_meta_bank_row(items: &[Value]) -> (Option<&str>, Option<&str>, Option<&Value>) {
    if items.len() >= 4 {
        return (
            items.get(1).and_then(Value::as_str),
            items.get(2).and_then(Value::as_str),
            items.get(3),
        );
    }

    (None, items.get(1).and_then(Value::as_str), items.get(2))
}

fn value_to_space_joined(value: Option<&Value>) -> Option<String> {
    let output = match value {
        Some(Value::String(text)) => text.trim().to_string(),
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join(" "),
        _ => String::new(),
    };

    if output.is_empty() {
        None
    } else {
        Some(output)
    }
}

fn normalize_lookup_query(query: &str) -> Result<String, String> {
    let normalized = query
        .trim()
        .chars()
        .take(MAX_LOOKUP_QUERY_CHARS)
        .collect::<String>();
    if normalized.is_empty() {
        return Err("Informe um termo para lookup.".to_string());
    }

    let japanese = first_japanese_sequence(&normalized).unwrap_or(normalized);
    if japanese.trim().is_empty() {
        return Err("Clique em um termo japones para consultar.".to_string());
    }

    Ok(japanese)
}

fn first_japanese_sequence(query: &str) -> Option<String> {
    let mut output = String::new();
    let mut started = false;

    for character in query.chars() {
        if is_japanese_lookup_char(character) {
            output.push(character);
            started = true;
            continue;
        }

        if started {
            break;
        }
    }

    if output.is_empty() {
        None
    } else {
        Some(output)
    }
}

fn is_japanese_lookup_char(character: char) -> bool {
    matches!(
        character as u32,
        0x3040..=0x30ff | 0x3400..=0x9fff | 0xf900..=0xfaff
    ) || matches!(character, '々' | '〆' | 'ヵ' | 'ヶ' | 'ー')
}

fn is_kanji(character: char) -> bool {
    matches!(character as u32, 0x3400..=0x9fff | 0xf900..=0xfaff) || character == '々'
}

fn lookup_candidates(query: &str) -> Vec<String> {
    let characters = query.chars().collect::<Vec<_>>();
    let mut candidates = Vec::new();

    for start in 0..characters.len().min(6) {
        let max_len = (characters.len() - start).min(MAX_LOOKUP_PREFIX_CHARS);
        for length in (1..=max_len).rev() {
            candidates.push(
                characters
                    .iter()
                    .skip(start)
                    .take(length)
                    .collect::<String>(),
            );
        }
    }

    for candidate in candidates.clone() {
        for deinflected in deinflect_candidate(&candidate) {
            candidates.push(deinflected);
        }
    }

    candidates.sort_by_key(|candidate| std::cmp::Reverse(candidate.chars().count()));
    candidates.dedup();
    candidates
}

fn deinflect_candidate(candidate: &str) -> Vec<String> {
    let rules = [
        ("ました", "る"),
        ("ません", "る"),
        ("ます", "る"),
        ("ない", "る"),
        ("かった", "い"),
        ("くない", "い"),
        ("かった", "だ"),
        ("でした", "だ"),
        ("だった", "だ"),
    ];

    rules
        .iter()
        .filter_map(|(suffix, replacement)| {
            candidate
                .strip_suffix(suffix)
                .map(|stem| format!("{stem}{replacement}"))
        })
        .filter(|value| value != candidate)
        .collect()
}

fn unique_kanji(query: &str) -> Vec<char> {
    let mut output = query
        .chars()
        .filter(|character| is_kanji(*character))
        .collect::<Vec<_>>();
    output.sort();
    output.dedup();
    output
}

fn tags_from_value(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::String(text)) => split_whitespace(Some(text)),
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(Value::as_str)
            .flat_map(|text| split_whitespace(Some(text)))
            .collect(),
        _ => Vec::new(),
    }
}

fn split_whitespace(value: Option<&str>) -> Vec<String> {
    value
        .unwrap_or_default()
        .split_whitespace()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect()
}

fn glossary_from_value(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(items)) => items
            .iter()
            .flat_map(|item| glossary_text(item))
            .filter(|text| !text.is_empty())
            .collect(),
        Some(value) => glossary_text(value),
        None => Vec::new(),
    }
}

fn glossary_text(value: &Value) -> Vec<String> {
    match value {
        Value::String(text) => vec![text.trim().to_string()],
        Value::Number(number) => vec![number.to_string()],
        Value::Array(items) => items.iter().flat_map(glossary_text).collect(),
        Value::Object(object) => {
            let mut output = Vec::new();
            for key in ["text", "content", "data", "value"] {
                if let Some(value) = object.get(key) {
                    output.extend(glossary_text(value));
                }
            }
            output
        }
        _ => Vec::new(),
    }
}

fn string_list_from_json(json: &str) -> Vec<String> {
    let value = serde_json::from_str(json).unwrap_or(Value::Null);

    match value {
        Value::Array(items) => items
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect(),
        Value::String(text) => vec![text],
        _ => Vec::new(),
    }
}

fn frequency_display(value: &Value) -> (String, Option<f64>) {
    match value {
        Value::Number(number) => (number.to_string(), number.as_f64()),
        Value::String(text) => (text.clone(), text.parse::<f64>().ok()),
        Value::Array(items) => {
            let display = items
                .iter()
                .map(|item| frequency_display(item).0)
                .filter(|text| !text.is_empty())
                .collect::<Vec<_>>()
                .join(", ");
            let sort = items.iter().find_map(|item| frequency_display(item).1);

            (display, sort)
        }
        Value::Object(object) => {
            let display = object
                .get("displayValue")
                .or_else(|| object.get("display"))
                .or_else(|| object.get("frequency"))
                .or_else(|| object.get("value"))
                .map(|value| match value {
                    Value::String(text) => text.clone(),
                    Value::Number(number) => number.to_string(),
                    _ => value.to_string(),
                })
                .unwrap_or_else(|| value.to_string());
            let sort = object
                .get("frequency")
                .or_else(|| object.get("value"))
                .and_then(|value| match value {
                    Value::Number(number) => number.as_f64(),
                    Value::String(text) => text.parse::<f64>().ok(),
                    _ => None,
                });

            (display, sort)
        }
        _ => (String::new(), None),
    }
}

fn stable_id(prefix: &str, parts: &[&str]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(prefix.as_bytes());

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
    use rusqlite::params;
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    struct TestPaths {
        root: PathBuf,
        db_path: PathBuf,
    }

    fn test_paths() -> TestPaths {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("shiori-dictionaries-test-{suffix}"));
        fs::create_dir_all(&root).unwrap();
        let db_path = root.join("shiori.sqlite3");
        db::initialize_database(&db_path).unwrap();

        TestPaths { root, db_path }
    }

    fn seed_dictionary(db_path: &Path) {
        let connection = db::open_connection(db_path).unwrap();
        connection
            .execute(
                "
                INSERT INTO dictionary_sources (id, name, format, revision, enabled, priority, imported_at)
                VALUES ('src-1', 'Jitendex', 'yomitan', 'test', 1, 100, ?1)
                ",
                [db::now_timestamp()],
            )
            .unwrap();
        connection
            .execute(
                "
                INSERT INTO dictionary_terms (id, source_id, expression, reading, sequence, score, term_json)
                VALUES (?1, 'src-1', '済み', 'ずみ', 10, 5, ?2)
                ",
                params![
                    "term-1",
                    r#"["済み","ずみ","suffix","",5,["arranged","completed"],10,"noun"]"#
                ],
            )
            .unwrap();
        connection
            .execute(
                "
                INSERT INTO dictionary_kanji (
                  id, source_id, character, onyomi, kunyomi, tags, meanings_json, stats_json, kanji_json
                )
                VALUES ('kanji-1', 'src-1', '済', 'サイ', 'す.む', 'jouyou', ?1, ?2, ?3)
                ",
                params![
                    r#"["settle","relieve"]"#,
                    r#"{"frequency":168}"#,
                    r#"["済","サイ","す.む","jouyou",["settle","relieve"],{"frequency":168}]"#
                ],
            )
            .unwrap();
        connection
            .execute(
                "
                INSERT INTO dictionary_term_meta (id, source_id, expression, reading, mode, data_json, meta_json)
                VALUES ('freq-1', 'src-1', '済み', NULL, 'freq', ?1, ?2)
                ",
                params![r#"{"value":3455,"displayValue":"3455"}"#, r#"["済み","freq",{"value":3455}]"#],
            )
            .unwrap();
    }

    #[test]
    fn lookup_returns_terms_kanji_and_frequency() {
        let paths = test_paths();
        seed_dictionary(&paths.db_path);

        let result = lookup_term(
            &paths.db_path,
            LookupTermInput {
                query: "済みました".to_string(),
                document_id: None,
                sentence: None,
                selected_text: None,
            },
        )
        .unwrap();

        assert_eq!(result.terms[0].expression, "済み");
        assert_eq!(result.kanji[0].character, "済");
        assert_eq!(result.frequencies[0].display_value, "3455");
        let _ = fs::remove_dir_all(paths.root);
    }
}
