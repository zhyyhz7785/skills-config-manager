//! Library API used by `ccm` binary (Plan/05 W3-S2).

use serde_json::json;

use crate::deploy::deploy_entries;
use crate::refresh::{refresh_with_conflict_check, apply_refresh_conflicts, RefreshResolution};
use crate::settings::{load_settings, save_settings, AppSettings, ensure_active_container};
use crate::workspace::ensure_workspaces_migrated;

pub struct CliOptions {
    pub force_conflict: bool,
    pub library_override: Option<String>,
    /// Reserved: CLI never prompts; non-TTY without --force-conflict still fails closed on conflicts.
    #[allow(dead_code)]
    pub is_tty: bool,
}

fn prepare_settings(opts: &CliOptions) -> Result<AppSettings, String> {
    let mut settings = load_settings()?;
    if let Some(lib) = &opts.library_override {
        let t = lib.trim();
        if !t.is_empty() {
            settings.skills_library_root = t.to_string();
            settings.library_root_configured = true;
        }
    }
    ensure_workspaces_migrated(&mut settings);
    ensure_active_container(&mut settings)?;
    Ok(settings)
}

pub fn cli_status(opts: &CliOptions) -> Result<String, String> {
    let settings = prepare_settings(opts)?;
    let load = crate::catalog::load_catalog(settings.skills_library_root.trim());
    let focus = settings.selected_global_tool.clone();
    let container = crate::active_container::resolve_active_container_root(&settings);
    Ok(json!({
        "ok": true,
        "libraryRoot": settings.skills_library_root,
        "libraryHealthy": load.healthy,
        "entryCount": load.catalog.entries.len(),
        "navKind": settings.nav_kind,
        "focusWorkspace": focus,
        "activeContainer": container,
        "version": env!("CARGO_PKG_VERSION"),
    })
    .to_string())
}

pub fn cli_deploy(opts: &CliOptions, entry_ids: &[String]) -> Result<String, String> {
    for id in entry_ids {
        if crate::network_library::is_network_entry_id(id) {
            return Err("网络库条目不可直接部署；请先晋升到永久库".into());
        }
    }
    let settings = prepare_settings(opts)?;
    save_settings(&settings)?;
    let r = deploy_entries(&settings, entry_ids)?;
    Ok(json!({
        "ok": r.ok,
        "succeeded": r.succeeded,
        "failed": r.failed,
        "errors": r.errors,
        "message": r.message,
    })
    .to_string())
}

pub fn cli_refresh(opts: &CliOptions) -> Result<String, String> {
    let settings = prepare_settings(opts)?;
    save_settings(&settings)?;
    let preview = refresh_with_conflict_check(&settings)?;
    if !preview.conflicts.is_empty() {
        if !opts.force_conflict {
            return Err(format!(
                "检测到 {} 项内容冲突；拒绝静默覆盖。请在 GUI 决议，或传入 --force-conflict（将按保留永久库/merge 对齐容器）",
                preview.conflicts.len()
            ));
        }
        let resolutions: Vec<RefreshResolution> = preview
            .conflicts
            .iter()
            .map(|c| RefreshResolution {
                key: c.key.clone(),
                choice: "merge".into(),
                source_path: Some(c.source_path.clone()),
            })
            .collect();
        let applied = apply_refresh_conflicts(&settings, &resolutions)?;
        return Ok(json!({
            "ok": applied.ok,
            "message": applied.message,
            "conflictsForced": preview.conflicts.len(),
            "forcePolicy": "merge",
        })
        .to_string());
    }
    Ok(json!({
        "ok": preview.ok,
        "message": preview.message,
        "conflicts": 0,
    })
    .to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::{ensure_library_layout, upsert_entry, upsert_project, CatalogEntry, CatalogProject};
    use std::fs;
    use std::sync::Mutex;

    static LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn refresh_refuses_silent_overwrite_without_force() {
        let _g = LOCK.lock().unwrap();
        let appdata = tempfile::tempdir().unwrap();
        unsafe {
            std::env::set_var("APPDATA", appdata.path());
        }
        let dir = tempfile::tempdir().unwrap();
        let lib = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib).unwrap();
        let proj = dir.path().join("CliProj");
        let container = proj.join(".cursor");
        fs::create_dir_all(container.join("skills/x")).unwrap();
        fs::create_dir_all(dir.path().join("skills/x")).unwrap();
        fs::write(container.join("skills/x/SKILL.md"), b"# ctr\n").unwrap();
        fs::write(dir.path().join("skills/x/SKILL.md"), b"# lib\n").unwrap();
        let deployed = container.join("skills/x/SKILL.md").to_string_lossy().to_string();
        upsert_project(
            &lib,
            CatalogProject {
                id: "cli".into(),
                name: "CliProj".into(),
                root_path: proj.to_string_lossy().to_string(),
                category: "Cursor项目".into(),
                pinned: true,
                ..Default::default()
            },
        )
        .unwrap();
        upsert_entry(
            &lib,
            CatalogEntry {
                id: "x".into(),
                kind: "skill".into(),
                library_path: "skills/x/SKILL.md".into(),
                is_in_library: true,
                deployed_path: deployed,
                ..Default::default()
            },
        )
        .unwrap();

        let mut settings = AppSettings {
            skills_library_root: lib.clone(),
            library_root_configured: true,
            nav_kind: "project".into(),
            selected_project_id: Some("cli".into()),
            ..Default::default()
        };
        ensure_workspaces_migrated(&mut settings);
        save_settings(&settings).unwrap();

        let opts = CliOptions {
            force_conflict: false,
            library_override: Some(lib),
            is_tty: false,
        };
        let err = cli_refresh(&opts).unwrap_err();
        assert!(
            err.contains("拒绝静默覆盖") || err.contains("冲突"),
            "{err}"
        );
    }
}
