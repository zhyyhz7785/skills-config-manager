//! List partitioning + cluster tree (align Electron catalog filters / buildClusterTree).

use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::Path;

use crate::active_container::{is_path_in_active_container_tree, is_user_global_container_root};
use crate::catalog::{get_entry_tags, CatalogEntry, CatalogProject};
use crate::path_guard::resolve_library_safe_path;
use crate::project_discovery::normalize_path;

const UNCATEGORIZED_ROOT: &str = "uncategorized";
const UNCATEGORIZED_LABEL: &str = "未分类";

pub fn library_content_exists(library_root: &str, entry: &CatalogEntry) -> bool {
    let rel = entry.library_path.trim();
    if rel.is_empty() {
        return false;
    }
    resolve_library_safe_path(library_root, rel)
        .map(|p| p.exists())
        .unwrap_or(false)
}

fn last_container_path(entry: &CatalogEntry) -> String {
    entry
        .extra
        .get("lastContainerPath")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string()
}

pub fn find_live_path_in_active_container(
    entry: &CatalogEntry,
    library_root: &str,
    container_root: &str,
    user_global: bool,
) -> Option<String> {
    if container_root.trim().is_empty() {
        return None;
    }
    let d = entry.deployed_path.trim();
    if !d.is_empty() && Path::new(d).exists() {
        if is_path_in_active_container_tree(d, container_root, user_global) {
            return Some(d.to_string());
        }
    }
    for o in &entry.origins {
        let p = o.original_path.trim();
        if p.is_empty() {
            continue;
        }
        if !library_root.trim().is_empty()
            && (normalize_path(p) == normalize_path(library_root)
                || normalize_path(p).starts_with(&(normalize_path(library_root) + "\\")))
        {
            continue;
        }
        if !Path::new(p).exists() {
            continue;
        }
        if is_path_in_active_container_tree(p, container_root, user_global) {
            return Some(p.to_string());
        }
    }
    // Rule layout probe: flat or nested under container rules/
    if entry.kind.eq_ignore_ascii_case("rule") {
        if let Some(p) = crate::rule_layout::probe_rule_in_container(container_root, &entry.id) {
            let s = p.to_string_lossy().to_string();
            if is_path_in_active_container_tree(&s, container_root, user_global) {
                return Some(s);
            }
        }
    }
    None
}

fn has_history_with_container(
    entry: &CatalogEntry,
    library_root: &str,
    container_root: &str,
) -> bool {
    if container_root.trim().is_empty() {
        return false;
    }
    let user_global = is_user_global_container_root(container_root);
    let last = last_container_path(entry);
    if !last.is_empty() && is_path_in_active_container_tree(&last, container_root, user_global) {
        return true;
    }
    for o in &entry.origins {
        let p = o.original_path.trim();
        if p.is_empty() {
            continue;
        }
        if !library_root.trim().is_empty()
            && (normalize_path(p) == normalize_path(library_root)
                || normalize_path(p).starts_with(&(normalize_path(library_root) + "\\")))
        {
            continue;
        }
        if is_path_in_active_container_tree(p, container_root, user_global) {
            return true;
        }
    }
    false
}

pub fn filter_deployed_in_container<'a>(
    entries: &'a [CatalogEntry],
    container_root: &str,
    user_global: bool,
) -> Vec<&'a CatalogEntry> {
    entries
        .iter()
        .filter(|e| !e.is_missing)
        .filter(|e| {
            find_live_path_in_active_container(e, "", container_root, user_global).is_some()
        })
        .collect()
}

pub fn filter_history_for_container<'a>(
    entries: &'a [CatalogEntry],
    library_root: &str,
    container_root: &str,
) -> Vec<&'a CatalogEntry> {
    let user_global = is_user_global_container_root(container_root);
    entries
        .iter()
        .filter(|e| !e.is_missing)
        .filter(|e| library_content_exists(library_root, e))
        .filter(|e| has_history_with_container(e, library_root, container_root))
        .filter(|e| {
            find_live_path_in_active_container(e, library_root, container_root, user_global)
                .is_none()
        })
        .collect()
}

pub fn filter_permanent_library<'a>(
    entries: &'a [CatalogEntry],
    library_root: &str,
) -> Vec<&'a CatalogEntry> {
    let mut out: Vec<&CatalogEntry> = entries
        .iter()
        .filter(|e| !e.is_missing)
        .filter(|e| library_content_exists(library_root, e))
        .collect();
    out.sort_by(|a, b| a.id.to_lowercase().cmp(&b.id.to_lowercase()));
    out
}

fn derive_level(entry: &CatalogEntry) -> Option<String> {
    let tags = get_entry_tags(entry);
    if let Some(l) = tags.level.as_ref() {
        let u = l.trim().to_uppercase();
        if u == "L0" || u == "L1" || u == "L2" {
            return Some(u);
        }
    }
    let scope = tags.scope.to_lowercase();
    if scope.starts_with("project:") {
        return Some("L2".into());
    }
    if entry.kind.eq_ignore_ascii_case("rule") && scope == "global" {
        return Some("L0".into());
    }
    None
}

fn derive_cluster_root(entry: &CatalogEntry) -> String {
    derive_level(entry).unwrap_or_else(|| UNCATEGORIZED_ROOT.into())
}

fn primary_purpose(entry: &CatalogEntry) -> String {
    let tags = get_entry_tags(entry);
    tags.purposes
        .first()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "未分类".into())
}

fn project_scope_id(entry: &CatalogEntry) -> Option<String> {
    let tags = get_entry_tags(entry);
    let s = tags.scope.trim();
    if let Some(rest) = s.strip_prefix("project:") {
        let id = rest.trim();
        if !id.is_empty() {
            return Some(id.to_string());
        }
    }
    None
}

fn derive_group(entry: &CatalogEntry, project_names: &BTreeMap<String, String>) -> String {
    let Some(level) = derive_level(entry) else {
        return String::new();
    };
    if level == "L0" {
        return String::new();
    }
    if level == "L2" {
        if let Some(pid) = project_scope_id(entry) {
            if let Some(name) = project_names.get(&pid) {
                return format!("项目 / {name}");
            }
            return format!("项目 / {pid}");
        }
        return "项目 / 其它".into();
    }
    // L1
    let purpose = primary_purpose(entry);
    if purpose != "未分类" {
        return purpose;
    }
    String::new()
}

fn format_leaf_name(entry: &CatalogEntry) -> String {
    if !entry.id.trim().is_empty() {
        entry.id.clone()
    } else {
        entry.library_path.clone()
    }
}

fn resolve_project_region_key(
    entry: &CatalogEntry,
    project_names: &BTreeMap<String, String>,
) -> String {
    if let Some(pid) = project_scope_id(entry) {
        if project_names.contains_key(&pid) {
            return format!("project:{pid}");
        }
        return format!("project:{pid}");
    }
    let tags = get_entry_tags(entry);
    if tags.scope.eq_ignore_ascii_case("global") {
        return "global".into();
    }
    "library".into()
}

fn scope_display_name(scope: &str, project_names: &BTreeMap<String, String>) -> String {
    if scope == "global" {
        return "用户级".into();
    }
    if scope == "library" {
        return "永久库（仅库内）".into();
    }
    if let Some(pid) = scope.strip_prefix("project:") {
        if let Some(name) = project_names.get(pid) {
            return name.clone();
        }
        return pid.to_string();
    }
    scope.to_string()
}

fn leaf_node(entry: &CatalogEntry) -> Value {
    json!({
        "name": format_leaf_name(entry),
        "isGroup": false,
        "entryId": entry.id,
        "scopeKey": null,
        "isExpanded": true,
        "children": []
    })
}

/// Electron `buildClusterTree` → DTO JSON nodes.
pub fn build_cluster_tree(
    entries: &[&CatalogEntry],
    cluster_mode_index: i32,
    projects: &[CatalogProject],
) -> Vec<Value> {
    let mut project_names = BTreeMap::new();
    for p in projects {
        project_names.insert(p.id.clone(), p.name.clone());
    }

    if cluster_mode_index == 2 {
        return vec![];
    }

    if cluster_mode_index == 1 {
        let mut group_map: BTreeMap<String, Vec<&CatalogEntry>> = BTreeMap::new();
        for e in entries {
            let key = resolve_project_region_key(e, &project_names);
            group_map.entry(key).or_default().push(*e);
        }
        let mut fixed = vec!["global".to_string(), "library".to_string()];
        for p in projects {
            fixed.push(format!("project:{}", p.id));
        }
        let mut extras: Vec<String> = group_map
            .keys()
            .filter(|k| !fixed.contains(k))
            .cloned()
            .collect();
        extras.sort();
        let order: Vec<String> = fixed.into_iter().chain(extras).collect();
        let mut roots = Vec::new();
        for scope in order {
            let group = group_map.get(&scope).cloned().unwrap_or_default();
            if group.is_empty() && !scope.starts_with("project:") && scope != "global" && scope != "library"
            {
                continue;
            }
            if group.is_empty() && scope.starts_with("project:") {
                // keep empty registered project buckets like Electron
            }
            let mut children = Vec::new();
            let mut sorted = group;
            sorted.sort_by(|a, b| a.id.cmp(&b.id));
            for leaf in sorted {
                children.push(leaf_node(leaf));
            }
            roots.push(json!({
                "name": scope_display_name(&scope, &project_names),
                "isGroup": true,
                "entryId": null,
                "scopeKey": scope,
                "isExpanded": true,
                "children": children,
            }));
        }
        return roots;
    }

    // mode 0: L0 / L1 / L2 / uncategorized
    let level_order = ["L0", "L1", "L2", UNCATEGORIZED_ROOT];
    let mut nested: BTreeMap<String, BTreeMap<String, Vec<&CatalogEntry>>> = BTreeMap::new();
    for level in level_order {
        nested.insert(level.to_string(), BTreeMap::new());
    }
    for e in entries {
        let root = derive_cluster_root(e);
        let flat = root == "L0" || root == UNCATEGORIZED_ROOT;
        let sub = if flat {
            String::new()
        } else {
            derive_group(e, &project_names)
        };
        nested
            .entry(root)
            .or_default()
            .entry(sub)
            .or_default()
            .push(*e);
    }

    let mut roots = Vec::new();
    for level in level_order {
        let name = if level == UNCATEGORIZED_ROOT {
            UNCATEGORIZED_LABEL
        } else {
            level
        };
        let mut children = Vec::new();
        let sub_map = nested.get(level).cloned().unwrap_or_default();
        for (key, group) in sub_map {
            let mut leaves: Vec<Value> = {
                let mut g = group;
                g.sort_by(|a, b| a.id.cmp(&b.id));
                g.into_iter().map(leaf_node).collect()
            };
            let flat = level == "L0" || level == UNCATEGORIZED_ROOT;
            if key.is_empty() || flat {
                children.append(&mut leaves);
            } else {
                children.push(json!({
                    "name": key,
                    "isGroup": true,
                    "entryId": null,
                    "scopeKey": format!("{level}/{key}"),
                    "isExpanded": true,
                    "children": leaves,
                }));
            }
        }
        roots.push(json!({
            "name": name,
            "isGroup": true,
            "entryId": null,
            "scopeKey": level,
            "isExpanded": true,
            "children": children,
        }));
    }
    roots
}
