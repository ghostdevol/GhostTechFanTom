'use strict';
/* ============================================================
   GhostTech FanTom — ROM definition engine
   Clean-room implementation. Schema observed from NisROM-style
   definition XMLs (EcuFlash-derived format):

     <rom base="A2L">
       <romid>
         <xmlid>AL902</xmlid>
         <internalidaddress>6BF9</internalidaddress>
         <internalidstring>AL902</internalidstring>
         <ecuid>1AL902</ecuid>
         <memmodel>SH7055</memmodel>
         <endian>Big</endian>
         <flashmethod>Nisprog</flashmethod>
         <filesize>512kb</filesize>
         ...
       </romid>
       <checksum type="std" start="0" end="0x7FFFF"
                 sumloc="0x5158" xorloc="0x5150" />
       (suite style: <checksum sumloc="..." xorloc="..."/>; algorithm is the
       suite's FixChecksums — 32-bit sum+XOR over big-endian words, HR quirk
       handled — see fixChecksums)
       ...tables live in the base definition (base="A2L")...
     </rom>

   A ROM dump is matched to its definition by reading the internal
   ID string at <internalidaddress> and comparing it to
   <internalidstring>. Tables usually come from the base definition
   via inheritance — table parsing lands once that schema is
   confirmed (see RomTable).
   ============================================================ */

const Defs = (() => {
    const registry = new Map(); // xmlid -> parsed definition

    // ---- tiny XML helpers (fixed flat schema; not a general parser) ----
    function tag(xml, name) {
        const m = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`, 'i'));
        return m ? m[1].trim() : '';
    }
    function attr(tagText, name) {
        const m = tagText.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i'));
        return m ? m[1] : '';
    }
    // hex like "0x408" or bare "6BF9" -> int
    function hex(v) {
        if (v == null) return NaN;
        v = String(v).trim();
        if (!v) return NaN;
        return parseInt(/^0x/i.test(v) ? v : '0x' + v, 16);
    }
    function parseFilesize(v) {
        const m = /(\d+)\s*kb/i.exec(v || '');
        return m ? parseInt(m[1], 10) * 1024 : NaN;
    }

    // ---- definition parsing ----
    function parseDefinition(xmlText) {
        const romOpen = (xmlText.match(/<rom\b([^>]*)>/i) || [])[1] || '';
        const romidXml = (xmlText.match(/<romid>([\s\S]*?)<\/romid>/i) || [])[1] || '';
        const checksums = [...xmlText.matchAll(/<checksum\b([^>]*?)\/>/gi)].map(m => ({
            type: attr(m[1], 'type'),
            start: hex(attr(m[1], 'start')),
            end: hex(attr(m[1], 'end')),
            sumloc: hex(attr(m[1], 'sumloc')),
            xorloc: hex(attr(m[1], 'xorloc')),
        }));
        const romid = {};
        ['xmlid', 'caseid', 'internalidaddress', 'internalidstring', 'ecuid',
         'year', 'market', 'make', 'model', 'submodel', 'transmission',
         'memmodel', 'endian', 'flashmethod', 'filesize', 'author', 'version'
        ].forEach(k => { romid[k] = tag(romidXml, k); });
        return {
            base: attr(romOpen, 'base'),
            romid: {
                ...romid,
                internalidaddress: hex(romid.internalidaddress),
                filesizeBytes: parseFilesize(romid.filesize),
            },
            checksums,
            tables: [], // TODO: table schema (base definition / RomTable)
            raw: xmlText,
        };
    }

    function register(xmlText) {
        const def = parseDefinition(xmlText);
        if (!def.romid.xmlid) throw new Error('definition has no <xmlid>');
        try { def.tables = parseTables(xmlText); } catch (e) { def.tables = []; }
        registry.set(def.romid.xmlid, def);
        return def;
    }

    // ---- ROM <-> definition matching ----
    function matchRom(romBytes) {
        const bytes = romBytes instanceof Uint8Array ? romBytes : new Uint8Array(romBytes);
        for (const def of registry.values()) {
            const addr = def.romid.internalidaddress;
            const id = def.romid.internalidstring;
            if (!id || Number.isNaN(addr) || addr + id.length > bytes.length) continue;
            let s = '';
            for (let i = 0; i < id.length; i++) s += String.fromCharCode(bytes[addr + i]);
            if (s === id) return def;
        }
        return null;
    }

    // ---- base-definition inheritance (child overrides parent) ----
    function resolveBase(def) {
        if (!def || !def.base) return def;
        const parent = registry.get(def.base);
        if (!parent) return def; // base not loaded — use child as-is
        const merged = resolveBase(parent);
        // tables merge by name: child definitions override same-named tables
        const byName = new Map();
        merged.tables.forEach(t => byName.set(t.name, t));
        def.tables.forEach(t => byName.set(t.name, t));
        return {
            base: def.base,
            romid: { ...merged.romid, ...def.romid },
            checksums: def.checksums.length ? def.checksums : merged.checksums,
            tables: [...byName.values()],
            raw: def.raw,
        };
    }

    // ---- tables ----
    // Schema (RomRaider-derived, as used by the A2L template):
    //   <table type="2D"|"3D" name="..." category="a//b//c"
    //          storagetype="uint8"|"uint16" sizex="8" [sizey="8"] userlevel="1">
    //     <scaling base="<scalingbase name>"/>
    //     <table type="Static X Axis" name="..." sizex="8">
    //       <data>0</data> ...
    //     </table>
    //     <description><!--symbol-->text</description>
    //   </table>
    // NOTE: table elements carry no ROM address in these files — address
    // resolution is still TBD (see RomTable); table.address stays null
    // until that lands, and readTableValues() returns null without one.
    function getXmlDoc(xmlText) {
        if (typeof DOMParser !== 'undefined') {
            return new DOMParser().parseFromString(xmlText, 'text/xml');
        }
        if (typeof require !== 'undefined') {
            const { DOMParser: XDP } = require('xmldom');
            return new XDP().parseFromString(xmlText, 'text/xml');
        }
        throw new Error('no XML parser available');
    }
    function childEls(el, name) {
        const out = [];
        const want = name.toLowerCase();
        for (let n = el.firstChild; n; n = n.nextSibling) {
            if (n.nodeType === 1 && n.nodeName.toLowerCase() === want) out.push(n);
        }
        return out;
    }
    function textOf(el) {
        return (el.textContent || '').trim();
    }
    function extractSymbol(descEl) {
        for (let n = descEl.firstChild; n; n = n.nextSibling) {
            if (n.nodeType === 8) { // comment node: <!--mTTPINT-->
                const m = /([A-Za-z0-9_]+)/.exec(n.nodeValue || '');
                if (m) return m[1];
            }
        }
        return null;
    }
    // RomTable.cs properties may arrive as XML attributes OR child elements
    // (plain C# XmlSerializer maps properties to child elements by name).
    // Try attribute spellings first, then a case-insensitive child element.
    function propVal(el, names) {
        for (const n of names) {
            const v = el.getAttribute(n);
            if (v != null && v !== '') return v;
        }
        for (const n of names) {
            const c = childEls(el, n)[0];
            if (c) { const t = textOf(c); if (t) return t; }
        }
        return null;
    }

    // scalingbase registry: name -> {units, expression, to_byte, format}
    const scalings = new Map();
    function registerScalings(xmlText) {
        const doc = getXmlDoc(xmlText);
        ['scalingbase', 'Scalingbase'].forEach(tagName => {
            const els = doc.getElementsByTagName(tagName);
            for (let i = 0; i < els.length; i++) {
                const e = els[i];
                const name = e.getAttribute('name');
                if (name) scalings.set(name, {
                    name,
                    units: e.getAttribute('units') || '',
                    expression: e.getAttribute('expression') || 'x',
                    toByte: e.getAttribute('to_byte') || 'x',
                    format: e.getAttribute('format') || '0.00',
                });
            }
        });
        return scalings.size;
    }
    // safe math-expression evaluator (whitelisted chars only)
    function makeFn(expr) {
        const clean = String(expr).trim();
        if (!/^[\dx\s\+\-\*\/\.\(\)]+$/i.test(clean)) {
            throw new Error('unsafe scaling expression: ' + expr);
        }
        return new Function('x', `'use strict'; return (${clean});`);
    }
    function scalingFns(s) {
        if (!s._toDisp) {
            s._toDisp = makeFn(s.expression);
            s._toByte = makeFn(s.toByte);
        }
        return s;
    }
    function toDisplay(raw, scaling) {
        const s = resolveScaling(scaling);
        if (!s) return raw;
        return scalingFns(s)._toDisp(raw);
    }
    function toRaw(display, scaling) {
        const s = resolveScaling(scaling);
        if (!s) return Math.round(display);
        return Math.round(scalingFns(s)._toByte(display));
    }
    // <scaling> child element: either suite-style inline attributes
    // (expression/to_byte/...) or a RomRaider-style base="name" reference.
    // Returns an inline scaling object or a registry name (string).
    function parseScalingEl(s) {
        if (!s) return null;
        if (s.getAttribute('expression') || s.getAttribute('to_byte')) {
            return {
                name: null,
                units: s.getAttribute('units') || '',
                expression: s.getAttribute('expression') || 'x',
                toByte: s.getAttribute('to_byte') || 'x',
                format: s.getAttribute('format') || '0.00',
            };
        }
        return s.getAttribute('base') || null;
    }
    function resolveScaling(s) {
        if (!s) return null;
        if (typeof s === 'string') return scalings.get(s) || null;
        return s; // inline object
    }

    function parseAxisEl(a) {
        // RomTableAxis carries its own StorageAddress + Endian (per C# model);
        // may be an attribute or a child element — try several spellings.
        const addrAttr = propVal(a, ['storageaddress', 'storageAddress', 'address']);
        const scalingEl = childEls(a, 'scaling')[0];
        return {
            type: a.getAttribute('type') || '',
            name: a.getAttribute('name') || '',
            size: parseInt(a.getAttribute('sizex') || '0', 10),
            storagetype: a.getAttribute('storagetype') || null,
            endian: propVal(a, ['endian']) || null,
            storageAddress: addrAttr != null ? hex(addrAttr) : null,
            scaling: parseScalingEl(scalingEl),
            // suite 2D axes carry static values as <data value="..."/>;
            // RomRaider style uses text content — accept both.
            values: childEls(a, 'data').map(d => {
                const v = d.getAttribute('value');
                return parseFloat(v != null && v !== '' ? v : textOf(d));
            }),
            address: null, // dynamic (non-static) axes: address TBD
        };
    }
    function parseTableEl(t) {
        const scalingEl = childEls(t, 'scaling')[0];
        const descEl = childEls(t, 'description')[0];
        // RomTable carries StorageAddress too (attr or child element).
        const addrAttr = propVal(t, ['storageaddress', 'storageAddress', 'address']);
        const axes = childEls(t, 'table')
            .filter(a => /axis/i.test(a.getAttribute('type') || ''))
            .map(parseAxisEl);
        const findAxis = (re) => axes.find(ax => re.test(ax.type)) || null;
        return {
            kind: 'table',
            type: t.getAttribute('type') || '',           // 2D | 3D
            name: t.getAttribute('name') || '',
            category: (t.getAttribute('category') || '').split('//'),
            storagetype: t.getAttribute('storagetype') || 'uint8',
            sizex: parseInt(t.getAttribute('sizex') || '0', 10),
            sizey: parseInt(t.getAttribute('sizey') || '0', 10),
            userlevel: parseInt(t.getAttribute('userlevel') || '0', 10),
            scaling: parseScalingEl(scalingEl),
            axes,
            xAxis: findAxis(/x\s*axis/i),
            yAxis: findAxis(/y\s*axis/i),
            description: descEl ? textOf(descEl) : '',
            symbol: descEl ? extractSymbol(descEl) : null,
            storageAddress: addrAttr != null ? hex(addrAttr) : null,
            endian: propVal(t, ['endian']) || null,
            address: null, // = storageAddress once confirmed; ROM address resolution TBD
        };
    }
    function parseTables(xmlText) {
        const doc = getXmlDoc(xmlText);
        const tables = [];
        const all = doc.getElementsByTagName('table');
        for (let i = 0; i < all.length; i++) {
            const t = all[i];
            // skip nested axis tables — parsed with their parent
            let p = t.parentNode, nested = false;
            while (p) {
                if (p.nodeType === 1 && p.nodeName.toLowerCase() === 'table') { nested = true; break; }
                p = p.parentNode;
            }
            if (nested) continue;
            tables.push(parseTableEl(t));
        }
        return tables;
    }

    // raw value extraction / write-back (needs a ROM address;
    // uses table.address, falling back to table.storageAddress)
    function storageSize(storagetype) {
        return storagetype === 'uint16' ? 2 : 1;
    }
    function tableAddress(table) {
        return table.address != null ? table.address : table.storageAddress;
    }
    function readTableValues(romBytes, table, endian) {
        const addr = tableAddress(table);
        if (addr == null) return null; // no address yet
        const b = romBytes instanceof Uint8Array ? romBytes : new Uint8Array(romBytes);
        const be = (table.endian || endian || 'Big').toLowerCase().startsWith('big');
        const sz = storageSize(table.storagetype);
        const n = table.sizex * (table.sizey || 1);
        const vals = [];
        for (let i = 0; i < n; i++) {
            const a = addr + i * sz;
            vals.push(sz === 1 ? b[a] : (be ? (b[a] << 8) | b[a + 1] : b[a] | (b[a + 1] << 8)));
        }
        return vals;
    }
    function readTableScaled(romBytes, table, endian) {
        const raw = readTableValues(romBytes, table, endian);
        if (!raw) return null;
        return raw.map(v => toDisplay(v, table.scaling));
    }
    function writeTableValues(romBytes, table, endian, rawVals) {
        const addr = tableAddress(table);
        if (addr == null) return false;
        const b = romBytes instanceof Uint8Array ? romBytes : new Uint8Array(romBytes);
        const be = (table.endian || endian || 'Big').toLowerCase().startsWith('big');
        const sz = storageSize(table.storagetype);
        rawVals.forEach((v, i) => {
            const a = addr + i * sz;
            if (sz === 1) b[a] = v & 0xFF;
            else if (be) { b[a] = (v >> 8) & 0xFF; b[a + 1] = v & 0xFF; }
            else { b[a] = v & 0xFF; b[a + 1] = (v >> 8) & 0xFF; }
        });
        return true;
    }

    // ---- checksums ----
    // Ported from the suite's MainForm.FixChecksums (ababook/NisROM-Tuning-Suite):
    // 32-bit wrapping sum + XOR over 4-byte big-endian words of the whole ROM,
    // skipping the checksum slots themselves. HR-style ROMs (1MB/1.5MB with
    // 0xFFFF7FFC markers at 0x20008/0x20010) start at 0x8204 and skip 0x20000.
    // Slot addresses come from <checksum sumloc="..." xorloc="..."/> elements.
    // Both values are written back big-endian as uint32.
    function fixChecksums(bytes, def) {
        const b = new Uint8Array(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
        const getU32 = (a) => (((b[a] << 24) | (b[a + 1] << 16) | (b[a + 2] << 8) | b[a + 3]) >>> 0);
        const setU32 = (a, v) => {
            b[a] = (v >>> 24) & 0xFF; b[a + 1] = (v >>> 16) & 0xFF;
            b[a + 2] = (v >>> 8) & 0xFF; b[a + 3] = v & 0xFF;
        };
        const applied = [];
        for (const cs of def.checksums) {
            const sumAddress = cs.sumloc, xorAddress = cs.xorloc;
            if (!Number.isInteger(sumAddress) || !Number.isInteger(xorAddress)) continue;
            if (sumAddress + 4 > b.length || xorAddress + 4 > b.length) continue;
            let hrStyle = false;
            if (b.length > 0x20014 && (b.length === 0x100000 || b.length === 0x180000)) {
                const c1 = getU32(0x20008), c2 = getU32(0x20010);
                if (c1 === 0xFFFF7FFC && c2 === c1) hrStyle = true;
            }
            const startOffset = hrStyle ? 0x8204 : 0;
            let sum = 0, xor = 0;
            for (let count = startOffset; count + 4 <= b.length; count += 4) {
                if (count === xorAddress || count === sumAddress) continue;
                if (hrStyle && count === 0x20000) continue;
                const v = getU32(count);
                sum = (sum + v) >>> 0;
                xor = (xor ^ v) >>> 0;
            }
            setU32(sumAddress, sum);
            setU32(xorAddress, xor);
            applied.push({
                sumloc: '0x' + sumAddress.toString(16).toUpperCase(),
                xorloc: '0x' + xorAddress.toString(16).toUpperCase(),
                sum: '0x' + sum.toString(16).toUpperCase(),
                xor: '0x' + xor.toString(16).toUpperCase(),
                hrStyle,
            });
        }
        return { bytes: b, applied };
    }

    return {
        register, parseDefinition, parseTables, registerScalings,
        matchRom, resolveBase,
        fixChecksums,
        toDisplay, toRaw, readTableValues, readTableScaled, writeTableValues,
        get: (xmlid) => registry.get(xmlid),
        list: () => [...registry.keys()],
        scalingList: () => [...scalings.keys()],
    };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Defs;
