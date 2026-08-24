use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::env;
use std::fs::{self, File};
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

const PROTOCOL_VERSION: u8 = 2;
const CACHE_VERSION: u8 = 1;
const HASH_BUFFER_BYTES: usize = 1024 * 1024;
const MAX_THREADS: usize = 16;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ScanRequest {
    root: PathBuf,
    extensions: Vec<String>,
    #[serde(default)]
    hash_files: bool,
    cache_path: Option<PathBuf>,
    max_threads: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InspectRequest {
    paths: Vec<PathBuf>,
    #[serde(default)]
    hash_files: bool,
    cache_path: Option<PathBuf>,
    max_threads: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileRecord {
    path: PathBuf,
    name: String,
    stem: String,
    extension: String,
    size: u64,
    modified_ns: Option<u64>,
    sha256: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerWarning {
    code: &'static str,
    path: Option<PathBuf>,
    message: String,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerStats {
    discovered_files: usize,
    inspected_files: usize,
    hashed_files: usize,
    cache_hits: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerResponse {
    version: u8,
    files: Vec<FileRecord>,
    warnings: Vec<WorkerWarning>,
    stats: WorkerStats,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HashCache {
    version: u8,
    entries: HashMap<String, CachedHash>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CachedHash {
    size: u64,
    modified_ns: Option<u64>,
    sha256: String,
}

struct Inspection {
    record: FileRecord,
    cache_hit: bool,
    hashed: bool,
}

fn normalized_extension(value: &str) -> String {
    let extension = value.trim().trim_start_matches('.').to_lowercase();
    if extension.is_empty() {
        String::new()
    } else {
        format!(".{extension}")
    }
}

fn modified_ns(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .and_then(|duration| u64::try_from(duration.as_nanos()).ok())
}

fn cache_key(path: &Path) -> String {
    let value = path.to_string_lossy();
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value.into_owned()
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

fn load_cache(path: Option<&Path>, warnings: &mut Vec<WorkerWarning>) -> HashCache {
    let Some(path) = path else {
        return HashCache {
            version: CACHE_VERSION,
            entries: HashMap::new(),
        };
    };
    let backup = cache_backup_path(path);
    let source = if path.is_file() {
        path
    } else if backup.is_file() {
        warnings.push(WorkerWarning {
            code: "cache-recovered",
            path: Some(backup.clone()),
            message: "recovering hash cache from an interrupted write".to_owned(),
        });
        &backup
    } else {
        return HashCache {
            version: CACHE_VERSION,
            entries: HashMap::new(),
        };
    };
    match File::open(source).map(BufReader::new).and_then(|reader| {
        serde_json::from_reader::<_, HashCache>(reader).map_err(io::Error::other)
    }) {
        Ok(cache) if cache.version == CACHE_VERSION => cache,
        Ok(_) => {
            warnings.push(WorkerWarning {
                code: "cache-version",
                path: Some(path.to_owned()),
                message: "hash cache version is unsupported; rebuilding cache".to_owned(),
            });
            HashCache {
                version: CACHE_VERSION,
                entries: HashMap::new(),
            }
        }
        Err(error) => {
            warnings.push(WorkerWarning {
                code: "cache-read",
                path: Some(path.to_owned()),
                message: format!("failed to read hash cache: {error}"),
            });
            HashCache {
                version: CACHE_VERSION,
                entries: HashMap::new(),
            }
        }
    }
}

fn cache_backup_path(path: &Path) -> PathBuf {
    path.with_extension(format!(
        "{}.bak",
        path.extension().unwrap_or_default().to_string_lossy()
    ))
}

fn save_cache(path: &Path, cache: &HashCache) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "cache path has no parent"))?;
    fs::create_dir_all(parent)?;
    let temporary = parent.join(format!(
        ".{}-{}.tmp",
        path.file_name().unwrap_or_default().to_string_lossy(),
        std::process::id()
    ));
    let backup = cache_backup_path(path);
    let result = (|| {
        let file = File::create(&temporary)?;
        let mut writer = BufWriter::new(file);
        serde_json::to_writer(&mut writer, cache).map_err(io::Error::other)?;
        writer.flush()?;
        writer.get_ref().sync_all()?;
        if backup.exists() {
            fs::remove_file(&backup)?;
        }
        if path.exists() {
            fs::rename(path, &backup)?;
        }
        if let Err(error) = fs::rename(&temporary, path) {
            if backup.exists() {
                let _ = fs::rename(&backup, path);
            }
            return Err(error);
        }
        if backup.exists() {
            fs::remove_file(backup)?;
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn inspect_file(path: PathBuf, hash_files: bool, cache: &HashCache) -> io::Result<Inspection> {
    let metadata = path.metadata()?;
    if !metadata.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "path is not a file",
        ));
    }
    let size = metadata.len();
    let file_modified_ns = modified_ns(&metadata);
    let cached = cache.entries.get(&cache_key(&path));
    let (digest, cache_hit, hashed) = if !hash_files {
        (None, false, false)
    } else if let Some(cached) =
        cached.filter(|item| item.size == size && item.modified_ns == file_modified_ns)
    {
        (Some(cached.sha256.clone()), true, false)
    } else {
        let digest = sha256(&path)?;
        let current = path.metadata()?;
        if current.len() != size || modified_ns(&current) != file_modified_ns {
            return Err(io::Error::other("file changed while it was being hashed"));
        }
        (Some(digest), false, true)
    };
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
    Ok(Inspection {
        record: FileRecord {
            path,
            name,
            stem,
            extension,
            size,
            modified_ns: file_modified_ns,
            sha256: digest,
        },
        cache_hit,
        hashed,
    })
}

fn thread_count(requested: Option<usize>) -> usize {
    let available = std::thread::available_parallelism().map_or(1, usize::from);
    requested.unwrap_or(available).clamp(1, MAX_THREADS)
}

fn inspect_paths(
    paths: Vec<PathBuf>,
    hash_files: bool,
    cache_path: Option<PathBuf>,
    max_threads: Option<usize>,
    mut warnings: Vec<WorkerWarning>,
) -> Result<WorkerResponse, String> {
    let cache = load_cache(cache_path.as_deref(), &mut warnings);
    let discovered_files = paths.len();
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(thread_count(max_threads))
        .build()
        .map_err(|error| format!("failed to create worker pool: {error}"))?;
    let outcomes = pool.install(|| {
        paths
            .into_par_iter()
            .map(|path| {
                inspect_file(path.clone(), hash_files, &cache).map_err(|error| WorkerWarning {
                    code: "inspect-file",
                    path: Some(path),
                    message: error.to_string(),
                })
            })
            .collect::<Vec<_>>()
    });

    let mut files = Vec::new();
    let mut stats = WorkerStats {
        discovered_files,
        ..WorkerStats::default()
    };
    for outcome in outcomes {
        match outcome {
            Ok(inspection) => {
                stats.inspected_files += 1;
                stats.hashed_files += usize::from(inspection.hashed);
                stats.cache_hits += usize::from(inspection.cache_hit);
                files.push(inspection.record);
            }
            Err(warning) => warnings.push(warning),
        }
    }
    files.sort_by_cached_key(|file| file.path.to_string_lossy().to_lowercase());

    if hash_files && let Some(path) = cache_path {
        let mut entries = cache.entries.clone();
        for file in &files {
            if let Some(digest) = &file.sha256 {
                entries.insert(
                    cache_key(&file.path),
                    CachedHash {
                        size: file.size,
                        modified_ns: file.modified_ns,
                        sha256: digest.clone(),
                    },
                );
            }
        }
        let next_cache = HashCache {
            version: CACHE_VERSION,
            entries,
        };
        if let Err(error) = save_cache(&path, &next_cache) {
            warnings.push(WorkerWarning {
                code: "cache-write",
                path: Some(path),
                message: format!("failed to write hash cache: {error}"),
            });
        }
    }

    Ok(WorkerResponse {
        version: PROTOCOL_VERSION,
        files,
        warnings,
        stats,
    })
}

fn scan(request: ScanRequest) -> Result<WorkerResponse, String> {
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

    let mut paths = Vec::new();
    let mut warnings = Vec::new();
    for entry in WalkDir::new(&request.root).follow_links(false) {
        match entry {
            Ok(entry) if entry.file_type().is_file() => {
                let path = entry.into_path();
                let supported = path
                    .extension()
                    .map(|value| {
                        extensions.contains(&normalized_extension(&value.to_string_lossy()))
                    })
                    .unwrap_or(false);
                if supported {
                    paths.push(path);
                }
            }
            Ok(_) => {}
            Err(error) => warnings.push(WorkerWarning {
                code: "walk-directory",
                path: error.path().map(Path::to_owned),
                message: error.to_string(),
            }),
        }
    }
    inspect_paths(
        paths,
        request.hash_files,
        request.cache_path,
        request.max_threads,
        warnings,
    )
}

fn inspect(request: InspectRequest) -> Result<WorkerResponse, String> {
    if request.paths.len() > 100_000 {
        return Err("inspect request exceeds 100000 paths".to_owned());
    }
    let mut unique = HashSet::new();
    let paths = request
        .paths
        .into_iter()
        .filter(|path| unique.insert(cache_key(path)))
        .collect();
    inspect_paths(
        paths,
        request.hash_files,
        request.cache_path,
        request.max_threads,
        Vec::new(),
    )
}

fn run() -> Result<(), String> {
    let mut args = env::args().skip(1);
    let command = args.next();
    if args.next().is_some() {
        return Err("usage: slide-asset-worker <scan|inspect>".to_owned());
    }
    let response = match command.as_deref() {
        Some("scan") => {
            let request: ScanRequest = serde_json::from_reader(io::stdin().lock())
                .map_err(|error| format!("invalid scan request: {error}"))?;
            scan(request)?
        }
        Some("inspect") => {
            let request: InspectRequest = serde_json::from_reader(io::stdin().lock())
                .map_err(|error| format!("invalid inspect request: {error}"))?;
            inspect(request)?
        }
        _ => return Err("usage: slide-asset-worker <scan|inspect>".to_owned()),
    };
    serde_json::to_writer(io::stdout().lock(), &response)
        .map_err(|error| format!("failed to write worker response: {error}"))?;
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
    use std::sync::atomic::{AtomicUsize, Ordering};

    static TEST_SEQUENCE: AtomicUsize = AtomicUsize::new(1);

    fn test_directory(name: &str) -> PathBuf {
        let path = env::temp_dir().join(format!(
            "slide-asset-worker-{name}-{}-{}",
            std::process::id(),
            TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("create fixture directory");
        path
    }

    #[test]
    fn normalizes_extensions() {
        assert_eq!(normalized_extension("PNG"), ".png");
        assert_eq!(normalized_extension(".WebP"), ".webp");
        assert_eq!(normalized_extension(""), "");
    }

    #[test]
    fn hashes_known_content() {
        let root = test_directory("hash");
        let path = root.join("fixture.txt");
        fs::write(&path, b"slide").expect("write fixture");
        let result = sha256(&path).expect("hash fixture");
        fs::remove_dir_all(root).expect("remove fixture");
        assert_eq!(
            result,
            "b8a7e24e95497806eafbe1b4a897b70ecf6e57f4bfca8c770091e1f075304006"
        );
    }

    #[test]
    fn reuses_and_invalidates_hash_cache() {
        let root = test_directory("cache");
        let asset = root.join("image.png");
        let cache_path = root.join("cache.json");
        fs::write(&asset, b"first").expect("write first asset");

        let first = inspect_paths(
            vec![asset.clone()],
            true,
            Some(cache_path.clone()),
            Some(2),
            Vec::new(),
        )
        .expect("first inspection");
        assert_eq!(first.stats.hashed_files, 1);
        assert_eq!(first.stats.cache_hits, 0);

        let second = inspect_paths(
            vec![asset.clone()],
            true,
            Some(cache_path.clone()),
            Some(2),
            Vec::new(),
        )
        .expect("cached inspection");
        assert_eq!(second.stats.hashed_files, 0);
        assert_eq!(second.stats.cache_hits, 1);

        fs::write(&asset, b"changed-content").expect("change asset");
        let third = inspect_paths(vec![asset], true, Some(cache_path), Some(2), Vec::new())
            .expect("changed inspection");
        assert_eq!(third.stats.hashed_files, 1);
        assert_eq!(third.stats.cache_hits, 0);
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn corrupt_cache_becomes_warning() {
        let root = test_directory("corrupt-cache");
        let asset = root.join("image.png");
        let cache_path = root.join("cache.json");
        fs::write(&asset, b"asset").expect("write asset");
        fs::write(&cache_path, b"not-json").expect("write corrupt cache");
        let response = inspect_paths(vec![asset], true, Some(cache_path), None, Vec::new())
            .expect("inspection");
        assert!(
            response
                .warnings
                .iter()
                .any(|warning| warning.code == "cache-read")
        );
        assert_eq!(response.files.len(), 1);
        fs::remove_dir_all(root).expect("remove fixture");
    }
}
