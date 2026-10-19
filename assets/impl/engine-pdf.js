/* ==========================================================================
   engine-pdf.js — PDF / 文档引擎（浏览器本地，零上传、零外部请求）
   --------------------------------------------------------------------------
   覆盖的 slug（按 slug 分发；cfg 仅作兜底）：
   A. PDF 操作（pdf-lib）
      merge-pdf / split-pdf / rotate-pdf / n-up-pdf / pdf-booklet-maker /
      pdf-imposition / add-page-numbers-to-pdf / pdf-editor /
      black-out-text-in-pdf / redact-pdf / sign-pdf / compress-pdf /
      unlock-pdf / remove-metadata-from-pdf
   B. 转 PDF（pdf-lib 绘制）
      image-to-pdf / jpg-to-pdf / png-to-pdf / text-to-pdf / markdown-to-pdf /
      html-to-pdf / csv-to-pdf / excel-to-pdf / xlsx-to-pdf / docx-to-pdf /
      word-to-pdf / dxf-to-pdf
   C. PDF → 其他（本地读取/渲染）
      pdf-to-jpg / pdf-to-png / pdf-reader / pdf-to-text / pdf-to-word /
      pdf-to-excel / pdf-to-qbo / pdf-invoice-to-csv /
      pdf-bank-statement-to-excel / pdf-to-ppt / pdf-to-pptx / compare-pdf
   D. 检查类
      pdf-preflight / pdf-dpi-checker / pdf-font-checker / pdf-bleed-checker
   E. 图像 → PDF
      business-card-imposition
   F. Office / 表格
      csv-to-excel / excel-viewer / bank-statement-converter /
      bank-statement-to-csv / invoice-scanner / receipt-scanner / invoice-to-excel
   G. 生成类文档（表单 → 实时预览 → 导出 PDF）
      invoice-generator / proforma-invoice / receipt-generator /
      estimate-template / cv-maker / resume-builder / resume-templates /
      cover-letter-generator / gantt-chart-maker / gantt-chart-template /
      project-timeline-maker
   H. DICOM
      dicom-viewer / dicom-to-jpg / dicom-anonymizer
   I. 其他
      markdown-to-word / compare-word-documents
   （watermark-pdf 不在站点 slug 列表中，按任务要求跳过）

   关键技术点（中文渲染）：
     pdf-lib 的标准字体无法内嵌中文，所以所有文本先按行用 Canvas 以指定
     字号/粗细绘到透明 PNG，再用 page.drawImage 贴到页面上（见 lineCanvas /
     DocBuilder）。中英文都能正确显示。

   诚实说明：vendor 里的 pdfjs.js 是 ESM 主包、缺少 worker
     （没有 WorkerMessageHandler 导出）。浏览器里 getDocument 会抛
     No "GlobalWorkerOptions.workerSrc" / fake worker failed，无法工作。
     因此“PDF → 其他”改用 pdf-lib 的对象模型 + 本引擎自带流解码器 +
     Canvas 子集渲染器；渲染是“本地近似”，界面上已注明。
   ========================================================================== */
(function () {
  'use strict';

  const E = {};
  window.TOOL_ENGINES = window.TOOL_ENGINES || {};

  /* ======================= 基础工具 ======================= */
  const A4 = [595.28, 841.89];
  const LETTER = [612, 792];
  const SCALE = 3; // 文本贴图超采样倍率（约 216dpi）

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms || 0)); }
  function bufOf(x) { return x instanceof Uint8Array ? x : new Uint8Array(x); }
  function concatU8(list) {
    let n = 0; for (const u of list) n += u.length;
    const o = new Uint8Array(n); let p = 0;
    for (const u of list) { o.set(u, p); p += u.length; }
    return o;
  }
  function u8ToBase64(u8) {
    let s = ''; const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
  }
  function base64ToU8(b64) {
    const bin = atob(String(b64).replace(/^data:[^,]*,/, '').replace(/\s+/g, ''));
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }
  function utf8(str) { return new TextEncoder().encode(String(str)); }
  function latin1(u8) {
    let s = ''; const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return s;
  }
  function canvasOf(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
  function loadImg(src) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('无法读取该图片'));
      im.src = src instanceof Blob ? URL.createObjectURL(src) : src;
    });
  }
  function hex2rgb(h) {
    h = String(h || '#111').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h.slice(0, 6), 16) || 0;
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
  }
  function esc(s) { return window.TUI ? window.TUI.esc(s) : String(s == null ? '' : s); }

  /* ======================= vendor 加载 ======================= */
  function loadScript(src, name, asModule) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      if (asModule) s.type = 'module';
      s.src = '../assets/vendor/' + src;
      s.onload = () => res(window[name]);
      s.onerror = () => rej(new Error('加载失败：' + src));
      document.head.appendChild(s);
    });
  }
  let _pdfLib = null;
  function getPDFLib() {
    if (_pdfLib) return Promise.resolve(_pdfLib);
    if (window.PDFLib) { _pdfLib = window.PDFLib; return Promise.resolve(_pdfLib); }
    return loadScript('pdf-lib.min.js', 'PDFLib').then(L => { _pdfLib = L || window.PDFLib; return _pdfLib; });
  }
  /* pdf-lib 需要真正的 rgb() 颜色对象（普通 {r,g,b} 会抛 Invalid color） */
  function colOf(hex) {
    const c = hex2rgb(hex);
    const P = _pdfLib || window.PDFLib;
    return P && P.rgb ? P.rgb(c.r, c.g, c.b) : c;
  }

  /* ======================= Canvas 文本 → PDF 贴图（关键） ======================= */
  const FAMILY = {
    sans: '-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC",Arial,Helvetica,sans-serif',
    serif: 'Georgia,"Times New Roman","Songti SC","STSong","SimSun","Noto Serif CJK SC",serif',
    mono: 'Menlo,Consolas,"SF Mono","Courier New",monospace'
  };
  const _mc = canvasOf(8, 8);
  const _mx = _mc.getContext('2d');
  function fontStr(st) { return (st.bold ? '700 ' : '400 ') + (st.size * SCALE) + 'px ' + (FAMILY[st.family] || FAMILY.sans); }
  function measurePt(text, st) { _mx.font = fontStr(st); return _mx.measureText(text).width / SCALE; }

  function lineCanvas(text, st) {
    _mx.font = fontStr(st);
    const pad = 2;
    const w = Math.max(2, Math.ceil(_mx.measureText(text).width + pad * 2));
    const h = Math.ceil(st.size * SCALE * 1.36 + pad * 2);
    const c = canvasOf(w, h);
    const ctx = c.getContext('2d');
    ctx.font = fontStr(st);
    ctx.textBaseline = 'top';
    ctx.fillStyle = st.color || '#111111';
    ctx.fillText(text, pad, pad);
    return c;
  }

  function tokenize(line) {
    const toks = []; let buf = '';
    for (const ch of line) {
      const cp = ch.codePointAt(0);
      const cjk = (cp >= 0x2E80 && cp <= 0x9FFF) || (cp >= 0xF900 && cp <= 0xFAFF) || (cp >= 0xFF00 && cp <= 0xFFEF) || (cp >= 0x3000 && cp <= 0x303F) || (cp >= 0xAC00 && cp <= 0xD7AF);
      if (cjk) { if (buf) { toks.push(buf); buf = ''; } toks.push(ch); }
      else if (ch === ' ') buf += ' ';
      else if (ch === '\t') buf += '    ';
      else buf += ch;
    }
    if (buf) toks.push(buf);
    return toks;
  }
  function wrapText(text, maxW, st) {
    if (!(maxW > 0)) return String(text == null ? '' : text).split(/\r?\n/);
    const out = [];
    for (const para of String(text == null ? '' : text).split(/\r?\n/)) {
      if (para === '') { out.push(''); continue; }
      const toks = tokenize(para);
      let cur = '';
      for (const tok of toks) {
        if (cur === '') {
          if (measurePt(tok, st) > maxW) {
            let piece = '';
            for (const ch of tok) {
              if (piece && measurePt(piece + ch, st) > maxW) { out.push(piece); piece = ch; }
              else piece += ch;
            }
            cur = piece;
          } else cur = tok;
        } else if (measurePt(cur + tok, st) <= maxW) {
          cur += tok;
        } else {
          out.push(cur.replace(/\s+$/, ''));
          let t2 = tok.replace(/^\s+/, '');
          if (measurePt(t2, st) > maxW) { let piece = ''; for (const ch of t2) { if (piece && measurePt(piece + ch, st) > maxW) { out.push(piece); piece = ch; } else piece += ch; } cur = piece; } else cur = t2;
        }
      }
      out.push(cur.replace(/\s+$/, ''));
    }
    return out;
  }

  async function embedCanvas(pdf, c, cache, key) {
    if (cache && key && cache.has(key)) return cache.get(key);
    const img = await pdf.embedPng(c.toDataURL('image/png'));
    const rec = { img, w: c.width / SCALE, h: c.height / SCALE };
    if (cache && key) cache.set(key, rec);
    return rec;
  }

  /* ======================= DocBuilder：排版 → PDF ======================= */
  function DocBuilder(pdf, opt) {
    opt = opt || {};
    this.pdf = pdf;
    this.pageW = opt.pageW || A4[0];
    this.pageH = opt.pageH || A4[1];
    this.margin = opt.margin == null ? 48 : opt.margin;
    this.bg = opt.bg || null;
    this.pages = [];
    this.ops = [];
    this._cache = new Map();
    this.pageIdx = -1;
    this.y = 0;
  }
  DocBuilder.prototype.newPage = function () {
    const p = this.pdf.addPage([this.pageW, this.pageH]);
    if (this.bg) p.drawRectangle({ x: 0, y: 0, width: this.pageW, height: this.pageH, color: colOf(this.bg) });
    this.pages.push(p); this.pageIdx = this.pages.length - 1; this.y = this.pageH - this.margin;
    return p;
  };
  DocBuilder.prototype.need = function (h) { if (this.pageIdx < 0 || this.y - h < this.margin) this.newPage(); };
  DocBuilder.prototype.space = function (h) { this.y -= (h == null ? 8 : h); return this; };
  DocBuilder.prototype.rule = function (o) {
    o = o || {};
    const gap = o.gap == null ? 8 : o.gap;
    this.need(gap); this.y -= (o.offset || 0);
    this.ops.push({ k: 'rule', p: this.pageIdx, y: this.y, thickness: o.thickness || 0.7, color: o.color || '#cccccc' });
    this.y -= gap; return this;
  };
  DocBuilder.prototype.box = function (o) { this.need(o.h); this.ops.push({ k: 'box', p: this.pageIdx, x: o.x == null ? this.margin : o.x, y: this.y - o.h, w: o.w == null ? (this.pageW - 2 * this.margin) : o.w, h: o.h, fill: o.fill, stroke: o.stroke }); return this; };
  DocBuilder.prototype.text = function (str, o) {
    o = o || {};
    const st = { size: o.size || 11, bold: !!o.bold, color: o.color || '#111111', family: o.family || 'sans', lh: o.lh || 1.4 };
    const indent = o.indent || 0;
    const availW = o.maxWidth ? (o.maxWidth - indent) : (this.pageW - 2 * this.margin - indent);
    const lineH = st.size * st.lh;
    for (const ln of wrapText(str, availW, st)) {
      this.need(lineH);
      this.ops.push({ k: 'line', p: this.pageIdx, y: this.y - (st.size + 2), ln, st, align: o.align || 'left', indent });
      this.y -= lineH;
    }
    if (o.after) this.y -= o.after;
    return this;
  };
  DocBuilder.prototype.meta = function (s) { return this.text(s, { size: 9, color: '#666666' }); };
  DocBuilder.prototype.kv = function (label, value, o) {
    o = o || {};
    const st = { size: o.size || 11, color: '#111111', family: 'sans', bold: true };
    this.need(st.size * 1.6);
    const y = this.y - (st.size + 2);
    this.ops.push({ k: 'abs', p: this.pageIdx, x: this.margin + (o.indent || 0), y, ln: String(label), st: { size: st.size, color: o.labelColor || '#444444', family: st.family, bold: false }, mode: 'l' });
    this.ops.push({ k: 'abs', p: this.pageIdx, x: this.pageW - this.margin, y, ln: String(value == null ? '' : value), st, mode: 'r' });
    this.y -= st.size * 1.6; return this;
  };
  DocBuilder.prototype.bullets = function (list, o) { o = o || {}; for (const it of list) this.text('• ' + it, { size: o.size || 11, indent: 12, after: 2 }); return this; };
  DocBuilder.prototype.image = function (rec, o) {
    o = o || {};
    let w = o.w || 0, h = o.h || 0;
    if (w && !h) h = rec.h * (w / rec.w);
    if (h && !w) w = rec.w * (h / rec.h);
    if (!w && !h) { w = rec.w; h = rec.h; }
    const maxW = this.pageW - 2 * this.margin;
    if (w > maxW) { h *= maxW / w; w = maxW; }
    this.need(h + 4);
    let x = this.margin;
    if (o.align === 'center') x = (this.pageW - w) / 2;
    else if (o.align === 'right') x = this.pageW - this.margin - w;
    this.ops.push({ k: 'png', p: this.pageIdx, x, y: this.y - h, w, h, canvas: rec.canvas, key: rec.key });
    this.y -= h + (o.after == null ? 8 : o.after); return this;
  };
  /* 画一张位图（canvas） */
  DocBuilder.prototype.bitmap = function (canvas, o) { o = o || {}; return this.image({ canvas, w: canvas.width / (o.s || SCALE), h: canvas.height / (o.s || SCALE) , key: null }, o); };

  /* 表格：整表画到一张 canvas 再贴图。rows[0] 视为表头 */
  DocBuilder.prototype.table = function (rows, o) {
    o = o || {};
    const size = o.size || 10, padX = o.padX || 6, padY = o.padY || 4;
    const availW = this.pageW - 2 * this.margin;
    const cols = o.cols || (rows[0] ? rows[0].length : 1);
    const fs = size * SCALE;
    const family = o.family || 'sans';
    const stN = { size, family, bold: false }, stB = { size, family, bold: true };
    const weights = o.weights || null;
    const colW = new Array(cols).fill(1);
    if (weights) { const sum = weights.reduce((a, b) => a + b, 0) || 1; for (let i = 0; i < cols; i++) colW[i] = availW * weights[i] / sum; }
    else {
      const mw = new Array(cols).fill(16);
      _mx.font = fs + 'px ' + (FAMILY[family]);
      rows.forEach(r => { for (let i = 0; i < cols; i++) { const t = String(r[i] == null ? '' : r[i]); mw[i] = Math.max(mw[i], Math.min(_mx.measureText(t).width, availW * SCALE * 0.6)); } });
      const tot = mw.reduce((a, b) => a + b, 0) || 1;
      for (let i = 0; i < cols; i++) colW[i] = availW * mw[i] / tot;
    }
    const rowData = rows.map((r, ri) => {
      const isHead = o.header !== false && ri === 0;
      const st = isHead ? stB : stN;
      let maxLines = 1; const cells = [];
      for (let i = 0; i < cols; i++) {
        const lines = wrapText(String(r[i] == null ? '' : r[i]), colW[i] - padX * 2, st);
        maxLines = Math.max(maxLines, lines.length); cells.push(lines);
      }
      return { cells, isHead, h: maxLines * fs * 1.35 / SCALE + padY * 2 };
    });
    const totalH = rowData.reduce((a, b) => a + b.h, 0);
    const c = canvasOf(availW * SCALE, Math.max(2, totalH * SCALE));
    const ctx = c.getContext('2d');
    ctx.textBaseline = 'top';
    let yy = 0;
    rowData.forEach((rd, ri) => {
      const h = rd.h * SCALE;
      if (rd.isHead && o.headFill) { ctx.fillStyle = o.headFill; ctx.fillRect(0, yy, c.width, h); }
      else if (o.zebra && ri % 2 === (o.header !== false ? 1 : 0)) { ctx.fillStyle = o.zebra; ctx.fillRect(0, yy, c.width, h); }
      ctx.font = (rd.isHead ? '700 ' : '400 ') + fs + 'px ' + FAMILY[family];
      ctx.fillStyle = rd.isHead ? (o.headColor || '#111111') : (o.color || '#1a1a1a');
      let xx = 0;
      for (let i = 0; i < cols; i++) {
        const align = (o.align && o.align[i]) || 'left';
        rd.cells[i].forEach((ln, li) => {
          const tw = ctx.measureText(ln).width;
          let tx = xx + padX * SCALE;
          if (align === 'right') tx = xx + colW[i] * SCALE - padX * SCALE - tw;
          else if (align === 'center') tx = xx + (colW[i] * SCALE - tw) / 2;
          ctx.fillText(ln, tx, yy + padY * SCALE + li * fs * 1.35);
        });
        xx += colW[i] * SCALE;
      }
      if (o.grid !== false) { ctx.strokeStyle = o.gridColor || '#dddddd'; ctx.lineWidth = Math.max(1, SCALE * 0.4); ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(c.width, yy); ctx.stroke(); }
      yy += h;
    });
    if (o.grid !== false) {
      ctx.strokeStyle = o.gridColor || '#dddddd'; ctx.lineWidth = Math.max(1, SCALE * 0.4);
      ctx.beginPath(); let xx = 0;
      for (let i = 0; i <= cols; i++) { ctx.moveTo(xx, 0); ctx.lineTo(xx, c.height); xx += colW[i] * SCALE; }
      ctx.moveTo(0, c.height); ctx.lineTo(c.width, c.height); ctx.stroke();
    }
    const rec = { canvas: c, w: availW, h: totalH, key: null };
    this.need(totalH + 4);
    this.ops.push({ k: 'png', p: this.pageIdx, x: this.margin, y: this.y - totalH, w: availW, h: totalH, canvas: c, key: null });
    this.y -= totalH + (o.after == null ? 10 : o.after);
    return this;
  };
  DocBuilder.prototype.onPage = function (fn) { this.need(1); this.ops.push({ k: 'draw', p: this.pageIdx, fn }); return this; };

  DocBuilder.prototype.render = async function () {
    if (this.pageIdx < 0) this.newPage();
    for (const op of this.ops) {
      const page = this.pages[op.p] || this.pages[this.pages.length - 1];
      if (op.k === 'line') {
        const rec = await embedCanvas(this.pdf, lineCanvas(op.ln, op.st), this._cache, 'L:' + op.st.size + op.st.bold + op.st.color + op.st.family + op.align + '|' + op.ln);
        let x = this.margin + op.indent;
        if (op.align === 'center') x = (this.pageW - rec.w) / 2;
        else if (op.align === 'right') x = this.pageW - this.margin - rec.w;
        page.drawImage(rec.img, { x, y: op.y, width: rec.w, height: rec.h });
      } else if (op.k === 'abs') {
        const rec = await embedCanvas(this.pdf, lineCanvas(op.ln, op.st), this._cache, 'A:' + op.st.size + op.st.bold + op.st.color + '|' + op.ln);
        page.drawImage(rec.img, { x: op.mode === 'r' ? op.x - rec.w : op.x, y: op.y, width: rec.w, height: rec.h });
      } else if (op.k === 'rule') {
        page.drawLine({ start: { x: this.margin, y: op.y }, end: { x: this.pageW - this.margin, y: op.y }, thickness: op.thickness, color: colOf(op.color) });
      } else if (op.k === 'box') {
        page.drawRectangle({ x: op.x, y: op.y, width: op.w, height: op.h, color: op.fill ? colOf(op.fill) : undefined, borderColor: op.stroke ? colOf(op.stroke) : undefined, borderWidth: op.stroke ? 0.7 : 0 });
      } else if (op.k === 'png') {
        const rec = await embedCanvas(this.pdf, op.canvas, this._cache, op.key);
        page.drawImage(rec.img, { x: op.x, y: op.y, width: op.w, height: op.h });
      } else if (op.k === 'draw') {
        op.fn(page);
      }
      await sleep(0);
    }
    return this;
  };
  async function buildPdf(cfg, direction, fn) {
    const P = await getPDFLib();
    const pdf = await P.PDFDocument.create();
    const db = new DocBuilder(pdf, cfg || {});
    await fn(db, pdf, P);
    await db.render();
    const bytes = await pdf.save({ useObjectStreams: true });
    window.downloadBlob(new Blob([bytes], { type: 'application/pdf' }), direction || 'document.pdf');
    return bytes;
  }

  /* ======================= 通用 UI 构件 ======================= */
  function dropInner(o) {
    o = o || {};
    return `<div class="ic">${window.icon(o.icon || 'pdf', 30)}</div><h3>${esc(o.title || '选择一个文件')}</h3><p>${esc(o.hint || '拖拽到此处，或点击选择')}</p><div class="fmts">${o.fmts || ''}</div>`;
  }
  function fileTask(host, o) {
    const { stage, pane } = window.TUI.shell(host, true);
    stage.innerHTML = window.TUI.drop(dropInner(o), o.accept || '.pdf,application/pdf', !!o.multiple);
    pane.innerHTML = (o.paneHtml || '') +
      `<div class="outbox" id="tOut">输出：—</div>
       <button class="btn-lime btn-run" id="tGo">${esc(o.runLabel || '运行')}</button>
       <div class="progress" id="tProg" style="display:none"><i></i></div>
       <div class="runnote">${o.note || '全部在你的浏览器内完成，文件不会上传。'}</div>`;
    const S = Object.assign({ files: [] }, o.state || {});
    const helpers = {
      S, stage, pane,
      q: id => { const e = pane.querySelector('#' + id); return e ? (e.type === 'checkbox' ? e.checked : e.value) : null; },
      el: s => pane.querySelector(s),
      out: html => { pane.querySelector('#tOut').innerHTML = html; },
      prog: p => window.TUI.prog(pane.querySelector('#tProg'), p),
      busy: on => { const b = pane.querySelector('#tGo'); b.disabled = !!on; b.textContent = on ? '处理中…' : (o.runLabel || '运行'); },
      showFiles: list => {
        stage.innerHTML = `<div class="filebar" style="margin-top:12px"><span><b>${esc(list.length > 1 ? list.length + ' 个文件' : list[0].name)}</b> &nbsp; <span class="mini">${window.fmtSize(list.reduce((a, f) => a + f.size, 0))}</span></span><span class="newv" id="tReset">重新选择</span></div>`;
        const r = stage.querySelector('#tReset'); if (r) r.onclick = reset;
      }
    };
    function reset() { stage.innerHTML = window.TUI.drop(dropInner(o), o.accept || '.pdf,application/pdf', !!o.multiple); window.TUI.bindDrop(stage, o.accept, !!o.multiple, onFiles); S.files = []; }
    async function onFiles(list) {
      S.files = list;
      try { if (o.onStage) await o.onStage(list, helpers); else helpers.showFiles(list); }
      catch (e) { console.error(e); window.toast(e.message); }
    }
    window.TUI.bindDrop(stage, o.accept, !!o.multiple, onFiles);
    pane.querySelector('#tGo').addEventListener('click', async () => {
      try { await o.run(S, helpers); }
      catch (e) { console.error(e); window.toast('失败：' + e.message); }
    });
    if (o.init) o.init(helpers);
    return helpers;
  }
  async function outFile(S, helpers, bytes, name, mime) {
    const blob = new Blob([bytes], { type: mime || 'application/pdf' });
    helpers.out(`已生成 <b>${esc(name)}</b> · <b>${window.fmtSize(blob.size)}</b>`);
    window.downloadBlob(blob, name);
    window.toast('已下载 ' + window.fmtSize(blob.size));
    return blob;
  }

  /* ======================= PDF 读取：对象模型 + 流解码 ======================= */
  function pname(o) { return o == null ? '' : String(o).replace(/^\//, ''); }
  function pnum(o) { return o && o.asNumber ? o.asNumber() : (typeof o === 'number' ? o : 0); }
  function dicGet(P, ctx, dict, key) {
    if (!dict || !dict.get) return null;
    const v = dict.get(P.PDFName.of(key));
    if (v == null) return null;
    return (v instanceof P.PDFRef) ? ctx.lookup(v) : v;
  }
  function isStream(o) { return o && (typeof o.getContents === 'function' || (o.dict && o.contents !== undefined)); }

  async function inflateBytes(u8, raw) {
    const one = async fmt => {
      const ds = new DecompressionStream(fmt);
      const s = new Blob([u8]).stream().pipeThrough(ds);
      return new Uint8Array(await new Response(s).arrayBuffer());
    };
    try { return await one(raw ? 'deflate-raw' : 'deflate'); }
    catch (e) { return await one(raw ? 'deflate' : 'deflate-raw'); }
  }
  function asciiHex(u8) {
    let s = latin1(u8).replace(/[^0-9a-fA-F>]/g, '');
    s = s.split('>')[0];
    const n = Math.floor(s.length / 2);
    const o = new Uint8Array(n);
    for (let i = 0; i < n; i++) o[i] = parseInt(s.substr(i * 2, 2), 16) || 0;
    return o;
  }
  function ascii85(u8) {
    const s = latin1(u8).replace(/\s+/g, '').replace(/^<~/, '').replace(/~>$/, '');
    const out = []; let i = 0;
    while (i < s.length) {
      if (s[i] === 'z') { out.push(0, 0, 0, 0); i++; continue; }
      const chunk = s.substr(i, 5); i += 5;
      const pad = 5 - chunk.length;
      let v = 0;
      for (let k = 0; k < 5; k++) v = v * 85 + (k < chunk.length ? chunk.charCodeAt(k) - 33 : 84);
      const b = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
      for (let k = 0; k < 4 - pad; k++) out.push(b[k]);
    }
    return new Uint8Array(out);
  }
  function runLength(u8) {
    const out = []; let i = 0;
    while (i < u8.length) {
      const l = u8[i++];
      if (l === 128) break;
      if (l < 128) { for (let k = 0; k < l + 1 && i < u8.length; k++) out.push(u8[i++]); }
      else { const b = u8[i++]; for (let k = 0; k < 257 - l; k++) out.push(b); }
    }
    return new Uint8Array(out);
  }
  function lzwDecode(u8, early) {
    const out = []; let dict = [], bitbuf = 0, bitcnt = 0, codeLen = 9, prev = null, i = 0;
    const reset = () => { dict = []; for (let k = 0; k < 256; k++) dict.push([k]); dict.push(null); dict.push(null); codeLen = 9; prev = null; };
    reset();
    const nextCode = () => { while (bitcnt < codeLen && i < u8.length) { bitbuf = (bitbuf << 8) | u8[i++]; bitcnt += 8; } if (bitcnt < codeLen) return -1; const c = (bitbuf >> (bitcnt - codeLen)) & ((1 << codeLen) - 1); bitcnt -= codeLen; return c; };
    while (true) {
      const code = nextCode(); if (code < 0) break;
      if (code === 256) { reset(); continue; }
      if (code === 257) break;
      let entry;
      if (code < dict.length && dict[code]) entry = dict[code];
      else if (prev) entry = prev.concat(prev[0]);
      else break;
      for (const b of entry) out.push(b);
      if (prev) { dict.push(prev.concat(entry[0])); if (dict.length + (early ? 1 : 0) >= (1 << codeLen) && codeLen < 12) codeLen++; }
      prev = entry;
    }
    return new Uint8Array(out);
  }
  /* PNG / TIFF predictor */
  function predictor(data, predictorN, colors, bpc, columns) {
    if (!predictorN || predictorN < 2) return data;
    const bpp = Math.max(1, Math.ceil(colors * bpc / 8));
    const rowLen = Math.ceil(colors * bpc / 8) * columns;
    if (predictorN === 2) { // TIFF
      const out = new Uint8Array(data);
      for (let y = 0; y < Math.floor(out.length / rowLen); y++) {
        const off = y * rowLen;
        for (let x = bpp; x < rowLen; x++) out[off + x] = (out[off + x] + out[off + x - bpp]) & 255;
      }
      return out;
    }
    // PNG predictors
    const out = new Uint8Array(columns * bpp * Math.floor(data.length / (rowLen + 1)));
    const rows = Math.floor(data.length / (rowLen + 1));
    let prev = new Uint8Array(rowLen);
    let p = 0;
    for (let y = 0; y < rows; y++) {
      const ft = data[p++];
      const row = data.subarray(p, p + rowLen); p += rowLen;
      const cur = new Uint8Array(rowLen);
      for (let x = 0; x < rowLen; x++) {
        const a = x >= bpp ? cur[x - bpp] : 0;
        const b = prev[x];
        const c = x >= bpp ? prev[x - bpp] : 0;
        let v = row[x];
        if (ft === 1) v = (v + a) & 255;
        else if (ft === 2) v = (v + b) & 255;
        else if (ft === 3) v = (v + ((a + b) >> 1)) & 255;
        else if (ft === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); v = (v + pr) & 255; }
        cur[x] = v;
      }
      out.set(cur, y * rowLen); prev = cur;
    }
    return out;
  }
  /* 解码一个 stream 对象 → Uint8Array（应用所有 Filter） */
  async function decodeStream(P, ctx, stream) {
    const dict = stream.dict || stream;
    let raw;
    try { raw = stream.getContents ? stream.getContents() : stream.contents; } catch (e) { raw = new Uint8Array(0); }
    if (!raw) return new Uint8Array(0);
    let data = (raw instanceof Uint8Array) ? raw : new Uint8Array(raw);
    let filters = dicGet(P, ctx, dict, 'Filter');
    let parms = dicGet(P, ctx, dict, 'DecodeParms');
    let fArr = [];
    if (filters) {
      if (filters.asArray) fArr = filters.asArray();
      else if (filters instanceof P.PDFArray) fArr = filters.asArray();
      else fArr = [filters];
    }
    let pArr = [];
    if (parms) {
      if (parms.asArray) pArr = parms.asArray();
      else pArr = [parms];
    }
    let kind = '';
    for (let i = 0; i < fArr.length; i++) {
      const f = pname(fArr[i]);
      const pp = pArr[i] ? ctx.lookup(pArr[i]) : null;
      if (f === 'FlateDecode' || f === 'Fl') {
        data = await inflateBytes(data, false);
        const pn = pp ? pnum(dicGet(P, ctx, pp, 'Predictor')) : 0;
        if (pn >= 2) data = predictor(data, pn, pnum(dicGet(P, ctx, pp, 'Colors')) || 1, pnum(dicGet(P, ctx, pp, 'BitsPerComponent')) || 8, pnum(dicGet(P, ctx, pp, 'Columns')) || 1);
      } else if (f === 'ASCIIHexDecode' || f === 'AHx') data = asciiHex(data);
      else if (f === 'ASCII85Decode' || f === 'A85') data = ascii85(data);
      else if (f === 'RunLengthDecode' || f === 'RL') data = runLength(data);
      else if (f === 'LZWDecode' || f === 'LZW') data = lzwDecode(data, 1);
      else if (f === 'DCTDecode' || f === 'DCT') kind = 'jpeg';
      else if (f === 'JPXDecode') kind = 'jp2';
      else if (f === 'CCITTFaxDecode' || f === 'CCF') kind = 'ccitt';
      else if (f === 'JBIG2Decode') kind = 'jbig2';
      else kind = 'unknown:' + f;
    }
    return Object.assign(data, { __kind: kind });
  }

  async function openPdf(file) {
    const P = await getPDFLib();
    let bytes;
    if (file instanceof Uint8Array) bytes = file;
    else if (file instanceof ArrayBuffer) bytes = new Uint8Array(file);
    else bytes = bufOf(await window.TUI.readBuf(file));
    const header = latin1(bytes.subarray(0, 16));
    if (!/^%PDF-/.test(header)) throw new Error('这不是一个 PDF 文件（缺少 %PDF- 头）');
    let doc;
    try {
      doc = await P.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    } catch (e) {
      throw new Error('无法解析该 PDF：' + e.message + '（若为加密文件，请先解除保护）');
    }
    return { P, doc, bytes, pages: doc.getPages() };
  }
  function pageSize(page) { const mb = page.getMediaBox(); return { w: mb.width, h: mb.height }; }
  function pageRotation(page) { try { return ((page.getRotation().angle % 360) + 360) % 360; } catch (e) { return 0; } }

  /* ======================= 内容流解析 ======================= */
  function lexContent(bytes) {
    const s = latin1(bytes);
    const out = []; let i = 0; const n = s.length;
    const isWS = c => c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\f' || c === '\u0000';
    const isDelim = c => '()<>[]{}/%'.indexOf(c) >= 0;
    const isNumStart = c => (c >= '0' && c <= '9') || c === '-' || c === '+' || c === '.';
    while (i < n) {
      const c = s[i];
      if (isWS(c)) { i++; continue; }
      if (c === '%') { while (i < n && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
      if (c === '/') { i++; const st = i; while (i < n && !isWS(s[i]) && !isDelim(s[i])) i++; out.push({ t: 'name', v: s.slice(st, i) }); continue; }
      if (c === '(') {
        i++; let depth = 1, str = '';
        while (i < n && depth > 0) {
          const ch = s[i];
          if (ch === '\\') {
            i++; const e = s[i];
            if (e === 'n') str += '\n'; else if (e === 'r') str += '\r'; else if (e === 't') str += '\t';
            else if (e === 'b') str += '\b'; else if (e === 'f') str += '\f';
            else if (e === 'r') str += '\r';
            else if (e >= '0' && e <= '7') { let oct = ''; let k = 0; while (k < 3 && s[i] >= '0' && s[i] <= '7') { oct += s[i]; i++; k++; } i--; str += String.fromCharCode(parseInt(oct, 8) & 255); }
            else if (e === '\n') { /* line continuation */ }
            else if (e === '\r') { if (s[i + 1] === '\n') i++; }
            else str += e;
            i++; continue;
          }
          if (ch === '(') depth++;
          if (ch === ')') { depth--; if (depth === 0) { i++; break; } }
          str += ch; i++;
        }
        out.push({ t: 'str', v: str }); continue;
      }
      if (c === '<') {
        if (s[i + 1] === '<') { out.push({ t: 'dictopen' }); i += 2; continue; }
        i++; const st = i; while (i < n && s[i] !== '>') i++;
        out.push({ t: 'hex', v: s.slice(st, i).replace(/[^0-9a-fA-F]/g, '') }); i++; continue;
      }
      if (c === '>') { if (s[i + 1] === '>') { out.push({ t: 'dictclose' }); i += 2; continue; } i++; continue; }
      if (c === '[') { out.push({ t: 'arropen' }); i++; continue; }
      if (c === ']') { out.push({ t: 'arrclose' }); i++; continue; }
      if (c === '{' || c === '}') { i++; continue; }
      if (isNumStart(c)) { const st = i; i++; while (i < n && /[0-9.eE+\-]/.test(s[i])) i++; const v = parseFloat(s.slice(st, i)); out.push({ t: 'num', v: isNaN(v) ? 0 : v }); continue; }
      const st = i; while (i < n && !isWS(s[i]) && !isDelim(s[i])) i++;
      if (i > st) out.push({ t: 'op', v: s.slice(st, i) });
    }
    return out;
  }
  function parseContent(bytes) {
    const toks = lexContent(bytes);
    const events = []; let args = []; let i = 0;
    function obj() {
      const t = toks[i];
      if (!t) return null;
      if (t.t === 'arropen') { i++; const a = []; while (i < toks.length && toks[i].t !== 'arrclose') a.push(obj()); i++; return a; }
      if (t.t === 'dictopen') { i++; const d = {}; while (i < toks.length && toks[i].t !== 'dictclose') { const k = toks[i].t === 'name' ? toks[i].v : String(toks[i].v); i++; d[k] = obj(); } i++; return d; }
      i++;
      if (t.t === 'num') return t.v;
      if (t.t === 'name') return { n: t.v };
      if (t.t === 'str') return { s: t.v };
      if (t.t === 'hex') return { h: t.v };
      return null;
    }
    while (i < toks.length) {
      if (toks[i].t === 'op') { events.push({ op: toks[i].v, args }); args = []; i++; }
      else args.push(obj());
    }
    return events;
  }
  function hexToStr(hex) {
    let out = '';
    for (let i = 0; i + 1 < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    if (hex.length % 2) out += String.fromCharCode(parseInt(hex[hex.length - 1] + '0', 16));
    return out;
  }
  function argStr(a) { if (a == null) return ''; if (a.s != null) return a.s; if (a.h != null) return hexToStr(a.h); return ''; }

  /* ======================= 字体 / 编码 ======================= */
  const CP1252 = {
    0x80: '\u20AC', 0x82: '\u201A', 0x83: '\u0192', 0x84: '\u201E', 0x85: '\u2026', 0x86: '\u2020', 0x87: '\u2021',
    0x88: '\u02C6', 0x89: '\u2030', 0x8A: '\u0160', 0x8B: '\u2039', 0x8C: '\u0152', 0x8E: '\u017D',
    0x91: '\u2018', 0x92: '\u2019', 0x93: '\u201C', 0x94: '\u201D', 0x95: '\u2022', 0x96: '\u2013', 0x97: '\u2014',
    0x98: '\u02DC', 0x99: '\u2122', 0x9A: '\u0161', 0x9B: '\u203A', 0x9C: '\u0153', 0x9E: '\u017E', 0x9F: '\u0178'
  };
  function winAnsi(code) { if (code >= 0x80 && code <= 0x9F) return CP1252[code] || ''; return String.fromCharCode(code); }
  function parseToUnicode(u8) {
    const txt = latin1(u8);
    const map = new Map();
    const hexToUni = hex => {
      let out = '';
      const clean = hex.replace(/\s+/g, '');
      for (let i = 0; i + 3 < clean.length + 1 && i + 4 <= clean.length; i += 4) out += String.fromCharCode(parseInt(clean.substr(i, 4), 16));
      if (!out && clean.length === 2) out = String.fromCharCode(parseInt(clean, 16));
      return out;
    };
    let m;
    const reChar = /beginbfchar([\s\S]*?)endbfchar/g;
    while ((m = reChar.exec(txt))) {
      const body = m[1]; const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g; let mm;
      while ((mm = re.exec(body))) map.set(parseInt(mm[1], 16), hexToUni(mm[2]));
    }
    const reRange = /beginbfrange([\s\S]*?)endbfrange/g;
    while ((m = reRange.exec(txt))) {
      const body = m[1];
      const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<([0-9A-Fa-f]*)>|\[([\s\S]*?)\])/g; let mm;
      while ((mm = re.exec(body))) {
        const lo = parseInt(mm[1], 16), hi = parseInt(mm[2], 16);
        if (mm[4] != null) {
          const start = parseInt(mm[4], 16) || 0;
          for (let c = lo; c <= hi && c - lo < 65536; c++) map.set(c, String.fromCharCode(start + (c - lo)));
        } else {
          const arr = (mm[5] || '').match(/<([0-9A-Fa-f]*)>/g) || [];
          arr.forEach((h, k) => map.set(lo + k, hexToUni(h.replace(/[<>]/g, ''))));
        }
      }
    }
    return map;
  }
  function guessCssFont(baseFont, descriptor) {
    const b = String(baseFont || '');
    let family = /Courier|Consol|Mono/i.test(b) ? 'mono' : (/Times|Serif|Georgia|Garamond|Book/i.test(b) ? 'serif' : 'sans');
    const bold = /Bold|Black|Heavy|Semibold|Demi/i.test(b);
    const italic = /Italic|Oblique/i.test(b);
    return { family, bold, italic };
  }
  function pageFonts(P, ctx, page) {
    const fonts = new Map();
    const res = page.node.Resources ? page.node.Resources() : null;
    const fd = dicGet(P, ctx, res, 'Font');
    if (!fd || !fd.entries) return fonts;
    for (const [k, v] of fd.entries()) {
      const f = ctx.lookup(v);
      if (!f || !f.get) continue;
      const subtype = pname(dicGet(P, ctx, f, 'Subtype'));
      const base = pname(dicGet(P, ctx, f, 'BaseFont'));
      const enc = dicGet(P, ctx, f, 'Encoding');
      let toUni = null;
      const tu = dicGet(P, ctx, f, 'ToUnicode');
      if (tu && isStream(tu)) { /* 延迟解码 */ }
      const twoByte = subtype === 'Type0';
      fonts.set(k, { subtype, base, enc, twoByte, toUniRef: tu ? v : null, _tu: null, css: guessCssFont(base) });
    }
    return fonts;
  }
  async function ensureToUnicode(P, ctx, font) {
    if (font._tu !== null) return font._tu;
    font._tu = null;
    if (font.toUniRef) {
      const f = ctx.lookup(font.toUniRef);
      const fd = dicGet(P, ctx, f, 'ToUnicode');
      if (fd && isStream(fd)) { try { font._tu = parseToUnicode(await decodeStream(P, ctx, fd)); } catch (e) { font._tu = null; } }
    }
    return font._tu;
  }
  function decodeShow(P, font, str) {
    let out = '';
    if (font && font.twoByte) {
      for (let i = 0; i + 1 < str.length; i += 2) {
        const code = (str.charCodeAt(i) << 8) | str.charCodeAt(i + 1);
        if (font._tu && font._tu.has(code)) out += font._tu.get(code);
        else if (font._tu && font._tu.has(code & 255)) out += font._tu.get(code & 255);
        else out += '?';
      }
      return out;
    }
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i) & 255;
      if (font && font._tu && font._tu.has(code)) out += font._tu.get(code);
      else out += winAnsi(code);
    }
    return out;
  }

  /* ======================= 文本抽取 ======================= */
  function mul(m1, m2) {
    return [
      m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
    ];
  }
  function applyM(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }

  async function pageContentBytes(P, ctx, page) {
    const c = dicGet(P, ctx, page.node, 'Contents');
    if (!c) return new Uint8Array(0);
    const parts = [];
    const list = c.asArray ? c.asArray() : (c instanceof P.PDFArray ? c.asArray() : [c]);
    for (const item of list) {
      const s = ctx.lookup(item);
      if (s && isStream(s)) parts.push(await decodeStream(P, ctx, s));
    }
    if (parts.length === 1) return parts[0];
    const total = parts.reduce((a, b) => a + b.length, 0) + parts.length;
    const o = new Uint8Array(total); let p = 0;
    for (const b of parts) { o.set(b, p); p += b.length; o[p++] = 10; }
    return o;
  }

  async function extractPageItems(P, ctx, page) {
    const fonts = pageFonts(P, ctx, page);
    const bytes = await pageContentBytes(P, ctx, page);
    const events = parseContent(bytes);
    const items = [];
    let cur = null, fname = null, fsize = 12;
    let tm = [1, 0, 0, 1, 0, 0], tlm = tm, leading = 0, charSp = 0, wordSp = 0, hscale = 1, rise = 0;
    const usedFonts = new Set();
    async function show(a) {
      const font = fname ? fonts.get(fname) : null;
      if (font) { await ensureToUnicode(P, ctx, font); usedFonts.add(fname); }
      let str = '';
      if (Array.isArray(a)) { for (const el of a) { if (el == null) continue; if (typeof el === 'number') { if (el < -120) str += ' '; continue; } str += decodeShow(P, font, argStr(el)); } }
      else str = decodeShow(P, font, argStr(a));
      if (!str) return;
      const p = applyM(tm, 0, rise);
      items.push({ str, x: p[0], y: p[1], size: Math.abs(fsize * (tm[3] || 1)) || fsize, font: font ? font.base : '' });
    }
    for (const ev of events) {
      const a = ev.args;
      switch (ev.op) {
        case 'BT': tm = [1, 0, 0, 1, 0, 0]; tlm = tm.slice(); break;
        case 'Tf': fname = a[0] && a[0].n; fsize = +a[1] || 12; break;
        case 'Td': tlm = mul(tlm, [1, 0, 0, 1, +a[0] || 0, +a[1] || 0]); tm = tlm.slice(); break;
        case 'TD': leading = -(+a[1] || 0); tlm = mul(tlm, [1, 0, 0, 1, +a[0] || 0, +a[1] || 0]); tm = tlm.slice(); break;
        case 'Tm': tlm = [+a[0] || 0, +a[1] || 0, +a[2] || 0, +a[3] || 0, +a[4] || 0, +a[5] || 0]; tm = tlm.slice(); break;
        case 'T*': tlm = mul(tlm, [1, 0, 0, 1, 0, -leading]); tm = tlm.slice(); break;
        case 'TL': leading = +a[0] || 0; break;
        case 'Tc': charSp = +a[0] || 0; break;
        case 'Tw': wordSp = +a[0] || 0; break;
        case 'Tz': hscale = (+a[0] || 100) / 100; break;
        case 'Ts': rise = +a[0] || 0; break;
        case 'Tj': await show(a[0]); break;
        case 'TJ': await show(a[0]); break;
        case "'": tlm = mul(tlm, [1, 0, 0, 1, 0, -leading]); tm = tlm.slice(); await show(a[0]); break;
        case '"': tlm = mul(tlm, [1, 0, 0, 1, 0, -leading]); tm = tlm.slice(); await show(a[2]); break;
        default: break;
      }
      void cur; void charSp; void wordSp; void hscale;
    }
    return { items, fonts: [...usedFonts], allFonts: [...fonts.keys()] };
  }
  /* 把 items 按行分组 → 文本 */
  function itemsToText(items) {
    if (!items.length) return '';
    const sorted = items.slice().sort((a, b) => (b.y - a.y) || (a.x - b.x));
    const lines = [];
    let cur = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const it = sorted[i];
      const ref = cur[cur.length - 1];
      if (Math.abs(it.y - ref.y) <= Math.max(2, (ref.size || 10) * 0.5)) cur.push(it);
      else { lines.push(cur); cur = [it]; }
    }
    lines.push(cur);
    return lines.map(ln => ln.sort((a, b) => a.x - b.x).reduce((acc, it, idx) => {
      if (idx === 0) return it.str;
      const prev = ln[idx - 1];
      const gap = it.x - prev.x;
      const needSpace = gap > (it.size || 10) * 0.22 && !/\s$/.test(acc) && !/^\s/.test(it.str);
      return acc + (needSpace ? ' ' : '') + it.str;
    }, '')).join('\n');
  }
  async function extractAllText(bytes) {
    const { P, doc } = await openPdf(bytes);
    const ctx = doc.context;
    const pages = doc.getPages();
    const out = [];
    for (let i = 0; i < pages.length; i++) {
      const r = await extractPageItems(P, ctx, pages[i]);
      out.push(itemsToText(r.items));
      if (i % 8 === 7) await sleep(0);
    }
    return out;
  }

  /* ======================= 页面渲染（本地近似） ======================= */
  async function xobjImage(P, ctx, stream, cache) {
    const dict = stream.dict || stream;
    const w = pnum(dicGet(P, ctx, dict, 'Width')), h = pnum(dicGet(P, ctx, dict, 'Height'));
    const bpc = pnum(dicGet(P, ctx, dict, 'BitsPerComponent')) || 8;
    const csRaw = dicGet(P, ctx, dict, 'ColorSpace');
    let cs = '';
    if (csRaw) cs = Array.isArray(csRaw) ? '' : pname(csRaw);
    if (Array.isArray(csRaw)) cs = pname(csRaw[0]);
    const data = await decodeStream(P, ctx, stream);
    const kind = data.__kind;
    if (kind === 'jpeg') {
      try { const bmp = await createImageBitmap(new Blob([data], { type: 'image/jpeg' })); return { img: bmp, w, h }; } catch (e) { return null; }
    }
    if (kind) return null; // jp2/ccitt/jbig2 不支持
    // 原始位图 → ImageData
    let components = 1;
    if (cs === 'DeviceRGB' || cs === 'RGB' || cs === 'CalRGB') components = 3;
    else if (cs === 'DeviceCMYK' || cs === 'CMYK') components = 4;
    else if (cs === 'Indexed' || cs === 'I') return null;
    const c = canvasOf(w, h);
    const cx = c.getContext('2d');
    const img = cx.createImageData(w, h);
    const d = img.data;
    if (bpc === 8) {
      if (components === 1) for (let i = 0; i < w * h; i++) { const v = data[i] || 0; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
      else if (components === 3) for (let i = 0; i < w * h; i++) { d[i * 4] = data[i * 3] || 0; d[i * 4 + 1] = data[i * 3 + 1] || 0; d[i * 4 + 2] = data[i * 3 + 2] || 0; d[i * 4 + 3] = 255; }
      else if (components === 4) for (let i = 0; i < w * h; i++) { const cc = data[i * 4] / 255, m = data[i * 4 + 1] / 255, yy = data[i * 4 + 2] / 255, k = data[i * 4 + 3] / 255; d[i * 4] = 255 * (1 - Math.min(1, cc + k)); d[i * 4 + 1] = 255 * (1 - Math.min(1, m + k)); d[i * 4 + 2] = 255 * (1 - Math.min(1, yy + k)); d[i * 4 + 3] = 255; }
    } else if (bpc === 1) {
      const rowLen = Math.ceil(w / 8);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const bit = (data[y * rowLen + (x >> 3)] >> (7 - (x & 7))) & 1; const v = bit ? 255 : 0; const i = y * w + x; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
    } else return null;
    cx.putImageData(img, 0, 0);
    const bmp = await createImageBitmap(c);
    void cache;
    return { img: bmp, w, h };
  }

  async function renderPageToCanvas(P, doc, page, scale) {
    const ctx = doc.context;
    const sz = pageSize(page);
    const rot = pageRotation(page);
    const swap = rot === 90 || rot === 270;
    const outW = Math.round((swap ? sz.h : sz.w) * scale);
    const outH = Math.round((swap ? sz.w : sz.h) * scale);
    const canvas = canvasOf(outW, outH);
    const g = canvas.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, outW, outH);
    // base: PDF user space → canvas device
    let base;
    if (rot === 0) base = [scale, 0, 0, -scale, 0, sz.h * scale];
    else if (rot === 90) base = [0, scale, scale, 0, 0, 0];
    else if (rot === 180) base = [-scale, 0, 0, scale, sz.w * scale, 0];
    else base = [0, -scale, -scale, 0, sz.h * scale, sz.w * scale];

    const fonts = pageFonts(P, ctx, page);
    const res = page.node.Resources ? page.node.Resources() : null;
    const xobjDict = dicGet(P, ctx, res, 'XObject');
    const imgCache = new Map();
    const bytes = await pageContentBytes(P, ctx, page);
    const events = parseContent(bytes);

    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    let fill = '#000000', stroke = '#000000', lw = 1, alpha = 1;
    let path = [];
    let pendingClip = false;
    let tm = [1, 0, 0, 1, 0, 0], tlm = tm, fsize = 12, leading = 0, fname = null, hscale = 1, rise = 0, charSp = 0, wordSp = 0;
    const compose = m => mul(base, m);
    const dev = (x, y) => applyM(compose(ctm), x, y);

    function devPath(p) { return p.map(seg => seg.map((v, i) => (i % 2 === 0) ? v : v)); }
    void devPath;

    function cmyk(c, m, y, k) { return { r: 255 * (1 - Math.min(1, c + k)) / 255, g: 255 * (1 - Math.min(1, m + k)) / 255, b: 255 * (1 - Math.min(1, y + k)) / 255 }; }
    function css(rgb) { return `rgb(${Math.round(rgb.r * 255)},${Math.round(rgb.g * 255)},${Math.round(rgb.b * 255)})`; }

    function buildPath() {
      g.beginPath();
      for (const sub of path) {
        let last = null;
        for (const s of sub) {
          if (s.t === 'm') { const p = dev(s.p[0], s.p[1]); g.moveTo(p[0], p[1]); last = p; }
          else if (s.t === 'l') { const p = dev(s.p[0], s.p[1]); g.lineTo(p[0], p[1]); last = p; }
          else if (s.t === 'c') { const p1 = dev(s.p[0], s.p[1]), p2 = dev(s.p[2], s.p[3]), p3 = dev(s.p[4], s.p[5]); g.bezierCurveTo(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]); last = p3; }
          else if (s.t === 'rect') { const p1 = dev(s.p[0], s.p[1]), p2 = dev(s.p[0] + s.p[2], s.p[1] + s.p[3]); g.rect(Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1]), Math.abs(p2[0] - p1[0]), Math.abs(p2[1] - p1[1])); }
        }
        void last;
      }
    }
    function paint(op) {
      g.save();
      g.globalAlpha = alpha;
      buildPath();
      const doFill = /f|F|B|b/.test(op) && !(op === 'S' || op === 's');
      const doStroke = /S|s|B|b/.test(op) || op === 'S';
      const evenOdd = /\*/.test(op);
      if (op === 'n') { if (pendingClip) g.clip(evenOdd ? 'evenodd' : 'nonzero'); g.restore(); return; }
      if (pendingClip) g.clip(evenOdd ? 'evenodd' : 'nonzero');
      if (/f|F|B|b/.test(op)) { g.fillStyle = fill; g.fill(evenOdd ? 'evenodd' : 'nonzero'); }
      if (/S|s|B|b/.test(op)) { g.strokeStyle = stroke; g.lineWidth = Math.max(0.2, Math.abs(lw) * scale); g.stroke(); }
      void doFill; void doStroke;
      g.restore();
    }
    async function drawText(showStr) {
      const font = fname ? fonts.get(fname) : null;
      if (font) await ensureToUnicode(P, ctx, font);
      const uni = decodeShow(P, font, showStr);
      if (!uni) return;
      const m = compose(mul(ctm, tm));
      g.save();
      g.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
      const fam = (font && font.css) ? FAMILY[font.css.family] : FAMILY.sans;
      const bold = font && font.css && font.css.bold;
      const italic = font && font.css && font.css.italic;
      g.font = `${italic ? 'italic ' : ''}${bold ? '700' : '400'} ${fsize}px ${fam}`;
      g.fillStyle = fill;
      g.globalAlpha = alpha;
      g.textBaseline = 'alphabetic';
      g.fillText(uni, 0, 0);
      g.restore();
      const w = g.measureText ? 0 : 0;
      void w;
      // 推进文本矩阵：用估算宽度
      _mx.font = `${fsize}px ${fam}`;
      const adv = (_mx.measureText(uni).width / fsize) * fsize * hscale + charSp * uni.length + wordSp * (uni.match(/ /g) || []).length;
      tm = mul(tm, [1, 0, 0, 1, adv, 0]);
    }
    function showArr(a) {
      const strs = [];
      if (Array.isArray(a)) for (const el of a) { if (el == null) continue; if (typeof el === 'number') { if (el < -120) strs.push(' '); continue; } strs.push(argStr(el)); }
      else strs.push(argStr(a));
      return strs;
    }
    async function doOp(ev) {
      const a = ev.args;
      switch (ev.op) {
        case 'q': stack.push({ ctm: ctm.slice(), fill, stroke, lw, alpha }); break;
        case 'Q': { const s = stack.pop(); if (s) { ctm = s.ctm; fill = s.fill; stroke = s.stroke; lw = s.lw; alpha = s.alpha; } break; }
        case 'cm': ctm = mul(ctm, [+a[0] || 0, +a[1] || 0, +a[2] || 0, +a[3] || 0, +a[4] || 0, +a[5] || 0]); break;
        case 'w': lw = +a[0] || 1; break;
        case 'gs': { const gd = ctx.lookup(a[0]); if (gd) { const ca = dicGet(P, ctx, gd, 'ca'), CA = dicGet(P, ctx, gd, 'CA'); if (ca) alpha = pnum(ca); else if (CA) alpha = pnum(CA); } break; }
        case 'g': { const v = +a[0] || 0; fill = `rgb(${v * 255},${v * 255},${v * 255})`; break; }
        case 'G': { const v = +a[0] || 0; stroke = `rgb(${v * 255},${v * 255},${v * 255})`; break; }
        case 'rg': fill = css({ r: +a[0] || 0, g: +a[1] || 0, b: +a[2] || 0 }); break;
        case 'RG': stroke = css({ r: +a[0] || 0, g: +a[1] || 0, b: +a[2] || 0 }); break;
        case 'k': fill = css(cmyk(+a[0] || 0, +a[1] || 0, +a[2] || 0, +a[3] || 0)); break;
        case 'K': stroke = css(cmyk(+a[0] || 0, +a[1] || 0, +a[2] || 0, +a[3] || 0)); break;
        case 'm': path.push([{ t: 'm', p: [+a[0] || 0, +a[1] || 0] }]); break;
        case 'l': { if (!path.length) path.push([]); path[path.length - 1].push({ t: 'l', p: [+a[0] || 0, +a[1] || 0] }); break; }
        case 'c': { if (!path.length) path.push([]); path[path.length - 1].push({ t: 'c', p: [+a[0] || 0, +a[1] || 0, +a[2] || 0, +a[3] || 0, +a[4] || 0, +a[5] || 0] }); break; }
        case 'v': case 'y': { if (!path.length) path.push([]); const last = path[path.length - 1].filter(s => s.t === 'm' || s.t === 'l' || s.t === 'c').pop(); const lp = last ? (last.t === 'c' ? [last.p[4], last.p[5]] : last.p) : [0, 0]; path[path.length - 1].push({ t: 'c', p: [lp[0], lp[1], +a[0] || 0, +a[1] || 0, +a[2] || 0, +a[3] || 0] }); break; }
        case 'h': { if (path.length) { const sub = path[path.length - 1]; const first = sub.find(s => s.t === 'm'); if (first) sub.push({ t: 'l', p: [first.p[0], first.p[1]] }); } break; }
        case 're': path.push([{ t: 'rect', p: [+a[0] || 0, +a[1] || 0, +a[2] || 0, +a[3] || 0] }]); break;
        case 'W': case 'W*': pendingClip = true; break;
        case 'f': case 'F': case 'f*': case 'B': case 'B*': case 'b': case 'b*': case 'S': case 's': case 'n':
          paint(ev.op); path = []; pendingClip = false; break;
        case 'BT': tm = [1, 0, 0, 1, 0, 0]; tlm = tm.slice(); break;
        case 'ET': break;
        case 'Tf': fname = a[0] && a[0].n; fsize = +a[1] || 12; break;
        case 'Td': tlm = mul(tlm, [1, 0, 0, 1, +a[0] || 0, +a[1] || 0]); tm = tlm.slice(); break;
        case 'TD': leading = -(+a[1] || 0); tlm = mul(tlm, [1, 0, 0, 1, +a[0] || 0, +a[1] || 0]); tm = tlm.slice(); break;
        case 'Tm': tlm = [+a[0] || 0, +a[1] || 0, +a[2] || 0, +a[3] || 0, +a[4] || 0, +a[5] || 0]; tm = tlm.slice(); break;
        case 'T*': tlm = mul(tlm, [1, 0, 0, 1, 0, -leading]); tm = tlm.slice(); break;
        case 'TL': leading = +a[0] || 0; break;
        case 'Tz': hscale = (+a[0] || 100) / 100; break;
        case 'Ts': rise = +a[0] || 0; break;
        case 'Tc': charSp = +a[0] || 0; break;
        case 'Tw': wordSp = +a[0] || 0; break;
        case 'Tj': { const parts = showArr(a[0]); for (const p of parts) await drawText(p); break; }
        case 'TJ': { const arr = Array.isArray(a[0]) ? a[0] : []; for (const el of arr) { if (typeof el === 'number') { if (el <= -120) { tm = mul(tm, [1, 0, 0, 1, (-el / 1000) * fsize * hscale, 0]); } continue; } await drawText(argStr(el)); } break; }
        case "'": tlm = mul(tlm, [1, 0, 0, 1, 0, -leading]); tm = tlm.slice(); { const parts = showArr(a[0]); for (const p of parts) await drawText(p); } break;
        case '"': tlm = mul(tlm, [1, 0, 0, 1, 0, -leading]); tm = tlm.slice(); { const parts = showArr(a[2]); for (const p of parts) await drawText(p); } break;
        case 'Do': {
          const xname = a[0] && a[0].n;
          if (!xname || !xobjDict) break;
          const xo = ctx.lookup(xobjDict.get(P.PDFName.of(xname)));
          if (!xo || !xo.dict) break;
          const sub = pname(dicGet(P, ctx, xo.dict, 'Subtype'));
          if (sub === 'Image') {
            let rec = imgCache.get(xname);
            if (rec === undefined) { try { rec = await xobjImage(P, ctx, xo, imgCache); } catch (e) { rec = null; } imgCache.set(xname, rec); }
            if (!rec) {
              const iw = pnum(dicGet(P, ctx, xo.dict, 'Width')), ih = pnum(dicGet(P, ctx, xo.dict, 'Height'));
              if (iw && ih) { g.save(); g.setTransform(1, 0, 0, 1, 0, 0); const p = dev(0, 1), p2 = dev(1, 0); g.fillStyle = '#cccccc'; g.fillRect(Math.min(p[0], p2[0]), Math.min(p[1], p2[1]), Math.abs(p2[0] - p[0]), Math.abs(p2[1] - p[1])); g.restore(); }
              break;
            }
            const m = compose(ctm);
            const iw = rec.w || 1, ih = rec.h || 1;
            const im = mul(m, [1 / iw, 0, 0, -1 / ih, 0, 1]);
            g.save();
            g.setTransform(im[0], im[1], im[2], im[3], im[4], im[5]);
            g.globalAlpha = alpha;
            try { g.drawImage(rec.img, 0, 0); } catch (e) { }
            g.restore();
          } else if (sub === 'Form') {
            const mtx = dicGet(P, ctx, xo.dict, 'Matrix');
            let fm = [1, 0, 0, 1, 0, 0];
            if (mtx && mtx.asArray) { const mm = mtx.asArray().map(pnum); fm = [mm[0], mm[1], mm[2], mm[3], mm[4], mm[5]]; }
            const saved = ctm;
            ctm = mul(ctm, fm);
            const inner = parseContent(await decodeStream(P, ctx, xo));
            for (const e2 of inner) await doOp(e2);
            ctm = saved;
          }
          break;
        }
        default: break;
      }
    }
    let n = 0;
    for (const ev of events) {
      await doOp(ev);
      if ((++n) % 400 === 0) await sleep(0);
    }
    return canvas;
  }

  /* ======================= 通用解析：CSV / TSV ======================= */
  function detectDelim(text) {
    const head = text.split(/\r?\n/).slice(0, 5).join('\n');
    const cand = [',', '\t', ';', '|'];
    let best = ',', bestN = -1;
    for (const d of cand) { const n = head.split(d).length; if (n > bestN) { bestN = n; best = d; } }
    return bestN <= 1 ? ',' : best;
  }
  function parseCSV(text, delim) {
    text = String(text).replace(/^\uFEFF/, '');
    delim = delim || detectDelim(text);
    const rows = []; let row = []; let cur = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else {
        if (c === '"') q = true;
        else if (c === delim) { row.push(cur); cur = ''; }
        else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
        else if (c === '\r') { }
        else cur += c;
      }
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    while (rows.length && rows[rows.length - 1].every(v => v === '')) rows.pop();
    return rows;
  }
  function csvStringify(rows) {
    return rows.map(r => r.map(v => {
      v = v == null ? '' : String(v);
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    }).join(',')).join('\r\n');
  }

  /* ======================= 通用解析：Markdown ======================= */
  function parseMarkdown(md) {
    const blocks = [];
    const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
    let i = 0;
    const inline = s => String(s);
    while (i < lines.length) {
      let ln = lines[i];
      if (/^\s*$/.test(ln)) { i++; continue; }
      let m;
      if ((m = ln.match(/^(#{1,6})\s+(.*)$/))) { blocks.push({ t: 'h', level: m[1].length, text: inline(m[2]) }); i++; continue; }
      if (/^\s*([-*_])\s*\1\s*\1[\s-*_]*$/.test(ln)) { blocks.push({ t: 'hr' }); i++; continue; }
      if (/^\s*```/.test(ln)) { const lang = ln.replace(/^\s*```/, '').trim(); i++; const buf = []; while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]); i++; blocks.push({ t: 'code', lang, text: buf.join('\n') }); continue; }
      if (/^\s*>/.test(ln)) { const buf = []; while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, '')); blocks.push({ t: 'quote', text: buf.join('\n') }); continue; }
      if (/^\s*([-*+]|\d+[.)])\s+/.test(ln)) {
        const ordered = /^\s*\d+[.)]\s+/.test(ln); const items = [];
        while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '')); i++; }
        blocks.push({ t: 'list', ordered, items }); continue;
      }
      if (/\|/.test(ln) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
        const head = ln.split('|').map(s => s.trim()).filter((v, idx, a) => !(idx === 0 && v === '') && !(idx === a.length - 1 && v === ''));
        i += 2; const rows = [];
        while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== '') { rows.push(lines[i].split('|').map(s => s.trim()).filter((v, idx, a) => !(idx === 0 && v === '') && !(idx === a.length - 1 && v === ''))); i++; }
        blocks.push({ t: 'table', head, rows }); continue;
      }
      const buf = [ln]; i++;
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6}\s|>\s|\s*```|\s*([-*+]|\d+[.)])\s)/.test(lines[i])) buf.push(lines[i++]);
      blocks.push({ t: 'p', text: buf.join('\n') });
    }
    return blocks;
  }
  function stripInline(s) {
    return String(s)
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/~~([^~]+)~~/g, '$1');
  }

  /* ======================= 通用解析：HTML → 结构 ======================= */
  function htmlToText(html) {
    let s = String(html);
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    s = s.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '');
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/<\/(p|div|section|article|li|tr|h[1-6])>/gi, '\n');
    s = s.replace(/<h([1-6])[^>]*>/gi, (m, n) => '\n' + '#'.repeat(+n) + ' ');
    s = s.replace(/<li[^>]*>/gi, '\n- ');
    s = s.replace(/<\/t[dh]>/gi, ' | ');
    s = s.replace(/<tr[^>]*>/gi, '\n| ');
    s = s.replace(/<t[dh][^>]*>/gi, '');
    s = s.replace(/<[^>]+>/g, '');
    const ent = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&mdash;': '—', '&ndash;': '–', '&hellip;': '…', '&copy;': '©' };
    s = s.replace(/&[a-z#0-9]+;/gi, m => ent[m.toLowerCase()] || (m.match(/^&#(\d+);$/) ? String.fromCharCode(+m.slice(2, -1)) : (m.match(/^&#x([0-9a-f]+);$/i) ? String.fromCharCode(parseInt(m.slice(3, -1), 16)) : m)));
    return s.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
  }

  /* ======================= 通用：CSV → Excel(.xls) ======================= */
  function csvToXlsHtml(rows, title) {
    const e = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>' + e(title || 'Sheet1') + '</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head><body><table border="1">' +
      rows.map(r => '<tr>' + r.map(c => {
        const isNum = /^-?[\d,]*\.?\d+$/.test(String(c).trim()) && String(c).trim() !== '';
        return isNum ? `<td style="mso-number-format:'\\#\\,\\#\\#0\\.00'">${e(c)}</td>` : `<td>${e(c)}</td>`;
      }).join('') + '</tr>').join('') + '</table></body></html>';
  }
  function csvToSpreadsheetML(rows, title) {
    const e = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let xml = '<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="' + e(title || 'Sheet1') + '"><Table>';
    for (const r of rows) {
      xml += '<Row>';
      for (const c of r) {
        const v = String(c == null ? '' : c);
        const isNum = /^-?\d+(\.\d+)?$/.test(v.trim());
        xml += `<Cell><Data ss:Type="${isNum ? 'Number' : 'String'}">${e(v)}</Data></Cell>`;
      }
      xml += '</Row>';
    }
    return xml + '</Table></Worksheet></Workbook>';
  }

  /* ======================= 通用：ZIP 读取（docx） ======================= */
  async function zipRead(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    // 找 EOCD
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 zip/docx（找不到中央目录）');
    const count = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);
    const files = new Map();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      const method = dv.getUint16(off + 10, true);
      const csize = dv.getUint32(off + 20, true);
      const usize = dv.getUint32(off + 24, true);
      const nameLen = dv.getUint16(off + 28, true);
      const extraLen = dv.getUint16(off + 30, true);
      const cmtLen = dv.getUint16(off + 32, true);
      const lho = dv.getUint32(off + 42, true);
      const name = latin1(u8.subarray(off + 46, off + 46 + nameLen));
      files.set(name, { method, csize, usize, lho });
      off += 46 + nameLen + extraLen + cmtLen;
    }
    return {
      list: () => [...files.keys()],
      read: async name => {
        const f = files.get(name); if (!f) return null;
        const lo = f.lho;
        if (dv.getUint32(lo, true) !== 0x04034b50) throw new Error('zip 局部头损坏');
        const nLen = dv.getUint16(lo + 26, true), eLen = dv.getUint16(lo + 28, true);
        const start = lo + 30 + nLen + eLen;
        const comp = u8.subarray(start, start + f.csize);
        if (f.method === 0) return comp;
        if (f.method === 8) return await inflateBytes(comp, true);
        throw new Error('不支持的 zip 压缩方式：' + f.method);
      }
    };
  }

  function docxParagraphs(xml) {
    const paras = [];
    const pRe = /<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g;
    const list = xml.match(pRe) || [];
    for (const p of list) {
      let txt = '';
      const tRe = /<w:t[^>]*>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g;
      let m;
      while ((m = tRe.exec(p))) {
        if (m[0] === '<w:tab/>') txt += '\t';
        else if (m[0] === '<w:br/>') txt += '\n';
        else txt += (m[1] || '');
      }
      txt = txt.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
      const style = (p.match(/<w:pStyle w:val="([^"]+)"/) || [])[1] || '';
      paras.push({ text: txt, style });
    }
    return paras;
  }
  async function readDocxText(file) {
    const u8 = bufOf(await window.TUI.readBuf(file));
    const zip = await zipRead(u8);
    const xml = await zip.read('word/document.xml');
    if (!xml) throw new Error('docx 结构异常：缺少 word/document.xml');
    return { paras: docxParagraphs(latin1(xml)), zip };
  }

  /* ======================= 通用：DXF ======================= */
  function parseDXF(text) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    const ents = []; let cur = null;
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const code = parseInt(lines[i].trim(), 10);
      const val = lines[i + 1] === undefined ? '' : lines[i + 1].trim();
      if (isNaN(code)) continue;
      if (code === 0) {
        if (cur && cur.type) ents.push(cur);
        cur = { type: val, pts: [], nums: {} };
      } else if (cur) {
        /* 10/20 = 起点或顶点，11/21 = 终点；同时按“点”记录，也按“数值”记录，
           这样 LINE(10/20/11/21)、CIRCLE/ARC(圆心 10/20 + 半径 40)、LWPOLYLINE(多组 10/20) 都能取到。 */
        if (code === 10 || code === 20 || code === 11 || code === 21) cur.pts.push({ code, v: parseFloat(val) });
        cur.nums[code] = val;
      }
    }
    if (cur && cur.type) ents.push(cur);
    // 整理
    const out = [];
    for (const e of ents) {
      const t = e.type;
      const at = c => { const p = e.pts.find(q => q.code === c); return p ? p.v : NaN; };
      if (t === 'LINE') {
        const x1 = at(10), y1 = at(20), x2 = at(11), y2 = at(21);
        if (isFinite(x1) && isFinite(x2)) out.push({ t: 'line', x1, y1, x2, y2 });
      } else if (t === 'CIRCLE' || t === 'ARC') {
        const cx = parseFloat(e.nums[10]), cy = parseFloat(e.nums[20]), r = parseFloat(e.nums[40]);
        if (isFinite(cx) && isFinite(cy) && isFinite(r)) out.push({ t: t === 'ARC' ? 'arc' : 'circle', cx, cy, r, a1: parseFloat(e.nums[50] || '0'), a2: parseFloat(e.nums[51] || (t === 'ARC' ? '0' : '360')) });
      } else if (t === 'LWPOLYLINE' || t === 'POLYLINE') {
        const xs = e.pts.filter(p => p.code === 10).map(p => p.v), ys = e.pts.filter(p => p.code === 20).map(p => p.v);
        const closed = (parseInt(e.nums[70] || '0', 10) & 1) === 1;
        if (xs.length) out.push({ t: 'poly', pts: xs.map((x, k) => [x, ys[k] || 0]), closed });
      } else if (t === 'ELLIPSE') {
        const cx = parseFloat(e.nums[10]), cy = parseFloat(e.nums[20]);
        if (isFinite(cx)) out.push({ t: 'circle', cx, cy, r: 0, skip: true });
      }
    }
    return out;
  }

  /* ======================= 通用：DICOM ======================= */
  const DICOM_TAGS = {
    '00080060': 'Modality', '00080070': 'Manufacturer', '00080080': 'InstitutionName',
    '00080020': 'StudyDate', '00081030': 'StudyDescription', '00080018': 'SOPInstanceUID',
    '00100010': 'PatientName', '00100020': 'PatientID', '00100030': 'PatientBirthDate',
    '00100040': 'PatientSex', '00280010': 'Rows', '00280011': 'Columns', '00280100': 'BitsAllocated',
    '00280101': 'BitsStored', '00280102': 'HighBit', '00280002': 'SamplesPerPixel',
    '00280004': 'PhotometricInterpretation', '00280103': 'PixelRepresentation',
    '00281050': 'WindowCenter', '00281051': 'WindowWidth', '00281052': 'RescaleIntercept',
    '00281053': 'RescaleSlope', '7FE00010': 'PixelData', '00020010': 'TransferSyntaxUID'
  };
  function parseDicom(u8) {
    if (u8.length < 132) throw new Error('文件太小，不是有效的 DICOM');
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const magic = latin1(u8.subarray(128, 132));
    if (magic !== 'DICM') throw new Error('缺少 DICM 魔数，可能不是 DICOM 文件（无 preamble 的裸数据集暂不支持）');
    let pos = 132;
    let explicit = true, little = true;
    const elems = [];
    const tags = new Map();
    function readTag() {
      if (pos + 8 > u8.length) return false;
      const g = dv.getUint16(pos, little), el = dv.getUint16(pos + 2, little);
      const tag = (g.toString(16).padStart(4, '0') + el.toString(16).padStart(4, '0')).toUpperCase();
      let vr, len, hlen;
      if (explicit) {
        vr = latin1(u8.subarray(pos + 4, pos + 6));
        const upper = vr.toUpperCase();
        const longVR = ['OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'SQ', 'UC', 'UN', 'UR', 'UT'].indexOf(upper) >= 0;
        if (longVR) { hlen = 12; len = dv.getUint32(pos + 8, little); }
        else { hlen = 8; len = dv.getUint16(pos + 6, little); }
        if (!/^[A-Z]{2}$/.test(vr)) { explicit = false; vr = ''; hlen = 8; len = dv.getUint32(pos + 4, little); }
      } else {
        hlen = 8; len = dv.getUint32(pos + 4, little); vr = '';
      }
      const valStart = pos + hlen;
      let val = null;
      if (len !== 0xFFFFFFFF && valStart + len <= u8.length) val = u8.subarray(valStart, valStart + len);
      const rec = { tag, group: g, element: el, vr, len, valStart, val, start: pos, hlen };
      elems.push(rec);
      if (!tags.has(tag) || tag === '7FE00010') tags.set(tag, rec);
      if (tag === '00020010' && val) { const ts = latin1(val).replace(/[\0 ]+$/g, '').trim(); little = !/1\.2\.840\.10008\.1\.2\.2$/.test(ts); }
      pos = (len === 0xFFFFFFFF) ? u8.length : valStart + len;
      return true;
    }
    // 先按显式 VR 读文件头（组 0002 总是显式 LE）
    explicit = true; little = true;
    let guard = 0;
    while (pos + 8 <= u8.length && guard++ < 200000) {
      const g = dv.getUint16(pos, true);
      if (g !== 0x0002) break;
      readTag();
      if (pos > u8.length) break;
    }
    // 依据传输语法切换
    explicit = true;
    // 若已读 TransferSyntaxUID 决定隐式/显式
    const tsRec = tags.get('00020010');
    let tsUID = '';
    if (tsRec && tsRec.val) tsUID = latin1(tsRec.val).replace(/[\0 ]+$/g, '').trim();
    if (/^1\.2\.840\.10008\.1\.2$/.test(tsUID)) explicit = false;              // Implicit VR LE
    else if (/^1\.2\.840\.10008\.1\.2\.1$/.test(tsUID)) explicit = true;       // Explicit VR LE
    else if (/^1\.2\.840\.10008\.1\.2\.2$/.test(tsUID)) { explicit = true; little = false; }
    const uncompressed = !tsUID || /^1\.2\.840\.10008\.1\.2(\.1|\.2)?$/.test(tsUID);
    const compressed = !uncompressed;
    guard = 0;
    while (pos + 8 <= u8.length && guard++ < 400000) { if (!readTag()) break; }
    return { elems, tags, little, explicit, tsUID, compressed, u8, dv };
  }
  function dcmNum(ds, tag, def) {
    const r = ds.tags.get(tag); if (!r || !r.val) return def;
    try {
      if (r.len === 2) return ds.little ? ds.dv.getUint16(r.valStart, true) : ds.dv.getUint16(r.valStart, false);
      if (r.len === 4) return ds.little ? ds.dv.getUint32(r.valStart, true) : ds.dv.getUint32(r.valStart, false);
      const s = latin1(r.val).replace(/\0/g, '').split('\\')[0];
      const v = parseFloat(s); return isNaN(v) ? def : v;
    } catch (e) { return def; }
  }
  function dcmStr(ds, tag) {
    const r = ds.tags.get(tag); if (!r || !r.val) return '';
    return latin1(r.val).replace(/\0/g, '').trim();
  }
  function dicomInfo(ds) {
    const info = {};
    for (const tag of Object.keys(DICOM_TAGS)) {
      const r = ds.tags.get(tag);
      if (!r) continue;
      const nm = DICOM_TAGS[tag];
      if (tag === '7FE00010') continue;
      if (['00280010', '00280011', '00280100', '00280002', '00280103'].indexOf(tag) >= 0) info[nm] = dcmNum(ds, tag, 0);
      else if (['00281050', '00281051', '00281052', '00281053'].indexOf(tag) >= 0) info[nm] = dcmNum(ds, tag, NaN);
      else info[nm] = dcmStr(ds, tag);
    }
    return info;
  }
  function renderDicom(ds, wc, ww) {
    const rows = dcmNum(ds, '00280010', 0), cols = dcmNum(ds, '00280011', 0);
    const bits = dcmNum(ds, '00280100', 16), spp = dcmNum(ds, '00280002', 1);
    const photo = (dcmStr(ds, '00280004') || 'MONOCHROME2').toUpperCase();
    const pixRep = dcmNum(ds, '00280103', 0);
    const rec = ds.tags.get('7FE00010');
    if (!rows || !cols) throw new Error('缺少 Rows/Columns，无法渲染');
    if (!rec || !rec.val) throw new Error('缺少 PixelData');
    if (ds.compressed) throw new Error('不支持的传输语法（' + (ds.tsUID || '未知') + '）：像素数据为压缩格式（如 JPEG/JPEG2000），本工具仅支持未压缩传输语法。');
    const slope = dcmNum(ds, '00281053', 1) || 1;
    const intercept = dcmNum(ds, '00281052', 0);
    let wcV = isFinite(wc) ? wc : dcmNum(ds, '00281050', NaN);
    let wwV = isFinite(ww) ? ww : dcmNum(ds, '00281051', NaN);
    const bytes = rec.val;
    const pxCount = rows * cols * spp;
    const canvas = canvasOf(cols, rows);
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(cols, rows);
    const d = img.data;
    const getVal = (i) => {
      if (bits <= 8) return bytes[i] || 0;
      const off = i * 2;
      const v = ds.little ? (bytes[off] | (bytes[off + 1] << 8)) : ((bytes[off] << 8) | bytes[off + 1]);
      return pixRep === 1 ? (v << 16 >> 16) : v;
    };
    let minv = Infinity, maxv = -Infinity;
    const nPix = bits <= 8 ? Math.min(pxCount, bytes.length) : Math.min(pxCount, Math.floor(bytes.length / 2));
    for (let i = 0; i < nPix; i++) { const v = getVal(i) * slope + intercept; if (v < minv) minv = v; if (v > maxv) maxv = v; }
    if (!isFinite(wcV)) wcV = (minv + maxv) / 2;
    if (!isFinite(wwV) || wwV <= 0) wwV = Math.max(1, maxv - minv);
    const applyWL = (v) => {
      let x = (v - (wcV - 0.5)) / (wwV - 1) + 0.5;
      x = clamp(x, 0, 1);
      if (photo === 'MONOCHROME1') x = 1 - x;
      return Math.round(x * 255);
    };
    for (let i = 0; i < rows * cols; i++) {
      const o = i * 4;
      if (spp >= 3) {
        d[o] = getVal(i * spp); d[o + 1] = getVal(i * spp + 1); d[o + 2] = getVal(i * spp + 2); d[o + 3] = 255;
      } else {
        const v = applyWL(getVal(i) * slope + intercept);
        d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return { canvas, rows, cols, minv, maxv, wc: wcV, ww: wwV, bits, spp, photo };
  }
  const ANON_TAGS = ['00100010', '00100020', '00100030', '00100040', '00080080', '00080070', '00080020', '00081030', '00101000', '00102154', '00080050'];
  function anonymizeDicom(ds) {
    const out = [];
    const dv = ds.dv;
    // 重写：保留元素顺序，改为显式 VR 小端
    const parts = [];
    for (const e of ds.elems) {
      const tagBytes = new Uint8Array(4);
      new DataView(tagBytes.buffer).setUint16(0, e.group, true);
      new DataView(tagBytes.buffer).setUint16(2, e.element, true);
      let vr = e.vr && /^[A-Z]{2}$/.test(e.vr) ? e.vr : 'UN';
      let val = e.val;
      if (ANON_TAGS.indexOf(e.tag) >= 0) {
        val = new Uint8Array(0);
        if (e.tag === '00100010') val = utf8('ANONYMOUS');
      }
      if (e.tag === '00020010') val = utf8('1.2.840.10008.1.2.1');
      const longVR = ['OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'SQ', 'UC', 'UN', 'UR', 'UT'].indexOf(vr) >= 0;
      const head = longVR ? new Uint8Array(12) : new Uint8Array(8);
      const hv = new DataView(head.buffer);
      hv.setUint16(0, e.group, true); hv.setUint16(2, e.element, true);
      if (longVR) { head[4] = vr.charCodeAt(0); head[5] = vr.charCodeAt(1); head[6] = 0; head[7] = 0; hv.setUint32(8, val ? val.length : 0, true); }
      else { head[4] = vr.charCodeAt(0); head[5] = vr.charCodeAt(1); hv.setUint16(6, val ? val.length : 0, true); }
      parts.push(head);
      if (val && val.length) parts.push(val);
      void out; void dv;
    }
    let half = true;
    const pre = new Uint8Array(128);
    const body = concatU8(parts);
    const magic = utf8('DICM');
    return concatU8([pre, magic, body]);
  }

  /* ======================= 通用：扫描件矫正（边缘检测 + 透视） ======================= */
  function grayOf(canvas) {
    const w = canvas.width, h = canvas.height;
    const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    const g = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    return { g, w, h };
  }
  function boxBlur(g, w, h, r) {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      let sum = 0, cnt = 0;
      for (let x = -r; x <= r; x++) { const xx = clamp(x, 0, w - 1); sum += g[y * w + xx]; cnt++; }
      for (let x = 0; x < w; x++) {
        out[y * w + x] = sum / cnt;
        const add = clamp(x + r + 1, 0, w - 1), rem = clamp(x - r, 0, w - 1);
        sum += g[y * w + add] - g[y * w + rem];
      }
    }
    return out;
  }
  function sobel(g, w, h) {
    const m = new Float32Array(w * h); let max = 1;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1] + g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1];
      const gy = -g[i - w - 1] - 2 * g[i - w] - g[i - w + 1] + g[i + w - 1] + 2 * g[i + w] + g[i + w + 1];
      const v = Math.sqrt(gx * gx + gy * gy); m[i] = v; if (v > max) max = v;
    }
    for (let i = 0; i < m.length; i++) m[i] /= max;
    return m;
  }
  function findQuad(mag, w, h) {
    const th = 0.28;
    let pTL = null, pTR = null, pBR = null, pBL = null;
    let sTL = Infinity, sTR = -Infinity, sBR = -Infinity, sBL = Infinity;
    for (let y = 1; y < h - 1; y += 2) for (let x = 1; x < w - 1; x += 2) {
      if (mag[y * w + x] < th) continue;
      const s1 = x + y, s2 = x - y;
      if (s1 < sTL) { sTL = s1; pTL = [x, y]; }
      if (s2 > sTR) { sTR = s2; pTR = [x, y]; }
      if (s1 > sBR) { sBR = s1; pBR = [x, y]; }
      if (s2 < sBL) { sBL = s2; pBL = [x, y]; }
    }
    if (!pTL || !pTR || !pBR || !pBL) return null;
    return [pTL, pTR, pBR, pBL];
  }
  function homography(src, dst) {
    // 求 8 参数投影变换 src->dst
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    // 高斯消元
    for (let c = 0; c < 8; c++) {
      let piv = c;
      for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      [A[c], A[piv]] = [A[piv], A[c]]; [b[c], b[piv]] = [b[piv], b[c]];
      const d = A[c][c] || 1e-9;
      for (let k = c; k < 8; k++) A[c][k] /= d; b[c] /= d;
      for (let r = 0; r < 8; r++) { if (r === c) continue; const f = A[r][c]; if (!f) continue; for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
    }
    return [b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], 1];
  }
  function perspectiveWarp(srcCanvas, quad, outW, outH) {
    const src = grayOf(srcCanvas);
    const H = homography(quad, [[0, 0], [outW, 0], [outW, outH], [0, outH]]);
    const sctx = srcCanvas.getContext('2d');
    const sd = sctx.getImageData(0, 0, srcCanvas.width, srcCanvas.height).data;
    const out = canvasOf(outW, outH);
    const octx = out.getContext('2d');
    const oimg = octx.createImageData(outW, outH);
    const od = oimg.data;
    for (let y = 0; y < outH; y++) for (let x = 0; x < outW; x++) {
      const d = H[6] * x + H[7] * y + H[8];
      const sx = (H[0] * x + H[1] * y + H[2]) / d;
      const sy = (H[3] * x + H[4] * y + H[5]) / d;
      const xi = clamp(Math.round(sx), 0, srcCanvas.width - 1), yi = clamp(Math.round(sy), 0, srcCanvas.height - 1);
      const si = (yi * srcCanvas.width + xi) * 4, oi = (y * outW + x) * 4;
      od[oi] = sd[si]; od[oi + 1] = sd[si + 1]; od[oi + 2] = sd[si + 2]; od[oi + 3] = 255;
    }
    octx.putImageData(oimg, 0, 0);
    return out;
  }
  function documentScan(srcCanvas, opt) {
    opt = opt || {};
    const small = canvasOf(500, Math.round(500 * srcCanvas.height / srcCanvas.width));
    small.getContext('2d').drawImage(srcCanvas, 0, 0, small.width, small.height);
    const { g, w, h } = grayOf(small);
    const blurred = boxBlur(g, w, h, 2);
    const mag = sobel(blurred, w, h);
    const q = findQuad(mag, w, h);
    const scale = srcCanvas.width / w;
    let quad = q ? q.map(p => [p[0] * scale, p[1] * scale]) : [[0, 0], [srcCanvas.width, 0], [srcCanvas.width, srcCanvas.height], [0, srcCanvas.height]];
    const dW = Math.round(Math.max(
      Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1]),
      Math.hypot(quad[2][0] - quad[3][0], quad[2][1] - quad[3][1])));
    const dH = Math.round(Math.max(
      Math.hypot(quad[3][0] - quad[0][0], quad[3][1] - quad[0][1]),
      Math.hypot(quad[2][0] - quad[1][0], quad[2][1] - quad[1][1])));
    const maxD = opt.max || 2200;
    let ow = dW, oh = dH;
    if (Math.max(ow, oh) > maxD) { const k = maxD / Math.max(ow, oh); ow = Math.round(ow * k); oh = Math.round(oh * k); }
    const warped = perspectiveWarp(srcCanvas, quad, Math.max(80, ow), Math.max(80, oh));
    // 增强：灰度 + 对比/阈值
    const cx = warped.getContext('2d');
    const id = cx.getImageData(0, 0, warped.width, warped.height); const d = id.data;
    const mode = opt.mode || 'gray';
    for (let i = 0; i < d.length; i += 4) {
      let v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (mode === 'bw') v = v > 150 ? 255 : (v > 110 ? 190 : 40);
      else if (mode === 'light') v = clamp(255 - (255 - v) * 0.85 + 18, 0, 255);
      else v = clamp(255 - (255 - v) * 0.9 + 10, 0, 255);
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
    cx.putImageData(id, 0, 0);
    return { canvas: warped, quad, detected: !!q, srcW: srcCanvas.width, srcH: srcCanvas.height };
  }

  /* ======================= 通用：行级 diff ======================= */
  function diffLines(aText, bText) {
    const a = String(aText).split('\n'), b = String(bText).split('\n');
    const n = a.length, m = b.length;
    if (n * m > 4e6) {
      // 太大：退化比对
      const out = [];
      const max = Math.max(n, m);
      for (let i = 0; i < max; i++) out.push({ t: a[i] === b[i] ? ' ' : '~', a: a[i], b: b[i], an: i + 1, bn: i + 1 });
      return out;
    }
    const dp = new Array(n + 1);
    for (let i = 0; i <= n; i++) dp[i] = new Int32Array(m + 1);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = []; let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { out.push({ t: ' ', v: a[i], an: i + 1, bn: j + 1 }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: '-', v: a[i], an: i + 1 }); i++; }
      else { out.push({ t: '+', v: b[j], bn: j + 1 }); j++; }
    }
    while (i < n) { out.push({ t: '-', v: a[i], an: i + 1 }); i++; }
    while (j < m) { out.push({ t: '+', v: b[j], bn: j + 1 }); j++; }
    return out;
  }

  /* ======================= 通用：账单/发票行抽取 ======================= */
  const MONEY_RE = /(?:[¥$€£]|USD|CNY|RMB|EUR|GBP|HKD|\bCR\b|\bDR\b)?\s?-?\(?\d{1,3}(?:[ ,]\d{3})*(?:[.,]\d{1,2})?\)?(?:\s?(?:CR|DR))?/;
  const DATE_RE = /(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{2,4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{2,4})/i;
  function normAmount(s) {
    if (s == null) return '';
    let t = String(s).trim().replace(/[¥$€£]/g, '').replace(/(USD|CNY|RMB|EUR|GBP|HKD)/gi, '').trim();
    let neg = /^\(.*\)$/.test(t) || /\bCR\b/i.test(t);
    t = t.replace(/[()]/g, '').replace(/\b(CR|DR)\b/gi, '').trim();
    if (/,\d{1,2}$/.test(t) && !/\./.test(t)) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
    t = t.replace(/\s+/g, '');
    const v = parseFloat(t);
    if (isNaN(v)) return '';
    return (neg ? -v : v).toFixed(2);
  }
  function extractTableRows(text, opt) {
    opt = opt || {};
    const lines = String(text).split('\n');
    const rows = [];
    let header = null;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i].replace(/\s+$/g, '');
      if (!ln.trim()) continue;
      if (!header && /date|日期|description|描述|amount|金额|balance|余额|withdrawal|deposit|debit|credit/i.test(ln)) { header = ln; rows.push({ type: 'header', raw: ln }); continue; }
      const dm = ln.match(DATE_RE);
      const money = ln.match(new RegExp(MONEY_RE.source, 'g')) || [];
      const nums = money.map(normAmount).filter(v => v !== '');
      if (dm && nums.length) {
        rows.push({ type: 'row', date: dm[0], amounts: nums, desc: ln.replace(dm[0], ' ').replace(MONEY_RE, ' ').replace(/\s{2,}/g, ' ').trim(), raw: ln });
      } else if (nums.length >= 2) {
        rows.push({ type: 'row', date: '', amounts: nums, desc: ln.replace(/\s{2,}/g, ' ').trim(), raw: ln });
      } else if (opt.keepUnmatched) {
        rows.push({ type: 'other', raw: ln });
      }
    }
    return { header, rows };
  }

  /* ======================= 自带 ZIP 写出（批量下载用） ======================= */
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  async function deflateRaw(u8) {
    const cs = new CompressionStream('deflate-raw');
    const s = new Blob([u8]).stream().pipeThrough(cs);
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  async function zipWrite(files) {
    const enc = new TextEncoder();
    const local = [], central = []; let offset = 0;
    for (const f of files) {
      const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
      const nameU8 = enc.encode(f.name);
      const crc = crc32(data);
      let comp = data, method = 0;
      try { const d = await deflateRaw(data); if (d.length < data.length) { comp = d; method = 8; } } catch (e) { }
      const lh = new Uint8Array(30 + nameU8.length); const dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0, true); dv.setUint16(8, method, true);
      dv.setUint32(14, crc, true); dv.setUint32(18, comp.length, true); dv.setUint32(22, data.length, true);
      dv.setUint16(26, nameU8.length, true); lh.set(nameU8, 30);
      local.push(lh, comp);
      const ch = new Uint8Array(46 + nameU8.length); const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(10, method, true); cv.setUint32(16, crc, true); cv.setUint32(20, comp.length, true); cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameU8.length, true); cv.setUint32(42, offset, true); ch.set(nameU8, 46);
      central.push(ch);
      offset += lh.length + comp.length;
    }
    const cd = concatU8(central);
    const eocd = new Uint8Array(22); const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, cd.length, true); ev.setUint32(16, offset, true);
    return concatU8([concatU8(local), cd, eocd]);
  }
  function downloadZip(files, name) {
    return zipWrite(files).then(z => { window.downloadBlob(new Blob([z], { type: 'application/zip' }), name || 'files.zip'); return z; });
  }

  /* ======================= PDF 文本贴图辅助（给已有页面写文字） ======================= */
  async function drawTextPng(pdf, page, text, o) {
    o = o || {};
    const st = { size: o.size || 10, bold: !!o.bold, color: o.color || '#000000', family: o.family || 'sans' };
    const c = lineCanvas(text, st);
    const img = await pdf.embedPng(c.toDataURL('image/png'));
    const w = c.width / SCALE, h = c.height / SCALE;
    let x = o.x || 0;
    if (o.align === 'center') x = (typeof o.cx === 'number' ? o.cx : (page.getWidth() / 2)) - w / 2;
    else if (o.align === 'right') x = (typeof o.cx === 'number' ? o.cx : page.getWidth()) - w;
    page.drawImage(img, { x, y: (o.y || 0) - (o.size || 10), width: w, height: h });
    return { w, h };
  }

  /* ======================= 由源文档页面构建新 PDF ======================= */
  async function loadSrc(P, file) {
    const bytes = bufOf(await window.TUI.readBuf(file));
    return { doc: await P.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }), bytes };
  }
  /* 从若干源文档抽取页面 → 新 PDF。spec: {doc, idx, rotate} */
  async function buildFrom(P, specs, opt) {
    opt = opt || {};
    const out = await P.PDFDocument.create();
    const embCache = new Map();
    for (const sp of specs) {
      const key = sp.doc.__id || (sp.doc.__id = Math.random().toString(36));
      let pages = embCache.get(key);
      if (!pages) { pages = await out.embedPages(sp.doc.getPages()); embCache.set(key, pages); }
      const page = out.addPage();
      const emb = pages[sp.idx];
      if (opt.size) page.setSize(opt.size[0], opt.size[1]);
      const box = emb.size ? emb.size() : { width: emb.width, height: emb.height };
      const pw = page.getWidth(), ph = page.getHeight();
      let w = box.width, h = box.height;
      if (opt.fit) { const k = Math.min(pw / w, ph / h); w *= k; h *= k; }
      const x = opt.x != null ? opt.x : (pw - w) / 2;
      const y = opt.y != null ? opt.y : (ph - h) / 2;
      const drawOpt = { x, y, width: w, height: h };
      if (sp.rotate) { const P2 = await getPDFLib(); drawOpt.rotate = P2.degrees(sp.rotate); }
      if (sp.size) { drawOpt.width = sp.size[0]; drawOpt.height = sp.size[1]; drawOpt.x = sp.x || 0; drawOpt.y = sp.y || 0; }
      page.drawPage(emb, drawOpt);
      if (sp.rotate) page.setRotation((await getPDFLib()).degrees(sp.rotate));
    }
    return out;
  }
  function rangeParse(str, maxN) {
    const out = [];
    for (const part of String(str).split(/[,\s]+/)) {
      if (!part) continue;
      const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) { let a = +m[1], b = +m[2]; if (a > b) { const t = a; a = b; b = t; } for (let i = a; i <= b; i++) if (i >= 1 && i <= maxN) out.push(i); }
      else if (/^\d+$/.test(part)) { const v = +part; if (v >= 1 && v <= maxN) out.push(v); }
    }
    return [...new Set(out)];
  }
  function slugBase(files, suffix, ext) {
    const base = (files && files[0] ? files[0].name : 'document').replace(/\.[^.]+$/, '');
    return base + '-' + suffix + '.' + (ext || 'pdf');
  }

  /* ---------- A. merge-pdf ---------- */
  function hMerge(host, cfg, slug) {
    const { stage, pane } = window.TUI.shell(host, true);
    const S = { files: [] };
    stage.innerHTML = window.TUI.drop(dropInner({ title: '添加 PDF 文件', hint: '拖入一个或多个 PDF，或点击选择；下方可拖动排序', icon: 'pdf', fmts: '<b>PDF</b> · 支持多选' }), '.pdf,application/pdf', true) + '<div id="mList" style="margin-top:14px"></div>';
    pane.innerHTML = window.TUI.head('合并 PDF', '按下面显示的顺序合并为一个 PDF。拖动手柄或用 ↑↓ 调整顺序。') +
      `<div id="mInfo" class="outbox">尚未添加文件</div>
       <button class="btn-lime btn-run" id="mGo">合并并下载</button>
       <div class="progress" id="tProg" style="display:none"><i></i></div>
       <div class="runnote">pdf-lib 在本地重排页面对象，不上传、不重编码图像。</div>`;
    function render() {
      const box = stage.querySelector('#mList');
      box.innerHTML = S.files.map((f, i) => `
        <div class="filebar" draggable="true" data-i="${i}" style="margin-bottom:8px;cursor:grab">
          <span><b>${esc(f.name)}</b> <span class="mini">${window.fmtSize(f.size)}</span></span>
          <span>
            <button class="btn-ghost btn-sm" data-up="${i}">↑</button>
            <button class="btn-ghost btn-sm" data-down="${i}">↓</button>
            <button class="btn-ghost btn-sm" data-del="${i}">移除</button>
          </span>
        </div>`).join('');
      pane.querySelector('#mInfo').innerHTML = S.files.length ? `${S.files.length} 个文件 · 共 ${window.fmtSize(S.files.reduce((a, f) => a + f.size, 0))}` : '尚未添加文件';
    }
    boxClick();
    function boxClick() {
      stage.addEventListener('click', e => {
        const up = e.target.closest('[data-up]'), dn = e.target.closest('[data-down]'), dl = e.target.closest('[data-del]');
        if (up) { const i = +up.dataset.up; if (i > 0) { [S.files[i - 1], S.files[i]] = [S.files[i], S.files[i - 1]]; render(); } }
        if (dn) { const i = +dn.dataset.down; if (i < S.files.length - 1) { [S.files[i + 1], S.files[i]] = [S.files[i], S.files[i + 1]]; render(); } }
        if (dl) { S.files.splice(+dl.dataset.del, 1); render(); }
      });
      let dragI = -1;
      stage.addEventListener('dragstart', e => { const r = e.target.closest('[data-i]'); if (r) dragI = +r.dataset.i; });
      stage.addEventListener('dragover', e => { if (e.target.closest('[data-i]')) e.preventDefault(); });
      stage.addEventListener('drop', e => {
        const r = e.target.closest('[data-i]');
        if (r && dragI >= 0) { e.preventDefault(); e.stopPropagation(); const to = +r.dataset.i; const [m] = S.files.splice(dragI, 1); S.files.splice(to, 0, m); dragI = -1; render(); }
      });
    }
    window.TUI.bindDrop(stage, '.pdf,application/pdf', true, list => {
      for (const f of list) if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') S.files.push(f);
      render();
      if (S.files.length) { stage.querySelector('#tDrop') && stage.querySelector('#tDrop').classList.add('hide'); }
    });
    pane.querySelector('#mGo').addEventListener('click', async () => {
      if (!S.files.length) { window.toast('请先添加 PDF 文件'); return; }
      const btn = pane.querySelector('#mGo'); btn.disabled = true; btn.textContent = '合并中…';
      try {
        const P = await getPDFLib();
        const out = await P.PDFDocument.create();
        let total = 0;
        for (let i = 0; i < S.files.length; i++) {
          const src = await P.PDFDocument.load(bufOf(await window.TUI.readBuf(S.files[i])), { ignoreEncryption: true, updateMetadata: false });
          const pages = await out.copyPages(src, src.getPageIndices());
          pages.forEach(p => { out.addPage(p); total++; });
          window.TUI.prog(pane.querySelector('#tProg'), (i + 1) / S.files.length * 90);
          await sleep(0);
        }
        const bytes = await out.save({ useObjectStreams: true });
        window.TUI.prog(pane.querySelector('#tProg'), 100);
        const blob = new Blob([bytes], { type: 'application/pdf' });
        pane.querySelector('#mInfo').innerHTML = `合并完成：<b>${total}</b> 页 · <b>${window.fmtSize(blob.size)}</b>`;
        window.downloadBlob(blob, slugBase(S.files, 'merged'));
        window.toast('已下载 ' + window.fmtSize(blob.size));
      } catch (e) { console.error(e); window.toast('合并失败：' + e.message); }
      btn.disabled = false; btn.textContent = '合并并下载';
    });
  }

  /* ---------- A. split-pdf ---------- */
  function hSplit(host, cfg, slug) {
    fileTask(host, {
      dropTitle: '选择一个 PDF', accept: '.pdf,application/pdf', runLabel: '拆分并下载',
      paneHtml: window.TUI.head('拆分 PDF', '按区间或按每 N 页切分成多个 PDF。') +
        window.TUI.field('拆分方式', window.TUI.sel('spMode', [{ v: 'every', t: '每 N 页切一个文件' }, { v: 'ranges', t: '按页区间（如 1-3,5,7-9）' }], 'every')) +
        `<div id="spEvery">${window.TUI.field('每份页数', window.TUI.input('spN', '1', '例如 2', 'number'))}</div>` +
        `<div id="spRanges" class="hide">${window.TUI.field('页区间', window.TUI.input('spR', '1-1', '例如 1-3,5,7-9'))}</div>`,
      note: '多份文件会打包成一个 ZIP 下载（自带 ZIP 写出，无第三方库）。',
      init: h => {
        h.el('#spMode').addEventListener('change', () => {
          const m = h.q('spMode'); h.el('#spEvery').classList.toggle('hide', m !== 'every'); h.el('#spRanges').classList.toggle('hide', m !== 'ranges');
        });
        h.el('#spRanges').classList.remove('hide'); h.el('#spEvery').classList.remove('hide');
      },
      run: async (S, h) => {
        if (!S.files.length) return window.toast('请先选择 PDF');
        h.busy(true);
        try {
          const P = await getPDFLib();
          const src = await P.PDFDocument.load(bufOf(await window.TUI.readBuf(S.files[0])), { ignoreEncryption: true, updateMetadata: false });
          const n = src.getPageCount();
          const mode = h.q('spMode');
          let groups = [];
          if (mode === 'every') {
            const k = Math.max(1, parseInt(h.q('spN'), 10) || 1);
            for (let i = 0; i < n; i += k) groups.push({ name: `pages-${i + 1}-${Math.min(n, i + k)}`, idx: Array.from({ length: Math.min(k, n - i) }, (_, j) => i + j) });
          } else {
            groups = rangeParse(h.q('spR'), n).map(pg => ({ name: 'page-' + pg, idx: [pg - 1] }));
            if (!groups.length) throw new Error('页区间无效');
          }
          const files = [];
          for (let g = 0; g < groups.length; g++) {
            const out = await P.PDFDocument.create();
            const pages = await out.copyPages(src, groups[g].idx);
            pages.forEach(p => out.addPage(p));
            const bytes = await out.save({ useObjectStreams: true });
            const base = slugBase(S.files, '').replace(/-\.pdf$/, '');
            files.push({ name: `${base}-${groups[g].name}.pdf`, data: bytes });
            h.prog((g + 1) / groups.length * 100);
            await sleep(0);
          }
          if (files.length === 1) {
            await outFile(S, h, files[0].data, files[0].name);
          } else {
            const z = await zipWrite(files);
            const nm = slugBase(S.files, 'split', 'zip');
            window.downloadBlob(new Blob([z], { type: 'application/zip' }), nm);
            h.out(`已生成 <b>${files.length}</b> 个 PDF，打包为 <b>${esc(nm)}</b> · <b>${window.fmtSize(z.length)}</b>`);
            window.toast('已下载 ' + window.fmtSize(z.length));
          }
        } catch (e) { console.error(e); window.toast('拆分失败：' + e.message); }
        h.busy(false);
      }
    });
  }

  /* ---------- A. rotate-pdf ---------- */
  function hRotate(host, cfg, slug) {
    fileTask(host, {
      dropTitle: '选择一个 PDF', accept: '.pdf,application/pdf', runLabel: '旋转并下载',
      onStage: async (list, h) => {
        h.showFiles(list);
        try {
          const P = await getPDFLib();
          const src = await P.PDFDocument.load(bufOf(await window.TUI.readBuf(list[0])), { ignoreEncryption: true });
          const p = src.getPages()[0];
          h.S.info = { n: src.getPageCount(), w: Math.round(p.getWidth()), h: Math.round(p.getHeight()) };
          h.out(`共 <b>${h.S.info.n}</b> 页 · 首页 ${h.S.info.w}×${h.S.info.h} pt`);
        } catch (e) { window.toast('读取失败：' + e.message); }
      },
      paneHtml: window.TUI.head('旋转页面', '可旋转全部页面，或只旋转指定页。') +
        window.TUI.field('旋转角度', window.TUI.sel('rtAngle', [{ v: '90', t: '顺时针 90°' }, { v: '180', t: '180°' }, { v: '270', t: '顺时针 270°（逆时针 90°）' }], '90')) +
        window.TUI.field('作用于', window.TUI.sel('rtScope', [{ v: 'all', t: '全部页面' }, { v: 'some', t: '指定页（如 1,3,5-7）' }], 'all')) +
        window.TUI.field('指定页', window.TUI.input('rtPages', '', '留空表示全部')),
      run: async (S, h) => {
        if (!S.files.length) return window.toast('请先选择 PDF');
        h.busy(true);
        try {
          const P = await getPDFLib();
          const doc = await P.PDFDocument.load(bufOf(await window.TUI.readBuf(S.files[0])), { ignoreEncryption: true, updateMetadata: false });
          const pages = doc.getPages();
          const angle = parseInt(h.q('rtAngle'), 10);
          const scope = h.q('rtScope');
          const set = scope === 'some' ? new Set(rangeParse(h.q('rtPages'), pages.length)) : null;
          let cnt = 0;
          pages.forEach((p, i) => {
            if (set && !set.has(i + 1)) return;
            const cur = ((p.getRotation().angle || 0) % 360 + 360) % 360;
            p.setRotation(P.degrees((cur + angle) % 360));
            cnt++;
          });
          const bytes = await doc.save({ useObjectStreams: true });
          await outFile(S, h, bytes, slugBase(S.files, 'rotated'));
          h.out(`已旋转 <b>${cnt}</b> 页（+${angle}°）· <b>${window.fmtSize(bytes.length)}</b>`);
        } catch (e) { console.error(e); window.toast('旋转失败：' + e.message); }
        h.busy(false);
      }
    });
  }

  /* 通用：N-up / 拼版 / 小册子 */
  function impositionTask(host, o) {
    fileTask(host, {
      dropTitle: o.dropTitle, accept: '.pdf,application/pdf', runLabel: '生成并下载',
      paneHtml: window.TUI.head(o.title, o.desc) + o.paneHtml,
      note: o.note,
      onStage: async (list, h) => {
        h.showFiles(list);
        try {
          const P = await getPDFLib();
          const d = await P.PDFDocument.load(bufOf(await window.TUI.readBuf(list[0])), { ignoreEncryption: true });
          h.out(`源文件共 <b>${d.getPageCount()}</b> 页`);
        } catch (e) { window.toast('读取失败：' + e.message); }
      },
      run: async (S, h) => {
        if (!S.files.length) return window.toast('请先选择 PDF');
        h.busy(true);
        try {
          const P = await getPDFLib();
          const src = await P.PDFDocument.load(bufOf(await window.TUI.readBuf(S.files[0])), { ignoreEncryption: true, updateMetadata: false });
          const out = await P.PDFDocument.create();
          const embedded = await out.embedPages(src.getPages());
          const n = src.getPageCount();
          const { cols, rows, order, pageSize, rotateAll } = o.plan(n, h);
          const first = src.getPages()[0].getSize();
          const slotW = pageSize[0] / cols, slotH = pageSize[1] / rows;
          const k = Math.min(slotW / first.width, slotH / first.height);
          const dw = first.width * k, dh = first.height * k;
          const seq = order; // 数组：每个「版」是 length=cols*rows 的页号数组（0 基，-1 空白）
          for (let s = 0; s < seq.length; s++) {
            const page = out.addPage([pageSize[0], pageSize[1]]);
            for (let cell = 0; cell < seq[s].length; cell++) {
              const pi = seq[s][cell];
              if (pi < 0 || pi >= n) continue;
              const c = cell % cols, r = Math.floor(cell / cols);
              const x = c * slotW + (slotW - dw) / 2;
              const y = pageSize[1] - (r + 1) * slotH + (slotH - dh) / 2;
              const op = { x, y, width: dw, height: dh };
              if (rotateAll) op.rotate = P.degrees(rotateAll);
              page.drawPage(embedded[pi], op);
            }
            h.prog((s + 1) / seq.length * 100);
            await sleep(0);
          }
          const bytes = await out.save({ useObjectStreams: true });
          await outFile(S, h, bytes, slugBase(S.files, o.suffix));
        } catch (e) { console.error(e); window.toast('生成失败：' + e.message); }
        h.busy(false);
      }
    });
  }

  function hNUp(host) {
    impositionTask(host, {
      title: 'N-up 拼版', desc: '把多页缩小拼到一页 A4 上。',
      dropTitle: '选择一个 PDF', suffix: 'nup',
      paneHtml: window.TUI.field('每页页数', window.TUI.sel('nuCells', [{ v: '2', t: '2 页 / 张（1×2）' }, { v: '4', t: '4 页 / 张（2×2）' }, { v: '6', t: '6 页 / 张（2×3）' }, { v: '9', t: '9 页 / 张（3×3）' }], '4')) +
        window.TUI.field('纸张方向', window.TUI.sel('nuOrient', [{ v: 'p', t: '纵向 A4' }, { v: 'l', t: '横向 A4' }], 'p')) +
        window.TUI.field('页面间距（pt）', window.TUI.input('nuGap', '0', '0', 'number')),
      note: '输出 A4；页序为阅读顺序（从左到右、从上到下）。',
      plan: (n, h) => {
        const cells = parseInt(h.q('nuCells'), 10) || 4;
        const cols = cells === 2 ? 1 : cells === 6 ? 2 : Math.sqrt(cells) | 0;
        const rows = cells / cols;
        const land = h.q('nuOrient') === 'l';
        const pageSize = land ? [A4[1], A4[0]] : [A4[0], A4[1]];
        const order = [];
        const per = cols * rows;
        for (let i = 0; i < n; i += per) { const s = []; for (let j = 0; j < per; j++) s.push(i + j < n ? i + j : -1); order.push(s); }
        return { cols, rows, order, pageSize, rotateAll: 0 };
      }
    });
  }

  function hBooklet(host) {
    impositionTask(host, {
      title: '骑马钉小册子', desc: '把页面重排成 2-up 小册子（一张纸两面，对折装订）。',
      dropTitle: '选择一个 PDF', suffix: 'booklet',
      paneHtml: window.TUI.field('纸张', window.TUI.sel('bkPaper', [{ v: 'l', t: '横向 A4（推荐）' }, { v: 'p', t: '纵向 A4' }], 'l')) +
        window.TUI.chk('bkRtl', '从右往左翻（竖排书）', false),
      note: '页数不是 4 的倍数会自动补空白页。按「正面→背面」顺序输出，双面打印后沿中线对折即成册。',
      plan: (n, h) => {
        const k = Math.ceil(n / 4) * 4;
        const sheets = k / 4;
        const land = h.q('bkPaper') === 'l';
        const pageSize = land ? [A4[1], A4[0]] : [A4[0], A4[1]];
        const order = [];
        for (let s = 0; s < sheets; s++) {
          const front = [k - 1 - 2 * s, 2 * s];
          const back = [2 * s + 1, k - 2 - 2 * s];
          order.push(h.el('#bkRtl') && h.el('#bkRtl').classList.contains('on') ? front.slice().reverse() : front);
          order.push(h.el('#bkRtl') && h.el('#bkRtl').classList.contains('on') ? back.slice().reverse() : back);
        }
        return { cols: 2, rows: 1, order, pageSize, rotateAll: 0 };
      }
    });
    const pane = host.querySelector('#tPane');
    pane.addEventListener('click', e => { const c = e.target.closest('.chk'); if (c) c.classList.toggle('on'); });
  }

  function hImposition(host) {
    impositionTask(host, {
      title: '自定义拼版', desc: '按 N×M 网格把页面拼到一张纸上。',
      dropTitle: '选择一个 PDF', suffix: 'imposed',
      paneHtml: `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>${window.TUI.field('列数', window.TUI.input('imCols', '2', '2', 'number'))}</div>
          <div>${window.TUI.field('行数', window.TUI.input('imRows', '3', '3', 'number'))}</div></div>` +
        window.TUI.field('纸张', window.TUI.sel('imPaper', [{ v: 'a4', t: 'A4' }, { v: 'a4l', t: 'A4 横向' }, { v: 'letter', t: 'Letter' }], 'a4')) +
        window.TUI.field('每张页序', window.TUI.sel('imFlow', [{ v: 'row', t: '横向优先（→↓）' }, { v: 'col', t: '纵向优先（↓→）' }], 'row')),
      note: '适用于标签、贴纸、多联票据拼版。',
      plan: (n, h) => {
        const cols = Math.max(1, parseInt(h.q('imCols'), 10) || 2);
        const rows = Math.max(1, parseInt(h.q('imRows'), 10) || 3);
        const paper = h.q('imPaper');
        const pageSize = paper === 'a4l' ? [A4[1], A4[0]] : paper === 'letter' ? LETTER.slice() : A4.slice();
        const per = cols * rows;
        const order = [];
        const flow = h.q('imFlow');
        for (let i = 0; i < n; i += per) {
          const base = [];
          for (let j = 0; j < per; j++) base.push(i + j < n ? i + j : -1);
          if (flow === 'col') { const out2 = new Array(per).fill(-1); for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) out2[r * cols + c] = base[c * rows + r]; order.push(out2); }
          else order.push(base);
        }
        return { cols, rows, order, pageSize, rotateAll: 0 };
      }
    });
  }

  /* ---------- A. add-page-numbers-to-pdf ---------- */
  function hPageNumbers(host) {
    fileTask(host, {
      dropTitle: '选择一个 PDF', accept: '.pdf,application/pdf', runLabel: '添加页码并下载',
      paneHtml: window.TUI.head('添加页码', '位置、起始页与格式都可自定义；中文页码通过 Canvas 贴图渲染。') +
        window.TUI.field('位置', window.TUI.sel('pnPos', [{ v: 'bc', t: '底部居中' }, { v: 'br', t: '右下角' }, { v: 'bl', t: '左下角' }, { v: 'tc', t: '顶部居中' }, { v: 'tr', t: '右上角' }], 'bc')) +
        window.TUI.field('格式（{X}=当前页，{Y}=总页数）', window.TUI.input('pnFmt', '第 {X} 页 / 共 {Y} 页', '如 {X} / {Y}')) +
        `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>${window.TUI.field('起始编号', window.TUI.input('pnStart', '1', '1', 'number'))}</div>
          <div>${window.TUI.field('字号', window.TUI.input('pnSize', '10', '10', 'number'))}</div></div>` +
        `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>${window.TUI.field('距边距', window.TUI.input('pnMargin', '28', '28', 'number'))}</div>
          <div>${window.TUI.field('颜色', window.TUI.input('pnColor', '#333333', '#333333', 'color'))}</div></div>` +
        window.TUI.field('字体', window.TUI.sel('pnFont', [{ v: 'sans', t: '无衬线' }, { v: 'serif', t: '衬线' }, { v: 'mono', t: '等宽' }], 'sans')) +
        window.TUI.chk('pnSkip1', '跳过第一页', false),
      init: h => { h.pane.addEventListener('click', e => { const c = e.target.closest('.chk'); if (c) c.classList.toggle('on'); }); },
      run: async (S, h) => {
        if (!S.files.length) return window.toast('请先选择 PDF');
        h.busy(true);
        try {
          const P = await getPDFLib();
          const doc = await P.PDFDocument.load(bufOf(await window.TUI.readBuf(S.files[0])), { ignoreEncryption: true, updateMetadata: false });
          const pages = doc.getPages();
          const total = pages.length;
          const pos = h.q('pnPos'), fmt = h.q('pnFmt') || '{X} / {Y}';
          const start = parseInt(h.q('pnStart'), 10) || 1;
          const size = parseInt(h.q('pnSize'), 10) || 10;
          const mg = parseInt(h.q('pnMargin'), 10) || 28;
          const color = h.q('pnColor') || '#333333';
          const family = h.q('pnFont') || 'sans';
          const skip1 = h.el('#pnSkip1').classList.contains('on');
          for (let i = 0; i < pages.length; i++) {
            if (skip1 && i === 0) continue;
            const p = pages[i];
            const label = fmt.replace(/\{X\}/g, i + start).replace(/\{Y\}/g, total);
            const pw = p.getWidth(), ph = p.getHeight();
            let x = pw / 2, y = 24, align = 'center';
            if (pos === 'bc') { x = pw / 2; y = mg; align = 'center'; }
            else if (pos === 'br') { x = pw - mg; y = mg; align = 'right'; }
            else if (pos === 'bl') { x = mg; y = mg; align = 'left'; }
            else if (pos === 'tc') { x = pw / 2; y = ph - mg - size; align = 'center'; }
            else if (pos === 'tr') { x = pw - mg; y = ph - mg - size; align = 'right'; }
            await drawTextPng(doc, p, label, { x, y, size, color, align, family });
            if (i % 10 === 9) await sleep(0);
            h.prog((i + 1) / pages.length * 100);
          }
          const bytes = await doc.save({ useObjectStreams: true });
          await outFile(S, h, bytes, slugBase(S.files, 'numbered'));
          h.out(`已为 <b>${total - (skip1 ? 1 : 0)}</b> 页添加页码 · <b>${window.fmtSize(bytes.length)}</b>`);
        } catch (e) { console.error(e); window.toast('失败：' + e.message); }
        h.busy(false);
      }
    });
  }

  /* ---------- A. unlock-pdf ---------- */
  function hUnlock(host) {
    fileTask(host, {
      dropTitle: '选择受保护的 PDF', accept: '.pdf,application/pdf', runLabel: '另存为无密码版本',
      note: '本工具仅移除权限密码/打开密码的“保护标记”，不保证对所有加密方式有效；仅用于你自己拥有权限的文件。',
      paneHtml: window.TUI.head('解锁 PDF', '用 pdf-lib 以 ignoreEncryption 读取后另存，得到无保护副本。') +
        window.TUI.field('打开密码（可选）', window.TUI.input('ulPwd', '', '多数权限保护不需要填写')) +
        `<div class="warnbox">说明：本工具只能处理 pdf-lib 能忽略的加密（常见为仅权限保护）。若文件用 AES 全文档加密，pdf-lib 无法解密，会提示失败——请改用你记得的密码在阅读器里导出。</div>`,
      run: async (S, h) => {
        if (!S.files.length) return window.toast('请先选择 PDF');
        h.busy(true);
        try {
          const P = await getPDFLib();
          const doc = await P.PDFDocument.load(bufOf(await window.TUI.readBuf(S.files[0])), { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
          const bytes = await doc.save({ useObjectStreams: true });
          await outFile(S, h, bytes, slugBase(S.files, 'unlocked'));
          h.out(`已另存为无保护副本 · <b>${window.fmtSize(bytes.length)}</b>（仅移除权限/打开密码标记）`);
        } catch (e) { console.error(e); window.toast('失败：' + e.message); }
        h.busy(false);
      }
    });
  }

  /* ---------- A. remove-metadata-from-pdf ---------- */
  function hRemoveMeta(host) {
    fileTask(host, {
      dropTitle: '选择一个 PDF', accept: '.pdf,application/pdf', runLabel: '清除元数据并下载',
      paneHtml: window.TUI.head('清除元数据', '清空 Title / Author / Subject / Keywords / Creator / Producer。') +
        window.TUI.chk('rmAll', '同时清空 XML 元数据流（XMP）', true) +
        `<div class="warnbox">清空后文件仍可正常阅读与打印；但文档可能仍保留字体名、创建程序版本等非身份信息。</div>`,
      init: h => { h.pane.addEventListener('click', e => { const c = e.target.closest('.chk'); if (c) c.classList.toggle('on'); }); },
      run: async (S, h) => {
        if (!S.files.length) return window.toast('请先选择 PDF');
        h.busy(true);
        try {
          const P = await getPDFLib();
          const doc = await P.PDFDocument.load(bufOf(await window.TUI.readBuf(S.files[0])), { ignoreEncryption: true, updateMetadata: false });
          doc.setTitle(''); doc.setAuthor(''); doc.setSubject(''); doc.setKeywords([]); doc.setCreator(''); doc.setProducer(''); doc.setCreationDate(new Date(0)); doc.setModificationDate(new Date(0));
          if (h.el('#rmAll').classList.contains('on')) { try { doc.catalog.delete(P.PDFName.of('Metadata')); } catch (e) { } }
          const bytes = await doc.save({ useObjectStreams: true });
          await outFile(S, h, bytes, slugBase(S.files, 'clean'));
          h.out(`元数据已清空 · <b>${window.fmtSize(bytes.length)}</b>`);
        } catch (e) { console.error(e); window.toast('失败：' + e.message); }
        h.busy(false);
      }
    });
  }

  /* ======================= 交互式页面查看器（框选 / 签名） ======================= */
  function canvasToPdf(rot, sz, scale) {
    return function (cx, cy) {
      if (rot === 90) return { x: cy / scale, y: cx / scale };
      if (rot === 180) return { x: sz.w - cx / scale, y: cy / scale };
      if (rot === 270) return { x: sz.w - cy / scale, y: sz.h - cx / scale };
      return { x: cx / scale, y: sz.h - cy / scale };
    };
  }
  function pageViewer(stage, o) {
    stage.innerHTML = `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <button class="btn-ghost btn-sm" id="pvPrev">上一页</button>
        <span class="mini" id="pvLabel">—</span>
        <button class="btn-ghost btn-sm" id="pvNext">下一页</button>
        <button class="btn-ghost btn-sm" id="pvClear">清除本页标记</button>
        <span class="mini" id="pvHint"></span>
      </div>
      <div class="canvaswrap" style="position:relative;display:inline-block;max-width:100%">
        <canvas id="pvCanvas" style="max-width:100%;display:block"></canvas>
        <div id="pvOverlay" style="position:absolute;left:0;top:0;right:0;bottom:0;cursor:crosshair"></div>
      </div>`;
    const cv = stage.querySelector('#pvCanvas'), ov = stage.querySelector('#pvOverlay');
    const state = { doc: null, page: 0, n: 0, sz: null, rot: 0, scale: 2, boxes: {}, mode: o.mode, getSign: o.getSign };
    let drag = null, liveBox = null;
    function boxesFor(i) { if (!state.boxes[i]) state.boxes[i] = []; return state.boxes[i]; }
    function redrawOverlay() {
      const rects = ov.querySelectorAll('.pvrect');
      rects.forEach(r => r.remove());
      const map = canvasToPdf(state.rot, state.sz, state.scale);
      const ratio = cv.clientWidth / cv.width || 1;
      for (const b of boxesFor(state.page)) {
        const p1 = map(b.cx1 * (cv.width / cv.clientWidth || 1), b.cy1 * (cv.height / cv.clientHeight || 1));
        void p1;
        const d = document.createElement('div');
        d.className = 'pvrect';
        d.style.cssText = `position:absolute;border:2px solid ${state.mode === 'sign' ? '#d7f452' : '#ff4d4d'};background:${state.mode === 'black' ? 'rgba(0,0,0,.85)' : state.mode === 'white' ? 'rgba(255,255,255,.92)' : 'rgba(215,244,82,.25)'};pointer-events:none;left:${b.px}px;top:${b.py}px;width:${b.pw}px;height:${b.ph}px`;
        ov.appendChild(d);
      }
      void ratio;
    }
    async function render() {
      if (!state.doc) return;
      const P = await getPDFLib();
      const pages = state.doc.getPages();
      const page = pages[state.page];
      state.sz = pageSize(page); state.rot = pageRotation(page);
      const maxW = Math.min(760, stage.clientWidth - 20) || 640;
      const scale = Math.max(0.6, Math.min(2.2, maxW / (Math.max(state.sz.w, state.sz.h))));
      state.scale = scale;
      const c = await renderPageToCanvas(P, state.doc, page, scale);
      cv.width = c.width; cv.height = c.height;
      cv.getContext('2d').drawImage(c, 0, 0);
      stage.querySelector('#pvLabel').textContent = `第 ${state.page + 1} / ${state.n} 页 · ${Math.round(state.sz.w)}×${Math.round(state.sz.h)} pt`;
      stage.querySelector('#pvHint').textContent = o.hint || '';
      redrawOverlay();
    }
    ov.addEventListener('mousedown', e => {
      const r = ov.getBoundingClientRect();
      drag = { x0: e.clientX - r.left, y0: e.clientY - r.top };
    });
    ov.addEventListener('mousemove', e => {
      if (!drag) return;
      const r = ov.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const x0 = Math.min(drag.x0, x), y0 = Math.min(drag.y0, y), w = Math.abs(x - drag.x0), h = Math.abs(y - drag.y0);
      if (!liveBox) { liveBox = document.createElement('div'); liveBox.style.cssText = 'position:absolute;border:2px dashed #d7f452;background:rgba(215,244,82,.15);pointer-events:none'; ov.appendChild(liveBox); }
      liveBox.style.left = x0 + 'px'; liveBox.style.top = y0 + 'px'; liveBox.style.width = w + 'px'; liveBox.style.height = h + 'px';
    });
    window.addEventListener('mouseup', e => {
      if (!drag) return;
      const r = ov.getBoundingClientRect();
      const x = (e.clientX || 0) - r.left, y = (e.clientY || 0) - r.top;
      const x0 = Math.min(drag.x0, x), y0 = Math.min(drag.y0, y), w = Math.abs(x - drag.x0), h = Math.abs(y - drag.y0);
      drag = null;
      if (liveBox) { liveBox.remove(); liveBox = null; }
      if (w < 6 || h < 6) return;
      const sx = cv.width / r.width, sy = cv.height / r.height;
      const map = canvasToPdf(state.rot, state.sz, state.scale);
      const p1 = map(x0 * sx, y0 * sy), p2 = map((x0 + w) * sx, (y0 + h) * sy);
      const px = Math.min(p1.x, p2.x), py = Math.min(p1.y, p2.y), pw = Math.abs(p2.x - p1.x), ph = Math.abs(p2.y - p1.y);
      boxesFor(state.page).push({ px: x0, py: y0, pw: w, ph: h, x: px, y: py, w: pw, h: ph, sign: state.mode === 'sign' ? (state.getSign && state.getSign()) : null });
      redrawOverlay();
      o.onChange && o.onChange(state);
    });
    stage.querySelector('#pvPrev').onclick = () => { if (state.page > 0) { state.page--; render(); } };
    stage.querySelector('#pvNext').onclick = () => { if (state.page < state.n - 1) { state.page++; render(); } };
    stage.querySelector('#pvClear').onclick = () => { state.boxes[state.page] = []; redrawOverlay(); o.onChange && o.onChange(state); };
    return {
      load: async file => {
        const P = await getPDFLib();
        const doc = await P.PDFDocument.load(bufOf(await window.TUI.readBuf(file)), { ignoreEncryption: true, updateMetadata: false });
        state.doc = doc; state.n = doc.getPageCount(); state.page = 0; state.boxes = {};
        await render();
        return state;
      },
      state, render
    };
  }

  /* ---------- A. redact / blackout / sign ---------- */
  function hAnnotate(host, cfg, slug) {
    const isSign = slug === 'sign-pdf';
    const isRedact = slug === 'redact-pdf';
    const { stage, pane } = window.TUI.shell(host, true);
    stage.innerHTML = window.TUI.drop(dropInner({ title: isSign ? '选择要签名的 PDF' : '选择要涂黑的 PDF', hint: '拖入或点击选择', icon: 'pdf' }), '.pdf,application/pdf', false) + '<div id="anWrap" class="hide"></div>';
    let mid = '';
    if (isSign) {
      mid = `<canvas id="sgPad" width="520" height="200" style="width:100%;border:1px solid #2a2a2a;border-radius:10px;background:#fff;touch-action:none"></canvas>
           <div class="shapes" style="margin-top:8px"><button class="btn-ghost btn-sm" id="sgClear">清空签名</button></div>
           <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px">
             <div>${window.TUI.field('签名颜色', window.TUI.input('sgColor', '#101820', '#101820', 'color'))}</div>
             <div>${window.TUI.field('笔宽', window.TUI.input('sgW', '3', '3', 'number'))}</div></div>`;
    } else if (isRedact) {
      mid = window.TUI.field('遮盖方式', window.TUI.sel('rdMode', [{ v: 'black', t: '涂黑（填黑矩形）' }, { v: 'white', t: '白底覆盖（填白并描边）' }], 'black'));
    }
    pane.innerHTML = window.TUI.head(isSign ? '手写签名' : (isRedact ? '遮盖 / 涂黑' : '涂黑文字'), isSign ? '先用鼠标/触控写签名，再到页面上拖出签名区域。' : '在页面上拖出矩形即可遮盖。导出的 PDF 会真正把该区域涂掉。') +
      mid +
      `<div class="outbox" id="anInfo">已标记 <b>0</b> 处</div>
       <button class="btn-lime btn-run" id="anGo">生成并下载</button>
       <div class="progress" id="tProg" style="display:none"><i></i></div>
       <div class="runnote">坐标为页面坐标；涂黑是真正覆盖（不是注释层）。如需彻底删除文字内容，请在导出后再做一次“扁平化”。</div>`;
    let viewer = null, curMode = isSign ? 'sign' : (isRedact ? 'black' : 'black');
    let signature = null;
    // 签名板
    if (isSign) {
      const pad = pane.querySelector('#sgPad');
      const g = pad.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, pad.width, pad.height);
      g.lineCap = 'round'; g.lineJoin = 'round';
      let drawing = false, has = false;
      const pos = e => { const r = pad.getBoundingClientRect(); return { x: (e.clientX - r.left) * pad.width / r.width, y: (e.clientY - r.top) * pad.height / r.height }; };
      pad.addEventListener('pointerdown', e => { drawing = true; has = true; pad.setPointerCapture(e.pointerId); const p = pos(e); g.strokeStyle = pane.querySelector('#sgColor').value; g.lineWidth = parseInt(pane.querySelector('#sgW').value, 10) || 3; g.beginPath(); g.moveTo(p.x, p.y); });
      pad.addEventListener('pointermove', e => { if (!drawing) return; const p = pos(e); g.lineTo(p.x, p.y); g.stroke(); });
      pad.addEventListener('pointerup', () => { drawing = false; if (has) signature = pad.toDataURL('image/png'); });
      pane.querySelector('#sgClear').onclick = () => { g.fillStyle = '#fff'; g.fillRect(0, 0, pad.width, pad.height); signature = null; window.toast('已清空签名'); };
    }
    function mountViewer() {
      const wrap = stage.querySelector('#anWrap');
      wrap.classList.remove('hide');
      stage.querySelector('#tDrop').classList.add('hide');
      if (isSign) wrap.innerHTML = '<div class="warnbox" style="margin-bottom:10px">先在右侧写好签名，再在页面上拖出放置区域。</div>';
      wrap.insertAdjacentHTML('beforeend', '<div id="pvHost"></div>');
      viewer = pageViewer(wrap.querySelector('#pvHost'), {
        mode: curMode, hint: isSign ? '拖出签名区域' : '拖出要遮盖的矩形',
        getSign: () => signature,
        onChange: st => {
          let c = 0; for (const k in st.boxes) c += st.boxes[k].length;
          pane.querySelector('#anInfo').innerHTML = `已标记 <b>${c}</b> 处`;
        }
      });
    }
    window.TUI.bindDrop(stage, '.pdf,application/pdf', false, async list => {
      try { mountViewer(); await viewer.load(list[0]); window.__anFile = list[0]; }
      catch (e) { console.error(e); window.toast('读取失败：' + e.message); }
    });
    if (isRedact) pane.querySelector('#rdMode').addEventListener('change', () => { curMode = pane.querySelector('#rdMode').value; });
    pane.querySelector('#anGo').addEventListener('click', async () => {
      if (!viewer) return window.toast('请先选择 PDF');
      const st = viewer.state; let count = 0;
      for (const k in st.boxes) count += st.boxes[k].length;
      if (!count) return window.toast('还没有标记');
      const btn = pane.querySelector('#anGo'); btn.disabled = true; btn.textContent = '生成中…';
      try {
        const P = await getPDFLib();
        const doc = st.doc;
        const pages = doc.getPages();
        for (let i = 0; i < pages.length; i++) {
          const boxes = st.boxes[i] || [];
          for (const b of boxes) {
            if (isSign && b.sign) {
              const img = await doc.embedPng(b.sign);
              pages[i].drawImage(img, { x: b.x, y: b.y, width: b.w, height: b.h });
            } else if (curMode === 'white' || (isRedact && pane.querySelector('#rdMode').value === 'white')) {
              pages[i].drawRectangle({ x: b.x, y: b.y, width: b.w, height: b.h, color: P.rgb(1, 1, 1), borderColor: P.rgb(0.35, 0.35, 0.35), borderWidth: 0.6 });
            } else {
              pages[i].drawRectangle({ x: b.x, y: b.y, width: b.w, height: b.h, color: P.rgb(0, 0, 0) });
            }
          }
          window.TUI.prog(pane.querySelector('#tProg'), (i + 1) / pages.length * 100);
          await sleep(0);
        }
        const bytes = await doc.save({ useObjectStreams: true });
        const name = st.doc ? 'output' : 'output';
        const f = window.__anFile;
        const base = f ? f.name.replace(/\.[^.]+$/, '') : 'document';
        const suffix = isSign ? 'signed' : 'redacted';
        const blob = new Blob([bytes], { type: 'application/pdf' });
        window.downloadBlob(blob, `${base}-${suffix}.pdf`);
        pane.querySelector('#anInfo').innerHTML = `已处理 <b>${count}</b> 处 · <b>${window.fmtSize(blob.size)}</b>`;
        window.toast('已下载 ' + window.fmtSize(blob.size));
        void name;
      } catch (e) { console.error(e); window.toast('失败：' + e.message); }
      btn.disabled = false; btn.textContent = '生成并下载';
    });
  }

  /* ---------- A. pdf-editor ---------- */
  function hEditor(host) {
    const { stage, pane } = window.TUI.shell(host, true);
    const S = { doc: null, items: [], sel: new Set() };
    stage.innerHTML = window.TUI.drop(dropInner({ title: '选择 PDF 进入编辑器', hint: '拖入或点击选择；之后可在缩略图上排序、删页、旋转', icon: 'pdf' }), '.pdf,application/pdf', false) + '<div id="edWrap" class="hide"></div>';
    pane.innerHTML = window.TUI.head('页面编辑器', '拖动缩略图排序 · 删除单页 · 单页旋转 · 抽出选中页。') +
      `<div class="outbox" id="edInfo">尚未载入</div>
       <button class="btn-lime btn-run" id="edGo">按当前顺序导出</button>
       <button class="btn-ghost btn-run" id="edExtract" style="margin-top:8px">导出选中页为新 PDF</button>
       <div class="progress" id="tProg" style="display:none"><i></i></div>
       <div class="runnote">在缩略图左上角勾选可“选中”；选中后可单独导出。</div>`;
    function render() {
      const wrap = stage.querySelector('#edWrap');
      wrap.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin-top:6px">` +
        S.items.map((it, i) => `<div draggable="true" data-i="${i}" style="border:1px solid #232323;border-radius:10px;padding:6px;background:#141414;cursor:grab">
          <div style="position:relative">
            <img src="${it.thumb}" style="width:100%;border-radius:6px;background:#fff;transform:rotate(${it.rot}deg);transition:transform .15s">
            <label style="position:absolute;left:4px;top:4px;background:#000a;border-radius:4px;padding:2px 4px;font-size:11px"><input type="checkbox" data-sel="${i}" ${S.sel.has(i) ? 'checked' : ''}> #${it.idx + 1}</label>
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:6px;gap:4px">
            <button class="btn-ghost btn-sm" data-rot="${i}" title="旋转">↻</button>
            <button class="btn-ghost btn-sm" data-del="${i}" title="删除"><svg data-lucide="x" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
          </div></div>`).join('') + '</div>';
      pane.querySelector('#edInfo').innerHTML = `共 <b>${S.items.length}</b> 页 · 选中 <b>${S.sel.size}</b> 页`;
      const imgWrap = wrap;
      imgWrap.querySelectorAll('[data-rot]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); const i = +b.dataset.rot; S.items[i].rot = (S.items[i].rot + 90) % 360; render(); }));
      imgWrap.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); const i = +b.dataset.del; S.items.splice(i, 1); S.sel = new Set([...S.sel].filter(v => v !== i).map(v => v > i ? v - 1 : v)); render(); }));
      imgWrap.querySelectorAll('[data-sel]').forEach(c => c.addEventListener('change', () => { const i = +c.dataset.sel; if (c.checked) S.sel.add(i); else S.sel.delete(i); pane.querySelector('#edInfo').innerHTML = `共 <b>${S.items.length}</b> 页 · 选中 <b>${S.sel.size}</b> 页`; }));
      let dragI = -1;
      imgWrap.querySelectorAll('[data-i]').forEach(el => {
        el.addEventListener('dragstart', () => { dragI = +el.dataset.i; });
        el.addEventListener('dragover', e => e.preventDefault());
        el.addEventListener('drop', e => { e.preventDefault(); const to = +el.dataset.i; if (dragI < 0 || dragI === to) return; const [m] = S.items.splice(dragI, 1); S.items.splice(to, 0, m); dragI = -1; render(); });
      });
    }
    window.TUI.bindDrop(stage, '.pdf,application/pdf', false, async list => {
      stage.querySelector('#tDrop').classList.add('hide');
      const wrap = stage.querySelector('#edWrap'); wrap.classList.remove('hide'); wrap.innerHTML = '<div class="runnote">正在渲染缩略图…</div>';
      try {
        const P = await getPDFLib();
        S.doc = await P.PDFDocument.load(bufOf(await window.TUI.readBuf(list[0])), { ignoreEncryption: true, updateMetadata: false });
        const pages = S.doc.getPages();
        S.items = [];
        const maxN = pages.length;
        for (let i = 0; i < maxN; i++) {
          const c = await renderPageToCanvas(P, S.doc, pages[i], 0.4);
          S.items.push({ idx: i, rot: 0, thumb: c.toDataURL('image/jpeg', 0.7) });
          if (i % 6 === 5) { wrap.innerHTML = `<div class="runnote">正在渲染缩略图… ${i + 1}/${maxN}</div>`; await sleep(0); }
        }
        S.sel = new Set();
        render();
      } catch (e) { console.error(e); window.toast('读取失败：' + e.message); }
    });
    async function exportItems(items, name) {
      const P = await getPDFLib();
      const out = await P.PDFDocument.create();
      const srcPages = S.doc.getPages();
      const embedded = await out.embedPages(items.map(it => srcPages[it.idx]));
      items.forEach((it, k) => {
        const page = out.addPage();
        page.drawPage(embedded[k]);
        if (it.rot) page.setRotation(P.degrees(it.rot));
      });
      const bytes = await out.save({ useObjectStreams: true });
      const blob = new Blob([bytes], { type: 'application/pdf' });
      window.downloadBlob(blob, name);
      window.toast('已下载 ' + window.fmtSize(blob.size));
      return blob;
    }
    pane.querySelector('#edGo').onclick = async () => {
      if (!S.doc || !S.items.length) return window.toast('请先选择 PDF');
      try { await exportItems(S.items, 'edited.pdf'); } catch (e) { console.error(e); window.toast('失败：' + e.message); }
    };
    pane.querySelector('#edExtract').onclick = async () => {
      if (!S.sel.size) return window.toast('请先勾选要抽出的页');
      const items = [...S.sel].sort((a, b) => a - b).map(i => S.items[i]);
      try { await exportItems(items, 'extracted.pdf'); } catch (e) { console.error(e); window.toast('失败：' + e.message); }
    };
  }

  /* ---------- A. compress-pdf ---------- */
  function hCompress(host) {
    fileTask(host, {
      dropTitle: '选择一个 PDF', accept: '.pdf,application/pdf', runLabel: '压缩并下载',
      paneHtml: window.TUI.head('压缩 PDF', '两种方式：无损重写；或栅格化为 JPEG（体积更小，但文字变成图片）。') +
        window.TUI.field('方式', window.TUI.sel('cpMode', [{ v: 'lossless', t: '无损重写（推荐先试）' }, { v: 'raster', t: '栅格化为 JPEG（明显变小）' }], 'lossless')) +
        `<div id="cpRasterOpts" class="hide">` +
        window.TUI.field('质量', window.TUI.range('cpQ', 30, 95, 72)) +
        window.TUI.field('分辨率', window.TUI.sel('cpDpi', [{ v: '96', t: '96 dpi（最小）' }, { v: '110', t: '110 dpi' }, { v: '150', t: '150 dpi（推荐）' }, { v: '200', t: '200 dpi' }], '110')) +
        `<div class="warnbox">栅格化后页面为图片，将无法选中/搜索文字，也不再保留矢量清晰度。</div></div>`,
      note: '无损重写会移除冗余对象并重新压缩内容流；栅格化使用本引擎本地渲染。',
      init: h => { h.el('#cpMode').addEventListener('change', () => h.el('#cpRasterOpts').classList.toggle('hide', h.q('cpMode') !== 'raster')); },
      onStage: async (list, h) => {
        h.showFiles(list);
        h.out(`原文件大小 <b>${window.fmtSize(list[0].size)}</b>`);
      },
      run: async (S, h) => {
        if (!S.files.length) return window.toast('请先选择 PDF');
        h.busy(true);
        try {
          const P = await getPDFLib();
          const inBytes = bufOf(await window.TUI.readBuf(S.files[0]));
          const mode = h.q('cpMode');
          let outBytes;
          if (mode === 'lossless') {
            const doc = await P.PDFDocument.load(inBytes, { ignoreEncryption: true, updateMetadata: false });
            outBytes = await doc.save({ useObjectStreams: true });
          } else {
            const doc = await P.PDFDocument.load(inBytes, { ignoreEncryption: true, updateMetadata: false });
            const pages = doc.getPages();
            const dpi = parseInt(h.q('cpDpi'), 10) || 110;
            const q = (parseInt(h.q('cpQ'), 10) || 72) / 100;
            const scale = dpi / 72;
            const out = await P.PDFDocument.create();
            for (let i = 0; i < pages.length; i++) {
              const sz = pageSize(pages[i]);
              const c = await renderPageToCanvas(P, doc, pages[i], scale);
              const jpg = base64ToU8(c.toDataURL('image/jpeg', q).split(',')[1]);
              const img = await out.embedJpg(jpg);
              const np = out.addPage([sz.w, sz.h]);
              np.drawImage(img, { x: 0, y: 0, width: sz.w, height: sz.h });
              h.prog((i + 1) / pages.length * 100);
              await sleep(0);
            }
            outBytes = await out.save({ useObjectStreams: true });
          }
          const blob = await outFile(S, h, outBytes, slugBase(S.files, mode === 'raster' ? 'compressed-jpg' : 'compressed'));
          const before = S.files[0].size, after = blob.size;
          const pct = before ? Math.round((1 - after / before) * 100) : 0;
          h.out(`${window.fmtSize(before)} → <b>${window.fmtSize(after)}</b> · ${pct >= 0 ? '减小 ' + pct + '%' : '增大 ' + (-pct) + '%'}`);
        } catch (e) { console.error(e); window.toast('压缩失败：' + e.message); }
        h.busy(false);
      }
    });
  }

  /* ======================= B. 转 PDF ======================= */
  async function embedImageFile(pdf, file) {
    const isJpg = /jpe?g/i.test(file.type) || /\.jpe?g$/i.test(file.name);
    const isPng = /png/i.test(file.type) || /\.png$/i.test(file.name);
    if (isJpg) { try { return await pdf.embedJpg(bufOf(await window.TUI.readBuf(file))); } catch (e) { } }
    if (isPng) { try { return await pdf.embedPng(bufOf(await window.TUI.readBuf(file))); } catch (e) { } }
    const im = await loadImg(file);
    const c = canvasOf(im.naturalWidth, im.naturalHeight);
    c.getContext('2d').drawImage(im, 0, 0);
    return await pdf.embedPng(c.toDataURL('image/png'));
  }
  function hImagesToPdf(host, cfg, slug) {
    const S = { files: [] };
    const { stage, pane } = window.TUI.shell(host, true);
    stage.innerHTML = window.TUI.drop(dropInner({ title: '添加图片', hint: '可一次选多张，顺序即页码顺序', icon: 'image', fmts: '<b>JPG / PNG / WebP / GIF / BMP</b> · 自动转成页面' }), 'image/*', true) + '<div id="imgList" style="margin-top:12px"></div>';
    pane.innerHTML = window.TUI.head('图片 → PDF', '把图片按顺序生成 PDF 页面。') +
      window.TUI.field('页面尺寸', window.TUI.sel('i2pSize', [{ v: 'auto', t: '自适应图片' }, { v: 'a4', t: 'A4' }, { v: 'a4l', t: 'A4 横向' }, { v: 'letter', t: 'Letter' }], 'a4')) +
      window.TUI.field('留白（pt）', window.TUI.input('i2pMargin', '24', '24', 'number')) +
      window.TUI.field('填充方式', window.TUI.sel('i2pFit', [{ v: 'contain', t: '完整显示（留白）' }, { v: 'cover', t: '铺满裁切' }], 'contain')) +
      `<div class="outbox" id="i2pInfo">尚未添加图片</div>
       <button class="btn-lime btn-run" id="i2pGo">生成 PDF</button>
       <div class="progress" id="tProg" style="display:none"><i></i></div>`;
    function render() {
      pane.querySelector('#i2pInfo').innerHTML = S.files.length ? `${S.files.length} 张图片` : '尚未添加图片';
      stage.querySelector('#imgList').innerHTML = S.files.map((f, i) => `<div class="filebar" style="margin-bottom:6px"><span><b>${esc(f.name)}</b></span><span><button class="btn-ghost btn-sm" data-up="${i}">↑</button> <button class="btn-ghost btn-sm" data-del="${i}">移除</button></span></div>`).join('');
    }
    stage.addEventListener('click', e => {
      const u = e.target.closest('[data-up]'), d = e.target.closest('[data-del]');
      if (u) { const i = +u.dataset.up; if (i > 0) { [S.files[i - 1], S.files[i]] = [S.files[i], S.files[i - 1]]; render(); } }
      if (d) { S.files.splice(+d.dataset.del, 1); render(); }
    });
    window.TUI.bindDrop(stage, 'image/*', true, list => {
      for (const f of list) if (/^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name)) S.files.push(f);
      render();
      const dd = stage.querySelector('#tDrop'); if (dd) dd.classList.add('hide');
    });
    pane.querySelector('#i2pGo').addEventListener('click', async () => {
      if (!S.files.length) return window.toast('请先添加图片');
      const btn = pane.querySelector('#i2pGo'); btn.disabled = true; btn.textContent = '生成中…';
      try {
        const P = await getPDFLib();
        const out = await P.PDFDocument.create();
        const mode = pane.querySelector('#i2pSize').value;
        const mg = parseInt(pane.querySelector('#i2pMargin').value, 10) || 0;
        const fit = pane.querySelector('#i2pFit').value;
        for (let i = 0; i < S.files.length; i++) {
          const img = await embedImageFile(out, S.files[i]);
          let pw, ph;
          if (mode === 'auto') { pw = img.width + mg * 2; ph = img.height + mg * 2; }
          else { const s = mode === 'a4l' ? [A4[1], A4[0]] : mode === 'letter' ? LETTER : A4; pw = s[0]; ph = s[1]; }
          const page = out.addPage([pw, ph]);
          const availW = pw - mg * 2, availH = ph - mg * 2;
          const k = fit === 'cover' ? Math.max(availW / img.width, availH / img.height) : Math.min(availW / img.width, availH / img.height);
          const w = img.width * k, h = img.height * k;
          page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
          window.TUI.prog(pane.querySelector('#tProg'), (i + 1) / S.files.length * 100);
          await sleep(0);
        }
        const bytes = await out.save({ useObjectStreams: true });
        const blob = new Blob([bytes], { type: 'application/pdf' });
        window.downloadBlob(blob, (S.files[0].name.replace(/\.[^.]+$/, '') || 'images') + '-images.pdf');
        pane.querySelector('#i2pInfo').innerHTML = `已生成 <b>${S.files.length}</b> 页 · <b>${window.fmtSize(blob.size)}</b>`;
        window.toast('已下载 ' + window.fmtSize(blob.size));
      } catch (e) { console.error(e); window.toast('失败：' + e.message); }
      btn.disabled = false; btn.textContent = '生成 PDF';
    });
  }

  /* Markdown 块 → DocBuilder */
  function renderBlocks(db, blocks, o) {
    for (const b of blocks) {
      if (b.t === 'h') db.text(stripInline(b.text), { size: Math.max(o.size + 1, 21 - (b.level - 1) * 2.5), bold: true, family: o.family, after: 6, color: '#0f0f0f' });
      else if (b.t === 'p') db.text(stripInline(b.text), { size: o.size, family: o.family, lh: 1.6, after: 5 });
      else if (b.t === 'list') { b.items.forEach((it, idx) => db.text((b.ordered ? (idx + 1) + '. ' : '• ') + stripInline(it), { size: o.size, family: o.family, indent: 14, after: 2 })); db.space(3); }
      else if (b.t === 'quote') db.text(stripInline(b.text), { size: o.size, family: o.family, color: '#555555', indent: 16, lh: 1.5, after: 6 });
      else if (b.t === 'code') db.text(b.text, { size: Math.max(7, o.size - 1.5), family: 'mono', color: '#333333', lh: 1.45, after: 6 });
      else if (b.t === 'hr') db.rule({ gap: 10 });
      else if (b.t === 'table') db.table([b.head].concat(b.rows), { size: Math.min(o.size, 9.5), header: true, headFill: '#f2f2f2', zebra: 'rgba(0,0,0,0.03)', after: 8 });
    }
  }
  /* 文本 / Markdown / HTML → PDF */
  function textToPdfTask(host, o) {
    const { stage, pane } = window.TUI.shell(host, true);
    stage.innerHTML = window.TUI.drop(dropInner({ title: o.dropTitle, hint: o.dropHint, icon: 'text' }), o.accept, false) +
      `<div style="margin-top:12px">${window.TUI.area('tpText', o.sample || '', o.placeholder || '在此输入或粘贴内容…', 16)}</div>
       <div class="filebar" style="margin-top:8px"><span class="mini" id="tpStat">0 字符</span><span class="newv" id="tpDemo">载入示例</span></div>`;
    pane.innerHTML = window.TUI.head(o.title, o.desc) +
      `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>${window.TUI.field('字号', window.TUI.input('tpSize', '11', '11', 'number'))}</div>
        <div>${window.TUI.field('页边距', window.TUI.input('tpMargin', '54', '54', 'number'))}</div></div>` +
      window.TUI.field('字体', window.TUI.sel('tpFont', [{ v: 'sans', t: '无衬线' }, { v: 'serif', t: '衬线' }, { v: 'mono', t: '等宽' }], o.font || 'sans')) +
      window.TUI.field('纸张', window.TUI.sel('tpPaper', [{ v: 'a4', t: 'A4' }, { v: 'letter', t: 'Letter' }], 'a4')) +
      window.TUI.field('行距', window.TUI.input('tpLh', '1.55', '1.55', 'number')) +
      `<div class="outbox" id="tpInfo">输出：—</div>
       <button class="btn-lime btn-run" id="tpGo">生成 PDF 并下载</button>
       <div class="progress" id="tProg" style="display:none"><i></i></div>
       <div class="runnote">${o.note || '中文经 Canvas 逐行贴图渲染，pdf-lib 无需内置中文字体。'}</div>`;
    const ta = stage.querySelector('#tpText');
    ta.addEventListener('input', () => { stage.querySelector('#tpStat').textContent = ta.value.length + ' 字符'; });
    stage.querySelector('#tpDemo').onclick = () => { if (o.sample) { ta.value = o.sample; stage.querySelector('#tpStat').textContent = ta.value.length + ' 字符'; } };
    window.TUI.bindDrop(stage, o.accept, false, async list => {
      const f = list[0]; if (!f) return;
      try { ta.value = await window.TUI.readText(f); stage.querySelector('#tpStat').textContent = ta.value.length + ' 字符'; window.toast('已载入 ' + f.name); } catch (e) { window.toast('读取失败'); }
    });
    pane.querySelector('#tpGo').addEventListener('click', async () => {
      const text = ta.value;
      if (!text.trim()) return window.toast('请先输入内容');
      const btn = pane.querySelector('#tpGo'); btn.disabled = true; btn.textContent = '生成中…';
      try {
        const size = parseFloat(pane.querySelector('#tpSize').value) || 11;
        const margin = parseFloat(pane.querySelector('#tpMargin').value) || 54;
        const family = pane.querySelector('#tpFont').value;
        const paper = pane.querySelector('#tpPaper').value === 'letter' ? LETTER : A4;
        const lh = parseFloat(pane.querySelector('#tpLh').value) || 1.55;
        let blocks = null;
        if (o.render === 'markdown') blocks = parseMarkdown(text);
        else if (o.render === 'html') blocks = parseMarkdown(htmlToText(text));
        const bytes = await buildPdf({ pageW: paper[0], pageH: paper[1], margin }, o.outName, db => {
          if (o.titleText) db.text(o.titleText, { size: size + 6, bold: true, after: 10 });
          if (blocks) renderBlocks(db, blocks, { size, family });
          else db.text(text, { size, family, lh });
        });
        btn.disabled = false; btn.textContent = '生成 PDF 并下载';
        pane.querySelector('#tpInfo').innerHTML = `已生成 · <b>${window.fmtSize(bytes.length)}</b>`;
      } catch (e) { console.error(e); window.toast('失败：' + e.message); btn.disabled = false; btn.textContent = '生成 PDF 并下载'; }
    });
  }

  function hMarkdownPdf(host, cfg, slug) {
    const sample = '# 标题一\n\n这是一段**加粗**、*斜体* 与 `代码` 混排的中文段落，用于演示 Markdown → PDF。\n\n## 小节\n\n- 列表项一\n- 列表项二\n\n> 引用块：渲染为缩进提示。\n\n```js\nconst x = 42;\n```\n\n| 名称 | 数量 | 单价 |\n| --- | ---: | ---: |\n| 苹果 | 3 | 5.00 |\n| 香蕉 | 2 | 3.50 |\n\n[链接示例](https://example.com)\n';
    textToPdfTask(host, {
      title: 'Markdown → PDF', desc: '内置轻量 Markdown 解析器（标题/粗斜体/列表/引用/代码块/表格/链接），不引第三方。',
      dropTitle: '粘贴 Markdown 或选择 .md 文件', dropHint: '支持拖入 .md / .markdown / .txt', accept: '.md,.markdown,.txt,text/markdown,text/plain',
      font: 'serif', outName: 'markdown.pdf', sample, render: 'markdown',
      note: '渲染结果与常见 Markdown 阅读器接近；不做完整 CSS 排版（无浮动/多栏）。'
    });
  }
  function hHtmlPdf(host) {
    textToPdfTask(host, {
      title: 'HTML → PDF', desc: '从 HTML 文本抽取结构后渲染。注意：基于文本抽取，不使用浏览器排版引擎（无 CSS 布局/绝对定位）。',
      dropTitle: '粘贴 HTML 或选择 .html 文件', dropHint: '只渲染文字与基础结构（标题/段落/列表/表格）', accept: '.html,.htm,text/html',
      font: 'sans', outName: 'html.pdf',
      sample: '<h1>示例标题</h1>\n<p>这是一段 HTML 段落，<b>加粗</b> 与 <i>斜体</i> 会被提取。</p>\n<ul><li>列表一</li><li>列表二</li></ul>\n<table><tr><td>列 A</td><td>列 B</td></tr><tr><td>1</td><td>2</td></tr></table>',
      note: '诚实说明：这是“文本抽取式”转换——不做 CSS 排版、不加载外部图片与字体。'
    });
  }

  function hTextPdf(host) {
    textToPdfTask(host, {
      title: '文本 → PDF', desc: '把纯文本按字号、边距、行距排版成 PDF，超长自动分页。',
      dropTitle: '粘贴文本或选择 .txt 文件', dropHint: '支持拖入 .txt / .csv / 任意纯文本', accept: '.txt,.log,.md,.csv,text/plain',
      font: 'sans', outName: 'text.pdf'
    });
  }

  /* CSV / 粘贴表格 → PDF（分页 + 重复表头） */
  function estimateRowH(row, colW, size, padX, padY) {
    const st = { size, family: 'sans', bold: false };
    let maxLines = 1;
    for (let i = 0; i < row.length; i++) {
      const lines = wrapText(String(row[i] == null ? '' : row[i]), (colW[i] || 60) - padX * 2, st);
      maxLines = Math.max(maxLines, lines.length);
    }
    return maxLines * size * 1.35 + padY * 2;
  }
  function computeColW(rows, cols, availW, size) {
    const mw = new Array(cols).fill(14);
    _mx.font = (size * SCALE) + 'px ' + FAMILY.sans;
    for (const r of rows.slice(0, 80)) for (let i = 0; i < cols; i++) mw[i] = Math.max(mw[i], Math.min(_mx.measureText(String(r[i] == null ? '' : r[i])).width / SCALE, availW * 0.4));
    const tot = mw.reduce((a, b) => a + b, 0) || 1;
    return mw.map(w => availW * w / tot);
  }
  function hCsvPdf(host, o) {
    o = o || {};
    const { stage, pane } = window.TUI.shell(host, true);
    stage.innerHTML = window.TUI.drop(dropInner({ title: o.dropTitle || '选择 CSV / TSV 文件', hint: '也可直接在下方粘贴表格数据', icon: 'text', fmts: '<b>CSV / TSV</b> · 自动识别分隔符' }), '.csv,.tsv,.txt', false) +
      `<div style="margin-top:12px">${window.TUI.area('cvText', '', '或在此粘贴（首行为表头，逗号/Tab 分隔）…', 12)}</div>`;
    pane.innerHTML = window.TUI.head(o.title || 'CSV → PDF', o.desc || '自动列宽、自动分页，并在每页重复表头。') +
      `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>${window.TUI.field('表头行', window.TUI.input('cvHead', '1', '1', 'number'))}</div>
        <div>${window.TUI.field('字号', window.TUI.input('cvSize', '9', '9', 'number'))}</div></div>` +
      window.TUI.field('纸张', window.TUI.sel('cvPaper', [{ v: 'a4l', t: 'A4 横向（推荐）' }, { v: 'a4', t: 'A4 纵向' }], 'a4l')) +
      window.TUI.chk('cvGrid', '显示网格线', true) +
      `<div class="outbox" id="cvInfo">尚未载入数据</div>
       <button class="btn-lime btn-run" id="cvGo">生成 PDF</button>
       <div class="progress" id="tProg" style="display:none"><i></i></div>`;
    pane.addEventListener('click', e => { const c = e.target.closest('.chk'); if (c) c.classList.toggle('on'); });
    const ta = stage.querySelector('#cvText');
    function stat() { const rows = ta.value.trim() ? parseCSV(ta.value) : []; pane.querySelector('#cvInfo').innerHTML = rows.length ? `${rows.length} 行 · ${rows[0].length} 列` : '尚未载入数据'; }
    ta.addEventListener('input', stat);
    window.TUI.bindDrop(stage, '.csv,.tsv,.txt', false, async list => {
      try { ta.value = await window.TUI.readText(list[0]); stat(); window.toast('已载入 ' + list[0].name); } catch (e) { window.toast('读取失败'); }
    });
    pane.querySelector('#cvGo').addEventListener('click', async () => {
      let rows = ta.value.trim() ? parseCSV(ta.value) : [];
      if (!rows.length) return window.toast('请先粘贴或选择 CSV 数据');
      const btn = pane.querySelector('#cvGo'); btn.disabled = true; btn.textContent = '生成中…';
      try {
        const cols = rows[0].length;
        rows = rows.map(r => { const a = r.slice(0, cols); while (a.length < cols) a.push(''); return a; });
        const size = parseFloat(pane.querySelector('#cvSize').value) || 9;
        const hasHead = (parseInt(pane.querySelector('#cvHead').value, 10) || 0) > 0;
        const grid = pane.querySelector('#cvGrid').classList.contains('on');
        const paper = pane.querySelector('#cvPaper').value === 'a4' ? A4 : [A4[1], A4[0]];
        const margin = 34;
        const availW = paper[0] - margin * 2;
        const colW = computeColW(rows, cols, availW, size);
        const header = hasHead ? rows[0] : null;
        const body = hasHead ? rows.slice(1) : rows;
        // 分页切分
        const pageH = paper[1] - margin * 2;
        const chunks = []; let cur = []; let hAcc = 0;
        const hHead = header ? estimateRowH(header, colW, size, 6, 4) : 0;
        for (const r of body) {
          const rh = estimateRowH(r, colW, size, 6, 4);
          if (cur.length && hAcc + rh > pageH - hHead) { chunks.push(cur); cur = []; hAcc = 0; }
          cur.push(r); hAcc += rh;
        }
        if (cur.length || !chunks.length) chunks.push(cur);
        const bytes = await buildPdf({ pageW: paper[0], pageH: paper[1], margin }, (o.outName || 'table.pdf'), db => {
          if (o.titleText) db.text(o.titleText, { size: size + 7, bold: true, after: 8 });
          chunks.forEach((chunk, ci) => {
            if (ci > 0) db.newPage();
            db.table(header ? [header].concat(chunk) : chunk, { size, grid, weights: null, header: hasHead, headFill: '#f2f2f2', zebra: 'rgba(0,0,0,0.03)', after: 0 });
          });
        });
        btn.disabled = false; btn.textContent = '生成 PDF';
        pane.querySelector('#cvInfo').innerHTML = `已生成 <b>${chunks.length}</b> 页 · <b>${window.fmtSize(bytes.length)}</b>`;
      } catch (e) { console.error(e); window.toast('失败：' + e.message); btn.disabled = false; btn.textContent = '生成 PDF'; }
    });
  }
  function hSheetPdf(host, cfg, slug) {
    hCsvPdf(host, {
      dropTitle: '粘贴表格数据或选择 CSV', title: 'Excel / 表格 → PDF',
      desc: '为避免引入 SheetJS（大体积解析库），本工具不自带 .xlsx 二进制解析：请在 Excel/WPS 里“另存为 CSV”，或直接复制粘贴单元格区域（Tab 分隔即可识别）。',
      outName: 'spreadsheet.pdf',
      titleText: '表格导出'
    });
  }

  /* docx / word → PDF */
  function hDocxPdf(host) {
    fileTask(host, {
      dropTitle: '选择 .docx 文件', accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      runLabel: '转换为 PDF', fmts: '<b>DOCX</b>（Office 2007+）',
      paneHtml: window.TUI.head('Word → PDF', '把 docx 当作 zip 手工解出 word/document.xml，用 DecompressionStream 解压后抽取段落与标题，再渲染成 PDF。') +
        `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>${window.TUI.field('正文号', window.TUI.input('dwSize', '11', '11', 'number'))}</div>
          <div>${window.TUI.field('页边距', window.TUI.input('dwMargin', '54', '54', 'number'))}</div></div>` +
        window.TUI.field('字体', window.TUI.sel('dwFont', [{ v: 'sans', t: '无衬线' }, { v: 'serif', t: '衬线' }], 'serif')) +
        window.TUI.chk('dwHead', '按 Heading 样式识别标题', true) +
        `<div class="warnbox">仅支持 .docx（zip 结构）。老式 .doc（二进制 OLE）无法解析，请先另存为 .docx。图片、页眉页脚、批注会被忽略（仅保留文字与段落层级）。</div>`,
      init: h => { h.pane.addEventListener('click', e => { const c = e.target.closest('.chk'); if (c) c.classList.toggle('on'); }); },
      run: async (S, h) => {
        if (!S.files.length) return window.toast('请先选择 .docx');
        h.busy(true);
        try {
          const { paras } = await readDocxText(S.files[0]);
          const size = parseFloat(h.q('dwSize')) || 11;
          const margin = parseFloat(h.q('dwMargin')) || 54;
          const family = h.q('dwFont');
          const useHead = h.el('#dwHead').classList.contains('on');
          const bytes = await buildPdf({ margin }, slugBase(S.files, 'converted'), db => {
            let i = 0;
            for (const p of paras) {
              const t = p.text;
              if (!t.trim()) { db.space(size * 0.7); continue; }
              const hs = parseInt((p.style.match(/Heading(\d)/) || [])[1] || '0', 10);
              if (useHead && hs) {
                db.text(t, { size: Math.max(size + 1, 22 - (hs - 1) * 3.5), bold: true, family, after: 6, color: '#0f0f0f' });
              } else db.text(t, { size, family, lh: 1.5 });
              if (i++ % 50 === 49) { /* 让出主线程由 render 内部处理 */ }
            }
          });
          h.out(`已转换 <b>${paras.length}</b> 段 · <b>${window.fmtSize(bytes.length)}</b>`);
        } catch (e) { console.error(e); window.toast('转换失败：' + e.message); }
        h.busy(false);
      }
    });
  }

  /* DXF → PDF（线框矢量） */
  function hDxfPdf(host) {
    fileTask(host, {
      dropTitle: '选择 DXF 文件', accept: '.dxf',
      runLabel: '转换为 PDF',
      paneHtml: window.TUI.head('DXF → PDF', '解析 LINE / CIRCLE / ARC / LWPOLYLINE，按图元范围自动缩放并画到 PDF（线框矢量图）。') +
        window.TUI.field('纸张', window.TUI.sel('dxPaper', [{ v: 'auto', t: '按图形比例自动' }, { v: 'a4', t: 'A4' }, { v: 'a3', t: 'A3' }, { v: 'letter', t: 'Letter' }], 'auto')) +
        window.TUI.field('线宽（pt）', window.TUI.input('dxW', '0.6', '0.6', 'number')) +
        window.TUI.chk('dxBounds', '画出图框边界', false) +
        `<div class="warnbox">仅支持基本的线框图元；文字、标注、块引用（INSERT）、样条曲线会被忽略。</div>`,
      init: h => { h.pane.addEventListener('click', e => { const c = e.target.closest('.chk'); if (c) c.classList.toggle('on'); }); },
      run: async (S, h) => {
        if (!S.files.length) return window.toast('请先选择 DXF');
        h.busy(true);
        try {
          const text = await window.TUI.readText(S.files[0]);
          const ents = parseDXF(text);
          if (!ents.length) throw new Error('未找到支持的图元（LINE/CIRCLE/ARC/LWPOLYLINE）');
          let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
          const touch = (x, y) => { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; };
          for (const e of ents) {
            if (e.t === 'line') { touch(e.x1, e.y1); touch(e.x2, e.y2); }
            else if (e.t === 'circle' || e.t === 'arc') { touch(e.cx - e.r, e.cy - e.r); touch(e.cx + e.r, e.cy + e.r); }
            else if (e.t === 'poly') for (const p of e.pts) touch(p[0], p[1]);
          }
          const P = await getPDFLib();
          const paper = h.q('dxPaper');
          let pw, ph;
          if (paper === 'a4') { pw = A4[0]; ph = A4[1]; }
          else if (paper === 'a3') { pw = 842; ph = 1191; }
          else if (paper === 'letter') { pw = LETTER[0]; ph = LETTER[1]; }
          else { const w = Math.max(1, maxx - minx), hh = Math.max(1, maxy - miny); const s = 600; pw = Math.max(200, s); ph = Math.max(200, s * hh / w); }
          const margin = 24;
          const k = Math.min((pw - margin * 2) / Math.max(1e-6, maxx - minx), (ph - margin * 2) / Math.max(1e-6, maxy - miny));
          const ox = margin + ((pw - margin * 2) - (maxx - minx) * k) / 2, oy = margin + ((ph - margin * 2) - (maxy - miny) * k) / 2;
          const X = x => ox + (x - minx) * k, Y = y => oy + (y - miny) * k;
          const out = await P.PDFDocument.create();
          const page = out.addPage([pw, ph]);
          const lw = parseFloat(h.q('dxW')) || 0.6;
          const drawPoly = pts => {
            for (let i = 0; i + 1 < pts.length; i++) page.drawLine({ start: { x: X(pts[i][0]), y: Y(pts[i][1]) }, end: { x: X(pts[i + 1][0]), y: Y(pts[i + 1][1]) }, thickness: lw });
          };
          for (const e of ents) {
            if (e.t === 'line') page.drawLine({ start: { x: X(e.x1), y: Y(e.y1) }, end: { x: X(e.x2), y: Y(e.y2) }, thickness: lw });
            else if (e.t === 'circle' || (e.t === 'arc' && !e.skip)) {
              const steps = 96; let a1 = e.a1, a2 = e.a2;
              if (e.t === 'circle') { a1 = 0; a2 = 360; }
              if (a2 < a1) a2 += 360;
              const pts = [];
              for (let s = 0; s <= steps; s++) { const a = (a1 + (a2 - a1) * s / steps) * Math.PI / 180; pts.push([e.cx + e.r * Math.cos(a), e.cy + e.r * Math.sin(a)]); }
              drawPoly(pts);
            } else if (e.t === 'poly') {
              const pts = e.closed ? e.pts.concat([e.pts[0]]) : e.pts;
              drawPoly(pts);
            }
          }
          if (h.el('#dxBounds').classList.contains('on')) page.drawRectangle({ x: X(minx), y: Y(miny), width: (maxx - minx) * k, height: (maxy - miny) * k, borderColor: P.rgb(0.6, 0.6, 0.6), borderWidth: 0.5 });
          const bytes = await out.save({ useObjectStreams: true });
          await outFile(S, h, bytes, slugBase(S.files, 'drawing'));
          h.out(`已绘制 <b>${ents.length}</b> 个图元 · <b>${window.fmtSize(bytes.length)}</b>`);
        } catch (e) { console.error(e); window.toast('失败：' + e.message); }
        h.busy(false);
      }
    });
  }

  /* ======================= C. PDF → 图片 / 阅读器 ======================= */
  function canvasToBlob(c, type, q) { return new Promise(res => c.toBlob(b => res(b), type, q)); }
  function hPdfRaster(host, cfg, slug) {
    const isPng = slug === 'pdf-to-png';
    const { stage, pane } = window.TUI.shell(host, true);
    const S = { doc: null, page: 0, n: 0, file: null };
    stage.innerHTML = window.TUI.drop(dropInner({ title: '选择 PDF', hint: '拖入或点击选择；随后可预览与导出', icon: 'pdf' }), '.pdf,application/pdf', false) +
      `<div id="rzWrap" class="hide" style="margin-top:12px">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
          <button class="btn-ghost btn-sm" id="rzPrev"><svg data-lucide="chevron-left" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>
          <span class="mini" id="rzLabel">—</span>
          <button class="btn-ghost btn-sm" id="rzNext"><svg data-lucide="chevron-right" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>
        </div>
        <div class="canvaswrap" style="text-align:center"><canvas id="rzCanvas" style="max-width:100%;max-height:460px;background:#fff;border-radius:8px"></canvas></div>
      </div>`;
    pane.innerHTML = window.TUI.head(isPng ? 'PDF → PNG' : 'PDF → JPG', '逐页渲染为图片。渲染为本引擎本地近似实现（见页面下方说明）。') +
      window.TUI.field('分辨率', window.TUI.sel('rzDpi', [{ v: '96', t: '96 dpi（屏幕）' }, { v: '120', t: '120 dpi' }, { v: '150', t: '150 dpi（推荐）' }, { v: '200', t: '200 dpi' }, { v: '300', t: '300 dpi（打印）' }], '150')) +
      (isPng ? '' : window.TUI.field('质量', window.TUI.range('rzQ', 40, 100, 85))) +
      window.TUI.field('导出范围', window.TUI.sel('rzRange', [{ v: 'all', t: '全部页面' }, { v: 'one', t: '仅当前页' }, { v: 'some', t: '指定页（如 1,3,5-7）' }], 'all')) +
      window.TUI.field('指定页', window.TUI.input('rzPages', '', '留空表示全部')) +
      `<div class="outbox" id="rzInfo">尚未载入 PDF</div>
       <button class="btn-lime btn-run" id="rzGo">导出并下载</button>
       <div class="progress" id="tProg" style="display:none"><i></i></div>
       <div class="warnbox">诚实说明：环境中的 pdfjs 缺少 worker（无法工作），因此这里用 pdf-lib 对象模型 + 本引擎自带的 Canvas 子集渲染器。对绝大多数文字/图形页面可用；复杂渐变、透明度混合、部分字体可能有细微差异。</div>`;
    async function show() {
      const P = await getPDFLib();
      const pages = S.doc.getPages();
      const page = pages[S.page];
      const c = await renderPageToCanvas(P, S.doc, page, 1.05);
      const cv = stage.querySelector('#rzCanvas');
      cv.width = c.width; cv.height = c.height; cv.getContext('2d').drawImage(c, 0, 0);
      stage.querySelector('#rzLabel').textContent = `第 ${S.page + 1} / ${S.n} 页`;
      cv._src = c;
    }
    stage.querySelector('#rzPrev').onclick = async () => { if (S.page > 0) { S.page--; await show(); } };
    stage.querySelector('#rzNext').onclick = async () => { if (S.page < S.n - 1) { S.page++; await show(); } };
    window.TUI.bindDrop(stage, '.pdf,application/pdf', false, async list => {
      try {
        const P = await getPDFLib();
        S.doc = await P.PDFDocument.load(bufOf(await window.TUI.readBuf(list[0])), { ignoreEncryption: true, updateMetadata: false });
        S.file = list[0]; S.n = S.doc.getPageCount(); S.page = 0;
        stage.querySelector('#tDrop').classList.add('hide');
        stage.querySelector('#rzWrap').classList.remove('hide');
        pane.querySelector('#rzInfo').innerHTML = `共 <b>${S.n}</b> 页 · <b>${window.fmtSize(list[0].size)}</b>`;
        await show();
      } catch (e) { console.error(e); window.toast('读取失败：' + e.message); }
    });
    pane.querySelector('#rzGo').addEventListener('click', async () => {
      if (!S.doc) return window.toast('请先选择 PDF');
      const btn = pane.querySelector('#rzGo'); btn.disabled = true; btn.textContent = '渲染中…';
      try {
        const P = await getPDFLib();
        const dpi = parseInt(pane.querySelector('#rzDpi').value, 10) || 150;
        const scale = dpi / 72;
        const q = (parseInt(pane.querySelector('#rzQ') ? pane.querySelector('#rzQ').value : '85', 10) || 85) / 100;
        const rangeMode = pane.querySelector('#rzRange').value;
        let idxs;
        if (rangeMode === 'one') idxs = [S.page];
        else if (rangeMode === 'some') { idxs = rangeParse(pane.querySelector('#rzPages').value, S.n).map(v => v - 1); if (!idxs.length) throw new Error('页范围无效'); }
        else idxs = Array.from({ length: S.n }, (_, i) => i);
        const files = [];
        const base = (S.file.name || 'document').replace(/\.[^.]+$/, '');
        for (let k = 0; k < idxs.length; k++) {
          const c = await renderPageToCanvas(P, S.doc, S.doc.getPages()[idxs[k]], scale);
          const blob = await canvasToBlob(c, isPng ? 'image/png' : 'image/jpeg', isPng ? undefined : q);
          files.push({ name: `${base}-page-${String(idxs[k] + 1).padStart(3, '0')}.${isPng ? 'png' : 'jpg'}`, data: new Uint8Array(await blob.arrayBuffer()) });
          window.TUI.prog(pane.querySelector('#tProg'), (k + 1) / idxs.length * 100);
          await sleep(0);
        }
        if (files.length === 1) {
          window.downloadBlob(new Blob([files[0].data], { type: isPng ? 'image/png' : 'image/jpeg' }), files[0].name);
          pane.querySelector('#rzInfo').innerHTML = `已导出 <b>${files[0].name}</b> · <b>${window.fmtSize(files[0].data.length)}</b>`;
        } else {
          const z = await zipWrite(files);
          const nm = base + (isPng ? '-png.zip' : '-jpg.zip');
          window.downloadBlob(new Blob([z], { type: 'application/zip' }), nm);
          pane.querySelector('#rzInfo').innerHTML = `已导出 <b>${files.length}</b> 张 (${dpi}dpi) · <b>${window.fmtSize(z.length)}</b>`;
        }
        window.toast('导出完成');
      } catch (e) { console.error(e); window.toast('失败：' + e.message); }
      btn.disabled = false; btn.textContent = '导出并下载';
    });
  }

  function hPdfReader(host) {
    const { stage, pane } = window.TUI.shell(host, true);
    const S = { doc: null, page: 0, n: 0, zoom: 1.2 };
    stage.innerHTML = window.TUI.drop(dropInner({ title: '选择 PDF 打开阅读器', hint: '拖入或点击选择', icon: 'pdf' }), '.pdf,application/pdf', false) +
      `<div id="rdWrap" class="hide" style="margin-top:12px">
        <div class="canvaswrap" style="max-height:620px;overflow:auto;text-align:center;background:#0f0f0f;border-radius:10px;padding:10px">
          <canvas id="rdCanvas" style="background:#fff;box-shadow:0 4px 24px #000a"></canvas>
        </div>
      </div>`;
    pane.innerHTML = window.TUI.head('PDF 阅读器', '翻页、跳页、缩放。本地渲染。') +
      `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div>${window.TUI.field('页码', window.TUI.input('rdPage', '1', '1', 'number'))}</div>
        <div>${window.TUI.field('缩放', window.TUI.input('rdZoom', '1.2', '1.2', 'number'))}</div></div>
       <div class="shapes" style="margin-top:4px">
         <button class="btn-ghost btn-sm" id="rdPrev">上一页</button>
         <button class="btn-ghost btn-sm" id="rdNext">下一页</button>
         <button class="btn-ghost btn-sm" id="rdFit">适应宽度</button></div>
       <div class="outbox" id="rdInfo">尚未载入 PDF</div>
       <div class="warnbox">渲染为本地近似实现（pdfjs 在本环境缺少 worker 不可用）；文字与常见图形正确，复杂效果可能有差异。</div>`;
    async function show() {
      const P = await getPDFLib();
      const page = S.doc.getPages()[S.page];
      const c = await renderPageToCanvas(P, S.doc, page, S.zoom);
      const cv = stage.querySelector('#rdCanvas');
      cv.width = c.width; cv.height = c.height; cv.getContext('2d').drawImage(c, 0, 0);
      pane.querySelector('#rdPage').value = S.page + 1;
      pane.querySelector('#rdInfo').innerHTML = `第 <b>${S.page + 1}</b> / ${S.n} 页 · 缩放 ${S.zoom.toFixed(2)}×`;
    }
    window.TUI.bindDrop(stage, '.pdf,application/pdf', false, async list => {
      try {
        const P = await getPDFLib();
        S.doc = await P.PDFDocument.load(bufOf(await window.TUI.readBuf(list[0])), { ignoreEncryption: true, updateMetadata: false });
        S.n = S.doc.getPageCount(); S.page = 0;
        stage.querySelector('#tDrop').classList.add('hide');
        stage.querySelector('#rdWrap').classList.remove('hide');
        await show();
      } catch (e) { console.error(e); window.toast('读取失败：' + e.message); }
    });
    pane.querySelector('#rdPrev').onclick = async () => { if (S.doc && S.page > 0) { S.page--; await show(); } };
    pane.querySelector('#rdNext').onclick = async () => { if (S.doc && S.page < S.n - 1) { S.page++; await show(); } };
    pane.querySelector('#rdFit').onclick = async () => { if (!S.doc) return; const sz = pageSize(S.doc.getPages()[S.page]); S.zoom = clamp((stage.clientWidth - 60) / sz.w, 0.3, 4); pane.querySelector('#rdZoom').value = S.zoom.toFixed(2); await show(); };
    pane.querySelector('#rdZoom').addEventListener('change', async () => { if (!S.doc) return; S.zoom = clamp(parseFloat(pane.querySelector('#rdZoom').value) || 1, 0.3, 4); await show(); });
    pane.querySelector('#rdPage').addEventListener('change', async () => { if (!S.doc) return; const v = clamp(parseInt(pane.querySelector('#rdPage').value, 10) || 1, 1, S.n); S.page = v - 1; await show(); });
    pane.addEventListener('keydown', e => { if (e.key === 'ArrowRight') pane.querySelector('#rdNext').click(); if (e.key === 'ArrowLeft') pane.querySelector('#rdPrev').click(); });
  }

  /* ======================= C. PDF → 文本 / Word ======================= */
  function hPdfToText(host) {
    const { stage, pane } = window.TUI.shell(host, true);
    const S = { pages: null, file: null };
    stage.innerHTML = window.TUI.drop(dropInner({ title: '选择 PDF', hint: '拖入或点击选择；随后可复制或下载纯文本', icon: 'pdf' }), '.pdf,application/pdf', false) +
      `<div id="txWrap" class="hide" style="margin-top:12px">
        <div class="io" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="col"><div class="colhead"><span class="t">抽取结果</span><span class="mini" id="txStat">—</span></div>
            <textarea id="txOut" style="min-height:420px;font-family:var(--mono);font-size:12px" readonly></textarea></div>
        </div>
      </div>`;
    pane.innerHTML = window.TUI.head('PDF → 文本', '按阅读顺序抽取每页文字（本地解析内容流，含 ToUnicode 映射）。') +
      window.TUI.chk('txSep', '页之间插入分页标记', true) +
      window.TUI.chk('txTrim', '合并多余空行', true) +
      `<div class="outbox" id="txInfo">尚未载入 PDF</div>
       <button class="btn-lime btn-run" id="txCopy">复制全部文本</button>
       <button class="btn-ghost btn-run" id="txDown" style="margin-top:8px">下载 .txt</button>
       <div class="progress" id="tProg" style="display:none"><i></i></div>
       <div class="warnbox">诚实说明：文字抽取基于 PDF 内容流与字体编码；扫描版 PDF（整页是图片）无法抽出文字——请先做 OCR。本工具不做 OCR。</div>`;
    pane.addEventListener('click', e => { const c = e.target.closest('.chk'); if (c) c.classList.toggle('on'); });
    function buildText() {
      if (!S.pages) return '';
      const sep = pane.querySelector('#txSep').classList.contains('on');
      const trim = pane.querySelector('#txTrim').classList.contains('on');
      let parts = S.pages.map((t, i) => sep ? `----- 第 ${i + 1} 页 -----\n${t}` : t);
      let out = parts.join('\n\n');
      if (trim) out = out.replace(/\n{3,}/g, '\n\n');
      return out;
    }
    window.TUI.bindDrop(stage, '.pdf,application/pdf', false, async list => {
      S.file = list[0];
      stage.querySelector('#tDrop').classList.add('hide');
      stage.querySelector('#txWrap').classList.remove('hide');
      const ta = stage.querySelector('#txOut');
      ta.value = '正在抽取…';
      const btn = pane.querySelector('#txCopy'); btn.disabled = true;
      try {
        S.pages = await extractAllText(bufOf(await window.TUI.readBuf(list[0])));
        ta.value = buildText();
        const chars = ta.value.length;
        stage.querySelector('#txStat').textContent = `${S.pages.length} 页 · ${chars} 字符`;
        pane.querySelector('#txInfo').innerHTML = `共 <b>${S.pages.length}</b> 页 · <b>${chars}</b> 字符`;
      } catch (e) { console.error(e); ta.value = ''; window.toast('抽取失败：' + e.message); pane.querySelector('#txInfo').textContent = '抽取失败：' + e.message; }
      btn.disabled = false;
    });
    pane.querySelector('#txCopy').onclick = () => { const t = buildText(); if (!t) return window.toast('还没有内容'); window.copyText(t); };
    pane.querySelector('#txDown').onclick = () => {
      const t = buildText(); if (!t) return window.toast('还没有内容');
      const name = (S.file ? S.file.name.replace(/\.[^.]+$/, '') : 'document') + '.txt';
      window.downloadBlob(new Blob([t], { type: 'text/plain;charset=utf-8' }), name);
      window.toast('已下载 ' + name);
    };
  }

  function wordDocHtml(title, bodyHtml) {
    return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:"PingFang SC","Microsoft YaHei",Georgia,serif;line-height:1.7;font-size:11pt}h1{font-size:18pt}h2{font-size:14pt}pre{font-family:Consolas,monospace;background:#f5f5f5;padding:8px}</style></head><body>${bodyHtml}</body></html>`;
  }
  function hPdfToWord(host) {
    fileTask(host, {
      dropTitle: '选择 PDF', accept: '.pdf,application/pdf', runLabel: '生成 .doc 并下载',
      onStage: async (list, h) => { h.showFiles(list); h.out(`已选择 <b>${esc(list[0].name)}</b>`); },
      paneHtml: window.TUI.head('PDF → Word', '抽取文字与段落层级，生成 Word 可直接打开的 .doc（HTML 形式）。') +
        window.TUI.field('标题（可选）', window.TUI.input('pwTitle', '', '留空则不添加')) +
        window.TUI.chk('pwHeads', '按行长/缩进猜测标题层级', true) +
        `<div class="warnbox">输出为 .doc（HTML 形式，Word/WPS 可直接打开）。不做版面还原、不保留图片与表格边框。</div>`,
      init: h => { h.pane.addEventListener('click', e => { const c = e.target.closest('.chk'); if (c) c.classList.toggle('on'); }); },
      run: async (S, h) => {
        if (!S.files.length) return window.toast('请先选择 PDF');
        h.busy(true);
        try {
          const pages = await extractAllText(bufOf(await window.TUI.readBuf(S.files[0])));
          const title = h.q('pwTitle');
          const guess = h.el('#pwHeads').classList.contains('on');
          let html = title ? `<h1>${esc(title)}</h1>` : '';
          pages.forEach((t, pi) => {
            html += `<div style="page-break-after:always">`;
            for (const para of t.split('\n')) {
              const p = para.trim();
              if (!p) continue;
              if (guess && p.length < 26 && !/[。.!?;:,，。；：]$/.test(p)) html += `<h2>${esc(p)}</h2>`;
              else html += `<p>${esc(p)}</p>`;
            }
            html += `</div>`;
            void pi;
          });
          const doc = wordDocHtml(title || (S.files[0].name.replace(/\.[^.]+$/, '')), html);
          const bytes = utf8(doc);
          await outFile(S, h, bytes, slugBase(S.files, 'converted', 'doc'), 'application/msword');
          h.out(`已生成 .doc · <b>${window.fmtSize(bytes.length)}</b>（共 ${pages.length} 页文字）`);
        } catch (e) { console.error(e); window.toast('失败：' + e.message); }
        h.busy(false);
      }
    });
  }

  /* ======================= C. PDF → 表格（账单/发票行） ======================= */
  function rowsToGrid(rows, header) {
    const grid = [];
    const hd = ['日期', '描述', '金额', '余额', '原始行'];
    grid.push(hd);
    for (const r of rows) {
      if (r.type === 'header') continue;
      if (r.type === 'other') { grid.push(['', r.raw.slice(0, 120), '', '', r.raw]); continue; }
      const amts = r.amounts || [];
      let date = r.date || '', desc = r.desc || '', amount = '', balance = '';
      if (amts.length >= 2) { amount = amts[amts.length - 2]; balance = amts[amts.length - 1]; }
      else if (amts.length === 1) amount = amts[0];
      grid.push([date, desc, amount, balance, r.raw]);
    }
    return grid;
  }
  function hPdfExtractTable(host, cfg, slug) {
    const isBank = /bank/.test(slug);
    const isQbo = slug === 'pdf-to-qbo';
    const { stage, pane } = window.TUI.shell(host, true);
    const S = { pages: null, file: null };
    stage.innerHTML = window.TUI.drop(dropInner({ title: '选择 PDF（账单 / 发票）', hint: '也可以直接在下方粘贴文本', icon: 'pdf' }), '.pdf,application/pdf', false) +
      `<div style="margin-top:12px">${window.TUI.area('ptPaste', '', '或在此粘贴对账单 / 发票文本（每行一条记录）…', 6)}</div>
       <div style="margin-top:10px">${window.TUI.area('ptRaw', '', '抽取到的原始文本会显示在这里…', 8)}</div>
       <div id="ptGridWrap" style="margin-top:12px"></div>`;
    pane.innerHTML = window.TUI.head(isQbo ? 'PDF → QBO(CSV)' : (isBank ? 'PDF → 银行流水表格' : 'PDF → 表格'), '抽取日期/描述/金额/余额，可在表格里手工修正后再下载。') +
      `<div class="shapes" style="margin-bottom:8px"><button class="btn-ghost btn-sm" id="ptRun">从 PDF 抽取</button><button class="btn-ghost btn-sm" id="ptFromPaste">从粘贴文本抽取</button></div>` +
      `<div class="outbox" id="ptInfo">尚未抽取</div>
       <button class="btn-lime btn-run" id="ptCsv">下载 CSV</button>
       <div class="progress" id="tProg" style="display:none"><i></i></div>
       <div class="warnbox">诚实说明：这是基于文本正则的抽取（覆盖常见 月/日/年 与金额格式），不是 OCR；扫描件请先做文字识别。抽取后请在表格里核对修正。</div>`;
    let grid = null;
    function renderGrid() {
      const wrap = stage.querySelector('#ptGridWrap');
      if (!grid) { wrap.innerHTML = ''; return; }
      wrap.innerHTML = `<div class="colhead"><span class="t">可编辑表格</span><span class="mini">${grid.length - 1} 行</span></div>
        <div style="max-height:320px;overflow:auto;border:1px solid #232323;border-radius:10px">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
        <tr>${grid[0].map(h => `<th style="position:sticky;top:0;background:#1b1b1b;padding:6px;text-align:left;border-bottom:1px solid #2a2a2a">${esc(h)}</th>`).join('')}</tr>
        ${grid.slice(1).map((r, ri) => `<tr>${r.map((c, ci) => `<td style="padding:2px;border-bottom:1px solid #1e1e1e"><input data-r="${ri + 1}" data-c="${ci}" value="${esc(c)}" style="width:100%;background:#101010;border:1px solid #222;border-radius:4px;color:#e5e5e5;padding:4px;font-size:12px"></td>`).join('')}</tr>`).join('')}
        </table></div>`;
      wrap.querySelectorAll('input[data-r]').forEach(inp => inp.addEventListener('input', () => { grid[+inp.dataset.r][+inp.dataset.c] = inp.value; }));
    }
    function doExtract(text) {
      const { rows, header } = extractTableRows(text);
      if (!rows.filter(r => r.type === 'row').length) {
        window.toast('没识别到金额/日期行，已保留原始文本供手工整理');
        grid = [['日期', '描述', '金额', '余额', '原始行']];
      } else grid = rowsToGrid(rows, header);
      renderGrid();
      pane.querySelector('#ptInfo').innerHTML = `识别到 <b>${grid.length - 1}</b> 行 · 请核对后下载`;
    }
    window.TUI.bindDrop(stage, '.pdf,application/pdf', false, async list => {
      S.file = list[0];
      const ta = stage.querySelector('#ptRaw');
      ta.value = '正在抽取…';
      try {
        S.pages = await extractAllText(bufOf(await window.TUI.readBuf(list[0])));
        const text = S.pages.join('\n');
        ta.value = text.slice(0, 20000);
        doExtract(text);
      } catch (e) { console.error(e); ta.value = ''; window.toast('抽取失败：' + e.message); }
    });
    pane.querySelector('#ptRun').onclick = () => {
      const t = stage.querySelector('#ptRaw').value;
      if (!t.trim()) return window.toast('请先选择 PDF 或点击“从粘贴文本抽取”');
      doExtract(t);
    };
    pane.querySelector('#ptFromPaste').onclick = () => {
      const t = stage.querySelector('#ptPaste').value;
      if (!t.trim()) return window.toast('请先粘贴文本');
      stage.querySelector('#ptRaw').value = t;
      doExtract(t);
    };
    pane.querySelector('#ptCsv').onclick = () => {
      if (!grid) return window.toast('还没有可下载的表格');
      let out = grid;
      if (isQbo) {
        out = [['Date', 'Description', 'Amount']].concat(grid.slice(1).map(r => [r[0], r[1], r[2]]));
      }
      const csv = csvStringify(out);
      const name = (S.file ? S.file.name.replace(/\.[^.]+$/, '') : 'statement') + (isBank ? '-bank.csv' : isQbo ? '-qbo.csv' : '-table.csv');
      window.downloadBlob(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }), name);
      pane.querySelector('#ptInfo').innerHTML = `已下载 <b>${esc(name)}</b> · ${out.length - 1} 行`;
      window.toast('已下载 CSV');
    };
  }

  /* ======================= C. PDF → PPT（逐页 PNG） ======================= */
  function hPdfToPpt(host) {
    fileTask(host, {
      dropTitle: '选择 PDF', accept: '.pdf,application/pdf', runLabel: '导出逐页图片 + 索引',
      onStage: async (list, h) => {
        h.showFiles(list);
        try { const P = await getPDFLib(); const d = await P.PDFDocument.load(bufOf(await window.TUI.readBuf(list[0])), { ignoreEncryption: true }); h.out(`共 <b>${d.getPageCount()}</b> 页`); } catch (e) { window.toast('读取失败'); }
      },
      paneHtml: window.TUI.head('PDF → PPT（图片）', '浏览器端无法生成真正的 .pptx（不引第三方库）。这里导出每页 PNG，可直接插入 PowerPoint/Keynote。') +
        window.TUI.field('分辨率', window.TUI.sel('ppDpi', [{ v: '110', t: '110 dpi' }, { v: '150', t: '150 dpi（推荐）' }, { v: '200', t: '200 dpi' }], '150')) +
        `<div class="warnbox">诚实说明：产出为 <b>page-001.png … 序列 + index.html 索引页</b>，打包成 ZIP。PowerPoint 里用“插入 → 图片 → 全选”即可每页一图铺满幻灯片。</div>`,
      run: async (S, h) => {
        if (!S.files.length) return window.toast('请先选择 PDF');
        h.busy(true);
        try {
          const P = await getPDFLib();
          const doc = await P.PDFDocument.load(bufOf(await window.TUI.readBuf(S.files[0])), { ignoreEncryption: true, updateMetadata: false });
          const dpi = parseInt(h.q('ppDpi'), 10) || 150;
          const n = doc.getPageCount();
          const base = (S.files[0].name || 'document').replace(/\.[^.]+$/, '');
          const files = []; const names = [];
          for (let i = 0; i < n; i++) {
            const c = await renderPageToCanvas(P, doc, doc.getPages()[i], dpi / 72);
            const blob = await canvasToBlob(c, 'image/png');
            const nm = `page-${String(i + 1).padStart(3, '0')}.png`;
            files.push({ name: nm, data: new Uint8Array(await blob.arrayBuffer()) });
            names.push(nm);
            h.prog((i + 1) / n * 100);
            await sleep(0);
          }
          const index = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>${esc(base)} — 幻灯片图片索引</title>
<style>body{font-family:-apple-system,"PingFang SC",sans-serif;background:#111;color:#eee;margin:0;padding:24px}img{max-width:100%;display:block;margin:0 auto 24px;border:1px solid #333}h2{font-weight:500}</style></head><body>
<h1>${esc(base)} — 共 ${names.length} 页</h1><p>将本文件夹内的图片插入 PowerPoint，或将下面的图片逐一复制。</p>
${names.map((nm, i) => `<h2>第 ${i + 1} 页</h2><img src="${nm}" alt="page ${i + 1}">`).join('\n')}
</body></html>`;
          files.push({ name: 'index.html', data: utf8(index) });
          const z = await zipWrite(files);
          window.downloadBlob(new Blob([z], { type: 'application/zip' }), base + '-slides.zip');
          h.out(`已导出 <b>${n}</b> 页 PNG + 索引页 · <b>${window.fmtSize(z.length)}</b>`);
          window.toast('已下载 ' + window.fmtSize(z.length));
        } catch (e) { console.error(e); window.toast('失败：' + e.message); }
        h.busy(false);
      }
    });
  }

  /* ======================= C. compare-pdf ======================= */
  function hComparePdf(host) {
    const { stage, pane } = window.TUI.shell(host, true);
    const S = { files: [] };
    stage.innerHTML = window.TUI.drop(dropInner({ title: '选择两个 PDF', hint: '依次拖入两个文件（旧版本 / 新版本）', icon: 'pdf' }), '.pdf,application/pdf', true) +
      '<div id="cpList" style="margin-top:12px"></div><div id="cpOut" style="margin-top:12px"></div>';
    pane.innerHTML = window.TUI.head('对比 PDF', '逐页抽取文字并做行级差异比对，标出差异页号与差异行。') +
      `<div class="outbox" id="cpInfo">已选 0 / 2 个文件</div>
       <button class="btn-lime btn-run" id="cpGo">开始对比</button>
       <div class="progress" id="tProg" style="display:none"><i></i></div>
       <div class="warnbox">基于文本对比；若两版是扫描件（图片）则无法比对文字。忽略空白行差异。</div>`;
    window.TUI.bindDrop(stage, '.pdf,application/pdf', true, list => {
      S.files = list.slice(0, 2);
      stage.querySelector('#cpList').innerHTML = S.files.map((f, i) => `<div class="filebar" style="margin-bottom:6px"><span><b>${i === 0 ? 'A（旧）' : 'B（新）'}：</b>${esc(f.name)}</span><span class="mini">${window.fmtSize(f.size)}</span></div>`).join('');
      pane.querySelector('#cpInfo').innerHTML = `已选 <b>${S.files.length}</b> / 2 个文件`;
      const dd = stage.querySelector('#tDrop'); if (dd) dd.classList.add('hide');
    });
    pane.querySelector('#cpGo').onclick = async () => {
      if (S.files.length < 2) return window.toast('请选择两个 PDF');
      const btn = pane.querySelector('#cpGo'); btn.disabled = true; btn.textContent = '对比中…';
      try {
        const a = await extractAllText(bufOf(await window.TUI.readBuf(S.files[0])));
        const b = await extractAllText(bufOf(await window.TUI.readBuf(S.files[1])));
        const n = Math.max(a.length, b.length);
        let diffPages = 0, addLines = 0, delLines = 0;
        let html = `<div class="colhead"><span class="t">差异结果</span><span class="mini">A: ${a.length} 页 · B: ${b.length} 页</span></div><div style="max-height:520px;overflow:auto">`;
        for (let i = 0; i < n; i++) {
          const ta = (a[i] || '').replace(/\r/g, '').split('\n').filter(x => x.trim() !== '');
          const tb = (b[i] || '').replace(/\r/g, '').split('\n').filter(x => x.trim() !== '');
          const d = diffLines(ta.join('\n'), tb.join('\n'));
          const changed = d.filter(x => x.t !== ' ');
          if (!changed.length) continue;
          diffPages++;
          changed.forEach(x => { if (x.t === '+') addLines++; else if (x.t === '-') delLines++; });
          html += `<div style="margin:10px 0;border:1px solid #232323;border-radius:10px;overflow:hidden">
            <div style="background:#1b1b1b;padding:6px 10px;font-size:12px">第 ${i + 1} 页 · 差异 ${changed.length} 行</div>
            <div style="font-family:var(--mono);font-size:12px">` +
            changed.map(x => `<div style="padding:3px 10px;white-space:pre-wrap;word-break:break-all;background:${x.t === '+' ? 'rgba(60,180,90,.16)' : 'rgba(200,70,70,.16)'};border-left:3px solid ${x.t === '+' ? '#3cb45a' : '#c84646'}">${x.t === '+' ? '+' : '-'} ${esc(x.v)}</div>`).join('') +
            `</div></div>`;
        }
        if (!diffPages) html += '<div class="emptystate">两份 PDF 的文字内容一致（忽略空白行）。</div>';
        html += '</div>';
        stage.querySelector('#cpOut').innerHTML = html;
        pane.querySelector('#cpInfo').innerHTML = `差异页 <b>${diffPages}</b> · 新增 <b>${addLines}</b> 行 · 删除 <b>${delLines}</b> 行`;
        if (!diffPages) window.toast('未发现文字差异');
      } catch (e) { console.error(e); window.toast('对比失败：' + e.message); }
      btn.disabled = false; btn.textContent = '开始对比';
    };
  }

  /* ======================= D. 检查类 ======================= */
  function pdfVersion(bytes) { const m = latin1(bytes.subarray(0, 16)).match(/%PDF-(\d\.\d)/); return m ? m[1] : '未知'; }
  function isLinearized(bytes) { return /\/Linearized/.test(latin1(bytes.subarray(0, 2048))); }
  function fontListForPage(P, ctx, page) {
    const out = [];
    const res = page.node.Resources ? page.node.Resources() : null;
    const fd = dicGet(P, ctx, res, 'Font');
    if (!fd || !fd.entries) return out;
    for (const [k, v] of fd.entries()) {
      const f = ctx.lookup(v);
      if (!f || !f.get) continue;
      const base = pname(dicGet(P, ctx, f, 'BaseFont'));
      const sub = pname(dicGet(P, ctx, f, 'Subtype'));
      const desc = dicGet(P, ctx, f, 'FontDescriptor');
      let embedded = false, kind = '';
      if (desc) {
        if (dicGet(P, ctx, desc, 'FontFile2')) { embedded = true; kind = 'TrueType'; }
        else if (dicGet(P, ctx, desc, 'FontFile3')) { embedded = true; kind = 'CFF/Type1C'; }
        else if (dicGet(P, ctx, desc, 'FontFile')) { embedded = true; kind = 'Type1'; }
      }
      if (sub === 'Type0') {
        const df = dicGet(P, ctx, f, 'DescendantFonts');
        if (df && df.asArray) { const d0 = ctx.lookup(df.asArray()[0]); const d1 = d0 && dicGet(P, ctx, d0, 'FontDescriptor'); if (d1 && dicGet(P, ctx, d1, 'FontFile2')) { embedded = true; kind = 'CID TrueType'; } }
      }
      const std = /Helvetica|Times|Courier|Symbol|Zapf/.test(base);
      out.push({ name: k, base, sub, embedded, kind, standard: std });
    }
    return out;
  }
  function imagesOnPage(P, ctx, page, events) {
    // 追踪 cm / q / Q 以估算图片显示尺寸
    const res = page.node.Resources ? page.node.Resources() : null;
    const xo = dicGet(P, ctx, res, 'XObject');
    const imgs = [];
    if (!xo || !xo.entries) return imgs;
    const dict = {};
    for (const [k, v] of xo.entries()) { const x = ctx.lookup(v); if (x && x.dict && pname(dicGet(P, ctx, x.dict, 'Subtype')) === 'Image') dict[k] = x; }
    if (!Object.keys(dict).length) return imgs;
    let ctm = [1, 0, 0, 1, 0, 0]; const stack = [];
    for (const ev of events) {
      const a = ev.args;
      if (ev.op === 'q') stack.push(ctm.slice());
      else if (ev.op === 'Q') { const s = stack.pop(); if (s) ctm = s; }
      else if (ev.op === 'cm') ctm = mul(ctm, [+a[0] || 0, +a[1] || 0, +a[2] || 0, +a[3] || 0, +a[4] || 0, +a[5] || 0]);
      else if (ev.op === 'Do') {
        const nm = a[0] && a[0].n;
        if (nm && dict[nm]) {
          const st = dict[nm];
          const iw = pnum(dicGet(P, ctx, st.dict, 'Width')), ih = pnum(dicGet(P, ctx, st.dict, 'Height'));
          const dw = Math.hypot(ctm[0], ctm[1]) || 1, dh = Math.hypot(ctm[2], ctm[3]) || 1;
          imgs.push({ name: nm, w: iw, h: ih, dispW: dw, dispH: dh, dpiX: dw ? iw / (dw / 72) : 0, dpiY: dh ? ih / (dh / 72) : 0 });
        }
      }
    }
    return imgs;
  }

  function checkTask(host, o) {
    const { stage, pane } = window.TUI.shell(host, true);
    stage.innerHTML = window.TUI.drop(dropInner({ title: o.dropTitle, hint: '拖入或点击选择', icon: 'pdf' }), '.pdf,application/pdf', false) +
      '<div id="ckOut" style="margin-top:14px"></div>';
    pane.innerHTML = window.TUI.head(o.title, o.desc) + (o.paneHtml || '') +
      `<button class="btn-lime btn-run" id="ckGo">运行检查</button>
       <div class="progress" id="tProg" style="display:none"><i></i></div>
       <div class="warnbox">${o.warn || ''}</div>`;
    let S = null;
    window.TUI.bindDrop(stage, '.pdf,application/pdf', false, async list => {
      try {
        S = { file: list[0], bytes: bufOf(await window.TUI.readBuf(list[0])), doc: null, P: null };
        const P = await getPDFLib();
        S.P = P;
        S.doc = await P.PDFDocument.load(S.bytes, { ignoreEncryption: true, updateMetadata: false });
        stage.querySelector('#tDrop').classList.add('hide');
        pane.querySelector('#ckOut') && null;
        pane.querySelector('#ckGo').click();
      } catch (e) { console.error(e); window.toast('读取失败：' + e.message); }
    });
    pane.querySelector('#ckGo').addEventListener('click', async () => {
      if (!S) return window.toast('请先选择 PDF');
      const btn = pane.querySelector('#ckGo'); btn.disabled = true; btn.textContent = '检查中…';
      try { await o.run(S, stage, pane); } catch (e) { console.error(e); window.toast('检查失败：' + e.message); }
      btn.disabled = false; btn.textContent = '运行检查';
    });
  }
  function tableHtml(rows, widths) {
    const cols = rows[0].length;
    return `<table style="width:100%;border-collapse:collapse;font-size:12.5px">${rows.map((r, ri) => `<tr>${r.map((c, ci) => `<t${ri === 0 ? 'h' : 'd'} style="text-align:left;padding:6px 8px;border-bottom:1px solid #232323;${ri === 0 ? 'background:#1b1b1b;color:#cfcfcf;' : 'color:#e5e5e5;'}${widths && widths[ci] ? 'width:' + widths[ci] + ';' : ''}">${c == null ? '' : c}</t${ri === 0 ? 'h' : 'd'}>`).join('')}</tr>`).join('')}</table>`;
  }
  function hPreflight(host) {
    checkTask(host, {
      title: 'PDF 预检', desc: '页数、页面尺寸、PDF 版本、是否线性化、字体嵌入、图像、文件大小等。',
      dropTitle: '选择要预检的 PDF',
      warn: '部分项（字体嵌入、图像分辨率）基于 PDF 对象字典读取；若 PDF 使用了特殊编码可能读不全，会明确标注“未检测到”。',
      run: async (S, stage, pane) => {
        const P = S.P, ctx = S.doc.context, pages = S.doc.getPages();
        const ver = pdfVersion(S.bytes);
        const lin = isLinearized(S.bytes);
        const sizes = new Map();
        let allFonts = new Map(), embeddedCount = 0, totalFonts = 0, imgCount = 0, imgTotalPx = 0;
        for (let i = 0; i < pages.length; i++) {
          const sz = pageSize(pages[i]);
          const key = `${Math.round(sz.w)}×${Math.round(sz.h)}`;
          sizes.set(key, (sizes.get(key) || 0) + 1);
          const fl = fontListForPage(P, ctx, pages[i]);
          for (const f of fl) { if (!allFonts.has(f.base)) allFonts.set(f.base, f); totalFonts++; if (f.embedded) embeddedCount++; }
          const ev = parseContent(await pageContentBytes(P, ctx, pages[i]));
          const imgs = imagesOnPage(P, ctx, pages[i], ev);
          for (const im of imgs) { imgCount++; imgTotalPx += im.w * im.h; }
          if (i % 5 === 4) await sleep(0);
        }
        const rows = [['检查项', '结果', '说明']];
        rows.push(['PDF 版本', ver, ver === '未知' ? '未能从文件头读取版本' : '来自文件头 %PDF-']);
        rows.push(['页数', pages.length, '']);
        rows.push(['页面尺寸', [...sizes.entries()].map(([k, v]) => `${k} pt ×${v}`).join('<br>'), '单位 pt（1pt = 1/72 英寸）']);
        rows.push(['线性化（Fast Web View）', lin ? '是' : '否', lin ? '首部含 /Linearized，可快速首页显示' : '未发现 /Linearized 标记']);
        rows.push(['文件大小', window.fmtSize(S.bytes.length), '']);
        rows.push(['字体数量（引用）', totalFonts, '同一字体在多页重复引用会重复计数']);
        rows.push(['字体嵌入', totalFonts ? `${embeddedCount} 处已嵌入` : '未检测到字体', embeddedCount < totalFonts ? '存在未嵌入字体（标准 14 字体或缺失字体）' : '全部引用均已嵌入']);
        rows.push(['图像对象', imgCount, imgCount ? `共 ${(imgTotalPx / 1e6).toFixed(1)} 百万像素` : '未检测到图像 XObject']);
        rows.push(['加密', (function () { try { return S.doc.isEncrypted ? '是' : '否'; } catch (e) { return '未能判断'; } })(), '若为加密文件，导出/编辑前请先解除保护']);
        const bad = [];
        if (ver === '未知') bad.push('版本未知');
        if (totalFonts && embeddedCount < totalFonts) bad.push('有未嵌入字体（打印/异机可能替换字体）');
        const table = tableHtml(rows, ['26%', '30%']);
        stage.querySelector('#ckOut').innerHTML = `<div class="colhead"><span class="t">预检清单</span><span class="mini">${esc(S.file.name)}</span></div>${table}` +
          (bad.length ? `<div class="warnbox" style="margin-top:10px">注意：${bad.join('；')}</div>` : `<div class="outbox" style="margin-top:10px">未发现明显问题（基于上述检查项）。</div>`);
        pane.querySelector('#ckGo') && null;
      }
    });
  }
  function hFontChecker(host) {
    checkTask(host, {
      title: '字体检查', desc: '列出每页引用的字体名、类型与是否嵌入。',
      dropTitle: '选择 PDF',
      warn: '基于页面资源字典 /Font 读取；Type0 复合字体可能只看得到父级名称。',
      run: async (S, stage, pane) => {
        const P = S.P, ctx = S.doc.context, pages = S.doc.getPages();
        const map = new Map();
        const perPage = [];
        for (let i = 0; i < pages.length; i++) {
          const fl = fontListForPage(P, ctx, pages[i]);
          perPage.push(fl.map(f => f.name).join(', '));
          for (const f of fl) {
            const key = f.base + '|' + f.sub;
            if (!map.has(key)) map.set(key, { base: f.base, sub: f.sub, embedded: f.embedded, kind: f.kind, pages: new Set(), standard: f.standard });
            map.get(key).pages.add(i + 1);
          }
        }
        const rows = [['字体名', '类型', '嵌入', '出现页']];
        for (const v of map.values()) {
          rows.push([esc(v.base), esc(v.sub || '—'), v.embedded ? `<b style="color:#4f46e5">已嵌入</b> (${esc(v.kind)})` : '<span style="color:#f0a35e">未嵌入</span>', [...v.pages].slice(0, 20).join(', ') + (v.pages.size > 20 ? ' …' : '')]);
        }
        if (rows.length === 1) rows.push(['<span class="mini">未在页面资源中发现字体（可能是纯图片 PDF，或使用了特殊编码）</span>', '', '', '']);
        const notEmbedded = [...map.values()].filter(v => !v.embedded).length;
        stage.querySelector('#ckOut').innerHTML = `<div class="colhead"><span class="t">字体清单</span><span class="mini">${map.size} 种字体</span></div>${tableHtml(rows, ['34%', '14%', '24%'])}` +
          (notEmbedded ? `<div class="warnbox" style="margin-top:10px">有 ${notEmbedded} 种字体未嵌入。印刷前建议在源头把字体嵌入，避免替换。</div>` : `<div class="outbox" style="margin-top:10px">引用的字体均已嵌入。</div>`);
        void perPage;
      }
    });
  }
  function hDpiChecker(host) {
    checkTask(host, {
      title: '图像分辨率检查', desc: '估算每页图像的原始像素与等效 DPI。',
      dropTitle: '选择 PDF',
      warn: '估算方式：DPI = 图像像素宽 ÷（内容流 cm 变换算出的显示宽度 / 72）。若图像由复杂变换或表单生成，结果可能偏差；无图像的页面给出建议 DPI 区间。',
      run: async (S, stage, pane) => {
        const P = S.P, ctx = S.doc.context, pages = S.doc.getPages();
        const rows = [['页', '图像', '原始像素', '显示尺寸 (pt)', '等效 DPI', '评价']];
        let any = false;
        for (let i = 0; i < pages.length; i++) {
          const ev = parseContent(await pageContentBytes(P, ctx, pages[i]));
          const imgs = imagesOnPage(P, ctx, pages[i], ev);
          if (!imgs.length) { rows.push([i + 1, '—', '—', '—', '—', '无位图（矢量/文字页）']); continue; }
          for (const im of imgs) {
            any = true;
            const dpi = Math.round(Math.min(im.dpiX || 0, im.dpiY || 0));
            const verdict = dpi >= 300 ? '优（印刷级）' : dpi >= 200 ? '良' : dpi >= 150 ? '可接受' : dpi > 0 ? '偏低（可能模糊）' : '无法估算';
            rows.push([i + 1, esc(im.name), `${im.w}×${im.h}`, `${im.dispW.toFixed(0)}×${im.dispH.toFixed(0)}`, dpi || '—', verdict]);
          }
          if (i % 5 === 4) await sleep(0);
        }
        const advice = any ? '' : `<div class="outbox" style="margin-top:10px">本 PDF 未检测到位图。纯矢量页面无 DPI 概念；若用于打印，建议线条 ≥ 0.25pt、正文不小于 8pt。建议目标：照片 300dpi、文字 600dpi（据此反推扫描分辨率）。</div>`;
        stage.querySelector('#ckOut').innerHTML = `<div class="colhead"><span class="t">分辨率估算</span><span class="mini">基于内容流变换</span></div>${tableHtml(rows, ['6%', '14%', '18%', '20%'])}${advice}`;
      }
    });
  }
  function hBleedChecker(host) {
    checkTask(host, {
      title: '出血检查', desc: '按常见印刷规格比对页面尺寸，并估算内容是否留有 3mm 出血。',
      dropTitle: '选择 PDF',
      warn: '结论基于页面尺寸与内容边界框的估算：内容边界取内容流中路径坐标的极值，不含图像像素内部留白，因此仅供快速判断，不能替代印前专业检查。',
      run: async (S, stage, pane) => {
        const P = S.P, ctx = S.doc.context, pages = S.doc.getPages();
        const sheet = parseFloat(pane.querySelector('#blSheet') ? pane.querySelector('#blSheet').value : '3');
        const MM = 72 / 25.4;
        const std = [
          { name: 'A4', w: 210 * MM, h: 297 * MM }, { name: 'A3', w: 297 * MM, h: 420 * MM },
          { name: 'A5', w: 148 * MM, h: 210 * MM }, { name: 'Letter', w: 612, h: 792 },
          { name: '名片 90×54mm', w: 90 * MM, h: 54 * MM }, { name: '明信片 150×100mm', w: 150 * MM, h: 100 * MM }
        ];
        function nearest(w, h) {
          let best = null, bd = 1e9;
          for (const s of std) { const d = Math.abs(s.w - w) + Math.abs(s.h - h); if (d < bd) { bd = d; best = s; } }
          return { spec: best, dist: bd, mm: { w: (w / MM).toFixed(1), h: (h / MM).toFixed(1) } };
        }
        const rows = [['页', '页面尺寸', '最接近的常见规格', '内容边界（pt）', '出血判断']];
        for (let i = 0; i < pages.length; i++) {
          const sz = pageSize(pages[i]);
          const near = nearest(sz.w, sz.h);
          let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
          const ev = parseContent(await pageContentBytes(P, ctx, pages[i]));
          let ctm = [1, 0, 0, 1, 0, 0]; const st2 = [];
          const touch = (x, y) => { const p = applyM(ctm, x, y); if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0]; if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1]; };
          for (const e of ev) {
            const a = e.args;
            if (e.op === 'q') st2.push(ctm.slice());
            else if (e.op === 'Q') { const s = st2.pop(); if (s) ctm = s; }
            else if (e.op === 'cm') ctm = mul(ctm, [+a[0] || 0, +a[1] || 0, +a[2] || 0, +a[3] || 0, +a[4] || 0, +a[5] || 0]);
            else if (e.op === 'm' || e.op === 'l') touch(+a[0] || 0, +a[1] || 0);
            else if (e.op === 're') { touch(+a[0] || 0, +a[1] || 0); touch((+a[0] || 0) + (+a[2] || 0), (+a[1] || 0) + (+a[3] || 0)); }
          }
          let verdict = '未能估算内容边界';
          let bbox = '—';
          if (isFinite(minx)) {
            bbox = `${minx.toFixed(1)}, ${miny.toFixed(1)} → ${maxx.toFixed(1)}, ${maxy.toFixed(1)}`;
            const bleedPts = sheet * MM;
            const left = minx, bottom = miny, right = sz.w - maxx, top = sz.h - maxy;
            const minEdge = Math.min(left, bottom, right, top);
            verdict = minEdge >= bleedPts - 1 ? `内容距裁切线 ≥ ${(minEdge / MM).toFixed(1)}mm，出血充足`
              : minEdge >= 0 ? `内容距边最近 ${(minEdge / MM).toFixed(1)}mm < ${sheet}mm，出血可能不足`
                : `内容已超出页面边界（越界 ${(-minEdge / MM).toFixed(1)}mm）`;
          }
          rows.push([i + 1, `${near.mm.w}×${near.mm.h} mm`, near.dist < 6 ? near.spec.name : '自定义', bbox, verdict]);
          if (i % 5 === 4) await sleep(0);
        }
        stage.querySelector('#ckOut').innerHTML = `<div class="colhead"><span class="t">出血检查（估算）</span><span class="mini">${pages.length} 页</span></div>${tableHtml(rows, ['5%', '20%', '18%', '26%'])}
          <div class="outbox" style="margin-top:10px">说明：印刷出血通常要求 3mm（名片/明信片等小件有时 2mm）。若判定“出血不足”，请在源文件中把背景延伸到页面外 ${sheet}mm。</div>`;
      },
      paneHtml: window.TUI.field('要求出血（mm）', window.TUI.sel('blSheet', [{ v: '3', t: '3 mm（通用）' }, { v: '2', t: '2 mm（小件）' }, { v: '5', t: '5 mm（大幅面）' }], '3'))
    });
  }

  /* ======================= E. 名片拼版 ======================= */
  function hBusinessCard(host) {
    const S = { files: [] };
    const { stage, pane } = window.TUI.shell(host, true);
    stage.innerHTML = window.TUI.drop(dropInner({ title: '添加名片图（正面/背面）', hint: '拖入 1–2 张图片；将按所选规格拼满整张 A4', icon: 'image', fmts: '<b>JPG / PNG</b> · 建议 300dpi（如 1063×591 px @90×50mm）' }), 'image/*', true) + '<div id="bcList" style="margin-top:12px"></div>';
    pane.innerHTML = window.TUI.head('名片拼版', '把名片按 3×3（含出血）或 2×5 排满 A4，并加裁切标记线。') +
      window.TUI.field('每张纸排版', window.TUI.sel('bcLayout', [{ v: '3x3', t: '3 × 3（9 张，90×54mm）' }, { v: '2x5', t: '2 × 5（10 张，85×55mm）' }], '3x3')) +
      window.TUI.field('纸张', window.TUI.sel('bcPaper', [{ v: 'a4', t: 'A4' }, { v: 'letter', t: 'Letter' }], 'a4')) +
      window.TUI.chk('bcMarks', '显示裁切标记线', true) +
      `<div class="outbox" id="bcInfo">尚未添加图片</div>
       <button class="btn-lime btn-run" id="bcGo">生成拼版 PDF</button>
       <div class="progress" id="tProg" style="display:none"><i></i></div>`;
    pane.addEventListener('click', e => { const c = e.target.closest('.chk'); if (c) c.classList.toggle('on'); });
    window.TUI.bindDrop(stage, 'image/*', true, list => {
      S.files = list.slice(0, 2);
      stage.querySelector('#bcList').innerHTML = S.files.map((f, i) => `<div class="filebar" style="margin-bottom:6px"><span><b>${i === 0 ? '正面' : '背面'}：</b>${esc(f.name)}</span><span class="mini">${window.fmtSize(f.size)}</span></div>`).join('');
      pane.querySelector('#bcInfo').innerHTML = `${S.files.length} 张图片`;
      const dd = stage.querySelector('#tDrop'); if (dd) dd.classList.add('hide');
    });
    pane.querySelector('#bcGo').onclick = async () => {
      if (!S.files.length) return window.toast('请先添加名片图片');
      const btn = pane.querySelector('#bcGo'); btn.disabled = true; btn.textContent = '生成中…';
      try {
        const P = await getPDFLib();
        const out = await P.PDFDocument.create();
        const layout = pane.querySelector('#bcLayout').value;
        const paper = pane.querySelector('#bcPaper').value === 'letter' ? LETTER : A4;
        const marks = pane.querySelector('#bcMarks').classList.contains('on');
        const cols = layout === '3x3' ? 3 : 2, rows = layout === '3x3' ? 3 : 5;
        const cw = layout === '3x3' ? 90 * 72 / 25.4 : 85 * 72 / 25.4;
        const ch = layout === '3x3' ? 54 * 72 / 25.4 : 55 * 72 / 25.4;
        const gapX = (paper[0] - cols * cw) / (cols + 1);
        const gapY = (paper[1] - rows * ch) / (rows + 1);
        const imgs = [];
        for (const f of S.files) imgs.push(await embedImageFile(out, f));
        const pageCount = imgs.length; // 每张图一页（正/背面）
        for (let k = 0; k < pageCount; k++) {
          const page = out.addPage([paper[0], paper[1]]);
          const img = imgs[k];
          for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            const x = gapX + c * (cw + gapX), y = gapY + r * (ch + gapY);
            const fitK = Math.max(cw / img.width, ch / img.height);
            const dw = img.width * fitK, dh = img.height * fitK;
            page.drawImage(img, { x: x - (dw - cw) / 2, y: y - (dh - ch) / 2, width: dw, height: dh });
            if (marks) {
              const m = 4;
              page.drawLine({ start: { x: x - 8, y }, end: { x: x - 2, y }, thickness: 0.4, color: P.rgb(0.6, 0.6, 0.6) });
              page.drawLine({ start: { x, y: y - 8 }, end: { x, y: y - 2 }, thickness: 0.4, color: P.rgb(0.6, 0.6, 0.6) });
              page.drawLine({ start: { x: x + cw + 2, y }, end: { x: x + cw + 8, y }, thickness: 0.4, color: P.rgb(0.6, 0.6, 0.6) });
              page.drawLine({ start: { x: x + cw, y: y + ch + 2 }, end: { x: x + cw, y: y + ch + 8 }, thickness: 0.4, color: P.rgb(0.6, 0.6, 0.6) });
              void m;
            }
          }
          window.TUI.prog(pane.querySelector('#tProg'), (k + 1) / pageCount * 100);
          await sleep(0);
        }
        const bytes = await out.save({ useObjectStreams: true });
        const blob = new Blob([bytes], { type: 'application/pdf' });
        window.downloadBlob(blob, 'business-cards.pdf');
        pane.querySelector('#bcInfo').innerHTML = `已生成 <b>${pageCount}</b> 页拼版 · <b>${window.fmtSize(blob.size)}</b>`;
        window.toast('已下载 ' + window.fmtSize(blob.size));
      } catch (e) { console.error(e); window.toast('失败：' + e.message); }
      btn.disabled = false; btn.textContent = '生成拼版 PDF';
    };
  }

  /* ======================= F. Office / 表格 ======================= */
  function hCsvExcel(host, cfg, slug) {
    const isXls = slug === 'csv-to-excel';
    const { stage, pane } = window.TUI.shell(host, true);
    stage.innerHTML = window.TUI.drop(dropInner({ title: '选择 CSV / TSV', hint: '也可在下方粘贴表格数据', icon: 'text', fmts: '<b>CSV / TSV</b>' }), '.csv,.tsv,.txt', false) +
      `<div style="margin-top:12px">${window.TUI.area('cxText', '', '或在此粘贴（首行表头，逗号/Tab 分隔）…', 12)}</div>`;
    pane.innerHTML = window.TUI.head('CSV → Excel', '生成 Excel 可直接打开的表格文件（.xls / SpreadsheetML），不引 SheetJS。') +
      window.TUI.field('输出格式', window.TUI.sel('cxFmt', [{ v: 'html', t: '.xls（HTML 表格，兼容最好）' }, { v: 'xml', t: '.xls（SpreadsheetML，数值型单元格）' }], 'html')) +
      window.TUI.field('工作表名', window.TUI.input('cxName', 'Sheet1', 'Sheet1')) +
      `<div class="outbox" id="cxInfo">尚未载入数据</div>
       <button class="btn-lime btn-run" id="cxGo">生成并下载</button>
       <div class="progress" id="tProg" style="display:none"><i></i></div>
       <div class="warnbox">说明：产出的是“Excel 可识别的表格文件”（HTML/XML 形式），双击即可用 Excel/WPS 打开并另存为 .xlsx。</div>`;
    const ta = stage.querySelector('#cxText');
    function stat() { const r = ta.value.trim() ? parseCSV(ta.value) : []; pane.querySelector('#cxInfo').innerHTML = r.length ? `${r.length} 行 · ${r[0].length} 列` : '尚未载入数据'; }
    ta.addEventListener('input', stat);
    window.TUI.bindDrop(stage, '.csv,.tsv,.txt', false, async list => { try { ta.value = await window.TUI.readText(list[0]); stat(); } catch (e) { window.toast('读取失败'); } });
    pane.querySelector('#cxGo').onclick = () => {
      const rows = ta.value.trim() ? parseCSV(ta.value) : [];
      if (!rows.length) return window.toast('请先粘贴或选择数据');
      const fmt = pane.querySelector('#cxFmt').value;
      const name = pane.querySelector('#cxName').value || 'Sheet1';
      const content = fmt === 'xml' ? csvToSpreadsheetML(rows, name) : csvToXlsHtml(rows, name);
      const bytes = utf8(content);
      window.downloadBlob(new Blob([bytes], { type: 'application/vnd.ms-excel' }), name + '.xls');
      pane.querySelector('#cxInfo').innerHTML = `已生成 <b>${name}.xls</b> · ${rows.length} 行 · <b>${window.fmtSize(bytes.length)}</b>`;
      window.toast('已下载 .xls');
    };
  }
  function hExcelViewer(host) {
    const { stage, pane } = window.TUI.shell(host, true);
    stage.innerHTML = window.TUI.drop(dropInner({ title: '选择 CSV / TSV 文件', hint: '或直接在下方粘贴表格数据', icon: 'text', fmts: '<b>CSV / TSV</b> · 自动识别分隔符' }), '.csv,.tsv,.txt', false) +
      `<div style="margin-top:12px"><div class="colhead"><span class="t">表格预览</span><span class="mini" id="evStat">—</span></div>
       <div id="evTable" style="max-height:460px;overflow:auto;border:1px solid #232323;border-radius:10px"></div></div>`;
    pane.innerHTML = window.TUI.head('表格查看器', '读取粘贴/上传的 CSV/TSV，渲染为可滚动、可排序的表格。') +
      window.TUI.field('排序', window.TUI.sel('evSort', [{ v: '0', t: '按原顺序' }], '0')) +
      window.TUI.chk('evAsc', '升序', true) +
      `<div class="outbox" id="evInfo">尚未载入数据</div>
       <button class="btn-ghost btn-run" id="evCsv">导出为 CSV</button>
       <div class="warnbox">不做 .xlsx 二进制解析（不引 SheetJS）：请把 Excel 另存为 CSV，或复制单元格区域直接粘贴（Tab 分隔）。</div>`;
    pane.addEventListener('click', e => { const c = e.target.closest('.chk'); if (c) c.classList.toggle('on'); });
    let rows = null;
    function paint() {
      if (!rows) return;
      const sortCol = parseInt(pane.querySelector('#evSort').value, 10);
      const asc = pane.querySelector('#evAsc').classList.contains('on');
      const head = rows[0], body = rows.slice(1);
      let data = body;
      if (sortCol > 0) {
        const ci = sortCol - 1;
        data = body.slice().sort((a, b) => {
          const x = a[ci] || '', y = b[ci] || '';
          const nx = parseFloat(String(x).replace(/[^\d.\-]/g, '')), ny = parseFloat(String(y).replace(/[^\d.\-]/g, ''));
          let r = (isFinite(nx) && isFinite(ny)) ? nx - ny : String(x).localeCompare(String(y), 'zh');
          return asc ? r : -r;
        });
      }
      const all = [head].concat(data);
      stage.querySelector('#evTable').innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12.5px">
        ${all.map((r, ri) => `<tr>${r.map(c => `<t${ri === 0 ? 'h' : 'd'} style="padding:6px 8px;white-space:nowrap;border-bottom:1px solid #1e1e1e;${ri === 0 ? 'position:sticky;top:0;background:#1b1b1b;text-align:left' : ''}">${esc(c)}</t${ri === 0 ? 'h' : 'd'}>`).join('')}</tr>`).join('')}
      </table>`;
      stage.querySelector('#evStat').textContent = `${rows.length - 1} 行 × ${head.length} 列`;
      pane.querySelector('#evInfo').innerHTML = `${rows.length - 1} 行 × ${head.length} 列`;
    }
    function load(text) {
      rows = parseCSV(text);
      const sel = pane.querySelector('#evSort');
      sel.innerHTML = [{ v: '0', t: '按原顺序' }].concat(rows[0].map((h, i) => ({ v: String(i + 1), t: h || ('列 ' + (i + 1)) }))).map(o => `<option value="${esc(o.v)}">${esc(o.t)}</option>`).join('');
      paint();
    }
    const ta = document.createElement('textarea');
    ta.id = 'evPaste';
    ta.placeholder = '或在此粘贴 CSV/TSV…';
    ta.rows = 5;
    stage.appendChild(ta);
    ta.addEventListener('input', () => { if (ta.value.trim()) load(ta.value); });
    pane.querySelector('#evSort').addEventListener('change', paint);
    pane.querySelector('#evAsc').addEventListener('click', () => setTimeout(paint, 0));
    window.TUI.bindDrop(stage, '.csv,.tsv,.txt', false, async list => { try { const t = await window.TUI.readText(list[0]); ta.value = t; load(t); } catch (e) { window.toast('读取失败'); } });
    pane.querySelector('#evCsv').onclick = () => { if (!rows) return window.toast('还没有数据'); window.downloadBlob(new Blob(['\uFEFF' + csvStringify(rows)], { type: 'text/csv;charset=utf-8' }), 'table.csv'); };
  }

  /* 银行流水 / 发票扫描 / 收据扫描 */
  function hBankConverter(host, cfg, slug) {
    const isCsv = /to-csv/.test(slug);
    const { stage, pane } = window.TUI.shell(host, true);
    stage.innerHTML = window.TUI.drop(dropInner({ title: '选择流水 PDF 或粘贴文本', hint: '支持 PDF 对账单，或直接粘贴文本', icon: 'pdf' }), '.pdf,.csv,.txt', false) +
      `<div style="margin-top:12px">${window.TUI.area('bkText', '', '粘贴对账单文本（每行一条记录，含日期与金额）…', 10)}</div>
       <div id="bkGrid" style="margin-top:12px"></div>`;
    pane.innerHTML = window.TUI.head('银行流水转换', '抽取日期/描述/金额/余额，生成 {EXCEL} 或 CSV，可在表格里修正。'.replace('{EXCEL}', isCsv ? 'CSV' : 'Excel')) +
      `<div class="shapes" style="margin-bottom:8px"><button class="btn-ghost btn-sm" id="bkRun">抽取表格</button></div>
       <div class="outbox" id="bkInfo">尚未抽取</div>
       <button class="btn-lime btn-run" id="bkGo">${isCsv ? '下载 CSV' : '下载 Excel(.xls)'}</button>
       <div class="warnbox">基于文本正则的抽取，非 OCR；请核对修正后使用。</div>`;
    let grid = null;
    function doExtract(text) {
      const { rows } = extractTableRows(text);
      grid = [['日期', '描述', '金额', '余额']];
      for (const r of rows) {
        if (r.type !== 'row') continue;
        const amts = r.amounts || [];
        let amount = '', balance = '';
        if (amts.length >= 2) { amount = amts[amts.length - 2]; balance = amts[amts.length - 1]; }
        else if (amts.length === 1) amount = amts[0];
        grid.push([r.date || '', r.desc || '', amount, balance]);
      }
      if (grid.length === 1) grid.push(['', '（未识别到记录，请检查文本格式或手工补录）', '', '']);
      const wrap = stage.querySelector('#bkGrid');
      wrap.innerHTML = `<div style="max-height:320px;overflow:auto;border:1px solid #232323;border-radius:10px"><table style="width:100%;border-collapse:collapse;font-size:12px">
        <tr>${grid[0].map(h => `<th style="background:#1b1b1b;padding:6px;text-align:left;position:sticky;top:0">${h}</th>`).join('')}</tr>
        ${grid.slice(1).map((r, ri) => `<tr>${r.map((c, ci) => `<td style="padding:2px"><input data-r="${ri + 1}" data-c="${ci}" value="${esc(c)}" style="width:100%;background:#101010;border:1px solid #222;color:#e5e5e5;border-radius:4px;padding:4px;font-size:12px"></td>`).join('')}</tr>`).join('')}
      </table></div>`;
      wrap.querySelectorAll('input[data-r]').forEach(inp => inp.addEventListener('input', () => { grid[+inp.dataset.r][+inp.dataset.c] = inp.value; }));
      pane.querySelector('#bkInfo').innerHTML = `识别到 <b>${grid.length - 1}</b> 行`;
    }
    pane.querySelector('#bkRun').onclick = async () => {
      const ta = stage.querySelector('#bkText');
      if (ta.value.trim()) return doExtract(ta.value);
      window.toast('请粘贴文本，或选择 PDF（选择后会自动抽取）');
    };
    window.TUI.bindDrop(stage, '.pdf,.csv,.txt', false, async list => {
      try {
        let text;
        if (/\.pdf$/i.test(list[0].name) || list[0].type === 'application/pdf') text = (await extractAllText(bufOf(await window.TUI.readBuf(list[0])))).join('\n');
        else text = await window.TUI.readText(list[0]);
        stage.querySelector('#bkText').value = text.slice(0, 30000);
        doExtract(text);
      } catch (e) { console.error(e); window.toast('读取失败：' + e.message); }
    });
    pane.querySelector('#bkGo').onclick = () => {
      if (!grid) return window.toast('请先抽取表格');
      let data = grid;
      if (isCsv) {
        window.downloadBlob(new Blob(['\uFEFF' + csvStringify(data)], { type: 'text/csv;charset=utf-8' }), 'bank-statement.csv');
      } else {
        window.downloadBlob(new Blob([csvToSpreadsheetML(data, 'Statement')], { type: 'application/vnd.ms-excel' }), 'bank-statement.xls');
      }
      window.toast('已下载');
    };
  }

  function hScanner(host, cfg, slug) {
    const isInvoice = /invoice/.test(slug);
    const { stage, pane } = window.TUI.shell(host, true);
    stage.innerHTML = window.TUI.drop(dropInner({ title: isInvoice ? '上传发票照片' : '上传收据照片', hint: '拍正一点、背景对比明显效果更好', icon: 'image', fmts: '<b>JPG / PNG</b> · 自动做边缘检测 + 透视校正 + 增强' }), 'image/*', false) +
      `<div id="scWrap" class="hide" style="margin-top:12px">
        <div class="canvaswrap" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div><div class="mini" style="margin-bottom:6px">原图</div><img id="scSrc" style="width:100%;border-radius:8px"></div>
          <div><div class="mini" style="margin-bottom:6px">扫描件</div><img id="scOut" style="width:100%;border-radius:8px;background:#fff"></div>
        </div></div>`;
    pane.innerHTML = window.TUI.head(isInvoice ? '发票扫描件' : '收据扫描件', '本地上传 → 边缘检测 → 透视校正 → 灰度/阈值增强 → 输出扫描件 + 可下载 PDF。') +
      window.TUI.field('增强方式', window.TUI.sel('scMode', [{ v: 'gray', t: '灰度（柔和）' }, { v: 'light', t: '漂白增白（推荐）' }, { v: 'bw', t: '黑白二值（省墨）' }], 'light')) +
      window.TUI.chk('scAuto', '自动检测纸张边缘', true) +
      `<div class="outbox" id="scInfo">尚未处理</div>
       <button class="btn-ghost btn-run" id="scRun">重新处理</button>
       <button class="btn-lime btn-run" id="scPdf" style="margin-top:8px">下载扫描件 PDF</button>
       <button class="btn-ghost btn-run" id="scImg" style="margin-top:8px">下载扫描件 PNG</button>
       <div class="progress" id="tProg" style="display:none"><i></i></div>
       <div class="warnbox">透视校正是本地近似算法（Sobel 边缘 + 四角极值 + 单应矩阵重采样）。当背景杂乱或纸张无明显边界时，会自动回退为“不裁切 + 仅增强”。</div>`;
    pane.addEventListener('click', e => { const c = e.target.closest('.chk'); if (c) c.classList.toggle('on'); });
    let S = { src: null, out: null, name: 'scan' };
    async function process() {
      if (!S.src) return;
      const btn = pane.querySelector('#scRun'); btn.disabled = true; btn.textContent = '处理中…';
      try {
        const c = canvasOf(S.src.naturalWidth, S.src.naturalHeight);
        c.getContext('2d').drawImage(S.src, 0, 0);
        const auto = pane.querySelector('#scAuto').classList.contains('on');
        const res = auto ? documentScan(c, { mode: pane.querySelector('#scMode').value }) : (function () {
          const g = canvasOf(c.width, c.height); const gx = g.getContext('2d'); gx.drawImage(c, 0, 0);
          const id = gx.getImageData(0, 0, g.width, g.height); const d = id.data; const mode = pane.querySelector('#scMode').value;
          for (let i = 0; i < d.length; i += 4) { let v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; if (mode === 'bw') v = v > 150 ? 255 : (v > 110 ? 190 : 40); else v = clamp(255 - (255 - v) * 0.9 + 10, 0, 255); d[i] = d[i + 1] = d[i + 2] = v; }
          gx.putImageData(id, 0, 0); return { canvas: g, detected: false };
        })();
        S.out = res.canvas;
        stage.querySelector('#scOut').src = res.canvas.toDataURL('image/png');
        pane.querySelector('#scInfo').innerHTML = `输出 ${res.canvas.width}×${res.canvas.height}px · 边缘检测${res.detected ? '<b style="color:#4f46e5">成功</b>' : '<span style="color:#f0a35e">未命中（已回退为原图增强）</span>'}`;
      } catch (e) { console.error(e); window.toast('处理失败：' + e.message); }
      btn.disabled = false; btn.textContent = '重新处理';
    }
    window.TUI.bindDrop(stage, 'image/*', false, async list => {
      try {
        S.src = await loadImg(list[0]);
        S.name = list[0].name.replace(/\.[^.]+$/, '') || 'scan';
        stage.querySelector('#tDrop').classList.add('hide');
        stage.querySelector('#scWrap').classList.remove('hide');
        stage.querySelector('#scSrc').src = S.src.src;
        await process();
      } catch (e) { console.error(e); window.toast('读取失败'); }
    });
    pane.querySelector('#scRun').onclick = process;
    pane.querySelector('#scImg').onclick = () => { if (!S.out) return window.toast('请先处理'); S.out.toBlob(b => window.downloadBlob(b, S.name + '-scan.png')); };
    pane.querySelector('#scPdf').onclick = async () => {
      if (!S.out) return window.toast('请先处理');
      try {
        const P = await getPDFLib();
        const out = await P.PDFDocument.create();
        const A4c = out.addPage(A4);
        const k = Math.min(A4[0] / S.out.width, A4[1] / S.out.height);
        const img = await out.embedPng(S.out.toDataURL('image/png'));
        A4c.drawImage(img, { x: (A4[0] - S.out.width * k) / 2, y: (A4[1] - S.out.height * k) / 2, width: S.out.width * k, height: S.out.height * k });
        const bytes = await out.save({ useObjectStreams: true });
        const blob = new Blob([bytes], { type: 'application/pdf' });
        window.downloadBlob(blob, S.name + '-scan.pdf');
        window.toast('已下载 ' + window.fmtSize(blob.size));
      } catch (e) { console.error(e); window.toast('失败：' + e.message); }
    };
  }

  /* ======================= G. 生成类文档框架 ======================= */
  async function buildBytesOnly(cfg, fn) {
    const P = await getPDFLib();
    const pdf = await P.PDFDocument.create();
    const db = new DocBuilder(pdf, cfg || {});
    await fn(db, pdf, P);
    await db.render();
    return await pdf.save({ useObjectStreams: true });
  }
  function fieldHtml(f) {
    const id = 'g_' + f.id;
    if (f.type === 'select') return window.TUI.field(f.label, window.TUI.sel(id, f.options, f.value));
    if (f.type === 'textarea') return window.TUI.field(f.label, window.TUI.area(id, f.value || '', f.ph || '', f.rows || 4));
    if (f.type === 'color') return window.TUI.field(f.label, window.TUI.input(id, f.value || '#111111', '', 'color'));
    if (f.type === 'number') return window.TUI.field(f.label, window.TUI.input(id, String(f.value == null ? '' : f.value), f.ph || '', 'number'));
    return window.TUI.field(f.label, window.TUI.input(id, f.value || '', f.ph || ''));
  }
  function generator(host, spec) {
    const { stage, pane } = window.TUI.shell(host, true);
    const model = { f: {}, items: [] };
    for (const fl of spec.fields) model.f[fl.id] = fl.value != null ? fl.value : '';
    const mkItem = () => { const o = {}; (spec.items ? spec.items.cols : []).forEach(c => o[c.id] = c.value != null ? c.value : ''); return o; };
    if (spec.items) { for (let i = 0; i < (spec.items.init || 1); i++) model.items.push(mkItem()); }
    const itemCols = spec.items ? spec.items.cols : [];
    stage.innerHTML = `<div class="colhead"><span class="t">实时预览</span><span class="mini" id="gvPage">—</span></div>
      <div class="canvaswrap" style="max-height:640px;overflow:auto;text-align:center;background:#0f0f0f;border-radius:10px;padding:12px">
        <canvas id="gvCanvas" style="background:#fff;box-shadow:0 4px 24px #000a;max-width:100%"></canvas>
      </div>
      <div class="shapes" style="margin-top:10px">
        <button class="btn-ghost btn-sm" id="gvPrev">上一页</button>
        <span class="mini" id="gvLabel">—</span>
        <button class="btn-ghost btn-sm" id="gvNext">下一页</button>
        <button class="btn-ghost btn-sm" id="gvRefresh">刷新预览</button>
      </div>`;
    pane.innerHTML = window.TUI.head(spec.title, spec.desc) + spec.fields.map(fieldHtml).join('') +
      (spec.items ? `<div class="plabel" style="margin-top:6px">${esc(spec.items.label || '明细行')}</div><div id="gItems"></div>
        <button class="btn-ghost btn-sm" id="gAdd" style="margin-top:6px">+ 增加一行</button>` : '') +
      `<div class="outbox" id="gInfo" style="margin-top:12px">尚未生成</div>
       <button class="btn-lime btn-run" id="gGo">导出 PDF</button>
       <div class="progress" id="tProg" style="display:none"><i></i></div>
       <div class="runnote">中文经 Canvas 逐行贴图渲染，导出的 PDF 在任何设备都能正确显示。</div>`;
    function renderItems() {
      const box = pane.querySelector('#gItems');
      if (!box) return;
      box.innerHTML = model.items.map((it, i) => `<div style="display:flex;gap:6px;align-items:flex-end;margin-bottom:6px">
        ${itemCols.map(c => `<div style="flex:${c.width || 1}"><div class="mini" style="font-size:10px">${esc(c.label)}</div><input data-i="${i}" data-k="${c.id}" type="${c.type || 'text'}" value="${esc(it[c.id])}" style="width:100%"></div>`).join('')}
        <button class="btn-ghost btn-sm" data-rm="${i}" title="删除"><svg data-lucide="x" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>`).join('');
      box.querySelectorAll('input[data-i]').forEach(inp => inp.addEventListener('input', () => { model.items[+inp.dataset.i][inp.dataset.k] = inp.value; }));
      box.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { model.items.splice(+b.dataset.rm, 1); renderItems(); }));
    }
    spec.fields.forEach(f => {
      const el = pane.querySelector('#g_' + f.id);
      if (!el) return;
      el.addEventListener('input', () => { model.f[f.id] = el.value; });
      el.addEventListener('change', () => { model.f[f.id] = el.value; });
    });
    if (spec.items) { pane.querySelector('#gAdd').addEventListener('click', () => { model.items.push(mkItem()); renderItems(); }); renderItems(); }
    let bytes = null, pageIdx = 0, nPages = 1;
    async function build() { return buildBytesOnly(spec.page || {}, (db, pdf, P) => spec.build(model, db, pdf, P)); }
    async function showPage() {
      if (!bytes) return;
      try {
        const P = await getPDFLib();
        const doc = await P.PDFDocument.load(bytes, { ignoreEncryption: true });
        nPages = doc.getPageCount(); pageIdx = clamp(pageIdx, 0, nPages - 1);
        const c = await renderPageToCanvas(P, doc, doc.getPages()[pageIdx], 1.0);
        const cv = stage.querySelector('#gvCanvas');
        cv.width = c.width; cv.height = c.height; cv.getContext('2d').drawImage(c, 0, 0);
        stage.querySelector('#gvPage').textContent = `${nPages} 页`;
        stage.querySelector('#gvLabel').textContent = `第 ${pageIdx + 1} / ${nPages} 页`;
      } catch (e) { console.error(e); window.toast('预览失败：' + e.message); }
    }
    async function preview() {
      const btn = pane.querySelector('#gvRefresh'); if (btn) { btn.disabled = true; }
      try { bytes = await build(); pageIdx = 0; await showPage(); pane.querySelector('#gInfo').innerHTML = `预览已更新 · <b>${window.fmtSize(bytes.length)}</b>`; }
      catch (e) { console.error(e); window.toast('生成失败：' + e.message); }
      if (btn) btn.disabled = false;
    }
    stage.querySelector('#gvPrev').onclick = async () => { if (pageIdx > 0) { pageIdx--; await showPage(); } };
    stage.querySelector('#gvNext').onclick = async () => { if (pageIdx < nPages - 1) { pageIdx++; await showPage(); } };
    stage.querySelector('#gvRefresh').onclick = preview;
    pane.querySelector('#gGo').addEventListener('click', async () => {
      const btn = pane.querySelector('#gGo'); btn.disabled = true; btn.textContent = '生成中…';
      try {
        bytes = await build();
        const name = (spec.outName || 'document') + '.pdf';
        const blob = new Blob([bytes], { type: 'application/pdf' });
        window.downloadBlob(blob, name);
        pane.querySelector('#gInfo').innerHTML = `已下载 <b>${esc(name)}</b> · <b>${window.fmtSize(blob.size)}</b>`;
        window.toast('已下载 ' + window.fmtSize(blob.size));
      } catch (e) { console.error(e); window.toast('失败：' + e.message); }
      btn.disabled = false; btn.textContent = '导出 PDF';
    });
    pane.querySelector('#gGo').dataset.gid = '1';
    setTimeout(preview, 60);
    return { preview, model };
  }

  /* 发票/估价/形式发票/收据通用排版 */
  function invoiceModelToDb(model, db, P, opt) {
    opt = opt || {};
    const m = model.f;
    const cur = m.currency || '$';
    const titleBySlug = opt.title || 'INVOICE';
    const chinese = /[\u4e00-\u9fa5]/.test((m.company || '') + (m.customer || '') + titleBySlug);
    const docTitle = opt.zhTitle || (chinese ? ({ INVOICE: '发票', ESTIMATE: '报价单', PROFORMA: '形式发票', RECEIPT: '收据' }[titleBySlug] || titleBySlug) : titleBySlug);
    const accent = m.accent || '#111111';
    db.space(6);
    db.text(m.company || '公司名称', { size: 19, bold: true, color: accent, after: 2 });
    if (m.companyMeta) db.text(m.companyMeta, { size: 9.5, color: '#555555', lh: 1.5, after: 8 }); else db.space(8);
    db.rule({ color: '#dddddd', gap: 12 });
    db.text(docTitle, { size: 24, bold: true, color: accent, after: 6 });
    const rows = [];
    rows.push(['编号 / Invoice #', m.number || '—']);
    rows.push(['日期 / Date', m.date || new Date().toISOString().slice(0, 10)]);
    if (m.due) rows.push([opt.dueLabel || '到期 / Due', m.due]);
    if (m.terms) rows.push(['付款条件', m.terms]);
    db.space(2);
    db.text('客户 / Bill To', { size: 9, color: '#777777', after: 2 });
    db.text(m.customer || '客户名称', { size: 12, bold: true, after: 1 });
    if (m.customerMeta) db.text(m.customerMeta, { size: 9.5, color: '#555555', lh: 1.5 });
    db.space(6);
    // 右上信息块用 abs 画
    const infoY = db.y + 10;
    void infoY;
    for (const [k, v] of rows) db.kv(k, v, { size: 9.5 });
    db.space(10);
    const items = model.items && model.items.length ? model.items : [{ desc: '', qty: '', price: '' }];
    const tableRows = [['描述 / Description', '数量', '单价', '金额']];
    let subtotal = 0;
    for (const it of items) {
      const qty = parseFloat(it.qty) || 0, price = parseFloat(it.price) || 0;
      const amt = qty * price;
      if (it.desc || qty || price) subtotal += amt;
      tableRows.push([it.desc || '', (qty || '').toString(), price ? cur + price.toFixed(2) : '', amt ? cur + amt.toFixed(2) : '']);
    }
    db.table(tableRows, { size: 10, align: ['left', 'right', 'right', 'right'], weights: [5, 1, 1.6, 1.8], headFill: '#f2f2f2', zebra: 'rgba(0,0,0,0.03)', after: 10 });
    const taxRate = parseFloat(m.taxRate) || 0;
    const tax = subtotal * taxRate / 100;
    const ship = parseFloat(m.shipping) || 0;
    const discount = parseFloat(m.discount) || 0;
    const total = subtotal + tax + ship - discount;
    db.space(2);
    db.kv('小计 / Subtotal', cur + subtotal.toFixed(2), { size: 10.5 });
    if (discount) db.kv('折扣 / Discount', '-' + cur + discount.toFixed(2), { size: 10.5 });
    if (taxRate) db.kv(`税 / Tax (${taxRate}%)`, cur + tax.toFixed(2), { size: 10.5 });
    if (ship) db.kv('运费 / Shipping', cur + ship.toFixed(2), { size: 10.5 });
    db.rule({ color: '#bbbbbb', gap: 8, thickness: 1 });
    db.kv('合计 / Total', cur + total.toFixed(2), { size: 13, bold: true });
    db.space(10);
    if (m.bank) { db.text('收款信息 / Payment', { size: 9, color: '#777777', after: 3 }); db.text(m.bank, { size: 9.5, lh: 1.5, color: '#333333' }); db.space(6); }
    if (m.notes) { db.text('备注 / Notes', { size: 9, color: '#777777', after: 3 }); db.text(m.notes, { size: 9.5, lh: 1.5, color: '#333333' }); }
    db.space(6);
    db.text(m.footer || '感谢您的惠顾！', { size: 9.5, color: '#666666', align: 'center' });
  }
  const GEN_COMMON = [
    { id: 'company', label: '公司名称', value: '' },
    { id: 'companyMeta', label: '公司信息（地址/电话/税号，可换行）', type: 'textarea', value: '', rows: 2 },
    { id: 'number', label: '编号', value: '' },
    { id: 'date', label: '日期', value: new Date().toISOString().slice(0, 10) },
    { id: 'customer', label: '客户名称', value: '' },
    { id: 'customerMeta', label: '客户信息', type: 'textarea', value: '', rows: 2 },
    { id: 'currency', label: '货币符号', value: '$' },
    { id: 'taxRate', label: '税率（%）', type: 'number', value: '0' },
    { id: 'notes', label: '备注', type: 'textarea', value: '', rows: 2 }
  ];
  const GEN_ITEMS = { label: '明细行（描述 / 数量 / 单价）', init: 3, cols: [{ id: 'desc', label: '描述', width: 5 }, { id: 'qty', label: '数量', width: 1 }, { id: 'price', label: '单价', width: 1.6 }] };
  function hInvoiceGen(host, cfg, slug) {
    const title = slug === 'proforma-invoice' ? 'PROFORMA' : slug === 'estimate-template' ? 'ESTIMATE' : slug === 'receipt-generator' ? 'RECEIPT' : 'INVOICE';
    const isReceipt = slug === 'receipt-generator';
    generator(host, {
      title: slug === 'proforma-invoice' ? '形式发票' : slug === 'estimate-template' ? '报价单 / 估价单' : isReceipt ? '收据生成器' : '发票生成器',
      desc: '填写表单 → 实时预览 → 导出 PDF。字段贴近真实单据（公司/客户/税号/明细行/小计/税/合计）。',
      outName: slug,
      page: isReceipt ? { pageW: 227, pageH: 700, margin: 16 } : {},
      fields: GEN_COMMON.concat(isReceipt ? [] : [
        { id: 'due', label: '到期日', value: '' },
        { id: 'shipping', label: '运费', value: '0' },
        { id: 'discount', label: '折扣', value: '0' }
      ]).concat([{ id: 'bank', label: '收款信息', type: 'textarea', value: '', rows: 2 }, { id: 'footer', label: '页脚', value: '' }]),
      items: GEN_ITEMS,
      build: (model, db, pdf, P) => {
        const m = model.f;
        if (title === 'RECEIPT') { m.footer = m.footer || '谢谢惠顾，欢迎再次光临'; invoiceModelToDb(model, db, P, { title: 'RECEIPT' }); }
        else invoiceModelToDb(model, db, P, { title, dueLabel: title === 'ESTIMATE' ? '有效期至' : '到期 / Due' });
      }
    });
  }

  /* 简历 / CV / 求职信 */
  function resumeBlocks(model, db, opt) {
    const m = model.f;
    const accent = m.accent || '#1f3a5f';
    const tpl = opt.template || 'modern';
    if (tpl === 'classic') {
      db.text(m.name || '你的姓名', { size: 22, bold: true, align: 'center', family: 'serif', after: 2 });
      db.text([m.title, m.phone, m.email, m.location].filter(Boolean).join(' · '), { size: 10, align: 'center', color: '#444444', family: 'serif', after: 10 });
      db.rule({ color: '#999999', thickness: 1, gap: 10 });
    } else if (tpl === 'compact') {
      db.text(m.name || '你的姓名', { size: 16, bold: true, color: accent, after: 1 });
      db.text([m.title, m.phone, m.email, m.location].filter(Boolean).join(' | '), { size: 9, color: '#555555', after: 6 });
      db.rule({ color: accent, thickness: 1.4, gap: 8 });
    } else {
      db.space(2);
      db.text(m.name || '你的姓名', { size: 24, bold: true, color: accent, after: 2 });
      db.text(m.title || '', { size: 12, color: '#555555', after: 4 });
      db.text([m.phone, m.email, m.location, m.website].filter(Boolean).join('  ·  '), { size: 9.5, color: '#666666', after: 8 });
      db.rule({ color: accent, thickness: 2, gap: 10 });
    }
    const sec = t => { db.space(4); db.text(t, { size: tpl === 'compact' ? 11 : 12.5, bold: true, color: accent, family: tpl === 'classic' ? 'serif' : 'sans', after: 3 }); db.rule({ color: '#dddddd', gap: 5 }); };
    if (m.summary) { sec('个人简介'); db.text(m.summary, { size: 10, lh: 1.55, family: tpl === 'classic' ? 'serif' : 'sans', after: 4 }); }
    const exp = model.items.filter(i => (i.company || i.role || i.bullets));
    if (exp.length) {
      sec('工作经历');
      for (const e of exp) {
        db.kv(e.company || '', [e.period].filter(Boolean).join(''), { size: 10.5, bold: true, labelColor: '#111111' });
        if (e.role) db.text(e.role, { size: 9.5, color: '#555555', after: 2 });
        if (e.bullets) e.bullets.split('\n').filter(Boolean).forEach(b => db.text('• ' + b, { size: 9.5, indent: 10, lh: 1.5, after: 1 }));
        db.space(4);
      }
    }
    if (m.education) { sec('教育背景'); db.text(m.education, { size: 10, lh: 1.55, after: 4 }); }
    if (m.skills) { sec('技能'); db.text(m.skills, { size: 10, lh: 1.55, after: 4 }); }
    if (m.certificates) { sec('证书 / 其它'); db.text(m.certificates, { size: 10, lh: 1.55, after: 4 }); }
  }
  function hResumeGen(host, cfg, slug) {
    const isTpl = slug === 'resume-templates';
    generator(host, {
      title: isTpl ? '简历模板（≥3 套）' : slug === 'cv-maker' ? 'CV 制作' : '简历生成器',
      desc: '填写 → 实时预览 → 导出 PDF。风格可选：现代 / 经典 / 紧凑。',
      outName: slug === 'cv-maker' ? 'cv' : 'resume',
      fields: [
        { id: 'template', label: '模板风格', type: 'select', options: [{ v: 'modern', t: '现代（左侧色条式标题）' }, { v: 'classic', t: '经典（居中、衬线）' }, { v: 'compact', t: '紧凑（小字号、单栏）' }], value: 'modern' },
        { id: 'accent', label: '主题色', type: 'color', value: '#1f3a5f' },
        { id: 'name', label: '姓名', value: '' },
        { id: 'title', label: '职位 / 头衔', value: '' },
        { id: 'phone', label: '电话', value: '' },
        { id: 'email', label: '邮箱', value: '' },
        { id: 'location', label: '城市', value: '' },
        { id: 'website', label: '主页 / 作品集', value: '' },
        { id: 'summary', label: '个人简介', type: 'textarea', value: '', rows: 3 },
        { id: 'education', label: '教育背景（每行一条）', type: 'textarea', value: '', rows: 3 },
        { id: 'skills', label: '技能（逗号分隔）', type: 'textarea', value: '', rows: 2 },
        { id: 'certificates', label: '证书 / 其它', type: 'textarea', value: '', rows: 2 }
      ],
      items: { label: '工作经历（公司 / 职位 / 时间 / 要点）', init: 2, cols: [{ id: 'company', label: '公司', width: 2 }, { id: 'role', label: '职位', width: 1.6 }, { id: 'period', label: '时间', width: 1.2 }, { id: 'bullets', label: '要点（换行分隔）', width: 3 }] },
      build: (model, db, pdf, P) => resumeBlocks(model, db, { template: model.f.template })
    });
  }
  function hCoverLetter(host) {
    generator(host, {
      title: '求职信生成器', desc: '填写抬头、正文与落款，生成规范排版的求职信 PDF。', outName: 'cover-letter',
      fields: [
        { id: 'sender', label: '你的姓名 / 联系方式', type: 'textarea', value: '', rows: 2 },
        { id: 'date', label: '日期', value: new Date().toISOString().slice(0, 10) },
        { id: 'recipient', label: '收件人 / 公司', type: 'textarea', value: '', rows: 2 },
        { id: 'subject', label: '主题', value: '' },
        { id: 'body', label: '正文', type: 'textarea', value: '', rows: 10 },
        { id: 'closing', label: '落款', value: '此致\n敬礼' },
        { id: 'signature', label: '签名', value: '' }
      ],
      page: { margin: 62 },
      build: (model, db, pdf, P) => {
        const m = model.f;
        if (m.sender) { db.text(m.sender, { size: 10.5, lh: 1.5, after: 10 }); db.rule({ color: '#dddddd', gap: 14 }); }
        if (m.date) db.text(m.date, { size: 10.5, color: '#444444', after: 10 });
        if (m.recipient) { db.text(m.recipient, { size: 10.5, lh: 1.5, after: 12 }); }
        if (m.subject) db.text('主题：' + m.subject, { size: 12, bold: true, after: 12 });
        (m.body || '').split('\n').forEach(p => { if (p.trim()) db.text(p, { size: 11, lh: 1.75, after: 8 }); });
        db.space(8);
        (m.closing || '').split('\n').forEach(p => { if (p.trim()) db.text(p, { size: 11, lh: 1.6, after: 2 }); });
        if (m.signature) { db.space(14); db.text(m.signature, { size: 12, bold: true }); }
      }
    });
  }

  /* 甘特图 / 项目时间线 */
  function drawGantt(model, db, opt) {
    const m = model.f;
    const tasks = model.items.filter(t => (t.name || '').trim());
    if (!tasks.length) tasks.push({ name: '任务 1', start: '1', days: '5' });
    const total = Math.max(10, parseInt(m.totalDays, 10) || Math.max.apply(null, tasks.map(t => (parseInt(t.start, 10) || 1) + (parseInt(t.days, 10) || 1))));
    const W = 1000, labelW = 240, rowH = 34, headH = 46;
    const c = canvasOf(W, headH + tasks.length * rowH + 20);
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
    g.font = '600 15px ' + FAMILY.sans; g.fillStyle = '#111';
    g.fillText(m.title || '项目时间线', 12, 20);
    g.font = '12px ' + FAMILY.sans; g.fillStyle = '#666';
    g.fillText((m.startLabel ? '起始：' + m.startLabel + '   ' : '') + '总周期：' + total + ' 天', 12, 38);
    const chartX = labelW, chartW = W - chartX - 20, chartY = headH + 6, chartH = tasks.length * rowH;
    // 网格
    const dayW = chartW / total;
    for (let d = 0; d <= total; d++) {
      const x = chartX + d * dayW;
      g.strokeStyle = d % 5 === 0 ? '#d0d0d0' : '#eeeeee';
      g.beginPath(); g.moveTo(x, chartY - 14); g.lineTo(x, chartY + chartH); g.stroke();
      if (d < total && (d % 5 === 0 || total <= 14)) {
        g.fillStyle = '#888'; g.font = '11px ' + FAMILY.sans;
        g.fillText('第' + (d + 1) + '天', x + 3, chartY - 18);
      }
    }
    // 行
    tasks.forEach((t, i) => {
      const y = chartY + i * rowH;
      if (i % 2 === 0) { g.fillStyle = '#fafafa'; g.fillRect(0, y, W, rowH); }
      g.fillStyle = '#1a1a1a'; g.font = '13px ' + FAMILY.sans;
      const nm = (t.name || '').length > 22 ? t.name.slice(0, 21) + '…' : t.name;
      g.fillText(nm, 12, y + rowH / 2 + 5);
      if (t.owner) { g.fillStyle = '#888'; g.font = '11px ' + FAMILY.sans; g.fillText(t.owner, 12 + 150, y + rowH / 2 + 5); }
      const s = Math.max(0, (parseInt(t.start, 10) || 1) - 1), dur = Math.max(1, parseInt(t.days, 10) || 1);
      const bx = chartX + s * dayW, bw = Math.max(6, dur * dayW);
      g.fillStyle = t.color || m.barColor || '#3b6ea5';
      g.fillRect(bx, y + 9, bw, rowH - 18);
      g.fillStyle = '#fff'; g.font = '600 11px ' + FAMILY.sans;
      const label = (parseInt(t.days, 10) || 1) + '天';
      if (bw > 30) g.fillText(label, bx + 6, y + rowH / 2 + 4);
    });
    g.strokeStyle = '#cccccc'; g.strokeRect(chartX, chartY, chartW, chartH);
    const rec = { canvas: c, w: c.width / SCALE, h: c.height / SCALE };
    db.bitmap ? db.bitmap(c, { w: db.pageW - 2 * db.margin, s: 1 }) : db.image(rec, { w: db.pageW - 2 * db.margin });
    if (m.notes) { db.space(10); db.text(m.notes, { size: 10, lh: 1.5, color: '#555' }); }
  }
  function hGantt(host, cfg, slug) {
    const isTpl = slug === 'gantt-chart-template';
    const isTimeline = slug === 'project-timeline-maker';
    generator(host, {
      title: isTimeline ? '项目时间线制作' : isTpl ? '甘特图模板' : '甘特图制作',
      desc: '填写任务与工期，自动生成甘特条（本地 Canvas 绘制，导出为 PDF）。',
      outName: isTimeline ? 'timeline' : 'gantt',
      page: { pageW: A4[0], pageH: A4[1], margin: 40 },
      fields: [
        { id: 'title', label: '项目名称', value: '项目计划' },
        { id: 'startLabel', label: '起始日期', value: new Date().toISOString().slice(0, 10) },
        { id: 'totalDays', label: '总周期（天）', type: 'number', value: '30' },
        { id: 'barColor', label: '任务条颜色', type: 'color', value: '#3b6ea5' },
        { id: 'notes', label: '备注（里程碑 / 说明）', type: 'textarea', value: '', rows: 3 }
      ],
      items: { label: '任务（名称 / 负责人 / 开始天 / 工期）', init: 4, cols: [{ id: 'name', label: '任务名称', width: 3 }, { id: 'owner', label: '负责人', width: 1.4 }, { id: 'start', label: '开始(第N天)', width: 1.2, type: 'number' }, { id: 'days', label: '工期(天)', width: 1.2, type: 'number' }] },
      build: (model, db, pdf, P) => drawGantt(model, db, {})
    });
  }

  /* ======================= H. DICOM ======================= */
  function hDicom(host, cfg, slug) {
    const isAnon = slug === 'dicom-anonymizer';
    const { stage, pane } = window.TUI.shell(host, true);
    const S = { ds: null, file: null, render: null };
    stage.innerHTML = window.TUI.drop(dropInner({ title: '选择 DICOM 文件', hint: '支持未压缩传输语法（Implicit/Explicit VR）；压缩语法会给出明确错误', icon: 'image', fmts: '<b>.dcm / .dicom</b> · 本地解析，不上传' }), '.dcm,.dicom,application/dicom', false) +
      `<div id="dcWrap" class="hide" style="margin-top:12px">
        <div class="canvaswrap" style="text-align:center;background:#000;border-radius:10px;padding:10px">
          <canvas id="dcCanvas" style="max-width:100%;max-height:520px;image-rendering:pixelated"></canvas>
        </div>
      </div>`;
    pane.innerHTML = window.TUI.head(isAnon ? 'DICOM 匿名化' : 'DICOM 查看器', isAnon ? '清空患者姓名/生日/机构等身份标签后重新导出 .dcm。' : '解析文件头与像素数据，支持 MONOCHROME1/2、8/16 位、窗宽窗位。') +
      (isAnon ? '' :
        window.TUI.field('窗位 WW（0 = 自动）', window.TUI.range('dcWW', 0, 4096, 0)) +
        window.TUI.field('窗宽 WC（0 = 自动）', window.TUI.range('dcWC', 0, 4096, 0)) +
        window.TUI.chk('dcInv', '反相显示', false)) +
      `<div id="dcInfo2"></div>
       <button class="btn-lime btn-run" id="dcGo">${isAnon ? '匿名化并下载 .dcm' : (slug === 'dicom-to-jpg' ? '导出 PNG' : '导出 PNG')}</button>
       <div class="progress" id="tProg" style="display:none"><i></i></div>
       <div class="warnbox">限定说明：仅支持未压缩像素数据。若为 JPEG/JPEG2000/JPEG-LS 等压缩传输语法，会明确提示“不支持该传输语法”，不会白屏。</div>`;
    if (!isAnon) pane.addEventListener('click', e => { const c = e.target.closest('.chk'); if (c) c.classList.toggle('on'); });
    function draw() {
      if (!S.ds || isAnon) return;
      try {
        const ww = parseFloat(pane.querySelector('#dcWW').value) || 0;
        const wc = parseFloat(pane.querySelector('#dcWC').value) || 0;
        const r = renderDicom(S.ds, wc || undefined, ww || undefined);
        S.render = r;
        const cv = stage.querySelector('#dcCanvas');
        cv.width = r.cols; cv.height = r.rows;
        cv.getContext('2d').drawImage(r.canvas, 0, 0);
        if (pane.querySelector('#dcInv') && pane.querySelector('#dcInv').classList.contains('on')) { cv.style.filter = 'invert(1)'; } else cv.style.filter = 'none';
        pane.querySelector('#dcWW').value = Math.round(r.ww); pane.querySelector('#dcWWV') && (pane.querySelector('#dcWWV').textContent = Math.round(r.ww));
        pane.querySelector('#dcWC').value = Math.round(r.wc); pane.querySelector('#dcWCV') && (pane.querySelector('#dcWCV').textContent = Math.round(r.wc));
      } catch (e) { console.error(e); window.toast(e.message); }
    }
    if (!isAnon) { pane.querySelector('#dcWW').addEventListener('input', draw); pane.querySelector('#dcWC').addEventListener('input', draw); }
    window.TUI.bindDrop(stage, '.dcm,.dicom', false, async list => {
      S.file = list[0];
      try {
        const u8 = bufOf(await window.TUI.readBuf(list[0]));
        S.ds = parseDicom(u8);
        const info = dicomInfo(S.ds);
        const rows = [['字段', '值']];
        const keys = ['PatientName', 'PatientID', 'Modality', 'InstitutionName', 'StudyDate', 'StudyDescription', 'Rows', 'Columns', 'BitsAllocated', 'SamplesPerPixel', 'PhotometricInterpretation', 'TransferSyntaxUID'];
        for (const k of keys) if (info[k] !== undefined && info[k] !== '') rows.push([k, esc(String(info[k]))]);
        stage.querySelector('#tDrop').classList.add('hide');
        if (!isAnon) stage.querySelector('#dcWrap').classList.remove('hide');
        const infoEl = pane.querySelector('#dcInfo2');
        pane.querySelector('#dcInfo2').innerHTML = `<div class="colhead"><span class="t">文件信息</span><span class="mini">${window.fmtSize(list[0].size)}</span></div>${tableHtml(rows, ['36%'])}`;
        void infoEl;
        if (S.ds.compressed) { pane.querySelector('#dcInfo2').innerHTML += `<div class="warnbox" style="margin-top:10px">不支持的传输语法（${esc(S.ds.tsUID)}）：像素数据为压缩格式，无法渲染。请用 dcmtk 等工具转为未压缩后再试。</div>`; }
        else draw();
      } catch (e) { console.error(e); window.toast('解析失败：' + e.message); pane.querySelector('#dcInfo2').innerHTML = `<div class="warnbox">${esc(e.message)}</div>`; }
    });
    pane.querySelector('#dcGo').addEventListener('click', async () => {
      if (!S.ds) return window.toast('请先选择 DICOM 文件');
      try {
        if (isAnon) {
          const out = anonymizeDicom(S.ds);
          const blob = new Blob([out], { type: 'application/dicom' });
          window.downloadBlob(blob, (S.file.name.replace(/\.[^.]+$/, '') || 'anonymized') + '-anon.dcm');
          pane.querySelector('#dcInfo2').innerHTML += `<div class="outbox" style="margin-top:10px">已匿名化 PatientName / PatientID / PatientBirthDate / PatientSex / InstitutionName / StudyDescription 等标签，并以显式 VR 小端重新写出 · <b>${window.fmtSize(blob.size)}</b></div>`;
          window.toast('已下载匿名化文件');
        } else {
          if (S.ds.compressed) throw new Error('不支持的传输语法，无法导出图片');
          const r = S.render || renderDicom(S.ds);
          const cv = canvasOf(r.cols, r.rows);
          cv.getContext('2d').drawImage(r.canvas, 0, 0);
          const blob = await canvasToBlob(cv, 'image/png');
          window.downloadBlob(blob, (S.file.name.replace(/\.[^.]+$/, '') || 'dicom') + '.png');
          window.toast('已导出 PNG');
        }
      } catch (e) { console.error(e); window.toast('失败：' + e.message); }
    });
  }

  /* ======================= I. 其它 ======================= */
  function hMarkdownWord(host) {
    const { stage, pane } = window.TUI.shell(host, true);
    const mwSample = ['# 标题', '', '正文段落，支持 **加粗**、*斜体*、行内代码。', '', '- 列表项一', '- 列表项二'].join('\n');
    stage.innerHTML = window.TUI.drop(dropInner({ title: '选择 Markdown 文件', hint: '或直接粘贴内容', icon: 'text' }), '.md,.markdown,.txt', false) +
      `<div style="margin-top:12px">${window.TUI.area('mwText', mwSample, '粘贴 Markdown…', 12)}</div>`;
    pane.innerHTML = window.TUI.head('Markdown → Word', '解析后生成 Word 可直接打开的 .doc（HTML 形式）。') +
      window.TUI.field('文档标题', window.TUI.input('mwTitle', '', '可选')) +
      `<div class="outbox" id="mwInfo">输出：—</div>
       <button class="btn-lime btn-run" id="mwGo">生成 .doc 并下载</button>
       <div class="progress" id="tProg" style="display:none"><i></i></div>`;
    const ta = stage.querySelector('#mwText');
    window.TUI.bindDrop(stage, '.md,.markdown,.txt', false, async list => { try { ta.value = await window.TUI.readText(list[0]); } catch (e) { window.toast('读取失败'); } });
    pane.querySelector('#mwGo').onclick = () => {
      if (!ta.value.trim()) return window.toast('请先输入 Markdown');
      const blocks = parseMarkdown(ta.value);
      const e = esc;
      let html = pane.querySelector('#mwTitle').value ? `<h1>${e(pane.querySelector('#mwTitle').value)}</h1>` : '';
      for (const b of blocks) {
        if (b.t === 'h') html += `<h${Math.min(6, b.level + 0)}>${e(stripInline(b.text))}</h${Math.min(6, b.level + 0)}>`;
        else if (b.t === 'p') html += `<p>${e(stripInline(b.text))}</p>`;
        else if (b.t === 'list') html += `<${b.ordered ? 'ol' : 'ul'}>${b.items.map(i => `<li>${e(stripInline(i))}</li>`).join('')}</${b.ordered ? 'ol' : 'ul'}>`;
        else if (b.t === 'quote') html += `<blockquote>${e(stripInline(b.text))}</blockquote>`;
        else if (b.t === 'code') html += `<pre>${e(b.text)}</pre>`;
        else if (b.t === 'hr') html += '<hr>';
        else if (b.t === 'table') html += `<table border="1" cellspacing="0" cellpadding="6"><tr>${b.head.map(h => `<th>${e(stripInline(h))}</th>`).join('')}</tr>${b.rows.map(r => `<tr>${r.map(c => `<td>${e(stripInline(c))}</td>`).join('')}</tr>`).join('')}</table>`;
      }
      const doc = wordDocHtml(pane.querySelector('#mwTitle').value || 'document', html);
      const bytes = utf8(doc);
      window.downloadBlob(new Blob([bytes], { type: 'application/msword' }), 'markdown.doc');
      pane.querySelector('#mwInfo').innerHTML = `已生成 .doc · <b>${window.fmtSize(bytes.length)}</b>`;
      window.toast('已下载 .doc');
    };
  }
  function hCompareWord(host) {
    const { stage, pane } = window.TUI.shell(host, true);
    const S = { files: [] };
    stage.innerHTML = window.TUI.drop(dropInner({ title: '选择两份文档（docx 或 txt）', hint: '依次拖入两个文件（旧 / 新）', icon: 'doc' }), '.docx,.txt,.md', true) +
      '<div id="cwList" style="margin-top:12px"></div><div id="cwOut" style="margin-top:12px"></div>';
    pane.innerHTML = window.TUI.head('文档对比', '段落级 diff。docx 用 zip + DecompressionStream 手工解压出文本，不引第三方。') +
      `<div class="outbox" id="cwInfo">已选 0 / 2 个文件</div>
       <button class="btn-lime btn-run" id="cwGo">开始对比</button>
       <div class="warnbox">仅比较文字内容；格式、图片、表格结构差异不会体现。</div>`;
    async function readAny(f) {
      if (/\.docx$/i.test(f.name)) { const { paras } = await readDocxText(f); return paras.map(p => p.text); }
      return (await window.TUI.readText(f)).split(/\r?\n/);
    }
    window.TUI.bindDrop(stage, '.docx,.txt,.md', true, list => {
      S.files = list.slice(0, 2);
      stage.querySelector('#cwList').innerHTML = S.files.map((f, i) => `<div class="filebar" style="margin-bottom:6px"><span><b>${i === 0 ? 'A（旧）' : 'B（新）'}：</b>${esc(f.name)}</span><span class="mini">${window.fmtSize(f.size)}</span></div>`).join('');
      pane.querySelector('#cwInfo').innerHTML = `已选 <b>${S.files.length}</b> / 2`;
      const dd = stage.querySelector('#tDrop'); if (dd) dd.classList.add('hide');
    });
    pane.querySelector('#cwGo').onclick = async () => {
      if (S.files.length < 2) return window.toast('请选择两个文件');
      const btn = pane.querySelector('#cwGo'); btn.disabled = true; btn.textContent = '对比中…';
      try {
        const A = await readAny(S.files[0]), B = await readAny(S.files[1]);
        const d = diffLines(A.filter(x => x.trim()).join('\n'), B.filter(x => x.trim()).join('\n'));
        let add = 0, del = 0;
        const html = d.map(x => { if (x.t === '+') add++; if (x.t === '-') del++; return x.t === ' ' ? '' : `<div style="font-family:var(--mono);font-size:12px;padding:3px 10px;white-space:pre-wrap;word-break:break-all;background:${x.t === '+' ? 'rgba(60,180,90,.16)' : 'rgba(200,70,70,.16)'};border-left:3px solid ${x.t === '+' ? '#3cb45a' : '#c84646'}">${x.t === '+' ? '+' : '-'} ${esc(x.v)}</div>`; }).join('');
        stage.querySelector('#cwOut').innerHTML = html || '<div class="emptystate">两份文档的段落一致。</div>';
        pane.querySelector('#cwInfo').innerHTML = `新增 <b>${add}</b> 段 · 删除 <b>${del}</b> 段`;
      } catch (e) { console.error(e); window.toast('对比失败：' + e.message); }
      btn.disabled = false; btn.textContent = '开始对比';
    };
  }

  /* ======================= 分发 ======================= */
  const TABLE = {};
  function reg(slugs, fn) { for (const s of slugs) TABLE[s] = fn; }
  reg(['merge-pdf'], hMerge);
  reg(['split-pdf'], hSplit);
  reg(['rotate-pdf'], hRotate);
  reg(['n-up-pdf'], hNUp);
  reg(['pdf-booklet-maker'], hBooklet);
  reg(['pdf-imposition'], hImposition);
  reg(['add-page-numbers-to-pdf'], hPageNumbers);
  reg(['unlock-pdf'], hUnlock);
  reg(['remove-metadata-from-pdf'], hRemoveMeta);
  reg(['pdf-editor'], hEditor);
  reg(['black-out-text-in-pdf', 'redact-pdf', 'sign-pdf'], hAnnotate);
  reg(['compress-pdf'], hCompress);
  reg(['image-to-pdf', 'jpg-to-pdf', 'png-to-pdf'], hImagesToPdf);
  reg(['text-to-pdf'], hTextPdf);
  reg(['markdown-to-pdf'], hMarkdownPdf);
  reg(['html-to-pdf'], hHtmlPdf);
  reg(['csv-to-pdf'], hCsvPdf);
  reg(['excel-to-pdf', 'xlsx-to-pdf'], hSheetPdf);
  reg(['docx-to-pdf', 'word-to-pdf'], hDocxPdf);
  reg(['dxf-to-pdf'], hDxfPdf);
  reg(['pdf-to-jpg', 'pdf-to-png'], hPdfRaster);
  reg(['pdf-reader'], hPdfReader);
  reg(['pdf-to-text'], hPdfToText);
  reg(['pdf-to-word'], hPdfToWord);
  reg(['pdf-to-excel', 'pdf-to-qbo', 'pdf-invoice-to-csv', 'pdf-bank-statement-to-excel'], hPdfExtractTable);
  reg(['pdf-to-ppt', 'pdf-to-pptx'], hPdfToPpt);
  reg(['compare-pdf'], hComparePdf);
  reg(['pdf-preflight'], hPreflight);
  reg(['pdf-font-checker'], hFontChecker);
  reg(['pdf-dpi-checker'], hDpiChecker);
  reg(['pdf-bleed-checker'], hBleedChecker);
  reg(['business-card-imposition'], hBusinessCard);
  reg(['csv-to-excel'], hCsvExcel);
  reg(['excel-viewer'], hExcelViewer);
  reg(['bank-statement-converter', 'bank-statement-to-csv'], hBankConverter);
  reg(['invoice-scanner', 'receipt-scanner'], hScanner);
  reg(['invoice-to-excel'], function (host, cfg, slug) { hPdfExtractTable(host, cfg || {}, 'pdf-to-excel'); });
  reg(['invoice-generator', 'proforma-invoice', 'receipt-generator', 'estimate-template'], hInvoiceGen);
  reg(['cv-maker', 'resume-builder', 'resume-templates'], hResumeGen);
  reg(['cover-letter-generator'], hCoverLetter);
  reg(['gantt-chart-maker', 'gantt-chart-template', 'project-timeline-maker'], hGantt);
  reg(['dicom-viewer', 'dicom-to-jpg', 'dicom-anonymizer'], hDicom);
  reg(['markdown-to-word'], hMarkdownWord);
  reg(['compare-word-documents'], hCompareWord);

  E.mount = function (host, cfg, slug) {
    try {
      if (!host) return;
      const fn = TABLE[slug];
      if (!fn) {
        window.TUI.soon(host, '该 PDF/文档工具尚未接线（slug: ' + slug + '）。');
        return;
      }
      fn(host, cfg || {}, slug);
    } catch (e) {
      try { console.error(e); } catch (e2) { }
      try { window.TUI.soon(host, '引擎出错：' + (e && e.message ? e.message : e)); }
      catch (e2) { host.innerHTML = '<div class="soon">引擎出错：' + (e && e.message) + '</div>'; }
    }
  };

  window.TOOL_ENGINES.pdf = E;
})();

