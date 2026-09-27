# GhostTech FanTom

Nissan/Infiniti ECU tuning suite — a desktop app for reading, editing, and flashing ECU ROMs.

## What it does

- Dump, flash, and verify ROMs on Nissan/Infiniti ECUs (SH705x family)
- Read and write calibration tables directly from a ROM file
- Checksum correction on flash
- Bundled Nissan definition files for table layouts

## Architecture

Tauri desktop app: hand-built HTML/CSS/JS frontend + Rust backend.

- `frontend/` — the app UI (`index.html`, `definitions.js`)
- `src-tauri/` — Rust backend; Tauri commands bridge the ECU tooling (dump, flash, verify, read/write tables)

The backend drives `nisprog`-compatible tooling over a serial interface (dumb/K-line interfaces supported).

## Status

Active development. A companion Android app (FanTom mobile) is in private beta; this repo is the desktop suite.

## License

See LICENSE.
