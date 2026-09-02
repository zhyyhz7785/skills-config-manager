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

/// Normalize CR LF / lone CR to LF. Does not alter other bytes (binary-safe for EOL-only checks).
pub fn normalize_eol(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\r' {
            if i + 1 < bytes.len() && bytes[i + 1] == b'\n' {
                out.push(b'\n');
                i += 2;
            } else {
                out.push(b'\n');
                i += 1;
            }
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    out
}

/// Two files are textually equal after EOL normalization (CRLF vs LF alone is not a difference).
pub fn same_text_ignoring_eol(a: &Path, b: &Path) -> Result<bool, String> {
    let ba = fs::read(a).map_err(|e| format!("read {a:?}: {e}"))?;
    let bb = fs::read(b).map_err(|e| format!("read {b:?}: {e}"))?;
    Ok(normalize_eol(&ba) == normalize_eol(&bb))
}

/// Files or directory trees equal when comparing each file with EOL normalized.
/// Used as a second check after byte-hash mismatch to skip CRLF/LF false conflicts.
pub fn same_content_ignoring_eol(a: &Path, b: &Path) -> bool {
    if a.is_file() && b.is_file() {
        return same_text_ignoring_eol(a, b).unwrap_or(false);
    }
    if !(a.is_dir() && b.is_dir()) {
        return false;
    }
    let Ok(mut fa) = walk_files(a) else {
        return false;
    };
    let Ok(mut fb) = walk_files(b) else {
        return false;
    };
    fa.sort_by(|x, y| rel_slash(a, x).cmp(&rel_slash(a, y)));
    fb.sort_by(|x, y| rel_slash(b, x).cmp(&rel_slash(b, y)));
    if fa.len() != fb.len() {
        return false;
    }
    for (pa, pb) in fa.iter().zip(fb.iter()) {
        if rel_slash(a, pa) != rel_slash(b, pb) {
            return false;
        }
        if !same_text_ignoring_eol(pa, pb).unwrap_or(false) {
            return false;
        }
    }
    true
}

/// True when byte hashes match, or content matches after EOL normalization.
pub fn content_equivalent(a_hash: &str, b_hash: &str, a: &Path, b: &Path) -> bool {
    if !a_hash.is_empty() && !b_hash.is_empty() && a_hash.eq_ignore_ascii_case(b_hash) {
        return true;
    }
    same_content_ignoring_eol(a, b)
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

    #[test]
    fn lf_vs_crlf_same_text_ignoring_eol() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.md");
        let b = dir.path().join("b.md");
        fs::write(&a, b"line1\nline2\n").unwrap();
        fs::write(&b, b"line1\r\nline2\r\n").unwrap();
        assert_ne!(
            compute_content_hash(&a, false).unwrap(),
            compute_content_hash(&b, false).unwrap(),
            "byte hashes must still differ"
        );
        assert!(same_text_ignoring_eol(&a, &b).unwrap());
        assert!(content_equivalent(
            &compute_content_hash(&a, false).unwrap(),
            &compute_content_hash(&b, false).unwrap(),
            &a,
            &b
        ));
    }

    #[test]
    fn real_diff_not_same_ignoring_eol() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.md");
        let b = dir.path().join("b.md");
        fs::write(&a, b"hello\n").unwrap();
        fs::write(&b, b"hallo\r\n").unwrap();
        assert!(!same_text_ignoring_eol(&a, &b).unwrap());
    }

    #[test]
    fn dir_trees_same_ignoring_eol() {
        let dir = tempfile::tempdir().unwrap();
        let da = dir.path().join("a");
        let db = dir.path().join("b");
        fs::create_dir_all(da.join("sub")).unwrap();
        fs::create_dir_all(db.join("sub")).unwrap();
        fs::write(da.join("sub/x.md"), b"x\ny\n").unwrap();
        fs::write(db.join("sub/x.md"), b"x\r\ny\r\n").unwrap();
        assert!(same_content_ignoring_eol(&da, &db));
    }
}
