//! Path containment for library + managed container paths (align Electron pathRules).

use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SafePathError {
    EmptyLibraryRoot,
    EmptyLibraryPath,
    AbsoluteLibraryPath,
    DotDot,
    OutsideLibraryRoot,
    EmptyPath,
    OutsideManagedContainer,
}

impl std::fmt::Display for SafePathError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyLibraryRoot => write!(f, "empty library root"),
            Self::EmptyLibraryPath => write!(f, "empty libraryPath"),
            Self::AbsoluteLibraryPath => write!(f, "absolute libraryPath"),
            Self::DotDot => write!(f, "dotdot"),
            Self::OutsideLibraryRoot => write!(f, "outside library root"),
            Self::EmptyPath => write!(f, "empty path"),
            Self::OutsideManagedContainer => write!(f, "outside managed container"),
        }
    }
}

/// Resolve `library_path` under `library_root`; reject absolute / `..` / escape.
pub fn resolve_library_safe_path(
    library_root: &str,
    library_path: &str,
) -> Result<PathBuf, SafePathError> {
    let root = library_root.trim();
    let rel = library_path.trim();
    if root.is_empty() {
        return Err(SafePathError::EmptyLibraryRoot);
    }
    if rel.is_empty() {
        return Err(SafePathError::EmptyLibraryPath);
    }
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        return Err(SafePathError::AbsoluteLibraryPath);
    }
    for c in rel_path.components() {
        if matches!(c, Component::ParentDir) {
            return Err(SafePathError::DotDot);
        }
    }
    let root_buf = PathBuf::from(root);
    let full = root_buf.join(rel_path);
    let root_canon = normalize_for_compare(&root_buf);
    let full_canon = normalize_for_compare(&full);
    if !is_under_or_eq(&full_canon, &root_canon) {
        return Err(SafePathError::OutsideLibraryRoot);
    }
    Ok(full)
}

/// Assert absolute path is under user globals and/or configured spike/project container roots.
pub fn assert_managed_container_path(
    file_path: &str,
    allowed_container_roots: &[&str],
    allow_user_global: bool,
) -> Result<PathBuf, SafePathError> {
    let raw = file_path.trim();
    if raw.is_empty() {
        return Err(SafePathError::EmptyPath);
    }
    let full = normalize_for_compare(Path::new(raw));
    let full_cmp = path_cmp_key(&full);

    if allow_user_global {
        if let Some(home) = dirs_home() {
            for name in [".cursor", ".claude", ".codex"] {
                let root = normalize_for_compare(&home.join(name));
                if is_under_or_eq_cmp(&full_cmp, &path_cmp_key(&root)) {
                    return Ok(full);
                }
            }
        }
    }

    for root_raw in allowed_container_roots {
        let t = root_raw.trim();
        if t.is_empty() {
            continue;
        }
        let root = normalize_for_compare(Path::new(t));
        if is_under_or_eq_cmp(&full_cmp, &path_cmp_key(&root)) {
            return Ok(full);
        }
    }

    Err(SafePathError::OutsideManagedContainer)
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

pub fn normalize_for_compare(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn path_cmp_key(p: &Path) -> String {
    p.to_string_lossy().replace('/', "\\").to_lowercase()
}

fn is_under_or_eq(full: &Path, root: &Path) -> bool {
    is_under_or_eq_cmp(&path_cmp_key(full), &path_cmp_key(root))
}

fn is_under_or_eq_cmp(full: &str, root: &str) -> bool {
    if full == root {
        return true;
    }
    let prefix = if root.ends_with('\\') {
        root.to_string()
    } else {
        format!("{root}\\")
    };
    full.starts_with(&prefix)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_simple_rel() {
        let p =
            resolve_library_safe_path(r"C:\CursorSkills-Tauri2Spike", "skills/foo/SKILL.md").unwrap();
        assert!(p.to_string_lossy().contains("skills"));
    }

    #[test]
    fn rejects_dotdot() {
        let e = resolve_library_safe_path(r"C:\Lib", r"skills\..\..\Windows\System32").unwrap_err();
        assert_eq!(e, SafePathError::DotDot);
    }

    #[test]
    fn rejects_absolute() {
        let e = resolve_library_safe_path(r"C:\Lib", r"C:\Windows").unwrap_err();
        assert_eq!(e, SafePathError::AbsoluteLibraryPath);
    }

    #[test]
    fn container_allows_configured_root() {
        let root = r"C:\CursorSkills-Tauri2Spike\.spike-container";
        let target = r"C:\CursorSkills-Tauri2Spike\.spike-container\skills\a\SKILL.md";
        assert!(assert_managed_container_path(target, &[root], false).is_ok());
    }

    #[test]
    fn container_rejects_outside() {
        let root = r"C:\CursorSkills-Tauri2Spike\.spike-container";
        let target = r"C:\Windows\System32\foo";
        let e = assert_managed_container_path(target, &[root], false).unwrap_err();
        assert_eq!(e, SafePathError::OutsideManagedContainer);
    }
}
