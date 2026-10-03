#!/usr/bin/env node
/* FanTom defmap exporter — CLI.
 *
 * Usage: node export-defmap.js <definitionsDir> <outDir>
 * Walks every .xml under <definitionsDir>, registers it with the
 * FanTom definition engine, resolves base inheritance, and writes
 *   <outDir>/ADDRESS-MAP.md   (readable: address -> what it controls)
 *   <outDir>/ADDRESS-MAP.csv  (same data, flat)
 * Zero npm dependencies (minidom.js covers the parser definitions.js
 * needs under node).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const { MiniDOMParser } = require('./minidom');
global.DOMParser = MiniDOMParser;

const Defs = require('../../frontend/definitions.js');
const DefMapExport = require('../../frontend/js/defmap-export.js');

const defsDir = process.argv[2];
const outDir = process.argv[3] || '.';
if (!defsDir) {
    console.error('usage: node export-defmap.js <definitionsDir> [outDir]');
    process.exit(2);
}

function walk(dir, acc) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, acc);
        else if (/\.xml$/i.test(e.name)) acc.push(p);
    }
    return acc;
}

const files = walk(defsDir, []).sort();
const book = {};
let registered = 0, failed = 0;
for (const f of files) {
    const xml = fs.readFileSync(f, 'utf8');
    DefMapExport.harvestScalings(xml, book);
    try { Defs.registerScalings(xml); } catch (e) { /* scalings optional */ }
    try { Defs.register(xml); registered++; }
    catch (e) { failed++; console.error('skip ' + path.basename(f) + ': ' + e.message); }
}
const defs = Defs.list().map(id => Defs.resolveBase(Defs.get(id)));
const out = DefMapExport.buildMap(defs, book);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'ADDRESS-MAP.md'), out.markdown);
fs.writeFileSync(path.join(outDir, 'ADDRESS-MAP.csv'), out.csv);
console.log('files: ' + files.length + ' | registered: ' + registered + ' | failed: ' + failed);
console.log('defs: ' + out.stats.defs + ' | addressed tables: ' + out.stats.tablesAddressed +
    ' | checksum slots: ' + out.stats.checksumRows + ' | total tables: ' + out.stats.tablesTotal);
console.log('wrote ' + path.join(outDir, 'ADDRESS-MAP.md') + ' + ADDRESS-MAP.csv');
