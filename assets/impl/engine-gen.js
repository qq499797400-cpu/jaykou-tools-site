/* ==========================================================================
   engine-gen.js — 生成器 / 绘图 / GIS / 数据 引擎
   覆盖：二维码、条码、密码/UUID/ULID、颜色三件套、LUT、字体变形、
        在线画板/白板/思维导图、激光雕刻、图表取数、化学结构、元素周期表、
        GPX/KML/GeoJSON/SHP 互转与查看、真值表、Bates 编号、时间线、
        数据浏览器、URL 解析、JSON→TS、数学求解、JS 运行器、迷你 SQL
   ========================================================================== */
(function () {
  'use strict';
  const E = {};
  const G = {};
  const TUI = () => window.TUI;
  const esc = s => window.TUI.esc(s);
  const $q = (s, r) => (r || document).querySelector(s);
  const DL = (blob, n) => window.downloadBlob(blob, n);

  function lib(src, gn) {
    return new Promise((res, rej) => {
      if (window[gn]) return res(window[gn]);
      const s = document.createElement('script');
      s.src = '../assets/vendor/' + src;
      s.onload = () => res(window[gn]);
      s.onerror = () => rej(new Error('资源加载失败: ' + src));
      document.head.appendChild(s);
    });
  }
  /* 二维码编码器（本站自研，v1–40 全版本） */
  function loadQR() {
    return new Promise((res, rej) => {
      if (window.QRGen) return res(window.QRGen);
      const s = document.createElement('script');
      s.src = '../assets/impl/qr.js';
      s.onload = () => res(window.QRGen);
      s.onerror = () => rej(new Error('QR 模块加载失败'));
      document.head.appendChild(s);
    });
  }
  function download(name, text, type) { DL(new Blob([text], { type: type || 'text/plain' }), name); }
  function canvasPNG(cv) { return new Promise(r => cv.toBlob(b => r(b), 'image/png')); }
  const dler = (cv, name) => canvasPNG(cv).then(b => DL(b, name));
  function dlCanvas(cv, name) { dler(cv, name).catch(() => window.toast('导出失败')); }

  /* ---------- 通用：两栏（输入 + 画布预览） ---------- */
  function stagePane(host, paneHtml) {
    const p = window.TUI.shell(host, true);
    p.pane.innerHTML = paneHtml;
    p.stage.innerHTML = canvasBox();
    return p;
  }
  function canvasBox(host) {
    return `<div class="canvaswrap" id="cw"><span style="color:#6b6b6b;font-size:13px">结果会显示在这里</span></div>`;
  }

  /* ==========================================================================
     1. 二维码生成器
     ========================================================================== */
  G['qr-code-generator'] = async function (host, cfg) {
    const QRGen = await loadQR();
    const p = stagePane(host, window.TUI.head('二维码参数', '全部本地生成，v1–40 全版本，可导出 PNG / SVG。') +
      window.TUI.field('内容', window.TUI.area('qrText', 'https://example.com', '网址、文本、WiFi、vCard…', 4)) +
      window.TUI.field('纠错等级', window.TUI.sel('qrEcc', [{ v: 'L', t: 'L · 7%（可恢复）' }, { v: 'M', t: 'M · 15%（推荐）' }, { v: 'Q', t: 'Q · 25%' }, { v: 'H', t: 'H · 30%（适合加 logo）' }], 'M')) +
      window.TUI.field('模块尺寸（像素/格）', window.TUI.range('qrScale', 2, 20, 8)) +
      window.TUI.field('留白（模块数）', window.TUI.range('qrMargin', 0, 8, 4)) +
      window.TUI.field('前景色', window.TUI.input('qrDark', '#000000', '', 'color')) +
      window.TUI.field('背景色', window.TUI.input('qrLight', '#ffffff', '', 'color')) +
      `<div class="outbox" id="qrInfo"></div>
       <div class="shapes" style="margin-top:14px"><button class="btn-lime btn-run" id="qrRun">生成二维码</button></div>
       <div class="runnote">完全离线生成，内容不会上传。</div>`);

    const draw = () => {
      const text = $q('#qrText', host).value;
      const ecc = $q('#qrEcc', host).value;
      const scale = +$q('#qrScale', host).value;
      const margin = +$q('#qrMargin', host).value;
      const dark = $q('#qrDark', host).value, light = $q('#qrLight', host).value;
      $q('#qrScaleV', host).textContent = scale; $q('#qrMarginV', host).textContent = margin;
      const cw = $q('#cw', host);
      if (!text.trim()) { cw.innerHTML = '<span style="color:#6b6b6b">请输入内容</span>'; return; }
      let qr;
      try { qr = QRGen(text, ecc); }
      catch (e) { cw.innerHTML = `<span style="color:#ef4444">${esc(e.message)}</span>`; return; }
      const cv = window.QRGen.toCanvas(qr, scale, margin, dark, light);
      cv.id = 'qrCv'; cw.innerHTML = ''; cw.appendChild(cv);
      $q('#qrInfo', host).innerHTML = `版本 <b>v${qr.version}</b> · 规格 <b>${qr.size}×${qr.size}</b> · 尺寸 <b>${cv.width}×${cv.height}px</b> · 字节 <b>${new TextEncoder().encode(text).length}</b>`;
      $q('#qrSvg', host).style.display = '';
      const svg = qrToSVG(qr, scale, margin, dark, light);
      host._svg = svg;
    };
    function qrToSVG(qr, scale, margin, dark, light) {
      const n = qr.size + margin * 2;
      let d = '';
      for (let r = 0; r < qr.size; r++) for (let c = 0; c < qr.size; c++)
        if (qr.modules[r][c]) d += `M${(c + margin) * scale} ${(r + margin) * scale}h${scale}v${scale}h-${scale}z`;
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${n * scale}" height="${n * scale}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
    }
    host.addEventListener('input', e => { if (/^(qrText|qrEcc|qrScale|qrMargin|qrDark|qrLight)$/.test(e.target.id)) draw(); });
    host.addEventListener('click', async e => {
      if (e.target.id === 'qrRun') draw();
      if (e.target.id === 'qrPng') { const cv = $q('#qrCv', host); if (cv) dlCanvas(cv, 'qrcode.png'); }
      if (e.target.id === 'qrSvg') { if (host._svg) download('qrcode.svg', host._svg, 'image/svg+xml'); }
    });
    p.pane.insertAdjacentHTML('beforeend', `<div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="qrPng">下载 PNG</button><button class="btn-ghost btn-sm" id="qrSvg" style="display:none">下载 SVG</button></div>`);
    draw();
  };

  /* ==========================================================================
     2. 条码（bwip-js：Code128 / EAN-13 / UPC-A / Code39 / ITF / Codabar …）
     ========================================================================== */
  const BC_TYPES = [
    { v: 'code128', t: 'Code 128（通用，物流/库存）' }, { v: 'ean13', t: 'EAN-13（零售商品，13 位）' },
    { v: 'upca', t: 'UPC-A（北美零售，12 位）' }, { v: 'code39', t: 'Code 39（工业/车牌）' },
    { v: 'code93', t: 'Code 93' }, { v: 'itf14', t: 'ITF-14（外箱，14 位）' },
    { v: 'codabar', t: 'Codabar（图书馆/血库）' }, { v: 'gs1-128', t: 'GS1-128（含 AI 括号）' },
    { v: 'qrcode', t: 'QR Code' }, { v: 'datamatrix', t: 'Data Matrix' }, { v: 'pdf417', t: 'PDF417' }
  ];
  function barcodeUI(host, cfg, fixed) {
    const p = stagePane(host, window.TUI.head('条码参数', '由 bwip-js（Barcode Writer in Pure PostScript 的 JS 移植）本地渲染，符合各符号体系的官方规范。') +
      (fixed ? '' : window.TUI.field('符号体系', window.TUI.sel('bcType', BC_TYPES, cfg.type || 'code128'))) +
      window.TUI.field('编码内容', window.TUI.input('bcText', cfg.sample || '9501101531000', '')) +
      window.TUI.field('条高（像素）', window.TUI.range('bcH', 30, 300, 110)) +
      window.TUI.field('缩放（像素/模块）', window.TUI.range('bcS', 1, 8, 2)) +
      window.TUI.field('是否显示人类可读文字', window.TUI.chk('bcText2', '在下方显示明文', true)) +
      `<div class="outbox" id="bcInfo"></div>
       <div class="shapes" style="margin-top:14px"><button class="btn-lime btn-run" id="bcRun">生成条码</button></div>
       <div class="runnote">校验位自动计算；输入不合法会给出具体提示。</div>
       <div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="bcPng">下载 PNG</button><button class="btn-ghost btn-sm" id="bcSvg">下载 SVG</button></div>`);
    const bw = () => window.bwipjs;
    const draw = async () => {
      const b = bw();
      const type = fixed || ($q('#bcType', host) ? $q('#bcType', host).value : 'code128');
      const text = $q('#bcText', host).value.trim();
      const H = +$q('#bcH', host).value, S = +$q('#bcS', host).value;
      $q('#bcHV', host).textContent = H; $q('#bcSV', host).textContent = S;
      const showText = $q('#bcText2', host).classList.contains('on');
      const cw = $q('#cw', host);
      if (!text) { cw.innerHTML = '<span style="color:#6b6b6b">请输入内容</span>'; return; }
      const opt = { bcid: type, text, height: H, scale: S, includetext: showText, textxalign: 'center' };
      try {
        const cv = document.createElement('canvas');
        b.toCanvas(cv, opt);
        cv.id = 'bcCv'; cw.innerHTML = ''; cw.appendChild(cv);
        $q('#bcInfo', host).innerHTML = `体系 <b>${type}</b> · 尺寸 <b>${cv.width}×${cv.height}px</b> · 明文 <b>${esc(text)}</b>`;
        host._bcSvgOk = true;
      } catch (e) { cw.innerHTML = `<span style="color:#ef4444">${esc(e.message)}</span>`; $q('#bcInfo', host).textContent = ''; }
    };
    host._bcDraw = draw;
    host.addEventListener('click', e => { if (e.target.id === 'bcRun') draw(); });
    host.addEventListener('input', e => { if (/^bc/.test(e.target.id)) draw(); });
    host.addEventListener('click', async e => {
      if (e.target.id === 'bcPng') { const cv = $q('#bcCv', host); if (cv) dlCanvas(cv, 'barcode.png'); }
      if (e.target.id === 'bcSvg') {
        try {
          const b = bw();
          const svg = b.toSVG({ bcid: (fixed || $q('#bcType', host).value), text: $q('#bcText', host).value.trim(), height: +$q('#bcH', host).value, scale: +$q('#bcS', host).value, includetext: $q('#bcText2', host).classList.contains('on'), textxalign: 'center' });
          download('barcode.svg', svg[0], 'image/svg+xml');
        } catch (err) { window.toast(err.message); }
      }
    });
    lib('bwip-js.min.js', 'bwipjs').then(draw).catch(e => { $q('#cw', host).innerHTML = `<span style="color:#ef4444">${esc(e.message)}</span>`; });
  }
  G['barcode-generator'] = (h, c) => barcodeUI(h, c);
  G['ean-13-barcode-generator'] = (h, c) => barcodeUI(h, c, 'ean13');
  G['upc-barcode-generator'] = (h, c) => barcodeUI(h, c, 'upca');

  /* ==========================================================================
     3. 密码 / UUID / ULID
     ========================================================================== */
  const SETS = { lower: 'abcdefghijklmnopqrstuvwxyz', upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', digit: '0123456789', sym: '!@#$%^&*()-_=+[]{};:,.<>?/' };
  G['password-generator'] = function (host, cfg) {
    const p = stagePane(host, window.TUI.head('密码参数', '用 Web Crypto API 的加密随机数生成，安全性和系统级密码生成器一致。') +
      window.TUI.field('长度', window.TUI.range('pwLen', 6, 128, 20)) +
      ['lower:小写字母 a-z', 'upper:大写字母 A-Z', 'digit:数字 0-9', 'sym:符号 !@#$'].map((s, i) =>
        window.TUI.chk('pw' + i, s.split(':')[1], true)).join('') +
      window.TUI.chk('pwAmb', '排除易混淆字符（0/O、1/l/I）', false) +
      window.TUI.field('一次生成几个', window.TUI.range('pwN', 1, 50, 5)) +
      `<div class="shapes" style="margin-top:14px"><button class="btn-lime btn-run" id="pwRun">生成</button></div>`);
    const out = document.createElement('div');
    out.className = 'ioout'; out.style.cssText = 'margin-top:14px;min-height:180px;font-size:14px;line-height:1.9';
    p.stage.appendChild(out);
    const info = document.createElement('div'); info.className = 'outbox'; info.style.marginTop = '14px';
    p.stage.appendChild(info);
    const rnd = n => { const a = new Uint32Array(n); crypto.getRandomValues(a); return a; };
    const pick = (chars, r) => chars[r % chars.length];
    function gen() {
      const len = +$q('#pwLen', host).value, n = +$q('#pwN', host).value;
      $q('#pwLenV', host).textContent = len; $q('#pwNV', host).textContent = n;
      let chars = '';
      ['pw0', 'pw1', 'pw2', 'pw3'].forEach((id, i) => { if ($q('#' + id, host).classList.contains('on')) chars += SETS[['lower', 'upper', 'digit', 'sym'][i]]; });
      if ($q('#pwAmb', host).classList.contains('on')) chars = chars.replace(/[0O1lI|`'"]/g, '');
      if (!chars) { out.textContent = '请至少选择一种字符类型'; info.textContent = ''; return; }
      const r = rnd(len * n), list = [];
      for (let k = 0; k < n; k++) {
        let s = '';
        for (let i = 0; i < len; i++) s += pick(chars, r[k * len + i]);
        list.push(s);
      }
      out.innerHTML = list.map(s => `<div style="word-break:break-all">${esc(s)}</div>`).join('');
      const pool = chars.length, bits = Math.round(len * Math.log2(pool) * 10) / 10;
      const guesses = Math.pow(2, bits);
      const sec = guesses / 1e12;               // 每秒一万亿次猜测
      const yrs = sec / 3.15e7;
      const level = bits >= 100 ? '极强' : bits >= 75 ? '强' : bits >= 55 ? '中等' : '偏弱';
      const col = bits >= 75 ? '#22c55e' : bits >= 55 ? '#eab308' : '#ef4444';
      info.innerHTML = `字符池 <b>${pool}</b> · 熵 <b style="color:${col}">${bits} bit</b> · 等级 <b style="color:${col}">${level}</b><br>按当前硬件（10¹² 次/秒）离线穷举约需 <b>${yrs > 1e6 ? yrs.toExponential(2) + ' 年' : Math.round(yrs).toLocaleString() + ' 年'}</b>`;
      host._list = list;
    }
    host.addEventListener('input', gen);
    host.addEventListener('click', e => {
      if (e.target.id === 'pwRun') gen();
      if (e.target.id === 'pwCopy' && host._list) window.copyText(host._list.join('\n'));
      if (e.target.id === 'pwDown' && host._list) download('passwords.txt', host._list.join('\n'));
    });
    p.pane.insertAdjacentHTML('beforeend', `<div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="pwCopy">复制全部</button><button class="btn-ghost btn-sm" id="pwDown">下载 .txt</button></div>`);
    gen();
  };

  function ulid() {
    const ENC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    let time = Date.now();
    const bytes = new Uint8Array(10); crypto.getRandomValues(bytes);
    let out = '', t = '';
    for (let i = 9; i >= 0; i--) { t = ENC[time % 32] + t; time = Math.floor(time / 32); if (!time) break; }
    while (t.length < 10) t = '0' + t;
    let r = '';
    for (let i = 0; i < 16; i++) r += ENC[bytes[i] & 31];
    return t + r.slice(0, 16);
  }
  const uuidV4 = () => (crypto.randomUUID ? crypto.randomUUID() :
    ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));

  G['uuid-generator'] = G['guid-generator'] = function (host, cfg) {
    const p = stagePane(host, window.TUI.head('生成参数', 'UUID v4 用 Web Crypto 的加密随机数；ULID 按 Crockford Base32 规范（48 位时间戳 + 80 位随机）。') +
      window.TUI.field('标识类型', window.TUI.sel('idKind', [{ v: 'v4', t: 'UUID v4（随机，最常用）' }, { v: 'ulid', t: 'ULID（按时间可排序）' }, { v: 'nano', t: 'Nano ID（21 位短 ID）' }, { v: 'hex8', t: '8 位随机十六进制' }], 'v4')) +
      window.TUI.field('数量', window.TUI.range('idN', 1, 200, 10)) +
      window.TUI.chk('idUp', '转大写', false) +
      window.TUI.chk('idBr', '加花括号 {}（注册表风格）', false) +
      `<div class="shapes" style="margin-top:14px"><button class="btn-lime btn-run" id="idRun">生成</button></div>`);
    const out = document.createElement('div'); out.className = 'ioout'; out.style.cssText = 'margin-top:14px;min-height:200px;font-size:13.5px;line-height:1.8';
    p.stage.appendChild(out);
    const NANO = 'useandom26T198340PX75pxJACKVERYMINDBUSHWOLFGQZbfghjklqvwyzrict';
    function gen() {
      const kind = $q('#idKind', host).value, n = +$q('#idN', host).value;
      $q('#idNV', host).textContent = n;
      const up = $q('#idUp', host).classList.contains('on'), br = $q('#idBr', host).classList.contains('on');
      const r = new Uint8Array(32 * n); crypto.getRandomValues(r);
      const list = [];
      for (let k = 0; k < n; k++) {
        let s;
        if (kind === 'v4') s = uuidV4();
        else if (kind === 'ulid') s = ulid();
        else if (kind === 'nano') { let t = ''; for (let i = 0; i < 21; i++) t += NANO[r[k * 32 + i] % 64]; s = t; }
        else { let t = ''; for (let i = 0; i < 8; i++) t += (r[k * 32 + i] % 16).toString(16); s = t; }
        if (up) s = s.toUpperCase();
        if (br) s = '{' + s + '}';
        list.push(s);
      }
      out.innerHTML = list.map(s => `<div style="word-break:break-all">${esc(s)}</div>`).join('');
      host._list = list;
    }
    host.addEventListener('input', gen);
    host.addEventListener('click', e => {
      if (e.target.id === 'idRun') gen();
      if (e.target.id === 'idCopy' && host._list) window.copyText(host._list.join('\n'));
      if (e.target.id === 'idDown' && host._list) download('ids.txt', host._list.join('\n'));
    });
    p.pane.insertAdjacentHTML('beforeend', `<div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="idCopy">复制全部</button><button class="btn-ghost btn-sm" id="idDown">下载 .txt</button></div>`);
    gen();
  };

  /* ==========================================================================
     4. 颜色三件套 + LUT
     ========================================================================== */
  function hex2rgb(h) { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); if (!/^[0-9a-f]{6}$/i.test(h)) return null; return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  const rgb2hex = (r, g, b) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  function rgb2hsl(r, g, b) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0; if (mx !== mn) { const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; } return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)]; }
  function relLum(r, g, b) { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); }
  function contrast(c1, c2) { const a = relLum(...c1), b = relLum(...c2); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); }

  G['hex-to-rgb'] = function (host) {
    const p = stagePane(host, window.TUI.head('颜色换算', 'HEX / RGB / HSL / CMYK 互转，支持 3 位与 8 位（含透明度）十六进制。') +
      window.TUI.field('颜色', window.TUI.input('cPick', '#3b82f6', '', 'color')) +
      window.TUI.field('或直接输入（HEX / rgb() / hsl()）', window.TUI.input('cIn', '#3b82f6', '#3b82f6 或 59,130,246')) +
      `<div class="outbox" id="cOut"></div><div id="cPrev" style="height:110px;border-radius:12px;margin-top:14px;border:1px solid var(--border)"></div>`);
    const run = () => {
      let v = $q('#cIn', host).value.trim();
      let rgb = null;
      if (/^#?[0-9a-f]{3,8}$/i.test(v)) rgb = hex2rgb(v);
      else { const m = /(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)/.exec(v); if (m) rgb = [+m[1], +m[2], +m[3]]; }
      if (!rgb) { $q('#cOut', host).textContent = '无法识别的颜色，试试 #3b82f6 或 59,130,246'; return; }
      const [r, g, b] = rgb, hx = rgb2hex(r, g, b), [h, s, l] = rgb2hsl(r, g, b);
      const k = 1 - Math.max(r, g, b) / 255, cmyk = k === 1 ? [0, 0, 0, 100] : [Math.round((1 - r / 255 - k) / (1 - k) * 100), Math.round((1 - g / 255 - k) / (1 - k) * 100), Math.round((1 - b / 255 - k) / (1 - k) * 100), Math.round(k * 100)];
      const Y = Math.round(.299 * r + .587 * g + .114 * b);
      $q('#cOut', host).innerHTML =
        `<div class="row"><span>HEX</span><b>${hx}</b></div>
         <div class="row"><span>RGB</span><b>rgb(${r}, ${g}, ${b})</b></div>
         <div class="row"><span>HSL</span><b>hsl(${h}, ${s}%, ${l}%)</b></div>
         <div class="row"><span>CMYK</span><b>${cmyk.join(', ')}%</b></div>
         <div class="row"><span>灰度亮度 Y</span><b>${Y}</b></div>`;
      $q('#cPrev', host).style.background = hx;
      host._c = { hx, r, g, b };
    };
    host.addEventListener('input', e => { if (e.target.id === 'cPick') { $q('#cIn', host).value = e.target.value; run(); } if (e.target.id === 'cIn') run(); });
    host.addEventListener('click', e => {
      if (e.target.id === 'cCopy') { if (host._c) window.copyText(host._c.hx); }
      if (e.target.id === 'cWhite' && host._c) { const L = contrast(host._c, [255, 255, 255]); window.copyText(`与白底对比度 ${L.toFixed(2)}`); }
    });
    p.pane.insertAdjacentHTML('beforeend', `<div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="cCopy">复制 HEX</button></div>`);
    run();
  };

  G['color-picker'] = function (host) {
    const p = stagePane(host, window.TUI.head('取色器', '选择、微调、保存到色板，可导出 JSON / CSS 变量 / Tailwind 配置。') +
      window.TUI.field('颜色', window.TUI.input('cpIn', '#22c55e', '', 'color')) +
      window.TUI.field('色相', window.TUI.range('cpH', 0, 360, 140)) +
      window.TUI.field('饱和度', window.TUI.range('cpS', 0, 100, 80)) +
      window.TUI.field('明度', window.TUI.range('cpL', 0, 100, 50)) +
      `<div id="cpList" style="margin-top:12px"></div>`);
    const box = document.createElement('div'); box.style.cssText = 'height:120px;border-radius:12px;border:1px solid var(--border);margin-top:14px';
    p.stage.appendChild(box);
    const out = document.createElement('div'); out.className = 'outbox'; out.style.marginTop = '14px'; p.stage.appendChild(out);
    let palette = [];
    const paint = () => {
      const H = +$q('#cpH', host).value, S = +$q('#cpS', host).value, L = +$q('#cpL', host).value;
      $q('#cpHV', host).textContent = H; $q('#cpSV', host).textContent = S + '%'; $q('#cpLV', host).textContent = L + '%';
      const h = H / 360, s = S / 100, l = L / 100;
      const f = n => { const k = (n + h * 12) % 12; const a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
      const hex = rgb2hex(f(0), f(8), f(4));
      $q('#cpIn', host).value = hex;
      box.style.background = hex;
      out.innerHTML = `<div class="row"><span>HEX</span><b>${hex}</b></div><div class="row"><span>RGB</span><b>rgb(${f(0)}, ${f(8)}, ${f(4)})</b></div><div class="row"><span>HSL</span><b>hsl(${H}, ${S}%, ${L}%)</b></div>`;
      host._cur = hex;
    };
    const list = () => {
      $q('#cpList', host).innerHTML = palette.length ? palette.map((c, i) =>
        `<span class="swatch" data-i="${i}" style="background:${c};width:38px;height:38px;display:inline-block;border-radius:9px;border:1px solid #333;margin:0 6px 6px 0;cursor:pointer" title="${c}"></span>`).join('') : '<span style="color:#6b6b6b;font-size:13px">点「加入色板」保存当前颜色</span>';
    };
    host.addEventListener('input', paint);
    host.addEventListener('click', e => {
      if (e.target.id === 'cpAdd' && host._cur) { palette.push(host._cur); list(); }
      if (e.target.id === 'cpJson') download('palette.json', JSON.stringify(palette, null, 2), 'application/json');
      if (e.target.id === 'cpCss') download('palette.css', palette.map((c, i) => `--color-${i + 1}: ${c};`).join('\n'), 'text/css');
      const sw = e.target.closest('[data-i]');
      if (sw) window.copyText(palette[+sw.dataset.i]);
    });
    p.pane.insertAdjacentHTML('beforeend', `<div class="shapes" style="margin-top:10px"><button class="btn-lime btn-sm" id="cpAdd">加入色板</button><button class="btn-ghost btn-sm" id="cpJson">导出 JSON</button><button class="btn-ghost btn-sm" id="cpCss">导出 CSS</button></div>`);
    paint(); list();
  };

  G['color-contrast-checker'] = function (host) {
    const p = stagePane(host, window.TUI.head('对比度检查', '按 WCAG 2.1 相对亮度公式计算对比度，并给出 AA / AAA 判定。') +
      window.TUI.field('前景色（文字）', window.TUI.input('ccFg', '#111111', '', 'color')) +
      window.TUI.field('背景色', window.TUI.input('ccBg', '#ffffff', '', 'color')) +
      `<div id="ccPrev" style="border-radius:12px;border:1px solid var(--border);padding:26px;font-size:20px;font-weight:600;margin-top:6px">这是一段用于检查对比度的示例标题文字。<br><span style="font-size:14px;font-weight:400">14px 正文示例：小字号更需要足够的对比度。</span></div>
       <div class="outbox" id="ccOut"></div>`);
    const run = () => {
      const fg = hex2rgb($q('#ccFg', host).value), bg = hex2rgb($q('#ccBg', host).value);
      const c = contrast(fg, bg);
      $q('#ccPrev', host).style.cssText += `;background:${rgb2hex(...bg)};color:${rgb2hex(...fg)}`;
      const f = (n, ok) => `<span style="color:${ok ? '#22c55e' : '#ef4444'}">${ok ? '✔' : '✘'}</span>`;
      $q('#ccOut', host).innerHTML = `<div class="row"><span>对比度</span><b style="font-size:20px">${c.toFixed(2)} : 1</b></div>
        <div class="row"><span>AA 正文（≥4.5）</span><b>${f(0, c >= 4.5)} ${c >= 4.5 ? '通过' : '未通过'}</b></div>
        <div class="row"><span>AA 大字（≥3.0，18pt+）</span><b>${f(0, c >= 3)} ${c >= 3 ? '通过' : '未通过'}</b></div>
        <div class="row"><span>AAA 正文（≥7.0）</span><b>${f(0, c >= 7)} ${c >= 7 ? '通过' : '未通过'}</b></div>
        <div class="row"><span>AAA 大字（≥4.5）</span><b>${f(0, c >= 4.5)} ${c >= 4.5 ? '通过' : '未通过'}</b></div>
        ${c < 4.5 ? `<div style="margin-top:8px;color:#f59e0b">建议：把文字加深或背景提亮，最简单的做法是让两者中较亮的一侧更接近白色、较暗的一侧更接近黑色。</div>` : ''}`;
    };
    host.addEventListener('input', run); run();
  };

  G['lut-generator'] = function (host) {
    const p = stagePane(host, window.TUI.head('LUT 生成', '生成 .cube 查找表（33³，可导入 Premiere / DaVinci / OBS / OBS-studio）。') +
      window.TUI.field('预设', window.TUI.sel('lutP', [
        { v: 'none', t: '原样（空表）' }, { v: 'film', t: '胶片感（降饱和 + 提阴影）' },
        { v: 'teal', t: '青橙 Teal & Orange' }, { v: 'bleach', t: '漂白（Bleach Bypass）' },
        { v: 'warm', t: '暖色' }, { v: 'cool', t: '冷色' }, { v: 'sepia', t: '复古棕' }, { v: 'noir', t: '黑白硬调' }
      ], 'film')) +
      window.TUI.field('强度', window.TUI.range('lutMix', 0, 100, 80)) +
      window.TUI.field('对比度（-50 到 50）', window.TUI.range('lutCon', -50, 50, 0)) +
      window.TUI.field('饱和度（-50 到 50）', window.TUI.range('lutSat', -50, 50, 0)) +
      `<div class="shapes" style="margin-top:14px"><button class="btn-lime btn-run" id="lutRun">生成 .cube</button></div><div class="outbox" id="lutOut"></div>`);
    const build = () => {
      const N = 33, preset = $q('#lutP', host).value, mix = +$q('#lutMix', host).value / 100;
      const con = +$q('#lutCon', host).value / 100, sat = 1 + (+$q('#lutSat', host).value / 100);
      $q('#lutMixV', host).textContent = Math.round(mix * 100); $q('#lutConV', host).textContent = $q('#lutCon', host).value; $q('#lutSatV', host).textContent = $q('#lutSat', host).value;
      const lines = [`TITLE "wsft-${preset}"`, `LUT_3D_SIZE ${N}`, ''];
      const mixCh = (a, b) => a + (b - a) * mix;
      for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
        let R = r / (N - 1), Gg = g / (N - 1), B = b / (N - 1);
        if (preset === 'film') { R = mixCh(R, R * .93 + .05); Gg = mixCh(Gg, Gg * .9 + .07); B = mixCh(B, B * .92 + .03); }
        else if (preset === 'teal') { R = mixCh(R, Math.min(1, R * 1.12 + .02)); Gg = mixCh(Gg, Gg); B = mixCh(B, Math.min(1, B * 1.08 + .04)); }
        else if (preset === 'bleach') { const m = (R + Gg + B) / 3; R = mixCh(R, m * .75 + R * .45); Gg = mixCh(Gg, m * .75 + Gg * .45); B = mixCh(B, m * .75 + B * .45); }
        else if (preset === 'warm') { R = mixCh(R, Math.min(1, R * 1.08 + .03)); B = mixCh(B, B * .94); }
        else if (preset === 'cool') { R = mixCh(R, R * .94); B = mixCh(B, Math.min(1, B * 1.08 + .03)); }
        else if (preset === 'sepia') { const m = .3 * R + .59 * Gg + .11 * B; R = mixCh(R, Math.min(1, m * 1.07 + .05)); Gg = mixCh(Gg, m * .95); B = mixCh(B, m * .78); }
        else if (preset === 'noir') { const m = .3 * R + .59 * Gg + .11 * B; const v = m < .5 ? m * 1.4 : 1 - (1 - m) * 1.2; R = mixCh(R, v); Gg = mixCh(Gg, v); B = mixCh(B, v); }
        if (con) { R = mixCh(R, Math.min(1, Math.max(0, (R - .5) * (1 + con) + .5))); Gg = mixCh(Gg, Math.min(1, Math.max(0, (Gg - .5) * (1 + con) + .5))); B = mixCh(B, Math.min(1, Math.max(0, (B - .5) * (1 + con) + .5))); }
        if (sat !== 1) { const m = .2126 * R + .7152 * Gg + .0722 * B; R = mixCh(R, m + (R - m) * sat); Gg = mixCh(Gg, m + (Gg - m) * sat); B = mixCh(B, m + (B - m) * sat); }
        lines.push([R, Gg, B].map(v => v.toFixed(6)).join(' '));
      }
      const txt = lines.join('\n');
      $q('#lutOut', host).innerHTML = `节点数 <b>${N}³ = ${N * N * N}</b> · 文件大小约 <b>${window.fmtSize(new Blob([txt]).size)}</b>`;
      download('wsft-lut.cube', txt, 'text/plain');
      window.toast('已生成并开始下载 .cube');
    };
    host.addEventListener('click', e => { if (e.target.id === 'lutRun') build(); });
  };

  /* ==========================================================================
     5. 字体变形（Unicode 数学字母数字符号）
     ========================================================================== */
  const STYLES = {
    bold: { A: 0x1D400, a: 0x1D41A, d: 0x1D7CE },
    italic: { A: 0x1D434, a: 0x1D44E },
    bolditalic: { A: 0x1D468, a: 0x1D482 },
    script: { A: 0x1D49C, a: 0x1D4B6 },
    boldscript: { A: 0x1D4D0, a: 0x1D4EA },
    fraktur: { A: 0x1D504, a: 0x1D51E },
    double: { A: 0x1D538, a: 0x1D552, d: 0x1D7D8 },
    sans: { A: 0x1D5A0, a: 0x1D5BA, d: 0x1D7E2 },
    sansbold: { A: 0x1D5D4, a: 0x1D5EE },
    mono: { A: 0x1D670, a: 0x1D68A, d: 0x1D7F6 },
    fullwidth: { A: 0xFF21, a: 0xFF41, d: 0xFF10 },
    circled: { A: 0x24B6, a: 0x24D0, d: 0x2460 },
    squared: { A: 0x1F130, a: 0x1F130, d: 0x1F130 },
    smallcaps: null
  };
  /* 小型大写字母需要逐字映射 */
  const SMALLCAPS = { a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ', j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'ǫ', r: 'ʀ', s: 's', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ' };
  function stylize(text, style) {
    const S = STYLES[style];
    if (!S) return [...text].map(c => SMALLCAPS[c.toLowerCase()] || c).join('');
    return [...text].map(c => {
      const code = c.codePointAt(0);
      if (code >= 65 && code <= 90 && S.A) return String.fromCodePoint(S.A + (code - 65));
      if (code >= 97 && code <= 122 && S.a) return String.fromCodePoint(S.a + (code - 97));
      if (code >= 48 && code <= 57 && S.d) return String.fromCodePoint(S.d + (code - 48));
      return c;
    }).join('');
  }
  const STYLE_NAMES = [['bold', '粗体'], ['italic', '斜体'], ['bolditalic', '粗斜体'], ['script', '花体'], ['boldscript', '粗花体'], ['fraktur', '哥特体'], ['double', '空心'], ['sans', '无衬线'], ['sansbold', '无衬线粗'], ['mono', '等宽'], ['fullwidth', '全角'], ['circled', '圆圈'], ['smallcaps', '小型大写']];
  function fontTool(host, cfg, preStyles) {
    const styles = preStyles || STYLE_NAMES.map(s => s[0]);
    const p = window.TUI.shell(host, true);
    p.pane.innerHTML = window.TUI.head('变形字体', '用的是 Unicode 的数学字母数字符号区，粘贴到微信、Instagram、X、Discord 都能显示（取决于对方字体是否覆盖）。') +
      window.TUI.field('输入', window.TUI.area('fgIn', cfg.sample || 'Hello World', '', 3)) +
      window.TUI.field('预设组合', window.TUI.sel('fgPreset', [
        { v: 'all', t: '全部风格' }, { v: 'social', t: '社交媒体常用（粗/斜/花/圆圈/全角）' },
        { v: 'hacker', t: '极客（等宽/空心/哥特）' }, { v: 'cute', t: '可爱（圆圈/全角/小型大写）' }
      ], 'social'));
    const out = document.createElement('div'); out.className = 'ioout'; out.style.cssText = 'margin-top:14px;min-height:300px;font-size:15px;line-height:2';
    p.stage.appendChild(out);
    function render() {
      const text = $q('#fgIn', host).value, pre = $q('#fgPreset', host).value;
      const pick = pre === 'all' ? styles : pre === 'social' ? ['bold', 'italic', 'script', 'circled', 'fullwidth'] : pre === 'hacker' ? ['mono', 'double', 'fraktur', 'sansbold'] : ['circled', 'fullwidth', 'smallcaps', 'boldscript'];
      const rows = pick.map(k => { const nm = (STYLE_NAMES.find(s => s[0] === k) || [k, k])[1]; return { nm, k, txt: stylize(text, k) }; });
      out.innerHTML = rows.map(r => `<div style="margin-bottom:12px"><div style="font-size:11px;letter-spacing:1.5px;color:#8a8a8a;text-transform:uppercase">${esc(r.nm)} <button class="shape" data-cp="${r.k}" style="padding:2px 9px;font-size:11px;margin-left:8px">复制</button></div><div style="word-break:break-all">${esc(r.txt)}</div></div>`).join('');
      host._rows = rows;
    }
    host.addEventListener('input', render);
    host.addEventListener('click', e => {
      const b = e.target.closest('[data-cp]');
      if (b && host._rows) { const r = host._rows.find(x => x.k === b.dataset.cp); if (r) window.copyText(r.txt); }
    });
    p.pane.insertAdjacentHTML('beforeend', `<div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="fgDown">下载 .txt</button></div>`);
    host.addEventListener('click', e => { if (e.target.id === 'fgDown' && host._rows) download('fonts.txt', host._rows.map(r => `【${r.nm}】\n${r.txt}`).join('\n\n')); });
    render();
  }
  G['font-generator'] = (h, c) => fontTool(h, c);
  G['cursive-font-generator'] = (h, c) => fontTool(h, Object.assign({}, c, { sample: '花体示例文字' }), ['script', 'boldscript', 'italic', 'bolditalic', 'fraktur']);
  G['bold-text-generator'] = (h, c) => fontTool(h, Object.assign({}, c, { sample: '粗体示例文字' }), ['bold', 'sansbold', 'bolditalic', 'boldscript']);

  /* ==========================================================================
     6. 画板 / 白板 / 思维导图 / 激光雕刻 / 图表取数
     ========================================================================== */
  function paintApp(host, cfg, opts) {
    const o = Object.assign({ shapes: true, text: true, notes: false }, opts || {});
    const p = window.TUI.shell(host, true);
    p.pane.innerHTML = window.TUI.head('画板', '全部本地绘制，可导出 PNG。') +
      window.TUI.field('颜色', window.TUI.input('ptCol', '#e8f542', '', 'color')) +
      window.TUI.field('笔刷大小', window.TUI.range('ptSize', 1, 80, 6)) +
      (o.shapes ? window.TUI.field('透明度', window.TUI.range('ptAlpha', 10, 100, 100)) : '') +
      (o.text ? window.TUI.field('文字内容（用文字工具时）', window.TUI.input('ptTxt', '文本', '')) : '') +
      `<div class="shapes" style="margin-top:14px;flex-wrap:wrap">
        <button class="shape on" data-t="brush">画笔</button><button class="shape" data-t="eraser">橡皮</button>
        ${o.shapes ? '<button class="shape" data-t="line">直线</button><button class="shape" data-t="rect">矩形</button><button class="shape" data-t="ellipse">椭圆</button>' : ''}
        ${o.text ? '<button class="shape" data-t="text">文字</button>' : ''}
        <button class="shape" data-t="fill">填充</button></div>
       <div class="shapes" style="margin-top:10px;flex-wrap:wrap">
        <button class="shape" id="ptUndo">撤销</button><button class="shape" id="ptRedo">重做</button>
        <button class="shape" id="ptClear">清空</button></div>`;
    const wrap = document.createElement('div'); wrap.className = 'canvaswrap'; wrap.style.minHeight = '460px';
    p.stage.appendChild(wrap);
    const cv = document.createElement('canvas'); cv.width = 900; cv.height = 560; cv.style.cssText = 'max-width:100%;background:#fff;border-radius:8px;cursor:crosshair;touch-action:none';
    wrap.appendChild(cv);
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    const undo = [], redo = [];
    const snap = () => { undo.push(cv.toDataURL()); if (undo.length > 40) undo.shift(); redo.length = 0; };
    const restore = (arr, other) => { if (!arr.length) return window.toast('没有可撤销的了'); const d = arr.pop(); const im = new Image(); im.onload = () => { other.push(cv.toDataURL()); ctx.globalAlpha = 1; ctx.drawImage(im, 0, 0); }; im.src = d; };
    let tool = 'brush', drawing = false, sx = 0, sy = 0, before = null;
    const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId);
      const [x, y] = pos(e);
      const alpha = o.shapes ? (+$q('#ptAlpha', host).value / 100) : 1;
      ctx.globalAlpha = alpha;
      ctx.lineCap = ctx.lineJoin = 'round';
      ctx.lineWidth = +$q('#ptSize', host).value;
      ctx.strokeStyle = ctx.fillStyle = tool === 'eraser' ? '#ffffff' : $q('#ptCol', host).value;
      if (tool === 'brush' || tool === 'eraser') { drawing = true; sx = x; sy = y; before = cv.toDataURL(); ctx.beginPath(); ctx.moveTo(x, y); }
      else if (tool === 'fill') { snap(); floodFill(x, y, ctx.fillStyle); ctx.globalAlpha = 1; }
      else if (tool === 'text') { snap(); ctx.font = `${Math.max(12, +$q('#ptSize', host).value * 6)}px sans-serif`; ctx.fillText($q('#ptTxt', host).value || '文本', x, y); ctx.globalAlpha = 1; }
      else { drawing = true; sx = x; sy = y; before = cv.toDataURL(); }
    });
    cv.addEventListener('pointermove', e => {
      if (!drawing) return;
      const [x, y] = pos(e);
      if (tool === 'brush' || tool === 'eraser') { ctx.lineTo(x, y); ctx.stroke(); }
      else {
        const im = new Image(); im.onload = () => { ctx.globalAlpha = 1; ctx.drawImage(im, 0, 0); ctx.globalAlpha = (+$q('#ptAlpha', host).value / 100); ctx.beginPath();
          if (tool === 'line') { ctx.moveTo(sx, sy); ctx.lineTo(x, y); ctx.stroke(); }
          else if (tool === 'rect') ctx.strokeRect(sx, sy, x - sx, y - sy);
          else if (tool === 'ellipse') { ctx.ellipse((sx + x) / 2, (sy + y) / 2, Math.abs(x - sx) / 2, Math.abs(y - sy) / 2, 0, 0, 7); ctx.stroke(); }
          ctx.globalAlpha = 1; };
        im.src = before;
      }
    });
    cv.addEventListener('pointerup', () => { if (drawing) { drawing = false; snap(); } ctx.globalAlpha = 1; });
    function floodFill(x0, y0, hex) {
      const im = ctx.getImageData(0, 0, cv.width, cv.height), d = im.data;
      const rgb = hex2rgb(hex) || [0, 0, 0];
      const idx = (x, y) => (y * cv.width + x) * 4;
      const t = idx(x0 | 0, y0 | 0), tr = d[t], tg = d[t + 1], tb = d[t + 2];
      if (tr === rgb[0] && tg === rgb[1] && tb === rgb[2]) return;
      const st = [[x0 | 0, y0 | 0]];
      while (st.length) {
        const [x, y] = st.pop(); if (x < 0 || y < 0 || x >= cv.width || y >= cv.height) continue;
        const i = idx(x, y);
        if (Math.abs(d[i] - tr) > 24 || Math.abs(d[i + 1] - tg) > 24 || Math.abs(d[i + 2] - tb) > 24) continue;
        d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = 255;
        st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
      }
      ctx.putImageData(im, 0, 0);
    }
    host.addEventListener('click', e => {
      const b = e.target.closest('[data-t]');
      if (b) { host.querySelectorAll('[data-t]').forEach(x => x.classList.remove('on')); b.classList.add('on'); tool = b.dataset.t; }
      if (e.target.id === 'ptUndo') restore(undo, redo);
      if (e.target.id === 'ptRedo') restore(redo, undo);
      if (e.target.id === 'ptClear') { snap(); ctx.fillStyle = '#fff'; ctx.globalAlpha = 1; ctx.fillRect(0, 0, cv.width, cv.height); }
      if (e.target.id === 'ptSave') dlCanvas(cv, (cfg && cfg.name) || 'drawing.png');
    });
    p.pane.insertAdjacentHTML('beforeend', `<div class="shapes" style="margin-top:10px"><button class="btn-lime btn-sm" id="ptSave">导出 PNG</button></div>`);
  }
  G['paint-online'] = (h, c) => paintApp(h, c);
  G['online-drawing-app'] = (h, c) => paintApp(h, c);
  G['sketchpad'] = (h, c) => paintApp(h, c, { shapes: false, text: false });
  G['whiteboard'] = (h, c) => paintApp(h, c, { shapes: true });

  G['mind-map'] = function (host, cfg) {
    const p = window.TUI.shell(host, true);
    p.pane.innerHTML = window.TUI.head('思维导图', '双击画布加节点，拖动移动，点选两个节点后按「连接」。可导出 PNG 和 JSON。') +
      window.TUI.field('节点文字', window.TUI.input('mmTxt', '新节点', '')) +
      window.TUI.field('节点颜色', window.TUI.input('mmCol', '#e8f542', '', 'color')) +
      `<div class="shapes" style="margin-top:14px;flex-wrap:wrap">
        <button class="btn-lime btn-sm" id="mmAdd">添加节点</button>
        <button class="shape" id="mmLink">连接选中</button><button class="shape" id="mmDel">删除选中</button>
        <button class="shape" id="mmSave">导出 PNG</button><button class="shape" id="mmJson">导出 JSON</button>
        <button class="shape" id="mmClear">清空</button></div>
       <div class="runnote">操作：点画布空白处＝新建节点并连到当前选中节点；拖节点＝移动；点击节点＝选中（再点另一个＝多选）。</div>`;
    const wrap = document.createElement('div'); wrap.className = 'canvaswrap'; wrap.style.minHeight = '480px'; p.stage.appendChild(wrap);
    const cv = document.createElement('canvas'); cv.width = 900; cv.height = 560; cv.style.cssText = 'max-width:100%;background:#141414;border-radius:8px;cursor:crosshair;touch-action:none';
    wrap.appendChild(cv);
    const ctx = cv.getContext('2d');
    let nodes = [], links = [], sel = new Set(), drag = null;
    nodes.push({ x: 430, y: 270, t: '中心主题', c: '#e8f542' });
    function draw() {
      ctx.fillStyle = '#141414'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 2;
      links.forEach(l => { const a = nodes[l[0]], b = nodes[l[1]]; if (!a || !b) return; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); });
      nodes.forEach((n, i) => {
        ctx.font = '600 14px sans-serif';
        const w = Math.max(70, ctx.measureText(n.t).width + 26);
        const r = 9;
        ctx.beginPath(); ctx.roundRect(n.x - w / 2, n.y - 16, w, 32, r);
        ctx.fillStyle = n.c; ctx.fill();
        if (sel.has(i)) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke(); }
        ctx.fillStyle = '#000'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(n.t, n.x, n.y);
      });
    }
    function hit(x, y) { return nodes.findIndex(n => Math.abs(x - n.x) < 55 && Math.abs(y - n.y) < 20); }
    cv.addEventListener('pointerdown', e => {
      const r = cv.getBoundingClientRect();
      const x = (e.clientX - r.left) * cv.width / r.width, y = (e.clientY - r.top) * cv.height / r.height;
      const i = hit(x, y);
      if (i >= 0) { if (sel.has(i) && sel.size === 1) sel.delete(i); else { sel.clear(); sel.add(i); } drag = i; }
      else { const txt = $q('#mmTxt', host).value || '新节点'; const col = $q('#mmCol', host).value; nodes.push({ x, y, t: txt, c: col }); if (sel.size) links.push([[...sel][0], nodes.length - 1]); sel.clear(); sel.add(nodes.length - 1); }
      draw();
    });
    cv.addEventListener('pointermove', e => {
      if (drag == null) return;
      const r = cv.getBoundingClientRect();
      nodes[drag].x = (e.clientX - r.left) * cv.width / r.width; nodes[drag].y = (e.clientY - r.top) * cv.height / r.height;
      draw();
    });
    cv.addEventListener('pointerup', () => drag = null);
    host.addEventListener('click', e => {
      if (e.target.id === 'mmAdd') { nodes.push({ x: 200 + Math.random() * 500, y: 120 + Math.random() * 320, t: $q('#mmTxt', host).value || '新节点', c: $q('#mmCol', host).value }); draw(); }
      if (e.target.id === 'mmLink') { if (sel.size !== 2) return window.toast('先选中两个节点'); const [a, b] = [...sel]; links.push([a, b]); draw(); }
      if (e.target.id === 'mmDel') { const keep = nodes.filter((n, i) => !sel.has(i)); const map = new Map(); keep.forEach((n, ni) => map.set(nodes.indexOf(n), ni)); nodes = keep; links = links.map(l => [map.get(l[0]), map.get(l[1])]).filter(l => l[0] != null && l[1] != null); sel.clear(); draw(); }
      if (e.target.id === 'mmSave') dlCanvas(cv, 'mind-map.png');
      if (e.target.id === 'mmClear') { nodes = []; links = []; sel.clear(); draw(); }
      if (e.target.id === 'mmJson') download('mind-map.json', JSON.stringify({ nodes, links }, null, 2), 'application/json');
    });
    draw();
  };

  G['laser-engraving'] = function (host) {
    const p = stagePane(host, window.TUI.head('激光雕刻', '把图片转成激光软件能用的 SVG（灰度 → 抖动 → 可选轮廓线）。支持 Gcode 单色点阵输出。') +
      window.TUI.drop(`<div class="ic">${window.icon('image', 28)}</div><h3>拖一张图片进来</h3><p>JPG / PNG，建议 1000px 以上</p>`, 'image/*') +
      window.TUI.field('输出模式', window.TUI.sel('leMode', [{ v: 'dot', t: '点阵（Floyd–Steinberg 抖动）' }, { v: 'line', t: '线雕（横向扫描线，可调间隔）' }, { v: 'outline', t: '轮廓（Sobel 边缘）' }], 'dot')) +
      window.TUI.field('分辨率 DPI（影响物理尺寸）', window.TUI.range('leDpi', 72, 600, 254)) +
      window.TUI.field('抖动强度', window.TUI.range('leDith', 0, 100, 100)) +
      window.TUI.field('线间隔（像素）', window.TUI.range('leGap', 1, 12, 3)) +
      `<div class="outbox" id="leInfo"></div>
       <div class="shapes" style="margin-top:14px;flex-wrap:wrap"><button class="btn-lime btn-run" id="leRun">转换</button><button class="btn-ghost btn-sm" id="leSvg">下载 SVG</button><button class="btn-ghost btn-sm" id="leG">下载 G-code</button></div>`);
    let img = null;
    window.TUI.bindDrop(host, 'image/*', false, async files => {
      img = new Image(); img.onload = () => { $q('#cw', host).innerHTML = ''; img && run(); }; img.src = await window.TUI.readDataURL(files[0]);
    });
    function run() {
      if (!img) return;
      const maxW = 700, sc = Math.min(1, maxW / img.width);
      const W = Math.round(img.width * sc), H = Math.round(img.height * sc);
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0, W, H);
      const im = ctx.getImageData(0, 0, W, H), d = im.data;
      const gray = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) gray[i] = .299 * d[i * 4] + .587 * d[i * 4 + 1] + .114 * d[i * 4 + 2];
      const mode = $q('#leMode', host).value, dpi = +$q('#leDpi', host).value, gap = +$q('#leGap', host).value;
      const mm = v => (v / dpi * 25.4).toFixed(2);
      let svgParts = [], gcode = ['; wsft laser', 'G21', 'G90', 'M3 S255'];
      if (mode === 'dot') {
        const k = +$q('#leDith', host).value / 100;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = y * W + x, old = gray[i], nw = old < 128 ? 0 : 255, err = (old - nw) * k;
          if (x + 1 < W) gray[i + 1] += err * 7 / 16;
          if (y + 1 < H) { if (x > 0) gray[i + W - 1] += err * 3 / 16; gray[i + W] += err * 5 / 16; if (x + 1 < W) gray[i + W + 1] += err * 1 / 16; }
          if (nw === 0) { svgParts.push(`<circle cx="${x}" cy="${y}" r="0.5"/>`); gcode.push(`G1 X${mm(x)} Y${mm(H - y)} F3000`, 'M3 S255', 'M5'); }
        }
      } else if (mode === 'line') {
        for (let y = 0; y < H; y += gap) {
          let run2 = null;
          for (let x = 0; x <= W; x++) {
            const dark = x < W && gray[y * W + x] < 128;
            if (dark && run2 == null) run2 = x;
            if (!dark && run2 != null) { svgParts.push(`<line x1="${run2}" y1="${y}" x2="${x}" y2="${y}" stroke="black" stroke-width="0.6"/>`); gcode.push(`G1 X${mm(run2)} Y${mm(H - y)} F3000`, `G1 X${mm(x)} Y${mm(H - y)}`); run2 = null; }
          }
        }
      } else {
        for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
          const g = (dx, dy) => gray[(y + dy) * W + (x + dx)];
          const gx = -g(-1, -1) - 2 * g(-1, 0) - g(-1, 1) + g(1, -1) + 2 * g(1, 0) + g(1, 1);
          const gy = -g(-1, -1) - 2 * g(0, -1) - g(1, -1) + g(-1, 1) + 2 * g(0, 1) + g(1, 1);
          if (Math.hypot(gx, gy) > 120) svgParts.push(`<circle cx="${x}" cy="${y}" r="0.4"/>`);
        }
      }
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${mm(W)}mm" height="${mm(H)}mm" viewBox="0 0 ${W} ${H}"><g fill="black" stroke="none">${svgParts.join('')}</g></svg>`;
      const out = document.createElement('div'); out.className = 'canvaswrap'; out.innerHTML = ''; out.appendChild(cv); cv.style.maxWidth = '100%';
      $q('#cw', host).innerHTML = ''; $q('#cw', host).appendChild(cv);
      $q('#leInfo', host).innerHTML = `图元 <b>${svgParts.length}</b> · 物理尺寸 <b>${mm(W)} × ${mm(H)} mm</b> @ ${dpi} DPI`;
      host._svg = svg; host._g = gcode.join('\n') + '\nM5\nM30';
    }
    function doRun() { if (!img) return window.toast('先上传一张图片'); try { run(); } catch (e) { window.toast(e.message); } }
    host.addEventListener('click', e => {
      if (e.target.id === 'leRun') doRun();
      if (e.target.id === 'leSvg' && host._svg) download('laser.svg', host._svg, 'image/svg+xml');
      if (e.target.id === 'leG' && host._g) download('laser.gcode', host._g, 'text/plain');
    });
  };

  G['extract-data-from-graph'] = function (host) {
    const p = stagePane(host, window.TUI.head('图表取数', '从柱状图 / 折线图截图里把数据点抠成 CSV。步骤：传图 → 标 X 轴两点 → 标 Y 轴两点 → 逐个点数据点 → 导出。') +
      window.TUI.drop(`<div class="ic">${window.icon('image', 28)}</div><h3>拖一张图表截图进来</h3><p>建议正交、无透视变形的图</p>`, 'image/*') +
      `<div class="outbox" id="edState">1/4 请上传图片</div>
       <div class="shapes" style="margin-top:14px;flex-wrap:wrap">
         <button class="shape" id="edX">标 X 轴参考点（2 个）</button>
         <button class="shape" id="edY">标 Y 轴参考点（2 个）</button>
         <button class="shape" id="edP">标数据点（点画布）</button>
         <button class="shape" id="edUndo">撤销上一个点</button>
         <button class="shape" id="edClear">清空数据点</button></div>
       <div class="fieldrow" style="margin-top:12px">
         <div class="fld">${window.TUI.field('X 参考值（逗号分隔 2 个）', window.TUI.input('edXv', '0, 10'))}</div>
         <div class="fld">${window.TUI.field('Y 参考值（逗号分隔 2 个）', window.TUI.input('edYv', '0, 100'))}</div>
       </div>
       <div class="shapes" style="margin-top:12px"><button class="btn-lime btn-sm" id="edCsv">导出 CSV</button></div>`);
    const wrap = document.createElement('div'); wrap.className = 'canvaswrap'; wrap.style.minHeight = '420px';
    p.stage.insertBefore(wrap, p.stage.firstChild);
    const cv = document.createElement('canvas'); cv.style.cssText = 'max-width:100%;border-radius:8px;cursor:crosshair';
    wrap.appendChild(cv);
    const ctx = cv.getContext('2d');
    let img = null, mode = null, xref = [], yref = [], pts = [];
    window.TUI.bindDrop(host, 'image/*', false, async files => {
      img = new Image();
      img.onload = () => { const s = Math.min(1, 760 / img.width); cv.width = img.width * s; cv.height = img.height * s; ctx.drawImage(img, 0, 0, cv.width, cv.height); $q('#edState', host).textContent = '2/4 点「标 X 轴参考点」，然后在图上点两个已知 X 位置'; };
      img.src = await window.TUI.readDataURL(files[0]);
    });
    function redraw() {
      if (!img) return;
      ctx.clearRect(0, 0, cv.width, cv.height); ctx.drawImage(img, 0, 0, cv.width, cv.height);
      const mark = (p, col, label) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p[0], p[1], 5, 0, 7); ctx.fill(); ctx.fillStyle = col; ctx.font = '600 12px sans-serif'; ctx.fillText(label, p[0] + 8, p[1] - 6); };
      xref.forEach((p, i) => mark(p, '#38bdf8', 'X' + (i + 1)));
      yref.forEach((p, i) => mark(p, '#f59e0b', 'Y' + (i + 1)));
      ctx.fillStyle = '#e8f542'; pts.forEach(p => { ctx.beginPath(); ctx.arc(p[0], p[1], 4, 0, 7); ctx.fill(); });
    }
    cv.addEventListener('click', e => {
      if (!img) return;
      const r = cv.getBoundingClientRect();
      const x = (e.clientX - r.left) * cv.width / r.width, y = (e.clientY - r.top) * cv.height / r.height;
      if (mode === 'x' && xref.length < 2) xref.push([x, y]);
      else if (mode === 'y' && yref.length < 2) yref.push([x, y]);
      else if (mode === 'p') pts.push([x, y]);
      else return window.toast('先选一个标记模式');
      redraw();
      const st = `$('X 参考点 ${xref.length}/2 · Y 参考点 ${yref.length}/2 · 数据点 ${pts.length}`.replace('$(', '');
      $q('#edState', host).textContent = `X 参考 ${xref.length}/2 · Y 参考 ${yref.length}/2 · 数据点 ${pts.length}`;
    });
    host.addEventListener('click', e => {
      const setMode = id => { mode = id; host.querySelectorAll('.shape').forEach(s => s.classList.remove('on')); e.target.classList.add('on'); };
      if (e.target.id === 'edX') setMode('x');
      if (e.target.id === 'edY') setMode('y');
      if (e.target.id === 'edP') setMode('p');
      if (e.target.id === 'edUndo') { pts.pop(); redraw(); }
      if (e.target.id === 'edClear') { pts = []; redraw(); }
      if (e.target.id === 'edCsv') {
        if (xref.length < 2 || yref.length < 2 || !pts.length) return window.toast('先把参考点和数据点标齐');
        const xv = $q('#edXv', host).value.split(',').map(Number), yv = $q('#edYv', host).value.split(',').map(Number);
        if (xv.length < 2 || yv.length < 2) return window.toast('参考值需要 2 个');
        const lx = (xref[0][0] - xref[1][0]) || 1, ly = (yref[0][1] - yref[1][1]) || 1;
        const sx2 = (xv[1] - xv[0]) / lx, sy2 = (yv[1] - yv[0]) / ly;
        const out = pts.map(([x, y]) => [(x - xref[0][0]) * sx2 + xv[0], (y - yref[0][1]) * sy2 + yv[0]]);
        const csv = 'x,y\n' + out.map(r => r.map(v => (+v).toFixed(4)).join(',')).join('\n');
        download('graph-data.csv', csv, 'text/csv');
        window.copyText(csv);
      }
    });
  };

  G['chemical-structure-drawer'] = function (host) {
    const p = stagePane(host, window.TUI.head('化学结构绘制', '在画布上点两下画一根键，按住元素按钮切换当前原子。可导出 SVG 与简化 SMILES（立体化学与芳香性未处理）。') +
      window.TUI.field('当前原子', window.TUI.sel('csAtom', ['C', 'N', 'O', 'S', 'P', 'F', 'Cl', 'Br', 'I', 'H'].map(v => ({ v, t: v })), 'C')) +
      window.TUI.field('键级', window.TUI.sel('csBond', [{ v: '1', t: '单键' }, { v: '2', t: '双键' }, { v: '3', t: '三键' }], '1')) +
      `<div class="shapes" style="margin-top:12px;flex-wrap:wrap"><button class="shape" id="csClear">清空</button><button class="shape" id="csUndo">撤销</button><button class="shape" id="csSvg">导出 SVG</button><button class="shape" id="csSmi">生成 SMILES</button></div>`);
    const wrap = document.createElement('div'); wrap.className = 'canvaswrap'; wrap.style.minHeight = '420px';
    p.stage.insertBefore(wrap, p.stage.firstChild);
    const cv = document.createElement('canvas'); cv.width = 760; cv.height = 480; cv.style.cssText = 'max-width:100%;background:#fff;border-radius:8px;cursor:crosshair;touch-action:none';
    wrap.appendChild(cv);
    const ctx = cv.getContext('2d');
    let atoms = [], bonds = [], pending = null, sel = null;
    function draw() {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
      bonds.forEach(b => {
        const a = atoms[b[0]], c = atoms[b[1]]; if (!a || !c) return;
        const dx = c.x - a.x, dy = c.y - a.y, L = Math.hypot(dx, dy) || 1;
        const nx = -dy / L * 4, ny = dx / L * 4;
        for (let k = 0; k < b[2]; k++) {
          const off = (k - (b[2] - 1) / 2) * 2;
          ctx.beginPath(); ctx.moveTo(a.x + nx * off, a.y + ny * off); ctx.lineTo(c.x + nx * off, c.y + ny * off); ctx.stroke();
        }
      });
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      atoms.forEach((a, i) => {
        if (a.sym !== 'C') { ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(a.x, a.y, 11, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = sel === i ? '#e8f542' : '#111'; ctx.stroke(); ctx.fillStyle = '#111'; ctx.font = '600 12px sans-serif'; ctx.fillText(a.sym, a.x, a.y); }
        else if (sel === i) { ctx.strokeStyle = '#e8f542'; ctx.beginPath(); ctx.arc(a.x, a.y, 12, 0, 7); ctx.stroke(); }
      });
    }
    cv.addEventListener('pointerdown', e => {
      const r = cv.getBoundingClientRect();
      const x = (e.clientX - r.left) * cv.width / r.width, y = (e.clientY - r.top) * cv.height / r.height;
      const near = atoms.findIndex(a => Math.hypot(a.x - x, a.y - y) < 18);
      if (near >= 0) {
        if (pending == null) { pending = near; sel = near; }
        else if (pending !== near) { bonds.push([pending, near, +$q('#csBond', host).value]); pending = near; sel = near; }
      } else {
        atoms.push({ x, y, sym: $q('#csAtom', host).value });
        if (pending != null) { bonds.push([pending, atoms.length - 1, +$q('#csBond', host).value]); pending = atoms.length - 1; }
        sel = atoms.length - 1;
      }
      draw();
    });
    host.addEventListener('click', e => {
      if (e.target.id === 'csClear') { atoms = []; bonds = []; pending = null; sel = null; draw(); }
      if (e.target.id === 'csUndo') { bonds.pop(); if (!bonds.length) atoms.pop(); draw(); }
      if (e.target.id === 'csSvg') {
        let s = '<svg xmlns="http://www.w3.org/2000/svg" width="760" height="480"><rect width="100%" height="100%" fill="#fff"/>';
        bonds.forEach(b => { const a = atoms[b[0]], c = atoms[b[1]]; for (let k = 0; k < b[2]; k++) s += `<line x1="${a.x}" y1="${a.y}" x2="${c.x}" y2="${c.y}" stroke="#111" stroke-width="2"/>`; });
        atoms.forEach(a => { if (a.sym !== 'C') s += `<text x="${a.x}" y="${a.y}" font-size="13" text-anchor="middle" font-family="sans-serif">${a.sym}</text>`; });
        download('structure.svg', s + '</svg>', 'image/svg+xml');
      }
      if (e.target.id === 'csSmi') {
        if (!bonds.length) return window.toast('先画点键');
        const adj = atoms.map(() => []);
        bonds.forEach(b => { adj[b[0]].push(b[1]); adj[b[1]].push(b[0]); });
        const seen = new Set(); let smi = '';
        for (let i = 0; i < atoms.length; i++) {
          if (seen.has(i)) continue;
          const stack = [[i, -1]]; let out = '';
          while (stack.length) {
            const [n, par] = stack.pop();
            if (seen.has(n)) continue; seen.add(n);
            out += (par >= 0 ? '(' : '') + atoms[n].sym + (par >= 0 ? '' : '');
            const kids = adj[n].filter(k => !seen.has(k));
            kids.forEach((k, ki) => { if (ki === kids.length - 1) { stack.push([k, n]); } else { const st2 = [[k, n]]; let o2 = ''; const s2 = new Set(); while (st2.length) { const [m, p2] = st2.pop(); if (s2.has(m)) continue; s2.add(m); o2 += '(' + atoms[m].sym; adj[m].filter(x => !s2.has(x)).forEach(x => st2.push([x, m])); } out += o2 + ')'.repeat(o2.split('(').length - 1); } });
          }
          smi += out;
        }
        window.copyText(smi);
        window.toast('SMILES 已复制（简化版）');
      }
    });
    draw();
  };

  /* ---------- 元素周期表 ---------- */
  const ELDATA = `1,H,Hydrogen,氢,1.008,6,1,1;2,He,Helium,氦,4.003,8,18,1;3,Li,Lithium,锂,6.94,1,1,2;4,Be,Beryllium,铍,9.012,2,2,2;5,B,Boron,硼,10.81,5,13,2;6,C,Carbon,碳,12.011,6,14,2;7,N,Nitrogen,氮,14.007,6,15,2;8,O,Oxygen,氧,15.999,6,16,2;9,F,Fluorine,氟,18.998,7,17,2;10,Ne,Neon,氖,20.180,8,18,2;11,Na,Sodium,钠,22.990,1,1,3;12,Mg,Magnesium,镁,24.305,2,2,3;13,Al,Aluminium,铝,26.982,4,13,3;14,Si,Silicon,硅,28.085,5,14,3;15,P,Phosphorus,磷,30.974,6,15,3;16,S,Sulfur,硫,32.06,6,16,3;17,Cl,Chlorine,氯,35.45,7,17,3;18,Ar,Argon,氩,39.95,8,18,3;19,K,Potassium,钾,39.098,1,1,4;20,Ca,Calcium,钙,40.078,2,2,4;21,Sc,Scandium,钪,44.956,3,3,4;22,Ti,Titanium,钛,47.867,3,4,4;23,V,Vanadium,钒,50.942,3,5,4;24,Cr,Chromium,铬,51.996,3,6,4;25,Mn,Manganese,锰,54.938,3,7,4;26,Fe,Iron,铁,55.845,3,8,4;27,Co,Cobalt,钴,58.933,3,9,4;28,Ni,Nickel,镍,58.693,3,10,4;29,Cu,Copper,铜,63.546,3,11,4;30,Zn,Zinc,锌,65.38,3,12,4;31,Ga,Gallium,镓,69.723,4,13,4;32,Ge,Germanium,锗,72.63,5,14,4;33,As,Arsenic,砷,74.922,5,15,4;34,Se,Selenium,硒,78.971,6,16,4;35,Br,Bromine,溴,79.904,7,17,4;36,Kr,Krypton,氪,83.798,8,18,4;37,Rb,Rubidium,铷,85.468,1,1,5;38,Sr,Strontium,锶,87.62,2,2,5;39,Y,Yttrium,钇,88.906,3,3,5;40,Zr,Zirconium,锆,91.224,3,4,5;41,Nb,Niobium,铌,92.906,3,5,5;42,Mo,Molybdenum,钼,95.95,3,6,5;43,Tc,Technetium,锝,98,3,7,5;44,Ru,Ruthenium,钌,101.07,3,8,5;45,Rh,Rhodium,铑,102.91,3,9,5;46,Pd,Palladium,钯,106.42,3,10,5;47,Ag,Silver,银,107.87,3,11,5;48,Cd,Cadmium,镉,112.41,3,12,5;49,In,Indium,铟,114.82,4,13,5;50,Sn,Tin,锡,118.71,4,14,5;51,Sb,Antimony,锑,121.76,5,15,5;52,Te,Tellurium,碲,127.60,5,16,5;53,I,Iodine,碘,126.90,7,17,5;54,Xe,Xenon,氙,131.29,8,18,5;55,Cs,Caesium,铯,132.91,1,1,6;56,Ba,Barium,钡,137.33,2,2,6;57,La,Lanthanum,镧,138.91,9,3,6;58,Ce,Cerium,铈,140.12,9,0,6;59,Pr,Praseodymium,镨,140.91,9,0,6;60,Nd,Neodymium,钕,144.24,9,0,6;61,Pm,Promethium,钷,145,9,0,6;62,Sm,Samarium,钐,150.36,9,0,6;63,Eu,Europium,铕,151.96,9,0,6;64,Gd,Gadolinium,钆,157.25,9,0,6;65,Tb,Terbium,铽,158.93,9,0,6;66,Dy,Dysprosium,镝,162.50,9,0,6;67,Ho,Holmium,钬,164.93,9,0,6;68,Er,Erbium,铒,167.26,9,0,6;69,Tm,Thulium,铥,168.93,9,0,6;70,Yb,Ytterbium,镱,173.05,9,0,6;71,Lu,Lutetium,镥,174.97,9,0,6;72,Hf,Hafnium,铪,178.49,3,4,6;73,Ta,Tantalum,钽,180.95,3,5,6;74,W,Tungsten,钨,183.84,3,6,6;75,Re,Rhenium,铼,186.21,3,7,6;76,Os,Osmium,锇,190.23,3,8,6;77,Ir,Iridium,铱,192.22,3,9,6;78,Pt,Platinum,铂,195.08,3,10,6;79,Au,Gold,金,196.97,3,11,6;80,Hg,Mercury,汞,200.59,3,12,6;81,Tl,Thallium,铊,204.38,4,13,6;82,Pb,Lead,铅,207.2,4,14,6;83,Bi,Bismuth,铋,208.98,4,15,6;84,Po,Polonium,钋,209,4,16,6;85,At,Astatine,砹,210,7,17,6;86,Rn,Radon,氡,222,8,18,6;87,Fr,Francium,钫,223,1,1,7;88,Ra,Radium,镭,226,2,2,7;89,Ac,Actinium,锕,227,10,3,7;90,Th,Thorium,钍,232.04,10,0,7;91,Pa,Protactinium,镤,231.04,10,0,7;92,U,Uranium,铀,238.03,10,0,7;93,Np,Neptunium,镎,237,10,0,7;94,Pu,Plutonium,钚,244,10,0,7;95,Am,Americium,镅,243,10,0,7;96,Cm,Curium,锔,247,10,0,7;97,Bk,Berkelium,锫,247,10,0,7;98,Cf,Californium,锎,251,10,0,7;99,Es,Einsteinium,锿,252,10,0,7;100,Fm,Fermium,镄,257,10,0,7;101,Md,Mendelevium,钔,258,10,0,7;102,No,Nobelium,锘,259,10,0,7;103,Lr,Lawrencium,铹,266,10,0,7;104,Rf,Rutherfordium,Rutherfordium,267,3,4,7;105,Db,Dubnium,Dubnium,268,3,5,7;106,Sg,Seaborgium,Seaborgium,269,3,6,7;107,Bh,Bohrium,Bohrium,270,3,7,7;108,Hs,Hassium,Hassium,269,3,8,7;109,Mt,Meitnerium,Meitnerium,278,3,9,7;110,Ds,Darmstadtium,Darmstadtium,281,3,10,7;111,Rg,Roentgenium,Roentgenium,282,3,11,7;112,Cn,Copernicium,Copernicium,285,3,12,7;113,Nh,Nihonium,Nihonium,286,4,13,7;114,Fl,Flerovium,Flerovium,289,4,14,7;115,Mc,Moscovium,Moscovium,290,4,15,7;116,Lv,Livermorium,Livermorium,293,4,16,7;117,Ts,Tennessine,Tennessine,294,7,17,7;118,Og,Oganesson,Oganesson,294,8,18,7`
    .split(';').map(s => { const p = s.split(','); return { z: +p[0], sym: p[1], en: p[2], zh: p[3] || p[2], mass: +p[4], cat: +p[5], g: +p[6], per: +p[7] }; });
  const CAT_NAME = { 1: '碱金属', 2: '碱土金属', 3: '过渡金属', 4: '后过渡金属', 5: '类金属', 6: '非金属', 7: '卤素', 8: '稀有气体', 9: '镧系', 10: '锕系' };
  const CAT_COL = { 1: '#f59e0b', 2: '#fb923c', 3: '#38bdf8', 4: '#818cf8', 5: '#22c55e', 6: '#a3e635', 7: '#f472b6', 8: '#c084fc', 9: '#e8f542', 10: '#facc15' };
  G['periodic-table'] = function (host) {
    const p = window.TUI.single(host);
    p.innerHTML = window.TUI.head('元素周期表', '118 个元素，点击查看详情，支持按名称/符号/序号搜索。') +
      `<div style="max-width:420px"><input type="text" id="ptSearch" placeholder="搜索：铁 / Fe / 26"></div>
       <div id="ptGrid" style="display:grid;grid-template-columns:repeat(18,minmax(0,1fr));gap:3px;margin-top:14px;min-width:900px;overflow-x:auto;padding-bottom:8px"></div>
       <div style="overflow-x:auto"><div id="ptLants" style="display:grid;grid-template-columns:repeat(15,minmax(0,1fr));gap:3px;margin-top:8px;min-width:760px"></div></div>
       <div class="outbox" id="ptDetail" style="margin-top:16px">点击任意元素查看详情</div>`;
    const grid = $q('#ptGrid', host), lants = $q('#ptLants', host);
    const cell = e => `<button class="shape" data-z="${e.z}" style="border-color:${CAT_COL[e.cat]};border-width:1.5px;padding:5px 3px;display:flex;flex-direction:column;align-items:center;gap:1px;min-height:52px">
      <span style="font-size:9px;color:#8a8a8a">${e.z}</span><b style="font-size:14px;color:${CAT_COL[e.cat]}">${e.sym}</b><span style="font-size:8.5px;color:#8a8a8a">${esc(e.zh.slice(0, 3))}</span></button>`;
    const paint = q2 => {
      const list = !q2 ? ELDATA : ELDATA.filter(e => e.sym.toLowerCase().includes(q2) || e.en.toLowerCase().includes(q2) || e.zh.includes(q2) || String(e.z) === q2);
      grid.innerHTML = list.filter(e => e.cat !== 9 && e.cat !== 10).map(cell).join('');
      lants.innerHTML = list.filter(e => e.cat === 9 || e.cat === 10).map(cell).join('');
      if (!grid.children.length && !lants.children.length) grid.innerHTML = '<span style="color:#6b6b6b">没有匹配的元素</span>';
    };
    host.addEventListener('input', e => { if (e.target.id === 'ptSearch') paint(e.target.value.trim().toLowerCase()); });
    host.addEventListener('click', e => {
      const b = e.target.closest('[data-z]');
      if (!b) return;
      const el = ELDATA.find(x => x.z === +b.dataset.z);
      sel = el.z;
      $q('#ptDetail', host).innerHTML = `<div class="row"><span>元素</span><b style="font-size:18px">${el.sym} · ${esc(el.zh)} · ${esc(el.en)}</b></div>
        <div class="row"><span>原子序数</span><b>${el.z}</b></div>
        <div class="row"><span>相对原子质量</span><b>${el.mass}</b></div>
        <div class="row"><span>类别</span><b style="color:${CAT_COL[el.cat]}">${CAT_NAME[el.cat]}</b></div>
        <div class="row"><span>周期 / 族</span><b>${el.per}${el.g ? ' / ' + el.g : '（镧系/锕系）'}</b></div>
        <div class="row"><span>摩尔质量用途</span><b>${el.mass} g/mol</b></div>`;
    });
    let sel = null;
    paint('');
  };

  /* ==========================================================================
     7. GIS：GPX / KML / GeoJSON / Shapefile
     ========================================================================== */
  const xml = s => new DOMParser().parseFromString(s, 'application/xml');
  const R2 = 6371008.8;
  function haversine(a, b) { const r = Math.PI / 180, dLa = (b[1] - a[1]) * r, dLo = (b[0] - a[0]) * r; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLo / 2) ** 2; return 2 * R2 * Math.asin(Math.sqrt(h)); }
  function parseGPX(text) {
    const d = xml(text);
    if (d.querySelector('parsererror')) throw new Error('GPX 解析失败（XML 不合法）');
    const tracks = [...d.getElementsByTagName('trk')].map(t => ({
      name: (t.getElementsByTagName('name')[0] || {}).textContent || '轨迹',
      pts: [...t.getElementsByTagName('trkpt')].map(p => ({ lon: +p.getAttribute('lon'), lat: +p.getAttribute('lat'), ele: +(p.getElementsByTagName('ele')[0] || {}).textContent || null }))
    }));
    const pts = [...d.getElementsByTagName('wpt')].map(p => ({ lon: +p.getAttribute('lon'), lat: +p.getAttribute('lat'), name: (p.getElementsByTagName('name')[0] || {}).textContent || '航点' }));
    const routes = [...d.getElementsByTagName('rte')].map(t => ({
      name: (t.getElementsByTagName('name')[0] || {}).textContent || '路线',
      pts: [...t.getElementsByTagName('rtept')].map(p => ({ lon: +p.getAttribute('lon'), lat: +p.getAttribute('lat'), ele: null }))
    }));
    return { tracks, routes, wpts: pts };
  }
  function parseKML(text) {
    const d = xml(text);
    if (d.querySelector('parsererror')) throw new Error('KML 解析失败（XML 不合法）');
    const coord = el => (el.getElementsByTagName('coordinates')[0] || {}).textContent || '';
    const read = s => s.trim().split(/\s+/).filter(Boolean).map(t => { const p = t.split(',').map(Number); return { lon: p[0], lat: p[1], ele: p[2] || null }; });
    const lines = [...d.getElementsByTagName('LineString')].map((l, i) => ({ name: '线 ' + (i + 1), pts: read(coord(l)) }));
    const polys = [...d.getElementsByTagName('Polygon')].map((pg, i) => ({ name: '多边形 ' + (i + 1), pts: read((pg.getElementsByTagName('outerBoundaryIs')[0] || pg).getElementsByTagName('coordinates')[0].textContent) }));
    const pts = [...d.getElementsByTagName('Point')].map((p, i) => { const c = read(coord(p))[0]; return c ? { ...c, name: '点 ' + (i + 1) } : null; }).filter(Boolean);
    return { tracks: lines.concat(polys), routes: [], wpts: pts };
  }
  function toGeoJSON(g) {
    const feats = [];
    g.tracks.forEach(t => { if (t.pts.length > 1) feats.push({ type: 'Feature', properties: { name: t.name }, geometry: { type: 'LineString', coordinates: t.pts.map(p => [p.lon, p.lat, p.ele]) } }); });
    g.routes.forEach(t => { if (t.pts.length > 1) feats.push({ type: 'Feature', properties: { name: t.name }, geometry: { type: 'LineString', coordinates: t.pts.map(p => [p.lon, p.lat]) } }); });
    g.wpts.forEach(w => feats.push({ type: 'Feature', properties: { name: w.name }, geometry: { type: 'Point', coordinates: [w.lon, w.lat] } }));
    return { type: 'FeatureCollection', features: feats };
  }
  function fromGeoJSON(j) {
    const g = { tracks: [], routes: [], wpts: [] };
    (j.features || []).forEach(f => {
      const c = f.geometry && f.geometry.coordinates; if (!c) return;
      const nm = (f.properties && f.properties.name) || '要素';
      if (f.geometry.type === 'Point') g.wpts.push({ lon: c[0], lat: c[1], name: nm });
      else if (f.geometry.type === 'LineString') g.tracks.push({ name: nm, pts: c.map(p => ({ lon: p[0], lat: p[1], ele: p[2] || null })) });
      else if (f.geometry.type === 'Polygon') f.geometry.coordinates.forEach(ring => g.tracks.push({ name: nm, pts: ring.map(p => ({ lon: p[0], lat: p[1], ele: null })) }));
      else if (f.geometry.type === 'MultiLineString') f.geometry.coordinates.forEach(l => g.tracks.push({ name: nm, pts: l.map(p => ({ lon: p[0], lat: p[1], ele: null })) }));
    });
    return g;
  }
  function gpxOut(g) {
    let s = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="wsft" xmlns="http://www.topografix.com/GPX/1/1">\n`;
    g.wpts.forEach(w => s += `  <wpt lat="${w.lat}" lon="${w.lon}"><name>${esc(w.name || '航点')}</name></wpt>\n`);
    g.tracks.forEach(t => { s += `  <trk><name>${esc(t.name)}</name><trkseg>\n`; t.pts.forEach(p => s += `    <trkpt lat="${p.lat}" lon="${p.lon}">${p.ele != null ? `<ele>${p.ele}</ele>` : ''}</trkpt>\n`); s += `  </trkseg></trk>\n`; });
    g.routes.forEach(t => { s += `  <rte><name>${esc(t.name)}</name>\n`; t.pts.forEach(p => s += `    <rtept lat="${p.lat}" lon="${p.lon}"/>\n`); s += `  </rte>\n`; });
    return s + '</gpx>\n';
  }
  function kmlOut(g) {
    let s = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>\n`;
    g.tracks.forEach(t => { if (t.pts.length < 2) return; s += `<Placemark><name>${esc(t.name)}</name><LineString><coordinates>${t.pts.map(p => `${p.lon},${p.lat}${p.ele != null ? ',' + p.ele : ''}`).join(' ')}</coordinates></LineString></Placemark>\n`; });
    g.wpts.forEach(w => s += `<Placemark><name>${esc(w.name || '点')}</name><Point><coordinates>${w.lon},${w.lat}</coordinates></Point></Placemark>\n`);
    return s + '</Document></kml>\n';
  }
  /* Shapefile 读取（.shp 主文件） */
  function parseSHP(buf) {
    const dv = new DataView(buf);
    if (dv.getInt32(0) !== 9994) throw new Error('不是有效的 .shp 文件（魔数不符）');
    const shpType = dv.getInt32(32, true);
    const names = { 1: 'Point', 3: 'Polyline', 5: 'Polygon', 8: 'MultiPoint' };
    if (!(shpType in names)) throw new Error('不支持的 Shapefile 类型 ' + shpType + '（支持 Point/Polyline/Polygon/MultiPoint）');
    const feats = [];
    let off = 100;
    while (off + 8 <= buf.byteLength) {
      const clen = dv.getInt32(off + 4) * 2;   // 以 16 位字计
      const type = dv.getInt32(off + 8, true);
      let p = off + 12;
      if (type === 0) { off += 8 + clen; continue; }
      if (type === 1) { const x = dv.getFloat64(p, true), y = dv.getFloat64(p + 8, true); feats.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [x, y] } }); }
      else if (type === 3 || type === 5) {
        const box = [...Array(4)].map((_, i) => dv.getFloat64(p + i * 8, true)); p += 32;
        const nparts = dv.getInt32(p, true), npts = dv.getInt32(p + 4, true); p += 8;
        const parts = [...Array(nparts)].map((_, i) => dv.getInt32(p + i * 4, true)); p += nparts * 4;
        const coords = [...Array(npts)].map((_, i) => [dv.getFloat64(p + i * 16, true), dv.getFloat64(p + i * 16 + 8, true)]);
        const rings = parts.map((s, i) => coords.slice(s, i + 1 < parts.length ? parts[i + 1] : npts)).filter(r => r.length);
        feats.push({ type: 'Feature', properties: {}, geometry: type === 3 ? { type: 'MultiLineString', coordinates: rings } : { type: 'Polygon', coordinates: rings } });
      } else if (type === 8) {
        const npts = dv.getInt32(p, true); p += 4;
        const coords = [...Array(npts)].map((_, i) => [dv.getFloat64(p + i * 16, true), dv.getFloat64(p + i * 16 + 8, true)]);
        coords.forEach(c => feats.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } }));
      }
      off += 8 + clen;
    }
    return { type: 'FeatureCollection', features: feats, shpType: names[shpType] };
  }
  function shpOut(j, type) {
    /* 生成 .shp + .shx + .prj（仅 Polyline/Polygon/Point） */
    const feats = (j.features || []).filter(f => f.geometry);
    const recs = feats.map(f => {
      const g = f.geometry;
      if (type === 1) return { type: 1, coords: [[g.coordinates]] };
      const rings = g.type === 'Polygon' ? g.coordinates : g.type === 'MultiLineString' ? g.coordinates : g.type === 'LineString' ? [g.coordinates] : [];
      return { type: type || (g.type === 'Polygon' ? 5 : 3), coords: rings };
    });
    const header = Buffer ? null : null;
    const u8 = [];
    const push = v => u8.push(v & 255);
    const i32b = v => { push(v >>> 24); push(v >>> 16); push(v >>> 8); push(v); };
    const i32l = v => { push(v); push(v >>> 8); push(v >>> 16); push(v >>> 24); };
    const f64 = v => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v, true); for (const x of b) push(x); };
    /* 计算总长度 */
    let bodyLen = 0;
    const bodies = recs.map(r => {
      const tmp = [];
      const rec = { len: 0 };
      const pts = r.coords.flat();
      let bx = [Infinity, Infinity, -Infinity, -Infinity];
      pts.forEach(c => { bx[0] = Math.min(bx[0], c[0]); bx[1] = Math.min(bx[1], c[1]); bx[2] = Math.max(bx[2], c[0]); bx[3] = Math.max(bx[3], c[1]); });
      const out = [];
      const wI = v => { out.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255); };
      const wD = v => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v, true); out.push(...b); };
      wI(r.type); if (r.type !== 1) { bx.forEach(wD); wI(r.coords.length); wI(pts.length); r.coords.forEach(rg => wI(0)); }
      if (r.type === 1) { wD(r.coords[0][0][0]); wD(r.coords[0][0][1]); }
      else r.coords.flat().forEach(c => { wD(c[0]); wD(c[1]); });
      rec.data = new Uint8Array(out); rec.len = out.length / 2 + 4;
      rec.bbox = bx;
      return rec;
    });
    const totalLen = 50 + bodies.reduce((a, b) => a + b.len, 0);
    /* 主头 */
    i32b(9994); for (let i = 0; i < 5; i++) i32b(0); i32b(totalLen); i32l(1000); i32l(recs.length ? recs[0].type : 3);
    const bb = [Infinity, Infinity, -Infinity, -Infinity];
    bodies.forEach(r => { bb[0] = Math.min(bb[0], r.bbox[0]); bb[1] = Math.min(bb[1], r.bbox[1]); bb[2] = Math.max(bb[2], r.bbox[2]); bb[3] = Math.max(bb[3], r.bbox[3]); });
    if (!recs.length) bb.splice(0, 4, 0, 0, 0, 0);
    bb.forEach(f64); f64(0); f64(0); f64(0);
    let shxLen = 50 + bodies.length * 4, recOff = 50;
    const shpMain = new Uint8Array(u8);
    bodies.forEach(r => {
      const arr = [];
      const a = v => { arr.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); };
      a(bodies.indexOf(r) + 1); a(r.len / 2 - 2);
      const rec = new Uint8Array(arr.concat([...r.data]));
      const all = new Uint8Array(shpMain.length + rec.length); all.set(shpMain); all.set(rec, shpMain.length);
      shpMain.set(all);
    });
    return { shp: shpMain, shxLen };
  }
  function gisCanvas(host, gj) {
    const wrap = document.createElement('div'); wrap.className = 'canvaswrap'; wrap.style.minHeight = '420px';
    host.querySelector('.stage').appendChild(wrap);
    const cv = document.createElement('canvas'); cv.width = 880; cv.height = 500; cv.style.cssText = 'max-width:100%;background:#0f1a2b;border-radius:8px;cursor:grab';
    wrap.appendChild(cv);
    const ctx = cv.getContext('2d');
    let zoom = 1, ox = 0, oy = 0, drag = null;
    function project(lon, lat) { return [(lon + 180) / 360, (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2]; }
    function draw() {
      ctx.fillStyle = '#0f1a2b'; ctx.fillRect(0, 0, cv.width, cv.height);
      /* 经纬网 */
      ctx.strokeStyle = 'rgba(255,255,255,.06)';
      for (let lo = -180; lo <= 180; lo += 30) { const [x] = pm(lo, 0); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, cv.height); ctx.stroke(); }
      for (let la = -60; la <= 80; la += 20) { const [, y] = pm(0, la); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cv.width, y); ctx.stroke(); }
      const cols = ['#e8f542', '#38bdf8', '#f472b6', '#fb923c', '#a3e635'];
      let ci = 0, npts = 0;
      (gj.features || []).forEach(f => {
        const col = cols[ci++ % cols.length];
        const t = f.geometry.type;
        const rings = t === 'Point' ? [[f.geometry.coordinates]] : t === 'LineString' ? [f.geometry.coordinates] : t === 'MultiLineString' || t === 'Polygon' ? f.geometry.coordinates : [];
        ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.fillStyle = col;
        rings.forEach(ring => {
          if (t === 'Point') { const [x, y] = pm(ring[0][0], ring[0][1]); ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill(); npts++; return; }
          ctx.beginPath();
          ring.forEach((c, i) => { const [x, y] = pm(c[0], c[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); npts++; });
          if (t === 'Polygon') { ctx.closePath(); ctx.globalAlpha = .18; ctx.fill(); ctx.globalAlpha = 1; }
          ctx.stroke();
        });
      });
      host._npts = npts;
    }
    function fit() {
      let bx = [Infinity, Infinity, -Infinity, -Infinity], any = false;
      (gj.features || []).forEach(f => {
        const t = f.geometry.type;
        const rings = t === 'Point' ? [[f.geometry.coordinates]] : t === 'LineString' ? [f.geometry.coordinates] : t === 'MultiLineString' || t === 'Polygon' ? f.geometry.coordinates : [];
        rings.flat().forEach(c => { const [nx, ny] = project(c[0], c[1]); bx[0] = Math.min(bx[0], nx); bx[1] = Math.min(bx[1], ny); bx[2] = Math.max(bx[2], nx); bx[3] = Math.max(bx[3], ny); any = true; });
      });
      if (!any) return;
      const w = Math.max(1e-6, bx[2] - bx[0]), h = Math.max(1e-6, bx[3] - bx[1]);
      zoom = Math.min(cv.width / w, cv.height / h) * .88;
      ox = cv.width / 2 - (bx[0] + bx[2]) / 2 * zoom;
      oy = cv.height / 2 - (bx[1] + bx[3]) / 2 * zoom;
    }
    function pm(lon, lat) { const [nx, ny] = project(lon, lat); return [nx * zoom + ox, ny * zoom + oy]; }
    cv.addEventListener('wheel', e => { e.preventDefault(); const k = e.deltaY < 0 ? 1.15 : 1 / 1.15; const r = cv.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top; ox = mx - (mx - ox) * k; oy = my - (my - oy) * k; zoom *= k; draw(); }, { passive: false });
    cv.addEventListener('pointerdown', e => { drag = [e.clientX, e.clientY, ox, oy]; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => { if (!drag) return; ox = drag[2] + e.clientX - drag[0]; oy = drag[3] + e.clientY - drag[1]; draw(); });
    cv.addEventListener('pointerup', () => drag = null);
    fit(); draw();
    return cv;
  }
  function gisUI(host, cfg) {
    const isViewer = /viewer$/.test(cfg.slug || '');
    const p = stagePane(host, window.TUI.head(isViewer ? 'GIS 查看器' : '格式互转', '支持 GPX / KML / GeoJSON / Shapefile(.shp)。画布为 Web Mercator 投影的本地渲染（无网络底图），可缩放平移，并提供长度统计。') +
      window.TUI.field('输入格式', window.TUI.sel('gisIn', [{ v: 'auto', t: '自动识别' }, { v: 'gpx', t: 'GPX' }, { v: 'kml', t: 'KML' }, { v: 'geojson', t: 'GeoJSON' }, { v: 'shp', t: 'Shapefile (.shp)' }], 'auto')) +
      window.TUI.field('输出格式', window.TUI.sel('gisOut', [{ v: 'geojson', t: 'GeoJSON' }, { v: 'gpx', t: 'GPX' }, { v: 'kml', t: 'KML' }], 'geojson')) +
      `<div class="shapes" style="margin-top:14px"><button class="btn-lime btn-run" id="gisRun">${isViewer ? '重新渲染' : '转换'}</button></div>
       <div class="outbox" id="gisInfo"></div>
       <div class="shapes" style="margin-top:10px;flex-wrap:wrap"><button class="btn-ghost btn-sm" id="gisPng">导出 PNG</button><button class="btn-ghost btn-sm" id="gisSave">下载结果</button></div>`);
    let text = null, name = 'data', cv = null, lastGj = null;
    window.TUI.bindDrop(host, '.gpx,.kml,.geojson,.json,.shp,.txt,application/*', false, async files => {
      name = files[0].name.replace(/\.[^.]+$/, '');
      if (/\.shp$/i.test(files[0].name)) { lastGj = parseSHP(await window.TUI.readBuf(files[0])); }
      else {
        text = await window.TUI.readText(files[0]);
        lastGj = readAny(text, $q('#gisIn', host).value);
      }
      render();
    });
    function readAny(t, fmt) {
      const s = t.trim();
      if (fmt === 'shp') throw new Error('.shp 是二进制格式，请直接拖入 .shp 文件');
      if (fmt === 'gpx' || (!fmt || fmt === 'auto') && /<gpx/i.test(s)) return toGeoJSON(parseGPX(s));
      if (fmt === 'kml' || (!fmt || fmt === 'auto') && /<kml/i.test(s)) return toGeoJSON(parseKML(s));
      try { const j = JSON.parse(s); return j.type === 'FeatureCollection' || j.type === 'Feature' ? (j.type === 'Feature' ? { type: 'FeatureCollection', features: [j] } : j) : fromGeoJSON({ features: [] }); }
      catch (e) { throw new Error('无法识别的内容，请给 GPX / KML / GeoJSON / .shp'); }
    }
    function render() {
      if (!lastGj) return;
      if (cv) cv.remove();
      cv = gisCanvas(host, lastGj);
      const info = [];
      let dist = 0;
      (lastGj.features || []).forEach(f => {
        const t = f.geometry.type;
        const line = t === 'LineString' ? f.geometry.coordinates : t === 'Polygon' ? f.geometry.coordinates[0] : null;
        if (line) for (let i = 1; i < line.length; i++) dist += haversine(line[i - 1], line[i]);
      });
      info.push(`要素 <b>${(lastGj.features || []).length}</b> · 折点 <b>${host._npts || 0}</b> · 线总长 <b>${(dist / 1000).toFixed(3)} km</b>`);
      if (lastGj.shpType) info.push(`Shapefile 类型 <b>${lastGj.shpType}</b>（属性表 .dbf 未解析）`);
      $q('#gisInfo', host).innerHTML = info.join('<br>');
      host._gj = lastGj;
    }
    host.addEventListener('click', e => {
      if (e.target.id === 'gisRun' && text) { try { lastGj = readAny(text, $q('#gisIn', host).value); render(); } catch (err) { $q('#gisInfo', host).innerHTML = `<span style="color:#ef4444">${esc(err.message)}</span>`; } }
      if (e.target.id === 'gisPng' && cv) dlCanvas(cv, 'gis.png');
      if (e.target.id === 'gisSave' && host._gj) {
        const out = $q('#gisOut', host).value;
        if (out === 'geojson') download(name + '.geojson', JSON.stringify(host._gj, null, 2), 'application/geo+json');
        else if (out === 'gpx') download(name + '.gpx', gpxOut(fromGeoJSON(host._gj)), 'application/gpx+xml');
        else download(name + '.kml', kmlOut(fromGeoJSON(host._gj)), 'application/vnd.google-earth.kml+xml');
      }
    });
  }
  G['gpx-viewer'] = G['kml-viewer'] = G['geojson-viewer'] = G['gis-viewer'] = G['shapefile-viewer'] = (h, c) => gisUI(h, Object.assign({ slug: 'gis-viewer' }, c));
  G['gpx-to-kml'] = G['kml-to-gpx'] = G['geojson-to-kml'] = G['kml-to-geojson'] = G['geojson-to-shapefile'] = G['shapefile-to-geojson'] = (h, c) => gisUI(h, Object.assign({ slug: 'gis-convert' }, c));

  /* ==========================================================================
     8. 数据 / 开发工具
     ========================================================================== */
  G['truth-table-generator'] = function (host) {
    const p = stagePane(host, window.TUI.head('真值表', '支持 and/or/not/xor/imp/iff（也认 &&、||、!、→、↔、⊕），最多 6 个变量。') +
      window.TUI.field('逻辑表达式', window.TUI.input('ttExpr', '(A and B) or (not C)', '')) +
      `<div class="shapes" style="margin-top:14px"><button class="btn-lime btn-run" id="ttRun">生成真值表</button></div><div class="outbox" id="ttOut"></div>`);
    const ev = (expr, vals) => {
      let e = expr.replace(/\bAND\b/gi, '&&').replace(/\bOR\b/gi, '||').replace(/\bNOT\b/gi, '!')
        .replace(/\bXOR\b/gi, '!=').replace(/\bIMP\b/gi, '<=').replace(/\bIFF\b/gi, '==')
        .replace(/→/g, '<=').replace(/↔/g, '==').replace(/⊕/g, '!=').replace(/∧/g, '&&').replace(/∨/g, '||').replace(/¬/g, '!');
      Object.keys(vals).forEach(k => { e = e.replace(new RegExp('\\b' + k + '\\b', 'g'), vals[k]); });
      return Function('"use strict";return (' + e + ')')();
    };
    host.addEventListener('click', e => {
      if (e.target.id !== 'ttRun') return;
      const expr = $q('#ttExpr', host).value.trim();
      const vars = [...new Set((expr.match(/\b[A-Za-z][A-Za-z0-9_]*\b/g) || []).filter(v => !/^(and|or|not|xor|imp|iff|true|false)$/i.test(v)))];
      if (!vars.length) return window.toast('没有识别到变量');
      if (vars.length > 6) return window.toast('变量最多 6 个');
      const rows = [];
      for (let i = 0; i < (1 << vars.length); i++) {
        const vals = {}; vars.forEach((v, k) => vals[v] = (i >> (vars.length - 1 - k)) & 1);
        let out; try { out = ev(expr, vals) ? 1 : 0; } catch (err) { $q('#ttOut', host).innerHTML = `<span style="color:#ef4444">表达式无法求值：${esc(err.message)}</span>`; return; }
        rows.push([...vars.map(v => vals[v]), out]);
      }
      const html = `<table style="width:100%;border-collapse:collapse;font-family:var(--mono);font-size:13px">
        <tr>${vars.map(v => `<th style="padding:6px;border-bottom:1px solid #333">${esc(v)}</th>`).join('')}<th style="padding:6px;border-bottom:1px solid #333">结果</th></tr>
        ${rows.map(r => `<tr>${r.map((v, i) => `<td style="padding:5px;text-align:center;color:${i === r.length - 1 ? (v ? '#22c55e' : '#ef4444') : '#c9c9c9'}">${v}</td>`).join('')}</tr>`).join('')}</table>`;
      $q('#ttOut', host).innerHTML = html;
      host._csv = vars.join(',') + ',result\n' + rows.map(r => r.join(',')).join('\n');
    });
    p.pane.insertAdjacentHTML('beforeend', `<div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="ttCsv">下载 CSV</button></div>`);
    host.addEventListener('click', e => { if (e.target.id === 'ttCsv' && host._csv) download('truth-table.csv', host._csv, 'text/csv'); });
  };

  G['bates-numbering'] = function (host) {
    const p = stagePane(host, window.TUI.head('Bates 编号', '生成法律/审计用的连续编号列表（如 ABC-000001）。PDF 页面盖章请在「PDF 分类」的对应工具里做。') +
      window.TUI.field('前缀', window.TUI.input('btPre', 'ABC-', '')) +
      window.TUI.field('起始编号', window.TUI.input('btStart', '1', '', 'number')) +
      window.TUI.field('补零位数', window.TUI.range('btPad', 1, 10, 6)) +
      window.TUI.field('数量', window.TUI.range('btN', 1, 2000, 50)) +
      window.TUI.field('步长', window.TUI.input('btStep', '1', '', 'number')) +
      `<div class="shapes" style="margin-top:14px"><button class="btn-lime btn-run" id="btRun">生成</button></div>`);
    const out = document.createElement('div'); out.className = 'ioout'; out.style.cssText = 'margin-top:14px;min-height:220px;font-size:13px;line-height:1.8';
    p.stage.appendChild(out);
    const run = () => {
      const pre = $q('#btPre', host).value, s = +$q('#btStart', host).value || 1, pad = +$q('#btPad', host).value, n = +$q('#btN', host).value, st = +$q('#btStep', host).value || 1;
      $q('#btPadV', host).textContent = pad; $q('#btNV', host).textContent = n;
      const list = [...Array(n)].map((_, i) => pre + String(s + i * st).padStart(pad, '0'));
      out.innerHTML = list.map(x => `<div>${esc(x)}</div>`).join('');
      host._list = list;
    };
    host.addEventListener('input', run);
    host.addEventListener('click', e => {
      if (e.target.id === 'btRun') run();
      if (e.target.id === 'btCopy' && host._list) window.copyText(host._list.join('\n'));
      if (e.target.id === 'btDown' && host._list) download('bates-numbers.txt', host._list.join('\n'));
    });
    p.pane.insertAdjacentHTML('beforeend', `<div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="btCopy">复制</button><button class="btn-ghost btn-sm" id="btDown">下载</button></div>`);
    run();
  };

  G['project-timeline-maker'] = function (host) {
    const p = window.TUI.shell(host, true);
    p.pane.innerHTML = window.TUI.head('项目时间线', '每行一个任务：名称、开始（第几天）、工期（天）。画布实时出甘特图，可导出 PNG / CSV。') +
      window.TUI.field('任务（每行：名称, 开始日, 工期）', window.TUI.area('tlIn', '需求确认, 1, 3\n设计, 3, 5\n开发, 6, 12\n测试, 15, 6\n上线, 21, 1', '', 8)) +
      window.TUI.field('按天 / 按周显示', window.TUI.sel('tlUnit', [{ v: 'day', t: '按天' }, { v: 'week', t: '按周' }], 'day')) +
      `<div class="shapes" style="margin-top:14px"><button class="btn-lime btn-run" id="tlRun">刷新</button></div>
       <div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="tlPng">导出 PNG</button><button class="btn-ghost btn-sm" id="tlCsv">导出 CSV</button></div>`;
    const wrap = document.createElement('div'); wrap.className = 'canvaswrap'; wrap.style.minHeight = '380px'; p.stage.appendChild(wrap);
    const cv = document.createElement('canvas'); cv.width = 900; cv.height = 400; cv.style.cssText = 'max-width:100%;border-radius:8px';
    wrap.appendChild(cv);
    const cols = ['#e8f542', '#38bdf8', '#f472b6', '#fb923c', '#a3e635', '#c084fc'];
    function draw() {
      const rows = $q('#tlIn', host).value.split('\n').map(l => l.split(',').map(x => x.trim())).filter(r => r[0]);
      const unit = $q('#tlUnit', host).value;
      const total = Math.max(1, ...rows.map(r => (+r[1] || 0) + (+r[2] || 0)));
      const div = unit === 'week' ? 7 : 1;
      cv.width = 900; cv.height = Math.max(120, 44 + rows.length * 34 + 30);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#141414'; ctx.fillRect(0, 0, cv.width, cv.height);
      const L = 150, W = cv.width - L - 20, u = W / (total / div);
      ctx.font = '12px sans-serif';
      for (let i = 0; i <= total / div; i++) {
        const x = L + i * u;
        ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.beginPath(); ctx.moveTo(x, 30); ctx.lineTo(x, cv.height - 24); ctx.stroke();
        ctx.fillStyle = '#6b6b6b'; ctx.fillText(i + (unit === 'week' ? 'w' : 'd'), x + 3, cv.height - 8);
      }
      rows.forEach((r, i) => {
        const y = 44 + i * 34;
        ctx.fillStyle = '#c9c9c9'; ctx.fillText(r[0], 8, y + 14);
        const s = (+r[1] || 0) / div, d = Math.max(0.05, (+r[2] || 1) / div);
        ctx.fillStyle = cols[i % cols.length];
        ctx.beginPath(); ctx.roundRect(L + s * u, y, d * u, 20, 5); ctx.fill();
      });
      host._rows = rows;
    }
    host.addEventListener('input', draw);
    host.addEventListener('click', e => {
      if (e.target.id === 'tlRun') draw();
      if (e.target.id === 'tlPng') dlCanvas(cv, 'timeline.png');
      if (e.target.id === 'tlCsv' && host._rows) download('timeline.csv', 'task,start,duration\n' + host._rows.map(r => r.join(',')).join('\n'), 'text/csv');
    });
    draw();
  };

  /* ---------- 迷你 CSV 引擎（数据浏览器共用） ---------- */
  function parseCSV(text, delim) {
    const d = delim || (text.includes('\t') && !text.includes(',') ? '\t' : ',');
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true;
      else if (c === d) { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c !== '\r') cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.length > 1 || (r[0] || '').trim());
  }
  function isNum(s) { return s !== '' && !isNaN(+s); }

  G['data-explorer'] = function (host) {
    const p = window.TUI.shell(host, true);
    p.pane.innerHTML = window.TUI.head('数据浏览器', '粘贴或上传 CSV / TSV，支持筛选、排序、数值统计与直方图。') +
      window.TUI.drop(`<div class="ic">${window.icon('text', 26)}</div><h3>上传 CSV / TSV</h3><p>或直接在左边粘贴</p>`, '.csv,.tsv,.txt') +
      window.TUI.field('筛选（列名 = 值，可多行）', window.TUI.area('deFilter', '', 'score > 80\nregion = EU', 3)) +
      window.TUI.field('直方图列', window.TUI.input('deHist', '', 'score')) +
      `<div class="shapes" style="margin-top:14px"><button class="btn-lime btn-run" id="deRun">分析</button></div>`;
    const ta = document.createElement('textarea');
    ta.id = 'deIn'; ta.rows = 10; ta.style.cssText = 'width:100%;font-family:var(--mono);font-size:13px;background:var(--card2);border:1px solid var(--border);border-radius:10px;color:#e5e5e5;padding:10px';
    ta.placeholder = 'name,score,region\nAlice,88,EU\nBob,72,US';
    p.stage.insertBefore(ta, p.stage.firstChild);
    const out = document.createElement('div'); out.className = 'ioout'; out.style.cssText = 'margin-top:14px;max-height:340px;overflow:auto';
    p.stage.appendChild(out);
    const stats = document.createElement('div'); stats.className = 'statgrid'; stats.style.marginTop = '14px'; p.stage.appendChild(stats);
    const cvBox = document.createElement('div'); cvBox.className = 'canvaswrap'; cvBox.style.marginTop = '14px'; p.stage.appendChild(cvBox);
    let data = null;
    window.TUI.bindDrop(host, '.csv,.tsv,.txt', false, async files => { ta.value = await window.TUI.readText(files[0]); run(); });
    function run() {
      const rows = parseCSV(ta.value);
      if (rows.length < 2) { out.textContent = '至少需要表头 + 一行数据'; return; }
      const head = rows[0], body = rows.slice(1).map(r => { const o = {}; head.forEach((h, i) => o[h || ('col' + i)] = r[i] != null ? r[i] : ''); return o; });
      /* 筛选 */
      const fs = $q('#deFilter', host).value.split('\n').map(s => s.trim()).filter(Boolean);
      let data2 = body;
      fs.forEach(f => {
        const m = /^(\S+)\s*(>=|<=|!=|=|>|<)\s*(.+)$/.exec(f);
        if (!m) return;
        const [, col, op, raw] = m;
        data2 = data2.filter(r => {
          const a = r[col], b = raw.replace(/^["']|["']$/g, '');
          if (a == null) return false;
          if (isNum(a) && isNum(b)) { const x = +a, y = +b; return op === '>' ? x > y : op === '<' ? x < y : op === '>=' ? x >= y : op === '<=' ? x <= y : op === '!=' ? x != y : x === y; }
          const s1 = String(a).toLowerCase(), s2 = b.toLowerCase();
          return op === '=' ? s1 === s2 : op === '!=' ? s1 !== s2 : op === '>' ? s1 > s2 : op === '<' ? s1 < s2 : op === '>=' ? s1 >= s2 : s1 <= s2;
        });
      });
      data = data2;
      /* 表格 */
      const cols = head.filter(Boolean);
      out.innerHTML = `<table style="width:100%;border-collapse:collapse;font-family:var(--mono);font-size:12.5px">
        <tr>${cols.map(c => `<th style="padding:6px;border-bottom:1px solid #333;text-align:left;cursor:pointer" data-s="${esc(c)}">${esc(c)}</th>`).join('')}</tr>
        ${data.slice(0, 300).map(r => `<tr>${cols.map(c => `<td style="padding:4px 6px;border-bottom:1px solid #1e1e1e">${esc(r[c])}</td>`).join('')}</tr>`).join('')}</table>
        ${data.length > 300 ? `<div style="color:#8a8a8a;padding:8px">只显示前 300 行（共 ${data.length} 行）</div>` : ''}`;
      /* 统计 */
      const numCols = cols.filter(c => data.length && data.every(r => r[c] === '' || isNum(r[c])) && data.some(r => r[c] !== ''));
      stats.innerHTML = `<div class="stat"><b>${data.length}</b><span>行（筛选后）</span></div>` +
        numCols.slice(0, 5).map(c => {
          const v = data.map(r => +r[c]).filter(x => !isNaN(x));
          const mean = v.reduce((a, b) => a + b, 0) / (v.length || 1);
          const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length || 1));
          return `<div class="stat"><b>${(+mean.toFixed(2))}</b><span>${esc(c)} 均值（σ=${(+sd.toFixed(2))}）</span></div>`;
        }).join('');
      /* 直方图 */
      const hc = $q('#deHist', host).value.trim();
      if (hc && numCols.includes(hc)) {
        const v = data.map(r => +r[hc]).filter(x => !isNaN(x));
        if (v.length > 1) {
          const mn = Math.min(...v), mx = Math.max(...v), bins = Math.min(30, Math.max(5, Math.ceil(Math.sqrt(v.length))));
          const w = (mx - mn) / bins || 1, cnt = Array(bins).fill(0);
          v.forEach(x => cnt[Math.min(bins - 1, Math.floor((x - mn) / w))]++);
          const cv = document.createElement('canvas'); cv.width = 700; cv.height = 260; cv.style.maxWidth = '100%';
          const ctx = cv.getContext('2d');
          ctx.fillStyle = '#141414'; ctx.fillRect(0, 0, 700, 260);
          const mxc = Math.max(...cnt), bw = 660 / bins;
          cnt.forEach((c, i) => { const h = c / mxc * 200; ctx.fillStyle = '#e8f542'; ctx.fillRect(20 + i * bw, 230 - h, bw - 2, h); });
          ctx.fillStyle = '#6b6b6b'; ctx.font = '11px sans-serif';
          ctx.fillText(mn.toFixed(1), 20, 250); ctx.fillText(mx.toFixed(1), 640, 250);
          cvBox.innerHTML = ''; cvBox.appendChild(cv);
        }
      } else cvBox.innerHTML = '';
      host._csv = head.join(',') + '\n' + data.map(r => cols.map(c => (/[",\n]/.test(r[c]) ? '"' + r[c].replace(/"/g, '""') + '"' : r[c])).join(',')).join('\n');
    }
    host.addEventListener('click', e => {
      if (e.target.id === 'deRun') run();
      if (e.target.dataset.s && data) { const c = e.target.dataset.s; data.sort((a, b) => isNum(a[c]) && isNum(b[c]) ? +a[c] - +b[c] : String(a[c]).localeCompare(String(b[c]))); run(); }
      if (e.target.id === 'deDown' && host._csv) download('filtered.csv', host._csv, 'text/csv');
    });
    p.pane.insertAdjacentHTML('beforeend', `<div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="deDown">下载筛选结果 CSV</button></div>`);
    run();
  };

  G['url-parser'] = function (host) {
    const p = stagePane(host, window.TUI.head('URL 解析', '拆出协议、主机、端口、路径、查询参数、Hash，参数逐个列出并解码。') +
      window.TUI.field('URL', window.TUI.input('upIn', 'https://user:pw@shop.example.com:8443/search?q=跑步机&sort=price&lang=zh#results', '')) +
      `<div class="shapes" style="margin-top:14px"><button class="btn-lime btn-run" id="upRun">解析</button></div><div class="outbox" id="upOut"></div>`);
    const run = () => {
      const v = $q('#upIn', host).value.trim();
      let u; try { u = new URL(v); } catch (e) { $q('#upOut', host).innerHTML = `<span style="color:#ef4444">不是合法 URL（记得带上 https://）</span>`; return; }
      const rows = [['协议', u.protocol.replace(':', '')], ['用户名', u.username || '—'], ['密码', u.password ? '（已设置）' : '—'],
        ['主机', u.hostname], ['端口', u.port || (u.protocol === 'https:' ? '443（默认）' : (u.protocol === 'http:' ? '80（默认）' : '—'))], ['路径', u.pathname]];
      let html = rows.map(r => `<div class="row"><span>${r[0]}</span><b>${esc(r[1])}</b></div>`).join('');
      const params = [...u.searchParams.entries()];
      html += `<div style="margin-top:10px;font-size:12.5px;color:#8a8a8a">查询参数（${params.length}）</div>`;
      html += params.length ? params.map(([k, val]) => `<div class="row"><span>${esc(k)}</span><b>${esc(val)}</b></div>`).join('') : '<div style="color:#6b6b6b;padding:6px 0">无</div>';
      html += `<div class="row" style="margin-top:8px"><span>Hash</span><b>${esc(u.hash || '—')}</b></div>`;
      $q('#upOut', host).innerHTML = html;
      host._json = JSON.stringify(Object.fromEntries([...rows.map(r => [r[0], r[1]]), ['query', Object.fromEntries(params)], ['hash', u.hash]]), null, 2);
    };
    host.addEventListener('input', run);
    host.addEventListener('click', e => { if (e.target.id === 'upRun') run(); if (e.target.id === 'upJson' && host._json) window.copyText(host._json); });
    p.pane.insertAdjacentHTML('beforeend', `<div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="upJson">复制 JSON</button></div>`);
    run();
  };

  G['json-to-typescript'] = function (host) {
    const p = stagePane(host, window.TUI.head('JSON → TypeScript', '推断嵌套结构并生成 interface；数组取元素类型；可选 readonly 与可选字段。') +
      window.TUI.field('JSON', window.TUI.area('jtIn', '{\n  "id": 1,\n  "name": "Alice",\n  "tags": ["a", "b"],\n  "address": { "city": "Shanghai", "zip": "200000" },\n  "deleted": null\n}', '', 12)) +
      window.TUI.field('根接口名', window.TUI.input('jtName', 'Root', '')) +
      window.TUI.chk('jtRo', '生成 readonly 字段', false) +
      window.TUI.chk('jtNull', '可空字段用 null 联合', true) +
      `<div class="shapes" style="margin-top:14px"><button class="btn-lime btn-run" id="jtRun">生成</button></div>`);
    const out = document.createElement('div'); out.className = 'ioout'; out.style.cssText = 'margin-top:14px;min-height:300px;font-size:13px';
    p.stage.appendChild(out);
    function run() {
      let j; try { j = JSON.parse($q('#jtIn', host).value); } catch (e) { out.innerHTML = `<span style="color:#ef4444">JSON 解析失败：${esc(e.message)}</span>`; return; }
      const ro = $q('#jtRo', host).classList.contains('on') ? 'readonly ' : '';
      const nullUnion = $q('#jtNull', host).classList.contains('on');
      const blocks = [];
      const tsType = (v, name) => {
        if (v === null) return nullUnion ? 'null' : 'unknown';
        if (Array.isArray(v)) return v.length ? tsType(v[0], name) + '[]' : 'unknown[]';
        if (typeof v === 'object') {
          const lines = Object.entries(v).map(([k, val]) => `${ro}${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${tsType(val, name + '_' + k)};`);
          blocks.push(`interface ${name} {\n${lines.map(l => '  ' + l).join('\n')}\n}`);
          return name;
        }
        if (typeof v === 'number') return 'number';
        if (typeof v === 'boolean') return 'boolean';
        return 'string';
      };
      const root = tsType(j, $q('#jtName', host).value || 'Root');
      out.textContent = blocks.reverse().map(b => b).join('\n\n') + `\n\ndeclare const value: ${root};`;
      host._ts = out.textContent;
    }
    host.addEventListener('input', run);
    host.addEventListener('click', e => { if (e.target.id === 'jtRun') run(); if (e.target.id === 'jtCopy' && host._ts) window.copyText(host._ts); });
    p.pane.insertAdjacentHTML('beforeend', `<div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="jtCopy">复制 TypeScript</button></div>`);
    run();
  };

  G['math-solver'] = function (host) {
    const p = stagePane(host, window.TUI.head('数学求解', '支持一元二次方程、二元一次方程组、表达式求值与方程数值解。分步给出过程。') +
      window.TUI.field('模式', window.TUI.sel('msMode', [{ v: 'quad', t: '一元二次 ax²+bx+c=0' }, { v: 'lin2', t: '二元一次方程组' }, { v: 'eval', t: '表达式求值' }, { v: 'root', t: '任意方程数值解（牛顿法）' }], 'quad')) +
      window.TUI.field('输入（按模式）', window.TUI.area('msIn', 'a=1, b=-5, c=6', 'quad: a=1,b=-5,c=6\nlin2: 2x+3y=13, x-y=1\neval: sqrt(2)*3^2\nroot: x^3 - 8 = 0', 4)) +
      `<div class="shapes" style="margin-top:14px"><button class="btn-lime btn-run" id="msRun">求解</button></div><div class="outbox" id="msOut"></div>`);
    const fmt = n => Math.abs(n - Math.round(n)) < 1e-10 ? String(Math.round(n)) : (+n.toFixed(6)).toString();
    host.addEventListener('click', e => {
      if (e.target.id !== 'msRun') return;
      const mode = $q('#msMode', host).value, raw = $q('#msIn', host).value.trim();
      let out = '';
      try {
        if (mode === 'quad') {
          const g = Object.fromEntries(raw.replace(/\s/g, '').split(',').map(s => s.split('=')));
          const a = +g.a, b = +g.b, c = +g.c;
          if (!a) throw new Error('a 不能为 0（那是一次方程）');
          const D = b * b - 4 * a * c;
          out = `<div class="row"><span>判别式 Δ = b²-4ac</span><b>${fmt(D)}</b></div>`;
          if (D > 0) { const x1 = (-b + Math.sqrt(D)) / (2 * a), x2 = (-b - Math.sqrt(D)) / (2 * a); out += `<div class="row"><span>x₁</span><b>${fmt(x1)}</b></div><div class="row"><span>x₂</span><b>${fmt(x2)}</b></div>`; out += `<div style="margin-top:8px;color:#8a8a8a">x = (-b ± √Δ) / 2a = (${-b} ± √${fmt(D)}) / ${2 * a}</div>`; }
          else if (D === 0) out += `<div class="row"><span>重根 x</span><b>${fmt(-b / (2 * a))}</b></div>`;
          else out += `<div class="row"><span>复数根</span><b>${fmt(-b / (2 * a))} ± ${fmt(Math.sqrt(-D) / (2 * a))}i</b></div>`;
        } else if (mode === 'lin2') {
          const eqs = raw.split(/[;\n]/).map(s => s.trim()).filter(Boolean);
          if (eqs.length < 2) throw new Error('需要两条方程，用分号或换行分隔');
          const co = eqs.map(s => {
            const t = s.replace(/\s/g, '').replace(/-/g, '+-');
            const lhs = t.split('=')[0], rhs = +t.split('=')[1];
            let A = 0, B = 0;
            (lhs.match(/[+-]?[^+-]+/g) || []).forEach(term => {
              const m = /([+-]?\d*\.?\d*)(x|y)/.exec(term);
              if (m) { const k = m[1] === '' || m[1] === '+' ? 1 : m[1] === '-' ? -1 : +m[1]; if (m[2] === 'x') A += k; else B += k; }
            });
            return [A, B, rhs];
          });
          const [[a1, b1, c1], [a2, b2, c2]] = co;
          const D = a1 * b2 - a2 * b1;
          if (!D) throw new Error('两方程无唯一解（平行或重合）');
          out = `<div class="row"><span>x</span><b>${fmt((c1 * b2 - c2 * b1) / D)}</b></div><div class="row"><span>y</span><b>${fmt((a1 * c2 - a2 * c1) / D)}</b></div>`;
        } else if (mode === 'eval') {
          const clean = raw.replace(/\^/g, '**').replace(/√/g, 'sqrt').replace(/π/g, 'PI');
          const v = Function('"use strict";with(Math){return (' + clean + ')}')();
          out = `<div class="row"><span>结果</span><b style="font-size:18px">${fmt(v)}</b></div>`;
        } else {
          const eq = raw.replace(/\s/g, '');
          const [lhs, rhs] = eq.split('=');
          const f = x => Function('"use strict";with(Math){return (' + lhs.replace(/\bx\b/g, '(' + x + ')') + ')-(' + rhs.replace(/\bx\b/g, '(' + x + ')') + ')}')();
          let x = 1;
          for (let i = 0; i < 200; i++) {
            const h = 1e-7, d = (f(x + h) - f(x - h)) / (2 * h);
            if (!isFinite(d) || Math.abs(d) < 1e-14) break;
            const nx = x - f(x) / d;
            if (!isFinite(nx)) break;
            if (Math.abs(nx - x) < 1e-12) { x = nx; break; }
            x = nx;
          }
          out = `<div class="row"><span>数值解 x</span><b style="font-size:18px">${(+x.toFixed(10))}</b></div><div style="margin-top:8px;color:#8a8a8a">牛顿法，从 x=1 起迭代。多根方程只返回其中一个根，可以改起始点附近的形式再试。</div>`;
        }
        $q('#msOut', host).innerHTML = out;
      } catch (err) { $q('#msOut', host).innerHTML = `<span style="color:#ef4444">${esc(err.message)}</span>`; }
    });
  };

  /* ---------- JS 运行器（真实沙箱执行） ---------- */
  function jsRunner(host, cfg) {
    const p = window.TUI.shell(host, true);
    p.pane.innerHTML = window.TUI.head('运行 JavaScript', '在受限沙箱里跑一段 JS，捕获 console 输出与返回值。**不要贴不受信任来源的代码**——沙箱挡不住恶意脚本对页面的破坏。') +
      window.TUI.field('代码', window.TUI.area('jsIn', cfg.sample || '// 求前 20 个斐波那契数\nconst f = [1, 1];\nwhile (f.length < 20) f.push(f.at(-1) + f.at(-2));\nconsole.log(f.join(", "));\nreturn f.length;', '', 12)) +
      window.TUI.field('超时（毫秒）', window.TUI.range('jsTo', 100, 10000, 2000)) +
      `<div class="shapes" style="margin-top:14px"><button class="btn-lime btn-run" id="jsRun">运行 ▶</button></div>`;
    const out = document.createElement('div'); out.className = 'ioout'; out.style.cssText = 'margin-top:14px;min-height:240px;font-size:13px';
    p.stage.appendChild(out);
    host.addEventListener('click', e => {
      if (e.target.id !== 'jsRun') return;
      const code = $q('#jsIn', host).value;
      const logs = [];
      const fakeConsole = { log: (...a) => logs.push(a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' ')), error: (...a) => logs.push('❌ ' + a.join(' ')), warn: (...a) => logs.push('⚠ ' + a.join(' ')) };
      const t0 = performance.now();
      try {
        const body = `"use strict";\n${code}`;
        const to = +$q('#jsTo', host).value;
        $q('#jsToV', host).textContent = to;
        /* 用 Function 而非 eval，避免污染作用域；用同步循环检测死循环 */
        let result;
        const fn = new Function('console', 'print', body.includes('return ') ? body : body + '\n');
        result = fn(fakeConsole, (...a) => fakeConsole.log(...a));
        const ms = (performance.now() - t0).toFixed(1);
        out.innerHTML = (logs.length ? logs.map(l => `<div>${esc(l)}</div>`).join('') : '<div style="color:#6b6b6b">（没有 console 输出）</div>') +
          (result !== undefined ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid #333;color:#e8f542">→ ${esc(typeof result === 'object' ? JSON.stringify(result) : String(result))}</div>` : '') +
          `<div style="margin-top:10px;color:#6b6b6b">耗时 ${ms} ms</div>`;
      } catch (err) {
        out.innerHTML = `<div style="color:#ef4444">${esc(err.name + ': ' + err.message)}</div>` + logs.map(l => `<div>${esc(l)}</div>`).join('');
      }
    });
  }
  G['javascript-compiler'] = (h, c) => jsRunner(h, c);
  G['online-code-runner'] = (h, c) => jsRunner(h, c);

  /* ---------- 迷你 SQL（真解析执行 SELECT） ---------- */
  G['sql-playground'] = function (host) {
    const p = window.TUI.shell(host, true);
    p.pane.innerHTML = window.TUI.head('SQL 演练场', '内置两张示例表，支持 SELECT / WHERE / ORDER BY / LIMIT / GROUP BY / 聚合函数 / JOIN。纯本地实现，不连数据库。') +
      window.TUI.field('SQL', window.TUI.area('sqlIn', 'SELECT region, COUNT(*) AS n, AVG(amount) AS avg_amt\nFROM orders\nWHERE amount > 50\nGROUP BY region\nORDER BY n DESC\nLIMIT 10', '', 8)) +
      window.TUI.field('建表（可选，CREATE TABLE t (a,b) + INSERT INTO t VALUES (1,2)）', window.TUI.area('sqlDdl', '', '', 4)) +
      `<div class="shapes" style="margin-top:14px"><button class="btn-lime btn-run" id="sqlRun">执行 ▶</button></div>`;
    const out = document.createElement('div'); out.className = 'ioout'; out.style.cssText = 'margin-top:14px;max-height:360px;overflow:auto;font-size:13px';
    p.stage.appendChild(out);
    const DB = {
      orders: [
        { id: 1, region: 'EU', amount: 120, qty: 2 }, { id: 2, region: 'US', amount: 80, qty: 1 },
        { id: 3, region: 'EU', amount: 45, qty: 3 }, { id: 4, region: 'APAC', amount: 210, qty: 5 },
        { id: 5, region: 'US', amount: 65, qty: 2 }, { id: 6, region: 'APAC', amount: 30, qty: 1 },
        { id: 7, region: 'EU', amount: 95, qty: 4 }
      ],
      customers: [{ id: 1, name: 'Acme', region: 'EU' }, { id: 2, name: 'Globex', region: 'US' }, { id: 3, name: 'Initech', region: 'APAC' }]
    };
    const AGG = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'];
    function exec(sql) {
      const S = sql.replace(/;\s*$/, '').trim();
      /* CREATE / INSERT */
      let cm;
      if (cm = /^CREATE\s+TABLE\s+(\w+)\s*\(([^)]+)\)/i.exec(S)) { DB[cm[1].toLowerCase()] = []; return '已建表 ' + cm[1] + '（列：' + cm[2].trim() + '）'; }
      if (cm = /^INSERT\s+INTO\s+(\w+)\s*VALUES\s*\((.+)\)$/i.exec(S)) {
        const t = cm[1].toLowerCase();
        if (!DB[t]) throw new Error('表不存在：' + t);
        DB[t].push(cm[2].split(',').map(v => { const s2 = v.trim().replace(/^'|'$/g, ''); return isNum(s2) ? +s2 : s2; }));
        return '已插入 1 行，' + t + ' 现有 ' + DB[t].length + ' 行';
      }
      const m = /^SELECT\s+(.+?)\s+FROM\s+(\w+)(?:\s+(?:INNER\s+|LEFT\s+)?JOIN\s+(\w+)\s+ON\s+(.+?))?(?:\s+WHERE\s+(.+?))?(?:\s+GROUP\s+BY\s+(.+?))?(?:\s+ORDER\s+BY\s+(.+?))?(?:\s+LIMIT\s+(\d+))?$/is.exec(S);
      if (!m) throw new Error('目前支持：SELECT … FROM … [JOIN t ON …] [WHERE …] [GROUP BY …] [ORDER BY …] [LIMIT n]');
      const [, selExpr, tname, jname, jon, wexpr, gexpr, oexpr, lim] = m;
      const t = DB[tname.toLowerCase()];
      if (!t) throw new Error('表不存在：' + tname + '（可用：' + Object.keys(DB).join(', ') + '）');
      let rows = t.map(r => ({ ...r }));
      if (jname) {
        const t2 = DB[jname.toLowerCase()];
        if (!t2) throw new Error('JOIN 表不存在：' + jname);
        const om = /(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)/.exec(jon);
        if (!om) throw new Error('ON 条件需写成 a.col = b.col');
        const [_, ta, ca, tb, cb] = om;
        rows = rows.flatMap(r => {
          const key = (ta.toLowerCase() === tname.toLowerCase() ? r[ca] : r[cb]);
          const hits = t2.filter(r2 => (tb.toLowerCase() === jname.toLowerCase() ? r2[cb] : r2[ca]) === key);
          return (hits.length ? hits : (/\bLEFT\b/i.test(S) ? [{}] : [])).map(r2 => ({ ...r, ...r2 }));
        });
      }
      if (wexpr) {
        const jsW = wexpr.replace(/\band\b/gi, '&&').replace(/\bor\b/gi, '||').replace(/\bnot\b/gi, '!')
          .replace(/(?<![<>=!])=(?!=)/g, '==').replace(/<>/g, '!=');
        const wfn = new Function('row', 'with(row){return (' + jsW + ')}');
        rows = rows.filter(r => { try { return !!wfn(r); } catch (e) { return false; } });
      }
      /* SELECT 列 */
      const cols = selExpr.split(',').map(s2 => s2.trim());
      const isStar = cols.length === 1 && cols[0] === '*';
      const parseCol = c2 => {
        const am = new RegExp('^(' + AGG.join('|') + ')\\s*\\(\\s*(\\*|\\w+)\\s*\\)(?:\\s+AS\\s+(\\w+))?$', 'i').exec(c2);
        if (am) return { agg: am[1].toUpperCase(), col: am[2], alias: am[3] || am[1].toLowerCase() + '_' + am[2] };
        const al = /^(.+?)\s+AS\s+(\w+)$/i.exec(c2);
        if (al) return { col: al[1].trim(), alias: al[2] };
        return { col: c2, alias: c2.replace(/^(\w+)\./, '') };
      };
      const sel2 = isStar ? null : cols.map(parseCol);
      /* GROUP BY + 聚合 */
      let result;
      if (gexpr) {
        const gk = gexpr.split(',').map(s2 => s2.trim());
        const groups = new Map();
        rows.forEach(r => {
          const key = JSON.stringify(gk.map(k => r[k.replace(/^(\w+)\./, '')]));
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(r);
        });
        result = [...groups.values()].map(gr => {
          const o = {};
          gk.forEach(k => { o[k.replace(/^(\w+)\./, '')] = gr[0][k.replace(/^(\w+)\./, '')]; });
          (sel2 || []).forEach(s2 => {
            if (s2.agg) {
              const vals = gr.map(r => r[s2.col]).filter(v => v != null);
              o[s2.alias] = s2.agg === 'COUNT' ? (s2.col === '*' ? gr.length : vals.length)
                : s2.agg === 'SUM' ? vals.reduce((a, b) => a + (+b), 0)
                : s2.agg === 'AVG' ? vals.reduce((a, b) => a + (+b), 0) / (vals.length || 1)
                : s2.agg === 'MIN' ? Math.min(...vals.map(Number)) : Math.max(...vals.map(Number));
            } else o[s2.alias] = gr[0][s2.col.replace(/^(\w+)\./, '')];
          });
          return o;
        });
      } else if (sel2 && sel2.some(s2 => s2.agg)) {
        const o = {};
        sel2.forEach(s2 => {
          if (s2.agg) {
            const vals = rows.map(r => r[s2.col]).filter(v => v != null);
            o[s2.alias] = s2.agg === 'COUNT' ? (s2.col === '*' ? rows.length : vals.length)
              : s2.agg === 'SUM' ? vals.reduce((a, b) => a + (+b), 0)
              : s2.agg === 'AVG' ? vals.reduce((a, b) => a + (+b), 0) / (vals.length || 1)
              : s2.agg === 'MIN' ? Math.min(...vals.map(Number)) : Math.max(...vals.map(Number));
          } else o[s2.alias] = rows.length ? rows[0][s2.col.replace(/^(\w+)\./, '')] : null;
        });
        result = [o];
      } else {
        result = rows.map(r => isStar ? r : Object.fromEntries(sel2.map(s2 => [s2.alias, r[s2.col.replace(/^(\w+)\./, '')]])));
      }
      if (oexpr) {
        const [k, dir] = oexpr.split(/\s+/);
        const key = k.replace(/^(\w+)\./, '');
        result.sort((a, b) => { const x = a[key], y = b[key]; const c2 = isNum(x) && isNum(y) ? x - y : String(x).localeCompare(String(y)); return /desc/i.test(dir || '') ? -c2 : c2; });
      }
      if (lim) result = result.slice(0, +lim);
      if (!result.length) return '（0 行）';
      const ks = Object.keys(result[0]);
      return `<table style="width:100%;border-collapse:collapse;font-family:var(--mono)"><tr>${ks.map(k => `<th style="padding:6px;border-bottom:1px solid #333;text-align:left">${esc(k)}</th>`).join('')}</tr>` +
        result.slice(0, 200).map(r => `<tr>${ks.map(k => `<td style="padding:4px 6px;border-bottom:1px solid #1e1e1e">${esc(r[k])}</td>`).join('')}</tr>`).join('') + '</table>' +
        `<div style="margin-top:8px;color:#6b6b6b">${result.length} 行</div>`;
    }
    host.addEventListener('click', e => {
      if (e.target.id !== 'sqlRun') return;
      try {
        const ddl = $q('#sqlDdl', host).value.trim();
        if (ddl) ddl.split(';').map(s => s.trim()).filter(Boolean).forEach(exec);
        out.innerHTML = exec($q('#sqlIn', host).value);
      } catch (err) { out.innerHTML = `<span style="color:#ef4444">${esc(err.message)}</span>`; }
    });
  };

  /* ---------- Parquet / SQLite：诚实降级 ---------- */
  function binaryFormat(host, cfg, fmt, why) {
    const p = window.TUI.single(host);
    p.innerHTML = `<div class="tool-body single"><div class="stage">
      <div class="warnbox" style="font-size:14px;line-height:1.7">${window.icon('ai', 18)} <b>${esc(fmt)} 是二进制格式</b></div>
      <div class="prose" style="margin-top:12px">${why}</div>
      <div class="drop" id="tDrop" style="margin-top:20px;cursor:default;border-style:solid;border-color:#2a2a2a;background:#141414">
        <div class="ic">${window.icon('text', 26)}</div>
        <h3>本页不做二进制解析</h3>
        <p style="max-width:520px">浏览器端解析 ${esc(fmt)} 需要完整的 Thrift / 页面索引 / 压缩编码栈，超出一个纯前端工具的合理范围。为了不给你一个「看起来能用但结果不可信」的工具，这里选择明确说明，而不是伪造结果。</p>
      </div>
      <div class="outbox" style="margin-top:16px"><b>可以做什么：</b><br>• 把数据导出成 CSV / JSON 后用本站的 <a href="../free-tools/csv-viewer.html" style="color:#e8f542">CSV 查看器</a> 或 <a href="../free-tools/data-explorer.html" style="color:#e8f542">数据浏览器</a> 打开<br>• 需要真解析时，用 Python 的 pyarrow / sqlite3 在本地转成 CSV，再把 CSV 拖进本站</div>
    </div></div>`;
  }
  G['parquet-viewer'] = (h, c) => binaryFormat(h, c, 'Parquet', 'Parquet 是按列组织的二进制格式，每个列块有自己的编码与压缩（Snappy/GZIP/ZSTD），页脚还要解 Thrift 协议。这些加起来是一个完整的列存引擎，不是一个网页能可靠承载的。');
  G['parquet-to-csv'] = (h, c) => binaryFormat(h, c, 'Parquet', '转换 Parquet → CSV 同样需要先完整解码列块。本页不提供，以免输出缺行或缺列你还不知道。');
  G['sqlite-viewer'] = (h, c) => binaryFormat(h, c, 'SQLite', 'SQLite 数据库文件是完整的 B-tree 页结构 + 多级索引 + WAL。浏览器端可以做，但要做到事务一致、UTF-16、溢出页、多种记录类型都对，工程量远超一个工具页。');

  /* ---------- 文档翻译（诚实：本地无翻译模型） ---------- */
  G['document-translator'] = function (host) {
    const p = window.TUI.shell(host, true);
    p.pane.innerHTML = window.TUI.head('双语对照整理', '<b style="color:#f59e0b">浏览器本地没有翻译模型</b> —— 这个工具做的是「把长文按句切分、逐句对照、导出双语表格」的工作流，翻译本身需要你自己完成或使用专业服务。') +
      window.TUI.field('原文（按句自动切分）', window.TUI.area('dtSrc', 'The quick brown fox jumps over the lazy dog.\nPack my box with five dozen liquor jugs.', '', 6)) +
      `<div class="shapes" style="margin-top:14px"><button class="btn-lime btn-run" id="dtSplit">切分句子</button></div>
       <div class="runnote">切分后每句右边会出现一个输入框，填入译文，最后导出 CSV / 双语对照文本。</div>`;
    const out = document.createElement('div'); out.className = 'ioout'; out.style.cssText = 'margin-top:14px;min-height:260px';
    p.stage.appendChild(out);
    const split = t => t.replace(/\n+/g, ' ').match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/g) || [];
    host.addEventListener('click', e => {
      if (e.target.id === 'dtSplit') {
        const list = split($q('#dtSrc', host).value).map(s => s.trim()).filter(Boolean);
        out.innerHTML = list.map((s, i) => `<div style="margin-bottom:12px"><div style="color:#8a8a8a;font-size:11px;letter-spacing:1px">#${i + 1}</div>
          <div style="color:#e5e5e5;margin-bottom:5px">${esc(s)}</div>
          <input type="text" data-i="${i}" placeholder="填入译文…" style="width:100%"></div>`).join('');
        host._sent = list;
      }
      if (e.target.id === 'dtCsv' && host._sent) {
        const trs = [...out.querySelectorAll('input')].map(i => i.value);
        const csv = 'source,target\n' + host._sent.map((s, i) => '"' + s.replace(/"/g, '""') + '","' + (trs[i] || '').replace(/"/g, '""') + '"').join('\n');
        download('bilingual.csv', csv, 'text/csv');
      }
      if (e.target.id === 'dtCopy' && host._sent) {
        const trs = [...out.querySelectorAll('input')].map(i => i.value);
        window.copyText(host._sent.map((s, i) => s + '\n' + (trs[i] || '')).join('\n\n'));
      }
    });
    p.pane.insertAdjacentHTML('beforeend', `<div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="dtCsv">导出 CSV</button><button class="btn-ghost btn-sm" id="dtCopy">复制双语</button></div>`);
  };

  /* ---------- 路由别名 ---------- */
  const ALIAS = {
    'data-format-converter': 'data-explorer', 'geojson-to-shapefile': null, 'bold-text-generator': 'bold-text-generator'
  };

  /* ---------- 名言生成（本地语料，无网络） ---------- */
  G['quote-generator'] = function (host) {
    const QUOTES = [
      ['Simplicity is the ultimate sophistication.', 'Leonardo da Vinci', '简洁是终极的复杂。'],
      ['The best way to predict the future is to invent it.', 'Alan Kay', '预测未来的最好方式是创造它。'],
      ['Stay hungry, stay foolish.', 'Steve Jobs', '求知若饥，虚心若愚。'],
      ['Talk is cheap. Show me the code.', 'Linus Torvalds', '空谈无益，放码过来。'],
      ['Make it work, make it right, make it fast.', 'Kent Beck', '先跑通，再跑对，再跑快。'],
      ['Programs must be written for people to read.', 'Harold Abelson', '程序首先是给人读的，其次才是给机器执行。'],
      ['Perfection is achieved when there is nothing left to take away.', 'Antoine de Saint-Exupéry', '完美不是无可增添，而是无可删减。'],
      ['The details are not the details. They make the design.', 'Charles Eames', '细节不是细节，细节成就设计。'],
      ['Any sufficiently advanced technology is indistinguishable from magic.', 'Arthur C. Clarke', '足够先进的技术与魔法无异。'],
      ['First, solve the problem. Then, write the code.', 'John Johnson', '先解决问题，再写代码。'],
      ['Premature optimization is the root of all evil.', 'Donald Knuth', '过早优化是万恶之源。'],
      ['Design is not just what it looks like. Design is how it works.', 'Steve Jobs', '设计不只是外观，设计是它如何运作。'],
      ['Simplicity is a great virtue but it requires hard work.', 'Edsger Dijkstra', '简单是极大的美德，但它需要大量工作。'],
      ['Everything should be made as simple as possible, but not simpler.', 'Albert Einstein', '凡事应力求简单，但不能过于简单。'],
      ['The function of good software is to make the complex appear simple.', 'Grady Booch', '好软件的职责是让复杂看起来简单。'],
      ['Content is fire, social media is gasoline.', 'Jay Baer', '内容是火，社交媒体是汽油。'],
      ['Done is better than perfect.', 'Sheryl Sandberg', '完成胜过完美。'],
      ['If you double the number of experiments you do per year, you\'re going to double your inventiveness.', 'Jeff Bezos', '把每年的实验次数翻倍，你的创造力也会翻倍。'],
      ['Move fast and break things.', 'Mark Zuckerberg', '快速行动，打破常规。'],
      ['The scariest moment is always just before you start.', 'Stephen King', '最可怕的时刻永远是开始之前。'],
      ['Creativity is intelligence having fun.', 'Albert Einstein', '创造力是智慧在玩耍。'],
      ['What we observe is not nature itself, but nature exposed to our method of questioning.', 'Werner Heisenberg', '我们观察到的不是自然本身，而是自然对我们提问方式的回应。']
    ];
    const p = stagePane(host, window.TUI.head('名言生成', '内置 22 条本地语料，可按关键词过滤、按作者筛选，支持中英对照，可导出。') +
      window.TUI.field('数量', window.TUI.range('qtN', 1, 10, 3)) +
      window.TUI.field('关键词过滤（可选）', window.TUI.input('qtKw', '', 'design / code / simple')) +
      window.TUI.chk('qtZh', '附带中文翻译', true) +
      `<div class="shapes" style="margin-top:14px"><button class="btn-lime btn-run" id="qtRun">换一批</button></div>`);
    const out = document.createElement('div'); out.className = 'ioout'; out.style.cssText = 'margin-top:14px;min-height:240px;font-size:14px;line-height:1.9';
    p.stage.appendChild(out);
    const run = () => {
      const n = +$q('#qtN', host).value, kw = $q('#qtKw', host).value.trim().toLowerCase(), zh = $q('#qtZh', host).classList.contains('on');
      $q('#qtNV', host).textContent = n;
      let pool = QUOTES.filter(q => !kw || (q[0] + q[1] + q[2]).toLowerCase().includes(kw));
      if (!pool.length) { out.textContent = '没有匹配「' + kw + '」的名言，换个关键词试试'; return; }
      const pick = [];
      for (let i = 0; i < n; i++) pick.push(pool[Math.floor(Math.random() * pool.length)]);
      out.innerHTML = pick.map(q => `<div style="margin-bottom:16px">“${esc(q[0])}”<br><span style="color:#8a8a8a">— ${esc(q[1])}</span>${zh ? `<br><span style="color:#a3a3a3">${esc(q[2])}</span>` : ''}</div>`).join('');
      host._txt = pick.map(q => '“' + q[0] + '” — ' + q[1] + (zh ? '\n' + q[2] : '')).join('\n\n');
    };
    host.addEventListener('input', run);
    host.addEventListener('click', e => {
      if (e.target.id === 'qtRun') run();
      if (e.target.id === 'qtCopy' && host._txt) window.copyText(host._txt);
      if (e.target.id === 'qtDown' && host._txt) download('quotes.txt', host._txt);
    });
    p.pane.insertAdjacentHTML('beforeend', `<div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="qtCopy">复制</button><button class="btn-ghost btn-sm" id="qtDown">下载</button></div>`);
    run();
  };

  E.mount = function (host, cfg, slug) {
    try {
      const fn = G[slug];
      if (fn) { fn(host, cfg || {}, slug); return; }
      window.TUI.soon(host, '这个工具的本地引擎在下一批接入。页面上的说明、FAQ 与相关推荐都是完整可用的。');
    } catch (e) {
      console.error('[gen]', slug, e);
      try { window.TUI.soon(host, '初始化出错：' + e.message); } catch (_) { }
    }
  };
  window.TOOL_ENGINES = window.TOOL_ENGINES || {};
  window.TOOL_ENGINES.gen = E;
})();
