/* ==========================================================================
   qr.js — 二维码编码器（Byte 模式，版本 1–40，纠错 L/M/Q/H）
   暴露：window.QRGen(text, ecc) → {size, modules: [[0|1]], version}
   实现遵循 ISO/IEC 18004：RS 纠错、分块交织、格式/版本信息、8 种掩码择优
   v1–40 全版本，Byte 模式最大可编码 2953 字节（L 级）
   ========================================================================== */
(function () {
  'use strict';

  // 每版本每纠错级：[每块纠错码字, [[块数, 数据码字], ...]]
  const RS = {
    1: { L:[7,[[1,19]]], M:[10,[[1,16]]], Q:[13,[[1,13]]], H:[17,[[1,9]]] },
    2: { L:[10,[[1,34]]], M:[16,[[1,28]]], Q:[22,[[1,22]]], H:[28,[[1,16]]] },
    3: { L:[15,[[1,55]]], M:[26,[[1,44]]], Q:[18,[[2,17]]], H:[22,[[2,13]]] },
    4: { L:[20,[[1,80]]], M:[18,[[2,32]]], Q:[26,[[2,24]]], H:[16,[[4,9]]] },
    5: { L:[26,[[1,108]]], M:[24,[[2,43]]], Q:[18,[[2,15],[2,16]]], H:[22,[[2,11],[2,12]]] },
    6: { L:[18,[[2,68]]], M:[16,[[4,27]]], Q:[24,[[4,19]]], H:[28,[[4,15]]] },
    7: { L:[20,[[2,78]]], M:[18,[[4,31]]], Q:[18,[[2,14],[4,15]]], H:[26,[[4,13],[1,14]]] },
    8: { L:[24,[[2,97]]], M:[22,[[2,38],[2,39]]], Q:[22,[[4,18],[2,19]]], H:[26,[[4,14],[2,15]]] },
    9: { L:[30,[[2,116]]], M:[22,[[3,36],[2,37]]], Q:[20,[[4,16],[4,17]]], H:[24,[[4,12],[4,13]]] },
    10: { L:[18,[[2,68],[2,69]]], M:[26,[[4,43],[1,44]]], Q:[24,[[6,19],[2,20]]], H:[28,[[6,15],[2,16]]] },
    11: { L:[20,[[4,81]]], M:[30,[[1,50],[4,51]]], Q:[28,[[4,22],[4,23]]], H:[24,[[3,12],[8,13]]] },
    12: { L:[24,[[2,92],[2,93]]], M:[22,[[6,36],[2,37]]], Q:[26,[[4,20],[6,21]]], H:[28,[[7,14],[4,15]]] },
    13: { L:[26,[[4,107]]], M:[22,[[8,37],[1,38]]], Q:[24,[[8,20],[4,21]]], H:[22,[[12,11],[4,12]]] },
    14: { L:[30,[[3,115],[1,116]]], M:[24,[[4,40],[5,41]]], Q:[20,[[11,16],[5,17]]], H:[24,[[11,12],[5,13]]] },
    15: { L:[22,[[5,87],[1,88]]], M:[24,[[5,41],[5,42]]], Q:[30,[[5,24],[7,25]]], H:[24,[[11,12],[7,13]]] },
    16: { L:[24,[[5,98],[1,99]]], M:[28,[[7,45],[3,46]]], Q:[24,[[15,19],[2,20]]], H:[30,[[3,15],[13,16]]] },
    17: { L:[28,[[1,107],[5,108]]], M:[28,[[10,46],[1,47]]], Q:[28,[[1,22],[15,23]]], H:[28,[[2,14],[17,15]]] },
    18: { L:[30,[[5,120],[1,121]]], M:[26,[[9,43],[4,44]]], Q:[28,[[17,22],[1,23]]], H:[28,[[2,14],[19,15]]] },
    19: { L:[28,[[3,113],[4,114]]], M:[26,[[3,44],[11,45]]], Q:[26,[[17,21],[4,22]]], H:[26,[[9,13],[16,14]]] },
    20: { L:[28,[[3,107],[5,108]]], M:[26,[[3,41],[13,42]]], Q:[30,[[15,24],[5,25]]], H:[28,[[15,15],[10,16]]] },
    21: { L:[28,[[4,116],[4,117]]], M:[26,[[17,42]]], Q:[28,[[17,22],[6,23]]], H:[30,[[19,16],[6,17]]] },
    22: { L:[28,[[2,111],[7,112]]], M:[28,[[17,46]]], Q:[30,[[7,24],[16,25]]], H:[24,[[34,13]]] },
    23: { L:[30,[[4,121],[5,122]]], M:[28,[[4,47],[14,48]]], Q:[30,[[11,24],[14,25]]], H:[30,[[16,15],[14,16]]] },
    24: { L:[30,[[6,117],[4,118]]], M:[28,[[6,45],[14,46]]], Q:[30,[[11,24],[16,25]]], H:[30,[[30,16],[2,17]]] },
    25: { L:[26,[[8,106],[4,107]]], M:[28,[[8,47],[13,48]]], Q:[30,[[7,24],[22,25]]], H:[30,[[22,15],[13,16]]] },
    26: { L:[28,[[10,114],[2,115]]], M:[28,[[19,46],[4,47]]], Q:[28,[[28,22],[6,23]]], H:[30,[[33,16],[4,17]]] },
    27: { L:[30,[[8,122],[4,123]]], M:[28,[[22,45],[3,46]]], Q:[30,[[8,23],[26,24]]], H:[30,[[12,15],[28,16]]] },
    28: { L:[30,[[3,117],[10,118]]], M:[28,[[3,45],[23,46]]], Q:[30,[[4,24],[31,25]]], H:[30,[[11,15],[31,16]]] },
    29: { L:[30,[[7,116],[7,117]]], M:[28,[[21,45],[7,46]]], Q:[30,[[1,23],[37,24]]], H:[30,[[19,15],[26,16]]] },
    30: { L:[30,[[5,115],[10,116]]], M:[28,[[19,47],[10,48]]], Q:[30,[[15,24],[25,25]]], H:[30,[[23,15],[25,16]]] },
    31: { L:[30,[[13,115],[3,116]]], M:[28,[[2,46],[29,47]]], Q:[30,[[42,24],[1,25]]], H:[30,[[23,15],[28,16]]] },
    32: { L:[30,[[17,115]]], M:[28,[[10,46],[23,47]]], Q:[30,[[10,24],[35,25]]], H:[30,[[19,15],[35,16]]] },
    33: { L:[30,[[17,115],[1,116]]], M:[28,[[14,46],[21,47]]], Q:[30,[[29,24],[19,25]]], H:[30,[[11,15],[46,16]]] },
    34: { L:[30,[[13,115],[6,116]]], M:[28,[[14,46],[23,47]]], Q:[30,[[44,24],[7,25]]], H:[30,[[59,16],[1,17]]] },
    35: { L:[30,[[12,121],[7,122]]], M:[28,[[12,47],[26,48]]], Q:[30,[[39,24],[14,25]]], H:[30,[[22,15],[41,16]]] },
    36: { L:[30,[[6,121],[14,122]]], M:[28,[[6,47],[34,48]]], Q:[30,[[46,24],[10,25]]], H:[30,[[2,15],[64,16]]] },
    37: { L:[30,[[17,122],[4,123]]], M:[28,[[29,46],[14,47]]], Q:[30,[[49,24],[10,25]]], H:[30,[[24,15],[46,16]]] },
    38: { L:[30,[[4,122],[18,123]]], M:[28,[[13,46],[32,47]]], Q:[30,[[48,24],[14,25]]], H:[30,[[42,15],[32,16]]] },
    39: { L:[30,[[20,117],[4,118]]], M:[28,[[40,47],[7,48]]], Q:[30,[[43,24],[22,25]]], H:[30,[[10,15],[67,16]]] },
    40: { L:[30,[[19,118],[6,119]]], M:[28,[[18,47],[31,48]]], Q:[30,[[34,24],[34,25]]], H:[30,[[20,15],[61,16]]] },
  };  // 表格：ISO/IEC 18004 官方分块+RSPerBlock（v1–40，L/M/Q/H），由标准表导出
  const ALIGN = {
    1: [],
    2: [6, 18],
    3: [6, 22],
    4: [6, 26],
    5: [6, 30],
    6: [6, 34],
    7: [6, 22, 38],
    8: [6, 24, 42],
    9: [6, 26, 46],
    10: [6, 28, 50],
    11: [6, 30, 54],
    12: [6, 32, 58],
    13: [6, 34, 62],
    14: [6, 26, 46, 66],
    15: [6, 26, 48, 70],
    16: [6, 26, 50, 74],
    17: [6, 30, 54, 78],
    18: [6, 30, 56, 82],
    19: [6, 30, 58, 86],
    20: [6, 34, 62, 90],
    21: [6, 28, 50, 72, 94],
    22: [6, 26, 50, 74, 98],
    23: [6, 30, 54, 78, 102],
    24: [6, 28, 54, 80, 106],
    25: [6, 32, 58, 84, 110],
    26: [6, 30, 58, 86, 114],
    27: [6, 34, 62, 90, 118],
    28: [6, 26, 50, 74, 98, 122],
    29: [6, 30, 54, 78, 102, 126],
    30: [6, 26, 52, 78, 104, 130],
    31: [6, 30, 56, 82, 108, 134],
    32: [6, 34, 60, 86, 112, 138],
    33: [6, 30, 58, 86, 114, 142],
    34: [6, 34, 62, 90, 118, 146],
    35: [6, 30, 54, 78, 102, 126, 150],
    36: [6, 24, 50, 76, 102, 128, 154],
    37: [6, 28, 54, 80, 106, 132, 158],
    38: [6, 32, 58, 84, 110, 136, 162],
    39: [6, 26, 54, 82, 110, 138, 166],
    40: [6, 30, 58, 86, 114, 142, 170],
  };
  const ECC_BITS = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };

  /* --- GF(256) --- */
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const mul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];
  function rsGenPoly(deg) {
    let poly = [1];
    for (let i = 0; i < deg; i++) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= mul(poly[j], 1);
        next[j + 1] ^= mul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }
  function rsEncode(data, ecLen) {
    const gen = rsGenPoly(ecLen);
    const res = new Uint8Array(ecLen);
    for (const d of data) {
      const factor = d ^ res[0];
      res.copyWithin(0, 1);
      res[ecLen - 1] = 0;
      if (factor !== 0) for (let i = 0; i < ecLen; i++) res[i] ^= mul(gen[i + 1], factor);
    }
    return res;
  }

  /* --- BCH ---
     第 3 个参数是「纠错位位数」：格式信息 = 5 数据位 + 10 纠错位 = 15；
     版本信息 = 6 数据位 + 12 纠错位 = 18。
     即 code = (data << ecBits) | (data<<ecBits mod poly)          */
  function bch(data, poly, ecBits) {
    const shifted = data << ecBits;
    let d = shifted;
    const polyBits = poly.toString(2).length;
    while (d.toString(2).length >= polyBits) d ^= poly << (d.toString(2).length - polyBits);
    return shifted | d;
  }
  const FORMAT_POLY = 0b10100110111, VERSION_POLY = 0b1111100100101;

  /* --- 编码主流程 --- */
  function encode(text, ecc) {
    const bytes = new TextEncoder().encode(text);
    let version = 0, spec = null;
    for (let v = 1; v <= 40; v++) {
      const s = RS[v][ecc];
      const dataCw = s[1].reduce((a, b) => a + b[0] * b[1], 0);
      // 模式(4) + 长度(8 或 16 位)
      const lenBits = v < 10 ? 8 : 16;
      const need = Math.ceil((4 + lenBits) / 8) + bytes.length;
      if (need <= dataCw) { version = v; spec = s; break; }
    }
    if (!version) throw new Error('数据太长：最大支持 2953 字节（v40-L），请缩短内容');
    const totalDataCw = spec[1].reduce((a, b) => a + b[0] * b[1], 0);

    // 比特流
    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    push(0b0100, 4);                                  // byte mode
    push(bytes.length, version < 10 ? 8 : 16);
    bytes.forEach(b => push(b, 8));
    // 终止符 + 补位
    const cap = totalDataCw * 8;
    for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    const dataCw = [];
    for (let i = 0; i < bits.length; i += 8) dataCw.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    const pads = [0xEC, 0x11];
    let pi = 0;
    while (dataCw.length < totalDataCw) dataCw.push(pads[pi++ % 2]);

    // 分块 + 纠错
    const blocks = [];
    let off = 0;
    for (const [count, dcw] of spec[1]) {
      for (let b = 0; b < count; b++) {
        const data = dataCw.slice(off, off + dcw); off += dcw;
        blocks.push({ data, ecc: rsEncode(data, spec[0]) });
      }
    }
    // 交织
    const maxData = Math.max(...blocks.map(b => b.data.length));
    const out = [];
    for (let i = 0; i < maxData; i++) blocks.forEach(b => { if (i < b.data.length) out.push(b.data[i]); });
    for (let i = 0; i < spec[0]; i++) blocks.forEach(b => out.push(b.ecc[i]));

    // 矩阵
    const size = version * 4 + 17;
    const mod = Array.from({ length: size }, () => new Uint8Array(size));
    const reserved = Array.from({ length: size }, () => new Uint8Array(size));
    const setF = (r, c, v) => { mod[r][c] = v ? 1 : 0; reserved[r][c] = 1; };

    // 定位图形
    const finder = (r0, c0) => {
      for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
        const rr = r0 + r, cc = c0 + c;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const on = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6)) || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        setF(rr, cc, on);
      }
    };
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
    // 定位辅助
    ALIGN[version].forEach(r => ALIGN[version].forEach(c => {
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) return;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++)
        setF(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }));
    // 时序
    for (let i = 8; i < size - 8; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
    // 固定暗模块 + 格式信息预留
    for (let i = 0; i < 9; i++) { if (!reserved[8][i]) setF(8, i, 0); if (!reserved[i][8]) setF(i, 8, 0); }
    for (let i = 0; i < 8; i++) { setF(8, size - 1 - i, 0); setF(size - 1 - i, 8, 0); }
    setF(size - 8, 8, 1);
    // 版本信息（v7+）
    if (version >= 7) {
      const vi = bch(version, VERSION_POLY, 12);
      for (let i = 0; i < 18; i++) {
        const b = (vi >> i) & 1;
        setF(Math.floor(i / 3), size - 11 + (i % 3), b);
        setF(size - 11 + (i % 3), Math.floor(i / 3), b);
      }
    }

    // 数据填充（右下起，两列一组，蛇形）
    let bitIdx = 0, up = true;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col = 5;
      for (let i = 0; i < size; i++) {
        const row = up ? size - 1 - i : i;
        for (const c of [col, col - 1]) {
          if (reserved[row][c]) continue;
          const byte = out[bitIdx >> 3];
          mod[row][c] = byte === undefined ? 0 : (byte >> (7 - (bitIdx & 7))) & 1;
          bitIdx++;
        }
      }
      up = !up;
    }

    // 掩码 + 格式信息
    const maskFn = [
      (r, c) => (r + c) % 2 === 0,
      (r, c) => r % 2 === 0,
      (r, c) => c % 3 === 0,
      (r, c) => (r + c) % 3 === 0,
      (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
      (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
      (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
      (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
    ];
    const fmtPos = [];
    for (let i = 0; i <= 8; i++) { if (i !== 6) fmtPos.push([8, i]); }
    for (let i = size - 1; i >= size - 8; i--) fmtPos.push([8, i]);
    for (let i = 0; i <= 8; i++) { if (i !== 6) fmtPos.push([i, 8]); }
    for (let i = size - 1; i >= size - 7; i--) fmtPos.push([i, 8]);

    function applyFormat(m, mask) {
      const data = (ECC_BITS[ecc] << 3) | mask;
      const f = bch(data, FORMAT_POLY, 10) ^ 0b101010000010010;
      const seq = [];
      for (let i = 14; i >= 0; i--) seq.push((f >> i) & 1);   // MSB(bit14) 先
      // 左上角与右上/左下
      const a = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
      a.forEach(([r, c], i) => m[r][c] = seq[i]);
      const b = [[size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8], [size - 5, 8], [size - 6, 8], [size - 7, 8], [8, size - 8], [8, size - 7], [8, size - 6], [8, size - 5], [8, size - 4], [8, size - 3], [8, size - 2], [8, size - 1]];
      b.forEach(([r, c], i) => m[r][c] = seq[i]);
    }

    let best = null;
    for (let m = 0; m < 8; m++) {
      const g = mod.map(row => Uint8Array.from(row));
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++)
        if (!reserved[r][c] && maskFn[m](r, c)) g[r][c] ^= 1;
      applyFormat(g, m);
      const p = penalty(g, size);
      if (!best || p < best.p) best = { p, g };
    }
    return { size, modules: best.g, version };
  }

  function penalty(g, size) {
    let score = 0;
    // 规则 1：行/列连续同色
    for (let r = 0; r < size; r++) {
      let run = 1;
      for (let c = 1; c < size; c++) {
        if (g[r][c] === g[r][c - 1]) run++;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    for (let c = 0; c < size; c++) {
      let run = 1;
      for (let r = 1; r < size; r++) {
        if (g[r][c] === g[r - 1][c]) run++;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    // 规则 2：2×2 同色块
    for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
      const v = g[r][c];
      if (v === g[r][c + 1] && v === g[r + 1][c] && v === g[r + 1][c + 1]) score += 3;
    }
    // 规则 3：类定位图形
    const pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    const matchAt = (arr, i, pat) => pat.every((v, k) => arr[i + k] === v);
    for (let r = 0; r < size; r++) {
      const row = g[r];
      for (let c = 0; c + 11 <= size; c++) if (matchAt(row, c, pat1) || matchAt(row, c, pat2)) score += 40;
    }
    for (let c = 0; c < size; c++) {
      const col = g.map(row => row[c]);
      for (let r = 0; r + 11 <= size; r++) if (matchAt(col, r, pat1) || matchAt(col, r, pat2)) score += 40;
    }
    // 规则 4：暗色比例
    let dark = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += g[r][c];
    const ratio = dark * 100 / (size * size);
    score += Math.floor(Math.abs(ratio - 50) / 5) * 10;
    return score;
  }

  /* --- 渲染到 canvas --- */
  function toCanvas(qr, scale, margin, dark, light) {
    const n = qr.size + margin * 2;
    const c = document.createElement('canvas');
    c.width = c.height = n * scale;
    const ctx = c.getContext('2d');
    ctx.fillStyle = light || '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = dark || '#000000';
    for (let r = 0; r < qr.size; r++) for (let cc = 0; cc < qr.size; cc++)
      if (qr.modules[r][cc]) ctx.fillRect((cc + margin) * scale, (r + margin) * scale, scale, scale);
    return c;
  }

  window.QRGen = encode;
  window.QRGen.toCanvas = toCanvas;
})();
