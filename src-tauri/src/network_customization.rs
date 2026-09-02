//! Customization ledger vs promote baseline; reapply on upstream update.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

use crate::catalog::{load_catalog, upsert_entry, CatalogEntry};
use crate::path_guard::resolve_library_safe_path;

pub const CUSTOMIZATIONS_DIR: &str = ".ccm/customizations";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NetworkProvenance {
    #[serde(default)]
    pub source_url: String,
    #[serde(default)]
    pub source_id: String,
    #[serde(default)]
    pub remote_ref: String,
    #[serde(default)]
    pub baseline_content_hash: String,
    #[serde(default)]
    pub skill_name: String,
    #[serde(default)]
    pub promoted_at: String,
    #[serde(default)]
    pub network_entry_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CustomizationRecord {
    #[serde(default)]
    pub entry_id: String,
    #[serde(default)]
    pub baseline_hash: String,
    #[serde(default)]
    pub custom_hash: String,
    #[serde(default)]
    pub unified_diff: String,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub baseline_text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReapplyHintDto {
    pub entry_id: String,
    pub skill_name: String,
    pub source_url: String,
    pub network_entry_id: String,
    pub has_customization: bool,
    pub message: String,
}

fn now_secs() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
        .to_string()
}

fn sha256_hex(text: &str) -> String {
    let mut h = Sha256::new();
    h.update(text.as_bytes());
    format!("{:x}", h.finalize())
}

pub fn customization_path(library_root: &str, entry_id: &str) -> PathBuf {
    Path::new(library_root.trim())
        .join(CUSTOMIZATIONS_DIR)
        .join(format!("{entry_id}.json"))
}

pub fn load_customization(library_root: &str, entry_id: &str) -> Option<CustomizationRecord> {
    let path = customization_path(library_root, entry_id);
    if !path.is_file() {
        return None;
    }
    let raw = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn has_customization_diff(library_root: &str, entry_id: &str) -> bool {
    load_customization(library_root, entry_id)
        .map(|r| !r.unified_diff.trim().is_empty())
        .unwrap_or(false)
}

/// Move `.ccm/customizations/{old}.json` to the new id after a catalog rename.
pub fn relocate_customization(
    library_root: &str,
    old_id: &str,
    new_id: &str,
) -> Result<(), String> {
    if old_id.is_empty() || new_id.is_empty() || old_id == new_id {
        return Ok(());
    }
    let old_path = customization_path(library_root, old_id);
    if !old_path.is_file() {
        return Ok(());
    }
    let Some(mut rec) = load_customization(library_root, old_id) else {
        return Ok(());
    };
    rec.entry_id = new_id.to_string();
    save_customization(library_root, &rec)?;
    if old_path.exists() {
        let _ = fs::remove_file(&old_path);
    }
    Ok(())
}

pub fn save_customization(library_root: &str, rec: &CustomizationRecord) -> Result<(), String> {
    let dir = Path::new(library_root.trim()).join(CUSTOMIZATIONS_DIR);
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir customizations: {e}"))?;
    let path = customization_path(library_root, &rec.entry_id);
    let tmp = dir.join(format!("{}.{}.tmp", rec.entry_id, std::process::id()));
    let raw = serde_json::to_string_pretty(rec).map_err(|e| e.to_string())?;
    fs::write(&tmp, raw).map_err(|e| format!("write customization tmp: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("rename customization: {e}"))?;
    Ok(())
}

pub fn get_provenance(entry: &CatalogEntry) -> Option<NetworkProvenance> {
    let v = entry.extra.get("networkProvenance")?;
    serde_json::from_value(v.clone()).ok()
}

pub fn set_provenance(entry: &mut CatalogEntry, prov: &NetworkProvenance) {
    if let Ok(v) = serde_json::to_value(prov) {
        entry.extra.insert("networkProvenance".into(), v);
    }
}

pub fn unified_diff(baseline: &str, custom: &str, path_label: &str) -> String {
    let a: Vec<&str> = baseline.split_inclusive('\n').collect();
    let b: Vec<&str> = custom.split_inclusive('\n').collect();
    let mut out = String::new();
    out.push_str(&format!("--- a/{path_label}\n+++ b/{path_label}\n"));
    if a.len() + b.len() > 4000 {
        out.push_str(&format!("@@ large file: {} → {} lines @@\n", a.len(), b.len()));
        return out;
    }
    let (n, m) = (a.len(), b.len());
    let mut dp = vec![vec![0u32; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            if a[i] == b[j] {
                dp[i][j] = dp[i + 1][j + 1] + 1;
            } else {
                dp[i][j] = dp[i + 1][j].max(dp[i][j + 1]);
            }
        }
    }
    let mut i = 0usize;
    let mut j = 0usize;
    let mut hunk = Vec::new();
    while i < n || j < m {
        if i < n && j < m && a[i] == b[j] {
            hunk.push(format!(" {}", a[i].trim_end_matches('\n')));
            i += 1;
            j += 1;
        } else if j < m && (i == n || dp[i][j + 1] >= dp[i + 1][j]) {
            hunk.push(format!("+{}", b[j].trim_end_matches('\n')));
            j += 1;
        } else if i < n {
            hunk.push(format!("-{}", a[i].trim_end_matches('\n')));
            i += 1;
        }
    }
    out.push_str(&format!("@@ -1,{} +1,{} @@\n", n.max(1), m.max(1)));
    for line in hunk {
        out.push_str(&line);
        out.push('\n');
    }
    out
}

pub fn apply_unified_diff_to_text(
    _old_baseline: &str,
    new_upstream: &str,
    diff: &str,
) -> Result<String, String> {
    let custom_adds: Vec<&str> = diff
        .lines()
        .filter(|l| l.starts_with('+') && !l.starts_with("+++"))
        .map(|l| l.strip_prefix('+').unwrap_or(l))
        .collect();
    let custom_dels: Vec<&str> = diff
        .lines()
        .filter(|l| l.starts_with('-') && !l.starts_with("---"))
        .map(|l| l.strip_prefix('-').unwrap_or(l))
        .collect();
    let mut result = new_upstream.to_string();
    for del in &custom_dels {
        if del.trim().is_empty() {
            continue;
        }
        if result.lines().any(|l| l == *del) {
            let mut lines: Vec<&str> = result.lines().collect();
            if let Some(pos) = lines.iter().position(|l| *l == *del) {
                lines.remove(pos);
                result = lines.join("\n");
                if new_upstream.ends_with('\n') {
                    result.push('\n');
                }
            }
        }
    }
    for add in &custom_adds {
        if add.trim().is_empty() {
            continue;
        }
        if !result.lines().any(|l| l == *add) {
            if !result.ends_with('\n') && !result.is_empty() {
                result.push('\n');
            }
            result.push_str(add);
            result.push('\n');
        }
    }
    Ok(result)
}

pub fn seed_baseline_on_promote(
    library_root: &str,
    entry_id: &str,
    baseline_text: &str,
    baseline_hash: &str,
) -> Result<(), String> {
    save_customization(
        library_root,
        &CustomizationRecord {
            entry_id: entry_id.to_string(),
            baseline_hash: baseline_hash.to_string(),
            custom_hash: baseline_hash.to_string(),
            unified_diff: String::new(),
            updated_at: now_secs(),
            baseline_text: baseline_text.to_string(),
        },
    )
}

pub fn record_after_library_save(
    library_root: &str,
    entry_id: &str,
    new_content: &str,
) -> Result<Option<String>, String> {
    let load = load_catalog(library_root);
    let entry = load
        .catalog
        .entries
        .iter()
        .find(|e| e.id == entry_id)
        .cloned()
        .ok_or_else(|| format!("未找到条目：{entry_id}"))?;
    let Some(prov) = get_provenance(&entry) else {
        return Ok(None);
    };
    let mut baseline_text = String::new();
    let mut baseline_hash = prov.baseline_content_hash.clone();
    if let Some(prev) = load_customization(library_root, entry_id) {
        if !prev.baseline_text.is_empty() {
            baseline_text = prev.baseline_text;
        }
        if baseline_hash.is_empty() {
            baseline_hash = prev.baseline_hash;
        }
    }
    if baseline_text.is_empty() {
        return Ok(None);
    }
    let custom_hash = sha256_hex(new_content);
    if !baseline_hash.is_empty() && custom_hash.eq_ignore_ascii_case(&baseline_hash) {
        let path = customization_path(library_root, entry_id);
        if path.exists() {
            let _ = fs::remove_file(path);
        }
        crate::oplog::append(
            library_root,
            crate::oplog::OpEvent {
                op: "recordDiff".into(),
                entry_id: entry_id.to_string(),
                network_entry_id: prov.network_entry_id.clone(),
                source_id: prov.source_id.clone(),
                note: "保存后与晋升基线一致，已清除定制 diff".into(),
                ..Default::default()
            },
        );
        return Ok(Some("已恢复为晋升基线，清除定制差分".into()));
    }
    let diff = unified_diff(&baseline_text, new_content, &format!("{entry_id}.md"));
    save_customization(
        library_root,
        &CustomizationRecord {
            entry_id: entry_id.to_string(),
            baseline_hash,
            custom_hash,
            unified_diff: diff,
            updated_at: now_secs(),
            baseline_text,
        },
    )?;
    crate::oplog::append(
        library_root,
        crate::oplog::OpEvent {
            op: "recordDiff".into(),
            entry_id: entry_id.to_string(),
            network_entry_id: prov.network_entry_id.clone(),
            source_id: prov.source_id.clone(),
            note: "库内保存：已记录相对网络原版的定制 diff".into(),
            ..Default::default()
        },
    );
    Ok(Some(format!("已记录相对网络原版的定制 diff：{entry_id}")))
}

pub fn reapply_customization_on_text(
    library_root: &str,
    entry_id: &str,
    new_upstream_text: &str,
    new_upstream_hash: &str,
) -> Result<(String, bool), String> {
    let Some(rec) = load_customization(library_root, entry_id) else {
        return Ok((new_upstream_text.to_string(), false));
    };
    if rec.unified_diff.trim().is_empty() || rec.custom_hash == rec.baseline_hash {
        let mut next = rec;
        next.baseline_text = new_upstream_text.to_string();
        next.baseline_hash = new_upstream_hash.to_string();
        next.custom_hash = new_upstream_hash.to_string();
        next.unified_diff.clear();
        next.updated_at = now_secs();
        save_customization(library_root, &next)?;
        return Ok((new_upstream_text.to_string(), false));
    }
    let merged = apply_unified_diff_to_text(&rec.baseline_text, new_upstream_text, &rec.unified_diff)?;
    let custom_hash = sha256_hex(&merged);
    let diff = unified_diff(new_upstream_text, &merged, &format!("{entry_id}.md"));
    save_customization(
        library_root,
        &CustomizationRecord {
            entry_id: entry_id.to_string(),
            baseline_hash: new_upstream_hash.to_string(),
            custom_hash,
            unified_diff: diff,
            updated_at: now_secs(),
            baseline_text: new_upstream_text.to_string(),
        },
    )?;
    Ok((merged, true))
}

pub fn write_merged_to_library_entry(
    library_root: &str,
    entry: &CatalogEntry,
    text: &str,
) -> Result<(), String> {
    let full =
        resolve_library_safe_path(library_root, &entry.library_path).map_err(|e| e.to_string())?;
    let meta = if full.is_dir() {
        let skill = full.join("SKILL.md");
        if skill.is_file() || !full.exists() {
            skill
        } else {
            return Err("无 SKILL.md 可写".into());
        }
    } else {
        full
    };
    if let Some(parent) = meta.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&meta, text.as_bytes()).map_err(|e| format!("write merged: {e}"))?;
    Ok(())
}

pub fn update_entry_provenance_hash(
    library_root: &str,
    entry_id: &str,
    new_hash: &str,
    remote_ref: &str,
) -> Result<(), String> {
    let load = load_catalog(library_root);
    let mut entry = load
        .catalog
        .entries
        .iter()
        .find(|e| e.id == entry_id)
        .cloned()
        .ok_or_else(|| format!("未找到条目：{entry_id}"))?;
    if let Some(mut prov) = get_provenance(&entry) {
        prov.baseline_content_hash = new_hash.to_string();
        if !remote_ref.is_empty() {
            prov.remote_ref = remote_ref.to_string();
        }
        set_provenance(&mut entry, &prov);
        upsert_entry(library_root, entry)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relocate_customization_renames_json() {
        let dir = tempfile::tempdir().unwrap();
        let lib = dir.path().to_string_lossy().to_string();
        save_customization(
            &lib,
            &CustomizationRecord {
                entry_id: "S1-foo".into(),
                unified_diff: "+note\n".into(),
                baseline_text: "# a\n".into(),
                ..Default::default()
            },
        )
        .unwrap();
        relocate_customization(&lib, "S1-foo", "L1-foo").unwrap();
        assert!(customization_path(&lib, "L1-foo").is_file());
        assert!(!customization_path(&lib, "S1-foo").exists());
        let rec = load_customization(&lib, "L1-foo").unwrap();
        assert_eq!(rec.entry_id, "L1-foo");
        assert!(rec.unified_diff.contains("+note"));
    }

    #[test]
    fn diff_and_reapply_add_line() {
        let base = "# a\nline1\n";
        let custom = "# a\nline1\nmy note\n";
        let d = unified_diff(base, custom, "x.md");
        assert!(d.contains("+my note"));
        let upstream = "# a\nline1\nline2\n";
        let merged = apply_unified_diff_to_text(base, upstream, &d).unwrap();
        assert!(merged.contains("my note"));
        assert!(merged.contains("line2"));
    }
}
