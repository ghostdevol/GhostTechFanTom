/* ============================================================================
   GhostTech M35x patch — SH7058 (MEC35-972, ROM ID 1EH11E)
   Implements Daniel's GhostTech patch spec (2026-10-02) line for line:
     PATCH_ENTRY dispatcher + MAP_LOGIC mode select
     GHOSTFIRE   static 2-step (launch)
     GHOSTBURNER rolling 2-step
     GHOSTFLAMES decel pops/bangs
   Input combo: BRAKE + FOG (cruise buttons dead on this car).

   LAYOUT (identical structure to the spec; relocated to this ROM's real
   free space — the erased run at 0x9DD98-0xFFFFF — because the spec's
   0xC000 region holds live calibration data in this ROM):
     PATCH_BASE + 0x000  PATCH_ENTRY / dispatch
     PATCH_BASE + 0x700  parameter block (magic "GHOSTECH", tunable in hex)
     PATCH_BASE + 0x800  MAP_LOGIC
     PATCH_BASE + 0xA00  GHOSTFIRE
     PATCH_BASE + 0xC00  GHOSTBURNER
     PATCH_BASE + 0xE00  GHOSTFLAMES

   HOOK MODEL (classic trampoline): one call inside the OEM main loop is
   redirected to PATCH_ENTRY. PATCH_ENTRY runs the dispatcher, then calls
   the displaced OEM routine with registers untouched, then returns to the
   loop. Feature blocks act through OEM mechanisms ("via OEM hooks" per
   spec): the 2-steps write the OEM rev-limiter threshold variable;
   GhostFlames offsets the OEM final timing / final fuel values in RAM.

   SYMBOLS: every hardware address lives in symbols.inc (RAM inputs, hook
   target, OEM limiter variable, final timing/fuel). That file is written
   from the ROM disassembly — it is the ONLY thing between this source
   and a flashable binary. This source intentionally does not assemble
   without it.

   BUILD (once symbols.inc exists):
     sh4-linux-gnu-as -o ghosttech_patch.o ghosttech_patch.asm
     sh4-linux-gnu-ld -Ttext=0x0009E000 -o ghosttech_patch.elf ghosttech_patch.o
     sh4-linux-gnu-objcopy -O binary ghosttech_patch.elf ghosttech_patch.bin
   Then: splice ghosttech_patch.bin at 0x9E000 into a copy of
   m35x_stock.bin, redirect the hook call to PATCH_ENTRY, fix the
   checksum (nisckfix2 rules: sum @0x7CF8, xor @0x7CF0), flash the spare.
   ============================================================================ */

        .text
        .align  2
        .global _patch_entry

        .include "symbols.inc"   /* HOOK_TARGET, RAM_RPM, RAM_SPEED, RAM_TPS,
                                    RAM_BRAKE, RAM_FOG, OEM_LIMIT_VAR,
                                    RAM_TIMING_FINAL, RAM_FUEL_FINAL,
                                    PATCH_RAM_BASE — all from disassembly */

/* ---- parameters (defaults from Daniel's spec set; stored in the parameter
        block at +0x700 too, so they can be changed in a hex editor) ---- */
        .equ    LAUNCH_RPM,        3500   /* static 2-step target (spec 3k-4k;
                                             detailed spec: 3500, soft 3400,
                                             hard 3550) */
        .equ    LAUNCH_SPEED_MAX,  5      /* static active below this speed
                                             (detailed spec: active < 5) */
        .equ    ROLLING_RPM,       4200   /* GhostBurner target in window
                                             (detailed spec: 4200) */
        .equ    ROLLING_SPEED_MIN, 15     /* rolling window (detailed spec) */
        .equ    ROLLING_SPEED_MAX, 85
        .equ    FLAMES_RPM_MIN,    2500   /* decel flames above this RPM */
        .equ    FLAMES_RETARD,     12     /* degrees of decel timing pull,
                                             in RAM_TIMING_FINAL raw units */
        .equ    STOCK_LIMIT,       6600   /* OEM rev limit, restored when
                                             no 2-step mode is active */
        /* mode codes written to patch RAM */
        .equ    MODE_NORMAL,  0
        .equ    MODE_STATIC,  1
        .equ    MODE_ROLLING, 2
        .equ    MODE_FLAMES,  3

/* patch RAM offsets (from PATCH_RAM_BASE) */
        .equ    PR_MODE,       0   /* byte: current mode */
        .equ    PR_LIMITDIRTY, 1   /* byte: 1 while we own OEM_LIMIT_VAR */

/* ============================================================================
   BLOCK 1 — PATCH_ENTRY / DISPATCH   (+0x000)
   Entered by the redirected OEM loop call (return address in PR).
   Preserves r0-r7 + r8-r13 for the displaced OEM routine; feature code
   below uses r8-r13 only.
   ============================================================================ */
_patch_entry:
patch_entry:
        sts.l   pr, @-r15
        mov.l   r8,  @-r15
        mov.l   r9,  @-r15
        mov.l   r10, @-r15
        mov.l   r11, @-r15
        mov.l   r12, @-r15
        mov.l   r13, @-r15

        bsr     map_logic          /* decide mode, write PR_MODE */
        nop

        /* load MODE */
        mov.l   L_patchram, r8
        mov.b   @(PR_MODE, r8), r9
        extu.b  r9, r9

        mov     #MODE_STATIC, r0
        cmp/eq  r0, r9
        bt      pe_static
        mov     #MODE_ROLLING, r0
        cmp/eq  r0, r9
        bt      pe_rolling
        mov     #MODE_FLAMES, r0
        cmp/eq  r0, r9
        bt      pe_flames
        bra     pe_limit_restore   /* normal: give the limiter back */
        nop
pe_static:
        bsr     ghostfire
        nop
        bra     pe_out
        nop
pe_rolling:
        bsr     ghostburner
        nop
        bra     pe_out
        nop
pe_flames:
        bsr     ghostflames
        nop
        /* fall through to limiter restore as well */
pe_limit_restore:
        /* if we previously lowered the OEM limiter and no 2-step mode is
           active anymore, restore the stock limit exactly once */
        mov.l   L_patchram, r8
        mov.b   @(PR_LIMITDIRTY, r8), r9
        extu.b  r9, r9
        mov     #1, r0
        cmp/eq  r0, r9
        bf      pe_out
        mov.l   L_limitvar, r10
        mov.l   L_stocklimit, r11
        mov.w   r11, @r10                 /* OEM_LIMIT_VAR = STOCK_LIMIT */
        mov     #0, r9
        mov.b   r9, @(PR_LIMITDIRTY, r8)  /* clear dirty flag */
pe_out:
        mov.l   @r15+, r13
        mov.l   @r15+, r12
        mov.l   @r15+, r11
        mov.l   @r15+, r10
        mov.l   @r15+, r9
        mov.l   @r15+, r8
        /* perform the OEM call this hook displaced, registers pristine */
        mov.l   L_hooktarget, r0
        jsr     @r0
        nop
        lds.l   @r15+, pr
        rts
        nop

        .align  2
L_patchram:    .long   PATCH_RAM_BASE
L_limitvar:    .long   OEM_LIMIT_VAR
L_stocklimit:  .long   STOCK_LIMIT
L_hooktarget:  .long   HOOK_TARGET

/* ============================================================================
   PARAMETER BLOCK   (+0x700) — findable + tunable in a hex editor
   ============================================================================ */
        .org    0x700
param_block:
        .ascii  "GHOSTECH"                /* magic */
        .word   0x0001                    /* version */
        .word   LAUNCH_RPM
        .word   LAUNCH_SPEED_MAX
        .word   ROLLING_RPM
        .word   ROLLING_SPEED_MIN
        .word   ROLLING_SPEED_MAX
        .word   FLAMES_RPM_MIN
        .word   FLAMES_RETARD
        .word   STOCK_LIMIT

/* ============================================================================
   BLOCK 2 — MAP / MODE LOGIC   (+0x800)
   Reads RPM, speed, throttle, brake, fog from RAM. Writes PR_MODE.
   Priority (per spec): static > rolling > flames > normal.
   Uses r8-r13. Clobbers r0 (scratch) — caller saved the OEM context.
   ============================================================================ */
        .org    0x800
map_logic:
        sts.l   pr, @-r15
        /* combo = brake && fog */
        mov.l   L_ram_brake, r8
        mov.b   @r8, r9
        mov.l   L_ram_fog, r8
        mov.b   @r8, r10
        and     r10, r9                   /* nonzero only if both set */
        /* speed */
        mov.l   L_ram_speed, r8
        mov.w   @r8, r10
        extu.w  r10, r10
        /* --- static: combo && speed < LAUNCH_SPEED_MAX --- */
        tst     r9, r9
        bt      ml_not_static
        mov     #LAUNCH_SPEED_MAX, r0
        cmp/hi  r0, r10                   /* T=1 if speed > max */
        bt      ml_not_static
        mov     #MODE_STATIC, r11
        bra     ml_write
        nop
ml_not_static:
        /* --- rolling: combo && ROLLING_SPEED_MIN <= speed <= MAX --- */
        tst     r9, r9
        bt      ml_not_rolling
        mov     #ROLLING_SPEED_MIN, r0
        cmp/hi  r10, r0                   /* T=1 if min > speed */
        bt      ml_not_rolling
        mov     #ROLLING_SPEED_MAX, r0
        cmp/hi  r0, r10                   /* T=1 if speed > max */
        bt      ml_not_rolling
        mov     #MODE_ROLLING, r11
        bra     ml_write
        nop
ml_not_rolling:
        /* --- flames: throttle closed && RPM > FLAMES_RPM_MIN --- */
        mov.l   L_ram_tps, r8
        mov.w   @r8, r10
        extu.w  r10, r10
        mov.l   L_tps_closed, r0
        cmp/hi  r0, r10                   /* T=1 if TPS above closed */
        bt      ml_normal
        mov.l   L_ram_rpm, r8
        mov.w   @r8, r10
        extu.w  r10, r10
        mov     #FLAMES_RPM_MIN, r0
        cmp/hi  r0, r10                   /* T=1 if RPM above threshold */
        bf      ml_normal
        mov     #MODE_FLAMES, r11
        bra     ml_write
        nop
ml_normal:
        mov     #MODE_NORMAL, r11
ml_write:
        mov.l   L_patchram2, r8
        mov.b   r11, @(PR_MODE, r8)
        lds.l   @r15+, pr
        rts
        nop

        .align  2
L_ram_brake:   .long   RAM_BRAKE
L_ram_fog:     .long   RAM_FOG
L_ram_speed:   .long   RAM_SPEED
L_ram_tps:     .long   RAM_TPS
L_ram_rpm:     .long   RAM_RPM
L_tps_closed:  .long   TPS_CLOSED_MAX   /* from symbols.inc: raw TPS value
                                           at/below which throttle = closed */
L_patchram2:   .long   PATCH_RAM_BASE

/* ============================================================================
   BLOCK 3 — GHOSTFIRE: STATIC 2-STEP / LAUNCH   (+0xA00)
   Holds the OEM rev limiter at LAUNCH_RPM while MODE_STATIC is active.
   The OEM limiter performs the actual fuel/ignition cut (OEM hook).
   ============================================================================ */
        .org    0xA00
ghostfire:
        mov.l   L_limitvar3, r8
        mov     #LAUNCH_RPM, r9
        mov.w   r9, @r8                   /* OEM_LIMIT_VAR = LAUNCH_RPM */
        mov.l   L_patchram3, r8
        mov     #1, r9
        mov.b   r9, @(PR_LIMITDIRTY, r8)
        rts
        nop

        .align  2
L_limitvar3:   .long   OEM_LIMIT_VAR
L_patchram3:   .long   PATCH_RAM_BASE

/* ============================================================================
   BLOCK 4 — GHOSTBURNER: ROLLING 2-STEP   (+0xC00)
   Holds the OEM rev limiter at ROLLING_RPM while MODE_ROLLING is active
   (mode logic already enforced the speed window). Target is a fixed
   in-window value in this revision; a speed/load target table is the
   documented next step once the load variable is pinned.
   ============================================================================ */
        .org    0xC00
ghostburner:
        mov.l   L_limitvar4, r8
        mov     #ROLLING_RPM, r9
        mov.w   r9, @r8                   /* OEM_LIMIT_VAR = ROLLING_RPM */
        mov.l   L_patchram4, r8
        mov     #1, r9
        mov.b   r9, @(PR_LIMITDIRTY, r8)
        rts
        nop

        .align  2
L_limitvar4:   .long   OEM_LIMIT_VAR
L_patchram4:   .long   PATCH_RAM_BASE

/* ============================================================================
   BLOCK 5 — GHOSTFLAMES: DECEL POPS/BANGS   (+0xE00)
   While MODE_FLAMES is active (throttle closed, RPM above threshold —
   decided in MAP_LOGIC): pull FLAMES_RETARD degrees from the OEM final
   timing value and enrich the OEM final fuel value by ~+15%, so unburnt
   fuel reaches the exhaust and ignites there. Offsets the OEM's own
   final values; the OEM still computes and applies them (OEM hooks).
   ============================================================================ */
        .org    0xE00
ghostflames:
        /* timing: RAM_TIMING_FINAL -= FLAMES_RETARD */
        mov.l   L_timingfinal, r8
        mov.w   @r8, r9
        mov     #FLAMES_RETARD, r10
        sub     r10, r9
        mov.w   r9, @r8
        /* fuel: RAM_FUEL_FINAL enriched by ~+15%:
           add v>>3 (+12.5%) and v>>5 (+3.125%) ~= +15.6% */
        mov.l   L_fuelfinal, r8
        mov.w   @r8, r9
        extu.w  r9, r9
        mov     r9, r10
        shlr    r10
        shlr    r10
        shlr    r10                       /* r10 = v / 8  (+12.5%) */
        mov     r9, r11
        shlr    r11
        shlr    r11
        shlr    r11
        shlr    r11
        shlr    r11                       /* r11 = v / 32 (+3.125%) */
        add     r11, r10                  /* ~ +15.6% total */
        add     r10, r9
        mov.w   r9, @r8
        rts
        nop

        .align  2
L_timingfinal: .long   RAM_TIMING_FINAL
L_fuelfinal:   .long   RAM_FUEL_FINAL

        .end
