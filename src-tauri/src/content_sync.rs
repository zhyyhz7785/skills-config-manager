//! Main-file content sync for dual-copy conflict resolution.
//! Aligns with Electron: compare/sync SKILL.md (or .md/.mdc) rather than whole dirs.

use std::fs;
use std::path::{Path, PathBuf};

use crate::hash::hash_path_auto;

/// Resolve the comparable main file (SKILL.md under skill dirs; file itself otherwise).
pub fn resolve_comparable_content_path(path: &str, kind: &str) -> PathBuf {
    let p = Path::new(path.trim());
    if p.is_file() {
        return p.to_path_buf();
    }
    if p.is_dir() {
        if kind.eq_ignore_ascii_case("skill") {
            let skill = p.join("SKILL.md");
            if skill.is_file() {
                return skill;
            }
        }
        if let Ok(rd) = fs::read_dir(p) {
            for ent in rd.flatten() {
                let name = ent.file_name().to_string_lossy().to_lowercase();
                if name.ends_with(".mdc") || name.ends_with(".md") {
                    let fp = ent.path();
                    if fp.is_file() {
                        return fp;
                    }
                }
            }
        }
    }
    p.to_path_buf()
}

/// Copy one main content file; refuses directory destinations.
pub fn sync_main_file(src: &Path, dst: &Path) -> Result<(), String> {
    if !src.is_file() {
        return Err(format!("源主文件不存在：{}", src.display()));
    }
    if dst.is_dir() {
        return Err(format!(
            "目标是目录，拒绝整目录覆盖主文件：{}",
            dst.display()
        ));
    }
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
    }
    fs::copy(src, dst).map_err(|e| format!("copy main file: {e}"))?;
    Ok(())
}

/// Fail if both paths do not share the same content hash after sync.
pub fn verify_content_hash_match(a: &Path, b: &Path) -> Result<(), String> {
    let (ha, _) = hash_path_auto(a).map_err(|e| format!("hash src: {e}"))?;
    let (hb, _) = hash_path_auto(b).map_err(|e| format!("hash dst: {e}"))?;
    if ha.is_empty() || hb.is_empty() || !ha.eq_ignore_ascii_case(&hb) {
        return Err(format!(
            "同步后哈希仍不一致（{} ≠ {}）",
            &ha[..ha.len().min(8)],
            &hb[..hb.len().min(8)]
        ));
    }
    Ok(())
}

/// Prefer an existing file destination for overwrite; else create SKILL.md under skill dirs.
pub fn resolve_library_main_dest(
    lib_full: &Path,
    lib_cmp: PathBuf,
    kind: &str,
) -> Result<PathBuf, String> {
    let lib_dest = if lib_cmp.is_file() {
        lib_cmp
    } else if lib_full.is_file() {
        lib_full.to_path_buf()
    } else if kind.eq_ignore_ascii_case("skill") {
        let skill = lib_full.join("SKILL.md");
        if let Some(parent) = skill.parent() {
            let _ = fs::create_dir_all(parent);
        }
        skill
    } else {
        lib_full.to_path_buf()
    };
    if lib_dest.is_dir() {
        return Err(format!(
            "overwrite 目标仍是目录：{}",
            lib_dest.display()
        ));
    }
    Ok(lib_dest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skill_dir_resolves_to_skill_md() {
        let dir = tempfile::tempdir().unwrap();
        let skill_dir = dir.path().join("hello");
        fs::create_dir_all(&skill_dir).unwrap();
        let skill = skill_dir.join("SKILL.md");
        fs::write(&skill, "lib").unwrap();
        let cmp = resolve_comparable_content_path(&skill_dir.to_string_lossy(), "skill");
        assert_eq!(cmp, skill);
    }

    #[test]
    fn sync_then_hash_match() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.md");
        let b = dir.path().join("b.md");
        fs::write(&a, "same-body").unwrap();
        sync_main_file(&a, &b).unwrap();
        verify_content_hash_match(&a, &b).unwrap();
    }
}
