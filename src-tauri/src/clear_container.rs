//! Harvest skills and rules from selected project containers into the permanent library.
//! Same content → delete container copy; missing in library → copy then delete; different → conflict picker.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

use crate::catalog::{
    load_catalog, upsert_entry, validate_entry_paths, CatalogEntry, CatalogOrigin,
};
use crate::hash::{content_equivalent, hash_path_auto};
use crate::path_guard::{assert_managed_container_path, resolve_library_safe_path};
use crate::scan_ingest::sanitize_id;
use crate::settings::AppSettings;
use crate::skill_layout::{skill_dir_rel, skill_unit_path};
use crate::snapshot::{build_snapshot_subset, AppSnapshotSubset};
use crate::withdraw::{
    remove_path, withdraw_entries_at, ConflictResolution, PathConflictDto, WithdrawBatchResult,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearPreviewProject {
    pub project_id: String,
    pub name: String,
    pub skill_count: u32,
    pub skill_ids: Vec<String>,
    pub rule_count: u32,
    pub rule_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearPreviewResult {
    pub ok: bool,
    pub message: String,
    pub skill_count: u32,
    pub rule_count: u32,
    pub leftover: u32,
    pub projects: Vec<ClearPreviewProject>,
    pub snapshot: AppSnapshotSubset,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearSkillsResult {
    pub ok: bool,
    pub moved: u32,
    pub skipped: u32,
    pub failed: u32,
    pub leftover: u32,
    pub conflicts: Vec<PathConflictDto>,
    pub message: String,
    pub snapshot: AppSnapshotSubset,
}

fn snap(settings: &AppSettings) -> AppSnapshotSubset {
    let load = load_catalog(settings.skills_library_root.trim());
    let warnings = if load.healthy {
        validate_entry_paths(settings.skills_library_root.trim(), &load.catalog.entries)
    } else {
        vec![]
    };
    build_snapshot_subset(settings, &load, warnings)
}

struct DiscoveredItem {
    id: String,
    kind: &'static str,
    path: PathBuf,
}

fn discover_container_skills(container_root: &str) -> Vec<DiscoveredItem> {
    let skills_dir = Path::new(container_root.trim()).join("skills");
    let mut out = Vec::new();
    if !skills_dir.is_dir() {
        return out;
    }
    let Ok(rd) = fs::read_dir(&skills_dir) else {
        return out;
    };
    for ent in rd.flatten() {
        let name = ent.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let path = ent.path();
        if path.is_dir() {
            out.push(DiscoveredItem {
                id: sanitize_id(&name),
                kind: "skill",
                path,
            });
            continue;
        }
        let lower = name.to_lowercase();
        if lower.ends_with(".skill") && path.is_file() {
            let stem = Path::new(&name)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or(name);
            out.push(DiscoveredItem {
                id: sanitize_id(&stem),
                kind: "skill",
                path,
            });
        }
    }
    out
}

fn is_nested_rule_file(path: &Path) -> bool {
    let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
        return false;
    };
    let Some(parent) = path.parent() else {
        return false;
    };
    let Some(parent_name) = parent.file_name().and_then(|s| s.to_str()) else {
        return false;
    };
    let Some(grand) = parent.parent() else {
        return false;
    };
    grand
        .file_name()
        .and_then(|s| s.to_str())
        .map(|n| n.eq_ignore_ascii_case("rules"))
        .unwrap_or(false)
        && parent_name == stem
}

fn discover_container_rules(container_root: &str) -> Vec<DiscoveredItem> {
    let rules_dir = Path::new(container_root.trim()).join("rules");
    let mut by_id: std::collections::BTreeMap<String, DiscoveredItem> =
        std::collections::BTreeMap::new();
    fn walk(dir: &Path, by_id: &mut std::collections::BTreeMap<String, DiscoveredItem>) {
        let Ok(rd) = fs::read_dir(dir) else {
            return;
        };
        for ent in rd.flatten() {
            let name = ent.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let path = ent.path();
            if path.is_dir() {
                walk(&path, by_id);
                continue;
            }
            let lower = name.to_lowercase();
            if !lower.ends_with(".mdc") {
                continue;
            }
            let stem = Path::new(&name)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or(name);
            let id = sanitize_id(&stem);
            if let Some(old) = by_id.get(&id) {
                if is_nested_rule_file(&old.path) {
                    continue;
                }
            }
            by_id.insert(
                id.clone(),
                DiscoveredItem {
                    id,
                    kind: "rule",
                    path,
                },
            );
        }
    }
    if rules_dir.is_dir() {
        walk(&rules_dir, &mut by_id);
    }
    by_id.into_values().collect()
}

fn leftover_unrecognized_skills(container_root: &str) -> u32 {
    let skills_dir = Path::new(container_root.trim()).join("skills");
    if !skills_dir.is_dir() {
        return 0;
    }
    let Ok(rd) = fs::read_dir(&skills_dir) else {
        return 0;
    };
    let mut n = 0u32;
    for ent in rd.flatten() {
        let name = ent.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let path = ent.path();
        if path.is_dir() {
            continue;
        }
        let lower = name.to_lowercase();
        if lower.ends_with(".skill") {
            continue;
        }
        n += 1;
    }
    n
}

fn leftover_unrecognized_rules(container_root: &str, kept: &[DiscoveredItem]) -> u32 {
    let rules_dir = Path::new(container_root.trim()).join("rules");
    if !rules_dir.is_dir() {
        return 0;
    }
    let kept_paths: std::collections::HashSet<PathBuf> =
        kept.iter().map(|d| d.path.clone()).collect();
    let mut n = 0u32;
    fn walk(dir: &Path, kept: &std::collections::HashSet<PathBuf>, n: &mut u32) {
        let Ok(rd) = fs::read_dir(dir) else {
            return;
        };
        for ent in rd.flatten() {
            let name = ent.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let path = ent.path();
            if path.is_dir() {
                walk(&path, kept, n);
                continue;
            }
            if kept.contains(&path) {
                continue;
            }
            *n += 1;
        }
    }
    walk(&rules_dir, &kept_paths, &mut n);
    n
}

fn leftover_unrecognized(container_root: &str) -> u32 {
    let rules = discover_container_rules(container_root);
    leftover_unrecognized_skills(container_root) + leftover_unrecognized_rules(container_root, &rules)
}

fn prune_remaining_rule_copies(container_root: &str, id: &str) {
    while let Some(p) = crate::rule_layout::probe_rule_in_container(container_root, id) {
        if remove_path(&p).is_err() {
            break;
        }
    }
}

fn library_dest_for(
    lib: &str,
    id: &str,
    kind: &str,
    source: &Path,
    existing: Option<&CatalogEntry>,
) -> Result<(PathBuf, String), String> {
    if let Some(e) = existing {
        let rel = e.library_path.trim();
        if !rel.is_empty() {
            if let Ok(full) = resolve_library_safe_path(lib, rel) {
                let unit = if e.kind.eq_ignore_ascii_case("skill") {
                    skill_unit_path(&full)
                } else {
                    full
                };
                let rel_out = if kind.eq_ignore_ascii_case("skill") {
                    crate::skill_layout::normalize_skill_library_rel(id, rel)
                } else {
                    e.library_path.replace('\\', "/")
                };
                return Ok((unit, rel_out));
            }
        }
    }
    if kind.eq_ignore_ascii_case("rule") {
        let rel = crate::rule_layout::nested_rule_rel(
            id,
            &crate::rule_layout::ext_from_path(source),
        );
        let dest = resolve_library_safe_path(lib, &rel).map_err(|e| e.to_string())?;
        return Ok((dest, rel));
    }
    let rel = if source
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.eq_ignore_ascii_case("skill"))
        .unwrap_or(false)
    {
        format!("skills/{id}.skill")
    } else {
        skill_dir_rel(id)
    };
    let dest = resolve_library_safe_path(lib, &rel).map_err(|e| e.to_string())?;
    Ok((dest, rel))
}

fn ingest_new_item(
    settings: &AppSettings,
    id: &str,
    kind: &str,
    source: &Path,
    dest: &Path,
    rel: &str,
    project_id: &str,
    container_root: &str,
) -> Result<(), String> {
    let lib = settings.skills_library_root.trim();
    let src_s = source.to_string_lossy().to_string();
    assert_managed_container_path(&src_s, &[container_root], false).map_err(|e| e.to_string())?;
    crate::deploy::copy_path(source, dest)?;
    let tool = crate::workspace::normalize_workspace_id(&settings.selected_global_tool)
        .unwrap_or("cursor")
        .to_string();
    let mut entry = CatalogEntry {
        id: id.to_string(),
        kind: kind.to_string(),
        library_path: rel.to_string(),
        is_in_library: true,
        deployed_path: String::new(),
        is_missing: false,
        origins: vec![CatalogOrigin {
            original_path: src_s,
            tool,
            scope: format!("project:{project_id}"),
        }],
        ..Default::default()
    };
    if kind.eq_ignore_ascii_case("rule") {
        let _ = crate::rule_layout::repath_rule_entry_to_nested(lib, &mut entry);
    }
    crate::list_cluster::apply_inferred_level_if_missing(&mut entry);
    upsert_entry(lib, entry)?;
    remove_path(source)?;
    if kind.eq_ignore_ascii_case("rule") {
        prune_remaining_rule_copies(container_root, id);
    }
    Ok(())
}

fn hashes_equivalent(src: &Path, dest: &Path) -> Result<bool, String> {
    let (sh, _) = hash_path_auto(src)?;
    let (lh, _) = hash_path_auto(dest)?;
    Ok(content_equivalent(&sh, &lh, src, dest))
}

fn preview_one(
    settings: &AppSettings,
    project_id: &str,
) -> Result<(ClearPreviewProject, u32), String> {
    let load = load_catalog(settings.skills_library_root.trim());
    let name = crate::catalog::list_projects(&load.catalog)
        .into_iter()
        .find(|p| p.id == project_id)
        .map(|p| p.name)
        .unwrap_or_else(|| project_id.to_string());
    let root = crate::active_container::resolve_project_container_root(settings, project_id);
    if root.trim().is_empty() {
        return Ok((
            ClearPreviewProject {
                project_id: project_id.to_string(),
                name,
                skill_count: 0,
                skill_ids: vec![],
                rule_count: 0,
                rule_ids: vec![],
            },
            0,
        ));
    }
    let skills = discover_container_skills(&root);
    let rules = discover_container_rules(&root);
    let leftover = leftover_unrecognized(&root);
    Ok((
        ClearPreviewProject {
            project_id: project_id.to_string(),
            name,
            skill_count: skills.len() as u32,
            skill_ids: skills.iter().map(|d| d.id.clone()).collect(),
            rule_count: rules.len() as u32,
            rule_ids: rules.iter().map(|d| d.id.clone()).collect(),
        },
        leftover,
    ))
}

pub fn preview_clear_project_skills(
    settings: &AppSettings,
    project_ids: &[String],
) -> Result<ClearPreviewResult, String> {
    if !settings.library_root_configured || settings.skills_library_root.trim().is_empty() {
        return Err("请先配置永久库目录".into());
    }
    let mut projects = Vec::new();
    let mut leftover = 0u32;
    for raw in project_ids {
        let id = raw.trim();
        if id.is_empty() {
            continue;
        }
        let (p, left) = preview_one(settings, id)?;
        leftover += left;
        projects.push(p);
    }
    let skill_count: u32 = projects.iter().map(|p| p.skill_count).sum();
    let rule_count: u32 = projects.iter().map(|p| p.rule_count).sum();
    let item_count = skill_count + rule_count;
    Ok(ClearPreviewResult {
        ok: true,
        message: if item_count == 0 {
            "所选容器里没有技能或规则".into()
        } else {
            format!("待清空 {item_count} 项（技能 {skill_count}，规则 {rule_count}）")
        },
        skill_count,
        rule_count,
        leftover,
        projects,
        snapshot: snap(settings),
    })
}

fn clear_one_project(
    settings: &AppSettings,
    project_id: &str,
    resolutions: &[ConflictResolution],
) -> Result<(WithdrawBatchResult, u32, u32), String> {
    let lib = settings.skills_library_root.trim();
    let container_root = crate::active_container::resolve_project_container_root(settings, project_id);
    if container_root.trim().is_empty() {
        return Ok((
            WithdrawBatchResult {
                ok: true,
                moved: 0,
                skipped: 0,
                failed: 0,
                conflicts: vec![],
                message: String::new(),
                snapshot: snap(settings),
            },
            0,
            0,
        ));
    }
    let mut discovered = discover_container_skills(&container_root);
    discovered.extend(discover_container_rules(&container_root));
    let load = load_catalog(lib);
    if !load.healthy {
        return Err(format!(
            "台账未健康：{}",
            load.error.unwrap_or_else(|| "unknown".into())
        ));
    }

    let mut to_withdraw_skill: Vec<String> = Vec::new();
    let mut to_withdraw_rule: Vec<String> = Vec::new();
    let mut ingested = 0u32;
    let mut failed = 0u32;

    for item in discovered {
        let mut existing = load
            .catalog
            .entries
            .iter()
            .find(|e| e.id == item.id && e.kind.eq_ignore_ascii_case(item.kind))
            .cloned();
        if item.kind.eq_ignore_ascii_case("rule") {
            if let Some(ref mut e) = existing {
                if crate::rule_layout::repath_rule_entry_to_nested(lib, e).unwrap_or(false)
                    && upsert_entry(lib, e.clone()).is_err()
                {
                    failed += 1;
                    continue;
                }
            }
        }
        let Ok((dest, rel)) =
            library_dest_for(lib, &item.id, item.kind, &item.path, existing.as_ref())
        else {
            failed += 1;
            continue;
        };
        if dest.exists() {
            if hashes_equivalent(&item.path, &dest).is_err() {
                failed += 1;
                continue;
            }
            if existing.is_none() {
                let mut entry = CatalogEntry {
                    id: item.id.clone(),
                    kind: item.kind.into(),
                    library_path: rel,
                    is_in_library: true,
                    deployed_path: String::new(),
                    is_missing: false,
                    ..Default::default()
                };
                crate::list_cluster::apply_inferred_level_if_missing(&mut entry);
                if upsert_entry(lib, entry).is_err() {
                    failed += 1;
                    continue;
                }
            }
            if item.kind.eq_ignore_ascii_case("rule") {
                to_withdraw_rule.push(item.id);
            } else {
                to_withdraw_skill.push(item.id);
            }
            continue;
        }
        match ingest_new_item(
            settings,
            &item.id,
            item.kind,
            &item.path,
            &dest,
            &rel,
            project_id,
            &container_root,
        ) {
            Ok(()) => ingested += 1,
            Err(_) => failed += 1,
        }
    }

    let mut batch = WithdrawBatchResult {
        ok: failed == 0,
        moved: 0,
        skipped: 0,
        failed,
        conflicts: vec![],
        message: String::new(),
        snapshot: snap(settings),
    };
    for (kind, ids) in [
        ("skill", to_withdraw_skill.as_slice()),
        ("rule", to_withdraw_rule.as_slice()),
    ] {
        if ids.is_empty() {
            continue;
        }
        let key_prefix = format!("clear:{project_id}:{kind}");
        let w = withdraw_entries_at(
            settings,
            ids,
            resolutions,
            &container_root,
            false,
            &key_prefix,
            "clearContainer",
            Some(kind),
        )?;
        batch.moved += w.moved;
        batch.skipped += w.skipped;
        batch.failed += w.failed;
        batch.conflicts.extend(w.conflicts);
        batch.ok = batch.ok && w.ok;
    }
    batch.moved += ingested;
    if failed > 0 {
        batch.ok = false;
    }
    let conflict_rule_ids: std::collections::HashSet<String> = batch
        .conflicts
        .iter()
        .filter(|c| c.kind.eq_ignore_ascii_case("rule"))
        .map(|c| c.suggested_id.clone())
        .collect();
    for id in &to_withdraw_rule {
        if !conflict_rule_ids.contains(id) {
            prune_remaining_rule_copies(&container_root, id);
        }
    }
    let leftover = leftover_unrecognized(&container_root);
    Ok((batch, ingested, leftover))
}

pub fn clear_project_skills(
    settings: &AppSettings,
    project_ids: &[String],
    resolutions: &[ConflictResolution],
) -> Result<ClearSkillsResult, String> {
    if !settings.library_root_configured || settings.skills_library_root.trim().is_empty() {
        return Err("请先配置永久库目录".into());
    }
    let mut moved = 0u32;
    let mut skipped = 0u32;
    let mut failed = 0u32;
    let mut leftover = 0u32;
    let mut conflicts = Vec::new();

    for raw in project_ids {
        let id = raw.trim();
        if id.is_empty() {
            continue;
        }
        let (batch, _ingested, left) = clear_one_project(settings, id, resolutions)?;
        moved += batch.moved;
        skipped += batch.skipped;
        failed += batch.failed;
        leftover += left;
        conflicts.extend(batch.conflicts);
    }

    let snapshot = snap(settings);
    let message = format!(
        "清空技能与规则：移动 {moved}，跳过 {skipped}，失败 {failed}，冲突 {}，残留 {leftover}",
        conflicts.len()
    );
    Ok(ClearSkillsResult {
        ok: failed == 0,
        moved,
        skipped,
        failed,
        leftover,
        conflicts,
        message,
        snapshot,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::{ensure_library_layout, save_catalog, upsert_project, CatalogProject};
    use crate::settings::AppSettings;

    fn setup_project(
        dir: &tempfile::TempDir,
        proj_name: &str,
        pid: &str,
        skill_id: &str,
        lib_body: Option<&[u8]>,
        ctr_body: &[u8],
    ) -> (AppSettings, PathBuf, PathBuf) {
        let lib_root = dir.path().join("lib").to_string_lossy().to_string();
        ensure_library_layout(&lib_root).unwrap();
        let proj = dir.path().join(proj_name);
        let container = proj.join(".cursor");
        fs::create_dir_all(container.join("skills").join(skill_id)).unwrap();
        let ctr_file = container.join("skills").join(skill_id).join("SKILL.md");
        fs::write(&ctr_file, ctr_body).unwrap();

        upsert_project(
            &lib_root,
            CatalogProject {
                id: pid.into(),
                name: proj_name.into(),
                root_path: proj.to_string_lossy().to_string(),
                category: "Cursor项目".into(),
                pinned: true,
                ..Default::default()
            },
        )
        .unwrap();

        let lib_file = dir.path().join("lib").join("skills").join(skill_id).join("SKILL.md");
        if let Some(body) = lib_body {
            fs::create_dir_all(lib_file.parent().unwrap()).unwrap();
            fs::write(&lib_file, body).unwrap();
            let entry = CatalogEntry {
                id: skill_id.into(),
                kind: "skill".into(),
                library_path: format!("skills/{skill_id}"),
                is_in_library: true,
                deployed_path: ctr_file.to_string_lossy().to_string(),
                is_missing: false,
                ..Default::default()
            };
            let mut cat = load_catalog(&lib_root).catalog;
            cat.entries.push(entry);
            save_catalog(&lib_root, &cat).unwrap();
        }

        let settings = AppSettings {
            skills_library_root: lib_root,
            library_root_configured: true,
            nav_kind: "global".into(),
            selected_global_tool: "cursor".into(),
            ..Default::default()
        };
        (settings, lib_file, ctr_file)
    }

    fn setup_rule_project(
        dir: &tempfile::TempDir,
        proj_name: &str,
        pid: &str,
        rule_id: &str,
        lib_body: Option<&[u8]>,
        ctr_body: &[u8],
        nested: bool,
    ) -> (AppSettings, PathBuf, PathBuf) {
        let lib_root = dir.path().join("lib").to_string_lossy().to_string();
        ensure_library_layout(&lib_root).unwrap();
        let proj = dir.path().join(proj_name);
        let container = proj.join(".cursor");
        let ctr_file = if nested {
            fs::create_dir_all(container.join("rules").join(rule_id)).unwrap();
            container
                .join("rules")
                .join(rule_id)
                .join(format!("{rule_id}.mdc"))
        } else {
            fs::create_dir_all(container.join("rules")).unwrap();
            container.join("rules").join(format!("{rule_id}.mdc"))
        };
        fs::write(&ctr_file, ctr_body).unwrap();

        upsert_project(
            &lib_root,
            CatalogProject {
                id: pid.into(),
                name: proj_name.into(),
                root_path: proj.to_string_lossy().to_string(),
                category: "Cursor项目".into(),
                pinned: true,
                ..Default::default()
            },
        )
        .unwrap();

        let lib_file = dir
            .path()
            .join("lib")
            .join("rules")
            .join(rule_id)
            .join(format!("{rule_id}.mdc"));
        if let Some(body) = lib_body {
            fs::create_dir_all(lib_file.parent().unwrap()).unwrap();
            fs::write(&lib_file, body).unwrap();
            let entry = CatalogEntry {
                id: rule_id.into(),
                kind: "rule".into(),
                library_path: format!("rules/{rule_id}/{rule_id}.mdc"),
                is_in_library: true,
                deployed_path: ctr_file.to_string_lossy().to_string(),
                is_missing: false,
                ..Default::default()
            };
            let mut cat = load_catalog(&lib_root).catalog;
            cat.entries.push(entry);
            save_catalog(&lib_root, &cat).unwrap();
        }

        let settings = AppSettings {
            skills_library_root: lib_root,
            library_root_configured: true,
            nav_kind: "global".into(),
            selected_global_tool: "cursor".into(),
            ..Default::default()
        };
        (settings, lib_file, ctr_file)
    }

    #[test]
    fn same_hash_deletes_container_copy() {
        let dir = tempfile::tempdir().unwrap();
        let (settings, lib_file, ctr_file) = setup_project(
            &dir,
            "P1",
            "p1",
            "same-sk",
            Some(b"# skill\nbody\n"),
            b"# skill\nbody\n",
        );
        let r = clear_project_skills(&settings, &["p1".into()], &[]).unwrap();
        assert!(r.conflicts.is_empty(), "{}", r.message);
        assert_eq!(r.moved, 1);
        assert!(!ctr_file.exists());
        assert!(!ctr_file.parent().unwrap().exists());
        assert!(lib_file.exists());
    }

    #[test]
    fn new_skill_moves_into_library() {
        let dir = tempfile::tempdir().unwrap();
        let (settings, lib_file, ctr_file) =
            setup_project(&dir, "P1", "p1", "brand-new", None, b"# skill\nnew body\n");
        let r = clear_project_skills(&settings, &["p1".into()], &[]).unwrap();
        assert!(r.conflicts.is_empty(), "{}", r.message);
        assert_eq!(r.moved, 1);
        assert!(!ctr_file.exists());
        assert!(lib_file.exists());
        let body = fs::read_to_string(&lib_file).unwrap();
        assert!(body.contains("new body"));
        let cat = load_catalog(&settings.skills_library_root).catalog;
        assert!(cat.entries.iter().any(|e| e.id == "brand-new"));
    }

    #[test]
    fn diff_hash_returns_project_scoped_key() {
        let dir = tempfile::tempdir().unwrap();
        let (settings, _lib, ctr_file) = setup_project(
            &dir,
            "P1",
            "p1",
            "diff-sk",
            Some(b"# skill\nlib\n"),
            b"# skill\ncontainer\n",
        );
        let r = clear_project_skills(&settings, &["p1".into()], &[]).unwrap();
        assert_eq!(r.conflicts.len(), 1);
        assert_eq!(r.conflicts[0].key, "clear:p1:skill:diff-sk");
        assert_eq!(r.conflicts[0].operation, "clearContainer");
        assert!(ctr_file.exists());
    }

    #[test]
    fn two_projects_same_skill_id_get_distinct_keys() {
        let dir = tempfile::tempdir().unwrap();
        let (settings, _, ctr_a) = setup_project(
            &dir,
            "A",
            "pa",
            "shared-sk",
            Some(b"# skill\nlib\n"),
            b"# skill\nA\n",
        );
        let proj_b = dir.path().join("B");
        let container_b = proj_b.join(".cursor");
        fs::create_dir_all(container_b.join("skills/shared-sk")).unwrap();
        let ctr_b = container_b.join("skills/shared-sk/SKILL.md");
        fs::write(&ctr_b, b"# skill\nB\n").unwrap();
        upsert_project(
            &settings.skills_library_root,
            CatalogProject {
                id: "pb".into(),
                name: "B".into(),
                root_path: proj_b.to_string_lossy().to_string(),
                category: "Cursor项目".into(),
                pinned: true,
                ..Default::default()
            },
        )
        .unwrap();

        let r = clear_project_skills(&settings, &["pa".into(), "pb".into()], &[]).unwrap();
        let keys: Vec<_> = r.conflicts.iter().map(|c| c.key.as_str()).collect();
        assert!(keys.contains(&"clear:pa:skill:shared-sk"), "{keys:?}");
        assert!(keys.contains(&"clear:pb:skill:shared-sk"), "{keys:?}");
        assert_eq!(keys.len(), 2);
        assert!(ctr_a.exists());
        assert!(ctr_b.exists());
    }

    #[test]
    fn preview_counts_skills_without_nav_focus() {
        let dir = tempfile::tempdir().unwrap();
        let (settings, _, _) =
            setup_project(&dir, "P1", "p1", "pv", Some(b"# s\n"), b"# s\n");
        assert!(settings.selected_project_id.is_none());
        let p = preview_clear_project_skills(&settings, &["p1".into()]).unwrap();
        assert_eq!(p.skill_count, 1);
        assert_eq!(p.projects[0].skill_ids, vec!["pv".to_string()]);
    }

    #[test]
    fn overwrite_resolution_keeps_container_body() {
        let dir = tempfile::tempdir().unwrap();
        let (settings, lib_file, ctr_file) = setup_project(
            &dir,
            "P1",
            "p1",
            "ow-sk",
            Some(b"# skill\nlib\n"),
            b"# skill\nWIN\n",
        );
        let r = clear_project_skills(
            &settings,
            &["p1".into()],
            &[ConflictResolution {
                key: "clear:p1:skill:ow-sk".into(),
                choice: "overwrite".into(),
            }],
        )
        .unwrap();
        assert!(r.conflicts.is_empty(), "{}", r.message);
        assert!(!ctr_file.exists());
        let body = fs::read_to_string(&lib_file).unwrap();
        assert!(body.contains("WIN"));
    }

    #[test]
    fn same_hash_rule_deletes_container_copy() {
        let dir = tempfile::tempdir().unwrap();
        let (settings, lib_file, ctr_file) = setup_rule_project(
            &dir,
            "P1",
            "p1",
            "same-rl",
            Some(b"# rule\nbody\n"),
            b"# rule\nbody\n",
            true,
        );
        let r = clear_project_skills(&settings, &["p1".into()], &[]).unwrap();
        assert!(r.conflicts.is_empty(), "{}", r.message);
        assert_eq!(r.moved, 1);
        assert!(!ctr_file.exists());
        assert!(!ctr_file.parent().unwrap().exists());
        assert!(lib_file.exists());
    }

    #[test]
    fn new_flat_rule_moves_into_nested_library() {
        let dir = tempfile::tempdir().unwrap();
        let (settings, lib_file, ctr_file) = setup_rule_project(
            &dir,
            "P1",
            "p1",
            "brand-rl",
            None,
            b"# rule\nnew body\n",
            false,
        );
        let r = clear_project_skills(&settings, &["p1".into()], &[]).unwrap();
        assert!(r.conflicts.is_empty(), "{}", r.message);
        assert_eq!(r.moved, 1);
        assert!(!ctr_file.exists());
        assert!(lib_file.exists());
        let body = fs::read_to_string(&lib_file).unwrap();
        assert!(body.contains("new body"));
        let cat = load_catalog(&settings.skills_library_root).catalog;
        let e = cat.entries.iter().find(|e| e.id == "brand-rl").unwrap();
        assert_eq!(e.kind, "rule");
        assert_eq!(e.library_path, "rules/brand-rl/brand-rl.mdc");
    }

    #[test]
    fn diff_hash_rule_returns_kind_scoped_key() {
        let dir = tempfile::tempdir().unwrap();
        let (settings, _lib, ctr_file) = setup_rule_project(
            &dir,
            "P1",
            "p1",
            "diff-rl",
            Some(b"# rule\nlib\n"),
            b"# rule\ncontainer\n",
            true,
        );
        let r = clear_project_skills(&settings, &["p1".into()], &[]).unwrap();
        assert_eq!(r.conflicts.len(), 1);
        assert_eq!(r.conflicts[0].key, "clear:p1:rule:diff-rl");
        assert_eq!(r.conflicts[0].kind, "rule");
        assert_eq!(r.conflicts[0].operation, "clearContainer");
        assert!(ctr_file.exists());
    }

    #[test]
    fn preview_counts_rules_and_skills() {
        let dir = tempfile::tempdir().unwrap();
        let (settings, _, _) =
            setup_project(&dir, "P1", "p1", "pv", Some(b"# s\n"), b"# s\n");
        let container = dir.path().join("P1").join(".cursor");
        fs::create_dir_all(container.join("rules/L0-01")).unwrap();
        fs::write(
            container.join("rules/L0-01/L0-01.mdc"),
            b"# rule\n",
        )
        .unwrap();
        let p = preview_clear_project_skills(&settings, &["p1".into()]).unwrap();
        assert_eq!(p.skill_count, 1);
        assert_eq!(p.rule_count, 1);
        assert_eq!(p.leftover, 0);
        assert_eq!(p.projects[0].rule_ids, vec!["L0-01".to_string()]);
    }

    #[test]
    fn overwrite_rule_keeps_container_body() {
        let dir = tempfile::tempdir().unwrap();
        let (settings, lib_file, ctr_file) = setup_rule_project(
            &dir,
            "P1",
            "p1",
            "ow-rl",
            Some(b"# rule\nlib\n"),
            b"# rule\nWIN\n",
            true,
        );
        let r = clear_project_skills(
            &settings,
            &["p1".into()],
            &[ConflictResolution {
                key: "clear:p1:rule:ow-rl".into(),
                choice: "overwrite".into(),
            }],
        )
        .unwrap();
        assert!(r.conflicts.is_empty(), "{}", r.message);
        assert!(!ctr_file.exists());
        let body = fs::read_to_string(&lib_file).unwrap();
        assert!(body.contains("WIN"));
    }
}
