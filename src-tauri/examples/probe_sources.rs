//! Headless probe of baseline + popular network sources into a temp network root.
//! Does not touch the user's real library.
//!
//! Usage:
//!   cargo run --example probe_sources --release -- --skip-large
//!   cargo run --example probe_sources --release -- --only significant-gravitas-auto-gpt
//!   cargo run --example probe_sources --release -- --timeout-secs 180

use ccm_tauri2_lib::run_probe_sources;
use std::env;
use std::process;

fn main() {
    let mut skip_large = false;
    let mut only: Option<String> = None;
    let mut timeout_secs: u64 = 180;
    let mut work_root: Option<String> = None;
    let mut args = env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--skip-large" => skip_large = true,
            "--only" => {
                only = args.next();
            }
            "--timeout-secs" => {
                timeout_secs = args
                    .next()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(timeout_secs);
            }
            "--work-root" => {
                work_root = args.next();
            }
            "-h" | "--help" => {
                eprintln!(
                    "usage: probe_sources [--skip-large] [--only id] [--timeout-secs N] [--work-root dir]"
                );
                process::exit(0);
            }
            other => {
                eprintln!("unknown arg: {other}");
                process::exit(2);
            }
        }
    }

    let work = work_root.unwrap_or_else(|| {
        env::temp_dir()
            .join("ccm-probe-sources")
            .to_string_lossy()
            .to_string()
    });
    let appdata = env::temp_dir().join("ccm-probe-appdata");
    let _ = std::fs::create_dir_all(&appdata);
    env::set_var("APPDATA", &appdata);

    match run_probe_sources(&work, only.as_deref(), skip_large, timeout_secs) {
        Ok(r) => {
            println!("{}", serde_json::to_string_pretty(&r).unwrap_or_default());
            if !r.ok {
                process::exit(1);
            }
        }
        Err(e) => {
            eprintln!("{e}");
            process::exit(1);
        }
    }
}
