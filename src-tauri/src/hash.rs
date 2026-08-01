//! Content hash (SHA-256), align Electron metadataReader.computeContentHash spirit.

use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

/// Hex lowercase SHA-256 of file bytes, or of a directory (sorted rel paths + contents).
pub fn compute_content_hash(path: &Path, is_folder: bool) -> Result<String, String> {
    if !path.exists() {
        return Ok(String::new());
    }
    let mut hasher = Sha256::new();
    if is_folder {
        let mut files = walk_files(path)?;
        files.sort_by(|a, b| {
            let ra = rel_slash(path, a);
            let rb = rel_slash(path, b);
            ra.cmp(&rb)
        });
        for file in files {
            let rel = rel_slash(path, &file);
            hasher.update(rel.as_bytes());
            let mut f = fs::File::open(&file).map_err(|e| format!("open {file:?}: {e}"))?;
            let mut buf = Vec::new();
            f.read_to_end(&mut buf)
                .map_err(|e| format!("read {file:?}: {e}"))?;
            hasher.update(&buf);
        }
    } else {
        let mut f = fs::File::open(path).map_err(|e| format!("open {path:?}: {e}"))?;
        let mut buf = Vec::new();
        f.read_to_end(&mut buf)
            .map_err(|e| format!("read {path:?}: {e}"))?;
        hasher.update(&buf);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

pub fn hash_path_auto(path: &Path) -> Result<(String, bool), String> {
    let meta = fs::symlink_metadata(path).map_err(|e| format!("stat {path:?}: {e}"))?;
    let is_dir = meta.is_dir();
    let h = compute_content_hash(path, is_dir)?;
    Ok((h, is_dir))
}

fn rel_slash(root: &Path, file: &Path) -> String {
    file.strip_prefix(root)
        .unwrap_or(file)
        .to_string_lossy()
        .replace('\\', "/")
}

fn walk_files(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut out = Vec::new();
    walk_files_inner(dir, &mut out)?;
    Ok(out)
}

fn walk_files_inner(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("readdir {dir:?}: {e}"))?;
    for ent in entries {
        let ent = ent.map_err(|e| format!("readdir entry: {e}"))?;
        let p = ent.path();
        let ft = ent.file_type().map_err(|e| format!("filetype: {e}"))?;
        if ft.is_dir() {
            walk_files_inner(&p, out)?;
        } else if ft.is_file() {
            out.push(p);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn same_bytes_same_hash() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.md");
        let b = dir.path().join("b.md");
        fs::write(&a, b"hello").unwrap();
        fs::write(&b, b"hello").unwrap();
        assert_eq!(
            compute_content_hash(&a, false).unwrap(),
            compute_content_hash(&b, false).unwrap()
        );
    }

    #[test]
    fn different_bytes_different_hash() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.md");
        let b = dir.path().join("b.md");
        fs::write(&a, b"hello").unwrap();
        fs::write(&b, b"hallo").unwrap();
        assert_ne!(
            compute_content_hash(&a, false).unwrap(),
            compute_content_hash(&b, false).unwrap()
        );
    }
}
