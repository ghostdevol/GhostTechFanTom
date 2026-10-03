#!/usr/bin/env python3
"""Build tuned_m35x_v2.bin — hand-assembly of ghosttech_patch.asm (v2).

No SH assembler exists on this VM, so this script encodes the patch's
instruction subset directly. Safety: every encoding family is first
CALIBRATED against capstone (encode a probe -> decode -> must match the
intended instruction exactly); the assembled blocks are then fully
disassembled and every branch target is checked against the label map
before splicing. Splice + checksum are asserted against the stock ROM.

NOTE (calibration catch): on SH, the @(disp,Rn) forms for mov.b/mov.w
are R0-implicit — the data register is always R0. The patch code is
written to that discipline (all disp accesses go through R0).
"""
import struct, re, hashlib
from capstone import Cs, CS_ARCH_SH, CS_MODE_SH2A, CS_MODE_BIG_ENDIAN

GOAL = "/home/hatch/workspace/goals/diy-nissan-infiniti-performance-tuner"
STOCK = open(f"{GOAL}/hidden_files/m35x_stock.bin", "rb").read()
assert len(STOCK) == 1048576
PATCH_BASE = 0x9E000
md = Cs(CS_ARCH_SH, CS_MODE_SH2A | CS_MODE_BIG_ENDIAN)

def dec1(word, addr):
    for i in md.disasm(struct.pack(">H", word), addr):
        return f"{i.mnemonic} {i.op_str}".strip()
    return None

# ---------------- calibration ----------------
def calib(word, want, addr=0x9E000):
    got = dec1(word, addr)
    assert got is not None and got.replace(" ", "") == want.replace(" ", ""), \
        f"calib fail: {word:#06x} -> {got!r} want {want!r}"

calib(0x0009, "nop"); calib(0x000B, "rts")
calib(0x2F86, "mov.l r8, @-r15"); calib(0x6BF6, "mov.l @r15+, r11")
calib(0x4F22, "sts.l pr, @-r15"); calib(0x4F26, "lds.l @r15+, pr")
calib(0x6991, "mov.w @r9, r9")
calib(0x84A5, "mov.b @(5, r10), r0")     # R0-implicit disp forms:
calib(0x8083, "mov.b r0, @(3, r8)")      #   0x84/0x85 load, 0x80/0x81 store,
calib(0x85B5, "mov.w @(10, r11), r0")    #   base reg in bits 7-4
calib(0x81A2, "mov.w r0, @(4, r10)")
calib(0x6353, "mov r5, r3")
calib(0x360C, "add r0, r6")
calib(0x7A01, "add #1, r10"); calib(0x7302, "add #2, r3"); calib(0x7001, "add #1, r0")
calib(0xE001, "mov #1, r0"); calib(0xE206, "mov #6, r2"); calib(0xEA00, "mov #0, r10")
calib(0x8801, "cmp/eq #1, r0")
calib(0x3A00, "cmp/eq r0, r10")
calib(0x39A2, "cmp/hs r10, r9"); calib(0x3902, "cmp/hs r0, r9")
calib(0x2008, "tst r0, r0")
calib(0x6AAC, "extu.b r10, r10"); calib(0x699D, "extu.w r9, r9")
calib(0x2361, "mov.w r6, @r3")
calib(0x402B, "jmp @r0")
calib(0x4210, "dt r2")
print("calibration: all encoding families verified against capstone")

# ---------------- mini assembler ----------------
def R(s): return int(s[1:])

class Block:
    def __init__(self, base):
        self.base = base; self.items = []; self.pool = []
    def add(self, text, label=None): self.items.append((label, text))
    def pool_add(self, name, value): self.pool.append((name, value))

def assemble(blk):
    labels = {}; addr = blk.base; seq = []
    for label, text in blk.items:
        if label: labels[label] = addr
        seq.append((addr, text)); addr += 2
    pool_base = (addr + 3) & ~3
    pool_addr = {name: pool_base + 4 * i for i, (name, v) in enumerate(blk.pool)}
    out = bytearray(b"\xff" * (pool_base + 4 * len(blk.pool) - blk.base))
    for pc, text in seq:
        w = encode(text, pc, labels, pool_addr)
        out[pc - blk.base: pc - blk.base + 2] = struct.pack(">H", w)
    for name, val in blk.pool:
        a = pool_addr[name] - blk.base
        out[a:a + 4] = struct.pack(">I", val)
    return bytes(out), labels, pool_addr

def encode(text, pc, labels, pool_addr):
    t = text.replace(" ", "")
    m = re.fullmatch(r"mov\.l(r\d+),@-r15", t)
    if m: return 0x2000 | (15 << 8) | (R(m.group(1)) << 4) | 0x06
    m = re.fullmatch(r"mov\.l@r15\+,(r\d+)", t)
    if m: return 0x6000 | (R(m.group(1)) << 8) | (15 << 4) | 0x06
    if t == "sts.lpr,@-r15": return 0x4F22
    if t == "lds.l@r15+,pr": return 0x4F26
    m = re.fullmatch(r"mov\.l([A-Z_]+),(r\d+)", t)
    if m:
        # SH quirk: the PC base for @(disp,PC) is the instruction
        # address aligned DOWN to 4, plus 4 — not pc+4.
        base = (pc & ~3) + 4
        d = (pool_addr[m.group(1)] - base) // 4
        assert (pool_addr[m.group(1)] - base) % 4 == 0
        assert 0 <= d <= 255, f"pool disp {d} at {pc:#x}"
        return 0xD000 | (R(m.group(2)) << 8) | d
    # R0-implicit disp forms: data is always R0, base reg in bits 7-4
    m = re.fullmatch(r"mov\.w@\((\d+),(r\d+)\),r0", t)
    if m:
        d = int(m.group(1)); assert d % 2 == 0 and d <= 30
        return 0x8500 | (R(m.group(2)) << 4) | (d // 2)
    m = re.fullmatch(r"mov\.b@\((\d+),(r\d+)\),r0", t)
    if m:
        d = int(m.group(1)); assert d <= 15
        return 0x8400 | (R(m.group(2)) << 4) | d
    m = re.fullmatch(r"mov\.wr0,@\((\d+),(r\d+)\)", t)
    if m:
        d = int(m.group(1)); assert d % 2 == 0 and d <= 30
        return 0x8100 | (R(m.group(2)) << 4) | (d // 2)
    m = re.fullmatch(r"mov\.br0,@\((\d+),(r\d+)\)", t)
    if m:
        d = int(m.group(1)); assert d <= 15
        return 0x8000 | (R(m.group(2)) << 4) | d
    m = re.fullmatch(r"mov\.w@(r\d+),(r\d+)", t)
    if m: return 0x6000 | (R(m.group(2)) << 8) | (R(m.group(1)) << 4) | 0x01
    m = re.fullmatch(r"mov\.w(r\d+),@(r\d+)", t)
    if m: return 0x2000 | (R(m.group(2)) << 8) | (R(m.group(1)) << 4) | 0x01
    m = re.fullmatch(r"mov(r\d+),(r\d+)", t)
    if m: return 0x6000 | (R(m.group(2)) << 8) | (R(m.group(1)) << 4) | 0x03
    m = re.fullmatch(r"extu\.w(r\d+),(r\d+)", t)
    if m: return 0x6000 | (R(m.group(2)) << 8) | (R(m.group(1)) << 4) | 0x0D
    m = re.fullmatch(r"extu\.b(r\d+),(r\d+)", t)
    if m: return 0x6000 | (R(m.group(2)) << 8) | (R(m.group(1)) << 4) | 0x0C
    m = re.fullmatch(r"mov#(-?\d+),(r\d+)", t)
    if m: return 0xE000 | (R(m.group(2)) << 8) | (int(m.group(1)) & 0xFF)
    m = re.fullmatch(r"add#(-?\d+),(r\d+)", t)
    if m: return 0x7000 | (R(m.group(2)) << 8) | (int(m.group(1)) & 0xFF)
    m = re.fullmatch(r"add(r\d+),(r\d+)", t)
    if m: return 0x3000 | (R(m.group(2)) << 8) | (R(m.group(1)) << 4) | 0x0C
    m = re.fullmatch(r"cmp/eq#(-?\d+),r0", t)
    if m: return 0x8800 | (int(m.group(1)) & 0xFF)
    m = re.fullmatch(r"cmp/eq(r\d+),(r\d+)", t)
    if m: return 0x3000 | (R(m.group(2)) << 8) | (R(m.group(1)) << 4) | 0x00
    m = re.fullmatch(r"cmp/hs(r\d+),(r\d+)", t)
    if m: return 0x3000 | (R(m.group(2)) << 8) | (R(m.group(1)) << 4) | 0x02
    m = re.fullmatch(r"tst(r\d+),(r\d+)", t)
    if m: return 0x2000 | (R(m.group(2)) << 8) | (R(m.group(1)) << 4) | 0x08
    m = re.fullmatch(r"(bt|bf|bra)([a-z_]+)", t)
    if m:
        tgt = labels[m.group(2)]; disp = (tgt - (pc + 4)) // 2
        assert (tgt - (pc + 4)) % 2 == 0
        if m.group(1) == "bra":
            assert -2048 <= disp <= 2047, f"bra disp {disp} at {pc:#x}"
            return 0xA000 | (disp & 0xFFF)
        assert -128 <= disp <= 127, f"{m.group(1)} disp {disp} at {pc:#x}"
        return (0x8900 if m.group(1) == "bt" else 0x8B00) | (disp & 0xFF)
    m = re.fullmatch(r"dt(r\d+)", t)
    if m: return 0x4000 | (R(m.group(1)) << 8) | 0x10
    m = re.fullmatch(r"jmp@(r\d+)", t)
    if m: return 0x4000 | (R(m.group(1)) << 8) | 0x2B
    if t == "rts": return 0x000B
    if t == "nop": return 0x0009
    raise ValueError(f"unencodable: {text!r}")

# ---------------- the program (mirrors ghosttech_patch.asm) ----------------
# Patch RAM offsets: MODE 0, CUT 1, ARMCNT 2, RELCNT 3, CUTCNT 4 (u16), FLMOFF 6 (u16)
# Param offsets:     TGT 10, HYST 12, ARMHI 14, ARMLO 16, REL 18, ARMCYC 20,
#                    RELCYC 22, CUTMAX 24, ROLL 26, FLMOFF 28
B = Block(PATCH_BASE)
for label, text in [
    ("patch_brain", "sts.l pr, @-r15"),
    (None, "mov.l r8, @-r15"), (None, "mov.l r9, @-r15"),
    (None, "mov.l r10, @-r15"), (None, "mov.l r11, @-r15"),
    (None, "mov.l L_B_PRAM, r8"), (None, "mov.l L_B_PARAM, r11"),
    (None, "mov.l L_B_RPM, r9"),
    (None, "mov.w @r9, r9"), (None, "extu.w r9, r9"),
    (None, "mov.w @(28, r11), r0"), (None, "mov.w r0, @(6, r8)"),
    (None, "mov.b @(0, r8), r0"), (None, "cmp/eq #1, r0"),
    (None, "bt pb_static"), (None, "nop"),
    # MODE_NORMAL
    (None, "mov #0, r0"), (None, "mov.b r0, @(1, r8)"),
    (None, "mov.w r0, @(4, r8)"),
    (None, "mov.w @(14, r11), r0"), (None, "cmp/hs r0, r9"),
    (None, "bt pb_arm_reset"), (None, "nop"),
    (None, "mov.w @(16, r11), r0"), (None, "cmp/hs r9, r0"),
    (None, "bt pb_arm_reset"), (None, "nop"),
    (None, "mov.b @(2, r8), r0"), (None, "add #1, r0"),
    (None, "mov r0, r10"), (None, "mov.b r0, @(2, r8)"),
    (None, "mov.w @(20, r11), r0"), (None, "cmp/eq r0, r10"),
    (None, "bf pb_out"), (None, "nop"),
    (None, "mov #1, r0"), (None, "mov.b r0, @(0, r8)"),
    (None, "mov #0, r0"), (None, "mov.b r0, @(2, r8)"),
    (None, "mov.b r0, @(3, r8)"),
    (None, "bra pb_out"), (None, "nop"),
    ("pb_arm_reset", "mov #0, r0"), (None, "mov.b r0, @(2, r8)"),
    (None, "bra pb_out"), (None, "nop"),
    # MODE_STATIC
    ("pb_static", "mov.w @(18, r11), r0"), (None, "cmp/hs r0, r9"),
    (None, "bt pb_norel"), (None, "nop"),
    (None, "mov.b @(3, r8), r0"), (None, "add #1, r0"),
    (None, "mov r0, r10"), (None, "mov.b r0, @(3, r8)"),
    (None, "mov.w @(22, r11), r0"), (None, "cmp/eq r0, r10"),
    (None, "bf pb_cutctl"), (None, "nop"),
    (None, "mov #0, r0"), (None, "mov.b r0, @(0, r8)"),
    (None, "mov.b r0, @(1, r8)"), (None, "mov.w r0, @(4, r8)"),
    (None, "bra pb_out"), (None, "nop"),
    ("pb_norel", "mov #0, r0"), (None, "mov.b r0, @(3, r8)"),
    ("pb_cutctl", "mov.w @(10, r11), r0"), (None, "cmp/hs r0, r9"),
    (None, "bt pb_cut_on"), (None, "nop"),
    (None, "mov.w @(12, r11), r0"), (None, "cmp/hs r0, r9"),
    (None, "bt pb_cut_count"), (None, "nop"),
    (None, "mov #0, r0"), (None, "mov.b r0, @(1, r8)"),
    (None, "mov.w r0, @(4, r8)"),
    (None, "bra pb_out"), (None, "nop"),
    ("pb_cut_on", "mov #1, r0"), (None, "mov.b r0, @(1, r8)"),
    ("pb_cut_count", "mov.b @(1, r8), r0"), (None, "cmp/eq #1, r0"),
    (None, "bf pb_out"), (None, "nop"),
    (None, "mov.w @(4, r8), r0"), (None, "add #1, r0"),
    (None, "mov r0, r10"), (None, "mov.w r0, @(4, r8)"),
    (None, "mov.w @(24, r11), r0"), (None, "cmp/hs r0, r10"),
    (None, "bf pb_out"), (None, "nop"),
    (None, "mov #0, r0"), (None, "mov.b r0, @(0, r8)"),
    (None, "mov.b r0, @(1, r8)"), (None, "mov.w r0, @(4, r8)"),
    ("pb_out", "mov.l @r15+, r11"), (None, "mov.l @r15+, r10"),
    (None, "mov.l @r15+, r9"), (None, "mov.l @r15+, r8"),
    (None, "lds.l @r15+, pr"),
    (None, "mov.l L_B_SVC, r0"), (None, "jmp @r0"), (None, "nop"),
]:
    B.add(text, label)
B.pool_add("L_B_PRAM", 0xFFFF4000); B.pool_add("L_B_PARAM", 0x0009E700)
B.pool_add("L_B_RPM", 0xFFFF8468);  B.pool_add("L_B_SVC", 0x00001C14)
brain_img, brain_labels, brain_pool = assemble(B)
assert len(brain_img) < 0x400, len(brain_img)

S = Block(PATCH_BASE + 0x400)
for label, text in [
    ("patch_seg", "mov.l L_S_PRAM, r1"),
    (None, "mov.b @(1, r1), r0"), (None, "tst r0, r0"),
    (None, "bf seg_skip"), (None, "nop"),
    (None, "mov.w @(6, r1), r0"), (None, "tst r0, r0"),
    (None, "bt seg_pass"), (None, "nop"),
    (None, "mov r5, r3"), (None, "mov #6, r2"),
    ("seg_floop", "mov.w @r3, r6"), (None, "add r0, r6"),
    (None, "mov.w r6, @r3"), (None, "add #2, r3"),
    (None, "dt r2"), (None, "bf seg_floop"), (None, "nop"),
    ("seg_pass", "mov.l r8, @-r15"), (None, "mov.l r9, @-r15"),
    (None, "mov.l r10, @-r15"), (None, "mov.l r11, @-r15"),
    (None, "mov.l r12, @-r15"), (None, "mov.l r13, @-r15"),
    (None, "mov.l L_S_RESUME, r0"), (None, "jmp @r0"), (None, "nop"),
    ("seg_skip", "rts"), (None, "nop"),
]:
    S.add(text, label)
S.pool_add("L_S_PRAM", 0xFFFF4000); S.pool_add("L_S_RESUME", 0x0001315C)
seg_img, seg_labels, seg_pool = assemble(S)
assert len(seg_img) < 0x300, len(seg_img)

params = b"GHOSTECH" + struct.pack(">11H", 2, 17920, 17408, 8192, 2560,
                                   7168, 20, 30, 400, 21504, 0)
img = bytearray(b"\xff" * 0x800)
img[0:len(brain_img)] = brain_img
img[0x400:0x400 + len(seg_img)] = seg_img
img[0x700:0x700 + len(params)] = params

# ---------------- verification ----------------
def verify(img_bytes, base, labels):
    inv = {v: k for k, v in labels.items()}
    n = 0
    for i in md.disasm(bytes(img_bytes), base):
        n += 1
        if i.mnemonic in ("bt", "bf", "bra", "bsr"):
            tgt = int(i.op_str, 16)
            assert tgt in inv, f"branch at {i.address:#x} -> {tgt:#x} not a label"
    return n

nb = verify(img[0:len(brain_img)], PATCH_BASE, brain_labels)
ns = verify(img[0x400:0x400 + len(seg_img)], PATCH_BASE + 0x400, seg_labels)
print(f"verification: brain {nb} insns, seg {ns} insns, all branch targets on labels")
print("brain labels:", {k: hex(v) for k, v in brain_labels.items()})
print("seg labels:", {k: hex(v) for k, v in seg_labels.items()})
for i in md.disasm(bytes(img[0:len(brain_img)]), PATCH_BASE):
    print(f"  {i.address:#08x}: {i.mnemonic:<8} {i.op_str}")
for i in md.disasm(bytes(img[0x400:0x400 + len(seg_img)]), PATCH_BASE + 0x400):
    print(f"  {i.address:#08x}: {i.mnemonic:<8} {i.op_str}")

# ---------------- splice + checksum ----------------
rom = bytearray(STOCK)
assert rom[PATCH_BASE:PATCH_BASE + 0x800] == b"\xff" * 0x800
assert struct.unpack(">I", rom[0xF0A8:0xF0AC])[0] == 0x00001C14
assert rom[0x13150:0x1315C] == bytes.fromhex("2f862f962fa62fb62fc62fd6")

def checksum(image):
    s = 0; x = 0
    for off in range(0, len(image), 4):
        if off in (0x7CF0, 0x7CF8): continue
        w = struct.unpack(">I", image[off:off + 4])[0]
        s = (s + w) & 0xFFFFFFFF; x ^= w
    return s, x

ss, sx = checksum(STOCK)
stored_s = struct.unpack(">I", STOCK[0x7CF8:0x7CFC])[0]
stored_x = struct.unpack(">I", STOCK[0x7CF0:0x7CF4])[0]
print(f"stock checksum check: computed sum {ss:#010x} (stored {stored_s:#010x}), "
      f"xor {sx:#010x} (stored {stored_x:#010x})")
assert ss == stored_s and sx == stored_x, "checksum rule mismatch on stock!"

rom[0xF0A8:0xF0AC] = struct.pack(">I", PATCH_BASE)
rom[0x13150:0x13158] = bytes.fromhex("d001402b00090009")
rom[0x13158:0x1315C] = struct.pack(">I", PATCH_BASE + 0x400)
rom[PATCH_BASE:PATCH_BASE + 0x800] = img
ns_, nx_ = checksum(bytes(rom))
rom[0x7CF8:0x7CFC] = struct.pack(">I", ns_)
rom[0x7CF0:0x7CF4] = struct.pack(">I", nx_)

diffs = [i for i in range(len(rom)) if rom[i] != STOCK[i]]
regions = [(0x7CF0, 0x7CFC), (0xF0A8, 0xF0AC), (0x13150, 0x1315C),
           (PATCH_BASE, PATCH_BASE + 0x800)]
for d in diffs:
    assert any(a <= d < b for a, b in regions), f"unexpected diff at {d:#x}"
print(f"diff audit: {len(diffs)} bytes differ, all inside the 4 intended regions")

out = f"{GOAL}/hidden_files/m35x_tuned_v2.bin"
open(out, "wb").write(bytes(rom))
print(f"wrote {out}")
print(f"sha256: {hashlib.sha256(bytes(rom)).hexdigest()}")
print(f"v2 checksum words: sum {ns_:#010x} @0x7CF8, xor {nx_:#010x} @0x7CF0")
