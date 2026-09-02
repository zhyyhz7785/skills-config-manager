//! Permanent-library id / folder names follow origin + level digit.
//! Local skill/rule: `L0`/`L1`/`L2` (keep `L1D10` / `L2P` domain suffixes when the digit matches).
//! Unmodified network skill: `S0`/`S1`/`S2`; network rule: `R0`/`R1`/`R2`.
//! After a customization diff, network items are treated as local (S/R → L). One-way.
//! Agent / command / hook stay `A*` / `C*` / `H*` regardless of origin.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use crate::catalog::{
    get_entry_tags, load_catalog, replace_entry_id, set_entry_tags, upsert_entry, CatalogEntry,
};
use crate::path_guard::resolve_library_safe_path;
use crate::project_discovery::normalize_path;
use crate::session::with_session;
use crate::settings::AppSettings;
use crate::skill_layout::{skill_dir_rel, skill_unit_path};

pub struct LevelSetOutcome {
    pub new_id: String,
    pub renamed: bool,
    pub warnings: Vec<String>,
}

pub fn is_explicit_uncategorized(level: Option<&str>) -> bool {
    let Some(s) = level else {
        return false;
    };
    let t = s.trim();
    if t.is_empty() || t == "未分类" {
        return true;
    }
    let u = t.to_ascii_uppercase();
    u == "UNCATEGORIZED" || u == "NONE" || u == "CLEAR"
}

pub fn kind_letter(kind: &str) -> char {
    match kind.trim().to_ascii_lowercase().as_str() {
        "rule" => 'R',
        "agent" => 'A',
        "command" => 'C',
        "hook" => 'H',
        _ => 'S',
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdOrigin {
    Local,
    Network,
}

/// Local L-prefix already at `level_digit`, including domain suffixes (`L1D10`, `L2P`).
fn matching_local_prefix(current_id: &str, level_digit: char) -> Option<String> {
    let chars: Vec<char> = current_id.chars().collect();
    if chars.len() < 3 {
        return None;
    }
    if chars[0].to_ascii_uppercase() != 'L' || chars[1] != level_digit {
        return None;
    }
    let mut i = 2;
    while i < chars.len() && chars[i].is_ascii_alphabetic() {
        i += 1;
    }
    while i < chars.len() && chars[i].is_ascii_digit() {
        i += 1;
    }
    if i < chars.len() && (chars[i] == '-' || chars[i] == '_') {
        Some(chars[..i].iter().collect())
    } else {
        None
    }
}

pub fn id_origin_for(library_root: &str, entry: &CatalogEntry) -> IdOrigin {
    if crate::network_customization::get_provenance(entry).is_none() {
        return IdOrigin::Local;
    }
    if crate::network_customization::has_customization_diff(library_root, &entry.id) {
        IdOrigin::Local
    } else {
        IdOrigin::Network
    }
}

fn strip_once(id: &str) -> String {
    let chars: Vec<char> = id.chars().collect();
    if chars.len() < 3 {
        return id.to_string();
    }
    let c0 = chars[0].to_ascii_uppercase();
    let c1 = chars[1];
    if matches!(c0, 'S' | 'R' | 'A' | 'C' | 'H')
        && matches!(c1, '0' | '1' | '2')
        && (chars[2] == '-' || chars[2] == '_')
    {
        return chars[3..].iter().collect();
    }
    if c0 == 'L' && matches!(c1, '0' | '1' | '2') {
        let mut i = 2;
        while i < chars.len() && chars[i].is_ascii_alphabetic() {
            i += 1;
        }
        while i < chars.len() && chars[i].is_ascii_digit() {
            i += 1;
        }
        if i < chars.len() && (chars[i] == '-' || chars[i] == '_') {
            return chars[i + 1..].iter().collect();
        }
    }
    id.to_string()
}

/// Drop `L0-` / `L1D10-` / `S1-` (and repeats) so the stem is the human name.
pub fn strip_kind_level_prefix(id: &str) -> String {
    let mut cur = id.trim().to_string();
    for _ in 0..8 {
        let next = strip_once(&cur);
        if next == cur {
            return cur;
        }
        cur = next;
    }
    cur
}

fn sanitize_stem(raw: &str) -> String {
    let s = raw.trim().replace(['\\', '/'], "-");
    let mut out = String::new();
    for c in s.chars() {
        if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
            out.push(c);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let out = out.trim_matches(|c| c == '-' || c == '.').to_string();
    if out.is_empty() || out == "." || out == ".." {
        "item".into()
    } else {
        out
    }
}

pub fn desired_id(kind: &str, current_id: &str, level: Option<&str>, origin: IdOrigin) -> String {
    let stem = sanitize_stem(&strip_kind_level_prefix(current_id));
    let digit = match level.map(|s| s.trim().to_ascii_uppercase()).as_deref() {
        Some("L0") => '0',
        Some("L1") => '1',
        Some("L2") => '2',
        _ => return stem,
    };
    let k = kind.trim().to_ascii_lowercase();
    if matches!(k.as_str(), "agent" | "command" | "hook") {
        return format!("{}{digit}-{stem}", kind_letter(kind));
    }
    match origin {
        IdOrigin::Local => {
            if let Some(pfx) = matching_local_prefix(current_id, digit) {
                format!("{pfx}-{stem}")
            } else {
                format!("L{digit}-{stem}")
            }
        }
        IdOrigin::Network => format!("{}{digit}-{stem}", kind_letter(kind)),
    }
}

fn unique_id(
    taken: &HashSet<String>,
    desired: &str,
    current: &str,
    disk_taken: impl Fn(&str) -> bool,
) -> String {
    if desired.eq_ignore_ascii_case(current) {
        return current.to_string();
    }
    let taken_hit = |id: &str| {
        taken.iter().any(|t| t.eq_ignore_ascii_case(id)) || disk_taken(id)
    };
    if !taken_hit(desired) {
        return desired.to_string();
    }
    for n in 2..1000 {
        let cand = format!("{desired}-{n}");
        if cand.eq_ignore_ascii_case(current) || !taken_hit(&cand) {
            return cand;
        }
    }
    format!("{desired}-x")
}

fn is_shared_hooks_json(entry: &CatalogEntry) -> bool {
    entry.kind.eq_ignore_ascii_case("hook")
        && entry
            .library_path
            .replace('\\', "/")
            .to_lowercase()
            .ends_with("hooks.json")
}

pub fn desired_library_rel(kind: &str, new_id: &str, old_rel: &str) -> String {
    let id = new_id.trim();
    let old = old_rel.trim().replace('\\', "/");
    let lower = old.to_lowercase();
    match kind.trim().to_ascii_lowercase().as_str() {
        "skill" if lower.ends_with(".skill") => format!("skills/{id}.skill"),
        "skill" => skill_dir_rel(id),
        "rule" => {
            let ext = if old.is_empty() {
                ".mdc".into()
            } else {
                crate::rule_layout::ext_from_path(Path::new(&old))
            };
            crate::rule_layout::nested_rule_rel(id, &ext)
        }
        "agent" => format!("agents/{id}.md"),
        "command" => format!("commands/{id}.md"),
        "hook" if lower.ends_with(".json") => old,
        "hook" => format!("hooks/{id}.ps1"),
        _ => skill_dir_rel(id),
    }
}

fn path_present(p: &Path) -> bool {
    fs::symlink_metadata(p).is_ok()
}

fn is_symlink(p: &Path) -> bool {
    fs::symlink_metadata(p)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
}

fn same_path(a: &Path, b: &Path) -> bool {
    normalize_path(&a.to_string_lossy()) == normalize_path(&b.to_string_lossy())
}

fn move_path(old: &Path, new: &Path) -> Result<(), String> {
    if same_path(old, new) {
        return Ok(());
    }
    if !path_present(old) {
        return Ok(());
    }
    if path_present(new) {
        return Err(format!("目标已存在: {}", new.display()));
    }
    if let Some(parent) = new.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
    }
    match fs::rename(old, new) {
        Ok(()) => Ok(()),
        Err(e) => {
            crate::deploy::copy_path(old, new)
                .map_err(|ce| format!("rename {}: copy {ce}", e))?;
            crate::deploy::remove_path_any(old)
        }
    }
}

fn rewrite_component(part: &str, old_id: &str, new_id: &str) -> String {
    if part.eq_ignore_ascii_case(old_id) {
        return new_id.to_string();
    }
    let lower = part.to_ascii_lowercase();
    for ext in [".mdc", ".md", ".ps1", ".skill"] {
        if let Some(stem_len) = lower.strip_suffix(ext).map(|s| s.len()) {
            if part.get(..stem_len).is_some_and(|s| s.eq_ignore_ascii_case(old_id)) {
                return format!("{new_id}{ext}");
            }
        }
    }
    part.to_string()
}

fn rewrite_path_id(p: &str, old_id: &str, new_id: &str) -> String {
    let p = p.trim();
    if p.is_empty() || old_id.is_empty() || old_id == new_id {
        return p.to_string();
    }
    let sep = if p.contains('\\') { '\\' } else { '/' };
    let parts: Vec<String> = p
        .split(['/', '\\'])
        .map(|part| rewrite_component(part, old_id, new_id))
        .collect();
    if parts.len() == 1 {
        return parts.into_iter().next().unwrap_or_default();
    }
    if parts[0].ends_with(':') {
        format!("{}{}{}", parts[0], sep, parts[1..].join(&sep.to_string()))
    } else if p.starts_with('/') {
        format!(
            "/{}",
            parts
                .iter()
                .filter(|s| !s.is_empty())
                .cloned()
                .collect::<Vec<_>>()
                .join("/")
        )
    } else {
        parts.join(&sep.to_string())
    }
}

fn all_container_roots(settings: &AppSettings) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    let mut push = |s: &str| {
        let t = s.trim();
        if t.is_empty() {
            return;
        }
        let key = normalize_path(t);
        if key.is_empty() || !seen.insert(key) {
            return;
        }
        if Path::new(t).is_dir() {
            out.push(t.to_string());
        }
    };
    for w in &settings.workspaces {
        if !w.enabled {
            continue;
        }
        let r = if w.container_root.trim().is_empty() {
            crate::workspace::resolve_workspace_container_root(settings, &w.id)
        } else {
            w.container_root.clone()
        };
        push(&r);
    }
    if !settings.active_container_root.trim().is_empty() {
        push(&settings.active_container_root);
    }
    if !settings.workspaces.is_empty() {
        let active = crate::active_container::resolve_active_container_root(settings);
        push(&active);
    }
    out
}

fn probe_skill_unit(root: &Path, id: &str) -> Option<PathBuf> {
    let zip = root.join("skills").join(format!("{id}.skill"));
    if path_present(&zip) {
        return Some(zip);
    }
    let dir = root.join("skills").join(id);
    if path_present(&dir) {
        return Some(dir);
    }
    None
}

fn probe_rule_unit(root: &Path, id: &str) -> Option<PathBuf> {
    let shell = root.join("rules").join(id);
    if path_present(&shell) {
        return Some(shell);
    }
    if let Some(file) = crate::rule_layout::probe_rule_in_container(&root.to_string_lossy(), id) {
        return Some(file);
    }
    None
}

fn probe_simple_file(root: &Path, folder: &str, file: &str) -> Option<PathBuf> {
    let p = root.join(folder).join(file);
    if path_present(&p) {
        Some(p)
    } else {
        None
    }
}

fn locate_container_unit(root: &str, kind: &str, id: &str) -> Option<PathBuf> {
    let root = Path::new(root.trim());
    let id = id.trim();
    if !root.is_dir() || id.is_empty() {
        return None;
    }
    match kind.trim().to_ascii_lowercase().as_str() {
        "skill" => probe_skill_unit(root, id),
        "rule" => probe_rule_unit(root, id),
        "agent" => probe_simple_file(root, "agents", &format!("{id}.md")),
        "command" => probe_simple_file(root, "commands", &format!("{id}.md")),
        "hook" => probe_simple_file(root, "hooks", &format!("{id}.ps1")),
        _ => probe_skill_unit(root, id),
    }
}

fn rename_rule_inner(shell: &Path, old_id: &str, new_id: &str) -> Result<(), String> {
    if !shell.is_dir() {
        return Ok(());
    }
    let Ok(rd) = fs::read_dir(shell) else {
        return Ok(());
    };
    for ent in rd.flatten() {
        let name = ent.file_name();
        let name_s = name.to_string_lossy();
        let stem = Path::new(name_s.as_ref())
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        if !stem.eq_ignore_ascii_case(old_id) {
            continue;
        }
        let ext = crate::rule_layout::ext_from_path(&ent.path());
        let dest = shell.join(format!("{new_id}{ext}"));
        if !same_path(&ent.path(), &dest) {
            move_path(&ent.path(), &dest)?;
        }
    }
    Ok(())
}

fn rename_library_unit(
    library_root: &str,
    entry: &CatalogEntry,
    new_id: &str,
    new_rel: &str,
) -> Result<(), String> {
    let old_rel = entry.library_path.trim();
    if old_rel.is_empty() {
        return Ok(());
    }
    let old_abs = match resolve_library_safe_path(library_root, old_rel) {
        Ok(p) => p,
        Err(_) => return Ok(()),
    };
    let new_abs = resolve_library_safe_path(library_root, new_rel)
        .map_err(|e| format!("new library path: {e}"))?;

    let kind = entry.kind.as_str();
    if kind.eq_ignore_ascii_case("rule") {
        let old_present = path_present(&old_abs);
        let shell_old = if old_abs.is_dir() {
            Some(old_abs.clone())
        } else if let Some(parent) = old_abs.parent() {
            if parent
                .file_name()
                .map(|n| n.to_string_lossy().eq_ignore_ascii_case(&entry.id))
                .unwrap_or(false)
            {
                Some(parent.to_path_buf())
            } else {
                None
            }
        } else {
            None
        };
        let new_shell = new_abs
            .parent()
            .map(|p| p.to_path_buf())
            .ok_or_else(|| "rule nested path missing parent".to_string())?;
        if let Some(shell) = shell_old {
            if path_present(&shell) {
                move_path(&shell, &new_shell)?;
                rename_rule_inner(&new_shell, &entry.id, new_id)?;
                return Ok(());
            }
        }
        if old_present {
            if let Some(parent) = new_abs.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("mkdir rule shell: {e}"))?;
            }
            move_path(&old_abs, &new_abs)?;
        }
        return Ok(());
    }

    let old_unit = if kind.eq_ignore_ascii_case("skill") {
        skill_unit_path(&old_abs)
    } else {
        old_abs
    };
    let new_unit = if kind.eq_ignore_ascii_case("skill") {
        skill_unit_path(&new_abs)
    } else {
        new_abs
    };
    if path_present(&old_unit) {
        move_path(&old_unit, &new_unit)?;
    }
    Ok(())
}

fn rename_one_container(
    root: &str,
    old: &CatalogEntry,
    new: &CatalogEntry,
    library_src: &Path,
) -> Result<(), String> {
    let Some(old_unit) = locate_container_unit(root, &old.kind, &old.id) else {
        return Ok(());
    };
    let new_target = crate::deploy::canonical_deploy_target(new, root);
    let kind = old.kind.as_str();

    if kind.eq_ignore_ascii_case("rule") {
        let new_shell = new_target
            .parent()
            .map(|p| p.to_path_buf())
            .ok_or_else(|| "rule target missing parent".to_string())?;
        if is_symlink(&old_unit) {
            crate::deploy::remove_path_any(&old_unit)?;
            if old_unit
                .parent()
                .map(|p| {
                    p.file_name()
                        .map(|n| n.to_string_lossy().eq_ignore_ascii_case(&old.id))
                        .unwrap_or(false)
                })
                .unwrap_or(false)
            {
                let shell = old_unit.parent().unwrap();
                let _ = fs::remove_dir(shell);
            }
            crate::deploy::symlink_path(library_src, &new_target)?;
            return Ok(());
        }
        if old_unit.is_dir() {
            move_path(&old_unit, &new_shell)?;
            rename_rule_inner(&new_shell, &old.id, &new.id)?;
            return Ok(());
        }
        if let Some(parent) = new_target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
        }
        move_path(&old_unit, &new_target)?;
        return Ok(());
    }

    if is_symlink(&old_unit) {
        crate::deploy::remove_path_any(&old_unit)?;
        let dst = if kind.eq_ignore_ascii_case("skill") {
            skill_unit_path(&new_target)
        } else {
            new_target
        };
        crate::deploy::symlink_path(library_src, &dst)?;
        return Ok(());
    }

    let dst = if kind.eq_ignore_ascii_case("skill") {
        skill_unit_path(&new_target)
    } else {
        new_target
    };
    move_path(&old_unit, &dst)?;
    Ok(())
}

fn library_src_for(entry: &CatalogEntry, library_root: &str) -> Option<PathBuf> {
    let rel = entry.library_path.trim();
    if rel.is_empty() {
        return None;
    }
    let full = resolve_library_safe_path(library_root, rel).ok()?;
    if entry.kind.eq_ignore_ascii_case("skill") {
        Some(skill_unit_path(&full))
    } else {
        Some(full)
    }
}

fn disk_id_taken(library_root: &str, kind: &str, id: &str, sample_rel: &str) -> bool {
    if id.is_empty() {
        return false;
    }
    let rel = desired_library_rel(kind, id, sample_rel);
    let Ok(p) = resolve_library_safe_path(library_root, &rel) else {
        return false;
    };
    let unit = if kind.eq_ignore_ascii_case("skill") {
        skill_unit_path(&p)
    } else if kind.eq_ignore_ascii_case("rule") {
        p.parent().map(|x| x.to_path_buf()).unwrap_or(p)
    } else {
        p
    };
    path_present(&unit)
}

fn is_sr_kind_id(kind: &str, id: &str) -> bool {
    let prefix: String = id.chars().take(3).map(|c| c.to_ascii_uppercase()).collect();
    match kind.trim().to_ascii_lowercase().as_str() {
        "skill" => matches!(prefix.as_str(), "S0-" | "S1-" | "S2-" | "S0_" | "S1_" | "S2_"),
        "rule" => matches!(prefix.as_str(), "R0-" | "R1-" | "R2-" | "R0_" | "R1_" | "R2_"),
        _ => false,
    }
}

/// After a network item gains a customization diff, rename S*/R* → L* (one-way).
pub fn repath_if_customized_local(
    settings: &AppSettings,
    entry_id: &str,
) -> Result<Option<String>, String> {
    let lib = settings.skills_library_root.trim();
    if lib.is_empty() {
        return Ok(None);
    }
    let load = load_catalog(lib);
    let Some(entry) = load.catalog.entries.iter().find(|e| e.id == entry_id) else {
        return Ok(None);
    };
    if !crate::network_customization::has_customization_diff(lib, &entry.id) {
        return Ok(None);
    }
    if !is_sr_kind_id(&entry.kind, &entry.id) {
        return Ok(None);
    }
    let tags = get_entry_tags(entry);
    let inferred = tags.level.clone().or_else(|| {
        let chars: Vec<char> = entry.id.chars().collect();
        if chars.len() >= 2 && matches!(chars[1], '0' | '1' | '2') {
            Some(format!("L{}", chars[1]))
        } else {
            None
        }
    });
    let level = match inferred.as_deref() {
        Some("L0" | "L1" | "L2") => inferred.as_deref(),
        _ => None,
    };
    let out = set_level_and_repath(settings, entry_id, level)?;
    if out.renamed {
        Ok(Some(out.new_id))
    } else {
        Ok(None)
    }
}

/// Write level tag; rename library unit + container copies when the id scheme requires it.
pub fn set_level_and_repath(
    settings: &AppSettings,
    entry_id: &str,
    level: Option<&str>,
) -> Result<LevelSetOutcome, String> {
    let lib = settings.skills_library_root.trim();
    if lib.is_empty() || !settings.library_root_configured {
        return Err("请先配置永久库目录".into());
    }
    let load = load_catalog(lib);
    if !load.healthy {
        return Err(format!(
            "台账不可用: {}",
            load.error.unwrap_or_else(|| "unknown".into())
        ));
    }
    let old = load
        .catalog
        .entries
        .iter()
        .find(|e| e.id == entry_id)
        .cloned()
        .ok_or_else(|| format!("entry not found: {entry_id}"))?;
    let old_id = old.id.clone();

    let tag_level = match level {
        None => Some("uncategorized".to_string()),
        Some(s) if is_explicit_uncategorized(Some(s)) => Some("uncategorized".to_string()),
        Some(s) => Some(s.trim().to_ascii_uppercase()),
    };
    let level_for_id = match tag_level.as_deref() {
        Some("L0") | Some("L1") | Some("L2") => tag_level.as_deref(),
        _ => None,
    };

    if is_shared_hooks_json(&old) {
        let mut entry = old;
        let mut tags = get_entry_tags(&entry);
        tags.level = tag_level;
        set_entry_tags(&mut entry, tags);
        upsert_entry(lib, entry)?;
        return Ok(LevelSetOutcome {
            new_id: old_id,
            renamed: false,
            warnings: vec![],
        });
    }

    let taken: HashSet<String> = load
        .catalog
        .entries
        .iter()
        .filter(|e| e.id != old_id)
        .map(|e| e.id.clone())
        .collect();
    let origin = id_origin_for(lib, &old);
    let desired = desired_id(&old.kind, &old_id, level_for_id, origin);
    let sample_rel = old.library_path.clone();
    let kind = old.kind.clone();
    let new_id = unique_id(&taken, &desired, &old_id, |cand| {
        disk_id_taken(lib, &kind, cand, &sample_rel)
    });

    let mut entry = old.clone();
    let mut tags = get_entry_tags(&entry);
    tags.level = tag_level;
    set_entry_tags(&mut entry, tags);

    if new_id == old_id {
        upsert_entry(lib, entry)?;
        return Ok(LevelSetOutcome {
            new_id,
            renamed: false,
            warnings: vec![],
        });
    }

    let new_rel = desired_library_rel(&old.kind, &new_id, &old.library_path);
    rename_library_unit(lib, &old, &new_id, &new_rel)?;

    entry.id = new_id.clone();
    entry.library_path = new_rel.clone();
    if !entry.deployed_path.trim().is_empty() {
        entry.deployed_path = rewrite_path_id(&entry.deployed_path, &old_id, &new_id);
    }
    for o in &mut entry.origins {
        o.original_path = rewrite_path_id(&o.original_path, &old_id, &new_id);
    }

    let lib_src = library_src_for(&entry, lib);
    let mut warnings = Vec::new();
    for root in all_container_roots(settings) {
        let src = lib_src.as_deref().unwrap_or(Path::new(""));
        if let Err(e) = rename_one_container(&root, &old, &entry, src) {
            warnings.push(format!("{root}: {e}"));
        }
    }

    replace_entry_id(lib, &old_id, entry)?;
    let _ = crate::network_customization::relocate_customization(lib, &old_id, &new_id);
    with_session(|s| {
        for id in &mut s.selected_entry_ids {
            if *id == old_id {
                *id = new_id.clone();
            }
        }
    });

    Ok(LevelSetOutcome {
        new_id,
        renamed: true,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::{
        ensure_library_layout, get_entry_tags, load_catalog, set_entry_tags, upsert_entry,
        CatalogEntry,
    };
    use crate::workspace::WorkspaceConfig;
    use std::fs;

    #[test]
    fn strip_legacy_and_kind_prefixes() {
        assert_eq!(strip_kind_level_prefix("L0-i18n"), "i18n");
        assert_eq!(
            strip_kind_level_prefix("L0-01-thinking-and-explanation"),
            "01-thinking-and-explanation"
        );
        assert_eq!(
            strip_kind_level_prefix("L1D10-plan-review-reply"),
            "plan-review-reply"
        );
        assert_eq!(
            strip_kind_level_prefix("L1G90-software-product-discovery"),
            "software-product-discovery"
        );
        assert_eq!(strip_kind_level_prefix("L1-ccm-library-layout"), "ccm-library-layout");
        assert_eq!(strip_kind_level_prefix("S2-foo"), "foo");
        assert_eq!(strip_kind_level_prefix("S0-L0-i18n"), "i18n");
        assert_eq!(strip_kind_level_prefix("frontend-design"), "frontend-design");
    }

    #[test]
    fn desired_id_kind_and_level() {
        use IdOrigin::{Local, Network};
        assert_eq!(
            desired_id("skill", "L0-i18n", Some("L0"), Local),
            "L0-i18n"
        );
        assert_eq!(
            desired_id("skill", "L1D10-plan-review-reply", Some("L1"), Local),
            "L1D10-plan-review-reply"
        );
        assert_eq!(
            desired_id("skill", "L1G90-software-product-discovery", Some("L1"), Local),
            "L1G90-software-product-discovery"
        );
        assert_eq!(
            desired_id("skill", "L1D10-plan-review-reply", Some("L2"), Local),
            "L2-plan-review-reply"
        );
        assert_eq!(
            desired_id("rule", "L0-01-thinking-and-explanation", Some("L0"), Local),
            "L0-01-thinking-and-explanation"
        );
        assert_eq!(
            desired_id("skill", "hello", Some("L1"), Local),
            "L1-hello"
        );
        assert_eq!(
            desired_id("skill", "S2-foo", Some("L0"), Network),
            "S0-foo"
        );
        assert_eq!(
            desired_id("skill", "map-skill", Some("L1"), Network),
            "S1-map-skill"
        );
        assert_eq!(
            desired_id("rule", "foo", Some("L0"), Network),
            "R0-foo"
        );
        assert_eq!(
            desired_id("skill", "S1-foo", Some("L1"), Local),
            "L1-foo"
        );
        assert_eq!(desired_id("agent", "helper", Some("L2"), Local), "A2-helper");
        assert_eq!(desired_id("command", "do-it", Some("L1"), Network), "C1-do-it");
        assert_eq!(desired_id("hook", "on-save", Some("L2"), Local), "H2-on-save");
        assert_eq!(desired_id("skill", "S1-foo", None, Network), "foo");
        assert_eq!(desired_id("rule", "R0-bar", Some("未分类"), Network), "bar");
    }

    #[test]
    fn unique_id_skips_taken() {
        let mut taken = HashSet::new();
        taken.insert("S1-foo".into());
        let id = unique_id(&taken, "S1-foo", "other", |_| false);
        assert_eq!(id, "S1-foo-2");
        let id2 = unique_id(&taken, "S1-foo", "S1-foo", |_| false);
        assert_eq!(id2, "S1-foo");
    }

    #[test]
    fn set_level_renames_skill_dir_and_container_copy() {
        let lib_dir = tempfile::tempdir().unwrap();
        let cont_dir = tempfile::tempdir().unwrap();
        let lib = lib_dir.path().to_string_lossy().to_string();
        let cont = cont_dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib).unwrap();
        fs::create_dir_all(lib_dir.path().join("skills/L1D10-plan-review-reply")).unwrap();
        fs::write(
            lib_dir.path().join("skills/L1D10-plan-review-reply/SKILL.md"),
            b"# plan\n",
        )
        .unwrap();
        fs::create_dir_all(cont_dir.path().join("skills/L1D10-plan-review-reply")).unwrap();
        fs::write(
            cont_dir.path().join("skills/L1D10-plan-review-reply/SKILL.md"),
            b"# plan\n",
        )
        .unwrap();
        upsert_entry(
            &lib,
            CatalogEntry {
                id: "L1D10-plan-review-reply".into(),
                kind: "skill".into(),
                library_path: "skills/L1D10-plan-review-reply".into(),
                is_in_library: true,
                deployed_path: cont_dir
                    .path()
                    .join("skills/L1D10-plan-review-reply")
                    .to_string_lossy()
                    .to_string(),
                ..Default::default()
            },
        )
        .unwrap();

        let settings = AppSettings {
            skills_library_root: lib.clone(),
            library_root_configured: true,
            workspaces: vec![WorkspaceConfig {
                id: "cursor".into(),
                enabled: true,
                in_work_area: true,
                display_name: "Cursor".into(),
                container_root: cont.clone(),
            }],
            ..Default::default()
        };
        let out = set_level_and_repath(&settings, "L1D10-plan-review-reply", Some("L1")).unwrap();
        assert_eq!(out.new_id, "L1D10-plan-review-reply");
        assert!(!out.renamed);
        assert!(lib_dir
            .path()
            .join("skills/L1D10-plan-review-reply/SKILL.md")
            .is_file());
        assert!(cont_dir
            .path()
            .join("skills/L1D10-plan-review-reply/SKILL.md")
            .is_file());
        let load = load_catalog(&lib);
        let e = load
            .catalog
            .entries
            .iter()
            .find(|e| e.id == "L1D10-plan-review-reply")
            .unwrap();
        assert_eq!(
            e.library_path.replace('\\', "/"),
            "skills/L1D10-plan-review-reply"
        );
        let tags = get_entry_tags(e);
        assert_eq!(tags.level.as_deref(), Some("L1"));
    }

    #[test]
    fn set_level_renames_rule_shell_and_inner_file() {
        let lib_dir = tempfile::tempdir().unwrap();
        let lib = lib_dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib).unwrap();
        let nested = lib_dir
            .path()
            .join("rules/L0-01-thinking-and-explanation/L0-01-thinking-and-explanation.mdc");
        fs::create_dir_all(nested.parent().unwrap()).unwrap();
        fs::write(&nested, b"# rule\n").unwrap();
        upsert_entry(
            &lib,
            CatalogEntry {
                id: "L0-01-thinking-and-explanation".into(),
                kind: "rule".into(),
                library_path: "rules/L0-01-thinking-and-explanation/L0-01-thinking-and-explanation.mdc"
                    .into(),
                is_in_library: true,
                ..Default::default()
            },
        )
        .unwrap();
        let settings = AppSettings {
            skills_library_root: lib.clone(),
            library_root_configured: true,
            ..Default::default()
        };
        let out = set_level_and_repath(&settings, "L0-01-thinking-and-explanation", Some("L0")).unwrap();
        assert_eq!(out.new_id, "L0-01-thinking-and-explanation");
        assert!(!out.renamed);
        assert!(nested.is_file());
    }

    #[test]
    fn clear_level_strips_prefix() {
        let lib_dir = tempfile::tempdir().unwrap();
        let lib = lib_dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib).unwrap();
        fs::create_dir_all(lib_dir.path().join("skills/S2-foo")).unwrap();
        fs::write(lib_dir.path().join("skills/S2-foo/SKILL.md"), b"# foo\n").unwrap();
        upsert_entry(
            &lib,
            CatalogEntry {
                id: "S2-foo".into(),
                kind: "skill".into(),
                library_path: "skills/S2-foo".into(),
                is_in_library: true,
                ..Default::default()
            },
        )
        .unwrap();
        let settings = AppSettings {
            skills_library_root: lib.clone(),
            library_root_configured: true,
            ..Default::default()
        };
        let out = set_level_and_repath(&settings, "S2-foo", None).unwrap();
        assert_eq!(out.new_id, "foo");
        assert!(lib_dir.path().join("skills/foo/SKILL.md").is_file());
        let load = load_catalog(&lib);
        let e = load.catalog.entries.iter().find(|e| e.id == "foo").unwrap();
        assert_eq!(get_entry_tags(e).level.as_deref(), Some("uncategorized"));
    }

    #[test]
    fn set_level_network_skill_uses_s_prefix() {
        let lib_dir = tempfile::tempdir().unwrap();
        let lib = lib_dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib).unwrap();
        fs::create_dir_all(lib_dir.path().join("skills/map-skill")).unwrap();
        fs::write(
            lib_dir.path().join("skills/map-skill/SKILL.md"),
            b"# map\n",
        )
        .unwrap();
        let mut entry = CatalogEntry {
            id: "map-skill".into(),
            kind: "skill".into(),
            library_path: "skills/map-skill".into(),
            is_in_library: true,
            ..Default::default()
        };
        crate::network_customization::set_provenance(
            &mut entry,
            &crate::network_customization::NetworkProvenance {
                source_url: "https://example.com/demo.git".into(),
                source_id: "demo".into(),
                skill_name: "map-skill".into(),
                network_entry_id: "net:demo:map-skill".into(),
                ..Default::default()
            },
        );
        upsert_entry(&lib, entry).unwrap();
        let settings = AppSettings {
            skills_library_root: lib.clone(),
            library_root_configured: true,
            ..Default::default()
        };
        let out = set_level_and_repath(&settings, "map-skill", Some("L1")).unwrap();
        assert_eq!(out.new_id, "S1-map-skill");
        assert!(out.renamed);
        assert!(lib_dir
            .path()
            .join("skills/S1-map-skill/SKILL.md")
            .is_file());
    }

    #[test]
    fn repath_customized_network_skill_to_l() {
        let lib_dir = tempfile::tempdir().unwrap();
        let lib = lib_dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib).unwrap();
        fs::create_dir_all(lib_dir.path().join("skills/S1-map-skill")).unwrap();
        fs::write(
            lib_dir.path().join("skills/S1-map-skill/SKILL.md"),
            b"# Map skill\n\noriginal\n",
        )
        .unwrap();
        let mut entry = CatalogEntry {
            id: "S1-map-skill".into(),
            kind: "skill".into(),
            library_path: "skills/S1-map-skill".into(),
            is_in_library: true,
            ..Default::default()
        };
        crate::network_customization::set_provenance(
            &mut entry,
            &crate::network_customization::NetworkProvenance {
                source_url: "https://example.com/demo.git".into(),
                source_id: "demo".into(),
                skill_name: "map-skill".into(),
                network_entry_id: "net:demo:map-skill".into(),
                baseline_content_hash: "abc".into(),
                ..Default::default()
            },
        );
        let mut tags = get_entry_tags(&entry);
        tags.level = Some("L1".into());
        set_entry_tags(&mut entry, tags);
        upsert_entry(&lib, entry).unwrap();
        crate::network_customization::seed_baseline_on_promote(
            &lib,
            "S1-map-skill",
            "# Map skill\n\noriginal\n",
            "abc",
        )
        .unwrap();
        let settings = AppSettings {
            skills_library_root: lib.clone(),
            library_root_configured: true,
            ..Default::default()
        };
        let msg = crate::network_customization::record_after_library_save(
            &lib,
            "S1-map-skill",
            "# Map skill\n\noriginal\nmy customization\n",
        )
        .unwrap();
        assert!(msg.is_some());
        let new_id = repath_if_customized_local(&settings, "S1-map-skill")
            .unwrap()
            .expect("renamed");
        assert_eq!(new_id, "L1-map-skill");
        assert!(lib_dir
            .path()
            .join("skills/L1-map-skill/SKILL.md")
            .is_file());
        assert!(!lib_dir.path().join("skills/S1-map-skill").exists());
        assert!(crate::network_customization::customization_path(&lib, "L1-map-skill").is_file());
        assert!(!crate::network_customization::customization_path(&lib, "S1-map-skill").exists());
    }
}
