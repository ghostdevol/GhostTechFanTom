#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! GhostTech FanTom — Tauri backend.
//!
//! Spawns the user's own nisprog.exe (one-shot commands) and streams
//! results back to the dashboard UI via Tauri commands.

use std::path::PathBuf;
use std::process::Command;

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

fn run_nisprog(args: &[&str]) -> Result<String, String> {
    let out = Command::new(nisprog_path())
        .args(args)
        .output()
        .map_err(|e| format!("failed to launch nisprog: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    if out.status.success() {
        Ok(stdout)
    } else if stderr.is_empty() {
        Err(format!("nisprog exited with status {}", out.status))
    } else {
        Err(stderr)
    }
}

/// Dump the ECU ROM to a .bin file.
/// TODO(Daniel): match these flags to your nisprog.exe CLI (`nisprog.exe --help`).
#[tauri::command]
fn dump_rom(port: Option<String>, out_file: Option<String>) -> Result<String, String> {
    let port = port.unwrap_or_else(|| "COM3".to_string());
    let out_file = out_file.unwrap_or_else(|| "dump.bin".to_string());
    run_nisprog(&["--port", &port, "dump", "--out", &out_file])
}

/// Flash a (possibly edited) ROM .bin back to the ECU.
/// The UI applies map edits to the .bin before calling this (ROM piece, next).
/// TODO(Daniel): match these flags to your nisprog.exe CLI (`nisprog.exe --help`).
#[tauri::command]
fn flash_rom(port: Option<String>, rom_file: Option<String>) -> Result<String, String> {
    let port = port.unwrap_or_else(|| "COM3".to_string());
    let rom_file = rom_file.unwrap_or_else(|| "dump.bin".to_string());
    run_nisprog(&["--port", &port, "flash", &rom_file])
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![dump_rom, flash_rom])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
