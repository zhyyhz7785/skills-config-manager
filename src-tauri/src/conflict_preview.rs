//! Conflict file preview (align Electron `readPreviewEnhanced`).

use std::fs;
use std::path::Path;

const CONFLICT_PREVIEW_MAX_LINES: usize = 200;
const CONFLICT_PREVIEW_MAX_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone)]
pub struct PreviewEnhanced {
    pub content: String,
    pub lines: usize,
}

/// Electron `readPreviewEnhanced`: dir listing or file up to 64KB / 200 lines.
pub fn read_preview_enhanced(file_path: &Path) -> PreviewEnhanced {
    if !file_path.exists() {
        return PreviewEnhanced {
            content: "（文件不存在）".into(),
            lines: 0,
        };
    }
    let Ok(meta) = fs::symlink_metadata(file_path) else {
        return PreviewEnhanced {
            content: "（无法读取）".into(),
            lines: 0,
        };
    };
    if meta.is_dir() {
        let Ok(rd) = fs::read_dir(file_path) else {
            return PreviewEnhanced {
                content: "（无法列目录）".into(),
                lines: 0,
            };
        };
        let all: Vec<_> = rd.flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
        let entries: Vec<_> = all.iter().take(10).cloned().collect();
        let more = all.len().saturating_sub(entries.len());
        let mut content = format!("[文件夹，包含 {} 项]\n{}", all.len(), entries.join("\n"));
        if more > 0 {
            content.push_str(&format!("\n... 还有 {more} 项"));
        }
        return PreviewEnhanced {
            content,
            lines: entries.len(),
        };
    }

    let Ok(buf) = fs::read(file_path) else {
        return PreviewEnhanced {
            content: "（无法读取）".into(),
            lines: 0,
        };
    };
    let sliced = if buf.len() > CONFLICT_PREVIEW_MAX_BYTES {
        &buf[..CONFLICT_PREVIEW_MAX_BYTES]
    } else {
        buf.as_slice()
    };
    let text = if sliced.starts_with(&[0xEF, 0xBB, 0xBF]) {
        String::from_utf8_lossy(&sliced[3..]).into_owned()
    } else {
        String::from_utf8_lossy(sliced).into_owned()
    };
    let all_lines: Vec<&str> = text.lines().collect();
    let truncated_by_lines = all_lines.len() > CONFLICT_PREVIEW_MAX_LINES;
    let truncated_by_bytes = buf.len() > CONFLICT_PREVIEW_MAX_BYTES;
    let lines: Vec<&str> = all_lines
        .iter()
        .take(CONFLICT_PREVIEW_MAX_LINES)
        .copied()
        .collect();
    let mut content = lines.join("\n");
    if truncated_by_lines || truncated_by_bytes {
        content.push_str("\n…（预览已截断）");
    }
    PreviewEnhanced {
        content,
        lines: lines.len(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_reads_more_than_200_chars() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("long.md");
        let mut body = String::new();
        for i in 0..50 {
            body.push_str(&format!("line-{i}-abcdefghijklmnopqrstuvwxyz\n"));
        }
        body.push_str("DIFF_MARKER_UNIQUE_TAIL\n");
        fs::write(&f, body.as_bytes()).unwrap();
        let p = read_preview_enhanced(&f);
        assert!(p.content.contains("DIFF_MARKER_UNIQUE_TAIL"), "{}", p.content);
        assert!(p.lines > 10);
    }
}
