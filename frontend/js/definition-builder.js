/* GhostDevol Definition Builder
 * Scans an uploaded ROM dump, identifies tables by shape/pattern,
 * and generates a GhostTech definition file.
 * 
 * Usage:
 *   const def = buildDefinition(romBytes, romName);
 *   // Returns definition object with tables, axes, limiters
 */

// Table signatures by shape
const TABLE_SIGNATURES = [
  { size: 256, shape: '16x16', types: ['fuel', 'timing', 'cam'] },
  { size: 400, shape: '20x20', types: ['throttle'] },
  { size: 64,  shape: '8x8',   types: ['knock', 'torque_limiter'] },
  { size: 128, shape: '8x16',  types: ['idle', 'cold_start'] },
];

function isTableLike(bytes, offset, size) {
  if (offset + size > bytes.length) return 0;
  
  let ffCount = 0, zeroCount = 0;
  let sumDiff = 0, diffCount = 0;
  
  // Determine dimensions
  let w, h;
  if (size === 256) { w = 16; h = 16; }
  else if (size === 400) { w = 20; h = 20; }
  else if (size === 64) { w = 8; h = 8; }
  else if (size === 128) { w = 16; h = 8; }
  else return 0;
  
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = bytes[offset + y * w + x];
      if (v === 0xFF) ffCount++;
      if (v === 0x00) zeroCount++;
      if (x < w - 1) {
        sumDiff += Math.abs(v - bytes[offset + y * w + x + 1]);
        diffCount++;
      }
    }
  }
  
  const total = w * h;
  const ffRatio = ffCount / total;
  const zeroRatio = zeroCount / total;
  
  if (ffRatio > 0.3 || zeroRatio > 0.5) return 0;
  
  const avgDiff = sumDiff / diffCount;
  if (avgDiff > 40) return 0;
  
  return Math.max(0, 100 - avgDiff * 2 - ffRatio * 50);
}

function isMonotonicAxis(bytes, offset, len) {
  if (offset + len > bytes.length) return 0;
  let inc = 0;
  for (let i = 1; i < len; i++) {
    if (bytes[offset + i] >= bytes[offset + i - 1]) inc++;
  }
  return inc / (len - 1);
}

function buildDefinition(romBytes, romName = 'unknown') {
  const def = {
    name: romName,
    created: new Date().toISOString(),
    romSize: romBytes.length,
    tables: [],
    axes: [],
    limiters: [],
  };
  
  // Scan for tables in likely regions
  // SH7058: tables often in 0x8000-0x20000 and 0x50000-0x80000
  const scanRegions = [
    [0x8000, 0x20000],
    [0x50000, 0x80000],
  ];
  
  const foundTables = [];
  
  for (const [start, end] of scanRegions) {
    for (const sig of TABLE_SIGNATURES) {
      for (let addr = start; addr < end; addr += 0x100) {
        const score = isTableLike(romBytes, addr, sig.size);
        if (score > 70) {
          foundTables.push({
            address: addr,
            size: sig.size,
            shape: sig.shape,
            score: Math.round(score),
            possibleTypes: sig.types,
          });
        }
      }
    }
  }
  
  // Deduplicate (keep highest score per 0x100 block)
  const seen = new Map();
  for (const t of foundTables) {
    const key = Math.floor(t.address / 0x100);
    if (!seen.has(key) || seen.get(key).score < t.score) {
      seen.set(key, t);
    }
  }
  
  def.tables = Array.from(seen.values())
    .sort((a, b) => a.address - b.address)
    .slice(0, 50); // Top 50 candidates
  
  // Scan for axes (monotonic data)
  for (let addr = 0x8000; addr < 0x20000; addr += 0x10) {
    const mono16 = isMonotonicAxis(romBytes, addr, 16);
    if (mono16 > 0.9) {
      const vals = [];
      for (let i = 0; i < 16; i++) vals.push(romBytes[addr + i]);
      const maxV = Math.max(...vals);
      if (maxV > 10 && maxV < 200) {
        def.axes.push({
          address: addr,
          length: 16,
          values: vals,
          confidence: Math.round(mono16 * 100),
        });
      }
    }
  }
  
  return def;
}

function definitionToGhostTech(def) {
  const lines = [];
  lines.push('='.repeat(60));
  lines.push('GHOSTTECH DEFINITION FILE');
  lines.push('='.repeat(60));
  lines.push('');
  lines.push('[Definition]');
  lines.push(`Name = "${def.name}"`);
  lines.push(`Created = "${def.created}"`);
  lines.push(`ROM_Size = ${def.romSize}`);
  lines.push('');
  lines.push(`[Tables] ; ${def.tables.length} candidates found`);
  for (const t of def.tables) {
    const addrHex = '0x' + t.address.toString(16).toUpperCase().padStart(6, '0');
    lines.push(`${addrHex} = ${t.shape} table (score: ${t.score}%) ; possible: ${t.possibleTypes.join('/')}`);
  }
  lines.push('');
  lines.push(`[Axes] ; ${def.axes.length} candidates found`);
  for (const a of def.axes.slice(0, 20)) {
    const addrHex = '0x' + a.address.toString(16).toUpperCase().padStart(6, '0');
    lines.push(`${addrHex} = ${a.length}-value axis (confidence: ${a.confidence}%)`);
  }
  lines.push('');
  lines.push('='.repeat(60));
  lines.push('END GHOSTTECH DEFINITION');
  lines.push('='.repeat(60));
  lines.push('');
  lines.push('; NOTE: These are CANDIDATES. Verify each table by viewing');
  lines.push('; in the hex editor before using for tuning.');
  return lines.join('\n');
}

if (typeof module !== 'undefined') {
  module.exports = { buildDefinition, definitionToGhostTech, isTableLike };
}
