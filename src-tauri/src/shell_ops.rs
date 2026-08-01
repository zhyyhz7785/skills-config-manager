//! Thin shell / dialog ops (M3 domain 1 — retire from Node sidecar).

use std::path::Path;
use std::process::Command;

#[tauri::command]
pub fn pick_folder(title: Option<String>) -> Result<Option<String>, String> {
    let picked = rfd::FileDialog::new()
        .set_title(title.unwrap_or_else(|| "选择文件夹".into()))
        .pick_folder();
    Ok(picked.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn open_path(target: String) -> Result<(), String> {
    let t = target.trim();
    if t.is_empty() {
        return Err("路径为空".into());
    }
    if !Path::new(t).exists() {
        return Err(format!("路径不存在: {t}"));
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/c", "start", "", t])
            .spawn()
            .map_err(|e| format!("open failed: {e}"))?;
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new("xdg-open")
            .arg(t)
            .spawn()
            .map_err(|e| format!("open failed: {e}"))?;
        Ok(())
    }
}

#[tauri::command]
pub fn reveal_in_folder(target: String) -> Result<(), String> {
    let t = target.trim();
    if t.is_empty() {
        return Err("路径为空".into());
    }
    let path = Path::new(t);
    if !path.exists() {
        return Err(format!("路径不存在: {t}"));
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(format!("/select,{t}"))
            .spawn()
            .map_err(|e| format!("reveal failed: {e}"))?;
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    {
        let parent = path.parent().unwrap_or(path);
        Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| format!("reveal failed: {e}"))?;
        Ok(())
    }
}
