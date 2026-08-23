use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::env;
use std::fs::File;
use std::io::{self, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use walkdir::WalkDir;

const HASH_BUFFER_BYTES: usize = 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ScanRequest {
    root: PathBuf,
    extensions: Vec<String>,
    #[serde(default)]
    hash_files: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileRecord {
    path: PathBuf,
    name: String,
    stem: String,
    extension: String,
    size: u64,
    modified_ns: Option<u128>,
    sha256: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanResponse {
    version: u8,
    files: Vec<FileRecord>,
}

fn normalized_extension(value: &str) -> String {
    let extension = value.trim().trim_start_matches('.').to_lowercase();
    if extension.is_empty() {
        String::new()
    } else {
        format!(".{extension}")
    }
}

fn sha256(path: &Path) -> io::Result<String> {
    let file = File::open(path)?;
    let mut reader = BufReader::with_capacity(HASH_BUFFER_BYTES, file);
    let mut digest = Sha256::new();
    let mut buffer = vec![0_u8; HASH_BUFFER_BYTES];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn file_record(path: PathBuf, hash_files: bool) -> io::Result<FileRecord> {
    let metadata = path.metadata()?;
    let modified_ns = metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos());
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default();
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default();
    let extension = path
        .extension()
        .map(|value| normalized_extension(&value.to_string_lossy()))
        .unwrap_or_default();
    Ok(FileRecord {
        sha256: hash_files.then(|| sha256(&path)).transpose()?,
        path,
        name,
        stem,
        extension,
        size: metadata.len(),
        modified_ns,
    })
}

fn scan(request: ScanRequest) -> Result<ScanResponse, String> {
    if !request.root.is_dir() {
        return Err("scan root is not a directory".to_owned());
    }
    let extensions: HashSet<String> = request
        .extensions
        .iter()
        .map(|value| normalized_extension(value))
        .filter(|value| !value.is_empty())
        .collect();
    if extensions.is_empty() {
        return Err("at least one extension is required".to_owned());
    }

    let paths: Vec<PathBuf> = WalkDir::new(&request.root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .map(|entry| entry.into_path())
        .filter(|path| {
            path.extension()
                .map(|value| extensions.contains(&normalized_extension(&value.to_string_lossy())))
                .unwrap_or(false)
        })
        .collect();

    let records: Result<Vec<_>, _> = paths
        .into_par_iter()
        .map(|path| file_record(path, request.hash_files))
        .collect();
    let mut files = records.map_err(|error| format!("failed to inspect asset: {error}"))?;
    files.sort_by_cached_key(|file| file.path.to_string_lossy().to_lowercase());
    Ok(ScanResponse { version: 1, files })
}

fn run() -> Result<(), String> {
    let mut args = env::args().skip(1);
    if args.next().as_deref() != Some("scan") || args.next().is_some() {
        return Err("usage: hikari-asset-worker scan".to_owned());
    }
    let request: ScanRequest = serde_json::from_reader(io::stdin().lock())
        .map_err(|error| format!("invalid scan request: {error}"))?;
    let response = scan(request)?;
    serde_json::to_writer(io::stdout().lock(), &response)
        .map_err(|error| format!("failed to write scan response: {error}"))?;
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_extensions() {
        assert_eq!(normalized_extension("PNG"), ".png");
        assert_eq!(normalized_extension(".WebP"), ".webp");
        assert_eq!(normalized_extension(""), "");
    }

    #[test]
    fn hashes_known_content() {
        let path = env::temp_dir().join(format!("hikari-asset-worker-{}.txt", std::process::id()));
        std::fs::write(&path, b"hikari").expect("write fixture");
        let result = sha256(&path).expect("hash fixture");
        std::fs::remove_file(path).expect("remove fixture");
        assert_eq!(
            result,
            "720e8c5da0dafa670f09d4be23ec8484491a6a7763103079a4d2e98500dfef84"
        );
    }
}
