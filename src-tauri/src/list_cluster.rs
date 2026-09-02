//! List partitioning + cluster tree (align Electron catalog filters / buildClusterTree).

use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::active_container::is_path_in_active_container_tree;
use crate::catalog::{get_entry_tags, set_entry_tags, CatalogEntry, CatalogProject};
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
        .map(|p| {
            if entry.kind.eq_ignore_ascii_case("skill") {
                crate::skill_layout::skill_unit_path(&p).exists()
            } else {
                p.exists()
            }
        })
        .unwrap_or(false)
}

/// 活动容器下 skill 约定路径探测（不依赖可能过期的 deployedPath）。
/// 目录型 skill 返回 `skills/{id}/`（整单元）；`.skill` 包返回文件。
pub fn probe_skill_in_container(container_root: &str, entry_id: &str) -> Option<PathBuf> {
    let root = Path::new(container_root.trim());
    let id = entry_id.trim();
    if !root.is_dir() || id.is_empty() {
        return None;
    }
    let skill_zip = root.join("skills").join(format!("{id}.skill"));
    if skill_zip.is_file() {
        return Some(skill_zip);
    }
    let skill_dir = root.join("skills").join(id);
    if skill_dir.is_dir() {
        return Some(skill_dir);
    }
    None
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
            let live = if entry.kind.eq_ignore_ascii_case("skill") {
                crate::skill_layout::skill_unit_path(Path::new(d)).to_string_lossy().to_string()
            } else {
                d.to_string()
            };
            return Some(live);
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
            let live = if entry.kind.eq_ignore_ascii_case("skill") {
                crate::skill_layout::skill_unit_path(Path::new(p)).to_string_lossy().to_string()
            } else {
                p.to_string()
            };
            return Some(live);
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
    // Skill：磁盘约定路径（台账 deployedPath 过期时仍能进「容器中」）
    if entry.kind.eq_ignore_ascii_case("skill") {
        if let Some(p) = probe_skill_in_container(container_root, &entry.id) {
            let s = p.to_string_lossy().to_string();
            if is_path_in_active_container_tree(&s, container_root, user_global) {
                return Some(s);
            }
        }
    }
    None
}

pub fn filter_deployed_in_container<'a>(
    entries: &'a [CatalogEntry],
    library_root: &str,
    container_root: &str,
    user_global: bool,
) -> Vec<&'a CatalogEntry> {
    let mut out: Vec<&CatalogEntry> = entries
        .iter()
        .filter(|e| !e.is_missing)
        .filter(|e| {
            find_live_path_in_active_container(e, library_root, container_root, user_global)
                .is_some()
        })
        .collect();
    out.sort_by(|a, b| {
        crate::catalog::entry_sort_key(a).cmp(&crate::catalog::entry_sort_key(b))
    });
    out
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
    out.sort_by(|a, b| {
        crate::catalog::entry_sort_key(a).cmp(&crate::catalog::entry_sort_key(b))
    });
    out
}

/// 从 id 前缀推断 L0/L1/L2（仅当台账未标 level 时使用）。
pub fn infer_level_from_id(id: &str) -> Option<String> {
    let s = id.trim();
    if s.is_empty() {
        return None;
    }
    let u = s.to_uppercase();
    if u.len() >= 3 {
        let b = u.as_bytes();
        if matches!(b[0], b'S' | b'R' | b'A' | b'C' | b'H')
            && matches!(b[1], b'0' | b'1' | b'2')
            && (b[2] == b'-' || b[2] == b'_')
        {
            return Some(format!("L{}", b[1] as char));
        }
    }
    if u.starts_with("L0-") || u.starts_with("L0_") {
        return Some("L0".into());
    }
    if u.starts_with("L2-") || u.starts_with("L2_") || u == "L2" {
        return Some("L2".into());
    }
    // L1 / L1D10 / L1G90 / L1-…
    if u.starts_with("L1") {
        return Some("L1".into());
    }
    None
}

/// 有效层级：tags.level 优先，否则 scope 启发，再否则 id 前缀推断。
pub fn effective_level(entry: &CatalogEntry) -> Option<String> {
    let tags = get_entry_tags(entry);
    if let Some(l) = tags.level.as_ref() {
        let u = l.trim().to_uppercase();
        if u == "L0" || u == "L1" || u == "L2" {
            return Some(u);
        }
        if crate::level_id::is_explicit_uncategorized(Some(l)) {
            return None;
        }
    }
    let scope = tags.scope.to_lowercase();
    if scope.starts_with("project:") {
        return Some("L2".into());
    }
    if entry.kind.eq_ignore_ascii_case("rule") && scope == "global" {
        return Some("L0".into());
    }
    infer_level_from_id(&entry.id)
}

fn derive_cluster_root(entry: &CatalogEntry) -> String {
    effective_level(entry).unwrap_or_else(|| UNCATEGORIZED_ROOT.into())
}

/// Stable region key matching ClusterNodeDto.scopeKey (for reorder / drop).
pub fn library_region_key(
    entry: &CatalogEntry,
    cluster_mode_index: i32,
    projects: &[CatalogProject],
) -> String {
    if cluster_mode_index == 2 {
        return "__flat__".into();
    }
    let mut project_names = BTreeMap::new();
    for p in projects {
        project_names.insert(p.id.clone(), p.name.clone());
    }
    if cluster_mode_index == 1 {
        return resolve_project_region_key(entry, &project_names);
    }
    derive_cluster_root(entry)
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

/// 台账缺 level 且可从 id 推断时写入 tags（供扫描入库一次落盘）。
pub fn apply_inferred_level_if_missing(entry: &mut CatalogEntry) {
    let tags = get_entry_tags(entry);
    if tags
        .level
        .as_ref()
        .map(|s| {
            let u = s.trim().to_uppercase();
            u == "L0" || u == "L1" || u == "L2"
        })
        .unwrap_or(false)
    {
        return;
    }
    if crate::level_id::is_explicit_uncategorized(tags.level.as_deref()) {
        return;
    }
    let Some(lv) = infer_level_from_id(&entry.id) else {
        return;
    };
    let mut t = tags;
    t.level = Some(lv);
    set_entry_tags(entry, t);
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
            sorted.sort_by(|a, b| {
                crate::catalog::entry_sort_key(a).cmp(&crate::catalog::entry_sort_key(b))
            });
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

    // mode 0: L0 / L1 / L2 / 未分类，叶子直接挂在层级下（不再按用途/项目分子组）
    let level_order = ["L0", "L1", "L2", UNCATEGORIZED_ROOT];
    let mut buckets: BTreeMap<String, Vec<&CatalogEntry>> = BTreeMap::new();
    for level in level_order {
        buckets.insert(level.to_string(), Vec::new());
    }
    for e in entries {
        let root = derive_cluster_root(e);
        buckets.entry(root).or_default().push(*e);
    }

    let mut roots = Vec::new();
    for level in level_order {
        let name = if level == UNCATEGORIZED_ROOT {
            UNCATEGORIZED_LABEL
        } else {
            level
        };
        let mut group = buckets.get(level).cloned().unwrap_or_default();
        group.sort_by(|a, b| {
            crate::catalog::entry_sort_key(a).cmp(&crate::catalog::entry_sort_key(b))
        });
        let children: Vec<Value> = group.into_iter().map(leaf_node).collect();
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn infer_level_l1d10_without_tags() {
        let entry = CatalogEntry {
            id: "L1D10-check-design-statement".into(),
            kind: "skill".into(),
            library_path: "skills/L1D10-check-design-statement/SKILL.md".into(),
            is_in_library: true,
            ..Default::default()
        };
        assert_eq!(effective_level(&entry).as_deref(), Some("L1"));
        assert_eq!(derive_cluster_root(&entry), "L1");
        assert_eq!(
            infer_level_from_id("l1d10-engineering-calculation-quality").as_deref(),
            Some("L1")
        );
        assert_eq!(infer_level_from_id("L0-core-logic-doc").as_deref(), Some("L0"));
        assert_eq!(infer_level_from_id("L2-foo").as_deref(), Some("L2"));
        assert_eq!(infer_level_from_id("S0-i18n").as_deref(), Some("L0"));
        assert_eq!(infer_level_from_id("R1-ccm-library-layout").as_deref(), Some("L1"));
        assert_eq!(infer_level_from_id("A2-helper").as_deref(), Some("L2"));
    }

    #[test]
    fn explicit_uncategorized_skips_rule_global_heuristic() {
        let mut e = CatalogEntry {
            id: "01-thinking-and-explanation".into(),
            kind: "rule".into(),
            library_path: "rules/01-thinking-and-explanation/01-thinking-and-explanation.mdc".into(),
            is_in_library: true,
            ..Default::default()
        };
        let mut tags = get_entry_tags(&e);
        tags.scope = "global".into();
        tags.level = Some("uncategorized".into());
        set_entry_tags(&mut e, tags);
        assert_eq!(effective_level(&e), None);
        assert_eq!(derive_cluster_root(&e), UNCATEGORIZED_ROOT);
    }

    #[test]
    fn mode0_tree_has_no_purpose_or_project_subfolders() {
        let mut e = CatalogEntry {
            id: "foo-skill".into(),
            kind: "skill".into(),
            library_path: "skills/foo-skill/SKILL.md".into(),
            is_in_library: true,
            ..Default::default()
        };
        let mut tags = get_entry_tags(&e);
        tags.level = Some("L1".into());
        tags.purposes = vec!["规范".into()];
        set_entry_tags(&mut e, tags);
        assert_eq!(library_region_key(&e, 0, &[]), "L1");
        let tree = build_cluster_tree(&[&e], 0, &[]);
        let l1 = tree
            .iter()
            .find(|n| n["scopeKey"] == "L1")
            .expect("L1 group");
        let children = l1["children"].as_array().expect("children");
        assert_eq!(children.len(), 1);
        assert_eq!(children[0]["isGroup"], false);
        assert_eq!(children[0]["entryId"], "foo-skill");
        assert!(children.iter().all(|c| c["isGroup"] == false));
    }

    #[test]
    fn mode0_l0_lists_rules_before_skills() {
        let mut skill = CatalogEntry {
            id: "a-skill".into(),
            kind: "skill".into(),
            library_path: "skills/a-skill/SKILL.md".into(),
            is_in_library: true,
            ..Default::default()
        };
        let mut rule = CatalogEntry {
            id: "z-rule".into(),
            kind: "rule".into(),
            library_path: "rules/z-rule/z-rule.mdc".into(),
            is_in_library: true,
            ..Default::default()
        };
        let mut st = get_entry_tags(&skill);
        st.level = Some("L0".into());
        set_entry_tags(&mut skill, st);
        let mut rt = get_entry_tags(&rule);
        rt.level = Some("L0".into());
        set_entry_tags(&mut rule, rt);
        let tree = build_cluster_tree(&[&skill, &rule], 0, &[]);
        let l0 = tree
            .iter()
            .find(|n| n["scopeKey"] == "L0")
            .expect("L0 group");
        let children = l0["children"].as_array().expect("children");
        assert_eq!(children.len(), 2);
        assert_eq!(children[0]["entryId"], "z-rule");
        assert_eq!(children[1]["entryId"], "a-skill");
    }

    #[test]
    fn tagged_level_not_overridden_by_id_prefix() {
        let mut entry = CatalogEntry {
            id: "L1D10-actually-l0".into(),
            kind: "skill".into(),
            library_path: "skills/L1D10-actually-l0/SKILL.md".into(),
            is_in_library: true,
            ..Default::default()
        };
        let mut tags = get_entry_tags(&entry);
        tags.level = Some("L0".into());
        set_entry_tags(&mut entry, tags);
        assert_eq!(effective_level(&entry).as_deref(), Some("L0"));
        assert_eq!(derive_cluster_root(&entry), "L0");
    }

    #[test]
    fn apply_inferred_level_writes_tags_once() {
        let mut entry = CatalogEntry {
            id: "L1G90-software-product-discovery".into(),
            kind: "skill".into(),
            ..Default::default()
        };
        apply_inferred_level_if_missing(&mut entry);
        assert_eq!(get_entry_tags(&entry).level.as_deref(), Some("L1"));
        // 再写不应覆盖已有
        let mut tags = get_entry_tags(&entry);
        tags.level = Some("L2".into());
        set_entry_tags(&mut entry, tags);
        apply_inferred_level_if_missing(&mut entry);
        assert_eq!(get_entry_tags(&entry).level.as_deref(), Some("L2"));
    }

    #[test]
    fn probe_skill_finds_skill_md_without_deployed_path() {
        let dir = tempfile::tempdir().unwrap();
        let container = dir.path().join(".cursor");
        let skill_md = container.join("skills/foo/SKILL.md");
        fs::create_dir_all(skill_md.parent().unwrap()).unwrap();
        fs::write(&skill_md, b"# foo\n").unwrap();

        let entry = CatalogEntry {
            id: "foo".into(),
            kind: "skill".into(),
            library_path: "skills/foo/SKILL.md".into(),
            deployed_path: String::new(),
            is_in_library: true,
            ..Default::default()
        };
        let live = find_live_path_in_active_container(
            &entry,
            &dir.path().join("lib").to_string_lossy(),
            &container.to_string_lossy(),
            true,
        );
        assert!(
            live.as_ref().is_some_and(|p| {
                let pl = p.replace('/', "\\").to_lowercase();
                pl.ends_with("\\skills\\foo") || pl.ends_with("/skills/foo")
            }),
            "expected skill directory unit, got {live:?}"
        );
        let entries = [entry];
        let hit = filter_deployed_in_container(
            &entries,
            &dir.path().join("lib").to_string_lossy(),
            &container.to_string_lossy(),
            true,
        );
        assert_eq!(hit.len(), 1);
        assert_eq!(hit[0].id, "foo");
    }

    #[test]
    fn probe_skill_prefers_disk_when_deployed_elsewhere() {
        let dir = tempfile::tempdir().unwrap();
        let container = dir.path().join(".cursor");
        let skill_md = container.join("skills/bar/SKILL.md");
        fs::create_dir_all(skill_md.parent().unwrap()).unwrap();
        fs::write(&skill_md, b"# bar\n").unwrap();
        let other = dir.path().join("OtherProj/.cursor/skills/bar/SKILL.md");
        fs::create_dir_all(other.parent().unwrap()).unwrap();
        fs::write(&other, b"# other\n").unwrap();

        let entry = CatalogEntry {
            id: "bar".into(),
            kind: "skill".into(),
            library_path: "skills/bar/SKILL.md".into(),
            deployed_path: other.to_string_lossy().to_string(),
            is_in_library: true,
            ..Default::default()
        };
        let live = find_live_path_in_active_container(
            &entry,
            &dir.path().join("lib").to_string_lossy(),
            &container.to_string_lossy(),
            true,
        )
        .expect("should find container copy");
        assert!(
            live.to_lowercase().contains(".cursor")
                && live.to_lowercase().contains("bar"),
            "{live}"
        );
        // 活动容器路径应命中本容器，而非 OtherProj
        assert!(!live.to_lowercase().contains("otherproj"), "{live}");
    }

    #[test]
    fn no_live_when_only_deployed_elsewhere() {
        let dir = tempfile::tempdir().unwrap();
        let container = dir.path().join(".cursor");
        fs::create_dir_all(container.join("skills")).unwrap();
        let other = dir.path().join("OtherProj/.cursor/skills/only-elsewhere/SKILL.md");
        fs::create_dir_all(other.parent().unwrap()).unwrap();
        fs::write(&other, b"# x\n").unwrap();

        let entry = CatalogEntry {
            id: "only-elsewhere".into(),
            kind: "skill".into(),
            library_path: "skills/only-elsewhere/SKILL.md".into(),
            deployed_path: other.to_string_lossy().to_string(),
            is_in_library: true,
            ..Default::default()
        };
        let live = find_live_path_in_active_container(
            &entry,
            &dir.path().join("lib").to_string_lossy(),
            &container.to_string_lossy(),
            true,
        );
        assert!(live.is_none(), "{live:?}");
        let entries = [entry];
        let hit = filter_deployed_in_container(
            &entries,
            &dir.path().join("lib").to_string_lossy(),
            &container.to_string_lossy(),
            true,
        );
        assert!(hit.is_empty());
    }

    #[test]
    fn filter_skips_origin_under_library_root() {
        let dir = tempfile::tempdir().unwrap();
        let lib = dir.path().join("lib");
        let container = dir.path().join(".cursor");
        fs::create_dir_all(container.join("skills")).unwrap();
        let lib_skill = lib.join("skills/libonly/SKILL.md");
        fs::create_dir_all(lib_skill.parent().unwrap()).unwrap();
        fs::write(&lib_skill, b"# lib\n").unwrap();

        let entry = CatalogEntry {
            id: "libonly".into(),
            kind: "skill".into(),
            library_path: "skills/libonly/SKILL.md".into(),
            deployed_path: String::new(),
            is_in_library: true,
            origins: vec![crate::catalog::CatalogOrigin {
                original_path: lib_skill.to_string_lossy().to_string(),
                tool: "cursor".into(),
                scope: "library-disk".into(),
            }],
            ..Default::default()
        };
        let live = find_live_path_in_active_container(
            &entry,
            &lib.to_string_lossy(),
            &container.to_string_lossy(),
            true,
        );
        assert!(live.is_none(), "library origin must not count as container: {live:?}");
    }
}
