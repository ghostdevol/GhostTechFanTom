/* FanTom — Windows ROM editor engine.
 *
 * Port of the Android app's in-memory ROM editor (www/js/fantom-shim.js):
 * byte-exact read_table/write_table against an in-memory ROM image, plus
 * Save ROM (download the modified .bin). Deliberately does NOT touch
 * window.__TAURI__ — the desktop app keeps its real Rust backend for live
 * ECU work (dump/flash/nisprog console); this engine serves ROM files
 * loaded through the editor only.
 *
 * The frontend keeps S.romBytes pointing at the SAME Uint8Array stored
 * here, so grid edits, hex edits, and Save ROM all see identical bytes.
 */
(function () {
    'use strict';

    var romBytes = null;   // Uint8Array, the loaded ROM image
    var romName = 'rom.bin';

    function setBytes(bytes, name) {
        romBytes = (bytes instanceof Uint8Array) ? bytes : new Uint8Array(bytes);
        if (name) romName = String(name);
        return romBytes.length;
    }

    function getBytes() { return romBytes; }
    function getName() { return romName; }

    function parseHexAddr(s) {
        s = String(s).trim();
        if (/^0x/i.test(s)) s = s.slice(2);
        var v = parseInt(s, 16);
        if (!isFinite(v) || v < 0) throw new Error('bad address: ' + s);
        return v;
    }

    function tableParams(args) {
        var big = String(args.endian || 'big').toLowerCase() === 'big';
        var elem = String(args.storagetype || 'uint8').toLowerCase() === 'uint16' ? 2 : 1;
        return { addr: parseHexAddr(args.address), big: big, elem: elem };
    }

    /* Same argument shape and semantics as the Rust read_table and the
     * Android shim: {address, storagetype, size_x, size_y, endian}. */
    function readTable(args) {
        if (!romBytes) throw new Error('no ROM loaded');
        var p = tableParams(args);
        var nx = Math.max(1, args.size_x | 0), ny = Math.max(1, args.size_y | 0);
        var count = nx * ny;
        if (p.addr + count * p.elem > romBytes.length)
            throw new Error('table runs past end of ROM');
        var out = new Array(count);
        for (var i = 0; i < count; i++) {
            var a = p.addr + i * p.elem, v;
            if (p.elem === 1) v = romBytes[a];
            else if (p.big) v = (romBytes[a] << 8) | romBytes[a + 1];
            else v = romBytes[a] | (romBytes[a + 1] << 8);
            out[i] = v;
        }
        return out;
    }

    /* Same argument shape and semantics as the Rust write_table and the
     * Android shim: {address, storagetype, endian, values}. Writes land
     * in the shared in-memory image — Save ROM exports them. */
    function writeTable(args) {
        if (!romBytes) throw new Error('no ROM loaded');
        var p = tableParams(args);
        var values = args.values || [];
        if (p.addr + values.length * p.elem > romBytes.length)
            throw new Error('write runs past end of ROM');
        for (var i = 0; i < values.length; i++) {
            var a = p.addr + i * p.elem, v = values[i] | 0;
            if (p.elem === 1) romBytes[a] = v & 0xff;
            else if (p.big) { romBytes[a] = (v >> 8) & 0xff; romBytes[a + 1] = v & 0xff; }
            else { romBytes[a] = v & 0xff; romBytes[a + 1] = (v >> 8) & 0xff; }
        }
        return 'wrote ' + values.length + ' value(s) at 0x' +
            p.addr.toString(16).toUpperCase() + ' (in memory — Save ROM to export)';
    }

    function saveRom(nameOverride) {
        if (!romBytes) throw new Error('no ROM loaded — load a ROM first');
        var fname;
        if (nameOverride) {
            fname = String(nameOverride);
            if (!/\.bin$/i.test(fname)) fname += '.bin';
        } else {
            var base = romName.replace(/\.[^.]*$/, '') || 'rom';
            fname = base + '_fantom.bin';
        }
        if (typeof document !== 'undefined' && typeof Blob !== 'undefined') {
            var blob = new Blob([romBytes], { type: 'application/octet-stream' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = fname;
            document.body.appendChild(a);
            a.click();
            setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
        }
        return 'ROM saved as ' + fname + ' (' + romBytes.length + ' bytes)';
    }

    var api = {
        setBytes: setBytes,
        getBytes: getBytes,
        getName: getName,
        readTable: readTable,
        writeTable: writeTable,
        saveRom: saveRom
    };

    if (typeof window !== 'undefined') window.RomEditor = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
