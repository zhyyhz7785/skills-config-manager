//! In-memory UI session (selection / detail) — mirrors Electron AppController fields.

use std::sync::{Mutex, OnceLock};

#[derive(Debug, Clone)]
pub struct UiSession {
    pub selected_entry_ids: Vec<String>,
    pub detail_path_side: String,
    pub detail_pane_mode: String,
}

impl Default for UiSession {
    fn default() -> Self {
        Self {
            selected_entry_ids: vec![],
            detail_path_side: "library".into(),
            detail_pane_mode: "summary".into(),
        }
    }
}

fn session_mutex() -> &'static Mutex<UiSession> {
    static SESSION: OnceLock<Mutex<UiSession>> = OnceLock::new();
    SESSION.get_or_init(|| Mutex::new(UiSession::default()))
}

pub fn with_session<R>(f: impl FnOnce(&mut UiSession) -> R) -> R {
    let mut g = session_mutex().lock().unwrap_or_else(|e| e.into_inner());
    f(&mut g)
}
