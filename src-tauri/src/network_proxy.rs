//! Git / gh / curl 子进程的 HTTP(S) 代理解析与注入。

use std::collections::HashMap;
use std::process::Command;

/// 规范化代理 URL：trim；无 scheme 时补 `http://`；空串保持空。
pub fn normalize_http_proxy_url(raw: &str) -> String {
    let t = raw.trim();
    if t.is_empty() {
        return String::new();
    }
    let lower = t.to_ascii_lowercase();
    if lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("socks5://")
        || lower.starts_with("socks5h://")
        || lower.starts_with("socks4://")
    {
        return t.to_string();
    }
    format!("http://{t}")
}

/// 解析 Windows Internet Settings 的 `ProxyServer` 值。
/// 支持 `host:port` 与 `http=…;https=…`（优先 https，其次 http，再取首段）。
pub fn parse_windows_proxy_server(raw: &str) -> Option<String> {
    let t = raw.trim();
    if t.is_empty() {
        return None;
    }
    if !t.contains('=') {
        return Some(normalize_http_proxy_url(t));
    }
    let mut http: Option<String> = None;
    let mut https: Option<String> = None;
    let mut first: Option<String> = None;
    for part in t.split(';') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if let Some((k, v)) = part.split_once('=') {
            let key = k.trim().to_ascii_lowercase();
            let val = v.trim();
            if val.is_empty() {
                continue;
            }
            let norm = normalize_http_proxy_url(val);
            if first.is_none() {
                first = Some(norm.clone());
            }
            match key.as_str() {
                "https" => https = Some(norm),
                "http" => http = Some(norm),
                _ => {}
            }
        } else if first.is_none() {
            first = Some(normalize_http_proxy_url(part));
        }
    }
    https.or(http).or(first)
}

fn env_has_proxy() -> bool {
    for key in ["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "https_proxy", "http_proxy", "all_proxy"]
    {
        if std::env::var_os(key).is_some_and(|v| !v.is_empty()) {
            return true;
        }
    }
    false
}

/// 读 Windows 系统代理（ProxyEnable + ProxyServer）。非 Windows 恒为 None。
#[cfg(windows)]
pub fn read_windows_system_proxy() -> Option<String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let script = r#"
$ErrorActionPreference = 'Stop'
$p = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
if ($null -eq $p -or [int]$p.ProxyEnable -ne 1) { exit 2 }
if ([string]::IsNullOrWhiteSpace($p.ProxyServer)) { exit 3 }
Write-Output $p.ProxyServer
"#;
    let out = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    parse_windows_proxy_server(&s)
}

#[cfg(not(windows))]
pub fn read_windows_system_proxy() -> Option<String> {
    None
}

/// 解析应对子进程显式写入的代理 URL。
/// - 设置非空 → 用规范化后的设置值（覆盖环境）
/// - 否则若进程已有代理 env → None（继承、不覆盖）
/// - 否则尝试 Windows 系统代理
pub fn resolve_network_http_proxy(settings_proxy: &str) -> Option<String> {
    let configured = normalize_http_proxy_url(settings_proxy);
    if !configured.is_empty() {
        return Some(configured);
    }
    if env_has_proxy() {
        return None;
    }
    read_windows_system_proxy()
}

/// 给人看的生效代理说明（停滞提示用）。
pub fn describe_effective_proxy(settings_proxy: &str) -> String {
    let configured = normalize_http_proxy_url(settings_proxy);
    if !configured.is_empty() {
        return format!("代理: 设置 {configured}");
    }
    if env_has_proxy() {
        return "代理: 环境变量".into();
    }
    if let Some(sys) = read_windows_system_proxy() {
        return format!("代理: 系统 {sys}");
    }
    "代理: 未配置（网页能开≠git 能连；请到设置填写 Git/gh HTTP 代理）".into()
}

/// 供单测：解析后将写入的 env 映射（不读系统注册表，只测设置路径）。
#[cfg(test)]
pub fn proxy_env_map_for_settings(settings_proxy: &str) -> HashMap<String, String> {
    let mut m = HashMap::new();
    let configured = normalize_http_proxy_url(settings_proxy);
    if configured.is_empty() {
        return m;
    }
    m.insert("HTTP_PROXY".into(), configured.clone());
    m.insert("HTTPS_PROXY".into(), configured.clone());
    m.insert("ALL_PROXY".into(), configured);
    m
}

/// 向 Command 注入 HTTP_PROXY / HTTPS_PROXY / ALL_PROXY（若可解析）。
pub fn apply_network_proxy_env(cmd: &mut Command, settings_proxy: &str) {
    if let Some(p) = resolve_network_http_proxy(settings_proxy) {
        cmd.env("HTTP_PROXY", &p);
        cmd.env("HTTPS_PROXY", &p);
        cmd.env("ALL_PROXY", &p);
    }
}

/// 加载当前设置中的代理字段并注入（设置文件读失败时仍尝试系统/环境回退）。
pub fn apply_network_proxy_env_from_settings(cmd: &mut Command) {
    let proxy = crate::settings::load_settings()
        .map(|s| s.network_git_http_proxy)
        .unwrap_or_default();
    apply_network_proxy_env(cmd, &proxy);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_adds_http_scheme() {
        assert_eq!(
            normalize_http_proxy_url("127.0.0.1:7890"),
            "http://127.0.0.1:7890"
        );
        assert_eq!(
            normalize_http_proxy_url("http://127.0.0.1:7890"),
            "http://127.0.0.1:7890"
        );
        assert_eq!(normalize_http_proxy_url("  "), "");
        assert_eq!(
            normalize_http_proxy_url("socks5://127.0.0.1:1080"),
            "socks5://127.0.0.1:1080"
        );
    }

    #[test]
    fn parse_proxy_server_plain_and_keyed() {
        assert_eq!(
            parse_windows_proxy_server("127.0.0.1:7890").as_deref(),
            Some("http://127.0.0.1:7890")
        );
        assert_eq!(
            parse_windows_proxy_server("http=127.0.0.1:7890;https=127.0.0.1:7890").as_deref(),
            Some("http://127.0.0.1:7890")
        );
        assert_eq!(
            parse_windows_proxy_server("http=127.0.0.1:7890;https=127.0.0.1:7891").as_deref(),
            Some("http://127.0.0.1:7891")
        );
        assert!(parse_windows_proxy_server("").is_none());
    }

    #[test]
    fn settings_proxy_env_map() {
        let m = proxy_env_map_for_settings("127.0.0.1:7890");
        assert_eq!(m.get("HTTPS_PROXY").map(String::as_str), Some("http://127.0.0.1:7890"));
        assert_eq!(m.get("HTTP_PROXY").map(String::as_str), Some("http://127.0.0.1:7890"));
        assert_eq!(m.get("ALL_PROXY").map(String::as_str), Some("http://127.0.0.1:7890"));
        assert!(proxy_env_map_for_settings("").is_empty());
    }

    #[test]
    fn describe_effective_proxy_from_settings_value() {
        let d = describe_effective_proxy("127.0.0.1:7890");
        assert!(d.contains("设置"), "{d}");
        assert!(d.contains("http://127.0.0.1:7890"), "{d}");
    }
}
