/* ==========================================================================
   engine-text.js — 文本与数据引擎
   覆盖：数据格式互转(JSON/CSV/TSV/YAML/XML/TOML/Markdown/HTML)、编码解码、
        哈希/HMAC、JWT、正则测试、文本对比、大小写、字数统计、CSV 查看器、
        SQL 格式化、Markdown 预览、Cron 解释、时间戳转换
   ========================================================================== */
(function () {
  'use strict';
  const E = {};
  window.TOOL_ENGINES = window.TOOL_ENGINES || {};

  /* ---------------- 解析 / 序列化 ---------------- */
  function parseCSV(text, delim) {
    const d = delim || ',';
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else {
        if (c === '"') q = true;
        else if (c === d) { row.push(cur); cur = ''; }
        else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
        else if (c === '\r') { }
        else cur += c;
      }
    }
    if (cur.length || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.length > 1 || (r[0] || '').trim() !== '');
  }
  function toCSV(rows, delim) {
    const d = delim || ',';
    return rows.map(r => r.map(v => {
      v = v == null ? '' : String(v);
      return /["\n\r]|\s*$|^\s/.test(v) || v.includes(d) ? '"' + v.replace(/"/g, '""') + '"' : v;
    }).join(d)).join('\n');
  }
  function objToRows(obj) {
    if (Array.isArray(obj)) {
      if (!obj.length) return [['value']];
      if (typeof obj[0] !== 'object' || obj[0] === null) return [['value'], ...obj.map(v => [v])];
      const keys = [...new Set(obj.flatMap(o => Object.keys(o)))];
      return [keys, ...obj.map(o => keys.map(k => {
        const v = o[k];
        return v && typeof v === 'object' ? JSON.stringify(v) : (v ?? '');
      }))];
    }
    if (obj && typeof obj === 'object') {
      const flat = {};
      for (const [k, v] of Object.entries(obj)) flat[k] = v && typeof v === 'object' ? JSON.stringify(v) : v;
      return [Object.keys(flat), Object.values(flat)];
    }
    return [['value'], [obj]];
  }
  function rowsToObj(rows) {
    if (!rows.length) return [];
    const head = rows[0];
    return rows.slice(1).map(r => { const o = {}; head.forEach((h, i) => o[h] = r[i] ?? ''); return o; });
  }

  /* ---- 简化版 YAML ---- */
  function parseYaml(text) {
    const lines = text.replace(/\t/g, '  ').split('\n').filter(l => l.trim() && !/^\s*#/.test(l));
    let i = 0;
    function scalar(s) {
      s = s.trim();
      if (s === '') return null;
      if (/^-?\d+(\.\d+)?$/.test(s)) return +s;
      if (/^(true|yes|on)$/i.test(s)) return true;
      if (/^(false|no|off)$/i.test(s)) return false;
      if (/^(null|~)$/i.test(s)) return null;
      if (/^["'].*["']$/.test(s)) return s.slice(1, -1);
      if (/^\[.*\]$/.test(s)) return s.slice(1, -1).split(',').map(x => scalar(x));
      if (/^\{.*\}$/.test(s)) {
        const o = {};
        s.slice(1, -1).split(',').forEach(kv => { const [k, v] = kv.split(':'); if (k) o[k.trim()] = scalar(v || ''); });
        return o;
      }
      return s;
    }
    function block(indent) {
      const isList = /^\s*-\s|^\s*-$/.test(lines[i] || '');
      const out = isList ? [] : {};
      while (i < lines.length) {
        const line = lines[i];
        const ind = line.match(/^\s*/)[0].length;
        if (ind < indent) break;
        if (ind > indent) { i++; continue; }
        if (isList) {
          if (!/^\s*-/.test(line)) break;
          const rest = line.replace(/^\s*-\s*/, '');
          if (rest === '') { i++; out.push(block(indent + 2)); continue; }
          const m = rest.match(/^([\w.\-"']+):\s*(.*)$/);
          if (m) {
            const o = {}; o[m[1].replace(/["']/g, '')] = m[2] === '' ? (i++, block(indent + 2)) : scalar(m[2]);
            i++; out.push(o);
          } else { out.push(scalar(rest)); i++; }
        } else {
          const m = line.match(/^([\w.\-"'\s]+):\s*(.*)$/);
          if (!m) { i++; continue; }
          const key = m[1].trim().replace(/^["']|["']$/g, '');
          if (m[2] === '') {
            i++;
            const nxt = lines[i];
            if (nxt && /^\s*-\s/.test(nxt)) out[key] = block(indent + 2);
            else if (nxt && nxt.match(/^\s*/)[0].length > indent) out[key] = block(indent + 2);
            else out[key] = null;
          } else { out[key] = scalar(m[2]); i++; }
        }
      }
      return out;
    }
    return block(0);
  }
  function toYaml(obj, ind) {
    ind = ind || 0;
    const pad = '  '.repeat(ind);
    if (Array.isArray(obj)) return obj.map(v => {
      if (v && typeof v === 'object') return pad + '-\n' + toYaml(v, ind + 1);
      return pad + '- ' + fmtScalar(v);
    }).join('\n');
    if (obj && typeof obj === 'object') return Object.entries(obj).map(([k, v]) => {
      if (v && typeof v === 'object') return pad + k + ':\n' + toYaml(v, ind + 1);
      return pad + k + ': ' + fmtScalar(v);
    }).join('\n');
    return pad + fmtScalar(obj);
  }
  function fmtScalar(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'boolean' || typeof v === 'number') return String(v);
    const s = String(v);
    return /^[\w.\-/@ +]+$/.test(s) && !/^\d/.test(s) ? s : JSON.stringify(s);
  }
  function objToXml(obj, root) {
    root = root || 'root';
    function build(o, name) {
      if (Array.isArray(o)) return o.map(x => build(x, name.replace(/s$/, '') || 'item')).join('');
      if (o && typeof o === 'object') return `<${name}>` + Object.entries(o).map(([k, v]) => build(v, k)).join('') + `</${name}>`;
      return `<${name}>${o == null ? '' : String(o).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</${name}>`;
    }
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + build(obj, root);
  }
  function xmlToObj(str) {
    const doc = new DOMParser().parseFromString(str, 'text/xml');
    if (doc.querySelector('parsererror')) throw new Error('Invalid XML');
    function walk(node) {
      const kids = [...node.children];
      if (!kids.length) return node.textContent.trim();
      const o = {};
      kids.forEach(k => {
        const v = walk(k);
        if (o[k.tagName] !== undefined) { if (!Array.isArray(o[k.tagName])) o[k.tagName] = [o[k.tagName]]; o[k.tagName].push(v); }
        else o[k.tagName] = v;
      });
      return o;
    }
    return { [doc.documentElement.tagName]: walk(doc.documentElement) };
  }
  function parseToml(text) {
    const out = {}; let cur = out;
    text.split('\n').forEach(line => {
      line = line.replace(/\s+#.*$/, '').trim();
      if (!line) return;
      const sec = line.match(/^\[([^\]]+)\]$/);
      if (sec) { cur = out; sec[1].split('.').forEach(p => { cur[p] = cur[p] || {}; cur = cur[p]; }); return; }
      const kv = line.match(/^([\w.\-"]+)\s*=\s*(.+)$/);
      if (!kv) return;
      let v = kv[2].trim();
      if (/^".*"$/.test(v)) v = v.slice(1, -1);
      else if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map(s => s.trim().replace(/^"|"$/g, ''));
      else if (v === 'true' || v === 'false') v = v === 'true';
      else if (/^-?\d+(\.\d+)?$/.test(v)) v = +v;
      cur[kv[1].replace(/"/g, '')] = v;
    });
    return out;
  }
  function toToml(obj) {
    let scalars = '', tables = '';
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) tables += `\n[${k}]\n` + toToml(v).trim() + '\n';
      else scalars += `${k} = ${typeof v === 'string' ? JSON.stringify(v) : Array.isArray(v) ? '[' + v.map(x => typeof x === 'string' ? JSON.stringify(x) : x).join(', ') + ']' : v}\n`;
    }
    return scalars + tables;
  }
  function mdToHtml(md) {
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let h = esc(md);
    h = h.replace(/```([\s\S]*?)```/g, (m, c) => `<pre><code>${c.trim()}</code></pre>`);
    h = h.replace(/^###### (.*)$/gm, '<h6>$1</h6>').replace(/^##### (.*)$/gm, '<h5>$1</h5>')
      .replace(/^#### (.*)$/gm, '<h4>$1</h4>').replace(/^### (.*)$/gm, '<h3>$1</h3>')
      .replace(/^## (.*)$/gm, '<h2>$1</h2>').replace(/^# (.*)$/gm, '<h1>$1</h1>');
    h = h.replace(/^\s*[-*] (.*)$/gm, '<li>$1</li>').replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, '<ul>$1</ul>');
    h = h.replace(/^\s*(\d+)\. (.*)$/gm, '<li>$2</li>');
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
    h = h.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
    h = h.replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>');
    h = h.split(/\n{2,}/).map(b => /^\s*<(h\d|ul|ol|li|pre|blockquote)/.test(b.trim()) ? b : (b.trim() ? `<p>${b.replace(/\n/g, '<br>')}</p>` : '')).join('\n');
    return h;
  }
  function htmlToMd(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    function walk(node) {
      if (node.nodeType === 3) return node.textContent.replace(/\s+/g, ' ');
      if (node.nodeType !== 1) return '';
      const tag = node.tagName.toLowerCase();
      const inner = [...node.childNodes].map(walk).join('');
      switch (tag) {
        case 'h1': return '\n# ' + inner + '\n';
        case 'h2': return '\n## ' + inner + '\n';
        case 'h3': return '\n### ' + inner + '\n';
        case 'h4': case 'h5': case 'h6': return '\n#### ' + inner + '\n';
        case 'p': return '\n' + inner + '\n';
        case 'br': return '  \n';
        case 'strong': case 'b': return '**' + inner + '**';
        case 'em': case 'i': return '*' + inner + '*';
        case 'code': return '`' + inner + '`';
        case 'pre': return '\n```\n' + inner.trim() + '\n```\n';
        case 'a': return '[' + inner + '](' + (node.getAttribute('href') || '') + ')';
        case 'img': return '![' + (node.getAttribute('alt') || '') + '](' + (node.getAttribute('src') || '') + ')';
        case 'li': return '- ' + inner.trim() + '\n';
        case 'blockquote': return '> ' + inner.trim() + '\n';
        case 'hr': return '\n---\n';
        case 'ul': case 'ol': return '\n' + inner + '\n';
        case 'table': {
          const rows = [...node.querySelectorAll('tr')].map(tr => [...tr.children].map(td => td.textContent.trim()));
          if (!rows.length) return '';
          return '\n| ' + rows[0].join(' | ') + ' |\n| ' + rows[0].map(() => '---').join(' | ') + ' |\n' +
            rows.slice(1).map(r => '| ' + r.join(' | ') + ' |').join('\n') + '\n';
        }
        default: return inner;
      }
    }
    return walk(doc.body).replace(/\n{3,}/g, '\n\n').trim();
  }
  function sqlFormat(sql) {
    const kw = ['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'OUTER JOIN', 'ON', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'UNION ALL', 'UNION', 'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'AS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'WITH'];
    let s = sql.replace(/\s+/g, ' ').trim();
    kw.sort((a, b) => b.length - a.length).forEach(k => {
      s = s.replace(new RegExp('\\b' + k.replace(/ /g, '\\s+') + '\\b', 'gi'), k);
    });
    const breakers = ['FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'JOIN', 'UNION ALL', 'UNION', 'SET', 'VALUES', 'AND', 'OR'];
    breakers.forEach(b => { s = s.replace(new RegExp('\\s+' + b + '\\b', 'g'), '\n' + b); });
    s = s.replace(/\s+(?=SELECT\b|INSERT INTO\b|UPDATE\b|DELETE FROM\b|CREATE TABLE\b)/g, '\n\n');
    s = s.replace(/\s*,\s*/g, ',\n  ').replace(/\n(SELECT|FROM|WHERE|GROUP BY|ORDER BY|HAVING|LIMIT|OFFSET|AND|OR|JOIN|LEFT JOIN|RIGHT JOIN|INNER JOIN|UNION ALL|UNION|SET|VALUES)/g, '\n$1');
    return s.replace(/^\s+/gm, m => m.length > 4 ? '    ' : m);
  }

  /* ---------------- 编码 / 哈希 ---------------- */
  const enc = {
    base64Enc: s => btoa(unescape(encodeURIComponent(s))),
    base64Dec: s => decodeURIComponent(escape(atob(s.replace(/\s/g, '')))),
    urlEnc: s => encodeURIComponent(s),
    urlDec: s => decodeURIComponent(s),
    htmlEnc: s => s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c])),
    htmlDec: s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'),
    hexEnc: s => [...new TextEncoder().encode(s)].map(b => b.toString(16).padStart(2, '0')).join(' '),
    hexDec: s => new TextDecoder().decode(new Uint8Array(s.trim().split(/[\s,]+/).map(h => parseInt(h, 16)))),
    binEnc: s => [...new TextEncoder().encode(s)].map(b => b.toString(2).padStart(8, '0')).join(' '),
    binDec: s => new TextDecoder().decode(new Uint8Array(s.trim().split(/\s+/).map(b => parseInt(b, 2)))),
    unicodeEnc: s => [...s].map(c => c.charCodeAt(0) > 127 ? '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0') : c).join(''),
    unicodeDec: s => s.replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16))),
  };

  async function md5(str) {
    // 纯 JS MD5（RFC 1321 精简实现）
    function rl(n, c) { return (n << c) | (n >>> (32 - c)); }
    function au(x, y) { const l = (x & 0xFFFF) + (y & 0xFFFF); return (((x >> 16) + (y >> 16) + (l >> 16)) << 16) | (l & 0xFFFF); }
    function cmn(q, a, b, x, s, t) { return au(rl(au(au(a, q), au(x, t)), s), b); }
    function ff(a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
    function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
    function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
    function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }
    const bytes = new TextEncoder().encode(str);
    const len = bytes.length;
    const withOne = new Uint8Array((((len + 8) >> 6) + 1) * 64);
    withOne.set(bytes); withOne[len] = 0x80;
    const bitLen = len * 8;
    const dv = new DataView(withOne.buffer);
    dv.setUint32(withOne.length - 8, bitLen >>> 0, true);
    dv.setUint32(withOne.length - 4, Math.floor(bitLen / 4294967296), true);
    let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
    const x = new Int32Array(16);
    for (let i = 0; i < withOne.length; i += 64) {
      for (let j = 0; j < 16; j++) x[j] = dv.getInt32(i + j * 4, true);
      const [oa, ob, oc, od] = [a, b, c, d];
      a = ff(a, b, c, d, x[0], 7, -680876936); d = ff(d, a, b, c, x[1], 12, -389564586); c = ff(c, d, a, b, x[2], 17, 606105819); b = ff(b, c, d, a, x[3], 22, -1044525330);
      a = ff(a, b, c, d, x[4], 7, -176418897); d = ff(d, a, b, c, x[5], 12, 1200080426); c = ff(c, d, a, b, x[6], 17, -1473231341); b = ff(b, c, d, a, x[7], 22, -45705983);
      a = ff(a, b, c, d, x[8], 7, 1770035416); d = ff(d, a, b, c, x[9], 12, -1958414417); c = ff(c, d, a, b, x[10], 17, -42063); b = ff(b, c, d, a, x[11], 22, -1990404162);
      a = ff(a, b, c, d, x[12], 7, 1804603682); d = ff(d, a, b, c, x[13], 12, -40341101); c = ff(c, d, a, b, x[14], 17, -1502002290); b = ff(b, c, d, a, x[15], 22, 1236535329);
      a = gg(a, b, c, d, x[1], 5, -165796510); d = gg(d, a, b, c, x[6], 9, -1069501632); c = gg(c, d, a, b, x[11], 14, 643717713); b = gg(b, c, d, a, x[0], 20, -373897302);
      a = gg(a, b, c, d, x[5], 5, -701558691); d = gg(d, a, b, c, x[10], 9, 38016083); c = gg(c, d, a, b, x[15], 14, -660478335); b = gg(b, c, d, a, x[4], 20, -405537848);
      a = gg(a, b, c, d, x[9], 5, 568446438); d = gg(d, a, b, c, x[14], 9, -1019803690); c = gg(c, d, a, b, x[3], 14, -187363961); b = gg(b, c, d, a, x[8], 20, 1163531501);
      a = gg(a, b, c, d, x[13], 5, -1444681467); d = gg(d, a, b, c, x[2], 9, -51403784); c = gg(c, d, a, b, x[7], 14, 1735328473); b = gg(b, c, d, a, x[12], 20, -1926607734);
      a = hh(a, b, c, d, x[5], 4, -378558); d = hh(d, a, b, c, x[8], 11, -2022574463); c = hh(c, d, a, b, x[11], 16, 1839030562); b = hh(b, c, d, a, x[14], 23, -35309556);
      a = hh(a, b, c, d, x[1], 4, -1530992060); d = hh(d, a, b, c, x[4], 11, 1272893353); c = hh(c, d, a, b, x[7], 16, -155497632); b = hh(b, c, d, a, x[10], 23, -1094730640);
      a = hh(a, b, c, d, x[13], 4, 681279174); d = hh(d, a, b, c, x[0], 11, -358537222); c = hh(c, d, a, b, x[3], 16, -722521979); b = hh(b, c, d, a, x[6], 23, 76029189);
      a = hh(a, b, c, d, x[9], 4, -640364487); d = hh(d, a, b, c, x[12], 11, -421815835); c = hh(c, d, a, b, x[15], 16, 530742520); b = hh(b, c, d, a, x[2], 23, -995338651);
      a = ii(a, b, c, d, x[0], 6, -198630844); d = ii(d, a, b, c, x[7], 10, 1126891415); c = ii(c, d, a, b, x[14], 15, -1416354905); b = ii(b, c, d, a, x[5], 21, -57434055);
      a = ii(a, b, c, d, x[12], 6, 1700485571); d = ii(d, a, b, c, x[3], 10, -1894986606); c = ii(c, d, a, b, x[10], 15, -1051523); b = ii(b, c, d, a, x[1], 21, -2054922799);
      a = ii(a, b, c, d, x[8], 6, 1873313359); d = ii(d, a, b, c, x[15], 10, -30611744); c = ii(c, d, a, b, x[6], 15, -1560198380); b = ii(b, c, d, a, x[13], 21, 1309151649);
      a = ii(a, b, c, d, x[4], 6, -145523070); d = ii(d, a, b, c, x[11], 10, -1120210379); c = ii(c, d, a, b, x[2], 15, 718787259); b = ii(b, c, d, a, x[9], 21, -343485551);
      a = au(a, oa); b = au(b, ob); c = au(c, oc); d = au(d, od);
    }
    return [a, b, c, d].map(n => [...new Uint8Array(new Int32Array([n]).buffer)].map(b => b.toString(16).padStart(2, '0')).join('')).join('');
  }
  async function hash(algo, text, key) {
    if (algo === 'md5') return md5(text);
    const subtle = crypto.subtle;
    /* WebCrypto 只认带连字符的标准名：SHA-1/SHA-256/SHA-384/SHA-512 */
    const UA = ({ SHA256: 'SHA-256', SHA1: 'SHA-1', SHA384: 'SHA-384', SHA512: 'SHA-512' })[algo.toUpperCase()] || algo.toUpperCase();
    const data = new TextEncoder().encode(text);
    if (key) {
      const k = await subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: UA }, false, ['sign']);
      const sig = await subtle.sign('HMAC', k, data);
      return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    const buf = await subtle.digest(UA, data);
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /* ---------------- 面板 ---------------- */
  const MODES = {
    convert: { in: '输入', out: '输出', placeholder: '在此粘贴数据…' },
    encode: { in: '输入', out: '输出', placeholder: '在此粘贴文本…' },
    hash: { in: '输入', out: '哈希', placeholder: '输入或粘贴要计算哈希的文本…' },
    counter: { placeholder: '粘贴或输入文本，立即查看统计结果。' },
    case: { in: '输入', out: '输出', placeholder: '粘贴文本…' },
    diff: { in: '第一段文本', out: '第二段文本' },
    regex: { placeholder: '粘贴要测试的文本…' },
    json: { placeholder: '{"paste": "在此粘贴 JSON"}' },
    jwt: { placeholder: '粘贴 eyJ... 令牌，或在下方编辑 header 和 payload。' },
    csv: { placeholder: 'name,role,country\nAda,Engineer,UK\nJay,Ops,CN' },
    markdown: { placeholder: '# 标题\n\n在这里写 **Markdown**…' },
    sql: { placeholder: 'select a,b from t where x=1 order by a' },
    cron: { placeholder: '0 9 * * 1-5' },
    time: { placeholder: '1700000000 或 2026-10-14T21:00' },
    words: { placeholder: '粘贴要清理的文本…' }
  };

  function paneFor(mode, cfg) {
    const P = [];
    const push = h => P.push(h);
    switch (mode) {
      case 'convert':
        push(`<div class="ptitle">转换</div><div class="pdesc">数据格式互转，在页面内完成。</div>
          <div class="plabel" style="margin-top:0">来源格式</div><select id="txFrom">${['json', 'csv', 'tsv', 'yaml', 'xml', 'toml', 'markdown', 'html'].map(f => `<option ${cfg.from === f ? 'selected' : ''}>${f}</option>`).join('')}</select>
          <div class="plabel">目标格式</div><select id="txTo">${['json', 'csv', 'tsv', 'yaml', 'xml', 'toml', 'markdown', 'html'].map(f => `<option ${cfg.to === f ? 'selected' : ''}>${f}</option>`).join('')}</select>
          <div class="chk on" id="txPretty"><span class="box"><svg data-lucide="check" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg></span> 美化输出</div>
          <div class="chk" id="txRoot"><span class="box"><svg data-lucide="check" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg></span> 用根节点包裹 XML 行</div>`);
        break;
      case 'encode':
        push(`<div class="ptitle">编码</div><div class="pdesc">选择编码方案，然后编码或解码。</div>
          <div class="shapes" id="txScheme">${[['base64', 'Base64'], ['url', 'URL'], ['html', 'HTML 实体'], ['hex', '十六进制'], ['binary', '二进制'], ['unicode', 'Unicode 转义']].map((s, i) => `<button class="shape ${i === 0 ? 'on' : ''}" data-s="${s[0]}">${s[1]}</button>`).join('')}</div>
          <div class="seg" style="margin-top:14px"><button id="txEnc" class="on">编码</button><button id="txDec">解码</button></div>`);
        break;
      case 'hash':
        push(`<div class="ptitle">哈希</div><div class="pdesc">校验和在本地计算，数据不会离开页面。</div>
          <div class="plabel" style="margin-top:0">算法</div><select id="txAlgo"><option>sha256</option><option>sha1</option><option>sha512</option><option>md5</option><option>hmac-sha256</option></select>
          <div class="plabel">密钥（仅 HMAC）</div><input type="text" id="txKey" placeholder="可选">
          <div class="chk" id="txUpper"><span class="box"><svg data-lucide="check" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg></span> 输出大写</div>`);
        break;
      case 'case':
        push(`<div class="ptitle">大小写</div><div class="pdesc">选择一种风格，文本即时更新。</div>
          <div class="shapes" id="txCase">${[['upper', '全大写'], ['lower', '全小写'], ['title', '标题式'], ['sentence', '句首大写'], ['camel', 'camelCase'], ['pascal', 'PascalCase'], ['snake', 'snake_case'], ['kebab', 'kebab-case'], ['constant', 'CONSTANT_CASE'], ['alternate', 'aLtErNaTe'], ['reverse', '反转'], ['invert', '大小写互换']].map((s, i) => `<button class="shape ${i === 0 ? 'on' : ''}" data-c="${s[0]}">${s[1]}</button>`).join('')}</div>`);
        break;
      case 'diff':
        push(`<div class="ptitle">文本对比</div><div class="pdesc">逐行对比，新增为绿色，删除为红色。</div>
          <div class="chk on" id="txIgnoreCase"><span class="box"><svg data-lucide="check" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg></span> 忽略大小写</div>
          <div class="chk on" id="txIgnoreWs"><span class="box"><svg data-lucide="check" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg></span> 忽略空白</div>`);
        break;
      case 'regex':
        push(`<div class="ptitle">正则</div><div class="pdesc">用正则表达式测试你的文本。</div>
          <div class="plabel" style="margin-top:0">表达式</div><input type="text" id="rxPat" placeholder="\\b\\w+@\\w+\\.\\w+\\b">
          <div class="plabel">标志</div><div class="shapes" id="rxFlags">${['g', 'i', 'm', 's'].map((f, i) => `<button class="shape ${i === 0 ? 'on' : ''}" data-f="${f}">${f}</button>`).join('')}</div>
          <div class="plabel">替换为（可选）</div><input type="text" id="rxRep" placeholder="$1">
          <div class="outbox" id="rxInfo">—</div>`);
        break;
      case 'json':
        push(`<div class="ptitle">JSON</div><div class="pdesc">校验、格式化或压缩。</div>
          <div class="seg"><button id="jsFmt" class="on">格式化</button><button id="jsMin">压缩</button><button id="jsTree">树形</button></div>
          <div class="plabel">缩进</div><select id="jsIndent"><option value="2">2 空格</option><option value="4">4 空格</option><option value="\t">Tab</option></select>
          <div class="plabel">排序键</div><div class="chk" id="jsSort"><span class="box"><svg data-lucide="check" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg></span> 按字母序</div>
          <div class="outbox" id="jsInfo">—</div>`);
        break;
      case 'jwt':
        push(`<div class="ptitle">JWT</div><div class="pdesc">解码 header 与 payload，或生成令牌。</div>
          <div class="seg"><button id="jwtDec" class="on">解码</button><button id="jwEnc">编码</button></div>
          <div class="outbox" id="jwtInfo">在左侧粘贴令牌。</div>`);
        break;
      case 'csv':
        push(`<div class="ptitle">分隔符</div><div class="pdesc">自动检测，必要时可更改。</div>
          <select id="csvD"><option value=",">逗号 ,</option><option value=";">分号 ;</option><option value="\t">Tab</option><option value="|">竖线 |</option></select>
          <div class="outbox" id="csvInfo">—</div>`);
        break;
      case 'markdown':
        push(`<div class="ptitle">Markdown</div><div class="pdesc">左侧书写，右侧查看 HTML 渲染效果。</div>
          <div class="seg"><button id="mdPrev" class="on">预览</button><button id="mdHtml">HTML</button><button id="mdMd">Markdown</button></div>
          <div class="plabel">操作</div><div class="shapes"><button class="shape" id="mdCopy">复制 HTML</button><button class="shape" id="mdDl">下载 .html</button></div>`);
        break;
      case 'sql':
        push(`<div class="ptitle">SQL 格式化</div><div class="pdesc">关键字大写并自动换行。</div>
          <div class="shapes"><button class="shape" id="sqlFmt">格式化</button><button class="shape" id="sqlMin">压缩</button></div>`);
        break;
      case 'cron':
        push(`<div class="ptitle">Cron 表达式</div><div class="pdesc">标准 5 字段 cron，用通俗语言解释。</div>
          <div class="plabel" style="margin-top:0">表达式</div><input type="text" id="crIn" value="0 9 * * 1-5">
          <div class="outbox" id="crOut">—</div>`);
        break;
      case 'time':
        push(`<div class="ptitle">时间戳</div><div class="pdesc">Unix 秒、毫秒与 ISO 日期，双向转换。</div>
          <div class="plabel" style="margin-top:0">输入</div><input type="text" id="tmIn" placeholder="1700000000">
          <div class="shapes" style="margin-top:12px"><button class="shape" id="tmNow">使用当前时间</button></div>
          <div class="outbox" id="tmOut">—</div>`);
        break;
      case 'words':
        push(`<div class="ptitle">文本清理</div><div class="pdesc">使用前先整理粘贴的文本。</div>
          <div class="shapes" id="wdOps">
            ${[['trim', '去除行首尾空格'], ['spaces', '合并空格'], ['blanklines', '删除空行'], ['dupes', '删除重复行'], ['sort', '行排序'], ['sortDesc', '倒序排序'], ['numsort', '按数字排序'], ['shuffle', '随机打乱'], ['reverse', '反转行序'], ['number', '添加行号'], ['striphtml', '去除 HTML'], ['slug', '生成 slug'], ['quotes', '智能引号 → 直引号'], ['emojis', '去除 emoji']].map(o => `<button class="shape" data-o="${o[0]}">${o[1]}</button>`).join('')}
          </div>`);
        break;
      default:
        push(`<div class="ptitle">${cfg.paneTitle || '选项'}</div><div class="pdesc">${cfg.paneDesc || ''}</div>`);
    }
    push(`<button class="btn-lime btn-run" id="txGo">${cfg.runLabel || '转换'}</button>
      <button class="btn-ghost btn-sm" id="txCopy" style="width:100%;justify-content:center;margin-top:10px">复制输出</button>
      <button class="btn-ghost btn-sm" id="txDl" style="width:100%;justify-content:center;margin-top:8px">下载</button>
      <div class="runnote">所有操作均在浏览器内完成，不会向任何地方发送数据。</div>`);
    return P.join('');
  }

  /* ---------------- 主挂载 ---------------- */
  E.mount = function (host, cfg, slug) {
    const mode = cfg.mode || 'convert';
    const M = MODES[mode] || {};
    const isCounter = mode === 'counter';
    host.innerHTML = `
      <div class="tool-body ${isCounter ? '' : 'single'}">
        <div class="stage">
          <div class="io" ${isCounter ? 'style="grid-template-columns:1fr"' : ''}>
            <div class="col">
              <div class="colhead"><span class="t">${M.in || '输入'}</span><span class="mini" id="txPaste">粘贴 · <span id="txInLen">0</span> 字符</span></div>
              <textarea id="txIn" placeholder="${M.placeholder || ''}"></textarea>
            </div>
            ${isCounter ? '' : `<div class="col">
              <div class="colhead"><span class="t">${M.out || '输出'}</span><span class="mini" id="txOutLen">0 字符</span></div>
              <div class="ioout" id="txOut"></div>
            </div>`}
          </div>
          <div class="statgrid" id="txStats"></div>
          <div id="txTable"></div>
        </div>
        ${isCounter ? '' : `<div class="pane" id="txPane">${paneFor(mode, cfg)}</div>`}
      </div>`;
    if (isCounter) host.querySelector('.stage').insertAdjacentHTML('afterbegin', `<div class="pane" style="border:1px solid var(--border);border-radius:16px;margin-bottom:14px">${paneFor(mode, cfg)}</div>`);

    const $ = s => host.querySelector(s);
    const q = id => { const e = $('#' + id); return e ? e.value : null; };
    const IN = $('#txIn'), OUT = $('#txOut');
    let lastOut = '';

    function setOut(text, asHtml) {
      lastOut = text;
      if (!OUT) return;
      if (asHtml) OUT.innerHTML = text; else OUT.textContent = text;
      $('#txOutLen').textContent = text.length + ' 字符';
    }
    function err(msg) { setOut(msg, true); if (OUT) OUT.innerHTML = `<span style="color:#ef4444">${msg}</span>`; }
    function readInput() { return IN.value; }

    /* 统计 */
    function stats() {
      if (mode !== 'counter' && !$('#txStats')) return;
      const t = readInput();
      const words = t.trim() ? t.trim().split(/\s+/).length : 0;
      const sentences = (t.match(/[.!?]+(\s|$)/g) || []).length || (t.trim() ? 1 : 0);
      const paras = t.trim() ? t.split(/\n{2,}/).filter(x => x.trim()).length : 0;
      const readMin = Math.max(1, Math.round(words / 225));
      const lines = t ? t.split('\n').length : 0;
      const uniq = t.trim() ? new Set(t.toLowerCase().match(/[a-z\u4e00-\u9fa5']+/g) || []).size : 0;
      const top = {};
      (t.toLowerCase().match(/[a-z\u4e00-\u9fa5']{2,}/g) || []).forEach(w => top[w] = (top[w] || 0) + 1);
      const keywords = Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 12);
      $('#txStats').innerHTML = [
        ['词数', words], ['字符数', t.length], ['不含空格', t.replace(/\s/g, '').length],
        ['句子数', sentences], ['段落数', paras], ['行数', lines],
        ['不重复词数', uniq], ['阅读时长', readMin + ' 分钟']
      ].map(s => `<div class="stat"><b>${s[1]}</b><span>${s[0]}</span></div>`).join('') +
        (mode === 'counter' ? `<div class="stat" style="grid-column:1/-1"><b style="font-size:15px">${keywords.map(k => k[0] + ' <span style="color:#8a8a8a">' + k[1] + '</span>').join(' · ') || '—'}</b><span>高频词</span></div>` : '');
      // 长度限制参考
      if (mode === 'counter') {
        const lim = [['X / Twitter', 280, 'words'], ['Meta 描述', 160, 'chars'], ['SEO 标题', 60, 'chars'], ['Instagram 文案', 2200, 'chars'], ['TikTok 文案', 2200, 'chars'], ['YouTube 标题', 100, 'chars'], ['SMS', 160, 'chars']];
        const el = document.createElement('div');
        el.className = 'statgrid';
        el.innerHTML = lim.map(l => {
          const n = l[2] === 'chars' ? t.length : words;
          const pct = Math.min(100, n / l[1] * 100);
          return `<div class="stat"><b>${n}<span style="font-size:12px;color:#8a8a8a">/${l[1]}</span></b><span>${l[0]}</span>
            <div style="height:4px;background:#2a2a2a;border-radius:9px;margin-top:8px"><i style="display:block;height:100%;width:${pct}%;background:${pct > 100 ? '#ef4444' : 'var(--lime)'};border-radius:9px"></i></div></div>`;
        }).join('');
        const old = $('#txLimits'); if (old) old.remove();
        el.id = 'txLimits';
        $('#txStats').after(el);
      }
    }

    /* 运行 */
    function run() {
      const src = readInput();
      try {
        switch (mode) {
          case 'convert': {
            const from = q('txFrom'), to = q('txTo');
            if (from === to) { setOut(src); break; }
            let obj = src;
            if (from === 'json') obj = JSON.parse(src);
            else if (from === 'csv' || from === 'tsv') obj = rowsToObj(parseCSV(src, from === 'tsv' ? '\t' : ','));
            else if (from === 'yaml') obj = parseYaml(src);
            else if (from === 'xml') obj = xmlToObj(src);
            else if (from === 'toml') obj = parseToml(src);
            let out;
            const pretty = $('#txPretty')?.classList.contains('on');
            if (to === 'json') out = JSON.stringify(obj, null, pretty ? 2 : 0);
            else if (to === 'csv') out = toCSV(Array.isArray(obj) ? objToRows(obj) : objToRows(obj), ',');
            else if (to === 'tsv') out = toCSV(Array.isArray(obj) ? objToRows(obj) : objToRows(obj), '\t');
            else if (to === 'yaml') out = toYaml(obj);
            else if (to === 'xml') out = objToXml(obj, cfg.xmlRoot || 'root');
            else if (to === 'toml') out = toToml(obj);
            else if (to === 'markdown') out = from === 'html' ? htmlToMd(src) : src;
            else if (to === 'html') out = from === 'markdown' ? mdToHtml(src) : src;
            setOut(out);
            break;
          }
          case 'encode': {
            const s = $('.shape.on', $('#txScheme'))?.dataset.s || 'base64';
            const dec = $('#txDec')?.classList.contains('on');
            const map = { base64: [enc.base64Enc, enc.base64Dec], url: [enc.urlEnc, enc.urlDec], html: [enc.htmlEnc, enc.htmlDec], hex: [enc.hexEnc, enc.hexDec], binary: [enc.binEnc, enc.binDec], unicode: [enc.unicodeEnc, enc.unicodeDec] };
            setOut(map[s][dec ? 1 : 0](src));
            break;
          }
          case 'hash': {
            const algo = q('txAlgo');
            const key = (algo === 'hmac-sha256') ? (q('txKey') || '') : null;
            hash(algo === 'hmac-sha256' ? 'sha256' : algo, src, key).then(h => {
              const up = $('#txUpper')?.classList.contains('on');
              setOut((up ? h.toUpperCase() : h) + (key !== null ? '  (HMAC-SHA256)' : ''));
            });
            break;
          }
          case 'case': {
            const c = $('.shape.on', $('#txCase'))?.dataset.c || 'upper';
            const words = src.replace(/[_\-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').split(/(\s+)/);
            const f = {
              upper: s => s.toUpperCase(), lower: s => s.toLowerCase(),
              title: s => s.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase()),
              sentence: s => s.toLowerCase().replace(/(^\s*\w|[.!?]\s+\w)/g, m => m.toUpperCase()),
              camel: () => words.map((w, i) => i && /\S/.test(w) ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()).join(''),
              pascal: () => words.map(w => /\S/.test(w) ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(''),
              snake: () => words.map(w => w.toLowerCase()).join('').replace(/\s+/g, '') + '',
              kebab: () => words.map(w => w.toLowerCase().trim()).filter(Boolean).join('-'),
              constant: () => words.map(w => w.toUpperCase().trim()).filter(Boolean).join('_'),
              alternate: s => [...s].map((ch, i) => i % 2 ? ch.toUpperCase() : ch.toLowerCase()).join(''),
              reverse: s => [...s].reverse().join(''),
              invert: s => [...s].map(ch => ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase()).join(''),
            }[c];
            let out = f(src);
            if (c === 'snake') out = words.map(w => w.toLowerCase().trim()).filter(Boolean).join('_');
            setOut(out);
            break;
          }
          case 'diff': {
            const a = (cfg.firstText || src).split('\n');
            const b = (cfg.secondText || '').split('\n');
            const ic = $('#txIgnoreCase')?.classList.contains('on');
            const iw = $('#txIgnoreWs')?.classList.contains('on');
            const norm = s => iw ? s.replace(/\s+/g, ' ').trim() : s;
            const ca = (ic ? a.map(x => x.toLowerCase()) : a).map(norm);
            const cb = (ic ? b.map(x => x.toLowerCase()) : b).map(norm);
            const m = ca.length, n = cb.length;
            const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
            for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--)
              dp[i][j] = ca[i] === cb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
            let i = 0, j = 0; const rows = [];
            while (i < m && j < n) {
              if (ca[i] === cb[j]) { rows.push([' ', a[i]]); i++; j++; }
              else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push(['-', a[i]]); i++; }
              else { rows.push(['+', b[j]]); j++; }
            }
            while (i < m) rows.push(['-', a[i++]]);
            while (j < n) rows.push(['+', b[j++]]);
            const adds = rows.filter(r => r[0] === '+').length, dels = rows.filter(r => r[0] === '-').length;
            setOut(rows.map(r => `<span style="color:${r[0] === '+' ? '#4ade80' : r[0] === '-' ? '#f87171' : '#a3a3a3'}">${r[0]} ${r[1].replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])) || ' '}</span>`).join('\n'), true);
            if (OUT) OUT.innerHTML = `<div class="note" style="margin:0 0 8px">${adds} 处新增 · ${dels} 处删除</div>` + rows.map(r => `<span style="color:${r[0] === '+' ? '#4ade80' : r[0] === '-' ? '#f87171' : '#a3a3a3'};white-space:pre-wrap">${r[0]} ${(r[1] || ' ').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</span>`).join('\n');
            break;
          }
          case 'regex': {
            const pat = q('rxPat') || '';
            const flags = [...host.querySelectorAll('#rxFlags .shape.on')].map(x => x.dataset.f).join('');
            if (!pat) { $('#rxInfo').textContent = '请输入表达式。'; setOut(src); break; }
            let re; try { re = new RegExp(pat, flags); } catch (e) { $('#rxInfo').textContent = '无效正则：' + e.message; setOut(''); break; }
            const matches = [...src.matchAll(new RegExp(pat, flags.includes('g') ? flags : flags + 'g'))];
            const rep = q('rxRep');
            if (rep !== null && rep !== '') setOut(src.replace(re, rep));
            else setOut(matches.map((m, i) => `${i + 1}. "${m[0]}" 位置 ${m.index}${m.length > 1 ? '  分组：' + m.slice(1).map(g => JSON.stringify(g)).join(', ') : ''}`).join('\n'));
            $('#rxInfo').innerHTML = `<b>${matches.length}</b> 处匹配 · 标志：${flags || '(none)'}`;
            if (!rep) { if (OUT) OUT.innerHTML = src.replace(new RegExp(pat, flags.includes('g') ? flags : flags + 'g'), m => `<mark style="background:#fde047;color:#000;border-radius:3px">${m}</mark>`); }
            break;
          }
          case 'json': {
            const obj = JSON.parse(src);
            const sort = $('#jsSort')?.classList.contains('on');
            const sorted = sort ? sortKeys(obj) : obj;
            const ind = q('jsIndent') === '\\t' ? '\t' : +q('jsIndent');
            if ($('#jsTree')?.classList.contains('on')) {
              $('#jsInfo').textContent = '树形视图 — 点击可折叠';
              if (OUT) OUT.innerHTML = treeHtml(sorted);
            } else if ($('#jsMin')?.classList.contains('on')) { setOut(JSON.stringify(sorted)); $('#jsInfo').innerHTML = '<b>JSON 有效</b> · 已压缩 · ' + window.fmtSize(JSON.stringify(sorted).length); }
            else { setOut(JSON.stringify(sorted, null, ind)); $('#jsInfo').innerHTML = '<b>JSON 有效</b> · 已格式化 · ' + window.fmtSize(lastOut.length); }
            break;
          }
          case 'jwt': {
            if (!$('#jwEnc')?.classList.contains('on')) {
              const parts = src.trim().split('.');
              if (parts.length < 2) { $('#jwtInfo').textContent = '这看起来不像 JWT。'; setOut(''); break; }
              const dec = p => JSON.parse(decodeURIComponent(escape(atob(p.replace(/-/g, '+').replace(/_/g, '/')))));
              try {
                const h = dec(parts[0]), p = dec(parts[1]);
                setOut(JSON.stringify({ header: h, payload: p }, null, 2));
                const now = Math.floor(Date.now() / 1000);
                $('#jwtInfo').innerHTML = `<b>算法</b> ${h.alg || '—'} · <b>类型</b> ${h.typ || '—'}<br>` +
                  (p.exp ? `过期时间 ${new Date(p.exp * 1000).toLocaleString()} ${p.exp < now ? '<b style="color:#ef4444">(已过期)</b>' : '<b style="color:#4ade80">(有效)</b>'}` : '无 exp 声明');
              } catch (e) { $('#jwtInfo').textContent = '无法解码：' + e.message; }
            } else {
              // 编码：输入为 JSON {header, payload, secret}
              try {
                const o = JSON.parse(src);
                const b64u = s => btoa(unescape(encodeURIComponent(JSON.stringify(s)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
                const h = b64u(o.header || { alg: 'HS256', typ: 'JWT' }), p = b64u(o.payload || o);
                (async () => {
                  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(o.secret || 'secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
                  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(h + '.' + p));
                  const s = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
                  setOut(`${h}.${p}.${s}`);
                  $('#jwtInfo').innerHTML = '已用 HMAC-SHA256 签名（演示密钥，请勿用于生产环境）。';
                })();
              } catch (e) { $('#jwtInfo').textContent = '请提供类似 {"header":{...},"payload":{...},"secret":"..."} 的 JSON'; }
            }
            break;
          }
          case 'csv': {
            const d = q('csvD') === '\\t' ? '\t' : q('csvD');
            const rows = parseCSV(src, d);
            const head = rows[0] || [], body = rows.slice(1);
            $('#txTable').innerHTML = rows.length ? `<div style="overflow:auto;max-height:520px;margin-top:14px"><table class="tbl"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body.slice(0, 500).map(r => `<tr>${head.map((_, i) => `<td>${r[i] ?? ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '';
            $('#csvInfo').innerHTML = `<b>${body.length}</b> 行 · <b>${head.length}</b> 列${body.length > 500 ? ' · 仅显示前 500 行' : ''}`;
            setOut(src);
            break;
          }
          case 'markdown': {
            if ($('#mdHtml')?.classList.contains('on')) setOut(mdToHtml(src));
            else if ($('#mdMd')?.classList.contains('on')) setOut(src);
            else if (OUT) OUT.innerHTML = `<div class="prose">${mdToHtml(src)}</div>`;
            break;
          }
          case 'sql': {
            setOut($('#sqlMin')?.classList.contains('on') ? src.replace(/\s+/g, ' ').trim() : sqlFormat(src));
            break;
          }
          case 'cron': {
            const parts = (src || q('crIn') || '').trim().split(/\s+/);
            $('#crOut').innerHTML = parts.length < 5 ? 'Cron 表达式需要 5 个字段：分钟 小时 日 月 星期' : explainCron(parts);
            break;
          }
          case 'time': {
            const v = src.trim();
            let d;
            if (/^\d{13}$/.test(v)) d = new Date(+v);
            else if (/^\d{10}$/.test(v)) d = new Date(+v * 1000);
            else d = new Date(v);
            if (isNaN(d)) { $('#tmOut').textContent = '不是有效的日期或时间戳。'; break; }
            $('#tmOut').innerHTML = `<div class="row"><span>Unix 秒</span><b>${Math.floor(d.getTime() / 1000)}</b></div>
              <div class="row"><span>Unix 毫秒</span><b>${d.getTime()}</b></div>
              <div class="row"><span>ISO 8601 (UTC)</span><b>${d.toISOString()}</b></div>
              <div class="row"><span>本地时间</span><b>${d.toLocaleString()}</b></div>
              <div class="row"><span>相对时间</span><b>${relTime(d)}</b></div>`;
            break;
          }
          case 'words': {
            setOut(src);
            break;
          }
          default: setOut(src);
        }
      } catch (e) {
        err(e.message);
      }
      if (mode !== 'counter') stats();
    }
    function sortKeys(o) {
      if (Array.isArray(o)) return o.map(sortKeys);
      if (o && typeof o === 'object') return Object.keys(o).sort().reduce((a, k) => (a[k] = sortKeys(o[k]), a), {});
      return o;
    }
    function treeHtml(o, depth) {
      depth = depth || 0;
      if (Array.isArray(o)) return `<details open><summary style="cursor:pointer;color:#9aa6f2">[${o.length}]</summary>${o.map(v => `<div style="padding-left:16px">${treeHtml(v, depth + 1)}</div>`).join('')}</details>`;
      if (o && typeof o === 'object') return `<details open><summary style="cursor:pointer;color:#9aa6f2">{${Object.keys(o).length}}</summary>${Object.entries(o).map(([k, v]) => `<div style="padding-left:16px"><span style="color:#c9c9c9">${k}</span>: ${treeHtml(v, depth + 1)}</div>`).join('')}</details>`;
      return `<span style="color:${typeof o === 'string' ? '#a3e635' : '#e8a33d'}">${JSON.stringify(o)}</span>`;
    }
    function explainCron(p) {
      const [mi, hr, dom, mon, dow] = p;
      const F = { min: { '*': '每分钟', default: v => `在第 ${v} 分钟` }, hr: { '*': '每小时', default: v => `${v}:00` } };
      const range = (v, names) => {
        if (v === '*') return '每个' + names;
        if (v.includes('-')) return names + ' ' + v.split('-').join(' 至 ');
        if (v.includes(',')) return names + ' ' + v.split(',').join('、');
        if (v.startsWith('*/')) return '每 ' + v.slice(2) + ' 个' + names;
        return names + ' ' + v;
      };
      const days = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
      const months = ['', '1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
      let time = '';
      if (hr === '*') time = mi === '*' ? '每分钟' : mi.startsWith('*/') ? `每 ${mi.slice(2)} 分钟` : `每小时第 ${mi} 分钟`;
      else if (mi.startsWith('*/')) time = `第 ${hr} 小时内每 ${mi.slice(2)} 分钟`;
      else time = `在 ${String(hr).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
      let d = [];
      if (dom !== '*') d.push('在 ' + dom + ' 日');
      if (mon !== '*') d.push('在 ' + (months[+mon] || mon));
      if (dow !== '*') {
        if (dow.includes('-')) { const [a, b] = dow.split('-').map(Number); d.push(days[a] + ' 至 ' + days[b]); }
        else d.push(days[+dow] || ('星期 ' + dow));
      }
      return `<b>${time}</b>${d.length ? '，' + d.join('，') : '，每天执行'}。`;
    }
    function relTime(d) {
      const diff = (d - Date.now()) / 1000;
      const abs = Math.abs(diff);
      const u = abs < 60 ? [Math.round(abs), '秒'] : abs < 3600 ? [Math.round(abs / 60), '分钟'] : abs < 86400 ? [Math.round(abs / 3600), '小时'] : [Math.round(abs / 86400), '天'];
      return u[0] + ' ' + u[1] + (diff < 0 ? '前' : '后');
    }

    /* 事件 */
    IN.addEventListener('input', () => {
      $('#txInLen').textContent = IN.value.length;
      stats();
      if (['counter', 'hash', 'words', 'csv', 'markdown', 'sql', 'regex', 'diff', 'json', 'jwt', 'time', 'cron', 'case', 'encode'].includes(mode)) {
        if (mode === 'counter') return;
        if (mode === 'words') return;
        run();
      }
    });
    $('#txGo')?.addEventListener('click', run);
    $('#txCopy')?.addEventListener('click', () => window.copyText(lastOut));
    $('#txDl')?.addEventListener('click', () => {
      const ext = { convert: q('txTo') === 'csv' ? 'csv' : q('txTo') === 'yaml' ? 'yaml' : 'txt', markdown: 'html', json: 'json', jwt: 'txt', sql: 'sql', case: 'txt', encode: 'txt', hash: 'txt', words: 'txt', diff: 'diff', regex: 'txt', csv: 'csv' }[mode] || 'txt';
      window.downloadBlob(new Blob([lastOut], { type: 'text/plain' }), slug + '-output.' + ext);
    });
    $('#txPaste')?.addEventListener('click', async () => {
      try { IN.value = await navigator.clipboard.readText(); IN.dispatchEvent(new Event('input')); } catch (e) { window.toast('剪贴板被阻止 — 请使用 Cmd+V'); }
    });
    host.addEventListener('click', e => {
      const sc = e.target.closest('#txScheme .shape');
      if (sc) { host.querySelectorAll('#txScheme .shape').forEach(x => x.classList.remove('on')); sc.classList.add('on'); run(); }
      if (e.target.closest('#txEnc')) { $('#txEnc').classList.add('on'); $('#txDec').classList.remove('on'); run(); }
      if (e.target.closest('#txDec')) { $('#txDec').classList.add('on'); $('#txEnc').classList.remove('on'); run(); }
      const cs = e.target.closest('#txCase .shape');
      if (cs) { host.querySelectorAll('#txCase .shape').forEach(x => x.classList.remove('on')); cs.classList.add('on'); run(); }
      const fl = e.target.closest('#rxFlags .shape');
      if (fl) { fl.classList.toggle('on'); run(); }
      if (e.target.closest('.chk')) { e.target.closest('.chk').classList.toggle('on'); run(); }
      if (e.target.closest('#jsFmt')) { ['jsFmt', 'jsMin', 'jsTree'].forEach(i => $('#' + i).classList.toggle('on', i === 'jsFmt')); run(); }
      if (e.target.closest('#jsMin')) { ['jsFmt', 'jsMin', 'jsTree'].forEach(i => $('#' + i).classList.toggle('on', i === 'jsMin')); run(); }
      if (e.target.closest('#jsTree')) { ['jsFmt', 'jsMin', 'jsTree'].forEach(i => $('#' + i).classList.toggle('on', i === 'jsTree')); run(); }
      if (e.target.closest('#jwtDec')) { $('#jwtDec').classList.add('on'); $('#jwEnc').classList.remove('on'); run(); }
      if (e.target.closest('#jwEnc')) { $('#jwEnc').classList.add('on'); $('#jwtDec').classList.remove('on'); run(); }
      if (e.target.closest('#mdPrev')) { ['mdPrev', 'mdHtml', 'mdMd'].forEach(i => $('#' + i).classList.toggle('on', i === 'mdPrev')); run(); }
      if (e.target.closest('#mdHtml')) { ['mdPrev', 'mdHtml', 'mdMd'].forEach(i => $('#' + i).classList.toggle('on', i === 'mdHtml')); run(); }
      if (e.target.closest('#mdMd')) { ['mdPrev', 'mdHtml', 'mdMd'].forEach(i => $('#' + i).classList.toggle('on', i === 'mdMd')); run(); }
      if (e.target.closest('#mdCopy')) window.copyText(mdToHtml(lastOut));
      if (e.target.closest('#mdDl')) {
        window.downloadBlob(new Blob([`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${slug}</title><style>body{font-family:Inter,system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.7;color:#111}pre{background:#f5f5f5;padding:14px;border-radius:10px;overflow:auto}code{background:#f0f0f0;padding:2px 5px;border-radius:5px}blockquote{border-left:3px solid #ddd;margin:0;padding-left:16px;color:#555}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px 10px}</style></head><body>${mdToHtml(IN.value)}</body></html>`], { type: 'text/html' }), slug + '.html');
      }
      if (e.target.closest('#sqlFmt')) { $('#sqlFmt').classList.add('on'); $('#sqlMin')?.classList.remove('on'); run(); }
      if (e.target.closest('#sqlMin')) { $('#sqlMin').classList.add('on'); $('#sqlFmt')?.classList.remove('on'); run(); }
      if (e.target.closest('#tmNow')) { $('#tmIn').value = String(Math.floor(Date.now() / 1000)); IN.value = $('#tmIn').value; run(); }
      const op = e.target.closest('#wdOps .shape');
      if (op) {
        const v = IN.value;
        const O = {
          trim: s => s.split('\n').map(l => l.trim()).join('\n'),
          spaces: s => s.replace(/[ \t]+/g, ' '),
          blanklines: s => s.split('\n').filter(l => l.trim()).join('\n'),
          dupes: s => [...new Set(s.split('\n'))].join('\n'),
          sort: s => s.split('\n').sort().join('\n'),
          sortDesc: s => s.split('\n').sort().reverse().join('\n'),
          numsort: s => s.split('\n').sort((a, b) => parseFloat(a) - parseFloat(b)).join('\n'),
          shuffle: s => { const a = s.split('\n'); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a.join('\n'); },
          reverse: s => s.split('\n').reverse().join('\n'),
          number: s => s.split('\n').map((l, i) => (i + 1) + '. ' + l).join('\n'),
          striphtml: s => s.replace(/<[^>]+>/g, ''),
          slug: s => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-'),
          quotes: s => s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\u2014/g, '--'),
          emojis: s => s.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, ''),
        }[op.dataset.o];
        IN.value = O(v); IN.dispatchEvent(new Event('input'));
      }
    });
    host.addEventListener('change', e => {
      if (['txFrom', 'txTo', 'txAlgo', 'csvD', 'jsIndent'].includes(e.target.id)) run();
    });

    /* 初始内容 */
    if (cfg.sample) { IN.value = cfg.sample; }
    stats();
    if (mode === 'csv' && !IN.value) IN.value = cfg.placeholderSample || 'name,role,country\nAda,Engineer,UK\nJay,Ops,China';
    if (mode === 'hash' && !IN.value) IN.value = 'The quick brown fox jumps over the lazy dog';
    try { run(); } catch (e) { }
  };
  window.TOOL_ENGINES.text = E;
})();
