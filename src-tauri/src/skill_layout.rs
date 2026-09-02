//! Skill layout: directory unit `skills/{id}/` (multi-file skills).
//! Rules use nested shells（见 `rule_layout`）；`.skill` single-file packages stay files.

use std::path::{Path, PathBuf};

use crate::catalog::CatalogEntry;

/// Catalog / disk relative path for a skill directory unit.
pub fn skill_dir_rel(id: &str) -> String {
    format!("skills/{}", id.trim())
}

/// True when relative library path points at a skill main file (`…/SKILL.md`).
pub fn library_rel_is_skill_md(rel: &str) -> bool {
    let n = rel.trim().replace('\\', "/").to_lowercase();
    n.ends_with("/skill.md") || n == "skill.md"
}

/// Normalize catalog `library_path`: `skills/{id}/SKILL.md` → `skills/{id}`.
/// Leaves `.skill` packages and already-directory paths unchanged.
pub fn normalize_skill_library_rel(id: &str, library_path: &str) -> String {
    let id = id.trim();
    let lp = library_path.trim().replace('\\', "/");
    if lp.is_empty() {
        return skill_dir_rel(id);
    }
    let lower = lp.to_lowercase();
    if lower.ends_with(".skill") {
        return lp;
    }
    if library_rel_is_skill_md(&lp) {
        if let Some(parent) = Path::new(&lp).parent() {
            let p = parent.to_string_lossy().replace('\\', "/");
            if !p.is_empty() {
                return p;
            }
        }
        return skill_dir_rel(id);
    }
    lp
}

/// Resolve the on-disk skill **unit** path: directory for folder skills, file for `.skill`.
/// If `path` is `…/SKILL.md`, returns its parent directory.
pub fn skill_unit_path(path: &Path) -> PathBuf {
    if path.is_dir() {
        return path.to_path_buf();
    }
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let lower = name.to_lowercase();
    if lower == "skill.md" {
        if let Some(parent) = path.parent() {
            return parent.to_path_buf();
        }
    }
    path.to_path_buf()
}

/// Quietly upgrade entry paths to directory unit. Returns true if catalog fields changed.
pub fn normalize_skill_entry_paths(entry: &mut CatalogEntry) -> bool {
    if !entry.kind.eq_ignore_ascii_case("skill") {
        return false;
    }
    let mut changed = false;
    let new_lib = normalize_skill_library_rel(&entry.id, &entry.library_path);
    if new_lib != entry.library_path.replace('\\', "/") {
        entry.library_path = new_lib;
        changed = true;
    }
    let dep = entry.deployed_path.trim();
    if !dep.is_empty() {
        let unit = skill_unit_path(Path::new(dep));
        let unit_s = unit.to_string_lossy().to_string();
        if unit_s != dep {
            entry.deployed_path = unit_s;
            changed = true;
        }
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_skill_md_rel_to_dir() {
        assert_eq!(
            normalize_skill_library_rel("demo", "skills/demo/SKILL.md"),
            "skills/demo"
        );
        assert_eq!(
            normalize_skill_library_rel("demo", "skills/demo"),
            "skills/demo"
        );
        assert_eq!(
            normalize_skill_library_rel("pack", "skills/pack.skill"),
            "skills/pack.skill"
        );
    }

    #[test]
    fn skill_unit_path_lifts_skill_md() {
        let p = PathBuf::from(r"C:\Users\x\.cursor\skills\demo\SKILL.md");
        let u = skill_unit_path(&p);
        assert!(u.ends_with("demo"));
    }
}
