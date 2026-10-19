/* ==========================================================================
   engine-image.js — 图像引擎（全本地 canvas 处理）
   覆盖：格式转换 / 压缩 / 缩放 / 裁剪 / 旋转翻转 / 滤镜 / 水印 / 拼图 /
        像素化 / 去元数据 / 转 base64 / ICO 生成 / 圆形头像 / 证件照 / 调色
   ========================================================================== */
(function () {
  'use strict';
  const E = {};
  window.TOOL_ENGINES = window.TOOL_ENGINES || {};

  /* ---------- 基础工具 ---------- */
  function loadImg(src) {
    return new Promise((res, rej) => {
      if (src instanceof Blob) {
        const url = URL.createObjectURL(src);
        const im = new Image();
        im.onload = () => res(im); im.onerror = () => rej(new Error('无法读取该图片'));
        im.src = url;
      } else {
        const im = new Image(); im.crossOrigin = 'anonymous';
        im.onload = () => res(im); im.onerror = () => rej(new Error('无法加载图片')); im.src = src;
      }
    });
  }
  function canvasOf(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
  function exportBlob(canvas, fmt, quality) {
    return new Promise(res => {
      const mime = fmt === 'jpg' ? 'image/jpeg' : 'image/' + fmt;
      canvas.toBlob(b => res(b), mime, quality);
    });
  }
  function fmtLabel(f) { return { jpg: 'JPG', jpeg: 'JPG', png: 'PNG', webp: 'WebP', avif: 'AVIF', bmp: 'BMP', ico: 'ICO' }[f] || f.toUpperCase(); }

  /* BMP 编码（24 位无压缩） */
  function encodeBMP(canvas) {
    const ctx = canvas.getContext('2d');
    const { width: w, height: h } = canvas;
    const img = ctx.getImageData(0, 0, w, h).data;
    const rowSize = Math.floor((24 * w + 31) / 32) * 4;
    const dataSize = rowSize * h;
    const buf = new ArrayBuffer(54 + dataSize);
    const dv = new DataView(buf);
    dv.setUint16(0, 0x424D, false); dv.setUint32(2, 54 + dataSize, true); dv.setUint32(10, 54, true);
    dv.setUint32(14, 40, true); dv.setInt32(18, w, true); dv.setInt32(22, h, true);
    dv.setUint16(26, 1, true); dv.setUint16(28, 24, true); dv.setUint32(34, dataSize, true);
    let off = 54;
    for (let y = h - 1; y >= 0; y--) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        dv.setUint8(off++, img[i + 2]); dv.setUint8(off++, img[i + 1]); dv.setUint8(off++, img[i]);
      }
      for (let p = w * 3; p < rowSize; p++) dv.setUint8(off++, 0);
    }
    return new Blob([buf], { type: 'image/bmp' });
  }
  /* ICO 编码（内嵌 PNG，多尺寸） */
  async function encodeICO(canvas, sizes) {
    const pngs = [];
    for (const s of sizes) {
      const c = canvasOf(s, s);
      const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
      const scale = Math.min(s / canvas.width, s / canvas.height);
      const w = canvas.width * scale, h = canvas.height * scale;
      ctx.drawImage(canvas, (s - w) / 2, (s - h) / 2, w, h);
      pngs.push(new Uint8Array(await (await exportBlob(c, 'png')).arrayBuffer()));
    }
    const header = 6 + 16 * pngs.length;
    const total = header + pngs.reduce((a, p) => a + p.length, 0);
    const buf = new ArrayBuffer(total); const dv = new DataView(buf); const u8 = new Uint8Array(buf);
    dv.setUint16(0, 0, true); dv.setUint16(2, 1, true); dv.setUint16(4, pngs.length, true);
    let off = 6, dataOff = header;
    pngs.forEach((p, i) => {
      const s = sizes[i];
      dv.setUint8(off, s >= 256 ? 0 : s); dv.setUint8(off + 1, s >= 256 ? 0 : s);
      dv.setUint8(off + 2, 0); dv.setUint8(off + 3, 0);
      dv.setUint16(off + 4, 1, true); dv.setUint16(off + 6, 32, true);
      dv.setUint32(off + 8, p.length, true); dv.setUint32(off + 12, dataOff, true);
      u8.set(p, dataOff); off += 16; dataOff += p.length;
    });
    return new Blob([buf], { type: 'image/x-icon' });
  }

  /* 滤镜（用 canvas filter 或像素处理） */
  const FILTERS = {
    grayscale: { css: 'grayscale(1)', label: '灰度' },
    sepia: { css: 'sepia(0.85)', label: '棕褐色' },
    invert: { css: 'invert(1)', label: '反色' },
    blur: { css: 'blur(6px)', label: '背景模糊' },
    sharpen: { px: 'sharpen', label: '锐化' },
    sketch: { px: 'sketch', label: '铅笔素描' },
    cartoon: { px: 'cartoon', label: '卡通' },
    vintage: { css: 'sepia(.4) contrast(1.15) saturate(.85)', label: '复古' },
    'black-and-white': { px: 'bw', label: '黑白' },
    posterize: { px: 'posterize', label: '色调分离' },
    pixelate: { px: 'pixelate', label: '像素画' },
    warm: { css: 'saturate(1.2) hue-rotate(-8deg) brightness(1.05)', label: '暖色调' },
    cool: { css: 'saturate(1.1) hue-rotate(12deg) brightness(1.02)', label: '冷色调' },
    smooth: { css: 'blur(1.2px) saturate(1.05)', label: '磨皮' }
  };

  function pixelOp(ctx, w, h, op, amount) {
    const id = ctx.getImageData(0, 0, w, h); const d = id.data;
    const A = amount == null ? 1 : amount;
    if (op === 'sharpen') {
      const src = new Uint8ClampedArray(d);
      const k = [0, -1, 0, -1, 5, -1, 0, -1, 0];
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) {
          let s = 0, ki = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { s += src[((y + dy) * w + (x + dx)) * 4 + c] * k[ki++]; }
          d[i + c] = Math.max(0, Math.min(255, s));
        }
      }
    } else if (op === 'bw') {
      for (let i = 0; i < d.length; i += 4) { const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; const v = g > 128 ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = v; }
    } else if (op === 'posterize') {
      const lv = 5;
      for (let i = 0; i < d.length; i += 4) { for (let c = 0; c < 3; c++) d[i + c] = Math.round(d[i + c] / 255 * (lv - 1)) / (lv - 1) * 255; }
    } else if (op === 'cartoon') {
      for (let i = 0; i < d.length; i += 4) { for (let c = 0; c < 3; c++) d[i + c] = Math.round(d[i + c] / 255 * 4) / 4 * 255; d[i] = Math.min(255, d[i] * 1.06); }
    } else if (op === 'sketch') {
      for (let i = 0; i < d.length; i += 4) { const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; const inv = 255 - g; const v = inv > 190 ? 255 : Math.min(255, inv * 1.35); d[i] = d[i + 1] = d[i + 2] = v; }
    }
    ctx.putImageData(id, 0, 0);
  }

  /* ---------- 面板定义 ---------- */
  function paneFor(mode, cfg, S) {
    const P = [];
    const push = h => P.push(h);
    switch (mode) {
      case 'convert':
        push(`<div class="ptitle">输出格式</div><div class="pdesc">在浏览器中转换图片，不会上传任何内容。</div>
          <select id="imgFmt">${(cfg.targets || ['jpg', 'png', 'webp', 'avif', 'bmp']).map((f, i) => `<option value="${f}">${fmtLabel(f)}</option>`).join('')}</select>
          <div id="qWrap"><div class="plabel">质量</div><input type="range" id="imgQ" min="40" max="100" value="92"><div class="selnote" id="imgQV">92%</div></div>`);
        break;
      case 'compress':
        push(`<div class="ptitle">压缩</div><div class="pdesc">文件更小，像素不变。调整质量并观察大小变化。</div>
          <div class="plabel" style="margin-top:0">质量</div><input type="range" id="imgQ" min="20" max="100" value="75"><div class="selnote" id="imgQV">75%</div>
          <div class="seg" style="margin-top:14px"><button id="imgKeep" class="on">保持尺寸</button><button id="imgResizeMode">调整尺寸</button></div>
          <div id="resizeBox" class="hide"><div class="plabel" style="margin-top:0">最大宽度</div><select id="imgMaxW"><option value="0">原始尺寸</option><option value="1920">1920 px</option><option value="1280">1280 px</option><option value="800">800 px</option></select></div>`);
        break;
      case 'resize':
        push(`<div class="ptitle">调整尺寸</div><div class="pdesc">设置新尺寸。锁定比例可避免拉伸。</div>
          <div class="fieldrow"><div class="fld"><div class="plabel" style="margin-top:0">宽</div><input type="number" id="imgW"></div>
          <div class="fld"><div class="plabel" style="margin-top:0">高</div><input type="number" id="imgH"></div></div>
          <div class="chk on" id="imgLock"><span class="box">✓</span> 保持宽高比</div>
          <div class="plabel">预设</div><div class="shapes" id="imgPresets">${(cfg.presets || [[1920, 1080], [1280, 720], [1080, 1080], [1080, 1350], [800, 800]]).map(p => `<button class="shape" data-w="${p[0]}" data-h="${p[1]}">${p[0]}×${p[1]}</button>`).join('')}</div>`);
        break;
      case 'rotate':
        push(`<div class="ptitle">旋转与翻转</div><div class="pdesc">旋转或镜像图片。</div>
          <div class="shapes" id="imgRot"><button class="shape" data-r="90">↻ 90°</button><button class="shape" data-r="180">↻ 180°</button><button class="shape" data-r="270">↻ 270°</button><button class="shape" data-r="hflip">⇋ 翻转</button><button class="shape" data-r="vflip">⇅ 镜像</button></div>`);
        break;
      case 'watermark':
        push(`<div class="ptitle">水印</div><div class="pdesc">添加文字或自定义 logo，在本地绘制到图片上。</div>
          <div class="seg"><button id="wmText" class="on">文字</button><button id="wmLogo">Logo</button></div>
          <div id="wmTextBox"><div class="plabel" style="margin-top:0">文字</div><input type="text" id="wmT" value="${cfg.defaultText || '© 你的品牌'}">
          <div class="plabel">大小</div><input type="range" id="wmSize" min="12" max="160" value="${cfg.size || 42}">
          <div class="plabel">不透明度</div><input type="range" id="wmOp" min="10" max="100" value="65">
          <div class="plabel">颜色</div><input type="text" id="wmColor" value="#ffffff"></div>
          <div id="wmLogoBox" class="hide"><div class="drop-mini" id="wmDrop">选择 logo（推荐透明背景 PNG）</div><input type="file" id="wmFile" accept="image/*" hidden>
          <div class="plabel">缩放</div><input type="range" id="wmScale" min="5" max="60" value="18"></div>
          <div class="plabel">位置</div><select id="wmPos"><option>bottom-right</option><option>bottom-left</option><option>top-right</option><option>top-left</option><option>center</option><option>tiled</option></select>`);
        break;
      case 'filter':
        push(`<div class="ptitle">${FILTERS[cfg.filter]?.label || '滤镜'}</div><div class="pdesc">本地应用，实时预览。</div>
          <div class="plabel" style="margin-top:0">强度</div><input type="range" id="fxAmt" min="0" max="100" value="${cfg.amount ?? 100}">
          <div class="plabel">输出格式</div><select id="imgFmt"><option value="png">PNG</option><option value="jpg">JPG</option><option value="webp">WebP</option></select>`);
        break;
      case 'pixelate':
        push(`<div class="ptitle">像素大小</div><div class="pdesc">块越大，像素风越明显。</div>
          <div class="plabel" style="margin-top:0">块大小</div><input type="range" id="pxBlock" min="2" max="48" value="10">
          <div class="plabel">颜色数</div><select id="pxColors"><option value="0">保留全部颜色</option><option value="32">32 色</option><option value="16">16 色</option><option value="8">8 色</option></select>`);
        break;
      case 'adjust':
        push(`<div class="ptitle">调整</div><div class="pdesc">亮度、对比度、饱和度与色温。</div>
          ${[['亮度', 'adBr', 100, 0, 200], ['对比度', 'adCt', 100, 0, 200], ['饱和度', 'adSa', 100, 0, 300], ['色温', 'adHu', 0, -60, 60]].map(x => `<div class="plabel" style="margin-top:0">${x[0]}</div><input type="range" id="${x[1]}" min="${x[3]}" max="${x[4]}" value="${x[2]}">`).join('')}
          <div class="linkbtn" id="adReset">全部重置</div>`);
        break;
      case 'crop':
        push(`<div class="ptitle">裁剪</div><div class="pdesc">拖动选框，或选择比例。</div>
          <div class="shapes" id="imgShapes">${['free', '1/1', '4/5', '9/16', '16/9', '3/4'].map((r, i) => `<button class="shape ${i === 0 ? 'on' : ''}" data-r="${r}">${r === 'free' ? '自由' : r.replace('/', ':')}</button>`).join('')}</div>
          <div class="selnote" id="imgCropSel">—</div>`);
        break;
      case 'tobase64':
        push(`<div class="ptitle">内嵌</div><div class="pdesc">生成可粘贴到 HTML 或 CSS 的 data URI。</div>
          <select id="b64Fmt"><option value="jpeg">JPG（更小）</option><option value="png">PNG（无损）</option><option value="webp">WebP</option></select>
          <div class="plabel">最大宽度</div><select id="b64W"><option value="0">原始尺寸</option><option value="1200">1200 px</option><option value="800">800 px</option><option value="400">400 px</option></select>`);
        break;
      case 'frombase64':
        push(`<div class="ptitle">Data URI</div><div class="pdesc">粘贴 data:image/... 字符串，还原图片。</div>
          <textarea id="b64In" placeholder="data:image/png;base64,iVBORw0KGgo..." style="min-height:180px"></textarea>`);
        break;
      case 'ico':
        push(`<div class="ptitle">图标尺寸</div><div class="pdesc">单个 .ico 内含多种尺寸，可直接用作 favicon。</div>
          <div class="chk on" data-sz="16"><span class="box">✓</span> 16 × 16</div>
          <div class="chk on" data-sz="32"><span class="box">✓</span> 32 × 32</div>
          <div class="chk on" data-sz="48"><span class="box">✓</span> 48 × 48</div>
          <div class="chk on" data-sz="64"><span class="box">✓</span> 64 × 64</div>
          <div class="chk on" data-sz="128"><span class="box">✓</span> 128 × 128</div>
          <div class="chk" data-sz="256"><span class="box">✓</span> 256 × 256</div>`);
        break;
      case 'collage':
        push(`<div class="ptitle">布局</div><div class="pdesc">添加两张及以上图片，将排列成网格。</div>
          <div class="plabel" style="margin-top:0">列数</div><select id="colCols"><option value="2">2 列</option><option value="3">3 列</option><option value="4">4 列</option></select>
          <div class="plabel">间距</div><input type="range" id="colGap" min="0" max="40" value="8">
          <div class="plabel">背景</div><input type="text" id="colBg" value="#ffffff">
          <div class="plabel">单元格尺寸</div><select id="colCell"><option value="600">600 px</option><option value="400">400 px</option><option value="900">900 px</option></select>`);
        break;
      case 'avatar':
        push(`<div class="ptitle">圆形头像</div><div class="pdesc">裁剪为正方形并切出圆形。</div>
          <div class="plabel" style="margin-top:0">尺寸</div><select id="avSize"><option value="512">512 px</option><option value="400">400 px</option><option value="256">256 px</option><option value="128">128 px</option></select>
          <div class="plabel">背景</div><input type="text" id="avBg" value="#ffffff">
          <div class="chk on" id="avRing"><span class="box">✓</span> 添加细边框</div>`);
        break;
      case 'photo':
        push(`<div class="ptitle">证件照设置</div><div class="pdesc">${cfg.paneDesc || '排版并导出可直接打印的证件照。'}</div>
          <div class="plabel" style="margin-top:0">尺寸</div><select id="phSize">${(cfg.sizes || [['35×45 mm · 证件照', 35, 45], ['2×2 英寸 · 美签', 51, 51], ['35×35 mm', 35, 35], ['50×70 mm', 50, 70]]).map(s => `<option value="${s[1]}x${s[2]}">${s[0]}</option>`).join('')}</select>
          <div class="plabel">背景</div><input type="text" id="phBg" value="#ffffff">
          <div class="plabel">打印排版</div><select id="phSheet"><option value="0">单张照片</option><option value="1">4×6 打印纸多张排版</option></select>`);
        break;
      case 'blank':
        push(`<div class="ptitle">画布</div><div class="pdesc">生成纯色或透明背景图片。</div>
          <div class="fieldrow"><div class="fld"><div class="plabel" style="margin-top:0">宽度</div><input type="number" id="bk.W" value="${cfg.w || 1080}"></div>
          <div class="fld"><div class="plabel" style="margin-top:0">高度</div><input type="number" id="bkH" value="${cfg.h || 1080}"></div></div>
          <div class="plabel">背景</div><input type="text" id="bkBg" value="${cfg.bg || '#ffffff'}">
          <div class="chk" id="bkTrans"><span class="box">✓</span> 透明背景</div>`);
        break;
      default:
        push(`<div class="ptitle">${cfg.paneTitle || '图片处理'}</div><div class="pdesc">${cfg.paneDesc || '在本地处理图片。'}</div>`);
    }
    push(`<div class="outbox" id="imgOut">输出：—</div>
      <button class="btn-lime btn-run" id="imgGo">${cfg.runLabel || '下载'}</button>
      <div class="warnbox hide" id="imgWarn"></div>
      <div class="runnote">在浏览器中处理，图片不会上传。</div>`);
    return P.join('');
  }

  /* ---------- 主挂载 ---------- */
  E.mount = function (host, cfg, slug) {
    const mode = cfg.mode || 'convert';
    const multi = mode === 'collage';
    host.innerHTML = `
      <div class="tool-body wide">
        <div class="stage">
          <div class="drop" id="imgDrop">
            <div class="ic">${window.icon('image', 30)}</div>
            <h3>${cfg.dropTitle || '选择一张图片'}</h3>
            <p>拖放图片到此处、直接粘贴，或点击选择</p>
            <button class="btn-lime" id="imgPick">${window.icon('image', 16)} ${cfg.pickLabel || '选择图片'} <span>→</span></button>
            <div class="fmts">${cfg.formats || '<b>JPG、PNG、WebP、AVIF、BMP、GIF、SVG</b> · 最大 <b>50 MB</b>'}</div>
          </div>
          <input type="file" id="imgFile" accept="image/*,.heic,.avif" hidden ${multi ? 'multiple' : ''}>
          <div id="imgLoaded" class="hide" style="flex:1;flex-direction:column">
            <div class="canvaswrap" id="imgWrap" style="position:relative">
              <canvas id="imgCanvas"></canvas>
              <div class="cropwrap hide" id="imgCropWrap" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">
                <img id="imgGhost" style="display:none">
                <div class="cropbox" id="imgCropBox" style="position:absolute"><div class="grid3"></div><i class="c c-tl"></i><i class="c c-tr"></i><i class="c c-bl"></i><i class="c c-br"></i></div>
              </div>
            </div>
            <div class="filebar"><span><b id="imgName"></b>&nbsp;&nbsp;<span id="imgMeta"></span></span><span class="newv" id="imgNew">New image</span></div>
          </div>
        </div>
        <div class="pane" id="imgPane">${paneFor(mode, cfg, {})}</div>
      </div>`;

    const $ = s => host.querySelector(s);
    const q = id => { const e = $('#' + id); return e ? e.value : null; };
    const S = { file: null, img: null, canvas: null, fmt: (cfg.targets || ['jpg'])[0], q: 92, rot: 0, flipH: false, flipV: false, files: [], logos: null, shape: 'free' };

    function metaTxt() { return `${S.img.naturalWidth} × ${S.img.naturalHeight}`; }

    async function load(files) {
      const f = files[0]; if (!f) return;
      if (!/^image\//.test(f.type) && !/\.(png|jpe?g|webp|avif|bmp|gif|svg)$/i.test(f.name)) { window.toast('That is not an image'); return; }
      try { S.img = await loadImg(f); } catch (e) { window.toast(e.message); return; }
      S.file = f;
      if (multi) { S.files = [...files]; }
      $('#imgDrop').classList.add('hide'); $('#imgLoaded').classList.remove('hide');
      $('#imgName').textContent = f.name;
      $('#imgMeta').textContent = `${metaTxt()} · ${window.fmtSize(f.size)}`;
      if (mode === 'resize' && $('#imgW')) { $('#imgW').value = S.img.naturalWidth; $('#imgH').value = S.img.naturalHeight; }
      if (mode === 'crop') initCrop();
      render();
    }
    window.bindFileInput($('#imgDrop'), $('#imgFile'), 'image/*', load);
    $('#imgPick').addEventListener('click', e => { e.stopPropagation(); $('#imgFile').click(); });
    $('#imgNew').addEventListener('click', () => {
      S.file = null; S.img = null;
      $('#imgLoaded').classList.add('hide'); $('#imgDrop').classList.remove('hide');
    });
    window.addEventListener('paste', e => {
      const f = [...(e.clipboardData?.files || [])].find(x => x.type.startsWith('image'));
      if (f) load([f]);
    });

    /* ---- 渲染 ---- */
    async function render() {
      if (!S.img) return;
      let w = S.img.naturalWidth, h = S.img.naturalHeight;
      let c = canvasOf(w, h), ctx = c.getContext('2d');

      // 基础绘制 + 旋转/翻转
      ctx.save();
      if (S.rot === 90 || S.rot === 270) { c = canvasOf(h, w); ctx = c.getContext('2d'); }
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate(S.rot * Math.PI / 180);
      ctx.scale(S.flipH ? -1 : 1, S.flipV ? -1 : 1);
      ctx.drawImage(S.img, -w / 2, -h / 2);
      ctx.restore();

      if (mode === 'resize') {
        const tw = Math.max(1, +q('imgW') || w), th = Math.max(1, +q('imgH') || h);
        const c2 = canvasOf(tw, th);
        const cx = c2.getContext('2d'); cx.imageSmoothingQuality = 'high';
        cx.drawImage(c, 0, 0, tw, th); c = c2;
      }
      if (mode === 'filter' || mode === 'adjust') {
        const amt = mode === 'filter' ? (+(q('fxAmt') ?? 100)) / 100 : 1;
        const f = FILTERS[cfg.filter];
        if (mode === 'adjust') {
          const br = +(q('adBr') ?? 100), ct = +(q('adCt') ?? 100), sa = +(q('adSa') ?? 100), hu = +(q('adHu') ?? 0);
          const ctx2 = c.getContext('2d');
          const c2 = canvasOf(c.width, c.height), cx = c2.getContext('2d');
          cx.filter = `brightness(${br}%) contrast(${ct}%) saturate(${sa}%) hue-rotate(${hu}deg)`;
          cx.drawImage(c, 0, 0); c = c2;
        } else if (f) {
          if (f.px) pixelOp(c.getContext('2d'), c.width, c.height, f.px, amt);
          else {
            const c2 = canvasOf(c.width, c.height), cx = c2.getContext('2d');
            const m = f.css.match(/blur\(([\d.]+)px\)/);
            let css = f.css;
            if (m) css = f.css.replace(/blur\([\d.]+px\)/, `blur(${(+m[1] * amt).toFixed(1)}px)`);
            cx.filter = css; cx.drawImage(c, 0, 0); c = c2;
          }
        }
      }
      if (mode === 'pixelate') {
        const blk = +(q('pxBlock') ?? 10);
        const small = canvasOf(Math.max(1, Math.round(c.width / blk)), Math.max(1, Math.round(c.height / blk)));
        const sx = small.getContext('2d'); sx.imageSmoothingEnabled = false;
        sx.drawImage(c, 0, 0, small.width, small.height);
        const c2 = canvasOf(c.width, c.height), cx = c2.getContext('2d');
        cx.imageSmoothingEnabled = false;
        cx.drawImage(small, 0, 0, c.width, c.height);
        c = c2;
        const cols = +q('pxColors');
        if (cols) quantize(c, cols);
      }
      if (mode === 'avatar') {
        const sz = +q('avSize'); const bg = q('avBg') || '#ffffff';
        const s = Math.min(c.width, c.height);
        const c2 = canvasOf(sz, sz), cx = c2.getContext('2d');
        cx.fillStyle = bg; cx.fillRect(0, 0, sz, sz);
        cx.save(); cx.beginPath(); cx.arc(sz / 2, sz / 2, sz / 2, 0, Math.PI * 2); cx.closePath(); cx.clip();
        cx.drawImage(c, (c.width - s) / 2, (c.height - s) / 2, s, s, 0, 0, sz, sz); cx.restore();
        if ($('#avRing')?.classList.contains('on')) { cx.strokeStyle = 'rgba(0,0,0,.12)'; cx.lineWidth = Math.max(2, sz / 90); cx.beginPath(); cx.arc(sz / 2, sz / 2, sz / 2 - cx.lineWidth / 2, 0, Math.PI * 2); cx.stroke(); }
        c = c2;
      }
      if (mode === 'watermark') renderWatermark(c);
      if (mode === 'photo') c = renderPhoto(c);
      if (mode === 'blank') {
        const bw = Math.max(1, +q('bk.W') || 1080), bh = Math.max(1, +q('bkH') || 1080);
        const c2 = canvasOf(bw, bh), cx = c2.getContext('2d');
        if (!$('#bkTrans')?.classList.contains('on')) { cx.fillStyle = q('bkBg') || '#fff'; cx.fillRect(0, 0, bw, bh); }
        c = c2;
      }
      if (mode === 'collage') c = await renderCollage(c);
      if (mode === 'frombase64') return;

      S.canvas = c;
      const cv = $('#imgCanvas');
      cv.width = c.width; cv.height = c.height;
      cv.style.maxWidth = '100%'; cv.style.maxHeight = '480px'; cv.style.width = 'auto';
      cv.getContext('2d').drawImage(c, 0, 0);
      // 输出信息
      const fmt = (mode === 'convert' || mode === 'filter' || mode === 'pixelate' || mode === 'compress') ? (q('imgFmt') || S.fmt) : 'png';
      const qq = (+(q('imgQ') ?? S.q)) / 100;
      const est = await estimate(c, fmt, qq);
      const name = outName(fmt);
      $('#imgOut').innerHTML = `Output: <b>${fmtLabel(fmt)}</b> · ${c.width} × ${c.height} · about <b>${window.fmtSize(est)}</b>`;
      $('#imgGo').dataset.fmt = fmt; $('#imgGo').dataset.q = qq; $('#imgGo').dataset.name = name;
      if (mode === 'crop') $('#imgCropSel').textContent = `Output: ${c.width} × ${c.height}`;
    }
    function quantize(c, n) {
      const ctx = c.getContext('2d'); const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const step = 255 / (n - 1);
      for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) d[i + k] = Math.round(Math.round(d[i + k] / step) * step);
      ctx.putImageData(ctx.getImageData(0, 0, c.width, c.height), 0, 0);
      ctx.putImageData(new ImageData(new Uint8ClampedArray(d), c.width, c.height), 0, 0);
    }
    function outName(fmt) {
      const base = (S.file?.name || 'image').replace(/\.[^.]+$/, '');
      const suffix = { convert: '', compress: '-compressed', resize: '-' + (q('imgW') || 'resized') + 'w', rotate: '-rotated', watermark: '-watermarked', filter: '-' + (cfg.filter || 'filter'), pixelate: '-pixel-art', adjust: '-edited', crop: '-cropped', tobase64: '-base64', ico: '-icon', avatar: '-avatar', photo: '-photo', blank: '-blank', collage: '-collage' }[mode] ?? '';
      return base + suffix + '.' + fmt;
    }
    async function estimate(c, fmt, qq) {
      try { const b = await exportBlob(c, fmt, qq); return b ? b.size : 0; } catch (e) { return 0; }
    }

    function renderWatermark(c) {
      const ctx = c.getContext('2d');
      const pos = q('wmPos') || 'bottom-right';
      const isText = $('#wmText')?.classList.contains('on') !== false;
      const pad = Math.round(c.width * 0.025);
      if (isText) {
        const txt = q('wmT') || '';
        const size = +(q('wmSize') || 42) * (c.width / 1000);
        const op = (+(q('wmOp') || 65)) / 100;
        const col = q('wmColor') || '#ffffff';
        ctx.save();
        ctx.font = `700 ${size}px Inter, sans-serif`;
        ctx.fillStyle = col; ctx.globalAlpha = op;
        ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = size / 6;
        if (pos === 'tiled') {
          ctx.globalAlpha = op * 0.5;
          for (let y = 0; y < c.height; y += size * 4) for (let x = -c.width; x < c.width * 2; x += ctx.measureText(txt).width + size * 2) {
            ctx.save(); ctx.translate(x, y); ctx.rotate(-Math.PI / 8); ctx.fillText(txt, 0, 0); ctx.restore();
          }
        } else {
          const tw = ctx.measureText(txt).width;
          let x = pad, y = c.height - pad;
          if (pos.includes('right')) x = c.width - tw - pad;
          if (pos.includes('top')) y = pad + size;
          if (pos === 'center') { x = (c.width - tw) / 2; y = c.height / 2; }
          ctx.fillText(txt, x, y);
        }
        ctx.restore();
      } else if (S.logos) {
        const sc = (+(q('wmScale') || 18)) / 100;
        const lw = c.width * sc, lh = S.logos.height * lw / S.logos.width;
        const op = (+(q('wmOp') || 65)) / 100;
        let x = c.width - lw - pad, y = c.height - lh - pad;
        if (pos.includes('left')) x = pad;
        if (pos.includes('top')) y = pad;
        if (pos === 'center') { x = (c.width - lw) / 2; y = (c.height - lh) / 2; }
        if (pos === 'tiled') {
          ctx.globalAlpha = op * 0.5;
          for (let yy = pad; yy < c.height; yy += lh * 2.2) for (let xx = pad; xx < c.width; xx += lw * 2.2) ctx.drawImage(S.logos, xx, yy, lw, lh);
        } else { ctx.globalAlpha = op; ctx.drawImage(S.logos, x, y, lw, lh); }
        ctx.globalAlpha = 1;
      }
    }
    function renderPhoto(c) {
      const [mmw, mmh] = (q('phSize') || '35x45').split('x').map(Number);
      const dpi = 300;
      const pw = Math.round(mmw / 25.4 * dpi), ph = Math.round(mmh / 25.4 * dpi);
      const bg = q('phBg') || '#ffffff';
      const sheet = q('phSheet') === '1';
      const cell = canvasOf(pw, ph), cx = cell.getContext('2d');
      cx.fillStyle = bg; cx.fillRect(0, 0, pw, ph);
      const sc = Math.max(pw / c.width, ph / c.height);
      const dw = c.width * sc, dh = c.height * sc;
      cx.drawImage(c, (pw - dw) / 2, (ph - dh) / 2, dw, dh);
      if (!sheet) return cell;
      const sw = Math.round(6 * dpi), sh = Math.round(4 * dpi);
      const out = canvasOf(sw, sh), ox = out.getContext('2d');
      ox.fillStyle = '#ffffff'; ox.fillRect(0, 0, sw, sh);
      for (let i = 0; i < 6; i++) for (let j = 0; j < 5; j++) {
        const x = (i + 0.5) * sw / 6 - pw / 2, y = (j + 0.5) * sh / 5 - ph / 2;
        if (x < 0 || y < 0 || x + pw > sw || y + ph > sh) continue;
        ox.drawImage(cell, x, y);
      }
      return out;
    }
    async function renderCollage(base) {
      const files = S.files.length ? S.files : [S.file];
      const imgs = [];
      for (const f of files) { try { imgs.push(await loadImg(f)); } catch (e) { } }
      if (!imgs.length) return base;
      const cols = +q('colCols') || 2;
      const gap = +(q('colGap') ?? 8);
      const cell = +q('colCell') || 600;
      const rows = Math.ceil(imgs.length / cols);
      const W = cols * cell + (cols + 1) * gap, H = rows * cell + (rows + 1) * gap;
      const c = canvasOf(W, H), cx = c.getContext('2d');
      cx.fillStyle = q('colBg') || '#ffffff'; cx.fillRect(0, 0, W, H);
      imgs.forEach((im, i) => {
        const cx0 = (i % cols) * (cell + gap) + gap, cy0 = Math.floor(i / cols) * (cell + gap) + gap;
        const sc = Math.max(cell / im.naturalWidth, cell / im.naturalHeight);
        const dw = im.naturalWidth * sc, dh = im.naturalHeight * sc;
        cx.save(); cx.beginPath(); cx.rect(cx0, cy0, cell, cell); cx.clip();
        cx.drawImage(im, cx0 + (cell - dw) / 2, cy0 + (cell - dh) / 2, dw, dh); cx.restore();
      });
      return c;
    }

    /* ---- 裁剪 ---- */
    function initCrop() {
      const wrap = $('#imgCropWrap'), box = $('#imgCropBox'), cv = $('#imgCanvas');
      wrap.classList.remove('hide');
      cv.style.filter = 'brightness(.55)';
      const place = () => {
        const r = cv.getBoundingClientRect(), pr = wrap.getBoundingClientRect();
        const offX = r.left + r.width / 2 - pr.left - pr.width / 2, offY = r.top + r.height / 2 - pr.top - pr.height / 2;
        box.style.left = (offX + r.width * 0.1) + 'px';
        box.style.top = (offY + r.height * 0.1) + 'px';
        box.style.width = (r.width * 0.8) + 'px';
        box.style.height = (r.height * 0.8) + 'px';
        box.dataset.offX = offX; box.dataset.offY = offY; box.dataset.vw = r.width; box.dataset.vh = r.height;
        cropUpdate();
      };
      setTimeout(place, 80);
      box.addEventListener('pointerdown', e => {
        if (e.target.classList.contains('c')) return;
        const br = box.getBoundingClientRect();
        const sx = e.clientX, sy = e.clientY, l = parseFloat(box.style.left), t = parseFloat(box.style.top);
        const mv = ev => {
          box.style.left = Math.min(parseFloat(box.dataset.offX) + parseFloat(box.dataset.vw) - br.width, Math.max(parseFloat(box.dataset.offX), l + ev.clientX - sx)) + 'px';
          box.style.top = Math.min(parseFloat(box.dataset.offY) + parseFloat(box.dataset.vh) - br.height, Math.max(parseFloat(box.dataset.offY), t + ev.clientY - sy)) + 'px';
          cropUpdate();
        };
        const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); e.preventDefault();
      });
      wrap.querySelectorAll('.c').forEach(ch => ch.addEventListener('pointerdown', e => {
        const cls = ch.className.replace('c ', '').trim();
        const br = box.getBoundingClientRect();
        const sx = e.clientX, sy = e.clientY;
        const st = { l: parseFloat(box.style.left), t: parseFloat(box.style.top), w: br.width, h: br.height };
        const ratio = S.shape === 'free' ? null : eval('(' + S.shape + ')');
        const mv = ev => {
          let dx = ev.clientX - sx, dy = ev.clientY - sy, l = st.l, t = st.t, w = st.w, h = st.h;
          if (cls.includes('br')) { w = st.w + dx; h = st.h + dy; }
          else if (cls.includes('bl')) { w = st.w - dx; h = st.h + dy; l = st.l + dx; }
          else if (cls.includes('tr')) { w = st.w + dx; h = st.h - dy; t = st.t + dy; }
          else { w = st.w - dx; h = st.h - dy; l = st.l + dx; t = st.t + dy; }
          if (ratio) { h = w / ratio; if (cls.includes('t')) t = st.t + (st.h - h); if (cls.includes('l')) l = st.l + (st.w - w); }
          box.style.left = l + 'px'; box.style.top = t + 'px'; box.style.width = Math.max(24, w) + 'px'; box.style.height = Math.max(24, h) + 'px';
          cropUpdate(); e.preventDefault();
        };
        const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
      }));
      window.addEventListener('resize', place);
      function cropUpdate() {
        const r = cropRect();
        $('#imgCropSel').textContent = `Output: ${r.w} × ${r.h}`;
        $('#imgOut').innerHTML = `Output: <b>PNG</b> · ${r.w} × ${r.h}`;
      }
      S.cropUpdate = cropUpdate;
    }
    function cropRect() {
      const wrap = $('#imgCropWrap'), box = $('#imgCropBox'), cv = $('#imgCanvas');
      if (wrap.classList.contains('hide')) return { x: 0, y: 0, w: S.img.naturalWidth, h: S.img.naturalHeight };
      const offX = parseFloat(box.dataset.offX || 0), offY = parseFloat(box.dataset.offY || 0);
      const vw = parseFloat(box.dataset.vw || 1);
      const sc = S.img.naturalWidth / vw;
      const x = (parseFloat(box.style.left) - offX) * sc, y = (parseFloat(box.style.top) - offY) * sc;
      return { x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)), w: Math.round(parseFloat(box.style.width) * sc), h: Math.round(parseFloat(box.style.height) * sc) };
    }

    /* ---- 交互 ---- */
    host.addEventListener('input', e => {
      const id = e.target.id;
      if (id === 'imgQ') { $('#imgQV').textContent = e.target.value + '%'; }
      if (id === 'fxAmt' || id === 'wmSize' || id === 'wmOp' || id === 'wmScale' || id === 'pxBlock' || id === 'colGap') render();
      if (id === 'wmT' || id === 'wmColor' || id === 'wmPos') render();
      if (id === 'imgW' && $('#imgLock')?.classList.contains('on')) { const r = S.img.naturalWidth / S.img.naturalHeight; $('#imgH').value = Math.round(+e.target.value / r); }
      if (id === 'imgH' && $('#imgLock')?.classList.contains('on')) { const r = S.img.naturalWidth / S.img.naturalHeight; $('#imgW').value = Math.round(+e.target.value * r); }
    });
    host.addEventListener('change', e => {
      const id = e.target.id;
      if (['imgFmt', 'imgQ', 'imgMaxW', 'imgW', 'imgH', 'adBr', 'adCt', 'adSa', 'adHu', 'pxColors', 'colCols', 'colCell', 'wmPos', 'phSize', 'phSheet', 'avSize', 'colBg', 'wmColor', 'wmScale'].includes(id)) render();
    });
    host.addEventListener('click', async e => {
      const sh = e.target.closest('#imgShapes .shape');
      if (sh) {
        host.querySelectorAll('#imgShapes .shape').forEach(x => x.classList.remove('on')); sh.classList.add('on');
        S.shape = sh.dataset.r;
        const box = $('#imgCropBox'), cv = $('#imgCanvas').getBoundingClientRect();
        if (S.shape === 'free') { $('#imgCropBox').style.width = (cv.width * .8) + 'px'; $('#imgCropBox').style.height = (cv.height * .8) + 'px'; }
        else {
          const r = eval('(' + S.shape + ')');
          let w = cv.width * .8, h = w / r;
          if (h > cv.height * .9) { h = cv.height * .9; w = h * r; }
          box.style.width = w + 'px'; box.style.height = h + 'px';
        }
        S.cropUpdate?.(); return;
      }
      const rb = e.target.closest('#imgRot .shape');
      if (rb) {
        const r = rb.dataset.r;
        if (r === 'hflip') S.flipH = !S.flipH; else if (r === 'vflip') S.flipV = !S.flipV;
        else S.rot = (S.rot + +r) % 360;
        host.querySelectorAll('#imgRot .shape').forEach(x => x.classList.remove('on'));
        rb.classList.add('on');
        if (mode === 'crop') setTimeout(() => { $('#imgCropWrap').classList.add('hide'); }, 0);
        render(); return;
      }
      const pz = e.target.closest('#imgPresets .shape');
      if (pz) { $('#imgW').value = pz.dataset.w; $('#imgH').value = pz.dataset.h; render(); return; }
      if (e.target.closest('#adReset')) {
        ['adBr', 'adCt', 'adSa'].forEach(id => { const el = $('#' + id); if (el) el.value = 100; });
        const h = $('#adHu'); if (h) h.value = 0;
        render(); return;
      }
      if (e.target.closest('#imgKeep')) { $('#imgKeep').classList.add('on'); $('#imgResizeMode').classList.remove('on'); $('#resizeBox').classList.add('hide'); render(); }
      if (e.target.closest('#imgResizeMode')) { $('#imgResizeMode').classList.add('on'); $('#imgKeep').classList.remove('on'); $('#resizeBox').classList.remove('hide'); render(); }
      const szc = e.target.closest('.chk[data-sz]');
      if (szc) { szc.classList.toggle('on'); return; }
      if (e.target.closest('.chk')) { e.target.closest('.chk').classList.toggle('on'); render(); return; }
      if (e.target.closest('#wmText')) { $('#wmText').classList.add('on'); $('#wmLogo').classList.remove('on'); $('#wmTextBox').classList.remove('hide'); $('#wmLogoBox').classList.add('hide'); render(); }
      if (e.target.closest('#wmLogo')) { $('#wmLogo').classList.add('on'); $('#wmText').classList.remove('on'); $('#wmLogoBox').classList.remove('hide'); $('#wmTextBox').classList.add('hide'); render(); }
      if (e.target.closest('#wmDrop')) { $('#wmFile').click(); }
    });
    $('#wmFile')?.addEventListener('change', async () => {
      const f = $('#wmFile').files[0]; if (!f) return;
      S.logos = await loadImg(f); render();
    });

    /* ---- 导出 ---- */
    $('#imgGo').addEventListener('click', async () => {
      const btn = $('#imgGo');
      if (!S.img && mode !== 'blank') { window.toast('Choose an image first'); return; }
      if (mode === 'frombase64') { doFromBase64(); return; }
      btn.disabled = true; const label = btn.textContent; btn.textContent = 'Preparing…';
      try {
        let fmt = $('#imgGo').dataset.fmt || 'png';
        const qq = +(($('#imgGo').dataset.q) || .92);
        if (mode === 'tobase64') {
          const c = S.canvas;
          const b64fmt = q('b64Fmt') || 'jpeg';
          const maxW = +q('b64W') || 0;
          let cc = c;
          if (maxW && c.width > maxW) { cc = canvasOf(maxW, Math.round(c.height * maxW / c.width)); const cx = cc.getContext('2d'); cx.imageSmoothingQuality = 'high'; cx.drawImage(c, 0, 0, cc.width, cc.height); }
          const blob = await exportBlob(cc, b64fmt === 'jpeg' ? 'jpg' : b64fmt, .9);
          const uri = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
          showTextResult(uri, 'data URI', uri.length);
          btn.disabled = false; btn.textContent = label; return;
        }
        if (mode === 'crop' && S.canvas) {
          const r = cropRect();
          const c2 = canvasOf(r.w, r.h);
          c2.getContext('2d').drawImage(S.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
          S.canvas = c2; fmt = 'png';
        }
        let blob;
        if (fmt === 'ico') {
          const sizes = [...host.querySelectorAll('.chk[data-sz].on')].map(x => +x.dataset.sz);
          blob = await encodeICO(S.canvas, sizes.length ? sizes : [16, 32, 48]);
        } else if (fmt === 'bmp') blob = encodeBMP(S.canvas);
        else blob = await exportBlob(S.canvas, fmt, qq);
        if (!blob) throw new Error('Export failed');
        window.downloadBlob(blob, $('#imgGo').dataset.name || ('image.' + fmt));
        window.toast('Saved ' + window.fmtSize(blob.size));
        $('#imgOut').innerHTML = `Saved <b>${fmtLabel(fmt)}</b> · ${S.canvas.width} × ${S.canvas.height} · <b>${window.fmtSize(blob.size)}</b>`;
      } catch (err) { console.error(err); window.toast('Export failed: ' + err.message); }
      btn.disabled = false; btn.textContent = label;
    });

    async function doFromBase64() {
      const v = $('#b64In').value.trim();
      const m = v.match(/^data:([^;]+);base64,(.+)$/);
      if (!m) { window.toast('That does not look like a data URI'); return; }
      try {
        const bin = atob(m[2]);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        const blob = new Blob([u8], { type: m[1] });
        S.img = await loadImg(blob);
        S.file = new File([blob], 'decoded.' + (m[1].split('/')[1] || 'png'), { type: m[1] });
        $('#imgDrop').classList.add('hide'); $('#imgLoaded').classList.remove('hide');
        $('#imgName').textContent = S.file.name;
        $('#imgMeta').textContent = `${metaTxt()} · ${window.fmtSize(blob.size)}`;
        render();
        const pane = $('#imgPane');
        pane.insertAdjacentHTML('afterbegin', `<button class="btn-lime btn-run" id="b64Dl">下载图片</button>`);
        $('#b64Dl')?.addEventListener('click', () => window.downloadBlob(blob, S.file.name));
      } catch (e) { window.toast('解码失败'); }
    }
    function showTextResult(text, label, len) {
      const pane = $('#imgPane');
      let box = $('#b64Result');
      if (!box) { pane.insertAdjacentHTML('afterbegin', `<div class="outbox" id="b64Result" style="font-family:var(--mono);font-size:11.5px;max-height:200px;overflow:auto;white-space:pre-wrap;word-break:break-all"></div><button class="btn-ghost btn-sm" id="b64Copy" style="margin-top:8px">复制 data URI</button>`); }
      box = $('#b64Result');
      box.textContent = text;
      $('#b64Copy').onclick = () => window.copyText(text);
      $('#imgOut').innerHTML = `${label} ready · <b>${window.fmtSize(len)}</b> of text`;
    }

    // 空画布模式直接可导出（用真实 canvas 充当 S.img，drawImage 才合法）
    if (mode === 'blank') {
      $('#imgDrop').classList.add('hide'); $('#imgLoaded').classList.remove('hide');
      const bc = document.createElement('canvas'); bc.width = 800; bc.height = 800;
      bc.getContext('2d').fillStyle = '#ffffff';
      bc.getContext('2d').fillRect(0, 0, 800, 800);
      S.img = Object.assign(bc, { naturalWidth: 800, naturalHeight: 800 });
      render();
    }
    if (mode === 'frombase64') { $('#imgDrop').classList.add('hide'); }
    (cfg.targets && mode === 'convert') && (S.fmt = cfg.targets[0]);
    if (mode === 'watermark') { setTimeout(() => { $('#wmT')?.addEventListener('input', () => render()); }, 100); }
  };
  window.TOOL_ENGINES.image = E;
})();
