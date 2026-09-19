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
        return {
            base: def.base,
            romid: { ...merged.romid, ...def.romid },
            checksums: def.checksums.length ? def.checksums : merged.checksums,
            tables: [...merged.tables, ...def.tables],
            raw: def.raw,
        };
    }

    // ---- checksums ----
    // UNVERIFIED ALGORITHM — do not trust for live flashing until checked
    // against the reference suite on a real dump. Assumed Nissan SH
    // pattern: 16-bit sum over [start..end] with the sum/xor slots zeroed
    // during computation; values stored per definition endianness.
    function computeChecksum(bytes, cs) {
        const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        let sum = 0;
        for (let a = cs.start; a <= cs.end; a++) {
            if (a === cs.sumloc || a === cs.sumloc + 1) continue;
            if (a === cs.xorloc || a === cs.xorloc + 1) continue;
            sum = (sum + b[a]) & 0xFFFF;
        }
        return sum;
    }

    function fixChecksums(bytes, def) {
        const b = new Uint8Array(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
        const bigEndian = (def.romid.endian || 'Big').toLowerCase().startsWith('big');
        const applied = [];
        for (const cs of def.checksums) {
            if (cs.type !== 'std' && cs.type !== 'alt') continue;
            if ([cs.start, cs.end, cs.sumloc, cs.xorloc].some(Number.isNaN)) continue;
            if (cs.end >= b.length) continue;
            const sum = computeChecksum(b, cs);
            const xr = sum ^ 0xFFFF;
            if (bigEndian) {
                b[cs.sumloc] = (sum >> 8) & 0xFF; b[cs.sumloc + 1] = sum & 0xFF;
                b[cs.xorloc] = (xr >> 8) & 0xFF;  b[cs.xorloc + 1] = xr & 0xFF;
            } else {
                b[cs.sumloc] = sum & 0xFF;        b[cs.sumloc + 1] = (sum >> 8) & 0xFF;
                b[cs.xorloc] = xr & 0xFF;         b[cs.xorloc + 1] = (xr >> 8) & 0xFF;
            }
            applied.push({ type: cs.type, sum: '0x' + sum.toString(16).toUpperCase() });
        }
        return { bytes: b, applied };
    }

    return {
        register, parseDefinition, matchRom, resolveBase,
        computeChecksum, fixChecksums,
        get: (xmlid) => registry.get(xmlid),
        list: () => [...registry.keys()],
    };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Defs;
