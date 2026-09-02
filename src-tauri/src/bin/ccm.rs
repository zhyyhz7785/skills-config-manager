//! Plan/05 W3-S2：只读/受控 CLI，供 Agent 调用（JSON stdout）。

use ccm_tauri2_lib::cli_api::{cli_deploy, cli_refresh, cli_status, CliOptions};
use std::env;
use std::io::{self, IsTerminal, Write};
use std::process::ExitCode;

fn main() -> ExitCode {
    let mut args: Vec<String> = env::args().skip(1).collect();
    let mut force_conflict = false;
    let mut library_override: Option<String> = None;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--force-conflict" => {
                force_conflict = true;
                args.remove(i);
            }
            "--library" => {
                if i + 1 >= args.len() {
                    eprintln!("{{\"ok\":false,\"error\":\"--library 需要路径\"}}");
                    return ExitCode::from(2);
                }
                library_override = Some(args[i + 1].clone());
                args.remove(i);
                args.remove(i);
            }
            _ => i += 1,
        }
    }

    let opts = CliOptions {
        force_conflict,
        library_override,
        is_tty: io::stdin().is_terminal(),
    };

    let result = match args.first().map(|s| s.as_str()) {
        Some("status") => cli_status(&opts),
        Some("deploy") => {
            let ids: Vec<String> = args.iter().skip(1).cloned().collect();
            if ids.is_empty() {
                Err("deploy 需要至少一个 entryId".into())
            } else {
                cli_deploy(&opts, &ids)
            }
        }
        Some("refresh") => cli_refresh(&opts),
        Some(other) => Err(format!("未知子命令: {other}（支持 status|deploy|refresh）")),
        None => Err("用法: ccm status|deploy <id…>|refresh [--force-conflict] [--library <path>]".into()),
    };

    match result {
        Ok(json) => {
            let _ = writeln!(io::stdout(), "{json}");
            ExitCode::SUCCESS
        }
        Err(e) => {
            let _ = writeln!(
                io::stderr(),
                "{{\"ok\":false,\"error\":{}}}",
                serde_json::to_string(&e).unwrap_or_else(|_| format!("\"{e}\""))
            );
            ExitCode::from(1)
        }
    }
}
