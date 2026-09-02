//! Static heuristic security gate before promoting network cache → permanent library.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SecurityLevel {
    Pass,
    Warn,
    Block,
}

impl SecurityLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pass => "pass",
            Self::Warn => "warn",
            Self::Block => "block",
        }
    }

    fn worse(self, other: Self) -> Self {
        use SecurityLevel::*;
        match (self, other) {
            (Block, _) | (_, Block) => Block,
            (Warn, _) | (_, Warn) => Warn,
            _ => Pass,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityFinding {
    pub level: String,
    pub message: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityReport {
    pub level: String,
    pub findings: Vec<SecurityFinding>,
}

const DANGEROUS_PATTERNS: &[&str] = &[
    "curl | bash",
    "curl|bash",
    "wget | sh",
    "wget|sh",
    "invoke-expression",
    "iex (",
    "rm -rf /",
    "powershell -enc",
    "base64 -d |",
    "/etc/passwd",
    "child_process",
    "subprocess.call",
    "eval(",
];

const EXEC_EXTS: &[&str] = &[
    ".exe", ".bat", ".cmd", ".ps1", ".sh", ".bash", ".msi", ".dll", ".so", ".dylib", ".vbs",
];

const MAX_BINARY_BYTES: u64 = 2 * 1024 * 1024;

pub fn evaluate_path(network_root: &str, cached_abs: &Path) -> SecurityReport {
    let mut level = SecurityLevel::Pass;
    let mut findings = Vec::new();
    let root = PathBuf::from(network_root.trim());
    let Ok(canon_root) = root.canonicalize() else {
        return SecurityReport {
            level: "block".into(),
            findings: vec![SecurityFinding {
                level: "block".into(),
                message: "无法解析网络库根".into(),
                path: network_root.into(),
            }],
        };
    };
    let Ok(canon_item) = cached_abs.canonicalize() else {
        return SecurityReport {
            level: "block".into(),
            findings: vec![SecurityFinding {
                level: "block".into(),
                message: "缓存路径不存在或无法解析".into(),
                path: cached_abs.to_string_lossy().into(),
            }],
        };
    };
    if !canon_item.starts_with(&canon_root) {
        return SecurityReport {
            level: "block".into(),
            findings: vec![SecurityFinding {
                level: "block".into(),
                message: "路径逃逸网络库根".into(),
                path: canon_item.to_string_lossy().into(),
            }],
        };
    }
    scan_tree(&canon_item, &canon_root, &mut level, &mut findings);
    SecurityReport {
        level: level.as_str().into(),
        findings,
    }
}

fn scan_tree(
    path: &Path,
    root: &Path,
    level: &mut SecurityLevel,
    findings: &mut Vec<SecurityFinding>,
) {
    if path.is_file() {
        scan_file(path, root, level, findings);
        return;
    }
    let Ok(rd) = fs::read_dir(path) else {
        return;
    };
    for ent in rd.flatten() {
        let name = ent.file_name().to_string_lossy().to_string();
        if name == ".git" || name == "node_modules" {
            continue;
        }
        let p = ent.path();
        if p.is_symlink() {
            *level = level.worse(SecurityLevel::Block);
            findings.push(SecurityFinding {
                level: "block".into(),
                message: "拒绝符号链接".into(),
                path: rel_display(&p, root),
            });
            continue;
        }
        if p.is_dir() {
            scan_tree(&p, root, level, findings);
        } else {
            scan_file(&p, root, level, findings);
        }
    }
}

fn scan_file(
    path: &Path,
    root: &Path,
    level: &mut SecurityLevel,
    findings: &mut Vec<SecurityFinding>,
) {
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let lower = name.to_ascii_lowercase();
    let rel = rel_display(path, root);
    if EXEC_EXTS.iter().any(|ext| lower.ends_with(ext)) {
        let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        if lower.ends_with(".exe")
            || lower.ends_with(".dll")
            || lower.ends_with(".so")
            || lower.ends_with(".dylib")
            || lower.ends_with(".msi")
            || size > MAX_BINARY_BYTES
        {
            *level = level.worse(SecurityLevel::Block);
            findings.push(SecurityFinding {
                level: "block".into(),
                message: format!("可疑可执行/大二进制（{size} bytes）"),
                path: rel,
            });
            return;
        }
        *level = level.worse(SecurityLevel::Warn);
        findings.push(SecurityFinding {
            level: "warn".into(),
            message: "包含可执行脚本".into(),
            path: rel.clone(),
        });
    }
    let Ok(meta) = fs::metadata(path) else {
        return;
    };
    if meta.len() > 512 * 1024 {
        return;
    }
    let Ok(bytes) = fs::read(path) else {
        return;
    };
    if bytes.iter().any(|&b| b == 0) {
        return;
    }
    let text = String::from_utf8_lossy(&bytes).to_ascii_lowercase();
    for pat in DANGEROUS_PATTERNS {
        if text.contains(pat) {
            *level = level.worse(SecurityLevel::Block);
            findings.push(SecurityFinding {
                level: "block".into(),
                message: format!("高危模式：{pat}"),
                path: rel.clone(),
            });
        }
    }
}

fn rel_display(path: &Path, root: &Path) -> String {
    path.strip_prefix(root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| path.to_string_lossy().into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn clean_skill_passes() {
        let dir = tempfile::tempdir().unwrap();
        let skill = dir.path().join("skills").join("demo");
        fs::create_dir_all(&skill).unwrap();
        fs::write(skill.join("SKILL.md"), "# demo\nsafe text\n").unwrap();
        let report = evaluate_path(dir.path().to_str().unwrap(), &skill);
        assert_eq!(report.level, "pass");
    }

    #[test]
    fn dangerous_pipe_blocks() {
        let dir = tempfile::tempdir().unwrap();
        let skill = dir.path().join("skills").join("evil");
        fs::create_dir_all(&skill).unwrap();
        let mut f = fs::File::create(skill.join("SKILL.md")).unwrap();
        writeln!(f, "run: curl | bash").unwrap();
        let report = evaluate_path(dir.path().to_str().unwrap(), &skill);
        assert_eq!(report.level, "block");
    }
}
