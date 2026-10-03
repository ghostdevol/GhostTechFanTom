/* ============================================================================
   GhostTech M35x patch v2 — SH7058 (MEC35-972, ROM ID 1EH11E)
   ----------------------------------------------------------------------------
   v2 REWRITE (2026-10-02, after disassembly passes 1-5). v1's mechanism —
   "write the OEM rev-limiter variable" — is DEAD: five passes proved this
   firmware has no limiter variable, no final fuel/timing RAM values, and no
   RAM location of any kind that a patch running at executive rate can hold
   (every candidate is republished/consumed per crank segment by its owner).

   THE DESIGN THAT SURVIVES — TWO HOOKS:

   HOOK 1 (the brain) — executive loop. The u32 call target at 0x0000F0A8
   (stock: 0x00001C14, the per-cycle input service) is redirected to
   PATCH_BRAIN. PATCH_BRAIN runs the mode logic every executive cycle
   (once per 10 vec120 ticks), keeps its state in patch RAM at
   0xFFFF4000 (proven unused, boot-cleared), then tail-jumps to the OEM
   service 0x1C14, which returns to the loop. The OEM sees identical
   registers and stack.

   HOOK 2 (the hand) — scheduler entry. The first 12 bytes of the event
   scheduler 0x00013150 (its r8-r13 register pushes — verified byte for
   byte, no PC-relative content) are replaced by a jump to PATCH_SEG:
       0x13150: D001        mov.l @(1,PC),r0     ; literal at 0x13158
       0x13152: 402B        jmp   @r0
       0x13154: 0009        nop
       0x13156: 0009        nop
       0x13158: .long       PATCH_SEG (0x0009E400)
   PATCH_SEG runs per crank segment, in the firing path itself, with
   r4 = channel mask, r5 = slot array pointer (0xFFFF2174):
     - CUT flag set  -> return immediately: this segment commits NO
       events. That is the 2-step cut (fuel+spark are one event stream
       in this firmware — a hard cut).
     - FLAMES offset nonzero -> add it to the six slot words (event
       times) for this segment, then fall into the OEM prologue replay.
     - otherwise -> replay the displaced pushes (r8-r13) and jump to
       0x0001315C, the scheduler's original continuation. Byte-identical
       behaviour to stock.

   FEATURES IN THIS BUILD (honest scope):
     GHOSTFIRE static 2-step — COMPLETE, test-arm version. With no proven
       brake/speed/throttle inputs in this ECU (passes 2-5: fog absent,
       brake/speed/throttle produced nowhere found), arming uses the one
       input that is pinned — RPM:
         ARM:    RPM in idle band (500-1600) for 20 executive cycles
         CUT:    RPM >= 3500 target (release below 3400, hysteresis)
         DISARM: RPM < 1400 for 30 cycles (lifted / back to idle),
                 engine off, or 400 consecutive cut cycles (safety cap)
     GHOSTBURNER rolling 2-step — NOT ARMED in this build: its speed
       window has no proven speed input. Parameter retained in the block.
     GHOSTFLAMES — the segment-hook slot-offset mechanism is BUILT and
       live; its offset value comes from the parameter block (stock 0 =
       no offset). Decel auto-trigger awaits a proven throttle/decel
       input; until then the offset is a manual tuning knob only.
   All thresholds are read from the parameter block at PATCH_BASE+0x700
   every cycle — they are genuinely tunable in a hex editor.

   RPM UNITS: RAM_RPM (0xFFFF8468) raw scale is INFERRED from the lookup
   axes (coordinate = raw>>8, axis max 136 at ~6800rpm): raw = RPM x
   256/50 = RPM x 5.12. Parameter defaults use that scale; the first
   flash verifies it against a tach (if the hold point is off by the
   scale ratio, correct the block values — no code change needed).

   SPLICES (applied by the build script to a copy of m35x_stock.bin):
     1. u32 @0x0000F0A8 := 0x0009E000            (brain hook)
     2. bytes @0x13150..0x13157 := D001 402B 0009 0009
        u32 @0x00013158 := 0x0009E400            (segment hook)
     3. patch binary at 0x0009E000
     4. checksum fix (sum @0x7CF8, xor @0x7CF0 — nisckfix2 rules)

   FILE LAYOUT (offsets from PATCH_BASE; .org order is ascending):
     +0x000 PATCH_BRAIN   +0x400 PATCH_SEG   +0x700 parameter block
   ============================================================================ */

        .text
        .align  2
        .global _patch_brain
        .global _patch_seg

        .include "symbols.inc"   /* every address below is PINNED by the
                                    disassembly passes — see symbols.inc */

/* patch RAM offsets (PATCH_RAM_BASE = 0xFFFF4000, boot-cleared to 0) */
        .equ    PR_MODE,   0    /* byte: 0 normal, 1 static armed */
        .equ    PR_CUT,    1    /* byte: 1 = segment hook skips commits */
        .equ    PR_ARMCNT, 2    /* byte: idle-band arm counter */
        .equ    PR_RELCNT, 3    /* byte: release counter */
        .equ    PR_CUTCNT, 4    /* u16: consecutive cut cycles */
        .equ    PR_FLMOFF, 6    /* u16: slot offset applied by seg hook */

/* parameter block offsets (PARAM_BLOCK = PATCH_BASE + 0x700, u16 words) */
        .equ    PB_TGT,    10   /* cut target, raw RPM */
        .equ    PB_HYST,   12   /* cut release, raw RPM */
        .equ    PB_ARMHI,  14   /* arm band high, raw RPM */
        .equ    PB_ARMLO,  16   /* arm band low, raw RPM */
        .equ    PB_REL,    18   /* disarm RPM, raw */
        .equ    PB_ARMCYC, 20   /* cycles in band to arm */
        .equ    PB_RELCYC, 22   /* cycles below REL to disarm */
        .equ    PB_CUTMAX, 24   /* max consecutive cut cycles */
        .equ    PB_ROLL,   26   /* GhostBurner target (dormant) */
        .equ    PB_FLMOFF, 28   /* GhostFlames slot offset (stock 0) */

/* ============================================================================
   PATCH_BRAIN — executive hook   (+0x000)
   Entered by jsr from the executive loop (PR = return into the loop).
   Preserves every register; tail-jumps to the OEM input service.
   ============================================================================ */
_patch_brain:
patch_brain:
        sts.l   pr, @-r15
        mov.l   r8, @-r15
        mov.l   r9, @-r15
        mov.l   r10, @-r15
        mov.l   r11, @-r15
        mov.l   L_B_PRAM, r8          /* patch RAM base */
        mov.l   L_B_PARAM, r11        /* parameter block */
        mov.l   L_B_RPM, r9
        mov.w   @r9, r9
        extu.w  r9, r9                /* r9 = RPM raw */
        /* live-copy the flames offset knob into patch RAM.
           NOTE: SH @(disp,Rn) byte/word forms are R0-implicit — every
           patch-RAM / parameter access below goes through R0. */
        mov.w   @(PB_FLMOFF, r11), r0
        mov.w   r0, @(PR_FLMOFF, r8)
        /* dispatch on MODE */
        mov.b   @(PR_MODE, r8), r0
        cmp/eq  #1, r0
        bt      pb_static
        nop
        /* ---- MODE_NORMAL: cut off; watch the idle-band arm gesture ---- */
        mov     #0, r0
        mov.b   r0, @(PR_CUT, r8)
        mov.w   r0, @(PR_CUTCNT, r8)
        mov.w   @(PB_ARMHI, r11), r0
        cmp/hs  r0, r9                /* rpm >= ARMHI -> outside band */
        bt      pb_arm_reset
        nop
        mov.w   @(PB_ARMLO, r11), r0
        cmp/hs  r9, r0                /* ARMLO >= rpm -> below band */
        bt      pb_arm_reset
        nop
        mov.b   @(PR_ARMCNT, r8), r0
        add     #1, r0
        mov     r0, r10
        mov.b   r0, @(PR_ARMCNT, r8)
        mov.w   @(PB_ARMCYC, r11), r0
        cmp/eq  r0, r10
        bf      pb_out
        nop
        /* ARM GhostFire */
        mov     #1, r0
        mov.b   r0, @(PR_MODE, r8)
        mov     #0, r0
        mov.b   r0, @(PR_ARMCNT, r8)
        mov.b   r0, @(PR_RELCNT, r8)
        bra     pb_out
        nop
pb_arm_reset:
        mov     #0, r0
        mov.b   r0, @(PR_ARMCNT, r8)
        bra     pb_out
        nop
        /* ---- MODE_STATIC (GhostFire armed) ---- */
pb_static:
        mov.w   @(PB_REL, r11), r0
        cmp/hs  r0, r9                /* rpm >= REL -> not releasing */
        bt      pb_norel
        nop
        /* rpm below REL: count toward disarm */
        mov.b   @(PR_RELCNT, r8), r0
        add     #1, r0
        mov     r0, r10
        mov.b   r0, @(PR_RELCNT, r8)
        mov.w   @(PB_RELCYC, r11), r0
        cmp/eq  r0, r10
        bf      pb_cutctl
        nop
        /* DISARM */
        mov     #0, r0
        mov.b   r0, @(PR_MODE, r8)
        mov.b   r0, @(PR_CUT, r8)
        mov.w   r0, @(PR_CUTCNT, r8)
        bra     pb_out
        nop
pb_norel:
        mov     #0, r0
        mov.b   r0, @(PR_RELCNT, r8)
        /* fall through to cut control */
pb_cutctl:
        mov.w   @(PB_TGT, r11), r0
        cmp/hs  r0, r9                /* rpm >= TGT -> cut on */
        bt      pb_cut_on
        nop
        mov.w   @(PB_HYST, r11), r0
        cmp/hs  r0, r9                /* rpm >= HYST -> hold prior state */
        bt      pb_cut_count
        nop
        /* rpm below HYST -> cut off */
        mov     #0, r0
        mov.b   r0, @(PR_CUT, r8)
        mov.w   r0, @(PR_CUTCNT, r8)
        bra     pb_out
        nop
pb_cut_on:
        mov     #1, r0
        mov.b   r0, @(PR_CUT, r8)
pb_cut_count:
        mov.b   @(PR_CUT, r8), r0
        cmp/eq  #1, r0
        bf      pb_out
        nop
        mov.w   @(PR_CUTCNT, r8), r0
        add     #1, r0
        mov     r0, r10
        mov.w   r0, @(PR_CUTCNT, r8)
        mov.w   @(PB_CUTMAX, r11), r0
        cmp/hs  r0, r10               /* cut too long -> safety disarm */
        bf      pb_out
        nop
        mov     #0, r0
        mov.b   r0, @(PR_MODE, r8)
        mov.b   r0, @(PR_CUT, r8)
        mov.w   r0, @(PR_CUTCNT, r8)
pb_out:
        mov.l   @r15+, r11
        mov.l   @r15+, r10
        mov.l   @r15+, r9
        mov.l   @r15+, r8
        lds.l   @r15+, pr
        mov.l   L_B_SVC, r0           /* OEM input service 0x1C14 */
        jmp     @r0                   /* tail: it returns to the loop */
        nop

        .align  2
L_B_PRAM:   .long   PATCH_RAM_BASE
L_B_PARAM:  .long   PARAM_BLOCK
L_B_RPM:    .long   RAM_RPM
L_B_SVC:    .long   OEM_INPUT_SVC

/* ============================================================================
   PATCH_SEG — segment hook   (+0x400)
   Entered by JMP from scheduler entry 0x13150 (PR = scheduler caller's
   return). r4 = mask arg, r5 = slot array ptr. Uses only caller-scratch
   registers (r0-r3, r6) — the scheduler's own contract.
   ============================================================================ */
        .org    0x400
_patch_seg:
patch_seg:
        mov.l   L_S_PRAM, r1          /* patch RAM base */
        mov.b   @(PR_CUT, r1), r0
        tst     r0, r0
        bf      seg_skip              /* CUT set -> skip this commit */
        nop
        mov.w   @(PR_FLMOFF, r1), r0  /* GhostFlames slot offset */
        tst     r0, r0
        bt      seg_pass
        nop
        /* add the offset to this segment's six slot words */
        mov     r5, r3
        mov     #6, r2
seg_floop:
        mov.w   @r3, r6
        add     r0, r6
        mov.w   r6, @r3
        add     #2, r3
        dt      r2
        bf      seg_floop
        nop
seg_pass:
        /* replay the scheduler's displaced prologue (0x13150..0x1315B) */
        mov.l   r8, @-r15
        mov.l   r9, @-r15
        mov.l   r10, @-r15
        mov.l   r11, @-r15
        mov.l   r12, @-r15
        mov.l   r13, @-r15
        mov.l   L_S_RESUME, r0        /* 0x1315C */
        jmp     @r0
        nop
seg_skip:
        rts                           /* no events committed this segment */
        nop

        .align  2
L_S_PRAM:   .long   PATCH_RAM_BASE
L_S_RESUME: .long   SCHED_RESUME

/* ============================================================================
   PARAMETER BLOCK   (+0x700) — read by the brain every cycle.
   RPM values are RAW (raw = RPM x 5.12, inferred scale — see header).
   ============================================================================ */
        .org    0x700
param_block:
        .ascii  "GHOSTECH"            /* +0  magic */
        .word   0x0002                /* +8  version 2 */
        .word   17920                 /* +10 TGT    3500 rpm */
        .word   17408                 /* +12 HYST   3400 rpm */
        .word   8192                  /* +14 ARMHI  1600 rpm */
        .word   2560                  /* +16 ARMLO   500 rpm */
        .word   7168                  /* +18 REL    1400 rpm */
        .word   20                    /* +20 cycles in band to arm */
        .word   30                    /* +22 cycles below REL to disarm */
        .word   400                   /* +24 max consecutive cut cycles */
        .word   21504                 /* +26 ROLL   4200 rpm (dormant) */
        .word   0                     /* +28 FLMOFF slot offset (stock 0) */

        .end
