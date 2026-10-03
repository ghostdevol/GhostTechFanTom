# GhostTech M35x patch (SH7058 / MEC35-972 / ROM ID 1EH11E)

Daniel's GhostTech patch spec (2026-10-02) implemented as SH assembly:
`ghosttech_patch.asm` — PATCH_ENTRY dispatcher, MAP_LOGIC, GHOSTFIRE
(static 2-step), GHOSTBURNER (rolling 2-step), GHOSTFLAMES (decel
pops). Trigger combo: **brake + fog** (the car's cruise buttons are
dead). Full spec text: `files/m35x-ghosttech-patch-spec-daniel.md` in
the tuner project records (verbatim + ROM-fact addendum).

## Layout (patch base 0x9E000 — this ROM's erased space)
- +0x000 PATCH_ENTRY / dispatch (trampoline: runs the dispatcher, then
  the OEM routine the hook displaced, then returns to the OEM loop)
- +0x700 parameter block ("GHOSTECH" magic — launch RPM, rolling RPM,
  windows, flames threshold/retard; editable in a hex editor)
- +0x800 MAP_LOGIC · +0xA00 GHOSTFIRE · +0xC00 GHOSTBURNER ·
  +0xE00 GHOSTFLAMES

2-steps work *through the OEM rev limiter*: the feature blocks write
the OEM limiter-threshold variable; the OEM performs the cut. Mode
exit restores the stock 6600 limit exactly once (dirty-flag tracked).
GhostFlames offsets the OEM final timing (−12°) and final fuel
(~+15%) values while decel mode is active.

## Status
Source: **complete per spec.** Flashable binary: pending
`symbols.inc` — the hardware addresses only the ROM disassembly can
name (hook target, RAM addresses for RPM/speed/TPS/brake/fog, OEM
limiter variable, final timing/fuel, patch RAM base, TPS-closed raw
value). The source refuses to assemble without it — no guessed
addresses go into a flash file. Disassembly pass 1 is running.

## Build (once symbols.inc exists)
```
sh4-linux-gnu-as -o ghosttech_patch.o ghosttech_patch.asm
sh4-linux-gnu-ld -Ttext=0x0009E000 -o ghosttech_patch.elf ghosttech_patch.o
sh4-linux-gnu-objcopy -O binary ghosttech_patch.elf ghosttech_patch.bin
```
Splice at 0x9E000 into a copy of `roms/m35x_stock.bin`, point the
hook call at PATCH_ENTRY, fix the checksum (sum word @0x7CF8, XOR
word @0x7CF0 — nisckfix2 rules), flash the spare with nisprog.
