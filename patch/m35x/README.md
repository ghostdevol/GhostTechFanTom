# GhostTech M35x patch (SH7058 / MEC35-972 / ROM ID 1EH11E)

`ghosttech_patch.asm` + `symbols.inc` — the v2 rewrite (2026-10-02),
built on disassembly passes 1–5. Daniel's spec structure (dispatcher,
mode logic, GhostFire, GhostBurner, GhostFlames) implemented with the
mechanism this ROM actually supports — **two hooks**:

1. **Brain** (executive loop): the input-service call target at
   `0xF0A8` is redirected to the patch. It runs the mode logic every
   executive cycle, keeps state in proven-unused RAM `0xFFFF4000`,
   then runs the OEM service it replaced.
2. **Hand** (scheduler entry `0x13150`): the scheduler's first 12
   bytes (register pushes, verified) become a jump to the patch's
   segment hook. Per crank segment it can **skip that segment's event
   commits entirely** (the 2-step cut — fuel and spark are one event
   stream here) or offset the six event-time slots (GhostFlames
   mechanism), then replays the OEM prologue byte-identically.

Why not v1's approach: five disassembly passes proved this firmware
has **no rev-limiter variable and no final fuel/timing values in RAM**
to write, and every candidate RAM lever is republished per crank
segment by its owner. The per-segment hook is the only design the
evidence supports. Full reasoning: the pass reports in the project
records (`m35x-disasm-pass1..5-2026-10-02.md`).

## This build (honest scope)
- **GhostFire static 2-step: complete, test-arm version.** No brake /
  speed / throttle input exists in this ECU that five passes could
  find (fog is provably absent), so arming uses RPM — the one pinned
  input: idle band 500–1600 rpm for 20 cycles arms it; cut holds
  3500 (release 3400); disarm on drop below 1400 for 30 cycles,
  engine off, or 400 straight cut cycles (safety cap).
- **GhostBurner: not armed** — no proven speed input for its window.
  Its target parameter sits in the block, ready.
- **GhostFlames: mechanism live, offset knob = 0 (stock).** The
  segment hook applies the parameter-block slot offset every segment;
  decel auto-trigger awaits a proven decel input.
- All thresholds live in the parameter block at `0x9E700`
  ("GHOSTECH" magic) and are read every cycle — hex-editor tunable.
  RPM values are stored raw (raw = rpm × 5.12, an *inferred* scale
  from the lookup axes — the first flash verifies it against a tach;
  if the hold point is off, fix the block, not the code).

## Splices (build script, on a copy of `roms/m35x_stock.bin`)
1. u32 @`0xF0A8` := `0x0009E000`
2. bytes @`0x13150`..`0x13157` := `D001 402B 0009 0009`;
   u32 @`0x13158` := `0x0009E400`
3. patch binary at `0x9E000`
4. checksum fix (sum @`0x7CF8`, xor @`0x7CF0`)

## Status
Source: **written, addresses pinned** (hook sites, RPM `0xFFFF8468`,
patch RAM `0xFFFF4000`, scheduler `0x13150` + resume `0x1315C`).
**Built 2026-10-02:** `roms/m35x_tuned_v2.bin` (sha256
`29dfc3a7d6105358…`) via `build_v2.py` — hand-assembly with every
encoding family calibrated against a decoder and the full block
disassembly verified (all branch targets, pool references, displaced
prologue); stock checksum rule re-proven on the stock image before
application; diff audit shows only the 4 intended regions changed.
Flash the spare with nisprog (`flrom`), then verify on the car:
idle arms it, rev holds ~3500, drop to idle releases.
