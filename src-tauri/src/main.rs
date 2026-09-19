#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! GhostTech FanTom — Tauri backend.
//!
//! nisprog.exe is an INTERACTIVE shell (nisprog> prompt), not a one-shot CLI.
//! This backend drives it by spawning it with piped stdin, feeding it a
//! scripted command sequence, then collecting stdout:
//!
//!   dump : npconn -> runkernel <kern> -> dumpmem <file> <start> <len>
//!            -> stopkernel -> npdisc
//!   flash: npconn -> runkernel <kern> -> flrom <romfile>
//!            -> stopkernel -> npdisc
//!
//! Exact flags/sequences still need confirming against `help <command>`
//! output — the sequences below are marked TODO where uncertain.

use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

/// Locate nisprog.exe:
///   1. NISPROG_PATH env var (dev override)
///   2. sidecar next to the app binary (ship nisprog.exe beside FanTom.exe)
///   3. PATH fallback
fn nisprog_path() -> PathBuf {
    if let Ok(p) = std::env::var("NISPROG_PATH") {
        return PathBuf::from(p);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let sidecar = dir.join("nisprog.exe");
            if sidecar.exists() {
                return sidecar;
            }
        }
    }
    PathBuf::from("nisprog.exe")
}

/// Feed a command script to nisprog's interactive shell and collect output.
/// Always terminates the session with `exit`. Blocks until nisprog quits —
/// dumps/flashes can take minutes; do NOT kill it mid-flash.
fn run_script(commands: &[String]) -> Result<String, String> {
    let mut child = Command::new(nisprog_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to launch nisprog: {e}"))?;

    let script = commands.join("\n") + "\nexit\n";
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(script.as_bytes())
            .map_err(|e| format!("failed to write to nisprog stdin: {e}"))?;
        // stdin dropped here -> EOF after the script
    }

    let out = child
        .wait_with_output()
        .map_err(|e| format!("failed waiting on nisprog: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    if out.status.success() {
        Ok(stdout)
    } else if stderr.is_empty() {
        Err(format!(
            "nisprog exited with status {}\n--- stdout ---\n{stdout}",
            out.status
        ))
    } else {
        Err(format!(
            "nisprog exited with status {}\n--- stdout ---\n{stdout}\n--- stderr ---\n{stderr}",
            out.status
        ))
    }
}

/// Dump the ECU ROM to a .bin file.
/// TODO: confirm `dumpmem` arg order and ROM start/length for your ECU
/// (`help dumpmem`), and the kernel filename for `runkernel`.
#[tauri::command]
fn dump_rom(
    out_file: Option<String>,
    start: Option<String>,
    length: Option<String>,
    kernel: Option<String>,
) -> Result<String, String> {
    let out_file = out_file.unwrap_or_else(|| "dump.bin".to_string());
    let start = start.unwrap_or_else(|| "0".to_string());
    let length = length.unwrap_or_else(|| "524288".to_string()); // TODO: your ROM size
    let kernel = kernel.unwrap_or_else(|| "npkern.bin".to_string()); // TODO: your kernel file
    run_script(&[
        "npconn".to_string(),
        format!("runkernel {kernel}"),
        format!("dumpmem {out_file} {start} {length}"),
        "stopkernel".to_string(),
        "npdisc".to_string(),
    ])
}

/// Flash a (possibly edited) ROM .bin back to the ECU.
/// TODO: confirm `flrom` syntax and whether it prompts for confirmation
/// (`help flrom`) — if it does, the "Y" line below may need adjusting.
#[tauri::command]
fn flash_rom(
    rom_file: Option<String>,
    kernel: Option<String>,
    confirm: Option<String>,
) -> Result<String, String> {
    let rom_file = rom_file.unwrap_or_else(|| "dump.bin".to_string());
    let kernel = kernel.unwrap_or_else(|| "npkern.bin".to_string()); // TODO: your kernel file
    let confirm = confirm.unwrap_or_else(|| "Y".to_string());
    run_script(&[
        "npconn".to_string(),
        format!("runkernel {kernel}"),
        format!("flrom {rom_file}"),
        confirm,
        "stopkernel".to_string(),
        "npdisc".to_string(),
    ])
}

/// Escape hatch: run arbitrary nisprog shell commands (e.g. `watch <addr>`,
/// `diag ...`). Powers the dashboard console. Use with care.
#[tauri::command]
fn nisprog_raw(script: String) -> Result<String, String> {
    let commands: Vec<String> = script.lines().map(|l| l.to_string()).collect();
    run_script(&commands)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![dump_rom, flash_rom, nisprog_raw])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
