//! Headless performance bench: snapshot + scan preview on fixed roots.
//! Usage: cargo run --example bench_perf -- <library_root> <scan_root> [max_depth]

use ccm_tauri2_lib::run_perf_bench;
use std::env;
use std::process;

fn main() {
    let mut args = env::args().skip(1);
    let library = args.next().unwrap_or_else(|| {
        eprintln!("usage: bench_perf <library_root> <scan_root> [max_depth]");
        process::exit(2);
    });
    let scan = args.next().unwrap_or_else(|| {
        eprintln!("usage: bench_perf <library_root> <scan_root> [max_depth]");
        process::exit(2);
    });
    let depth: i32 = args
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(5);

    match run_perf_bench(&library, &scan, depth) {
        Ok(r) => {
            println!("{}", serde_json::to_string_pretty(&r).unwrap_or_default());
        }
        Err(e) => {
            eprintln!("{e}");
            process::exit(1);
        }
    }
}
