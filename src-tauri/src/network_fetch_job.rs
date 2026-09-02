//! 网络库拉取后台任务：可取消 git spawn + 进度/停滞事件。

use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter};

use crate::network_library::{
    fetch_network_source_with_clone, resolve_nav_fetch_args, resolve_network_fetch_target,
};
use crate::settings::load_settings;
use crate::snapshot::AppSnapshotSubset;

pub const EVT_PROGRESS: &str = "network-fetch-progress";
pub const EVT_FINISHED: &str = "network-fetch-finished";
/// 无真实 git 进度输出多久后提示停滞（只看进度输出，不看进程存活心跳）。
const STALL_SECS: u64 = 45;
/// 无真实进度多久后自动停止并回收任务。
const HARD_IDLE_SECS: u64 = 300;

/// 将 chunk 并入缓冲区，按 `\\r` / `\\n` 切出已完成的进度段（trim 后非空）。
pub fn take_git_progress_segments(acc: &mut Vec<u8>, chunk: &[u8]) -> Vec<String> {
    acc.extend_from_slice(chunk);
    let mut out = Vec::new();
    loop {
        let Some(i) = acc.iter().position(|&b| b == b'\r' || b == b'\n') else {
            break;
        };
        let mut seg: Vec<u8> = acc.drain(..=i).collect();
        seg.pop(); // drop delimiter
        let text = String::from_utf8_lossy(&seg);
        let t = text.trim();
        if !t.is_empty() {
            out.push(t.to_string());
        }
    }
    out
}

/// 结束时刷出缓冲区残留（无分隔符的尾段）。
pub fn flush_git_progress_tail(acc: &mut Vec<u8>) -> Option<String> {
    if acc.is_empty() {
        return None;
    }
    let text = String::from_utf8_lossy(acc);
    let t = text.trim();
    let out = if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    };
    acc.clear();
    out
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartNetworkFetchResult {
    pub job_id: String,
    pub source_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkFetchProgressDto {
    pub job_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    pub phase: String,
    pub detail: String,
    pub bytes_hint: Option<u64>,
    pub stalled: bool,
    /// git `--progress` 解析出的 0–100；无匹配时为 None（不编造）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub percent: Option<u32>,
}

/// 从 git 进度行提取百分比（Receiving objects / Resolving deltas）。
pub fn parse_git_progress_percent(detail: &str) -> Option<u32> {
    let lower = detail.to_ascii_lowercase();
    if !(lower.contains("receiving objects") || lower.contains("resolving deltas")) {
        return None;
    }
    let pct_pos = detail.find('%')?;
    let before = &detail[..pct_pos];
    let digits: String = before
        .chars()
        .rev()
        .take_while(|c| c.is_ascii_digit())
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    if digits.is_empty() {
        return None;
    }
    digits.parse::<u32>().ok().map(|n| n.min(100))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkFetchFinishedDto {
    pub job_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    pub ok: bool,
    pub message: String,
    pub snapshot: Option<AppSnapshotSubset>,
}

struct JobState {
    source_id: String,
    dest: PathBuf,
    cancel: AtomicBool,
    child: Mutex<Option<Child>>,
    /// 最后一次真实 git 进度输出时间（不含进程存活心跳）。
    last_progress_at: Mutex<Instant>,
    stall_warned: AtomicBool,
    timed_out: AtomicBool,
    finished: AtomicBool,
    /// 完成事件是否已发出（取消/超时/正常完成只结算一次）。
    finish_emitted: AtomicBool,
}

struct JobTable {
    jobs: HashMap<String, JobState>,
}

fn jobs() -> &'static Mutex<JobTable> {
    static JOBS: OnceLock<Mutex<JobTable>> = OnceLock::new();
    JOBS.get_or_init(|| Mutex::new(JobTable { jobs: HashMap::new() }))
}

fn now_job_id(source_id: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{source_id}-{nanos}")
}

fn emit_progress(app: &AppHandle, dto: &NetworkFetchProgressDto) {
    if app.emit(EVT_PROGRESS, dto).is_err() {
        eprintln!("[network-fetch] emit {EVT_PROGRESS} failed; retrying once");
        if app.emit(EVT_PROGRESS, dto).is_err() {
            eprintln!("[network-fetch] emit {EVT_PROGRESS} failed after retry");
        }
    }
}

fn emit_finished(app: &AppHandle, dto: &NetworkFetchFinishedDto) {
    if app.emit(EVT_FINISHED, dto).is_err() {
        eprintln!("[network-fetch] emit {EVT_FINISHED} failed; retrying once");
        if app.emit(EVT_FINISHED, dto).is_err() {
            eprintln!("[network-fetch] emit {EVT_FINISHED} failed after retry");
        }
    }
}

fn touch_progress(job_id: &str) {
    if let Ok(table) = jobs().lock() {
        if let Some(job) = table.jobs.get(job_id) {
            if let Ok(mut t) = job.last_progress_at.lock() {
                *t = Instant::now();
            }
            job.stall_warned.store(false, Ordering::SeqCst);
        }
    }
}

fn job_source_id(job_id: &str) -> Option<String> {
    jobs()
        .lock()
        .ok()
        .and_then(|t| t.jobs.get(job_id).map(|j| j.source_id.clone()))
}

fn is_cancelled(job_id: &str) -> bool {
    jobs()
        .lock()
        .ok()
        .and_then(|t| t.jobs.get(job_id).map(|j| j.cancel.load(Ordering::SeqCst)))
        .unwrap_or(true)
}

fn cleanup_dest(dest: &Path) {
    let _ = crate::network_library::force_remove_dir_all(dest);
}

fn kill_job_child(job_id: &str) {
    if let Ok(table) = jobs().lock() {
        if let Some(job) = table.jobs.get(job_id) {
            if let Ok(mut slot) = job.child.lock() {
                if let Some(ref mut child) = *slot {
                    let _ = child.kill();
                    let _ = child.wait();
                }
                *slot = None;
            }
        }
    }
}

/// 幂等中止：标记取消、杀掉子进程；真正的 finish/emit 仍由 worker 或调用方完成。
fn request_abort(job_id: &str) {
    if let Ok(table) = jobs().lock() {
        if let Some(job) = table.jobs.get(job_id) {
            job.cancel.store(true, Ordering::SeqCst);
        }
    }
    kill_job_child(job_id);
}

fn run_git_streaming(
    app: &AppHandle,
    job_id: &str,
    args: &[&str],
    cwd: Option<&Path>,
    settings_proxy: &str,
) -> Result<String, String> {
    if is_cancelled(job_id) {
        return Err("已取消拉取".into());
    }

    let source_id = job_source_id(job_id);
    let mut cmd = Command::new("git");
    cmd.args(args);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    crate::network_proxy::apply_network_proxy_env(&mut cmd, settings_proxy);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("未找到 git 或无法启动：{e}。请安装 Git 并加入 PATH。"))?;

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法读取 git stderr".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取 git stdout".to_string())?;

    {
        let table = jobs()
            .lock()
            .map_err(|_| "任务表锁定失败".to_string())?;
        let job = table
            .jobs
            .get(job_id)
            .ok_or_else(|| "任务不存在".to_string())?;
        let mut slot = job
            .child
            .lock()
            .map_err(|_| "子进程槽锁定失败".to_string())?;
        *slot = Some(child);
    }

    touch_progress(job_id);
    let phase = args.first().copied().unwrap_or("git");
    emit_progress(
        app,
        &NetworkFetchProgressDto {
            job_id: job_id.to_string(),
            source_id: source_id.clone(),
            phase: phase.to_string(),
            detail: format!("git {} …", args.join(" ")),
            bytes_hint: None,
            stalled: false,
            percent: None,
        },
    );

    // git --progress 多用 \\r 刷新，不能按 lines()（只认 \\n）判进度。
    let mut last_stderr = String::new();
    let mut acc: Vec<u8> = Vec::new();
    let mut reader = BufReader::new(stderr);
    let mut buf = [0u8; 1024];
    let mut progress_read_err: Option<String> = None;
    loop {
        if is_cancelled(job_id) {
            break;
        }
        let n = match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) => {
                progress_read_err = Some(format!("读取 git 进度流失败：{e}"));
                break;
            }
        };
        for detail in take_git_progress_segments(&mut acc, &buf[..n]) {
            last_stderr = detail.clone();
            touch_progress(job_id);
            let percent = parse_git_progress_percent(&detail);
            emit_progress(
                app,
                &NetworkFetchProgressDto {
                    job_id: job_id.to_string(),
                    source_id: source_id.clone(),
                    phase: phase.to_string(),
                    detail,
                    bytes_hint: None,
                    stalled: false,
                    percent,
                },
            );
        }
    }
    if let Some(detail) = flush_git_progress_tail(&mut acc) {
        last_stderr = detail.clone();
        touch_progress(job_id);
        let percent = parse_git_progress_percent(&detail);
        emit_progress(
            app,
            &NetworkFetchProgressDto {
                job_id: job_id.to_string(),
                source_id: source_id.clone(),
                phase: phase.to_string(),
                detail,
                bytes_hint: None,
                stalled: false,
                percent,
            },
        );
    }

    let status = {
        let table = jobs()
            .lock()
            .map_err(|_| "任务表锁定失败".to_string())?;
        let job = table
            .jobs
            .get(job_id)
            .ok_or_else(|| "任务不存在".to_string())?;
        let mut slot = job
            .child
            .lock()
            .map_err(|_| "子进程槽锁定失败".to_string())?;
        let mut child = slot
            .take()
            .ok_or_else(|| "git 子进程丢失".to_string())?;
        child
            .wait()
            .map_err(|e| format!("等待 git 退出失败：{e}"))?
    };

    let stdout_text = {
        let mut buf = String::new();
        let mut r = BufReader::new(stdout);
        let _ = std::io::Read::read_to_string(&mut r, &mut buf);
        buf
    };

    if is_cancelled(job_id) {
        return Err("已取消拉取".into());
    }
    if let Some(err) = progress_read_err {
        return Err(err);
    }
    if !status.success() {
        let detail = if !last_stderr.trim().is_empty() {
            last_stderr.trim()
        } else if !stdout_text.trim().is_empty() {
            stdout_text.trim()
        } else {
            ""
        };
        let mut msg = format!(
            "git {} 失败：{}",
            args.first().unwrap_or(&""),
            if detail.is_empty() {
                status.to_string()
            } else {
                detail.to_string()
            }
        );
        let low = msg.to_ascii_lowercase();
        if low.contains("couldn't connect")
            || low.contains("failed to connect")
            || low.contains("timed out")
            || low.contains("connection refused")
            || low.contains("could not resolve host")
        {
            msg.push_str(
                "。浏览器能访问不等于 git 能访问。请在设置填写「Git / gh HTTP 代理」（常见 Clash：http://127.0.0.1:7890），或确认系统代理已开；也可改用本机可达的 Git URL。",
            );
        }
        return Err(msg);
    }
    Ok(stdout_text.trim().to_string())
}

fn spawn_stall_watcher(app: AppHandle, job_id: String, proxy_desc: String) {
    thread::spawn(move || {
        loop {
            thread::sleep(Duration::from_secs(2));
            let (finished, idle_secs, warn_once, hard_kill) = {
                let Ok(table) = jobs().lock() else {
                    break;
                };
                let Some(job) = table.jobs.get(&job_id) else {
                    break;
                };
                if job.finished.load(Ordering::SeqCst) {
                    break;
                }
                let elapsed = job
                    .last_progress_at
                    .lock()
                    .map(|t| t.elapsed())
                    .unwrap_or_default();
                let idle = elapsed.as_secs();
                let hard_kill = idle >= HARD_IDLE_SECS;
                let should_warn = idle >= STALL_SECS
                    && !job.stall_warned.load(Ordering::SeqCst)
                    && !hard_kill;
                if should_warn {
                    job.stall_warned.store(true, Ordering::SeqCst);
                }
                (false, idle.max(STALL_SECS), should_warn, hard_kill)
            };
            if finished {
                break;
            }
            if hard_kill {
                if let Ok(table) = jobs().lock() {
                    if let Some(job) = table.jobs.get(&job_id) {
                        job.timed_out.store(true, Ordering::SeqCst);
                    }
                }
                request_abort(&job_id);
                let source_id = job_source_id(&job_id);
                emit_progress(
                    &app,
                    &NetworkFetchProgressDto {
                        job_id: job_id.clone(),
                        source_id: source_id.clone(),
                        phase: "timeout".into(),
                        detail: format!(
                            "传输超时：已 {HARD_IDLE_SECS}s 无新进度，已自动停止。{proxy_desc}"
                        ),
                        bytes_hint: None,
                        stalled: true,
                        percent: None,
                    },
                );
                // worker 循环会因 cancel 退出并 emit finished
                break;
            }
            if warn_once {
                let source_id = job_source_id(&job_id);
                emit_progress(
                    &app,
                    &NetworkFetchProgressDto {
                        job_id: job_id.clone(),
                        source_id,
                        phase: "stalled".into(),
                        detail: format!(
                            "传输停滞，请检查网络/代理（已 {idle_secs}s 无新进度）。{proxy_desc}。可后台继续等待，或停止后重试。"
                        ),
                        bytes_hint: None,
                        stalled: true,
                        percent: None,
                    },
                );
            }
        }
    });
}

fn finish_job(job_id: &str, cleanup_partial: bool) {
    if let Ok(mut table) = jobs().lock() {
        if let Some(job) = table.jobs.remove(job_id) {
            job.finished.store(true, Ordering::SeqCst);
            if cleanup_partial {
                // Broken / Absent 半成品一律清；Healthy 仓更新失败保留由 shallow 自愈逻辑处理
                use crate::network_library::{cached_repo_state, CachedRepoState};
                match cached_repo_state(&job.dest) {
                    CachedRepoState::Healthy => {
                        // 取消 fetch 不删已有完整缓存
                    }
                    CachedRepoState::Broken | CachedRepoState::Absent => {
                        cleanup_dest(&job.dest);
                    }
                }
            }
        }
    }
}

fn try_mark_finish_emitted(job_id: &str) -> bool {
    jobs()
        .lock()
        .ok()
        .and_then(|t| {
            t.jobs.get(job_id).map(|j| {
                j.finish_emitted
                    .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                    .is_ok()
            })
        })
        .unwrap_or(false)
}

/// 启动后台拉取：立刻返回 jobId。
pub fn start_network_fetch(
    app: AppHandle,
    kind: Option<String>,
    id: Option<String>,
    url_or_baseline_id: Option<String>,
    label: Option<String>,
) -> Result<StartNetworkFetchResult, String> {
    let settings = load_settings()?;
    let (url_key, lab) = if let Some(url) = url_or_baseline_id
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        (url, label.filter(|s| !s.trim().is_empty()))
    } else {
        let kind = kind
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| "请提供 kind+id 或 urlOrBaselineId".to_string())?;
        let id = id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| "请提供 kind+id 或 urlOrBaselineId".to_string())?;
        resolve_nav_fetch_args(&settings, kind, id)?
    };

    let target = resolve_network_fetch_target(&settings, &url_key, lab.as_deref())?;
    let source_id = target.source_id.clone();
    let dest = target.dest.clone();

    {
        let table = jobs()
            .lock()
            .map_err(|_| "任务表锁定失败".to_string())?;
        if table.jobs.values().any(|j| j.source_id == source_id) {
            return Err(format!("源「{source_id}」已有进行中的拉取任务"));
        }
    }

    let job_id = now_job_id(&source_id);
    {
        let mut table = jobs()
            .lock()
            .map_err(|_| "任务表锁定失败".to_string())?;
        table.jobs.insert(
            job_id.clone(),
            JobState {
                source_id: source_id.clone(),
                dest: dest.clone(),
                cancel: AtomicBool::new(false),
                child: Mutex::new(None),
                last_progress_at: Mutex::new(Instant::now()),
                stall_warned: AtomicBool::new(false),
                timed_out: AtomicBool::new(false),
                finished: AtomicBool::new(false),
                finish_emitted: AtomicBool::new(false),
            },
        );
    }

    let proxy_desc =
        crate::network_proxy::describe_effective_proxy(&settings.network_git_http_proxy);
    let settings_proxy = settings.network_git_http_proxy.clone();
    let app_watcher = app.clone();
    spawn_stall_watcher(app_watcher, job_id.clone(), proxy_desc.clone());

    let app_bg = app.clone();
    let job_id_bg = job_id.clone();
    let source_id_bg = source_id.clone();
    let url_key_bg = url_key;
    let lab_bg = lab;
    thread::spawn(move || {
        let mut settings = match load_settings() {
            Ok(s) => s,
            Err(e) => {
                if try_mark_finish_emitted(&job_id_bg) {
                    emit_finished(
                        &app_bg,
                        &NetworkFetchFinishedDto {
                            job_id: job_id_bg.clone(),
                            source_id: Some(source_id_bg.clone()),
                            ok: false,
                            message: e,
                            snapshot: None,
                        },
                    );
                }
                finish_job(&job_id_bg, true);
                return;
            }
        };

        emit_progress(
            &app_bg,
            &NetworkFetchProgressDto {
                job_id: job_id_bg.clone(),
                source_id: Some(source_id_bg.clone()),
                phase: "prepare".into(),
                detail: format!("检查「{source_id_bg}」是否有更新，必要时再下载…（{proxy_desc}）"),
                bytes_hint: None,
                stalled: false,
                percent: None,
            },
        );
        touch_progress(&job_id_bg);

        let app_run = app_bg.clone();
        let job_for_run = job_id_bg.clone();
        let proxy_for_run = settings_proxy.clone();
        let result = fetch_network_source_with_clone(
            &mut settings,
            &url_key_bg,
            lab_bg.as_deref(),
            &mut |args, cwd| {
                run_git_streaming(&app_run, &job_for_run, args, cwd, &proxy_for_run)
            },
        );

        let timed_out = jobs()
            .lock()
            .ok()
            .and_then(|t| t.jobs.get(&job_id_bg).map(|j| j.timed_out.load(Ordering::SeqCst)))
            .unwrap_or(false);

        match result {
            Ok(op) => {
                emit_progress(
                    &app_bg,
                    &NetworkFetchProgressDto {
                        job_id: job_id_bg.clone(),
                        source_id: Some(source_id_bg.clone()),
                        phase: "done".into(),
                        detail: op.message.clone(),
                        bytes_hint: None,
                        stalled: false,
                        percent: if op.ok { Some(100) } else { None },
                    },
                );
                if try_mark_finish_emitted(&job_id_bg) {
                    emit_finished(
                        &app_bg,
                        &NetworkFetchFinishedDto {
                            job_id: job_id_bg.clone(),
                            source_id: Some(source_id_bg.clone()),
                            ok: op.ok,
                            message: op.message,
                            snapshot: Some(op.snapshot),
                        },
                    );
                }
                finish_job(&job_id_bg, false);
            }
            Err(e) => {
                let msg = if timed_out {
                    format!("传输超时：已 {HARD_IDLE_SECS}s 无新进度，已自动停止。{proxy_desc}")
                } else if e.contains("已取消") {
                    "已取消拉取".to_string()
                } else {
                    e
                };
                let soft_fail = timed_out || msg.contains("已取消");
                if !soft_fail {
                    use crate::network_library::{cached_repo_state, CachedRepoState};
                    if cached_repo_state(&dest) != CachedRepoState::Healthy {
                        cleanup_dest(&dest);
                    }
                }
                if try_mark_finish_emitted(&job_id_bg) {
                    emit_finished(
                        &app_bg,
                        &NetworkFetchFinishedDto {
                            job_id: job_id_bg.clone(),
                            source_id: Some(source_id_bg.clone()),
                            ok: false,
                            message: msg,
                            snapshot: None,
                        },
                    );
                }
                finish_job(&job_id_bg, soft_fail);
            }
        }
    });

    Ok(StartNetworkFetchResult {
        job_id,
        source_id,
    })
}

pub fn cancel_network_fetch(job_id: &str) -> Result<(), String> {
    let job_id = job_id.trim();
    if job_id.is_empty() {
        return Err("jobId 不能为空".into());
    }
    {
        let table = jobs()
            .lock()
            .map_err(|_| "任务表锁定失败".to_string())?;
        if !table.jobs.contains_key(job_id) {
            return Err(format!("无进行中的任务：{job_id}"));
        }
    }
    request_abort(job_id);
    Ok(())
}

/// 单测：无 AppHandle 时用同步路径验证 resolve+同源互斥表可注册清理。
#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::ensure_library_layout;
    use crate::network_library::{ensure_network_layout, fetch_network_source};
    use std::fs;
    use std::process::Command as StdCommand;

    #[test]
    fn git_progress_splits_on_cr_and_lf() {
        let mut acc = Vec::new();
        let segs = take_git_progress_segments(
            &mut acc,
            b"Receiving objects:  10%\rReceiving objects:  50%\r",
        );
        assert_eq!(
            segs,
            vec![
                "Receiving objects:  10%".to_string(),
                "Receiving objects:  50%".to_string(),
            ]
        );
        assert!(acc.is_empty());
        let segs2 = take_git_progress_segments(&mut acc, b"Resolving deltas: 100%\nDone");
        assert_eq!(segs2, vec!["Resolving deltas: 100%".to_string()]);
        assert_eq!(flush_git_progress_tail(&mut acc).as_deref(), Some("Done"));
    }

    #[test]
    fn parse_git_progress_percent_objects_and_deltas() {
        assert_eq!(
            parse_git_progress_percent("Receiving objects:  10% (1/10)"),
            Some(10)
        );
        assert_eq!(
            parse_git_progress_percent("Resolving deltas: 100% (42/42)"),
            Some(100)
        );
        assert_eq!(parse_git_progress_percent("Cloning into 'foo'..."), None);
        assert_eq!(parse_git_progress_percent("准备拉取…"), None);
    }

    #[test]
    fn start_rejects_duplicate_source_while_registered() {
        let mut table = jobs().lock().unwrap();
        let sid = "dup-source-test";
        // 清残留
        table.jobs.retain(|_, j| j.source_id != sid);
        table.jobs.insert(
            "job-a".into(),
            JobState {
                source_id: sid.into(),
                dest: PathBuf::from("/tmp/ccm-dup-test"),
                cancel: AtomicBool::new(false),
                child: Mutex::new(None),
                last_progress_at: Mutex::new(Instant::now()),
                stall_warned: AtomicBool::new(false),
                timed_out: AtomicBool::new(false),
                finished: AtomicBool::new(false),
                finish_emitted: AtomicBool::new(false),
            },
        );
        let has = table.jobs.values().any(|j| j.source_id == sid);
        assert!(has);
        table.jobs.remove("job-a");
    }

    #[test]
    fn acceptance_fetch_still_works_sync_local_git() {
        let dir = tempfile::tempdir().unwrap();
        let net = dir.path().join("net").to_string_lossy().to_string();
        let lib = dir.path().join("lib").to_string_lossy().to_string();
        let work = dir.path().join("seed");
        let bare = dir.path().join("bare.git");
        ensure_network_layout(&net).unwrap();
        ensure_library_layout(&lib).unwrap();

        let skill = work.join("demo-skill");
        fs::create_dir_all(&skill).unwrap();
        fs::write(
            skill.join("SKILL.md"),
            "---\nname: demo-skill\n---\n# Demo\n",
        )
        .unwrap();

        let run = |cwd: &Path, args: &[&str]| {
            let out = StdCommand::new("git")
                .args(args)
                .current_dir(cwd)
                .env("GIT_AUTHOR_NAME", "ccm")
                .env("GIT_AUTHOR_EMAIL", "ccm@local")
                .env("GIT_COMMITTER_NAME", "ccm")
                .env("GIT_COMMITTER_EMAIL", "ccm@local")
                .output()
                .expect("git");
            assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        };
        run(dir.path(), &["init", work.to_str().unwrap()]);
        run(&work, &["add", "."]);
        run(&work, &["commit", "-m", "seed"]);
        run(
            dir.path(),
            &[
                "clone",
                "--bare",
                work.to_str().unwrap(),
                bare.to_str().unwrap(),
            ],
        );

        let mut settings = crate::settings::AppSettings {
            skills_library_root: lib,
            library_root_configured: true,
            network_library_root: net,
            network_library_configured: true,
            ..Default::default()
        };
        let res = fetch_network_source(&mut settings, bare.to_str().unwrap(), Some("local-seed")).unwrap();
        assert!(res.ok, "{}", res.message);
    }
}
