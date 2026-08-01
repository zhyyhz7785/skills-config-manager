//! Cursor rule layout: flat `rules/{id}.mdc` (align Electron).

use std::fs;
use std::path::{Path, PathBuf};

use crate::catalog::CatalogEntry;
use crate::path_guard::resolve_library_safe_path;

/// Flat library / container relative path under `rules/`.
pub fn flat_rule_rel(id: &str, ext: &str) -> String {
    let id = id.trim();
    let ext = normalize_ext(ext);
    format!("rules/{id}{ext}")
}

fn normalize_ext(ext: &str) -> String {
    let e = ext.trim();
    if e.is_empty() {
        return ".mdc".into();
    }
    if e.starts_with('.') {
        e.to_string()
    } else {
        format!(".{e}")
    }
}

pub fn ext_from_path(path: &Path) -> String {
    path.extension()
        .map(|s| format!(".{}", s.to_string_lossy()))
        .filter(|s| s.len() > 1)
        .unwrap_or_else(|| ".mdc".into())
}

/// `rules/foo.mdc` → flat; `rules/foo/bar.mdc` or `rules/foo/` → nested.
pub fn is_nested_rule_rel(rel: &str) -> bool {
    let n = rel.trim().replace('\\', "/");
    let lower = n.to_lowercase();
    if !lower.starts_with("rules/") {
        return false;
    }
    let rest = &n["rules/".len()..];
    rest.contains('/')
}

/// Prefer existing origin only when it is already a flat file under `rules/`.
pub fn is_flat_rule_abs_under_container(abs: &str, container_root: &str) -> bool {
    let abs_n = abs.replace('/', "\\").to_lowercase();
    let root = container_root
        .trim()
        .trim_end_matches(['/', '\\'])
        .replace('/', "\\")
        .to_lowercase();
    let prefix = format!("{root}\\rules\\");
    if !abs_n.starts_with(&prefix) {
        return false;
    }
    let rest = &abs_n[prefix.len()..];
    !rest.is_empty() && !rest.contains('\\') && rest.ends_with(".mdc")
}

/// Move nested library rule file to flat `rules/{id}{ext}` and update `entry.library_path`.
/// Returns true if `library_path` changed.
pub fn repath_rule_entry_to_flat(library_root: &str, entry: &mut CatalogEntry) -> Result<bool, String> {
    if !entry.kind.eq_ignore_ascii_case("rule") {
        return Ok(false);
    }
    let id = entry.id.trim();
    if id.is_empty() {
        return Ok(false);
    }
    let ext = if entry.library_path.trim().is_empty() {
        ".mdc".into()
    } else {
        ext_from_path(Path::new(&entry.library_path))
    };
    let flat_rel = flat_rule_rel(id, &ext);
    let old_rel = entry.library_path.replace('\\', "/");
    if old_rel == flat_rel {
        // Still try prune empty id dir shell.
        prune_rule_id_dir(library_root, id)?;
        return Ok(false);
    }

    let flat_abs = resolve_library_safe_path(library_root, &flat_rel)
        .map_err(|e| format!("flat rule path: {e}"))?;
    let old_abs = if !entry.library_path.trim().is_empty() {
        resolve_library_safe_path(library_root, &entry.library_path).ok()
    } else {
        None
    };

    if let Some(ref old) = old_abs {
        if old.exists() && old != &flat_abs {
            if let Some(parent) = flat_abs.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("mkdir rules: {e}"))?;
            }
            if !flat_abs.exists() {
                fs::rename(old, &flat_abs).or_else(|_| {
                    fs::copy(old, &flat_abs).map(|_| ()).and_then(|_| fs::remove_file(old))
                }).map_err(|e| format!("move rule to flat: {e}"))?;
            } else {
                // Flat already present — drop old nested file.
                let _ = fs::remove_file(old);
            }
        }
    }

    entry.library_path = flat_rel;
    prune_rule_id_dir(library_root, id)?;
    Ok(true)
}

fn prune_rule_id_dir(library_root: &str, id: &str) -> Result<(), String> {
    let id_dir_rel = format!("rules/{id}");
    let Ok(id_dir) = resolve_library_safe_path(library_root, &id_dir_rel) else {
        return Ok(());
    };
    if !id_dir.is_dir() {
        return Ok(());
    }
    // Only remove if empty or only leftover junk after move.
    let empty = fs::read_dir(&id_dir)
        .map(|rd| rd.filter_map(|e| e.ok()).count() == 0)
        .unwrap_or(false);
    if empty {
        let _ = fs::remove_dir(&id_dir);
    } else {
        // Nested shell with leftover files: remove whole dir if it only contained the rule file we moved.
        // Safer: remove_dir_all when no non-mdc siblings? Electron removes whole idDir.
        let _ = fs::remove_dir_all(&id_dir);
    }
    Ok(())
}

/// Probe live rule file in container (flat first, then nested `{id}/{id}.mdc`).
pub fn probe_rule_in_container(container_root: &str, entry_id: &str) -> Option<PathBuf> {
    let root = Path::new(container_root.trim());
    if !root.is_dir() || entry_id.trim().is_empty() {
        return None;
    }
    let flat = root.join("rules").join(format!("{}.mdc", entry_id.trim()));
    if flat.is_file() {
        return Some(flat);
    }
    let nested = root
        .join("rules")
        .join(entry_id.trim())
        .join(format!("{}.mdc", entry_id.trim()));
    if nested.is_file() {
        return Some(nested);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::{ensure_library_layout, CatalogEntry};

    #[test]
    fn flat_rel_and_nested_detect() {
        assert_eq!(flat_rule_rel("L0-01", ".mdc"), "rules/L0-01.mdc");
        assert!(!is_nested_rule_rel("rules/L0-01.mdc"));
        assert!(is_nested_rule_rel("rules/L0-01/L0-01.mdc"));
    }

    #[test]
    fn repath_moves_nested_to_flat() {
        let dir = tempfile::tempdir().unwrap();
        let lib = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib).unwrap();
        let nested = dir
            .path()
            .join("rules/L0-01-thinking-and-explanation/L0-01-thinking-and-explanation.mdc");
        fs::create_dir_all(nested.parent().unwrap()).unwrap();
        fs::write(&nested, b"# rule\n").unwrap();

        let mut entry = CatalogEntry {
            id: "L0-01-thinking-and-explanation".into(),
            kind: "rule".into(),
            library_path: "rules/L0-01-thinking-and-explanation/L0-01-thinking-and-explanation.mdc"
                .into(),
            is_in_library: true,
            ..Default::default()
        };
        assert!(repath_rule_entry_to_flat(&lib, &mut entry).unwrap());
        assert_eq!(entry.library_path, "rules/L0-01-thinking-and-explanation.mdc");
        assert!(dir
            .path()
            .join("rules/L0-01-thinking-and-explanation.mdc")
            .is_file());
        assert!(!nested.exists());
    }
}
