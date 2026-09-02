//! 测试用「干净安装」回厂：清空台账 + 网络索引/缓存 + 网络钉选。

use std::fs;
use std::path::Path;

use crate::catalog;
use crate::network_library::{
    default_network_library_root, ensure_network_layout, save_network_index, NetworkIndex,
    NETWORK_CACHE_DIR,
};
use crate::settings::{effective_library_root, save_settings, AppSettings};

/// 将永久库侧测试状态重置为接近干净安装（不删 skills/rules 正文）。
/// `delete_network_cache`：为 true 时清空网络索引并删除 `net\cache`；为 false 时保留已拉取缓存。
pub fn reset_library_to_clean_test_state(
    settings: &mut AppSettings,
    delete_network_cache: bool,
) -> Result<(), String> {
    let lib = effective_library_root(settings)
        .ok_or_else(|| "请先配置永久库目录".to_string())?;

    catalog::write_empty_catalog(&lib)?;

    // 网络根优先用已配置；否则耦合默认 `{库}\net`
    let net = {
        let t = settings.network_library_root.trim();
        if !t.is_empty() {
            t.to_string()
        } else {
            default_network_library_root(settings)
        }
    };
    settings.network_library_root = net.clone();
    settings.network_library_configured = true;
    ensure_network_layout(&net)?;

    if delete_network_cache {
        save_network_index(&net, &NetworkIndex::default())?;
        let cache = Path::new(&net).join(NETWORK_CACHE_DIR);
        if cache.is_dir() {
            fs::remove_dir_all(&cache).map_err(|e| format!("删除网络 cache: {e}"))?;
        }
        fs::create_dir_all(&cache).map_err(|e| format!("mkdir network cache: {e}"))?;
    }

    clear_network_sidebar_state(settings);
    save_settings(settings)?;
    Ok(())
}

fn clear_network_sidebar_state(settings: &mut AppSettings) {
    settings.network_official_pinned_ids.clear();
    settings.network_popular_pinned_ids.clear();
    settings.network_popular_pins_initialized = false;
    settings.network_official_order.clear();
    settings.network_popular_order.clear();
    settings.network_user_sources.clear();
}

/// 手删 `catalog.json` 后对齐：缺台账则级联回厂并写回空台账。
/// 返回 true 表示刚执行了回厂。
pub fn reconcile_missing_catalog(settings: &mut AppSettings) -> Result<bool, String> {
    let Some(lib) = effective_library_root(settings) else {
        return Ok(false);
    };
    let catalog_path = Path::new(&lib).join("catalog.json");
    if catalog_path.is_file() {
        return Ok(false);
    }
    reset_library_to_clean_test_state(settings, true)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::network_library::{ensure_network_layout, NETWORK_INDEX_FILE};
    use crate::settings::{library_settings_path, write_library_pointer, LIBRARY_POINTER_FILE};
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn reset_clears_catalog_network_cache_and_pins() {
        let _g = ENV_LOCK.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let appdata = dir.path().join("appdata");
        fs::create_dir_all(&appdata).unwrap();
        unsafe {
            std::env::set_var("APPDATA", &appdata);
        }

        let lib = dir.path().join("lib").to_string_lossy().to_string();
        catalog::ensure_library_layout(&lib).unwrap();
        let net = Path::new(&lib).join("net").to_string_lossy().to_string();
        ensure_network_layout(&net).unwrap();
        let cache_item = Path::new(&net).join(NETWORK_CACHE_DIR).join("demo");
        fs::create_dir_all(&cache_item).unwrap();
        fs::write(cache_item.join("f.txt"), b"x").unwrap();

        let mut settings = AppSettings {
            skills_library_root: lib.clone(),
            library_root_configured: true,
            network_library_root: net.clone(),
            network_library_configured: true,
            network_popular_pinned_ids: vec!["anthropics-skills".into()],
            network_popular_pins_initialized: true,
            network_popular_order: vec!["anthropics-skills".into()],
            network_user_sources: vec![],
            ..Default::default()
        };
        // seed non-empty catalog
        let mut c = catalog::empty_catalog();
        c.entries.push(catalog::CatalogEntry {
            id: "x".into(),
            kind: "skill".into(),
            library_path: "skills/x".into(),
            is_in_library: true,
            ..Default::default()
        });
        catalog::save_catalog(&lib, &c).unwrap();
        write_library_pointer(&lib).unwrap();
        save_settings(&settings).unwrap();

        reset_library_to_clean_test_state(&mut settings, true).unwrap();

        let load = catalog::load_catalog(&lib);
        assert!(load.catalog.entries.is_empty());
        assert!(!Path::new(&net).join(NETWORK_CACHE_DIR).join("demo").exists());
        assert!(Path::new(&net).join(NETWORK_INDEX_FILE).is_file());
        assert!(!settings.network_popular_pins_initialized);
        assert!(settings.network_popular_pinned_ids.is_empty());
        assert!(library_settings_path(&lib).is_file());
        assert!(appdata
            .join("CCM-Tauri2")
            .join(LIBRARY_POINTER_FILE)
            .is_file());

        unsafe {
            std::env::remove_var("APPDATA");
        }
    }

    #[test]
    fn missing_catalog_triggers_reconcile() {
        let _g = ENV_LOCK.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let appdata = dir.path().join("appdata");
        fs::create_dir_all(&appdata).unwrap();
        unsafe {
            std::env::set_var("APPDATA", &appdata);
        }

        let lib = dir.path().join("lib").to_string_lossy().to_string();
        catalog::ensure_library_layout(&lib).unwrap();
        let net = Path::new(&lib).join("net").to_string_lossy().to_string();
        ensure_network_layout(&net).unwrap();
        fs::create_dir_all(Path::new(&net).join(NETWORK_CACHE_DIR).join("z")).unwrap();

        let mut settings = AppSettings {
            skills_library_root: lib.clone(),
            library_root_configured: true,
            network_library_root: net.clone(),
            network_library_configured: true,
            network_popular_pins_initialized: true,
            network_popular_pinned_ids: vec!["x".into()],
            ..Default::default()
        };
        write_library_pointer(&lib).unwrap();
        fs::remove_file(Path::new(&lib).join("catalog.json")).unwrap();

        assert!(reconcile_missing_catalog(&mut settings).unwrap());
        assert!(Path::new(&lib).join("catalog.json").is_file());
        assert!(catalog::load_catalog(&lib).catalog.entries.is_empty());
        assert!(!Path::new(&net).join(NETWORK_CACHE_DIR).join("z").exists());
        assert!(!settings.network_popular_pins_initialized);

        // second call: catalog exists → no-op
        assert!(!reconcile_missing_catalog(&mut settings).unwrap());

        unsafe {
            std::env::remove_var("APPDATA");
        }
    }

    #[test]
    fn reset_without_cache_keeps_cache_dir() {
        let _g = ENV_LOCK.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let appdata = dir.path().join("appdata");
        fs::create_dir_all(&appdata).unwrap();
        unsafe {
            std::env::set_var("APPDATA", &appdata);
        }

        let lib = dir.path().join("lib").to_string_lossy().to_string();
        catalog::ensure_library_layout(&lib).unwrap();
        let net = Path::new(&lib).join("net").to_string_lossy().to_string();
        ensure_network_layout(&net).unwrap();
        let cache_item = Path::new(&net).join(NETWORK_CACHE_DIR).join("keep-me");
        fs::create_dir_all(&cache_item).unwrap();
        fs::write(cache_item.join("f.txt"), b"x").unwrap();

        let mut settings = AppSettings {
            skills_library_root: lib.clone(),
            library_root_configured: true,
            network_library_root: net.clone(),
            network_library_configured: true,
            network_popular_pinned_ids: vec!["anthropics-skills".into()],
            network_popular_pins_initialized: true,
            ..Default::default()
        };
        let mut c = catalog::empty_catalog();
        c.entries.push(catalog::CatalogEntry {
            id: "x".into(),
            kind: "skill".into(),
            library_path: "skills/x".into(),
            is_in_library: true,
            ..Default::default()
        });
        catalog::save_catalog(&lib, &c).unwrap();
        write_library_pointer(&lib).unwrap();
        save_settings(&settings).unwrap();

        reset_library_to_clean_test_state(&mut settings, false).unwrap();

        assert!(catalog::load_catalog(&lib).catalog.entries.is_empty());
        assert!(cache_item.join("f.txt").is_file());
        assert!(settings.network_popular_pinned_ids.is_empty());
        assert!(!settings.network_popular_pins_initialized);

        unsafe {
            std::env::remove_var("APPDATA");
        }
    }
}
