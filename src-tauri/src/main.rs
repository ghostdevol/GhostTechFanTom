#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! GhostTech FanTom — Tauri backend.
//!
//! nisprog.exe is an INTERACTIVE shell (nisprog> prompt), not a one-shot CLI.
//! This backend drives it by spawning it with piped stdin, feeding it a
//! scripted command sequence, then collecting stdout. Sequences follow the
//! suite's bundled USING.txt and were validated against the strings of the
//! suite's own nisprog.exe:
//!
//!   dump : npconn -> setdev <N> -> npconf p3 0 -> runkernel <kern>
//!            -> dumpmem <file> <start> <len> -> stopkernel -> npdisc
//!   flash: npconn -> setdev <N> -> npconf p3 0 -> runkernel <kern>
//!            -> flrom <romfile> -> (answer p/y prompts) -> stopkernel -> npdisc
//!   verif: npconn -> setdev <N> -> runkernel <kern> -> flverif <file>
//!            -> stopkernel -> npdisc
//!
//! Notes:
//! - The suite's binary takes `setdev <device_no>` (0=7051, 1=7055, 2=7058),
//!   NOT the name form from newer nisprog docs.
//! - Key selection is automatic: npconn reads the ECUID and picks the best
//!   keyset itself. There is no `gk` command in the suite's binary.
//! - The ini (interface/port/protocol) is auto-loaded; nisprog is spawned
//!   with cwd = its own folder so it finds it.

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

/// setdev device numbers for the suite's nisprog build — verified via
/// strings on the bundled exe (`setdev <device_no>`):
/// 0 = 7051 (256KB), 1 = 7055 (512KB), 2 = 7058 (1024KB).
fn setdev_num_for_ecu(ecu: &str) -> &'static str {
    let e = ecu.to_uppercase();
    if e.contains("7058") {
        "2"
    } else if e.contains("7051") {
        "0"
    } else {
        "1" // 7055 default
    }
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
/// Length 0 = whole ROM (size inferred from setdev).
#[tauri::command]
fn dump_rom(
    out_file: Option<String>,
    start: Option<String>,
    length: Option<String>,
    ecu: Option<String>,
    kernel: Option<String>,
) -> Result<String, String> {
    let start = start.unwrap_or_else(|| "0".to_string());
    let length = length.unwrap_or_else(|| "0".to_string()); // 0 = full ROM
    let ecu = ecu.unwrap_or_else(|| "SH7055_18".to_string());
    let devnum = setdev_num_for_ecu(&ecu);
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
        format!("setdev {devnum}"),
        "npconf p3 0".to_string(),
        format!("runkernel {kernel}"),
        format!("dumpmem {abs_out_s} {start} {length}"),
        "stopkernel".to_string(),
        "npdisc".to_string(),
    ])?;
    Ok(format!("DUMP_OK path={abs_out_s}\n{stdout}"))
}

/// Flash a (possibly edited) ROM .bin back to the ECU.
/// `flrom <file>` offers interactive reflash choices (it can selectively
/// reflash only modified blocks) and prompts — answer "p" for a practice
/// dry-run or "y" for real. It may ask MORE THAN ONE question, so `confirm`
/// can hold several newline-separated answers. DEFAULT IS "p" (dry run):
/// a dry run normally reports verification errors since it writes nothing.
/// DO NOT pass "y" unless you are on a bench/spare ECU with a charger
/// connected and a verified backup. Not live-safe.
#[tauri::command]
fn flash_rom(
    rom_file: Option<String>,
    ecu: Option<String>,
    kernel: Option<String>,
    confirm: Option<String>,
) -> Result<String, String> {
    let rom_file = rom_file.unwrap_or_else(|| "dump.bin".to_string());
    let ecu = ecu.unwrap_or_else(|| "SH7055_18".to_string());
    let devnum = setdev_num_for_ecu(&ecu);
    let kernel = resolve_kernel(&ecu, kernel);
    let kernel = stage_nospace(&kernel, "kernels")?;
    let kernel = kernel.to_string_lossy().to_string();
    let rom_file = stage_nospace(Path::new(&rom_file), "roms")?;
    let rom_file = rom_file.to_string_lossy().to_string();
    let confirm = confirm.unwrap_or_else(|| "p".to_string()); // practice/dry-run
    let mut script = vec![
        "npconn".to_string(),
        format!("setdev {devnum}"),
        "npconf p3 0".to_string(),
        format!("runkernel {kernel}"),
        format!("flrom {rom_file}"),
    ];
    script.extend(confirm.split('\n').map(|s| s.to_string()));
    script.push("stopkernel".to_string());
    script.push("npdisc".to_string());
    run_script(&script)
}

/// Compare a ROM file against the ECU's flash contents (read-only).
/// `flverif <file>` — "Compare <file> against ROM". Modifies nothing,
/// useful after a dump (sanity check) or after a flash (verify the write).
#[tauri::command]
fn verify_rom(
    rom_file: String,
    ecu: Option<String>,
    kernel: Option<String>,
) -> Result<String, String> {
    let ecu = ecu.unwrap_or_else(|| "SH7055_18".to_string());
    let devnum = setdev_num_for_ecu(&ecu);
    let kernel = resolve_kernel(&ecu, kernel);
    let kernel = stage_nospace(&kernel, "kernels")?;
    let kernel = kernel.to_string_lossy().to_string();
    let rom_file = stage_nospace(Path::new(&rom_file), "roms")?;
    let rom_file = rom_file.to_string_lossy().to_string();
    run_script(&[
        "npconn".to_string(),
        format!("setdev {devnum}"),
        "npconf p3 0".to_string(),
        format!("runkernel {kernel}"),
        format!("flverif {rom_file}"),
        "stopkernel".to_string(),
        "npdisc".to_string(),
    ])
}

/// Read a binary file (e.g. a dumped ROM) into the frontend as bytes.
#[tauri::command]
fn read_file_bin(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("failed to read {path}: {e}"))
}

/// Parse a hex address string ("1A2B3C" or "0x1A2B3C") to a file offset.
/// Mirrors NisROM's Table3DView: `Convert.ToUInt32(StorageAddress, 16)` —
/// the XML storageaddress is a direct byte offset into the ROM dump.
fn parse_hex_addr(s: &str) -> Result<u64, String> {
    let h = s.trim().trim_start_matches("0x").trim_start_matches("0X");
    u64::from_str_radix(h, 16).map_err(|e| format!("bad hex address '{s}': {e}"))
}

/// Read a calibration table's raw values straight from a ROM file.
///
/// - `address`: hex string from the XML `storageaddress` attribute — used
///   as a direct file offset (no translation), same as NisROM.
/// - `storagetype`: "uint8" or "uint16".
/// - SH7055 is big-endian; byte pairs are swapped on read to match NisROM's
///   `new byte[2] { RomBytes[i+1], RomBytes[i] }`.
/// - Returns row-major values: for a 2D table, index = y * size_x + x.
#[tauri::command]
fn read_table(
    rom_path: String,
    address: String,
    storagetype: String,
    size_x: u32,
    size_y: u32,
    endian: Option<String>,
) -> Result<Vec<u32>, String> {
    let addr = parse_hex_addr(&address)?;
    let big = endian.as_deref().unwrap_or("big").eq_ignore_ascii_case("big");
    let elem = match storagetype.to_lowercase().as_str() {
        "uint16" => 2u64,
        _ => 1u64, // uint8 default
    };
    let nx = size_x.max(1) as u64;
    let ny = size_y.max(1) as u64;
    let count = nx * ny;
    let need = addr + count * elem;

    let bytes =
        std::fs::read(&rom_path).map_err(|e| format!("failed to read {rom_path}: {e}"))?;
    if need > bytes.len() as u64 {
        return Err(format!(
            "table at 0x{addr:X} ({} bytes) runs past end of ROM ({} bytes)",
            count * elem,
            bytes.len()
        ));
    }

    let mut out = Vec::with_capacity(count as usize);
    for i in 0..count {
        let a = (addr + i * elem) as usize;
        let v = if elem == 1 {
            bytes[a] as u32
        } else if big {
            ((bytes[a] as u32) << 8) | bytes[a + 1] as u32
        } else {
            (bytes[a] as u32) | ((bytes[a + 1] as u32) << 8)
        };
        out.push(v);
    }
    Ok(out)
}

/// Write raw calibration values back into a ROM file at the table's address.
/// Inverse of `read_table` — same offset/endianness rules. The caller is
/// responsible for checksums; use `flash_rom` to write to the ECU.
#[tauri::command]
fn write_table(
    rom_path: String,
    address: String,
    storagetype: String,
    endian: Option<String>,
    values: Vec<u32>,
) -> Result<String, String> {
    let addr = parse_hex_addr(&address)?;
    let big = endian.as_deref().unwrap_or("big").eq_ignore_ascii_case("big");
    let elem = match storagetype.to_lowercase().as_str() {
        "uint16" => 2u64,
        _ => 1u64,
    };
    let need = addr + values.len() as u64 * elem;

    let mut bytes =
        std::fs::read(&rom_path).map_err(|e| format!("failed to read {rom_path}: {e}"))?;
    if need > bytes.len() as u64 {
        return Err(format!(
            "write at 0x{addr:X} ({} bytes) runs past end of ROM ({} bytes)",
            values.len() as u64 * elem,
            bytes.len()
        ));
    }

    for (i, &v) in values.iter().enumerate() {
        let a = (addr + i as u64 * elem) as usize;
        if elem == 1 {
            bytes[a] = (v & 0xFF) as u8;
        } else if big {
            bytes[a] = ((v >> 8) & 0xFF) as u8;
            bytes[a + 1] = (v & 0xFF) as u8;
        } else {
            bytes[a] = (v & 0xFF) as u8;
            bytes[a + 1] = ((v >> 8) & 0xFF) as u8;
        }
    }
    std::fs::write(&rom_path, &bytes).map_err(|e| format!("failed to write {rom_path}: {e}"))?;
    Ok(format!(
        "wrote {} value(s) at 0x{addr:X} in {rom_path}",
        values.len()
    ))
}

/// Escape hatch: run arbitrary nisprog shell commands (e.g. `watch <addr>`,
/// `diag ...`). Powers the dashboard console. Use with care.
#[tauri::command]
fn nisprog_raw(script: String) -> Result<String, String> {
    let commands: Vec<String> = script.lines().map(|l| l.to_string()).collect();
    run_script(&commands)
}

/// One definition file's raw XML, handed to the frontend for Defs.register().
#[derive(serde::Serialize)]
struct DefFile {
    name: String,
    xml: String,
}

/// Read every *.xml under `dir` (recursive) so the frontend can register
/// the Nissan definition set. `dir` falls back to NISDEFINITIONS_PATH —
/// same env-var pattern as NISPROG_PATH.
#[tauri::command]
fn load_definitions(dir: Option<String>) -> Result<Vec<DefFile>, String> {
    let dir = match dir {
        Some(d) if !d.trim().is_empty() => d.trim().to_string(),
        _ => std::env::var("NISDEFINITIONS_PATH").map_err(|_| {
            "no definitions directory: pass one or set NISDEFINITIONS_PATH".to_string()
        })?,
    };
    let root = PathBuf::from(&dir);
    if !root.is_dir() {
        return Err(format!("definitions directory not found: {dir}"));
    }
    let mut out = Vec::new();
    let mut stack = vec![root];
    while let Some(p) = stack.pop() {
        let entries =
            std::fs::read_dir(&p).map_err(|e| format!("cannot list {}: {e}", p.display()))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("bad dir entry: {e}"))?;
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let is_xml = path
                .extension()
                .and_then(|x| x.to_str())
                .map(|x| x.eq_ignore_ascii_case("xml"))
                .unwrap_or(false);
            if !is_xml {
                continue;
            }
            let xml = std::fs::read_to_string(&path)
                .map_err(|e| format!("cannot read {}: {e}", path.display()))?;
            out.push(DefFile {
                name: path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("?")
                    .to_string(),
                xml,
            });
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            dump_rom,
            flash_rom,
            verify_rom,
            nisprog_raw,
            read_file_bin,
            read_table,
            write_table,
            load_definitions
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
