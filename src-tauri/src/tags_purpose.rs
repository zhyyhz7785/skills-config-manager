//! Entry tags / level / purpose suggestions (M3 domain 5 MVP).

use serde::{Deserialize, Serialize};

use crate::catalog::{
    get_entry_tags, kind_label, list_projects, load_catalog, update_entry_tags,
    validate_entry_paths, CatalogEntry,
};
use crate::session::with_session;
use crate::settings::AppSettings;
use crate::snapshot::{build_snapshot_subset, AppSnapshotSubset};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagsOpResult {
    pub ok: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    pub snapshot: AppSnapshotSubset,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestedPurposeDto {
    pub entry_id: String,
    pub display_name: String,
    pub kind_label: String,
    pub kind: String,
    pub suggested_level: Option<String>,
    pub level_label: String,
    pub level_reason: String,
    pub suggested_purpose: String,
    pub purpose_label: String,
    pub source_summary: String,
    pub source_kind_label: String,
    pub is_user_document: bool,
    pub selected: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyPurposeItem {
    pub entry_id: String,
    #[serde(default)]
    pub suggested_level: Option<String>,
    #[serde(default)]
    pub suggested_purpose: String,
    #[serde(default)]
    pub selected: bool,
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

fn require_library(settings: &AppSettings) -> Result<&str, String> {
    let lib = settings.skills_library_root.trim();
    if !settings.library_root_configured || lib.is_empty() {
        return Err("请先配置永久库目录".into());
    }
    Ok(lib)
}

fn selected_ids(explicit: Option<Vec<String>>) -> Vec<String> {
    if let Some(ids) = explicit {
        if !ids.is_empty() {
            return ids;
        }
    }
    with_session(|s| s.selected_entry_ids.clone())
}

fn selected_purposes_from_first(settings: &AppSettings) -> Vec<String> {
    let lib = settings.skills_library_root.trim();
    let load = load_catalog(lib);
    let ids = with_session(|s| s.selected_entry_ids.clone());
    if let Some(id) = ids.first() {
        if let Some(e) = load.catalog.entries.iter().find(|e| e.id == *id) {
            return get_entry_tags(e).purposes;
        }
    }
    vec![]
}

pub fn edit_tags(
    settings: &AppSettings,
    scope: String,
    purposes: Vec<String>,
) -> Result<TagsOpResult, String> {
    let lib = require_library(settings)?;
    let ids = selected_ids(None);
    if ids.is_empty() {
        return Err("请先选择条目".into());
    }
    for id in &ids {
        update_entry_tags(lib, id, &scope, &purposes)?;
    }
    Ok(TagsOpResult {
        ok: true,
        message: "标签已更新".into(),
        data: None,
        snapshot: snap(settings),
    })
}

/// Reorder permanent-library entries within one cluster region (`region_key`).
pub fn reorder_library_entry(
    settings: &AppSettings,
    entry_id: &str,
    region_key: &str,
    direction: Option<&str>,
    to_index: Option<usize>,
) -> Result<TagsOpResult, String> {
    let lib = require_library(settings)?;
    let load = load_catalog(lib);
    if !load.healthy {
        return Err("台账不可用".into());
    }
    let projects = list_projects(&load.catalog);
    let mode = 0;
    let region = region_key.trim();
    let mut peer_ids: Vec<String> = load
        .catalog
        .entries
        .iter()
        .filter(|e| {
            crate::list_cluster::library_content_exists(lib, e)
                && !e.is_missing
                && crate::list_cluster::library_region_key(e, mode, &projects) == region
        })
        .map(|e| e.id.clone())
        .collect();
    peer_ids.sort_by(|a, b| {
        let ea = load.catalog.entries.iter().find(|e| e.id == *a);
        let eb = load.catalog.entries.iter().find(|e| e.id == *b);
        match (ea, eb) {
            (Some(a), Some(b)) => crate::catalog::entry_sort_key(a).cmp(&crate::catalog::entry_sort_key(b)),
            _ => a.cmp(b),
        }
    });
    if !peer_ids.iter().any(|x| x.eq_ignore_ascii_case(entry_id)) {
        return Err("条目不在该区域".into());
    }
    crate::list_order::reorder_ids(&mut peer_ids, entry_id, direction, to_index)?;
    crate::catalog::apply_entry_sort_indices(lib, &peer_ids)?;
    Ok(TagsOpResult {
        ok: true,
        message: "永久库顺序已更新".into(),
        data: None,
        snapshot: snap(settings),
    })
}

pub fn set_entry_level(
    settings: &AppSettings,
    level_raw: String,
    entry_ids: Option<Vec<String>>,
) -> Result<TagsOpResult, String> {
    require_library(settings)?;
    let raw = level_raw.trim();
    let upper = raw.to_uppercase();
    let clear = raw.is_empty()
        || upper == "CLEAR"
        || upper == "NONE"
        || raw == "未分类"
        || upper == "UNCATEGORIZED";
    if !clear && upper != "L0" && upper != "L1" && upper != "L2" {
        return Err("层级须为 L0 / L1 / L2 / 未分类".into());
    }
    let ids = selected_ids(entry_ids);
    if ids.is_empty() {
        return Err("请先选择条目".into());
    }
    let level = if clear { None } else { Some(upper.as_str()) };
    let mut renamed = 0u32;
    let mut warnings = Vec::new();
    for id in &ids {
        let out = crate::level_id::set_level_and_repath(settings, id, level)?;
        if out.renamed {
            renamed += 1;
        }
        warnings.extend(out.warnings);
    }
    let label = if clear { "未分类" } else { upper.as_str() };
    let mut message = format!("已设为 {label}（{} 项）", ids.len());
    if renamed > 0 {
        message.push_str(&format!(
            "，已按来源更名 {renamed} 项（本地 L；未改过的网络技能 S、规则 R）"
        ));
    }
    if !warnings.is_empty() {
        message.push_str("；");
        message.push_str(&warnings.join("；"));
    }
    Ok(TagsOpResult {
        ok: true,
        message,
        data: None,
        snapshot: snap(settings),
    })
}

pub fn set_scope_global(settings: &AppSettings) -> Result<TagsOpResult, String> {
    let purposes = selected_purposes_from_first(settings);
    edit_tags(settings, "global".into(), purposes)
}

pub fn set_scope_project(
    settings: &AppSettings,
    project_id: Option<String>,
) -> Result<TagsOpResult, String> {
    let pid = project_id
        .or_else(|| settings.selected_project_id.clone())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "未指定项目".to_string())?;
    let purposes = selected_purposes_from_first(settings);
    edit_tags(settings, format!("project:{pid}"), purposes)
}

fn suggest_level(e: &CatalogEntry) -> (Option<String>, String) {
    match e.kind.as_str() {
        "skill" => (Some("L1".into()), "技能默认 L1（MVP 启发式）".into()),
        "rule" => (Some("L0".into()), "规则默认 L0（MVP 启发式）".into()),
        "agent" | "command" | "hook" => (Some("L2".into()), "工具类默认 L2（MVP 启发式）".into()),
        _ => (None, "无默认层级".into()),
    }
}

fn suggest_purpose(e: &CatalogEntry) -> String {
    match e.kind.as_str() {
        "skill" => "通用".into(),
        "rule" => "规范".into(),
        _ => String::new(),
    }
}

fn collect_suggestions(
    settings: &AppSettings,
) -> Result<(Vec<SuggestedPurposeDto>, u32, u32), String> {
    let lib = require_library(settings)?;
    let load = load_catalog(lib);
    if !load.healthy {
        return Err(format!(
            "台账不健康: {}",
            load.error.unwrap_or_else(|| "unknown".into())
        ));
    }
    let projects = list_projects(&load.catalog);
    let mut suggestions = Vec::new();
    let mut already_tagged = 0u32;
    let mut no_suggestion = 0u32;

    for e in &load.catalog.entries {
        let tags = get_entry_tags(e);
        let has_level = matches!(
            tags.level.as_deref(),
            Some("L0") | Some("L1") | Some("L2")
        );
        let has_purpose = !tags.purposes.is_empty();
        if has_level && has_purpose {
            already_tagged += 1;
            continue;
        }
        let (level, reason) = if has_level {
            (tags.level.clone(), "已标记层级".to_string())
        } else {
            suggest_level(e)
        };
        let suggested_purpose = if has_purpose {
            String::new()
        } else {
            suggest_purpose(e)
        };
        if has_level && suggested_purpose.is_empty() {
            no_suggestion += 1;
            continue;
        }
        if level.is_none() && suggested_purpose.is_empty() {
            no_suggestion += 1;
            continue;
        }
        let level_label = match &level {
            Some(l) => l.clone(),
            None => "未分类".into(),
        };
        let source_kind = if e.is_in_library {
            "永久库"
        } else {
            "其它"
        };
        let project_hint = projects
            .iter()
            .find(|p| tags.scope == format!("project:{}", p.id))
            .map(|p| p.name.as_str())
            .unwrap_or("");
        suggestions.push(SuggestedPurposeDto {
            entry_id: e.id.clone(),
            display_name: e.id.clone(),
            kind_label: kind_label(&e.kind),
            kind: e.kind.clone(),
            suggested_level: level.clone(),
            level_label,
            level_reason: reason,
            purpose_label: if suggested_purpose.is_empty() {
                "（保持）".into()
            } else {
                suggested_purpose.clone()
            },
            suggested_purpose,
            source_summary: format!("{source_kind} · {}", e.library_path),
            source_kind_label: if project_hint.is_empty() {
                source_kind.into()
            } else {
                format!("项目文档/{project_hint}")
            },
            is_user_document: false,
            selected: true,
        });
    }

    Ok((suggestions, already_tagged, no_suggestion))
}

pub fn preview_suggested_purposes(settings: &AppSettings) -> Result<TagsOpResult, String> {
    let (suggestions, already_tagged, no_suggestion) = collect_suggestions(settings)?;
    Ok(TagsOpResult {
        ok: true,
        message: format!(
            "建议 {} 项（已标注 {}，无建议 {}）",
            suggestions.len(),
            already_tagged,
            no_suggestion
        ),
        data: Some(serde_json::json!({
            "suggestions": suggestions,
            "alreadyTagged": already_tagged,
            "noSuggestion": no_suggestion,
        })),
        snapshot: snap(settings),
    })
}

fn apply_purpose_items(
    settings: &AppSettings,
    items: Vec<ApplyPurposeItem>,
) -> Result<(u32, u32), String> {
    let lib = require_library(settings)?;
    let mut level_n = 0u32;
    let mut purpose_n = 0u32;
    for item in items.into_iter().filter(|i| i.selected) {
        let mut id = item.entry_id.clone();
        if let Some(ref lv) = item.suggested_level {
            let u = lv.to_uppercase();
            if u == "L0" || u == "L1" || u == "L2" {
                let out = crate::level_id::set_level_and_repath(settings, &id, Some(&u))?;
                id = out.new_id;
                level_n += 1;
            }
        }
        let purpose = item.suggested_purpose.trim();
        if !purpose.is_empty() {
            let load = load_catalog(lib);
            let existing = load
                .catalog
                .entries
                .iter()
                .find(|e| e.id == id)
                .map(get_entry_tags);
            let scope = existing
                .as_ref()
                .map(|t| t.scope.clone())
                .unwrap_or_else(|| "global".into());
            let mut purposes = existing.map(|t| t.purposes).unwrap_or_default();
            if !purposes.iter().any(|p| p == purpose) {
                purposes.push(purpose.to_string());
            }
            update_entry_tags(lib, &id, &scope, &purposes)?;
            purpose_n += 1;
        }
    }
    Ok((level_n, purpose_n))
}

pub fn apply_suggested_purposes(
    settings: &AppSettings,
    items: Vec<ApplyPurposeItem>,
) -> Result<TagsOpResult, String> {
    let (level_n, purpose_n) = apply_purpose_items(settings, items)?;
    Ok(TagsOpResult {
        ok: true,
        message: format!("已写入层级 {level_n} 项、用途 {purpose_n} 项"),
        data: None,
        snapshot: snap(settings),
    })
}

/// Same default suggestions as the preview modal's "写入选中" (all selected).
pub fn apply_default_suggestions(settings: &AppSettings) -> Result<(u32, u32), String> {
    let (suggestions, _, _) = collect_suggestions(settings)?;
    if suggestions.is_empty() {
        return Ok((0, 0));
    }
    let items: Vec<ApplyPurposeItem> = suggestions
        .into_iter()
        .map(|s| ApplyPurposeItem {
            entry_id: s.entry_id,
            suggested_level: s.suggested_level,
            suggested_purpose: s.suggested_purpose,
            selected: true,
        })
        .collect();
    apply_purpose_items(settings, items)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::{ensure_library_layout, upsert_entry, CatalogEntry};
    use crate::session::with_session;
    use std::fs;

    #[test]
    fn set_level_and_tags_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let lib = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib).unwrap();
        upsert_entry(
            &lib,
            CatalogEntry {
                id: "s1".into(),
                kind: "skill".into(),
                library_path: "skills/s1/SKILL.md".into(),
                is_in_library: true,
                ..Default::default()
            },
        )
        .unwrap();
        fs::create_dir_all(dir.path().join("skills/s1")).unwrap();
        fs::write(dir.path().join("skills/s1/SKILL.md"), b"# s1\n").unwrap();

        let settings = AppSettings {
            skills_library_root: lib.clone(),
            library_root_configured: true,
            ..Default::default()
        };
        with_session(|s| s.selected_entry_ids = vec!["s1".into()]);

        let r = set_entry_level(&settings, "L1".into(), None).unwrap();
        assert!(r.ok, "{}", r.message);
        let load = load_catalog(&lib);
        let tags = get_entry_tags(
            load.catalog
                .entries
                .iter()
                .find(|e| e.id == "L1-s1")
                .unwrap(),
        );
        assert_eq!(tags.level.as_deref(), Some("L1"));

        let r2 = edit_tags(&settings, "global".into(), vec!["通用".into()]).unwrap();
        assert!(r2.ok);
        let load = load_catalog(&lib);
        let tags = get_entry_tags(
            load.catalog
                .entries
                .iter()
                .find(|e| e.id == "L1-s1")
                .unwrap(),
        );
        assert_eq!(tags.purposes, vec!["通用".to_string()]);

        let prev = preview_suggested_purposes(&settings).unwrap();
        assert!(prev.ok);
        // already has level+purpose → not in suggestions
        let sug = prev
            .data
            .as_ref()
            .and_then(|d| d.get("alreadyTagged"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        assert!(sug >= 1);
    }

    #[test]
    fn apply_default_suggestions_writes_skill_l1_general() {
        let dir = tempfile::tempdir().unwrap();
        let lib = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib).unwrap();
        upsert_entry(
            &lib,
            CatalogEntry {
                id: "hello".into(),
                kind: "skill".into(),
                library_path: "skills/hello/SKILL.md".into(),
                is_in_library: true,
                ..Default::default()
            },
        )
        .unwrap();
        fs::create_dir_all(dir.path().join("skills/hello")).unwrap();
        fs::write(dir.path().join("skills/hello/SKILL.md"), b"# hello\n").unwrap();

        let settings = AppSettings {
            skills_library_root: lib.clone(),
            library_root_configured: true,
            ..Default::default()
        };
        let (level_n, purpose_n) = apply_default_suggestions(&settings).unwrap();
        assert!(level_n >= 1, "level_n={level_n}");
        assert!(purpose_n >= 1, "purpose_n={purpose_n}");
        let load = load_catalog(&lib);
        let tags = get_entry_tags(
            load.catalog
                .entries
                .iter()
                .find(|e| e.id == "L1-hello")
                .unwrap(),
        );
        assert_eq!(tags.level.as_deref(), Some("L1"));
        assert!(tags.purposes.iter().any(|p| p == "通用"), "{:?}", tags.purposes);

        let (level_n2, purpose_n2) = apply_default_suggestions(&settings).unwrap();
        assert_eq!((level_n2, purpose_n2), (0, 0), "already tagged must skip");
    }
}
