/* ============================================================================
   GhostTech M35x patch — symbols.inc
   Every value here is PINNED by disassembly passes 1-5 (2026-10-02,
   reports in the tuner project records). Nothing in this file is a guess.
   ============================================================================ */

/* Patch placement: the ROM's erased run is 0x9DD98-0xFFF7F
   (0xFFF80+ is the boot signature block). */
        .equ    PATCH_BASE,     0x0009E000
        .equ    PATCH_SEG_OFF,  0x400
        .equ    PARAM_BLOCK,    0x0009E700

/* Hook 1 — brain. The executive loop calls the input service through
   the u32 at HOOK_POOL_EXEC; stock value OEM_INPUT_SVC (pass 1 §1.5,
   re-verified pass 5). The build replaces the pool value with
   PATCH_BASE. */
        .equ    HOOK_POOL_EXEC, 0x0000F0A8
        .equ    OEM_INPUT_SVC,  0x00001C14

/* Hook 2 — segment hand. Inline hook at the scheduler's entry:
   displaced span is its first 12 bytes (register pushes r8-r13,
   verified instruction by instruction — pass 5 report + targeted
   disassembly 2026-10-02); execution resumes at SCHED_RESUME. */
        .equ    SCHED_ENTRY,    0x00013150
        .equ    SCHED_RESUME,   0x0001315C
        .equ    SLOT_ARRAY,     0xFFFF2174   /* = r5 at scheduler entry */

/* Inputs (pass 1 §6.1, re-verified passes 2-5). */
        .equ    RAM_RPM,        0xFFFF8468   /* u16; raw = RPM x 5.12
                                                (inferred scale) */

/* Patch state RAM — proven unused (pass 3 §4: zero references in
   0xFFFF3CE1-0xFFFF4AFB, inside boot-cleared BSS, 16-byte slice). */
        .equ    PATCH_RAM_BASE, 0xFFFF4000

/* Deliberately ABSENT (proven not to exist / not findable in 5 passes —
   see the pass reports before adding anything here):
   OEM_LIMIT_VAR, RAM_FUEL_FINAL, RAM_TIMING_FINAL — no such variables.
   RAM_SPEED, RAM_TPS, RAM_BRAKE — produced nowhere found.
   RAM_FOG — the ECU never receives fog state. */
