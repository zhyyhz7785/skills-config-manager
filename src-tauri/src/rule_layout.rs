//! Cursor rule layout（本仓 CCM 产品约定，见 `.cursor/rules/L1-ccm-library-layout`）：
//! 规范路径为文件夹壳 `rules/{id}/{id}.mdc`；扁平 `rules/{id}.mdc` 仅兼容读并在触达时升格。
//! 不成可复用 Agent Skill；无跨项目复用价值。

use std::fs;
use std::path::{Path, PathBuf};

use crate::catalog::CatalogEntry;
use crate::path_guard::resolve_library_safe_path;

/// Canonical nested relative path under `rules/`.
pub fn nested_rule_rel(id: &str, ext: &str) -> String {
    let id = id.trim();
    let ext = normalize_ext(ext);
    format!("rules/{id}/{id}{ext}")
}

/// Legacy flat relative path（兼容读 / 升格源）。
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
#[cfg(test)]
pub fn is_nested_rule_rel(rel: &str) -> bool {
    let n = rel.trim().replace('\\', "/");
    let lower = n.to_lowercase();
    if !lower.starts_with("rules/") {
        return false;
    }
    let rest = &n["rules/".len()..];
    rest.contains('/')
}

/// Move flat library rule file into nested shell `rules/{id}/{id}{ext}` and update `entry.library_path`.
/// Returns true if `library_path` changed.
pub fn repath_rule_entry_to_nested(
    library_root: &str,
    entry: &mut CatalogEntry,
) -> Result<bool, String> {
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
    let nested_rel = nested_rule_rel(id, &ext);
    let old_rel = entry.library_path.replace('\\', "/");
    if old_rel == nested_rel {
        // Already nested — still drop leftover flat sibling if present.
        prune_flat_rule_sibling(library_root, id, &ext)?;
        return Ok(false);
    }

    let nested_abs = resolve_library_safe_path(library_root, &nested_rel)
        .map_err(|e| format!("nested rule path: {e}"))?;
    let old_abs = if !entry.library_path.trim().is_empty() {
        resolve_library_safe_path(library_root, &entry.library_path).ok()
    } else {
        None
    };

    if let Some(parent) = nested_abs.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir rule shell: {e}"))?;
    }

    if let Some(ref old) = old_abs {
        if old.exists() && old != &nested_abs {
            if !nested_abs.exists() {
                fs::rename(old, &nested_abs)
                    .or_else(|_| {
                        fs::copy(old, &nested_abs)
                            .map(|_| ())
                            .and_then(|_| fs::remove_file(old))
                    })
                    .map_err(|e| format!("move rule to nested: {e}"))?;
            } else {
                // Nested already present — drop old flat/misplaced file.
                let _ = fs::remove_file(old);
            }
        }
    }

    entry.library_path = nested_rel;
    prune_flat_rule_sibling(library_root, id, &ext)?;
    Ok(true)
}

fn prune_flat_rule_sibling(library_root: &str, id: &str, ext: &str) -> Result<(), String> {
    let flat_rel = flat_rule_rel(id, ext);
    let Ok(flat_abs) = resolve_library_safe_path(library_root, &flat_rel) else {
        return Ok(());
    };
    if flat_abs.is_file() {
        let _ = fs::remove_file(&flat_abs);
    }
    Ok(())
}

/// Probe live rule file in container（nested first, then flat legacy）.
pub fn probe_rule_in_container(container_root: &str, entry_id: &str) -> Option<PathBuf> {
    let root = Path::new(container_root.trim());
    if !root.is_dir() || entry_id.trim().is_empty() {
        return None;
    }
    let id = entry_id.trim();
    let nested = root.join("rules").join(id).join(format!("{id}.mdc"));
    if nested.is_file() {
        return Some(nested);
    }
    let flat = root.join("rules").join(format!("{id}.mdc"));
    if flat.is_file() {
        return Some(flat);
    }
    None
}

/// 扫盘升格：永久库 `rules/` 下一层扁平 `*.mdc`/`*.md` → 文件夹壳，并同步台账路径。
/// 返回处理的扁平文件数（含「嵌套已存在则删扁平残留」）。
pub fn upgrade_flat_rules_in_library(library_root: &str) -> Result<u32, String> {
    let root = library_root.trim();
    if root.is_empty() {
        return Ok(0);
    }
    let rules_dir = Path::new(root).join("rules");
    let mut moved = 0u32;

    if rules_dir.is_dir() {
        let mut flats: Vec<PathBuf> = Vec::new();
        for ent in fs::read_dir(&rules_dir).map_err(|e| format!("read rules/: {e}"))? {
            let ent = ent.map_err(|e| e.to_string())?;
            let path = ent.path();
            if !path.is_file() {
                continue;
            }
            let name = path
                .file_name()
                .map(|s| s.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            if name.ends_with(".mdc") || name.ends_with(".md") {
                flats.push(path);
            }
        }
        for flat in flats {
            let stem = flat
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            if stem.is_empty() {
                continue;
            }
            let ext = ext_from_path(&flat);
            let nested_rel = nested_rule_rel(&stem, &ext);
            let nested_abs = resolve_library_safe_path(root, &nested_rel)
                .map_err(|e| format!("nested rule path: {e}"))?;
            if nested_abs.is_file() {
                if flat.exists() {
                    fs::remove_file(&flat).map_err(|e| {
                        format!(
                            "删除扁平残留 {}: {e}",
                            flat.display()
                        )
                    })?;
                }
            } else {
                if let Some(parent) = nested_abs.parent() {
                    fs::create_dir_all(parent).map_err(|e| format!("mkdir rule shell: {e}"))?;
                }
                fs::rename(&flat, &nested_abs)
                    .or_else(|_| {
                        fs::copy(&flat, &nested_abs)
                            .map(|_| ())
                            .and_then(|_| fs::remove_file(&flat))
                    })
                    .map_err(|e| format!("upgrade flat rule {stem}: {e}"))?;
            }
            moved += 1;
        }
    }

    let mut load = crate::catalog::load_catalog(root);
    let mut dirty = false;
    for entry in load.catalog.entries.iter_mut() {
        if !entry.kind.eq_ignore_ascii_case("rule") {
            continue;
        }
        if repath_rule_entry_to_nested(root, entry)? {
            dirty = true;
        }
    }
    if dirty {
        crate::catalog::save_catalog(root, &load.catalog)?;
    }
    Ok(moved)
}

/// Directory to open/reveal for a rule（prefer shell `rules/{id}/`）.
pub fn rule_open_dir(container_or_library_root: &str, entry_id: &str) -> Option<PathBuf> {
    let root = Path::new(container_or_library_root.trim());
    let id = entry_id.trim();
    if !root.is_dir() || id.is_empty() {
        return None;
    }
    let shell = root.join("rules").join(id);
    if shell.is_dir() {
        return Some(shell);
    }
    if let Some(file) = probe_rule_in_container(container_or_library_root, id) {
        return file.parent().map(|p| p.to_path_buf());
    }
    let rules = root.join("rules");
    if rules.is_dir() {
        return Some(rules);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::{ensure_library_layout, CatalogEntry};

    #[test]
    fn nested_rel_and_detect() {
        assert_eq!(
            nested_rule_rel("L0-01", ".mdc"),
            "rules/L0-01/L0-01.mdc"
        );
        assert_eq!(flat_rule_rel("L0-01", ".mdc"), "rules/L0-01.mdc");
        assert!(!is_nested_rule_rel("rules/L0-01.mdc"));
        assert!(is_nested_rule_rel("rules/L0-01/L0-01.mdc"));
    }

    #[test]
    fn repath_moves_flat_to_nested() {
        let dir = tempfile::tempdir().unwrap();
        let lib = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib).unwrap();
        let flat = dir.path().join("rules/L0-01-thinking-and-explanation.mdc");
        fs::create_dir_all(flat.parent().unwrap()).unwrap();
        fs::write(&flat, b"# rule\n").unwrap();

        let mut entry = CatalogEntry {
            id: "L0-01-thinking-and-explanation".into(),
            kind: "rule".into(),
            library_path: "rules/L0-01-thinking-and-explanation.mdc".into(),
            is_in_library: true,
            ..Default::default()
        };
        assert!(repath_rule_entry_to_nested(&lib, &mut entry).unwrap());
        assert_eq!(
            entry.library_path,
            "rules/L0-01-thinking-and-explanation/L0-01-thinking-and-explanation.mdc"
        );
        let nested = dir.path().join(
            "rules/L0-01-thinking-and-explanation/L0-01-thinking-and-explanation.mdc",
        );
        assert!(nested.is_file());
        assert!(!flat.exists());
    }

    #[test]
    fn probe_prefers_nested() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let nested = root.join("rules/foo/foo.mdc");
        fs::create_dir_all(nested.parent().unwrap()).unwrap();
        fs::write(&nested, b"n").unwrap();
        fs::write(root.join("rules/foo.mdc"), b"f").unwrap();
        let hit = probe_rule_in_container(&root.to_string_lossy(), "foo").unwrap();
        assert_eq!(hit, nested);
    }

    #[test]
    fn upgrade_library_moves_flat_and_updates_catalog() {
        use crate::catalog::{load_catalog, save_catalog, CatalogEntry};

        let dir = tempfile::tempdir().unwrap();
        let lib = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib).unwrap();
        fs::write(dir.path().join("rules/foo.mdc"), b"# foo\n").unwrap();
        let mut c = crate::catalog::empty_catalog();
        c.entries.push(CatalogEntry {
            id: "foo".into(),
            kind: "rule".into(),
            library_path: "rules/foo.mdc".into(),
            is_in_library: true,
            ..Default::default()
        });
        save_catalog(&lib, &c).unwrap();

        let n = upgrade_flat_rules_in_library(&lib).unwrap();
        assert_eq!(n, 1);
        assert!(dir.path().join("rules/foo/foo.mdc").is_file());
        assert!(!dir.path().join("rules/foo.mdc").exists());
        let load = load_catalog(&lib);
        let e = load.catalog.entries.iter().find(|e| e.id == "foo").unwrap();
        assert_eq!(e.library_path, "rules/foo/foo.mdc");
    }
}
