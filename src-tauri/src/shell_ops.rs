//! Thin shell / dialog ops (M3 domain 1 — retire from Node sidecar).

use std::path::Path;
#[cfg(not(windows))]
use std::process::Command;

#[tauri::command]
pub fn pick_folder(title: Option<String>) -> Result<Option<String>, String> {
    let picked = rfd::FileDialog::new()
        .set_title(title.unwrap_or_else(|| "选择文件夹".into()))
        .pick_folder();
    Ok(picked.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn pick_file(
    title: Option<String>,
    filter_name: Option<String>,
    filter_ext: Option<String>,
) -> Result<Option<String>, String> {
    let mut dlg = rfd::FileDialog::new().set_title(title.unwrap_or_else(|| "选择文件".into()));
    let name = filter_name.unwrap_or_else(|| "JSON".into());
    let ext = filter_ext.unwrap_or_else(|| "json".into());
    dlg = dlg.add_filter(&name, &[ext.as_str()]);
    Ok(dlg.pick_file().map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn save_file(
    title: Option<String>,
    default_name: Option<String>,
    filter_name: Option<String>,
    filter_ext: Option<String>,
) -> Result<Option<String>, String> {
    let mut dlg = rfd::FileDialog::new().set_title(title.unwrap_or_else(|| "存储文件".into()));
    let name = filter_name.unwrap_or_else(|| "JSON".into());
    let ext = filter_ext.unwrap_or_else(|| "json".into());
    dlg = dlg.add_filter(&name, &[ext.as_str()]);
    if let Some(n) = default_name {
        let t = n.trim();
        if !t.is_empty() {
            dlg = dlg.set_file_name(t);
        }
    }
    Ok(dlg.save_file().map(|p| p.to_string_lossy().to_string()))
}

pub(crate) fn looks_like_http_url(t: &str) -> bool {
    let lower = t.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

/// Explorer 不认 `\\?\` 前缀和正斜杠，乱解析时会落到「文档」文件夹。
pub(crate) fn windows_shell_path(p: &str) -> String {
    let mut s = p.trim().replace('/', "\\");
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        s = rest.to_string();
    }
    s
}

#[cfg(windows)]
fn wide_z(s: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(s)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

/// 用 Shell「打开」动词。spawn `explorer.exe 路径` 会把参数丢掉、落到「文档」。
#[cfg(windows)]
fn shell_execute_open(path: &str) -> Result<(), String> {
    #[link(name = "shell32")]
    extern "system" {
        fn ShellExecuteW(
            hwnd: *mut core::ffi::c_void,
            lp_operation: *const u16,
            lp_file: *const u16,
            lp_parameters: *const u16,
            lp_directory: *const u16,
            n_show_cmd: i32,
        ) -> *mut core::ffi::c_void;
    }
    const SW_SHOWNORMAL: i32 = 1;
    let op = wide_z("open");
    let file = wide_z(path);
    let ret = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            op.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    let code = ret as isize;
    if code <= 32 {
        return Err(format!("open failed: ShellExecute {code}"));
    }
    Ok(())
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
        let p = if is_url {
            t.to_string()
        } else {
            windows_shell_path(t)
        };
        return shell_execute_open(&p);
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
        if path.is_dir() {
            return open_path(t.to_string());
        }
        let parent = path
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|| t.to_string());
        return open_path(parent);
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
        assert!(!looks_like_http_url(r"C:\Users\alice\CCM-NetworkLibrary"));
        assert!(!looks_like_http_url("ftp://example.com"));
    }

    #[test]
    fn windows_shell_path_strips_verbatim_and_slashes() {
        assert_eq!(
            windows_shell_path(r"\\?\C:\CursorSkills\.net\cache\foo"),
            r"C:\CursorSkills\.net\cache\foo"
        );
        assert_eq!(
            windows_shell_path(r"C:/CursorSkills/.net/cache/foo"),
            r"C:\CursorSkills\.net\cache\foo"
        );
    }
}
