//! Deploy recipes (Plan/05 W3-S1): named entryId lists → focus workspace (copy deploy, no live sync).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::deploy::{deploy_entries, DeployResult};
use crate::settings::AppSettings;
use crate::workspace::normalize_workspace_id;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployRecipe {
    pub id: String,
    pub name: String,
    pub entry_ids: Vec<String>,
    /// Target workspace id; empty → current focus.
    #[serde(default)]
    pub workspace_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RecipeFile {
    #[serde(default)]
    recipes: Vec<DeployRecipe>,
}

fn recipes_path(library_root: &str) -> PathBuf {
    PathBuf::from(library_root.trim()).join("deploy-recipes.json")
}

pub fn list_deploy_recipes(settings: &AppSettings) -> Result<Vec<DeployRecipe>, String> {
    let lib = settings.skills_library_root.trim();
    if lib.is_empty() {
        return Ok(vec![]);
    }
    let path = recipes_path(lib);
    if !path.is_file() {
        return Ok(vec![]);
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("读配方：{e}"))?;
    let file: RecipeFile = serde_json::from_str(&text).map_err(|e| format!("解析配方：{e}"))?;
    Ok(file.recipes)
}

pub fn save_deploy_recipe(settings: &AppSettings, recipe: DeployRecipe) -> Result<Vec<DeployRecipe>, String> {
    let lib = settings.skills_library_root.trim();
    if !settings.library_root_configured || lib.is_empty() {
        return Err("请先配置永久库目录".into());
    }
    let name = recipe.name.trim();
    if name.is_empty() {
        return Err("配方名称不能为空".into());
    }
    if recipe.entry_ids.is_empty() {
        return Err("配方至少包含一个永久库条目".into());
    }
    for id in &recipe.entry_ids {
        if crate::network_library::is_network_entry_id(id) {
            return Err("配方不可包含网络库条目；请先晋升到永久库".into());
        }
    }
    let mut id = recipe.id.trim().to_string();
    if id.is_empty() {
        id = format!(
            "recipe-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0)
        );
    }
    let ws = recipe.workspace_id.trim();
    let workspace_id = if ws.is_empty() {
        String::new()
    } else {
        normalize_workspace_id(ws)
            .ok_or_else(|| format!("未知工作区：{ws}"))?
            .to_string()
    };
    let stored = DeployRecipe {
        id: id.clone(),
        name: name.to_string(),
        entry_ids: recipe.entry_ids,
        workspace_id,
    };
    let mut recipes = list_deploy_recipes(settings)?;
    if let Some(slot) = recipes.iter_mut().find(|r| r.id == id) {
        *slot = stored;
    } else {
        recipes.push(stored);
    }
    let path = recipes_path(lib);
    let text = serde_json::to_string_pretty(&RecipeFile {
        recipes: recipes.clone(),
    })
    .map_err(|e| format!("序列化配方：{e}"))?;
    fs::write(&path, text).map_err(|e| format!("写配方：{e}"))?;
    Ok(recipes)
}

pub fn delete_deploy_recipe(settings: &AppSettings, recipe_id: &str) -> Result<Vec<DeployRecipe>, String> {
    let lib = settings.skills_library_root.trim();
    if lib.is_empty() {
        return Err("请先配置永久库目录".into());
    }
    let rid = recipe_id.trim();
    let mut recipes = list_deploy_recipes(settings)?;
    let before = recipes.len();
    recipes.retain(|r| r.id != rid);
    if recipes.len() == before {
        return Err(format!("未找到配方：{rid}"));
    }
    let path = recipes_path(lib);
    let text = serde_json::to_string_pretty(&RecipeFile {
        recipes: recipes.clone(),
    })
    .map_err(|e| format!("序列化配方：{e}"))?;
    fs::write(&path, text).map_err(|e| format!("写配方：{e}"))?;
    Ok(recipes)
}

/// Apply recipe: optionally retarget focus workspace, then copy-deploy. Conflicts surface via deploy errors only
/// (deploy overwrites container copies; library is never silently mutated).
pub fn apply_deploy_recipe(settings: &mut AppSettings, recipe_id: &str) -> Result<DeployResult, String> {
    let recipes = list_deploy_recipes(settings)?;
    let recipe = recipes
        .iter()
        .find(|r| r.id == recipe_id.trim())
        .ok_or_else(|| format!("未找到配方：{recipe_id}"))?
        .clone();
    if !recipe.workspace_id.trim().is_empty() {
        settings.nav_kind = "global".into();
        settings.selected_global_tool = recipe.workspace_id.clone();
    }
    crate::settings::ensure_active_container(settings)?;
    deploy_entries(settings, &recipe.entry_ids)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::{ensure_library_layout, load_catalog, save_catalog, CatalogEntry};
    use crate::workspace::ensure_workspaces_migrated;

    #[test]
    fn save_list_apply_recipe_to_focus_container() {
        let dir = tempfile::tempdir().unwrap();
        let lib = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib).unwrap();
        let claude_root = dir.path().join(".claude");
        fs::create_dir_all(&claude_root).unwrap();
        fs::create_dir_all(dir.path().join("skills/r1")).unwrap();
        fs::write(dir.path().join("skills/r1/SKILL.md"), b"# r1\n").unwrap();
        save_catalog(
            &lib,
            &{
                let mut c = load_catalog(&lib).catalog;
                c.entries.push(CatalogEntry {
                    id: "r1".into(),
                    kind: "skill".into(),
                    library_path: "skills/r1/SKILL.md".into(),
                    is_in_library: true,
                    ..Default::default()
                });
                c
            },
        )
        .unwrap();

        let mut settings = AppSettings {
            skills_library_root: lib.clone(),
            library_root_configured: true,
            nav_kind: "global".into(),
            selected_global_tool: "claude".into(),
            ..Default::default()
        };
        ensure_workspaces_migrated(&mut settings);
        if let Some(w) = settings.workspaces.iter_mut().find(|w| w.id == "claude") {
            w.container_root = claude_root.to_string_lossy().to_string();
            w.enabled = true;
        }
        settings.visible_workspace_ids = vec!["claude".into()];

        let list = save_deploy_recipe(
            &settings,
            DeployRecipe {
                id: "t1".into(),
                name: "test".into(),
                entry_ids: vec!["r1".into()],
                workspace_id: "claude".into(),
            },
        )
        .unwrap();
        assert_eq!(list.len(), 1);

        let r = apply_deploy_recipe(&mut settings, "t1").unwrap();
        assert!(r.ok, "{}", r.message);
        assert!(claude_root.join("skills/r1/SKILL.md").is_file());
    }
}
