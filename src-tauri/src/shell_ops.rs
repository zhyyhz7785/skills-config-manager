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

pub(crate) fn looks_like_http_url(t: &str) -> bool {
    let lower = t.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

#[tauri::command]
pub fn open_path(target: String) -> Result<(), String> {
    let t = target.trim();
    if t.is_empty() {
        return Err("路径为空".into());
    }
    let is_url = looks_like_http_url(t);
    if !is_url && !Path::new(t).exists() {
        return Err(format!("路径不存在: {t}"));
    }
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("cmd");
        cmd.args(["/c", "start", "", t]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        cmd.spawn().map_err(|e| format!("open failed: {e}"))?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn http_urls_skip_filesystem_exists_check() {
        assert!(looks_like_http_url("https://github.com/addyosmani/agent-skills"));
        assert!(looks_like_http_url("http://example.com"));
        assert!(!looks_like_http_url(r"C:\Users\ZHY\CCM-NetworkLibrary"));
        assert!(!looks_like_http_url("ftp://example.com"));
    }
}
