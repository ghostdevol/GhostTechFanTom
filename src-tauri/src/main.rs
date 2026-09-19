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
use std::path::{Path, PathBuf};
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

/// Kernel files are per ECU family: npk_7055_18.bin, npk_7058.bin,
/// npk_SH7051, npk_SH7055_18, ... (see the Binaries folder). Given an ECU
/// label, build the matching kernel filename.
fn kernel_for_ecu(ecu: &str) -> String {
    format!("npk_{}", ecu.trim().to_uppercase())
}

/// Resolve the kernel path: explicit path wins, otherwise try
/// `<base>.bin` then `<base>` next to nisprog.exe (Binaries ships .bin).
fn resolve_kernel(ecu: &str, explicit: Option<String>) -> PathBuf {
    if let Some(k) = explicit {
        return PathBuf::from(k);
    }
    let base = kernel_for_ecu(ecu);
    let cands = [format!("{base}.bin"), base];
    for c in &cands {
        let p = resolve_sidecar(c);
        if p.exists() {
            return p;
        }
    }
    resolve_sidecar(&cands[0])
}

/// Resolve a filename against the folder nisprog.exe lives in, so
/// `runkernel` gets an absolute path regardless of the app's working dir.
/// Absolute paths pass through untouched.
fn resolve_sidecar(name: &str) -> PathBuf {
    let p = PathBuf::from(name);
    if p.is_absolute() {
        return p;
    }
    let np = nisprog_path();
    if let Some(dir) = np.parent() {
        let candidate = dir.join(&p);
        if candidate.exists() {
            return candidate;
        }
    }
    p
}
/// Always terminates the session with `exit`. Blocks until nisprog quits —
/// dumps/flashes can take minutes; do NOT kill it mid-flash.
/// Feed a command script to nisprog's interactive shell and collect output.
/// Always terminates the session with `exit`. Blocks until nisprog quits —
/// dumps/flashes can take minutes; do NOT kill it mid-flash.
fn run_script(commands: &[String]) -> Result<String, String> {
    let exe = nisprog_path();
    let mut cmd = Command::new(&exe);
    // Run with cwd = nisprog's own folder so it finds its nisprog.ini
    // (interface/port/protocol setup) next to the exe. All file args we
    // pass are absolute, so this doesn't affect them.
    if let Some(dir) = exe.parent().filter(|p| !p.as_os_str().is_empty()) {
        cmd.current_dir(dir);
    }
    let mut child = cmd
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

/// Copy a file into a space-free temp staging dir and return the staged
/// path. nisprog's `runkernel` does NOT accept paths containing spaces
/// (per the author's USING.txt), and Daniel's "NisROM Tuning Suite"
/// folder has spaces — so the kernel must be staged before use.
fn stage_nospace(src: &Path, tag: &str) -> Result<PathBuf, String> {
    let name = src
        .file_name()
        .ok_or_else(|| "staging: bad file name".to_string())?;
    let mut dir = std::env::temp_dir();
    dir.push(format!("fantom_{tag}"));
    std::fs::create_dir_all(&dir).map_err(|e| format!("staging dir failed: {e}"))?;
    dir.push(name);
    std::fs::copy(src, &dir).map_err(|e| format!("staging copy failed: {e}"))?;
    Ok(dir)
}

/// Dump the ECU ROM to a .bin file.
/// `dumpmem <file> <start> <len>` — arg order confirmed via USING.txt.
#[tauri::command]
fn dump_rom(
    out_file: Option<String>,
    start: Option<String>,
    length: Option<String>,
    ecu: Option<String>,
    kernel: Option<String>,
) -> Result<String, String> {
    let start = start.unwrap_or_else(|| "0".to_string());
    let length = length.unwrap_or_else(|| "524288".to_string()); // TODO: your ROM size
    let ecu = ecu.unwrap_or_else(|| "SH7055_18".to_string());
    let kernel = resolve_kernel(&ecu, kernel);
    let kernel = stage_nospace(&kernel, "kernels")?;
    let kernel = kernel.to_string_lossy().to_string();
    // default dump target: space-free temp dir (dumpmem may share the
    // runkernel path restriction); absolutized and reported back so the
    // frontend can load it with read_file_bin.
    let abs_out: PathBuf = match out_file {
        Some(f) => std::env::current_dir()
            .map(|d| d.join(&f))
            .unwrap_or_else(|_| PathBuf::from(&f)),
        None => std::env::temp_dir().join("fantom_dump.bin"),
    };
    let abs_out_s = abs_out.to_string_lossy().to_string();
    let stdout = run_script(&[
        "npconn".to_string(),
        format!("runkernel {kernel}"),
        format!("dumpmem {abs_out_s} {start} {length}"),
        "stopkernel".to_string(),
        "npdisc".to_string(),
    ])?;
    Ok(format!("DUMP_OK path={abs_out_s}\n{stdout}"))
}

/// Flash a (possibly edited) ROM .bin back to the ECU.
/// `flrom <file>` confirmed via USING.txt, BUT it interactively offers
/// reflash choices (e.g. selective block reflash) — the `confirm` line is
/// still a guess until `help flrom` output is checked. Do not use live yet.
#[tauri::command]
fn flash_rom(
    rom_file: Option<String>,
    ecu: Option<String>,
    kernel: Option<String>,
    confirm: Option<String>,
) -> Result<String, String> {
    let rom_file = rom_file.unwrap_or_else(|| "dump.bin".to_string());
    let ecu = ecu.unwrap_or_else(|| "SH7055_18".to_string());
    let kernel = resolve_kernel(&ecu, kernel);
    let kernel = stage_nospace(&kernel, "kernels")?;
    let kernel = kernel.to_string_lossy().to_string();
    let rom_file = stage_nospace(Path::new(&rom_file), "roms")?;
    let rom_file = rom_file.to_string_lossy().to_string();
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

/// Read a binary file (e.g. a dumped ROM) into the frontend as bytes.
#[tauri::command]
fn read_file_bin(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("failed to read {path}: {e}"))
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
        .invoke_handler(tauri::generate_handler![
            dump_rom,
            flash_rom,
            nisprog_raw,
            read_file_bin
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
