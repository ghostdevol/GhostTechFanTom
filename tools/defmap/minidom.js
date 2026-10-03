/* Minimal XML DOM — just the surface FanTom's definitions.js uses
 * (getElementsByTagName, firstChild/nextSibling/parentNode, nodeType,
 * nodeName, getAttribute, attributes, textContent, comment nodes).
 * Exists so the defmap CLI runs under plain node with zero npm deps.
 * The browser build never touches this — it uses the real DOMParser.
 */
'use strict';

function decodeEntities(s) {
    return s.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, e) => {
        if (e[0] === '#') {
            const code = e[1] && (e[1] === 'x' || e[1] === 'X')
                ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
            return String.fromCharCode(code);
        }
        return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e] || m;
    });
}

class Node {
    constructor(nodeType, nodeName, nodeValue) {
        this.nodeType = nodeType;       // 1 element, 3 text, 8 comment, 9 document
        this.nodeName = nodeName;
        this.nodeValue = nodeValue != null ? nodeValue : null;
        this.parentNode = null;
        this.childNodes = [];
        this._attrs = [];               // [{name, value}]
    }
    get firstChild() { return this.childNodes[0] || null; }
    get nextSibling() {
        if (!this.parentNode) return null;
        const sib = this.parentNode.childNodes;
        const i = sib.indexOf(this);
        return i >= 0 && i + 1 < sib.length ? sib[i + 1] : null;
    }
    get attributes() { return this._attrs; }
    getAttribute(name) {
        const a = this._attrs.find(x => x.name === name);
        return a ? a.value : null;
    }
    get textContent() {
        if (this.nodeType === 3) return this.nodeValue;
        let out = '';
        for (const c of this.childNodes) {
            if (c.nodeType === 3) out += c.nodeValue;
            else if (c.nodeType === 1) out += c.textContent;
        }
        return out;
    }
    appendChild(n) { n.parentNode = this; this.childNodes.push(n); return n; }
    getElementsByTagName(name) {
        const out = [];
        const walk = (node) => {
            for (const c of node.childNodes) {
                if (c.nodeType === 1) {
                    if (c.nodeName === name) out.push(c);
                    walk(c);
                }
            }
        };
        walk(this);
        return out;
    }
}

function parseXml(xml) {
    const doc = new Node(9, '#document');
    let cur = doc;
    let i = 0;
    const n = xml.length;
    const pushText = (txt) => {
        if (txt) cur.appendChild(new Node(3, '#text', decodeEntities(txt)));
    };
    while (i < n) {
        const lt = xml.indexOf('<', i);
        if (lt === -1) { pushText(xml.slice(i)); break; }
        if (lt > i) pushText(xml.slice(i, lt));
        if (xml.startsWith('<!--', lt)) {
            const end = xml.indexOf('-->', lt + 4);
            cur.appendChild(new Node(8, '#comment', xml.slice(lt + 4, end === -1 ? n : end)));
            i = end === -1 ? n : end + 3;
        } else if (xml.startsWith('<![CDATA[', lt)) {
            const end = xml.indexOf(']]>', lt + 9);
            cur.appendChild(new Node(3, '#text', xml.slice(lt + 9, end === -1 ? n : end)));
            i = end === -1 ? n : end + 3;
        } else if (xml.startsWith('<?', lt)) {
            const end = xml.indexOf('?>', lt + 2);
            i = end === -1 ? n : end + 2;
        } else if (xml.startsWith('<!', lt)) {
            const end = xml.indexOf('>', lt + 2);
            i = end === -1 ? n : end + 1;
        } else if (xml.startsWith('</', lt)) {
            const end = xml.indexOf('>', lt + 2);
            const name = xml.slice(lt + 2, end === -1 ? n : end).trim();
            let p = cur;
            while (p && p.nodeType === 1 && p.nodeName !== name) p = p.parentNode;
            if (p && p.parentNode) cur = p.parentNode;
            i = end === -1 ? n : end + 1;
        } else {
            // open tag
            let j = lt + 1;
            let name = '';
            while (j < n && !/[\s/>]/.test(xml[j])) { name += xml[j]; j++; }
            const el = new Node(1, name);
            let selfClose = false;
            while (j < n) {
                while (j < n && /\s/.test(xml[j])) j++;
                if (xml[j] === '>') { j++; break; }
                if (xml[j] === '/' && xml[j + 1] === '>') { selfClose = true; j += 2; break; }
                let an = '';
                while (j < n && !/[\s=/>]/.test(xml[j])) { an += xml[j]; j++; }
                while (j < n && /\s/.test(xml[j])) j++;
                let av = '';
                if (xml[j] === '=') {
                    j++;
                    while (j < n && /\s/.test(xml[j])) j++;
                    const q = xml[j];
                    if (q === '"' || q === "'") {
                        const end = xml.indexOf(q, j + 1);
                        av = xml.slice(j + 1, end === -1 ? n : end);
                        j = end === -1 ? n : end + 1;
                    }
                }
                if (an) el._attrs.push({ name: an, value: decodeEntities(av) });
            }
            cur.appendChild(el);
            if (!selfClose) cur = el;
            i = j;
        }
    }
    return doc;
}

class MiniDOMParser {
    parseFromString(xml) { return parseXml(String(xml)); }
}

module.exports = { MiniDOMParser, parseXml };
