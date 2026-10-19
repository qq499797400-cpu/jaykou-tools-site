/* ==========================================================================
   engine-ai.js — AI 工具引擎（全部在浏览器本地运行，零外部请求）
   --------------------------------------------------------------------------
   设计原则：能用浏览器原生能力真算出来的，就用真算法算（Canvas 像素处理 /
   Web Audio / Web Crypto / Web Speech / WebRTC / ffmpeg.wasm）；
   真正需要神经网络模型的（自动上色、单目深度、语义分割、AI 取证判定、
   OCR、语音识别等），界面上必须明确写清「本地近似算法」或「需要模型」，
   并给出一个当时当地真正可用的替代动作，绝不伪造结果。

   覆盖 slug（按能力分三类）：
   A. ffmpeg.wasm 真做：ai-slow-motion(-video)、increase-video-fps、
      frame-interpolation、video-upscaler、upscale-video-to-4k、
      enhance-video-quality、remove-noise-from-video、remove-video-background、
      video-background-remover(-online)、remove-vocals-from-song、vocal-remover、
      acapella-extractor、remove-audio-from-video、
      remove-background-noise-from-audio、change-voice-online、voice-changer
   B. Canvas 像素级真算法：background-remover、image-upscaler、
      increase-image-resolution、unblur-image、enhance-photo-quality、
      noise-remover、photo-to-sketch、photo-to-cartoon、cartoon-yourself、
      photo-to-anime、restore-old-photos、face-retouch、skin-smoothing、
      photo-beautifier、face-enhancer、depth-map-generator、
      depth-map-from-image、image-to-svg、vectorizer、remove-object-from-photo、
      remove-text-from-image、segment-anything
   C. 诚实降级 / 分析面板：colorize-black-and-white-photos、image-colorizer、
      image-to-prompt(-generator)、image-prompt-generator、
      ai-art-prompt-generator、ai-prompt-generator、video-prompt-generator、
      image-caption-generator、describe-image-ai、image-to-text、ocr、
      ai-image-detector、ai-generated-image-checker、ai-music-detector、
      ai-song-checker、face-swapper、speech-to-text、subtitle-generator、
      text-to-speech、grammar-checker
   ========================================================================== */
(function () {
  'use strict';
  const E = {};
  window.TOOL_ENGINES = window.TOOL_ENGINES || {};

  /* ======================= 0. 通用小工具 ======================= */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const TUV = () => window.TUI;
  const esc = s => (window.TUI ? window.TUI.esc(s) : String(s == null ? '' : s));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms == null ? 0 : ms));
  const VENDOR = '../assets/vendor/';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const clamp255 = v => (v < 0 ? 0 : v > 255 ? 255 : v);

  function el(html) { const d = document.createElement('div'); d.innerHTML = String(html).trim(); return d.firstElementChild; }
  function toast(m) { try { window.toast(m); } catch (e) { } }
  function fmtName(base, suffix, ext) {
    const b = String(base || 'image').replace(/\.[^.]+$/, '');
    return b + (suffix || '') + '.' + ext;
  }

  /* 按需注入 vendor 脚本 */
  function lib(src, globalName) {
    return new Promise((res, rej) => {
      if (window[globalName]) return res(window[globalName]);
      const key = '__libp_' + globalName;
      if (window[key]) return window[key].then(res, rej);
      window[key] = new Promise((r2, j2) => {
        const s = document.createElement('script');
        s.src = VENDOR + src;
        s.onload = () => (window[globalName] ? r2(window[globalName]) : j2(new Error('缺少脚本全局对象：' + globalName)));
        s.onerror = () => j2(new Error('脚本加载失败：' + src));
        document.head.appendChild(s);
      });
      window[key].then(res, rej);
    });
  }

  /* ======================= 1. ffmpeg 单例 =======================
     照抄 engine-av.js 的 getFF()，并补上 vendor 脚本注入（本站页面未预置
     FFmpegWASM 全局）。三个已知坑的处理方式保持一致：
      ① coreURL / wasmURL 必须转成 blob URL —— worker 里 importScripts 的
         相对路径无法解析，只有 blob/core 的绝对形式才可靠；
      ② 用 window.__FFP 做 promise 缓存，避免并发重复 load 32MB wasm；
      ③ 用 ff.on('progress') / ff.on('log') 驱动进度与日志。 */
  function ensureFFLib() {
    return lib('ffmpeg.js', 'FFmpegWASM');
  }
  async function getFF(onProg, onLog) {
    if (window.__FF) return window.__FF;
    if (window.__FFP) return window.__FFP;
    window.__FFP = (async () => {
      const mod = await ensureFFLib();
      const FFmpeg = mod.FFmpeg;
      const ff = new FFmpeg();
      ff.on('progress', p => onProg && onProg(Math.min(99, Math.round(((p && p.progress) || 0) * 100))));
      if (onLog) ff.on('log', m => onLog(m && m.message));
      const toBlob = async (u, t) => URL.createObjectURL(new Blob([await (await fetch(u)).blob()], { type: t }));
      await ff.load({
        coreURL: await toBlob(VENDOR + 'ffmpeg-core.js', 'text/javascript'),
        wasmURL: await toBlob(VENDOR + 'ffmpeg-core.wasm', 'application/wasm')
      });
      window.__FF = ff;
      return ff;
    })();
    try { return await window.__FFP; }
    catch (e) { window.__FFP = null; throw e; }
  }

  /* ======================= 2. Canvas / 图像基础 ======================= */
  function loadImg(src) {
    return new Promise((res, rej) => {
      let url = null, revoke = false;
      const im = new Image();
      im.onload = () => { if (revoke) URL.revokeObjectURL(url); res(im); };
      im.onerror = () => { if (revoke) URL.revokeObjectURL(url); rej(new Error('无法读取该图像')); };
      if (src instanceof Blob) { url = URL.createObjectURL(src); revoke = true; im.src = url; }
      else im.src = src;
    });
  }
  function canvasOf(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
  function ctxOf(c) { return c.getContext('2d', { willReadFrequently: true }); }
  function toBlob(c, mime, q) {
    return new Promise(res => {
      try { c.toBlob(b => res(b), mime || 'image/png', q == null ? 0.92 : q); }
      catch (e) { res(null); }
    });
  }
  function imageToCanvas(im, maxSide) {
    let w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
    if (maxSide && Math.max(w, h) > maxSide) { const s = maxSide / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
    const c = canvasOf(w, h);
    ctxOf(c).drawImage(im, 0, 0, w, h);
    return c;
  }
  function cloneCanvas(c) { const n = canvasOf(c.width, c.height); ctxOf(n).drawImage(c, 0, 0); return n; }
  function getP(c) { const x = ctxOf(c); const id = x.getImageData(0, 0, c.width, c.height); return { w: c.width, h: c.height, data: id.data }; }
  function putP(c, p) {
    const x = ctxOf(c);
    x.putImageData(new ImageData(p.data, p.w, p.h), 0, 0);
  }
  function newP(w, h) { return { w: w, h: h, data: new Uint8ClampedArray(w * h * 4) }; }
  function copyP(p) { return { w: p.w, h: p.h, data: new Uint8ClampedArray(p.data) }; }

  /* ======================= 3. 色彩空间 ======================= */
  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h = 0, s = 0; const l = (mx + mn) / 2; const d = mx - mn;
    if (d) {
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h * 360, s, l];
  }
  function hue2rgb(p, q, t) {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }
  function hsl2rgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    if (!s) { const v = l * 255; return [v, v, v]; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return [hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255];
  }
  function rgb2ycbcr(r, g, b) {
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    return [y, 128 - 0.168736 * r - 0.331264 * g + 0.5 * b, 128 + 0.5 * r - 0.418688 * g - 0.081312 * b];
  }
  function ycbcr2rgb(y, cb, cr) {
    return [y + 1.402 * (cr - 128), y - 0.344136 * (cb - 128) - 0.714136 * (cr - 128), y + 1.772 * (cb - 128)];
  }
  function srgb2lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function lin2srgb(c) { const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return clamp255(v * 255); }
  function rgb2xyz(r, g, b) {
    const R = srgb2lin(r), G = srgb2lin(g), B = srgb2lin(b);
    return [R * 0.4124564 + G * 0.3575761 + B * 0.1804375,
      R * 0.2126729 + G * 0.7151522 + B * 0.0721750,
      R * 0.0193339 + G * 0.1191920 + B * 0.9503041];
  }
  function xyz2lab(X, Y, Z) {
    const f = t => (t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116));
    const xn = 0.95047, yn = 1, zn = 1.08883;
    const fx = f(X / xn), fy = f(Y / yn), fz = f(Z / zn);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  function rgb2lab(r, g, b) { const x = rgb2xyz(r, g, b); return xyz2lab(x[0], x[1], x[2]); }
  function lum(r, g, b) { return 0.2126 * srgb2lin(r) + 0.7152 * srgb2lin(g) + 0.0722 * srgb2lin(b); }
  function grayArr(p) {
    const n = p.w * p.h, g = new Float32Array(n), d = p.data;
    for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
    return g;
  }

  /* ======================= 4. 卷积 / 滤波 ======================= */
  function gaussKernel(sigma) {
    const r = Math.max(1, Math.ceil(sigma * 3));
    const k = new Float32Array(2 * r + 1); let s = 0;
    for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k[i + r] = v; s += v; }
    for (let i = 0; i < k.length; i++) k[i] /= s;
    return { k: k, r: r };
  }
  /* 可分离高斯模糊（RGBA，alpha 不变） */
  function gaussBlur(p, sigma) {
    if (sigma <= 0) return p;
    const { k, r } = gaussKernel(sigma);
    const w = p.w, h = p.h, d = p.data;
    const tmp = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let a = 0, b = 0, c = 0;
        for (let i = -r; i <= r; i++) {
          const xx = clamp(x + i, 0, w - 1), kv = k[i + r], o = (y * w + xx) * 4;
          a += d[o] * kv; b += d[o + 1] * kv; c += d[o + 2] * kv;
        }
        const t = (y * w + x) * 3; tmp[t] = a; tmp[t + 1] = b; tmp[t + 2] = c;
      }
    }
    const out = copyP(p);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let a = 0, b = 0, c = 0;
        for (let i = -r; i <= r; i++) {
          const yy = clamp(y + i, 0, h - 1), kv = k[i + r], t = (yy * w + x) * 3;
          a += tmp[t] * kv; b += tmp[t + 1] * kv; c += tmp[t + 2] * kv;
        }
        const o = (y * w + x) * 4; out.data[o] = a; out.data[o + 1] = b; out.data[o + 2] = c;
      }
    }
    return out;
  }
  /* 单通道浮点可分离高斯 */
  function gaussBlurGray(g, w, h, sigma) {
    if (sigma <= 0) return g;
    const { k, r } = gaussKernel(sigma);
    const t = new Float32Array(w * h), o = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0; for (let i = -r; i <= r; i++) s += g[y * w + clamp(x + i, 0, w - 1)] * k[i + r];
      t[y * w + x] = s;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0; for (let i = -r; i <= r; i++) s += t[clamp(y + i, 0, h - 1) * w + x] * k[i + r];
      o[y * w + x] = s;
    }
    return o;
  }
  /* 任意核卷积（RGBA 三通道） */
  function convRGBA(p, kernel, kr) {
    const w = p.w, h = p.h, d = p.data, out = copyP(p), o = out.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let a = 0, b = 0, c = 0, ki = 0;
      for (let dy = -kr; dy <= kr; dy++) for (let dx = -kr; dx <= kr; dx++) {
        const xx = clamp(x + dx, 0, w - 1), yy = clamp(y + dy, 0, h - 1);
        const kv = kernel[ki++], t = (yy * w + xx) * 4;
        a += d[t] * kv; b += d[t + 1] * kv; c += d[t + 2] * kv;
      }
      const q = (y * w + x) * 4; o[q] = clamp255(a); o[q + 1] = clamp255(b); o[q + 2] = clamp255(c);
    }
    return out;
  }
  /* 中值滤波（RGBA，按通道） */
  function medianFilter(p, radius) {
    const w = p.w, h = p.h, d = p.data, out = copyP(p), o = out.data;
    const R = radius | 0, n = (2 * R + 1) * (2 * R + 1);
    const bufR = new Uint8Array(n), bufG = new Uint8Array(n), bufB = new Uint8Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let c = 0;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const xx = clamp(x + dx, 0, w - 1), yy = clamp(y + dy, 0, h - 1), t = (yy * w + xx) * 4;
        bufR[c] = d[t]; bufG[c] = d[t + 1]; bufB[c] = d[t + 2]; c++;
      }
      const sR = bufR.slice(0, n).sort(), sG = bufG.slice(0, n).sort(), sB = bufB.slice(0, n).sort();
      const m = n >> 1, q = (y * w + x) * 4;
      o[q] = sR[m]; o[q + 1] = sG[m]; o[q + 2] = sB[m];
    }
    return out;
  }
  /* 双边滤波（保边平滑） */
  function bilateral(p, radius, sigmaS, sigmaR) {
    const w = p.w, h = p.h, d = p.data, out = copyP(p), o = out.data;
    const R = Math.max(1, radius | 0);
    const gs = new Float32Array(R + 1);
    for (let i = 0; i <= R; i++) gs[i] = Math.exp(-(i * i) / (2 * sigmaS * sigmaS));
    const inv2r = 1 / (2 * sigmaR * sigmaR);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const q = (y * w + x) * 4;
      const cr = d[q], cg = d[q + 1], cb = d[q + 2];
      let ar = 0, ag = 0, ab = 0, wsum = 0;
      for (let dy = -R; dy <= R; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= w) continue;
          const t = (yy * w + xx) * 4;
          const dr = d[t] - cr, dg = d[t + 1] - cg, db = d[t + 2] - cb;
          const dv = dr * dr + dg * dg + db * db;
          const sp = gs[Math.abs(dx)] * gs[Math.abs(dy)];
          const ww = sp * Math.exp(-dv * inv2r);
          ar += d[t] * ww; ag += d[t + 1] * ww; ab += d[t + 2] * ww; wsum += ww;
        }
      }
      if (wsum > 0) { o[q] = ar / wsum; o[q + 1] = ag / wsum; o[q + 2] = ab / wsum; }
    }
    return out;
  }
  /* 简化版非局部均值去噪（小搜索窗 + 小补丁） */
  function nlMeans(p, h_, searchR, patchR) {
    const w = p.w, hh = p.h, d = p.data, out = copyP(p), o = out.data;
    const SR = Math.max(1, searchR | 0), PR = Math.max(1, patchR | 0);
    const h2 = h_ * h_ * 3;
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
      const q = (y * w + x) * 4;
      let ar = 0, ag = 0, ab = 0, wsum = 0;
      for (let sy = -SR; sy <= SR; sy++) for (let sx = -SR; sx <= SR; sx++) {
        const cx = x + sx, cy = y + sy;
        if (cx < 0 || cy < 0 || cx >= w || cy >= hh) continue;
        let dist = 0, cnt = 0;
        for (let py = -PR; py <= PR; py++) for (let px = -PR; px <= PR; px++) {
          const ax = clamp(x + px, 0, w - 1), ay = clamp(y + py, 0, hh - 1);
          const bx = clamp(cx + px, 0, w - 1), by = clamp(cy + py, 0, hh - 1);
          const ia = (ay * w + ax) * 4, ib = (by * w + bx) * 4;
          const dr = d[ia] - d[ib], dg = d[ia + 1] - d[ib + 1], db = d[ia + 2] - d[ib + 2];
          dist += dr * dr + dg * dg + db * db; cnt++;
        }
        dist /= cnt;
        const ww = Math.exp(-Math.max(0, dist - 2 * h_) / Math.max(1, h2));
        const t = (cy * w + cx) * 4;
        ar += d[t] * ww; ag += d[t + 1] * ww; ab += d[t + 2] * ww; wsum += ww;
      }
      if (wsum > 0) { o[q] = ar / wsum; o[q + 1] = ag / wsum; o[q + 2] = ab / wsum; }
    }
    return out;
  }
  /* Sobel 梯度 */
  function sobel(g, w, h) {
    const mag = new Float32Array(w * h), ang = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 1), x1 = Math.min(w - 1, x + 1), y0 = Math.max(0, y - 1), y1 = Math.min(h - 1, y + 1);
      const tl = g[y0 * w + x0], tc = g[y0 * w + x], tr = g[y0 * w + x1];
      const ml = g[y * w + x0], mr = g[y * w + x1];
      const bl = g[y1 * w + x0], bc = g[y1 * w + x], br = g[y1 * w + x1];
      const gx = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
      const gy = (bl + 2 * bc + br) - (tl + 2 * tc + tr);
      mag[y * w + x] = Math.sqrt(gx * gx + gy * gy);
      ang[y * w + x] = Math.atan2(gy, gx);
    }
    return { mag: mag, ang: ang };
  }
  /* 反锐化掩模 */
  function unsharp(p, radius, amount, threshold) {
    const blurred = gaussBlur(p, radius);
    const n = p.w * p.h, a = amount, th = threshold || 0;
    const o = copyP(p), od = o.data, d = p.data, bd = blurred.data;
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      for (let c = 0; c < 3; c++) {
        const diff = d[j + c] - bd[j + c];
        od[j + c] = Math.abs(diff) < th ? d[j + c] : clamp255(d[j + c] + a * diff);
      }
    }
    return o;
  }
  /* 导向滤波（保边，用于平滑 / 抠图） */
  function boxFilterGray(g, w, h, r) {
    const t = new Float32Array(w * h);
    for (let y = 0; y < h; y++) { // 横向
      let s = 0; const n = 2 * r + 1;
      for (let x = -r; x <= r; x++) s += g[y * w + clamp(x, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        t[y * w + x] = s / n;
        s += g[y * w + clamp(x + r + 1, 0, w - 1)] - g[y * w + clamp(x - r, 0, w - 1)];
      }
    }
    const o = new Float32Array(w * h);
    for (let x = 0; x < w; x++) {
      let s = 0; const n = 2 * r + 1;
      for (let y = -r; y <= r; y++) s += t[clamp(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        o[y * w + x] = s / n;
        s += t[clamp(y + r + 1, 0, h - 1) * w + x] - t[clamp(y - r, 0, h - 1) * w + x];
      }
    }
    return o;
  }
  function guidedFilterGray(I, pguide, w, h, r, eps) {
    const mI = boxFilterGray(I, w, h, r), mp = boxFilterGray(pguide, w, h, r);
    const Ip = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) Ip[i] = I[i] * pguide[i];
    const mIp = boxFilterGray(Ip, w, h, r);
    const II = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) II[i] = I[i] * I[i];
    const mII = boxFilterGray(II, w, h, r);
    const a = new Float32Array(w * h), b = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const varI = mII[i] - mI[i] * mI[i], cov = mIp[i] - mI[i] * mp[i];
      a[i] = cov / (varI + eps); b[i] = mp[i] - a[i] * mI[i];
    }
    const ma = boxFilterGray(a, w, h, r), mb = boxFilterGray(b, w, h, r);
    const q = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) q[i] = ma[i] * I[i] + mb[i];
    return q;
  }

  /* ======================= 5. 直方图 / CLAHE / 自动色阶 ======================= */
  function histogram(g, w, h) {
    const hg = new Float32Array(256);
    for (let i = 0; i < w * h; i++) hg[clamp255(g[i]) | 0]++;
    return hg;
  }
  function autoLevels(g, w, h, clipPct) {
    const hg = histogram(g, w, h), total = w * h, cut = total * (clipPct == null ? 0.005 : clipPct);
    let lo = 0, hi = 255, acc = 0;
    for (let i = 0; i < 256; i++) { acc += hg[i]; if (acc > cut) { lo = i; break; } }
    acc = 0;
    for (let i = 255; i >= 0; i--) { acc += hg[i]; if (acc > cut) { hi = i; break; } }
    if (hi <= lo) { hi = 255; lo = 0; }
    const scale = 255 / (hi - lo), out = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) out[i] = clamp255((g[i] - lo) * scale);
    return out;
  }
  /* CLAHE：分块直方图均衡 + 双线性插值 */
  function clahe(g, w, h, tiles, clipLimit) {
    const tx = tiles || 8, ty = tiles || 8;
    const tw = Math.ceil(w / tx), th = Math.ceil(h / ty);
    const maps = [];
    const lim = Math.max(1, Math.round((clipLimit == null ? 2.5 : clipLimit) * tw * th / 256));
    for (let tyi = 0; tyi < ty; tyi++) {
      maps[tyi] = [];
      for (let txi = 0; txi < tx; txi++) {
        const hg = new Float32Array(256);
        let cnt = 0;
        for (let y = tyi * th; y < Math.min(h, (tyi + 1) * th); y++)
          for (let x = txi * tw; x < Math.min(w, (txi + 1) * tw); x++) { hg[clamp255(g[y * w + x]) | 0]++; cnt++; }
        let excess = 0;
        for (let i = 0; i < 256; i++) if (hg[i] > lim) { excess += hg[i] - lim; hg[i] = lim; }
        const add = excess / 256;
        for (let i = 0; i < 256; i++) hg[i] += add;
        const cdf = new Float32Array(256); let s = 0;
        for (let i = 0; i < 256; i++) { s += hg[i]; cdf[i] = s; }
        const lut = new Float32Array(256);
        for (let i = 0; i < 256; i++) lut[i] = (cdf[i] / Math.max(1, cnt)) * 255;
        maps[tyi][txi] = lut;
      }
    }
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const fy = y / th - 0.5, y0 = Math.max(0, Math.min(ty - 1, Math.floor(fy))), y1 = Math.min(ty - 1, y0 + 1);
      const wy = Math.max(0, Math.min(1, fy - y0));
      for (let x = 0; x < w; x++) {
        const fx = x / tw - 0.5, x0 = Math.max(0, Math.min(tx - 1, Math.floor(fx))), x1 = Math.min(tx - 1, x0 + 1);
        const wx = Math.max(0, Math.min(1, fx - x0));
        const v = clamp255(g[y * w + x]) | 0;
        const v00 = maps[y0][x0][v], v01 = maps[y0][x1][v], v10 = maps[y1][x0][v], v11 = maps[y1][x1][v];
        const top = v00 + (v01 - v00) * wx, bot = v10 + (v11 - v10) * wx;
        out[y * w + x] = top + (bot - top) * wy;
      }
    }
    return out;
  }

  /* ======================= 6. 形态学 / 连通域 / 泛洪 ======================= */
  function dilateMask(m, w, h, r) {
    const o = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = 0;
      for (let dy = -r; dy <= r && !v; dy++) for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && m[yy * w + xx]) { v = 1; break; }
      }
      o[y * w + x] = v;
    }
    return o;
  }
  function erodeMask(m, w, h, r) {
    const o = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = 1;
      for (let dy = -r; dy <= r && v; dy++) for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h || !m[yy * w + xx]) { v = 0; break; }
      }
      o[y * w + x] = v;
    }
    return o;
  }
  function morphClose(m, w, h, r) { return erodeMask(dilateMask(m, w, h, r), w, h, r); }
  function morphOpen(m, w, h, r) { return dilateMask(erodeMask(m, w, h, r), w, h, r); }
  /* 4/8 邻域泛洪（返回 mask），stopAtEdge 时遇到强梯度即停 */
  function floodMask(p, sx, sy, tol, conn8, edgeG, edgeTh) {
    const w = p.w, h = p.h, d = p.data;
    const m = new Uint8Array(w * h), st = [sy * w + sx];
    const o = (sy * w + sx) * 4, r0 = d[o], g0 = d[o + 1], b0 = d[o + 2];
    const tol2 = tol * tol * 3;
    const nb = conn8 ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (st.length) {
      const i = st.pop();
      if (m[i]) continue;
      const x = i % w, y = (i / w) | 0;
      const q = i * 4, dr = d[q] - r0, dg = d[q + 1] - g0, db = d[q + 2] - b0;
      if (dr * dr + dg * dg + db * db > tol2) continue;
      if (edgeG && edgeG[i] > edgeTh) continue;
      m[i] = 1;
      for (let k = 0; k < nb.length; k++) {
        const xx = x + nb[k][0], yy = y + nb[k][1];
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const ni = yy * w + xx;
        if (!m[ni]) st.push(ni);
      }
    }
    return m;
  }
  /* 连通域标记（8 邻域），返回 {labels,count,sizes} */
  function labelComponents(m, w, h) {
    const lab = new Int32Array(w * h).fill(-1);
    let count = 0; const sizes = [];
    const st = [];
    for (let i = 0; i < w * h; i++) {
      if (!m[i] || lab[i] >= 0) continue;
      const id = count++; let n = 0; st.length = 0; st.push(i); lab[i] = id;
      while (st.length) {
        const k = st.pop(); n++;
        const x = k % w, y = (k / w) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const ni = yy * w + xx;
          if (m[ni] && lab[ni] < 0) { lab[ni] = id; st.push(ni); }
        }
      }
      sizes.push(n);
    }
    return { labels: lab, count: count, sizes: sizes };
  }

  /* ======================= 7. 量化 / 调色板 ======================= */
  function medianCut(samples, k) {
    let boxes = [samples];
    while (boxes.length < k) {
      let bi = -1, best = -1;
      for (let i = 0; i < boxes.length; i++) {
        if (boxes[i].length < 2) continue;
        const b = boxes[i];
        let mn = [255, 255, 255], mx = [0, 0, 0];
        for (let j = 0; j < b.length; j++) for (let c = 0; c < 3; c++) { if (b[j][c] < mn[c]) mn[c] = b[j][c]; if (b[j][c] > mx[c]) mx[c] = b[j][c]; }
        const range = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
        const score = range * b.length;
        if (score > best) { best = score; bi = i; }
      }
      if (bi < 0) break;
      const b = boxes[bi];
      let mn = [255, 255, 255], mx = [0, 0, 0];
      for (let j = 0; j < b.length; j++) for (let c = 0; c < 3; c++) { if (b[j][c] < mn[c]) mn[c] = b[j][c]; if (b[j][c] > mx[c]) mx[c] = b[j][c]; }
      let ch = 0, rg = mx[0] - mn[0];
      if (mx[1] - mn[1] > rg) { rg = mx[1] - mn[1]; ch = 1; }
      if (mx[2] - mn[2] > rg) { ch = 2; }
      b.sort((x, y) => x[ch] - y[ch]);
      const mid = b.length >> 1;
      boxes.splice(bi, 1, b.slice(0, mid), b.slice(mid));
    }
    return boxes.filter(b => b.length).map(b => {
      let r = 0, g = 0, bl = 0;
      for (let i = 0; i < b.length; i++) { r += b[i][0]; g += b[i][1]; bl += b[i][2]; }
      return [r / b.length, g / b.length, bl / b.length];
    });
  }
  function kmeansPalette(samples, k, iters) {
    if (samples.length <= k) return samples.map(s => s.slice());
    let cents = medianCut(samples, k);
    const assign = new Int32Array(samples.length);
    for (let it = 0; it < (iters || 6); it++) {
      for (let i = 0; i < samples.length; i++) {
        let bi = 0, bd = Infinity;
        for (let c = 0; c < cents.length; c++) {
          const dr = samples[i][0] - cents[c][0], dg = samples[i][1] - cents[c][1], db = samples[i][2] - cents[c][2];
          const dd = dr * dr + dg * dg + db * db;
          if (dd < bd) { bd = dd; bi = c; }
        }
        assign[i] = bi;
      }
      const sum = cents.map(() => [0, 0, 0, 0]);
      for (let i = 0; i < samples.length; i++) { const a = assign[i], s = samples[i]; sum[a][0] += s[0]; sum[a][1] += s[1]; sum[a][2] += s[2]; sum[a][3]++; }
      for (let c = 0; c < cents.length; c++) if (sum[c][3]) cents[c] = [sum[c][0] / sum[c][3], sum[c][1] / sum[c][3], sum[c][2] / sum[c][3]];
    }
    return cents;
  }
  function samplePixels(p, stride) {
    const out = [], d = p.data, st = stride || 3;
    for (let i = 0; i < p.w * p.h; i += st) { const q = i * 4; out.push([d[q], d[q + 1], d[q + 2]]); }
    return out;
  }
  function nearestColor(cents, r, g, b) {
    let bi = 0, bd = Infinity;
    for (let c = 0; c < cents.length; c++) {
      const dr = r - cents[c][0], dg = g - cents[c][1], db = b - cents[c][2];
      const dd = dr * dr + dg * dg + db * db;
      if (dd < bd) { bd = dd; bi = c; }
    }
    return bi;
  }
  /* 按调色板量化整图 */
  function quantizeByPalette(p, cents, flat) {
    const out = copyP(p), d = p.data, o = out.data, n = p.w * p.h;
    for (let i = 0; i < n; i++) {
      const q = i * 4, ci = nearestColor(cents, d[q], d[q + 1], d[q + 2]);
      if (flat) { o[q] = cents[ci][0]; o[q + 1] = cents[ci][1]; o[q + 2] = cents[ci][2]; }
      else { const a = 0.55; o[q] = d[q] + (cents[ci][0] - d[q]) * a; o[q + 1] = d[q + 1] + (cents[ci][1] - d[q + 1]) * a; o[q + 2] = d[q + 2] + (cents[ci][2] - d[q + 2]) * a; }
      o[q + 3] = d[q + 3];
    }
    return out;
  }

  /* ======================= 8. 重采样 / 缩放 ======================= */
  function lanczosKernel(x, a) {
    a = a || 3;
    if (x === 0) return 1;
    const ax = Math.abs(x);
    if (ax >= a) return 0;
    const px = Math.PI * x;
    return (a * Math.sin(px) * Math.sin(px / a)) / (px * px);
  }
  /* 真实的 Lanczos-3 可分离重采样（带进度与让出） */
  async function lanczosResize(src, tw, th, prog) {
    const sw = src.w, sh = src.h, a = 3;
    const out = newP(tw, th);
    const tmp = new Float32Array(sw * th * 3);
    // 垂直方向：src(h) -> th
    for (let y = 0; y < th; y++) {
      const sy = (y + 0.5) * sh / th - 0.5;
      const y0 = Math.ceil(sy - a), y1 = Math.floor(sy + a);
      const ws = []; let sum = 0;
      for (let k = y0; k <= y1; k++) { const wv = lanczosKernel(sy - k, a); ws.push([k, wv]); sum += wv; }
      for (let x = 0; x < sw; x++) {
        let r = 0, g = 0, b = 0;
        for (let i = 0; i < ws.length; i++) {
          const kk = clamp(ws[i][0], 0, sh - 1), wv = ws[i][1] / sum, q = (kk * sw + x) * 4;
          r += src.data[q] * wv; g += src.data[q + 1] * wv; b += src.data[q + 2] * wv;
        }
        const t = (y * sw + x) * 3; tmp[t] = r; tmp[t + 1] = g; tmp[t + 2] = b;
      }
      if (y % 32 === 0) { if (prog) prog(50 * y / th); await sleep(); }
    }
    // 水平方向：sw -> tw
    for (let x = 0; x < tw; x++) {
      const sx = (x + 0.5) * sw / tw - 0.5;
      const x0 = Math.ceil(sx - a), x1 = Math.floor(sx + a);
      const ws = []; let sum = 0;
      for (let k = x0; k <= x1; k++) { const wv = lanczosKernel(sx - k, a); ws.push([k, wv]); sum += wv; }
      for (let y = 0; y < th; y++) {
        let r = 0, g = 0, b = 0;
        for (let i = 0; i < ws.length; i++) {
          const kk = clamp(ws[i][0], 0, sw - 1), wv = ws[i][1] / sum, t = (y * sw + kk) * 3;
          r += tmp[t] * wv; g += tmp[t + 1] * wv; b += tmp[t + 2] * wv;
        }
        const q = (y * tw + x) * 4;
        out.data[q] = clamp255(r); out.data[q + 1] = clamp255(g); out.data[q + 2] = clamp255(b); out.data[q + 3] = 255;
      }
      if (x % 32 === 0) { if (prog) prog(50 + 50 * x / tw); await sleep(); }
    }
    if (prog) prog(100);
    return out;
  }

  /* ======================= 9. 轮廓追踪 / 简化 ======================= */
  /* Moore 邻域轮廓追踪：输入二值掩膜，返回轮廓点数组（图像坐标） */
  function traceContours(mask, w, h) {
    const visited = new Uint8Array(w * h);
    const contours = [];
    const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i] || visited[i]) continue;
      // 是否是轮廓起点（左边或上边无像素）
      if ((x > 0 && mask[i - 1]) || (y > 0 && mask[i - w])) continue;
      const pts = []; let cx = x, cy = y, dir = 0, guard = 0;
      const startX = x, startY = y;
      do {
        pts.push([cx, cy]); visited[cy * w + cx] = 1;
        let found = false;
        for (let k = 0; k < 8; k++) {
          const d = (dir + 6 + k) % 8;
          const nx = cx + dirs[d][0], ny = cy + dirs[d][1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (mask[ny * w + nx]) { cx = nx; cy = ny; dir = d; found = true; break; }
        }
        if (!found) break;
        if (++guard > w * h * 4) break;
      } while (!(cx === startX && cy === startY));
      if (pts.length > 2) contours.push(pts);
    }
    return contours;
  }
  /* Douglas-Peucker 折线简化 */
  function simplify(pts, tol) {
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length); keep[0] = 1; keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const seg = stack.pop(), i0 = seg[0], i1 = seg[1];
      if (i1 <= i0 + 1) continue;
      const ax = pts[i0][0], ay = pts[i0][1], bx = pts[i1][0], by = pts[i1][1];
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      let md = -1, mi = -1;
      for (let i = i0 + 1; i < i1; i++) {
        let d;
        if (len2 === 0) { const px = pts[i][0] - ax, py = pts[i][1] - ay; d = Math.sqrt(px * px + py * py); }
        else { const t = ((pts[i][0] - ax) * dx + (pts[i][1] - ay) * dy) / len2; const px = ax + t * dx, py = ay + t * dy; const ex = pts[i][0] - px, ey = pts[i][1] - py; d = Math.sqrt(ex * ex + ey * ey); }
        if (d > md) { md = d; mi = i; }
      }
      if (md > tol) { keep[mi] = 1; stack.push([i0, mi], [mi, i1]); }
    }
    const out = [];
    for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
    return out;
  }

  /* ======================= 10. 其他辅助 ======================= */
  function distColor(r, g, b, c) { const dr = r - c[0], dg = g - c[1], db = b - c[2]; return Math.sqrt(dr * dr + dg * dg + db * db); }
  function hexOf(r, g, b) { return '#' + [r, g, b].map(v => clamp255(v | 0).toString(16).padStart(2, '0')).join(''); }
  function hex2rgb(hex) {
    const m = String(hex).replace('#', '');
    const v = m.length === 3 ? m.split('').map(c => c + c).join('') : m;
    return [parseInt(v.slice(0, 2), 16) || 0, parseInt(v.slice(2, 4), 16) || 0, parseInt(v.slice(4, 6), 16) || 0];
  }
  function colorName(r, g, b) {
    const hsl = rgb2hsl(r, g, b), H = hsl[0], S = hsl[1], L = hsl[2];
    if (S < 0.08) return L > 0.85 ? '近白色' : L < 0.15 ? '近黑色' : L > 0.6 ? '浅灰色' : L > 0.35 ? '中灰色' : '深灰色';
    const names = [[15, '红色'], [40, '橙色'], [65, '黄色'], [90, '黄绿色'], [150, '绿色'], [180, '青绿色'], [210, '青色'], [250, '蓝色'], [285, '紫色'], [320, '品红色'], [345, '玫红色'], [360, '红色']];
    let base = '红色';
    for (let i = 0; i < names.length; i++) if (H <= names[i][0]) { base = names[i][1]; break; }
    const pre = L > 0.75 ? '浅' : L < 0.28 ? '深' : S < 0.35 ? '灰调' : '';
    return pre + base;
  }
  function avgCorners(p, frac) {
    const w = p.w, h = p.h, d = p.data, n = Math.max(2, Math.round(Math.min(w, h) * (frac || 0.06)));
    const acc = [0, 0, 0, 0];
    const zones = [[0, 0], [w - n, 0], [0, h - n], [w - n, h - n]];
    for (let z = 0; z < 4; z++) for (let y = zones[z][1]; y < zones[z][1] + n; y++) for (let x = zones[z][0]; x < zones[z][0] + n; x++) {
      const q = (y * w + x) * 4; acc[0] += d[q]; acc[1] += d[q + 1]; acc[2] += d[q + 2]; acc[3]++;
    }
    return [acc[0] / acc[3], acc[1] / acc[3], acc[2] / acc[3]];
  }
  async function hashOf(blobOrBuf) {
    try {
      const buf = blobOrBuf instanceof Blob ? await blobOrBuf.arrayBuffer() : blobOrBuf;
      if (window.crypto && crypto.subtle) {
        const d = await crypto.subtle.digest('SHA-256', buf);
        return Array.prototype.map.call(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('');
      }
    } catch (e) { }
    return '';
  }
  /* ======================= 11. 通用表单构件（带 data-k，便于统一读取） ======================= */
  function boundsBox(tone, text) { return '<div class="' + (tone === 'note' ? 'outbox' : 'warnbox') + '">' + text + '</div>'; }
  function sld(k, label, min, max, val, step, unit) {
    return '<div class="plabel">' + esc(label) + '</div><div class="sliderrow">' +
      '<input type="range" id="' + k + '" data-k="' + k + '" min="' + min + '" max="' + max + '" step="' + (step == null ? 1 : step) + '" value="' + val + '">' +
      '<span class="val" id="' + k + 'V">' + val + (unit || '') + '</span></div>';
  }
  function optPair(o) {
    if (Array.isArray(o)) return { v: o[0], t: o.length > 1 ? o[1] : o[0] };
    if (o && typeof o === 'object') return { v: o.v !== undefined ? o.v : o, t: o.t !== undefined ? o.t : o };
    return { v: o, t: o };
  }
  function selk(k, label, opts, val) {
    return '<div class="plabel">' + esc(label) + '</div><select id="' + k + '" data-k="' + k + '">' + opts.map(function (o) {
      const p = optPair(o);
      return '<option value="' + esc(p.v) + '"' + (String(p.v) === String(val) ? ' selected' : '') + '>' + esc(p.t) + '</option>';
    }).join('') + '</select>';
  }
  function chkk(k, label, on) { return '<div class="chk' + (on ? ' on' : '') + '" id="' + k + '" data-k="' + k + '"><span class="box"><svg data-lucide="check" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg></span>' + esc(label) + '</div>'; }
  function colk(k, label, val) { return '<div class="plabel">' + esc(label) + '</div><input type="text" id="' + k + '" data-k="' + k + '" value="' + esc(val) + '" placeholder="#00ff00">'; }
  function numk(k, label, val) { return '<div class="plabel">' + esc(label) + '</div><input type="number" id="' + k + '" data-k="' + k + '" value="' + esc(val) + '">'; }
  function pills(k, label, opts, val, multi) {
    return '<div class="plabel">' + esc(label) + '</div><div class="shapes" data-pills="' + k + '"' + (multi ? ' data-multi="1"' : '') + '>' +
      opts.map(function (o) { const p = optPair(o); return '<button type="button" class="shape' + (String(p.v) === String(val) ? ' on' : '') + '" data-v="' + esc(p.v) + '">' + esc(p.t) + '</button>'; }).join('') + '</div>';
  }
  function readOpts(scope) {
    const o = {};
    $$('[data-k]', scope).forEach(e => {
      const k = e.getAttribute('data-k');
      if (e.classList.contains('chk')) o[k] = e.classList.contains('on');
      else if (e.type === 'range' || e.type === 'number') o[k] = parseFloat(e.value);
      else o[k] = e.value;
    });
    $$('[data-pills]', scope).forEach(g => {
      const k = g.getAttribute('data-pills');
      if (g.getAttribute('data-multi')) o[k] = $$('.shape.on', g).map(b => b.getAttribute('data-v'));
      else { const on = $('.shape.on', g); o[k] = on ? on.getAttribute('data-v') : null; }
    });
    return o;
  }

  /* ======================= 12. 图像工具通用框架 ======================= */
  function mkCtx(host, S, spec) {
    const T = window.TUI;
    const ctx = {
      host: host, S: S, spec: spec,
      prog(p) { T.prog($('#aiProg', host), p); },
      note(html) { const e = $('#aiOut', host); if (e) e.innerHTML = html; },
      report(html) { const e = $('#aiReport', host); if (e) e.innerHTML = html; },
      extra(html) { const e = $('#aiExtra', host); if (e) e.innerHTML = html; },
      download(blob, name) { if (blob) window.downloadBlob(blob, name); else toast('导出失败'); },
      toast: toast,
      esc: esc
    };
    return ctx;
  }
  function imgTool(host, cfg, slug, spec) {
    const T = window.TUI;
    const shell = T.shell(host, true);
    const stage = shell.stage, pane = shell.pane;
    const S = { opts: {}, src: null, srcCanvas: null, srcFile: null, srcName: '', out: null, running: false, extra: {} };
    S.slug = slug;
    const ctx = mkCtx(host, S, spec);

    stage.innerHTML =
      T.drop(spec.dropInner || ('<div class="ic">' + window.icon('image', 30) + '</div><h3>' + esc(spec.dropTitle || '选择一张图片') + '</h3><p>拖到这里、粘贴，或点击浏览</p>' +
        '<button class="btn-lime" type="button">' + window.icon('image', 16) + ' 选择图片 <span><svg data-lucide="arrow-right" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></span></button>'), spec.accept || 'image/*', false) +
      '<div id="aiLoaded" class="hide" style="flex:1;display:flex;flex-direction:column"></div>';

    pane.innerHTML =
      '<div class="ptitle">' + esc(spec.title) + '</div>' +
      (spec.desc ? '<div class="pdesc">' + spec.desc + '</div>' : '') +
      '<div id="aiCtl">' + (spec.pane ? spec.pane(S) : '') + '</div>' +
      (spec.bounds ? boundsBox(spec.boundsTone, spec.bounds) : '') +
      '<button class="btn-lime btn-run" id="aiRun">' + esc(spec.runLabel || '开始处理') + '</button>' +
      '<div class="progress" id="aiProg"><i></i></div>' +
      '<div class="outbox" id="aiOut">输出：—</div>' +
      '<div id="aiReport"></div>' +
      '<div class="runnote">' + (spec.note || '全部在浏览器本地完成，图片不会上传。') + '</div>';

    const pick = $('.drop button', host);
    if (pick) pick.addEventListener('click', e => { e.stopPropagation(); const fi = $('#tFile', host); if (fi) fi.click(); });
    T.bindDrop(host, spec.accept || 'image/*', false, files => load(files[0]));
    host.addEventListener('paste', e => {
      const f = (e.clipboardData && e.clipboardData.files) ? Array.prototype.slice.call(e.clipboardData.files).find(x => /^image\//.test(x.type)) : null;
      if (f) load(f);
    });

    async function load(f) {
      if (!f) return;
      if (!/^image\//.test(f.type) && !/\.(png|jpe?g|webp|avif|bmp|gif)$/i.test(f.name)) { toast('请选择图片文件'); return; }
      S.srcFile = f; S.srcName = f.name;
      try { const im = await loadImg(f); S.srcCanvas = imageToCanvas(im, spec.maxSide || 0); }
      catch (e) { toast(e.message || '读取失败'); return; }
      S.src = getP(S.srcCanvas);
      $('#tDrop', host).classList.add('hide');
      $('#aiLoaded', host).classList.remove('hide');
      buildLoaded();
      try { if (spec.onLoad) await spec.onLoad(S, ctx); } catch (e) { toast('初始化失败：' + (e && e.message || e)); }
      if (spec.autoRun !== false) run();
    }

    function buildLoaded() {
      const box = $('#aiLoaded', host);
      const cmp = spec.compare !== 'none';
      box.innerHTML = (cmp ?
        '<div class="canvaswrap" style="position:relative;padding:12px"><div id="cmpBox" style="position:relative;display:inline-block;max-width:100%;line-height:0">' +
        '<canvas id="outCanvas"></canvas>' +
        '<canvas id="origCanvas" style="position:absolute;left:0;top:0;width:100%;height:100%;clip-path:inset(0 50% 0 0)"></canvas>' +
        '<div id="cmpHandle" style="position:absolute;top:0;bottom:0;left:50%;width:2px;background:#6366f1;cursor:ew-resize"><span style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:26px;height:26px;border-radius:50%;background:#6366f1;color:#000;font-size:11px;display:flex;align-items:center;justify-content:center">⇄</span></div>' +
        '</div></div>' :
        '<div class="canvaswrap" style="position:relative;padding:12px"><div id="cmpBox" style="position:relative;display:inline-block;max-width:100%;line-height:0"><canvas id="outCanvas"></canvas></div></div>') +
        '<div class="filebar"><span><b id="srcName">' + esc(S.srcName) + '</b> <span id="srcMeta"></span></span><span class="newv" id="aiNew">换一张</span></div>' +
        '<div class="shapes" style="margin-top:12px">' +
        (cmp ? '<button type="button" class="shape on" data-cmp="slider">滑动对比</button><button type="button" class="shape" data-cmp="side">并排</button><button type="button" class="shape" data-cmp="toggle">切换</button>' : '') +
        '<button type="button" class="shape" id="aiDlOut">下载结果</button><button type="button" class="shape" id="aiDlSrc">下载原图</button>' +
        '</div>' +
        '<div id="aiExtra" style="margin-top:12px"></div>';

      const oc = $('#outCanvas', host);
      oc.width = S.srcCanvas.width; oc.height = S.srcCanvas.height;
      ctxOf(oc).drawImage(S.srcCanvas, 0, 0);
      const orc = $('#origCanvas', host);
      if (orc) { orc.width = S.srcCanvas.width; orc.height = S.srcCanvas.height; ctxOf(orc).drawImage(S.srcCanvas, 0, 0); }
      updMeta();
      $('#srcName', host).textContent = S.srcName;
      $('#aiNew', host).addEventListener('click', reset);
      $('#aiDlOut', host).addEventListener('click', () => {
        const c = $('#outCanvas', host);
        toBlob(c, spec.outMime || 'image/png').then(b => ctx.download(b, spec.outName ? spec.outName(S.opts, S) : fmtName(S.srcName, '-out', 'png')));
      });
      $('#aiDlSrc', host).addEventListener('click', () => { if (S.srcFile) ctx.download(S.srcFile, S.srcName); });
      const handle = $('#cmpHandle', host);
      if (handle) {
        const mv = ev => {
          const r = $('#cmpBox', host).getBoundingClientRect();
          const cx = (ev.touches && ev.touches[0] ? ev.touches[0].clientX : ev.clientX);
          const p = clamp((cx - r.left) / r.width, 0, 1);
          handle.style.left = (p * 100) + '%';
          orc.style.clipPath = 'inset(0 ' + ((1 - p) * 100) + '% 0 0)';
        };
        const start = ev => {
          ev.preventDefault();
          const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
          window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
        };
        handle.addEventListener('pointerdown', start);
        $('#cmpBox', host).addEventListener('pointerdown', ev => { if (ev.target === handle) return; mv(ev); start(ev); });
      }
      if (spec.bindStage) { try { spec.bindStage(S, ctx); } catch (e) { } }
      if (spec.stageExtra) { const e2 = $('#aiExtra', host); if (e2) e2.innerHTML = spec.stageExtra(S, ctx); }
    }
    function updMeta() {
      const m = $('#srcMeta', host);
      if (m) m.textContent = S.srcCanvas.width + '×' + S.srcCanvas.height + (S.out ? ' → ' + S.out.width + '×' + S.out.height : '');
    }
    function reset() {
      S.src = null; S.srcCanvas = null; S.srcFile = null; S.out = null;
      $('#aiLoaded', host).classList.add('hide');
      $('#tDrop', host).classList.remove('hide');
      ctx.report(''); ctx.extra(''); ctx.note('输出：—');
      const fi = $('#tFile', host); if (fi) fi.value = '';
      if (spec.onReset) { try { spec.onReset(S, ctx); } catch (e) { } }
    }

    async function run() {
      if (!S.src || S.running) return;
      S.running = true;
      const btn = $('#aiRun', host);
      if (btn) { btn.disabled = true; btn.textContent = '处理中…'; }
      ctx.prog(2);
      try {
        S.opts = readOpts($('#aiCtl', host));
        if (spec.pre) await spec.pre(S, ctx);
        const out = await spec.process(S.src, S.opts, p => ctx.prog(p), ctx, S);
        if (out) { S.out = out; paint(out); }
        if (spec.after) await spec.after(S, ctx);
        updMeta();
      } catch (e) {
        ctx.note('处理失败：' + esc(e && e.message || e));
        toast('处理失败：' + (e && e.message || e));
      }
      ctx.prog(100);
      if (btn) { btn.disabled = false; btn.textContent = spec.runLabel || '开始处理'; }
      S.running = false;
    }
    function paint(out) {
      const oc = $('#outCanvas', host); if (!oc) return;
      oc.width = out.width; oc.height = out.height;
      ctxOf(oc).drawImage(out, 0, 0);
      const orc = $('#origCanvas', host);
      if (orc) { orc.width = out.width; orc.height = out.height; ctxOf(orc).drawImage(S.srcCanvas, 0, 0, out.width, out.height); }
    }
    ctx.run = run; ctx.paint = paint; ctx.load = load; ctx.reset = reset; ctx.updMeta = updMeta;

    /* 统一交互：滑块数值 + 自动重跑 + 药丸切换 */
    let timer = null;
    const schedule = () => { if (!S.src) return; clearTimeout(timer); timer = setTimeout(run, 140); };
    host.addEventListener('input', e => {
      const t = e.target;
      if (t && t.getAttribute && t.getAttribute('data-k')) {
        const v = $('#' + t.getAttribute('data-k') + 'V', host);
        if (v && t.type === 'range') v.textContent = t.value + (v.textContent.replace(/[-\d.]/g, '').trim() || '');
        if (t.type === 'range') schedule();
        if (spec.onInput) { try { spec.onInput(t.getAttribute('data-k'), t.value, S, ctx); } catch (er) { } }
      }
    });
    host.addEventListener('change', e => {
      const t = e.target;
      if (t && t.getAttribute && t.getAttribute('data-k') && (t.tagName === 'SELECT' || t.type === 'number' || t.type === 'text')) schedule();
    });
    host.addEventListener('click', e => {
      const ck = e.target.closest('.chk[data-k]');
      if (ck) { ck.classList.toggle('on'); schedule(); return; }
      const pl = e.target.closest('[data-pills] .shape');
      if (pl) {
        const g = pl.parentElement;
        if (g.getAttribute('data-multi')) pl.classList.toggle('on');
        else { $$('.shape', g).forEach(b => b.classList.remove('on')); pl.classList.add('on'); }
        schedule(); return;
      }
      const cm = e.target.closest('[data-cmp]');
      if (cm) {
        $$('[data-cmp]', host).forEach(b => b.classList.remove('on'));
        cm.classList.add('on');
        const mode = cm.getAttribute('data-cmp');
        const box = $('#cmpBox', host), orc = $('#origCanvas', host), oc2 = $('#outCanvas', host), hd = $('#cmpHandle', host);
        if (!box || !orc) return;
        if (mode === 'side') {
          box.style.display = 'flex'; box.style.gap = '8px'; box.style.alignItems = 'flex-start';
          orc.style.position = 'static'; orc.style.clipPath = 'none'; orc.style.maxWidth = '48%'; oc2.style.maxWidth = '48%';
          if (hd) hd.style.display = 'none';
        } else if (mode === 'toggle') {
          box.style.display = 'block';
          orc.style.position = 'absolute'; orc.style.clipPath = 'none'; orc.style.maxWidth = '100%'; oc2.style.maxWidth = '100%';
          if (hd) hd.style.display = 'none';
          const showOrig = orc.style.opacity !== '1';
          orc.style.opacity = showOrig ? '1' : '0';
        } else {
          box.style.display = 'inline-block';
          orc.style.position = 'absolute'; orc.style.maxWidth = '100%'; oc2.style.maxWidth = '100%'; orc.style.opacity = '1';
          orc.style.clipPath = 'inset(0 50% 0 0)';
          if (hd) { hd.style.display = 'block'; hd.style.left = '50%'; }
        }
        return;
      }
      if (e.target.closest('#aiRun')) { run(); }
    });

    if (spec.mountAfter) { try { spec.mountAfter(S, ctx); } catch (e) { } }
  }

  /* ======================= 13. 音视频工具通用框架 ======================= */
  function avTool(host, cfg, slug, spec) {
    const T = window.TUI;
    const shell = T.shell(host, true);
    const stage = shell.stage, pane = shell.pane;
    const S = { opts: {}, file: null, name: '', outBlob: null, outUrl: null, info: {}, ff: null };
    S.slug = slug;
    const ctx = {
      host: host, S: S, spec: spec, esc: esc, toast: toast,
      prog(p) { T.prog($('#aiProg', host), p); },
      note(html) { const e = $('#aiOut', host); if (e) e.innerHTML = html; }
    };

    stage.innerHTML =
      T.drop(spec.dropInner || ('<div class="ic">' + window.icon(spec.kind === 'audio' ? 'audio' : 'video', 30) + '</div><h3>' + esc(spec.dropTitle || '选择文件') + '</h3><p>拖到这里，或点击浏览</p>' +
        '<button class="btn-lime" type="button">' + window.icon(spec.kind === 'audio' ? 'audio' : 'video', 16) + ' 选择文件 <span><svg data-lucide="arrow-right" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></span></button>'), spec.accept, false) +
      '<div id="avLoaded" class="hide" style="flex:1;display:flex;flex-direction:column"></div>';

    pane.innerHTML =
      '<div class="ptitle">' + esc(spec.title) + '</div>' +
      (spec.desc ? '<div class="pdesc">' + spec.desc + '</div>' : '') +
      '<div id="avCtl">' + (spec.pane ? spec.pane(S) : '') + '</div>' +
      (spec.bounds ? boundsBox(spec.boundsTone, spec.bounds) : '') +
      '<button class="btn-lime btn-run" id="aiRun">' + esc(spec.runLabel || '开始处理') + '</button>' +
      '<div class="progress" id="aiProg"><i></i></div>' +
      '<div class="outbox" id="aiOut">输出：—</div>' +
      '<div id="aiReport"></div>' +
      '<div class="runnote">' + (spec.note || '使用 ffmpeg.wasm 在本机转码，不上传文件；耗时取决于你的设备与文件大小。') + '</div>';

    const pick = $('.drop button', host);
    if (pick) pick.addEventListener('click', e => { e.stopPropagation(); const fi = $('#tFile', host); if (fi) fi.click(); });
    T.bindDrop(host, spec.accept, false, files => load(files[0]));

    async function load(f) {
      if (!f) return;
      S.file = f; S.name = f.name;
      $('#tDrop', host).classList.add('hide');
      $('#avLoaded', host).classList.remove('hide');
      const box = $('#avLoaded', host);
      box.innerHTML =
        (spec.kind === 'audio'
          ? '<div class="canvaswrap" style="padding:20px"><audio id="aiMedia" controls style="width:100%"></audio></div>'
          : '<div class="preview"><video id="aiMedia" controls playsinline></video></div>') +
        '<div class="filebar"><span><b>' + esc(f.name) + '</b> <span id="avMeta">' + window.fmtSize(f.size) + '</span></span><span class="newv" id="aiNew">换一个</span></div>' +
        '<div id="aiExtra" style="margin-top:12px"></div>' +
        '<div class="shapes" style="margin-top:12px"><button type="button" class="shape" id="aiDl">下载结果</button></div>';
      const url = URL.createObjectURL(f);
      const media = $('#aiMedia', host);
      media.src = url;
      if (spec.kind === 'video') {
        media.onloadedmetadata = () => { S.info.w = media.videoWidth; S.info.h = media.videoHeight; S.info.dur = media.duration; updMeta(); };
      } else {
        const ac = new (window.AudioContext || window.webkitAudioContext)();
        ac.decodeAudioData(await f.arrayBuffer()).then(buf => { S.info.dur = buf.duration; S.info.sr = buf.sampleRate; S.info.ch = buf.numberOfChannels; updMeta(); ac.close(); },
          () => { try { ac.close(); } catch (e) { } });
      }
      $('#aiNew', host).addEventListener('click', () => {
        try { URL.revokeObjectURL(url); } catch (e) { }
        S.file = null; S.outBlob = null;
        $('#avLoaded', host).classList.add('hide'); $('#tDrop', host).classList.remove('hide');
        const fi = $('#tFile', host); if (fi) fi.value = '';
      });
      $('#aiDl', host).addEventListener('click', () => { if (S.outBlob) window.downloadBlob(S.outBlob, spec.outName ? spec.outName(S.opts, S) : ('out' + (spec.ext || '.mp4'))); else toast('还没有结果'); });
      if (spec.onLoad) { try { await spec.onLoad(S, ctx); } catch (e) { toast('初始化失败：' + (e && e.message || e)); } }
    }
    function updMeta() {
      const m = $('#avMeta', host); if (!m) return;
      const p = [window.fmtSize(S.file ? S.file.size : 0)];
      if (S.info.dur) p.push(S.info.dur.toFixed(1) + 's');
      if (S.info.w) p.push(S.info.w + '×' + S.info.h);
      if (S.info.sr) p.push(S.info.sr + 'Hz ' + (S.info.ch || 1) + 'ch');
      m.textContent = p.filter(Boolean).join(' · ');
    }
    ctx.updMeta = updMeta;

    host.addEventListener('input', e => {
      const t = e.target;
      if (t && t.getAttribute && t.getAttribute('data-k') && t.type === 'range') {
        const v = $('#' + t.getAttribute('data-k') + 'V', host);
        if (v) v.textContent = t.value + (v.textContent.replace(/[-\d.]/g, '').trim() || '');
      }
    });
    host.addEventListener('click', e => {
      const ck = e.target.closest('.chk[data-k]');
      if (ck) { ck.classList.toggle('on'); return; }
      const pl = e.target.closest('[data-pills] .shape');
      if (pl) { const g = pl.parentElement; $$('.shape', g).forEach(b => b.classList.remove('on')); pl.classList.add('on'); return; }
      if (e.target.closest('#aiRun')) run();
    });

    async function run() {
      if (!S.file) { toast('请先选择文件'); return; }
      S.opts = readOpts($('#avCtl', host));
      const btn = $('#aiRun', host); if (btn) { btn.disabled = true; btn.textContent = '处理中…'; }
      ctx.prog(1);
      try {
        if (spec.pre) await spec.pre(S, ctx);
        const ff = await getFF(p => ctx.prog(p), null);
        S.ff = ff;
        const inName = 'in_' + Date.now() + (spec.inExt || '.mp4');
        await ff.writeFile(inName, new Uint8Array(await S.file.arrayBuffer()));
        const outName = 'out_' + Date.now() + (spec.ext || '.mp4');
        const args = spec.buildArgs(S.opts, S, inName, outName);
        ctx.note('正在转码… <b>0%</b>');
        await ff.exec(args);
        const data = await ff.readFile(outName);
        try { await ff.deleteFile(outName); await ff.deleteFile(inName); } catch (e) { }
        const blob = new Blob([data], { type: spec.outMime || 'video/mp4' });
        S.outBlob = blob;
        const media = $('#aiMedia', host);
        if (media) { try { URL.revokeObjectURL(S.outUrl); } catch (e) { } S.outUrl = URL.createObjectURL(blob); media.src = S.outUrl; media.play && media.play().catch(() => { }); }
        ctx.note('完成：<b>' + esc(spec.outName ? spec.outName(S.opts, S) : outName) + '</b> · ' + window.fmtSize(blob.size));
        if (spec.after) await spec.after(S, ctx, blob);
      } catch (e) {
        ctx.note('处理失败：' + esc((e && e.message) || String(e)) + '（可能是浏览器内存不足或该编码在当前核心不可用）');
        toast('处理失败：' + ((e && e.message) || e));
      }
      ctx.prog(100);
      if (btn) { btn.disabled = false; btn.textContent = spec.runLabel || '开始处理'; }
    }
    ctx.run = run; ctx.load = load;
    if (spec.mountAfter) { try { spec.mountAfter(S, ctx); } catch (e) { } }
  }

  /* 取视频某一帧为 canvas（用于自动取色） */
  function grabFrame(file, time) {
    return new Promise(res => {
      const v = document.createElement('video');
      const url = URL.createObjectURL(file);
      let done = false;
      const fin = () => { if (done) return; done = true; try { URL.revokeObjectURL(url); } catch (e) { } res(canvasOf(v.videoWidth || 2, v.videoHeight || 2)); };
      v.muted = true; v.preload = 'auto';
      v.onloadeddata = () => { try { v.currentTime = Math.min(time || 0.5, (v.duration || 1) * 0.4); } catch (e) { fin(); } };
      v.onseeked = () => fin();
      v.onerror = () => fin();
      v.src = url;
      setTimeout(fin, 6000);
    });
  }
  /* ======================= 14. 图像算法补充 ======================= */
  function P2canvas(p) { const c = canvasOf(p.w, p.h); putP(c, p); return c; }
  function maskToWeights(m, w, h, sigma) {
    const g = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) g[i] = m[i] ? 255 : 0;
    return gaussBlurGray(g, w, h, sigma || Math.max(1, Math.min(w, h) * 0.004));
  }
  function blendByWeight(base, target, wt, w, h, scale) {
    const o = copyP(base), bd = o.data, td = target.data;
    const s = scale == null ? 1 : scale;
    for (let i = 0; i < w * h; i++) {
      const a = clamp(wt[i] / 255, 0, 1) * s, q = i * 4;
      bd[q] += (td[q] - bd[q]) * a; bd[q + 1] += (td[q + 1] - bd[q + 1]) * a; bd[q + 2] += (td[q + 2] - bd[q + 2]) * a;
    }
    return o;
  }
  function skinMask(p) {
    const w = p.w, h = p.h, d = p.data, m = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const q = i * 4, r = d[q], g = d[q + 1], b = d[q + 2];
      if (d[q + 3] < 40) continue;
      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = mx ? (mx - mn) / mx : 0;
      if (cb >= 76 && cb <= 128 && cr >= 132 && cr <= 174 && y > 55 && sat < 0.74) m[i] = 1;
    }
    return m;
  }
  /* 边缘墨线叠加 */
  function edgeOverlay(p, gray, thresh, thick, strength) {
    const w = p.w, h = p.h, sb = sobel(gray, w, h), mag = sb.mag;
    const hist = new Float32Array(512);
    for (let i = 0; i < mag.length; i++) hist[clamp(mag[i] / 4, 0, 511) | 0]++;
    const total = w * h; let acc = 0, cut = total * (thresh == null ? 0.06 : thresh / 100);
    let lvl = 40;
    for (let i = 511; i >= 0; i--) { acc += hist[i]; if (acc > cut) { lvl = i * 4; break; } }
    let mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) mask[i] = mag[i] > lvl ? 1 : 0;
    if (thick > 0) mask = dilateMask(mask, w, h, thick);
    const s = (strength == null ? 0.8 : strength / 100);
    const o = copyP(p), od = o.data;
    for (let i = 0; i < w * h; i++) if (mask[i]) {
      const q = i * 4;
      od[q] *= (1 - s); od[q + 1] *= (1 - s); od[q + 2] *= (1 - s);
    }
    return o;
  }
  /* 亮度层级量化 */
  function levelsQuantize(p, levels, blend) {
    const o = copyP(p), d = p.data, od = o.data, n = p.w * p.h;
    const L = Math.max(2, levels | 0), step = 255 / (L - 1), a = blend == null ? 1 : blend;
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) {
      const q = i * 4 + c, v = Math.round(Math.round(d[q] / step) * step);
      od[q] = d[q] + (v - d[q]) * a;
    }
    return o;
  }
  /* 反卷积近似（多次不同半径的反锐化，模拟去模糊） */
  async function deconvolveApprox(p, sigma, amount, iters, prog) {
    let cur = p;
    const n = Math.max(1, iters | 0);
    for (let i = 0; i < n; i++) {
      const r = Math.max(0.6, sigma * (1 - i / (n + 1)));
      cur = unsharp(cur, r, amount, 0);
      if (prog) prog((i + 1) / n);
      await sleep();
    }
    return cur;
  }
  /* 局部径向挤压（瘦脸 / 液化） */
  function warpSqueeze(p, cx, cy, radius, strength, dirX) {
    const w = p.w, h = p.h, d = p.data, o = new Uint8ClampedArray(d.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let dx = x - cx, dy = y - cy;
      if (dirX) dx /= 1.9;
      const dist = Math.sqrt(dx * dx + dy * dy);
      let sx = x, sy = y;
      if (dist < radius) {
        const f = 1 - dist / radius;
        const k = 1 + strength * f * f;
        sx = cx + (x - cx) / k; sy = cy + (y - cy) / k;
      }
      const ix = clamp(Math.round(sx), 0, w - 1), iy = clamp(Math.round(sy), 0, h - 1);
      const q = (y * w + x) * 4, t = (iy * w + ix) * 4;
      o[q] = d[t]; o[q + 1] = d[t + 1]; o[q + 2] = d[t + 2]; o[q + 3] = d[t + 3];
    }
    return { w: w, h: h, data: o };
  }
  /* 用扩散法填充 mask 区域（内容感知填充的简化版） */
  async function inpaintDiffusion(p, mask, iters, prog, mirrorFill) {
    const w = p.w, h = p.h;
    let cur = copyP(p);
    const m = mask;
    // 初始化：把待填区域用镜像/邻域均值先铺一遍
    if (mirrorFill) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x; if (!m[i]) continue;
        let sx = x, sy = y, k = 0;
        while (k < 60 && m[sy * w + sx]) { sx = clamp(sx + 1, 0, w - 1); sy = clamp(sy + 1, 0, h - 1); k++; }
        const t = (sy * w + sx) * 4, q = i * 4;
        cur.data[q] = p.data[t]; cur.data[q + 1] = p.data[t + 1]; cur.data[q + 2] = p.data[t + 2];
      }
    }
    const N = Math.max(1, iters | 0);
    for (let it = 0; it < N; it++) {
      const src = cur, next = copyP(cur), nd = next.data, sd = src.data;
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = y * w + x; if (!m[i]) continue;
        let r = 0, g = 0, b = 0, c = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const t = ((y + dy) * w + (x + dx)) * 4;
          r += sd[t]; g += sd[t + 1]; b += sd[t + 2]; c++;
        }
        const q = i * 4;
        nd[q] = r / c; nd[q + 1] = g / c; nd[q + 2] = b / c;
      }
      cur = next;
      if (prog) prog((it + 1) / N);
      if (it % 3 === 0) await sleep();
    }
    return cur;
  }
  /* ======================= 15. 图像工具注册表 ======================= */
  const IMG = {};
  function defImg(slug, spec) { IMG[slug] = spec; }
  function composeOver(canvas, alpha, bgCanvasOrColor) {
    const w = canvas.width, h = canvas.height;
    const out = canvasOf(w, h), c = ctxOf(out);
    if (bgCanvasOrColor && bgCanvasOrColor.getContext) c.drawImage(bgCanvasOrColor, 0, 0, w, h);
    else { c.fillStyle = bgCanvasOrColor || '#ffffff'; c.fillRect(0, 0, w, h); }
    const lay = canvasOf(w, h), lc = ctxOf(lay);
    lc.drawImage(canvas, 0, 0);
    const d = lc.getImageData(0, 0, w, h);
    for (let i = 0; i < w * h; i++) d.data[i * 4 + 3] = alpha ? alpha[i] : 255;
    lc.putImageData(d, 0, 0);
    c.drawImage(lay, 0, 0);
    return out;
  }
  function transparentFrom(canvas, alpha) {
    const w = canvas.width, h = canvas.height;
    const out = canvasOf(w, h), c = ctxOf(out);
    c.drawImage(canvas, 0, 0);
    const d = c.getImageData(0, 0, w, h);
    for (let i = 0; i < w * h; i++) d.data[i * 4 + 3] = alpha ? (alpha[i] * d.data[i * 4 + 3] / 255) : d.data[i * 4 + 3];
    c.putImageData(d, 0, 0);
    return out;
  }

  /* ---- 15.1 背景移除 / 抠图 ---- */
  defImg('background-remover', {
    title: '移除背景（本地颜色抠图）',
    desc: '从四角/边缘自动采样背景色，用颜色距离 + 泛洪填充生成透明通道，也可手动取色或替换为自己的背景图。',
    maxSide: 1600,
    boundsTone: 'warn',
    bounds: '能力边界：本页是<b>颜色键控 + 泛洪填充的本地抠图</b>，不是 AI 语义分割。纯色或简单背景（白墙、绿幕、影棚光、天空）效果最好；头发丝、半透明、与背景颜色接近的情况会残留或毛边。复杂背景请使用专门的 AI 抠图服务。',
    pane: function () {
      return selk('mode', '取色方式', [['auto', '自动（四角/边缘采样）'], ['manual', '手动取色'], ['inverse', '反向：移除取色相同的区域']], 'auto') +
        colk('key', '手动取色', '#ffffff') +
        sld('tol', '颜色容差', 8, 180, 46, 1) +
        sld('feather', '边缘羽化', 0, 24, 4, 1) +
        sld('shrink', '边缘收缩（去白边）', 0, 8, 0, 1) +
        chkk('flood', '只移除与画面边缘连通的背景（更安全）', true) +
        selk('bg', '输出', [['transparent', '透明 PNG'], ['solid', '纯色背景'], ['image', '用我的图片替换背景']], 'transparent') +
        colk('bgcolor', '纯色背景色', '#ffffff') +
        '<div class="plabel">背景图片（bg=image 时生效）</div><div class="drop-mini" id="bgPick">点击选择一张背景图</div>' +
        '<input type="file" id="bgFile" accept="image/*" style="display:none">';
    },
    mountAfter: function (S, ctx) {
      const d = $('#bgPick', ctx.host), fi = $('#bgFile', ctx.host);
      if (d && fi) {
        d.addEventListener('click', () => fi.click());
        fi.addEventListener('change', async () => {
          if (fi.files[0]) { try { S.extra.bg = imageToCanvas(await loadImg(fi.files[0])); d.textContent = '已选择：' + fi.files[0].name; d.style.borderColor = '#d7f452'; } catch (e) { toast('背景图读取失败'); } }
        });
      }
    },
    outName: function (o, S) { return fmtName(S.srcName, '-nobg', o.bg === 'transparent' ? 'png' : 'jpg'); },
    process: async function (src, o, prog, ctx, S) {
      const w = src.w, h = src.h, d = src.data;
      const K = (o.mode === 'auto') ? avgCorners(src, 0.075) : hex2rgb(o.key || '#ffffff');
      const tol = o.tol, t1 = tol + Math.max(8, o.feather * 3 + 6);
      let alpha = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) {
        const q = i * 4;
        if (d[q + 3] < 20) { alpha[i] = 0; continue; }
        const dist = distColor(d[q], d[q + 1], d[q + 2], K);
        alpha[i] = dist <= tol ? 0 : dist >= t1 ? 255 : Math.round((dist - tol) / (t1 - tol) * 255);
      }
      prog(25);
      await sleep();
      if (o.mode === 'inverse') { for (let i = 0; i < alpha.length; i++) alpha[i] = 255 - alpha[i]; }
      if (o.flood) {
        const bgBin = new Uint8Array(w * h);
        for (let i = 0; i < alpha.length; i++) bgBin[i] = alpha[i] < 128 ? 1 : 0;
        const lab = labelComponents(bgBin, w, h);
        const keep = new Uint8Array(lab.count);
        for (let x = 0; x < w; x++) { const a = lab.labels[x], b = lab.labels[(h - 1) * w + x]; if (a >= 0) keep[a] = 1; if (b >= 0) keep[b] = 1; }
        for (let y = 0; y < h; y++) { const a = lab.labels[y * w], b = lab.labels[y * w + w - 1]; if (a >= 0) keep[a] = 1; if (b >= 0) keep[b] = 1; }
        for (let i = 0; i < alpha.length; i++) { const l = lab.labels[i]; if (l >= 0 && !keep[l]) alpha[i] = 255; }
      }
      prog(55);
      await sleep();
      let bin = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) bin[i] = alpha[i] > 127 ? 255 : 0;
      let m = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) m[i] = bin[i] ? 1 : 0;
      if (o.shrink > 0) { m = erodeMask(m, w, h, o.shrink); for (let i = 0; i < w * h; i++) bin[i] = m[i] ? 255 : 0; }
      const sigma = Math.max(0.6, o.feather * 0.55 + 0.5);
      const soft = gaussBlurGray(bin, w, h, sigma);
      const A = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) A[i] = clamp255(soft[i]);
      prog(80);
      await sleep();
      const srcC = canvasOf(w, h); putP(srcC, src);
      let out;
      if (o.bg === 'solid') out = composeOver(srcC, A, o.bgcolor || '#ffffff');
      else if (o.bg === 'image' && S.extra.bg) out = composeOver(srcC, A, S.extra.bg);
      else out = transparentFrom(srcC, A);
      // 统计
      let fg = 0; for (let i = 0; i < w * h; i++) if (A[i] > 127) fg++;
      S.extra.stat = { key: hexOf(K[0], K[1], K[2]), ratio: fg / (w * h) };
      prog(100);
      return out;
    },
    after: function (S, ctx) {
      const st = S.extra.stat || {};
      ctx.note('输出：<b>' + (S.opts.bg === 'transparent' ? '透明 PNG' : '合成图') + '</b> · 背景色 ' + esc(st.key || '') + ' · 前景占比 <b>' + ((st.ratio || 0) * 100).toFixed(1) + '%</b>');
    }
  });
  defImg('remove-background', IMG['background-remover']);

  /* ---- 15.2 图像放大 / 提分辨率 ---- */
  function upscaleSpec(slug, title) {
    defImg(slug, {
      title: title,
      desc: 'Lanczos-3 重采样 + 反锐化掩模 + 可选去噪，把图片放大 2×/3×/4×。',
      boundsTone: 'warn',
      bounds: '能力边界：这是<b>高质量传统插值（Lanczos-3）</b>，不是超分神经网络。它能干净地放大、并靠锐化提升观感，但不会“无中生有”地补出真实纹理细节；4× 时的细节不如 AI 超分模型。好处是 100% 本地、不上传、不排队。',
      runLabel: '放大并导出',
      outName: function (o, S) { return fmtName(S.srcName, '-' + o.scale + 'x', 'png'); },
      pane: function () {
        return selk('scale', '放大倍数', [['2', '2×'], ['3', '3×'], ['4', '4×']], '2') +
          sld('preDenoise', '放大前去噪', 0, 6, 0, 1) +
          sld('sharpen', '锐化强度', 0, 220, 70, 5) +
          sld('sharpenRadius', '锐化半径', 0.5, 4, 1.1, 0.1) +
          chkk('demoire', '去除轻微彩色噪点（中值 1px）', false);
      },
      process: async function (src, o, prog, ctx, S) {
        const sc = parseInt(o.scale, 10) || 2;
        let cur = src;
        if (o.demoire) { cur = medianFilter(cur, 1); prog(6); await sleep(); }
        if (o.preDenoise > 0) { cur = gaussBlur(cur, o.preDenoise * 0.35); prog(12); await sleep(); }
        const maxPix = 42e6;
        let tw = Math.round(cur.w * sc), th = Math.round(cur.h * sc);
        if (tw * th > maxPix) { const f = Math.sqrt(maxPix / (tw * th)); tw = Math.round(tw * f); th = Math.round(th * f); }
        S.extra.outSize = tw + '×' + th;
        const big = await lanczosResize(cur, tw, th, p => prog(12 + p * 0.7));
        let out = P2canvas(big);
        let p2 = big;
        if (o.sharpen > 0) { p2 = unsharp(p2, o.sharpenRadius * sc * 0.7, o.sharpen / 100, 0); out = P2canvas(p2); }
        prog(100);
        return out;
      },
      after: function (S, ctx) {
        ctx.note('已放大到 <b>' + esc(S.extra.outSize || '') + '</b>（Lanczos-3 插值 + 反锐化）');
        ctx.report(boundsBox('note', '放大后仍是从原图像素插值得到，超出原始分辨率的部分没有真实细节。若需要真实细节重建，请使用 AI 超分模型。'));
      }
    });
  }
  upscaleSpec('image-upscaler', '图片放大（Lanczos 插值）');
  upscaleSpec('increase-image-resolution', '提升图片分辨率（Lanczos 插值）');

  /* ---- 15.3 去模糊 / 画质增强 ---- */
  function enhanceSpec(slug, title, forcedMode) {
    defImg(slug, {
      title: title,
      desc: '维纳滤波近似（多次反锐化）+ 自适应对比度 CLAHE + 可选去噪，缓解轻微模糊与灰雾。',
      boundsTone: 'warn',
      bounds: '能力边界：这是<b>经典图像复原</b>（反锐化/去卷积近似 + CLAHE 对比度重塑），不是生成式超分。轻微运动模糊、失焦、雾霾感会有明显改善；严重的模糊（大范围一致模糊、缺乏信息）无法被“还原”出来——那需要神经网络模型。',
      runLabel: '增强并导出',
      outName: function (o, S) { return fmtName(S.srcName, '-' + (forcedMode || o.mode), 'png'); },
      pane: function () {
        return (forcedMode ? '' : selk('mode', '处理模式', [['deblur', '去模糊（锐化为主）'], ['enhance', '画质增强（对比+色彩）'], ['both', '两者都做']], 'both')) +
          sld('amount', '锐化/去卷积强度', 20, 300, 110, 5) +
          sld('radius', '模糊半径估计', 0.5, 6, 1.6, 0.1) +
          sld('iters', '反卷积迭代次数', 1, 6, 3, 1) +
          sld('clahe', '对比度（CLAHE）', 0, 100, 40, 5) +
          sld('denoise', '去噪强度', 0, 60, 10, 5) +
          chkk('autoLevel', '自动色阶', true);
      },
      process: async function (src, o, prog, ctx, S) {
        const mode = forcedMode || o.mode;
        let cur = src;
        if (o.denoise > 0) { cur = bilateral(cur, 2, 2.2, o.denoise); prog(10); await sleep(); }
        if (mode !== 'enhance') { cur = await deconvolveApprox(cur, o.radius, o.amount / 100, o.iters, p => prog(10 + p * 45)); }
        let canvas = P2canvas(cur);
        if (mode !== 'deblur') {
          if (o.clahe > 0) {
            const g = grayArr(cur);
            const eq = clahe(g, cur.w, cur.h, 8, 2.0 + o.clahe / 40);
            const out = copyP(cur);
            for (let i = 0; i < cur.w * cur.h; i++) {
              const q = i * 4, ratio = eq[i] / Math.max(1, g[i]);
              out.data[q] = clamp255(out.data[q] * ratio);
              out.data[q + 1] = clamp255(out.data[q + 1] * ratio);
              out.data[q + 2] = clamp255(out.data[q + 2] * ratio);
            }
            cur = out; prog(75); await sleep();
          }
          if (o.autoLevel) {
            const g = grayArr(cur), al = autoLevels(g, cur.w, cur.h, 0.004);
            const out = copyP(cur);
            for (let i = 0; i < cur.w * cur.h; i++) {
              const q = i * 4, ratio = al[i] / Math.max(1, g[i]);
              out.data[q] = clamp255(out.data[q] * ratio);
              out.data[q + 1] = clamp255(out.data[q + 1] * ratio);
              out.data[q + 2] = clamp255(out.data[q + 2] * ratio);
            }
            cur = out; prog(88); await sleep();
          }
          canvas = P2canvas(cur);
        }
        prog(100);
        return canvas;
      },
      after: function (S, ctx) { ctx.note('已完成（' + esc(forcedMode || S.opts.mode) + ' 模式）'); }
    });
  }
  enhanceSpec('unblur-image', '图片去模糊', null);
  enhanceSpec('enhance-photo-quality', '照片画质增强', null);
  enhanceSpec('face-enhancer', '人脸照片增强（全图）', null);

  /* ---- 15.4 降噪 ---- */
  defImg('noise-remover', {
    title: '图片降噪',
    desc: '中值滤波 + 双边滤波 + 简化版非局部均值（NL-Means），可在「去噪力度」和「细节保留」之间权衡。',
    boundsTone: 'warn',
    bounds: '能力边界：这是<b>经典空域/非局部去噪</b>。它对亮度噪点、JPEG 块噪、彩色噪点有效；但会把细小纹理一起抹平——「细节保留」滑块就是用来找平衡的。它不是基于学习的降噪模型，无法同时做到完全去噪 + 100% 保留纹理。',
    runLabel: '降噪并导出',
    outName: function (o, S) { return fmtName(S.srcName, '-denoised', 'png'); },
    pane: function () {
      return selk('method', '算法', [['median', '中值滤波（最快，去椒盐）'], ['bilateral', '双边滤波（保边平滑）'], ['nlmeans', '非局部均值（最好，最慢）'], ['combo', '组合：中值 + 双边 + NL']], 'combo') +
        sld('strength', '去噪力度', 0, 100, 45, 5) +
        sld('detail', '细节保留', 0, 100, 55, 5) +
        sld('color', '彩色噪点抑制', 0, 100, 40, 5);
    },
    process: async function (src, o, prog, ctx, S) {
      const s = o.strength / 100, det = 1 - o.detail / 100;
      let cur = src;
      const m = o.method;
      if (m === 'median' || m === 'combo') { cur = medianFilter(cur, Math.max(1, Math.round(1 + s * 2))); prog(25); await sleep(); }
      if (m === 'bilateral' || m === 'combo') { cur = bilateral(cur, 1 + Math.round(s * 2), 1.6 + s * 2.4, 12 + s * 40 + det * 20); prog(55); await sleep(); }
      if (m === 'nlmeans' || m === 'combo') { cur = nlMeans(cur, 6 + s * 26, 2, 1); prog(92); await sleep(); }
      if (o.color > 0) {
        // 色度降噪：CbCr 平面单独平滑
        const g1 = new Float32Array(cur.w * cur.h), g2 = new Float32Array(cur.w * cur.h);
        for (let i = 0; i < cur.w * cur.h; i++) { const q = i * 4; const y = rgb2ycbcr(cur.data[q], cur.data[q + 1], cur.data[q + 2]); g1[i] = y[1]; g2[i] = y[2]; }
        const s1 = gaussBlurGray(g1, cur.w, cur.h, 1 + o.color / 20), s2 = gaussBlurGray(g2, cur.w, cur.h, 1 + o.color / 20);
        const out = copyP(cur);
        for (let i = 0; i < cur.w * cur.h; i++) {
          const q = i * 4, y = rgb2ycbcr(cur.data[q], cur.data[q + 1], cur.data[q + 2]);
          const rgb = ycbcr2rgb(y[0], s1[i], s2[i]);
          out.data[q] = clamp255(rgb[0]); out.data[q + 1] = clamp255(rgb[1]); out.data[q + 2] = clamp255(rgb[2]);
        }
        cur = out; prog(97); await sleep();
      }
      prog(100);
      return P2canvas(cur);
    },
    after: function (S, ctx) { ctx.note('降噪完成（' + esc(S.opts.method) + '）'); }
  });

  /* ---- 15.5 铅笔画 ---- */
  defImg('photo-to-sketch', {
    title: '照片转素描',
    desc: '经典铅笔画算法：灰度 → 反相 → 高斯模糊 → 颜色减淡混合，可叠加边缘并调节笔触与反差。',
    boundsTone: 'note',
    bounds: '这是<b>真实实现的经典铅笔画算法</b>（颜色减淡混合，Color Dodge），完全本地计算，不是 AI 生成。它输出的是线性素描效果，不含手绘笔触纹理；想要“手绘风”可再叠加纸张纹理（本站另有纹理叠加工具）。',
    runLabel: '生成素描',
    outName: function (o, S) { return fmtName(S.srcName, '-sketch', 'png'); },
    pane: function () {
      return sld('blur', '模糊半径（笔触粗细）', 1, 18, 6, 1) +
        sld('contrast', '反差', 30, 200, 100, 5) +
        chkk('edges', '叠加边缘线稿', true) +
        sld('edgeThresh', '边缘灵敏度', 1, 30, 8, 1) +
        sld('edgeStrength', '边缘强度', 10, 100, 70, 5) +
        chkk('invert', '反相（白底 → 黑底）', false);
    },
    process: async function (src, o, prog, ctx, S) {
      const w = src.w, h = src.h;
      const g = grayArr(src);
      prog(20); await sleep();
      const inv = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) inv[i] = 255 - g[i];
      const blur = gaussBlurGray(inv, w, h, o.blur);
      prog(55); await sleep();
      const out = newP(w, h);
      const k = o.contrast / 100;
      for (let i = 0; i < w * h; i++) {
        const bg = Math.max(1, 255 - blur[i]);
        let v = clamp255(g[i] * 255 / bg);
        v = clamp255(128 + (v - 128) * k);
        const q = i * 4;
        out.data[q] = out.data[q + 1] = out.data[q + 2] = v; out.data[q + 3] = src.data[q + 3];
      }
      let p = out;
      if (o.edges) { p = edgeOverlay(p, g, o.edgeThresh, 0, o.edgeStrength); }
      prog(85); await sleep();
      if (o.invert) { for (let i = 0; i < p.data.length; i += 4) { p.data[i] = 255 - p.data[i]; p.data[i + 1] = 255 - p.data[i + 1]; p.data[i + 2] = 255 - p.data[i + 2]; } }
      prog(100);
      return P2canvas(p);
    }
  });

  /* ---- 15.6 卡通 ---- */
  function cartoonSpec(slug, title, anime) {
    defImg(slug, {
      title: title,
      desc: anime ? '更激进的色彩量化（K-means）+ 平涂 + 强化边缘墨线 + 可选柔光叠加，做动漫风近似。' : '双边滤波平滑 + 色彩量化 + 边缘检测叠加墨线，得到卡通/漫画风格。',
      boundsTone: anime ? 'warn' : 'note',
      bounds: anime
        ? '能力边界：这是<b>本地风格化近似</b>（色彩聚类 + 平涂 + 边缘强化），不是扩散模型生成的动漫图。它不会补出新发型、新服装或新画风；只是把现有像素重新配色并描边。若需要真正的动漫化，请使用 AI 图像风格迁移服务。'
        : '这是<b>真实实现的卡通化流水线</b>（保边平滑 → 色彩量化 → 边缘墨线），全部本地计算。它保留原图结构，只改变配色与描边；不会生成原图中不存在的元素。',
      runLabel: '生成' + (anime ? '动漫风' : '卡通'),
      outName: function (o, S) { return fmtName(S.srcName, anime ? '-anime' : '-cartoon', 'png'); },
      pane: function () {
        return sld('smooth', '平滑强度', 0, 100, anime ? 60 : 55, 5) +
          sld('levels', '色阶数（越小越平涂）', 3, 12, anime ? 6 : 5, 1) +
          (anime ? sld('colors', '调色板颜色数（K-means）', 4, 32, 12, 1) : '') +
          sld('lineThresh', '墨线灵敏度', 1, 30, anime ? 6 : 9, 1) +
          sld('lineThick', '墨线粗细', 0, 4, anime ? 1 : 1, 1) +
          sld('lineStrength', '墨线强度', 10, 100, anime ? 85 : 75, 5) +
          (anime ? chkk('softlight', '柔光叠加（提亮）', true) : '') +
          chkk('saturate', '提高饱和度', true);
      },
      process: async function (src, o, prog, ctx, S) {
        const s = o.smooth / 100;
        let cur = bilateral(src, 1 + Math.round(s * 4), 2 + s * 3.5, 18 + s * 55);
        prog(35); await sleep();
        const grayS = grayArr(cur);
        if (anime && o.colors) {
          const cents = kmeansPalette(samplePixels(cur, Math.max(1, Math.round(Math.sqrt(cur.w * cur.h / 9000)))), o.colors | 0, 6);
          S.extra.palette = cents.map(c => hexOf(c[0], c[1], c[2]));
          cur = quantizeByPalette(cur, cents, true);
        } else {
          cur = levelsQuantize(cur, o.levels, 1);
        }
        prog(65); await sleep();
        if (o.saturate) {
          for (let i = 0; i < cur.data.length; i += 4) {
            const g = 0.299 * cur.data[i] + 0.587 * cur.data[i + 1] + 0.114 * cur.data[i + 2];
            for (let c = 0; c < 3; c++) cur.data[i + c] = clamp255(g + (cur.data[i + c] - g) * 1.22);
          }
        }
        let out = edgeOverlay(cur, grayS, o.lineThresh, o.lineThick, o.lineStrength);
        if (anime && o.softlight) {
          const o2 = copyP(out);
          for (let i = 0; i < o2.data.length; i += 4) for (let c = 0; c < 3; c++) {
            const b = o2.data[i + c] / 255, sl = src.data[i + c] / 255;
            o2.data[i + c] = (sl < 0.5 ? 2 * b * sl + b * b * (1 - 2 * sl) : 2 * b * (1 - sl) + Math.sqrt(b) * (2 * sl - 1)) * 255;
          }
          out = o2;
        }
        prog(100);
        return P2canvas(out);
      },
      after: function (S, ctx) {
        if (S.extra.palette) ctx.report('<div class="ptitle" style="font-size:15px">提取到的调色板</div><div class="shapes">' + S.extra.palette.map(c => '<span class="swatch" style="width:28px;height:28px;display:inline-block;background:' + c + '"></span>').join('') + '</div>');
      }
    });
  }
  cartoonSpec('photo-to-cartoon', '照片转卡通', false);
  cartoonSpec('cartoon-yourself', '把自己变卡通', false);
  cartoonSpec('photo-to-anime', '照片转动漫风', true);

  /* ---- 15.7 老照片修复 ---- */
  defImg('restore-old-photos', {
    title: '老照片修复',
    desc: '中值 + 形态学闭合抑制划痕，去噪、自动色阶/CLAHE 恢复对比度，可选暖色校正与轻微锐化。',
    boundsTone: 'warn',
    bounds: '能力边界：这是<b>经典修复管线</b>（去噪 + 划痕抑制 + 色阶恢复 + 锐化）。褪色、灰雾、噪点、细小划痕能明显改善；大面积破损、霉斑、缺失区域需要 AI 修复模型补全，本页做不到。',
    runLabel: '修复并导出',
    outName: function (o, S) { return fmtName(S.srcName, '-restored', 'png'); },
    pane: function () {
      return selk('preset', '强度档', [['light', '轻（保留质感）'], ['medium', '中（推荐）'], ['strong', '强（画质优先）']], 'medium') +
        sld('scratch', '划痕/斑点抑制', 0, 100, 45, 5) +
        sld('denoise', '去噪', 0, 100, 40, 5) +
        sld('contrast', '对比度恢复', 0, 100, 55, 5) +
        sld('warm', '暖色校正', -50, 50, 8, 1) +
        sld('sharpen', '锐化', 0, 200, 55, 5);
    },
    process: async function (src, o, prog, ctx, S) {
      const k = { light: 0.55, medium: 1, strong: 1.45 }[o.preset] || 1;
      let cur = src;
      if (o.scratch > 0) { cur = medianFilter(cur, Math.max(1, Math.round(o.scratch / 100 * 2 * k))); prog(20); await sleep(); }
      if (o.denoise > 0) { cur = bilateral(cur, 2, 2, 14 + o.denoise * k); prog(40); await sleep(); }
      if (o.contrast > 0) {
        const g = grayArr(cur);
        const al = autoLevels(g, cur.w, cur.h, 0.006);
        const eq = clahe(al, cur.w, cur.h, 8, 1.6 + o.contrast / 30);
        const mix = o.contrast / 100;
        const out = copyP(cur);
        for (let i = 0; i < cur.w * cur.h; i++) {
          const q = i * 4, ratio = (g[i] * (1 - mix) + eq[i] * mix) / Math.max(1, g[i]);
          out.data[q] = clamp255(out.data[q] * ratio);
          out.data[q + 1] = clamp255(out.data[q + 1] * ratio);
          out.data[q + 2] = clamp255(out.data[q + 2] * ratio);
        }
        cur = out; prog(70); await sleep();
      }
      const wm = o.warm / 100;
      if (wm) { const out = copyP(cur); for (let i = 0; i < out.data.length; i += 4) { out.data[i] = clamp255(out.data[i] * (1 + wm * 0.16)); out.data[i + 2] = clamp255(out.data[i + 2] * (1 - wm * 0.16)); } cur = out; prog(80); await sleep(); }
      if (o.sharpen > 0) { cur = unsharp(cur, 1.1, o.sharpen / 100, 2); }
      prog(100);
      return P2canvas(cur);
    }
  });
  /* ======================= 16. 交互式叠加层（涂抹 / 点击） ======================= */
  function overlayCanvas(host, id, w, h) {
    const box = $('#cmpBox', host); if (!box) return null;
    let cv = $('#' + id, host);
    if (!cv) { cv = document.createElement('canvas'); cv.id = id; box.appendChild(cv); }
    cv.width = w; cv.height = h;
    cv.setAttribute('style', 'position:absolute;left:0;top:0;width:100%;height:100%;cursor:crosshair;touch-action:none');
    return cv;
  }
  function attachBrush(host, S, opts) {
    const cv = overlayCanvas(host, 'brushCanvas', S.src.w, S.src.h);
    if (!cv) return null;
    const c2 = cv.getContext('2d');
    c2.clearRect(0, 0, cv.width, cv.height);
    c2.lineCap = 'round'; c2.lineJoin = 'round';
    c2.strokeStyle = opts && opts.color ? opts.color : 'rgba(215,244,82,.6)';
    c2.fillStyle = c2.strokeStyle;
    let down = false, last = null;
    const pos = ev => {
      const r = cv.getBoundingClientRect();
      return { x: (ev.clientX - r.left) / Math.max(1, r.width) * cv.width, y: (ev.clientY - r.top) / Math.max(1, r.height) * cv.height, r: Math.max(1, (opts && opts.size ? opts.size() : 24) / 2) };
    };
    function dab(a, b) {
      c2.lineWidth = a.r * 2;
      c2.beginPath(); c2.moveTo(a.x, a.y); c2.lineTo(b.x, b.y); c2.stroke();
      c2.beginPath(); c2.arc(b.x, b.y, a.r, 0, Math.PI * 2); c2.fill();
    }
    cv.addEventListener('pointerdown', ev => { down = true; const p = pos(ev); last = p; dab(p, p); if (cv.setPointerCapture) cv.setPointerCapture(ev.pointerId); ev.preventDefault(); });
    cv.addEventListener('pointermove', ev => { if (!down) return; const p = pos(ev); dab(last || p, p); last = p; ev.preventDefault(); });
    const up = () => { if (!down) return; down = false; last = null; if (opts && opts.onUp) opts.onUp(); };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up); cv.addEventListener('pointerleave', up);
    return {
      canvas: cv,
      ctx2: c2,
      clear: function () { c2.clearRect(0, 0, cv.width, cv.height); },
      mask: function () {
        const d = c2.getImageData(0, 0, cv.width, cv.height).data, m = new Uint8Array(cv.width * cv.height);
        for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 24 ? 1 : 0;
        return m;
      },
      setColor: function (c) { c2.strokeStyle = c; c2.fillStyle = c; }
    };
  }
  function dist2Color(a, c) { const dr = a[0] - c[0], dg = a[1] - c[1], db = a[2] - c[2]; return dr * dr + dg * dg + db * db; }
  function mergeMasks(a, b, w, h, add) {
    const o = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) o[i] = add ? (a[i] || b[i] ? 1 : 0) : (a[i] && !b[i] ? 1 : 0);
    return o;
  }

  /* ======================= 17. 人像美化 ======================= */
  function faceTool(slug, title, allowSlim) {
    defImg(slug, {
      title: title,
      desc: '肤色检测（YCbCr 阈值）→ 只对肤色区域做双边磨皮 + 频率分离（保留细节层）' + (allowSlim ? '，可选局部瘦脸变形与亮眼美白。' : '，可选亮眼美白。'),
      maxSide: 1400,
      boundsTone: 'warn',
      bounds: '能力边界：本页<b>不检测人脸关键点</b>（那需要专门的模型）。磨皮作用于「肤色像素」，用 YCbCr 阈值 + 频率分离实现；' + (allowSlim ? '瘦脸是围绕你指定中心的局部径向变形，不是基于五官定位的整形。' : '') + '对常规人像效果好，但对低光、偏黄灯光、大面积非肤色背景可能误判，建议配合「皮肤质感」滑块使用。',
      runLabel: '美化并导出',
      outName: function (o, S) { return fmtName(S.srcName, '-retouch', 'png'); },
      pane: function () {
        return sld('strength', '磨皮强度', 0, 100, 55, 5) +
          sld('texture', '保留皮肤质感', 0, 100, 60, 5) +
          sld('brighten', '提亮 / 美白', 0, 100, 25, 5) +
          chkk('skinOnly', '只处理肤色区域', true) +
          (allowSlim ? sld('slim', '瘦脸强度', 0, 100, 0, 5) +
            sld('faceX', '面部中心 X (%)', 0, 100, 50, 1) +
            sld('faceY', '面部中心 Y (%)', 0, 100, 42, 1) +
            sld('faceSize', '影响范围 (%短边)', 8, 80, 34, 1) : '') +
          (allowSlim ? chkk('whiten', '亮眼（提亮高光）', false) : '');
      },
      process: async function (src, o, prog, ctx, S) {
        const w = src.w, h = src.h;
        const sm = skinMask(src);
        let wt = maskToWeights(sm, w, h, Math.max(1.2, Math.min(w, h) * 0.006));
        if (!o.skinOnly) for (let i = 0; i < w * h; i++) wt[i] = 255;
        prog(20); await sleep();
        const st = o.strength / 100;
        const smoothed = bilateral(src, 3, 2.6, 18 + st * 46);
        const blurred = gaussBlur(src, 3.6);
        const detail = copyP(src);
        for (let i = 0; i < w * h * 4; i++) if (i % 4 !== 3) detail.data[i] = detail.data[i] - blurred.data[i] + 128;
        const keep = o.texture / 100;
        const recomb = copyP(smoothed);
        for (let i = 0; i < w * h * 4; i++) if (i % 4 !== 3) recomb.data[i] = clamp255(smoothed.data[i] + (detail.data[i] - 128) * keep);
        prog(55); await sleep();
        let out = blendByWeight(src, recomb, wt, w, h, st);
        if (o.brighten > 0) {
          const b = o.brighten / 100;
          for (let i = 0; i < w * h; i++) {
            const q = i * 4, a = clamp(wt[i] / 255, 0, 1) * b;
            if (a <= 0) continue;
            const ycc = rgb2ycbcr(out.data[q], out.data[q + 1], out.data[q + 2]);
            const y2 = clamp255(ycc[0] * (1 + 0.22 * a) + 14 * a);
            const rgb = ycbcr2rgb(y2, ycc[1] * (1 - 0.10 * a), ycc[2] * (1 - 0.10 * a));
            out.data[q] = clamp255(rgb[0]); out.data[q + 1] = clamp255(rgb[1]); out.data[q + 2] = clamp255(rgb[2]);
          }
        }
        prog(72); await sleep();
        if (allowSlim && o.slim > 0) {
          const cx = w * (o.faceX / 100), cy = h * (o.faceY / 100), rad = Math.min(w, h) * (o.faceSize / 100);
          out = warpSqueeze(out, cx, cy, rad, (o.slim / 100) * 0.22, true);
        }
        if (allowSlim && o.whiten) {
          const g = grayArr(out);
          const mag = sobel(g, w, h).mag;
          for (let i = 0; i < w * h; i++) if (mag[i] > 60) {
            const q = i * 4;
            for (let c = 0; c < 3; c++) out.data[q + c] = clamp255(out.data[q + c] * 1.08 + 6);
          }
        }
        prog(100);
        return P2canvas(out);
      }
    });
  }
  faceTool('face-retouch', '人脸美化（磨皮 / 瘦脸）', true);
  faceTool('photo-beautifier', '照片美化', true);
  faceTool('skin-smoothing', '皮肤磨皮', false);

  /* ======================= 18. 伪深度图 ======================= */
  function depthSpec(slug, title) {
    defImg(slug, {
      title: title,
      desc: '用亮度对比、局部模糊度、边缘强度与垂直透视四种启发式线索加权，生成灰度深度图，并可用它做 3D 视差预览。',
      compare: 'none',
      maxSide: 900,
      boundsTone: 'warn',
      bounds: '能力边界：这是<b>启发式伪深度</b>（亮度/模糊/边缘/透视加权），<b>不是单目深度估计网络（如 MiDaS / Depth-Anything）</b>。它对“近处更亮更清晰、远处更暗更模糊、下半部更近”这类约定俗成的场景有效，对反直觉构图会给出错误的深度关系。深度图仅可用于视觉实验，不要用于测量。',
      runLabel: '生成深度图',
      outName: function (o, S) { return fmtName(S.srcName, '-depth', 'png'); },
      pane: function () {
        return sld('lum', '亮度线索权重', 0, 100, 35, 5) +
          sld('blur', '模糊度线索权重', 0, 100, 30, 5) +
          sld('edge', '边缘线索权重', 0, 100, 20, 5) +
          sld('vert', '透视（下近上远）权重', 0, 100, 35, 5) +
          sld('radius', '模糊度估计半径', 2, 14, 6, 1) +
          chkk('smooth', '深度图平滑', true) +
          chkk('invert', '反转（白=近 / 黑=近）', false);
      },
      stageExtra: function (S, ctx) {
        return '<div class="plabel">3D 视差预览（用深度图驱动的伪 3D）</div>' +
          '<canvas id="prlx" style="width:100%;max-width:420px;border-radius:10px;background:#000"></canvas>' +
          '<div class="shapes" style="margin-top:8px"><button type="button" class="shape" id="prlxToggle">播放视差</button></div>';
      },
      bindStage: function (S, ctx) {
        const btn = $('#prlxToggle', ctx.host);
        if (!btn) return;
        btn.addEventListener('click', () => {
          if (S.extra.raf) { stopParallax(S); btn.classList.remove('on'); btn.textContent = '播放视差'; }
          else if (S.extra.depth) { startParallax(S, ctx); btn.classList.add('on'); btn.textContent = '停止'; }
        });
      },
      onReset: function (S) { stopParallax(S); },
      process: async function (src, o, prog, ctx, S) {
        const w = src.w, h = src.h;
        const g = grayArr(src);
        const al = autoLevels(g, w, h, 0.01);
        const gb = gaussBlurGray(g, w, h, o.radius);
        const diff = new Float32Array(w * h), mag = sobel(g, w, h).mag;
        let mxDiff = 1, mxMag = 1e-6, mnL = 255, mxL = 0;
        for (let i = 0; i < w * h; i++) {
          diff[i] = Math.abs(g[i] - gb[i]);
          if (diff[i] > mxDiff) mxDiff = diff[i];
          if (mag[i] > mxMag) mxMag = mag[i];
          if (al[i] < mnL) mnL = al[i]; if (al[i] > mxL) mxL = al[i];
        }
        prog(35); await sleep();
        const wil = o.lum / 100, wib = o.blur / 100, wie = o.edge / 100, wiv = o.vert / 100;
        const tw = wil + wib + wie + wiv || 1;
        let dpt = new Float32Array(w * h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const L = (al[i] - mnL) / Math.max(1, mxL - mnL);
          const Bl = 1 - diff[i] / mxDiff;          // 越清晰越“近”
          const Ed = Math.min(1, mag[i] / mxMag * 3); // 边缘强的区域更可能是前景轮廓
          const V = y / Math.max(1, h - 1);          // 下近上远
          dpt[i] = (wil * L + wib * Bl + wie * Ed + wiv * V) / tw;
        }
        prog(65); await sleep();
        if (o.smooth) dpt = gaussBlurGray(dpt, w, h, Math.max(1, Math.min(w, h) * 0.006));
        let mn = 1e9, mx = -1e9;
        for (let i = 0; i < w * h; i++) { if (dpt[i] < mn) mn = dpt[i]; if (dpt[i] > mx) mx = dpt[i]; }
        const out = newP(w, h);
        for (let i = 0; i < w * h; i++) {
          let v = (dpt[i] - mn) / Math.max(1e-6, mx - mn);
          if (o.invert) v = 1 - v;
          const q = i * 4, val = clamp255(v * 255);
          out.data[q] = out.data[q + 1] = out.data[q + 2] = val; out.data[q + 3] = 255;
          dpt[i] = val;
        }
        S.extra.depth = { w: w, h: h, data: dpt };
        prog(100);
        ctx.report(boundsBox('note', '深度图是启发式估计值，仅用于视觉效果（视差、假 3D、深度雾），不具备测量意义。'));
        return P2canvas(out);
      }
    });
  }
  const RAC = window.requestAnimationFrame;
  function stopParallax(S) { if (S.extra.raf) { try { (window.cancelAnimationFrame || window.clearTimeout)(S.extra.raf); } catch (e) { } S.extra.raf = null; } }
  function startParallax(S, ctx) {
    const cv = $('#prlx', ctx.host); if (!cv || !S.extra.depth) return;
    const src = S.srcCanvas, dep = S.extra.depth;
    const pw = 360, ph = Math.max(1, Math.round(pw * S.src.h / S.src.w));
    cv.width = pw; cv.height = ph;
    const small = canvasOf(pw, ph); ctxOf(small).drawImage(src, 0, 0, pw, ph);
    const sd = ctxOf(small).getImageData(0, 0, pw, ph).data;
    const dy = new Float32Array(pw * ph);
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      const sx = Math.min(dep.w - 1, Math.round(x * dep.w / pw)), sy = Math.min(dep.h - 1, Math.round(y * dep.h / ph));
      dy[y * pw + x] = dep.data[sy * dep.w + sx] / 255;
    }
    const c2 = ctxOf(cv);
    const imgData = c2.createImageData(pw, ph);
    let t = 0;
    stopParallax(S);
    const loop = () => {
      const off = Math.sin(t) * 9;
      for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
        const i = y * pw + x;
        const k = (dy[i] - 0.5) * 2;
        const sx = clamp(Math.round(x + k * off), 0, pw - 1), sy = clamp(Math.round(y + k * off * 0.35), 0, ph - 1);
        const s = (sy * pw + sx) * 4, d = i * 4;
        imgData.data[d] = sd[s]; imgData.data[d + 1] = sd[s + 1]; imgData.data[d + 2] = sd[s + 2]; imgData.data[d + 3] = 255;
      }
      c2.putImageData(imgData, 0, 0);
      t += 0.045;
      S.extra.raf = RAC(loop);
    };
    S.extra.raf = RAC(loop);
    const stopOnHide = () => { if (document.hidden) { stopParallax(S); const b = $('#prlxToggle', ctx.host); if (b) { b.classList.remove('on'); b.textContent = '播放视差'; } } };
    document.addEventListener('visibilitychange', stopOnHide);
    if (!S.extra.visBound) { S.extra.visBound = true; }
  }
  depthSpec('depth-map-generator', '深度图生成器（伪深度）');
  depthSpec('depth-map-from-image', '从图片生成深度图（伪深度）');

  /* ======================= 19. 位图转 SVG（真矢量化） ======================= */
  function vectorizeSpec(slug, title) {
    defImg(slug, {
      title: title,
      desc: 'K-means/中位切分色彩量化 → 每色生成二值掩膜 → Moore 邻域轮廓追踪 → Douglas-Peucker 简化 → 输出真正的 SVG path（evenodd 处理孔洞）。',
      maxSide: 900,
      boundsTone: 'note',
      bounds: '这是<b>真实的分层矢量描摹</b>（色彩量化 + 轮廓追踪 + 折线简化），输出的是可无限缩放的 SVG 路径。它擅长 logo、图标、扁平插画、剪影；对照片这类连续色调图，颜色数越多文件越大，线条也会很碎——想要“照片级矢量化”需要使用专门的矢量化模型。',
      runLabel: '生成 SVG',
      outName: function (o, S) { return fmtName(S.srcName, '-vector', 'svg'); },
      pane: function () {
        return sld('colors', '颜色数', 2, 24, 8, 1) +
          sld('tol', '简化容差（px）', 0.2, 6, 1.1, 0.1) +
          sld('minArea', '最小区域面积（px）', 1, 200, 12, 1) +
          chkk('smooth', '区域平滑（去除孤立噪点）', true) +
          sld('sample', '采样步长（越大越快）', 1, 8, 3, 1) +
          '<div class="plabel">SVG 预览</div><div class="canvaswrap" style="padding:8px"><div id="svgPrev" style="color:#888;font-size:13px">运行后显示</div></div>';
      },
      outMime: 'image/png',
      process: async function (src, o, prog, ctx, S) {
        const w = src.w, h = src.h;
        let base = src;
        if (o.smooth) { base = bilateral(base, 2, 2.2, 26); prog(8); await sleep(); }
        const cents = kmeansPalette(samplePixels(base, Math.max(1, o.sample | 0)), o.colors | 0, 7);
        prog(35); await sleep();
        const idx = new Int32Array(w * h);
        for (let i = 0; i < w * h; i++) {
          const q = i * 4; idx[i] = nearestColor(cents, base.data[q], base.data[q + 1], base.data[q + 2]);
          if ((i & 65535) === 0) await sleep();
        }
        prog(55); await sleep();
        let paths = '', nPath = 0, nPt = 0;
        for (let c = 0; c < cents.length; c++) {
          const mask = new Uint8Array(w * h);
          for (let i = 0; i < w * h; i++) mask[i] = idx[i] === c ? 1 : 0;
          let mm = mask;
          if (o.minArea > 1) {
            const lab = labelComponents(mask, w, h);
            mm = new Uint8Array(w * h);
            for (let i = 0; i < w * h; i++) { const l = lab.labels[i]; if (l >= 0 && lab.sizes[l] >= o.minArea) mm[i] = 1; }
          }
          const cs = traceContours(mm, w, h);
          let d = '';
          for (let k = 0; k < cs.length; k++) {
            const sp = simplify(cs[k], o.tol);
            if (sp.length < 3) continue;
            nPt += sp.length;
            d += 'M' + sp.map(p => p[0] + ' ' + p[1]).join('L') + 'Z';
          }
          if (d) {
            paths += '<path fill="' + hexOf(cents[c][0], cents[c][1], cents[c][2]) + '" fill-rule="evenodd" d="' + d + '"/>';
            nPath++;
          }
          prog(55 + 35 * (c + 1) / cents.length);
          await sleep();
        }
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '">' + paths + '</svg>';
        S.extra.svg = svg;
        const prev = $('#svgPrev', ctx.host);
        if (prev) {
          const uri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
          prev.innerHTML = '<img src="' + uri + '" style="max-width:100%;max-height:360px;display:block">';
        }
        const b = new Blob([svg], { type: 'image/svg+xml' });
        S.extra.svgSize = b.size;
        const raster = quantizeByPalette(base, cents, true);
        prog(100);
        ctx.report('<div class="ptitle" style="font-size:15px">矢量化结果</div>' +
          '<div class="resultbox">' +
          '<div class="row"><span>颜色层数</span><b>' + cents.length + '</b></div>' +
          '<div class="row"><span>SVG 路径数</span><b>' + nPath + '</b></div>' +
          '<div class="row"><span>路径顶点总数</span><b>' + nPt + '</b></div>' +
          '<div class="row"><span>SVG 体积</span><b>' + window.fmtSize(b.size) + '</b></div>' +
          '<div class="row"><span>原始位图估计</span><b>' + window.fmtSize(w * h * 4 / 3) + '</b></div>' +
          '</div>');
        return P2canvas(raster);
      },
      after: function (S, ctx) {
        if (!S.extra.svg) return;
        const dl = $('#aiDlOut', ctx.host);
        if (dl) {
          dl.onclick = () => {
            const b = new Blob([S.extra.svg], { type: 'image/svg+xml' });
            ctx.download(b, fmtName(S.srcName, '-vector', 'svg'));
          };
        }
        const exp = $('#svgExport', ctx.host);
        if (!exp) {
          const wrap = $('#aiExtra', ctx.host);
          if (wrap) wrap.insertAdjacentHTML('afterbegin',
            '<div class="shapes"><button type="button" class="btn-ghost btn-sm" id="svgExport">下载 .svg 文件</button>' +
            '<button type="button" class="btn-ghost btn-sm" id="svgCopy">复制 SVG 源码</button></div>' +
            '<div class="plabel">SVG 源码（可编辑）</div><textarea id="svgSrc" style="min-height:140px"></textarea>');
          const ta = $('#svgSrc', ctx.host); if (ta) ta.value = S.extra.svg;
          const b1 = $('#svgExport', ctx.host);
          if (b1) b1.addEventListener('click', () => { const ta2 = $('#svgSrc', ctx.host); const s = ta2 && ta2.value ? ta2.value : S.extra.svg; ctx.download(new Blob([s], { type: 'image/svg+xml' }), fmtName(S.srcName, '-vector', 'svg')); });
          const b2 = $('#svgCopy', ctx.host);
          if (b2) b2.addEventListener('click', () => { const ta2 = $('#svgSrc', ctx.host); window.copyText(ta2 ? ta2.value : S.extra.svg); });
        }
      }
    });
  }
  vectorizeSpec('image-to-svg', '位图转 SVG（真矢量化）');
  vectorizeSpec('vectorizer', '图片矢量化（真矢量化）');
  /* ======================= 20. 涂抹移除（本地扩散修补） ======================= */
  function removeTool(slug, title, isText) {
    defImg(slug, {
      title: title,
      desc: isText ? '先用「自动框选文字」近似检测文字区域，再手动涂抹微调，然后本地扩散填充移除。' : '用画笔涂抹要移除的物体，本地用边界扩散填充补上周围纹理，可选镜像填充。',
      compare: 'none',
      maxSide: 1500,
      boundsTone: 'warn',
      bounds: isText
        ? '能力边界：这是<b>本地扩散修补</b>（把涂抹区域用周围像素迭代扩散）。文字覆盖在纯色背景（海报、截图、水印墙）上时效果很好；压在复杂纹理上的文字会留下糊斑。文字区域检测是<b>基于边缘密度与连通域的近似方法</b>，会漏检或误检，请务必手动微调涂抹范围。要“完美去字”需要使用专门的修复模型。'
        : '能力边界：这是<b>基于边界扩散的本地内容感知填充（简化版）</b>，不是 PatchMatch / 生成式修复。它对纯色与简单纹理（天空、墙面、草地、沙地、水面）效果不错；复杂纹理（树叶、头发、重复图案、文字）会出现糊斑与结构断裂。精细修图建议使用专门的 AI 修复工具。',
      runLabel: '移除并导出',
      outName: function (o, S) { return fmtName(S.srcName, isText ? '-notext' : '-object-removed', 'png'); },
      pane: function () {
        return sld('brush', '画笔大小', 6, 120, 34, 2) +
          sld('iterations', '扩散迭代次数（越大越平滑）', 4, 120, 34, 2) +
          chkk('mirror', '镜像预填充（纹理更连贯）', true) +
          (isText ? '<div class="plabel">文字区域</div><div class="shapes"><button type="button" class="shape" id="autoText">自动框选文字</button></div>' +
            sld('swtSens', '文字检测灵敏度', 1, 30, 9, 1) : '') +
          '<div class="plabel">涂抹</div><div class="shapes"><button type="button" class="shape" id="brushClear">清空涂抹</button></div>' +
          '<div class="note" id="brushInfo">在左侧图片上按住拖动即可涂抹。</div>';
      },
      bindStage: function (S, ctx) {
        S.extra.brush = attachBrush(ctx.host, S, {
          size: () => parseFloat(($('[data-k=brush]', ctx.host) || {}).value) || 34,
          onUp: () => { ctx.run(); }
        });
        const cl = $('#brushClear', ctx.host);
        if (cl) cl.addEventListener('click', () => { if (S.extra.brush) S.extra.brush.clear(); ctx.run(); });
        const at = $('#autoText', ctx.host);
        if (at) at.addEventListener('click', () => {
          if (!S.extra.brush) return;
          const sens = parseFloat(($('[data-k=swtSens]', ctx.host) || {}).value) || 9;
          const m = detectTextMask(S.src, sens);
          paintMask(S.extra.brush, m, S.src.w, S.src.h);
          ctx.note('已近似框选文字区域，请检查并手动微调后点击「移除并导出」。');
          ctx.run();
        });
      },
      process: async function (src, o, prog, ctx, S) {
        if (!S.extra.brush) return P2canvas(src);
        let m = S.extra.brush.mask();
        let cnt = 0; for (let i = 0; i < m.length; i++) if (m[i]) cnt++;
        if (!cnt) { ctx.note('请先在图片上涂抹要移除的区域（或点「自动框选文字」）。'); return P2canvas(src); }
        if (o.iterations >= 60) m = dilateMask(m, src.w, src.h, 0);
        prog(5);
        const out = await inpaintDiffusion(src, m, o.iterations, p => prog(5 + p * 90), o.mirror);
        prog(100);
        ctx.note('已移除涂抹区域（覆盖 <b>' + (cnt / (src.w * src.h) * 100).toFixed(2) + '%</b> 的画面，扩散迭代 ' + (o.iterations | 0) + ' 次）');
        return P2canvas(out);
      }
    });
  }
  function paintMask(brush, mask, w, h) {
    const c = brush.ctx2, img = c.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const q = i * 4;
      if (mask[i]) { img.data[q] = 215; img.data[q + 1] = 244; img.data[q + 2] = 82; img.data[q + 3] = 170; }
    }
    c.putImageData(img, 0, 0);
  }
  /* 近似文字区域检测：边缘密度 + 连通域形状过滤 + 形态学聚合 */
  function detectTextMask(p, sens) {
    const w = p.w, h = p.h;
    const g = grayArr(p);
    const sb = sobel(g, w, h), mag = sb.mag;
    let mx = 1e-6; for (let i = 0; i < w * h; i++) if (mag[i] > mx) mx = mag[i];
    const thr = mx * Math.max(0.06, 1 - sens / 100 * 0.75);
    const edge = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) edge[i] = mag[i] > thr ? 1 : 0;
    const opened = morphOpen(edge, w, h, 1);
    const lab = labelComponents(opened, w, h);
    const boxMask = new Uint8Array(w * h);
    const minA = Math.max(6, (w * h) * 0.00002);
    for (let id = 0; id < lab.count; id++) {
      if (lab.sizes[id] < minA) continue;
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
      for (let i = 0; i < w * h; i++) if (lab.labels[i] === id) { const x = i % w, y = (i / w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; n++; }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1, area = bw * bh;
      const density = n / Math.max(1, area);
      const ar = bw / Math.max(1, bh);
      if (bh < 6 || bh > h * 0.6) continue;
      if (ar < 0.06 || ar > 40) continue;
      if (density < 0.08 || density > 0.95) continue;
      // 笔画粗细估计：面积 / 周长的近似（用外围框长）
      const stroke = n / Math.max(1, 2 * (bw + bh));
      if (stroke > 14) continue;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) boxMask[y * w + x] = 1;
    }
    // 横向聚合，把同一行的字连成条
    const rowAgg = new Uint8Array(w * h);
    const rowh = Math.max(3, Math.round(h * 0.012));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (boxMask[y * w + x]) for (let dy = -rowh; dy <= rowh; dy++) { const yy = clamp(y + dy, 0, h - 1); rowAgg[yy * w + x] = 1; }
    return morphClose(rowAgg, w, h, Math.max(1, Math.round(Math.min(w, h) * 0.004)));
  }
  removeTool('remove-object-from-photo', '移除照片中的物体（本地修补）', false);
  removeTool('remove-text-from-image', '移除图片中的文字（本地修补）', true);

  /* ======================= 21. 上色（诚实工具） ======================= */
  function colorizeSpec(slug, title) {
    defImg(slug, {
      title: title,
      desc: '亮度伪彩映射（可选色调）+ 手动上色画笔（multiply / color / screen 混合）。',
      maxSide: 1400,
      compare: 'toggle',
      boundsTone: 'warn',
      bounds: '能力边界：<b>黑白照片的自动上色需要神经网络模型（如 DeOldify、cGAN 上色模型）</b>，纯浏览器本地算法做不到「猜到肤色、天空、衣服应该是什么颜色」。本页提供的是两个真实可用的东西：① <b>基于亮度的伪彩色映射</b>（给出整体色调倾向，例如怀旧的 sepia、电影感的青橙），② <b>手动上色画笔</b>——你自己涂颜色，工具负责按 multiply/color 混合模式融合，可反复修改并导出。',
      runLabel: '应用上色',
      outName: function (o, S) { return fmtName(S.srcName, '-colorized', 'png'); },
      pane: function () {
        return selk('palette', '亮度着色方案', [['sepia', '怀旧棕（sepia）'], ['warm', '暖阳'], ['cool', '冷调'], ['teal-orange', '电影青橙'], ['none', '不着色（只用画笔）']], 'sepia') +
          sld('tint', '着色强度', 0, 100, 65, 5) +
          '<div class="plabel">手动上色</div>' +
          colk('brushColor', '画笔颜色', '#e0b48a') +
          selk('blend', '混合模式', [['multiply', '正片叠底（加深上色）'], ['color', '颜色（保留明暗）'], ['screen', '滤色（提亮上色）']], 'multiply') +
          sld('paintStrength', '画笔不透明度', 10, 100, 70, 5) +
          sld('brush', '画笔大小', 4, 120, 26, 2) +
          '<div class="shapes"><button type="button" class="shape" id="brushClear">清空颜色</button></div>' +
          '<div class="note">在图上按住拖动涂抹即可上色；「颜色」模式会保留原图明暗层次，最适合皮肤与天空。</div>';
      },
      bindStage: function (S, ctx) {
        S.extra.brush = attachBrush(ctx.host, S, {
          color: ($('[data-k=brushColor]', ctx.host) || {}).value || '#e0b48a',
          size: () => parseFloat(($('[data-k=brush]', ctx.host) || {}).value) || 26,
          onUp: () => ctx.run()
        });
        const cl = $('#brushClear', ctx.host);
        if (cl) cl.addEventListener('click', () => { if (S.extra.brush) S.extra.brush.clear(); ctx.run(); });
      },
      onInput: function (k, v, S) { if (k === 'brushColor' && S.extra.brush) S.extra.brush.setColor(v); },
      process: async function (src, o, prog, ctx, S) {
        const w = src.w, h = src.h;
        const g = grayArr(src);
        let sat = 0;
        for (let i = 0; i < w * h; i += 7) { const q = i * 4; const mx = Math.max(src.data[q], src.data[q + 1], src.data[q + 2]), mn = Math.min(src.data[q], src.data[q + 1], src.data[q + 2]); sat += mx ? (mx - mn) / mx : 0; }
        sat /= Math.max(1, Math.floor(w * h / 7));
        let out = copyP(src);
        const tint = o.tint / 100;
        if (o.palette !== 'none') {
          for (let i = 0; i < w * h; i++) {
            const v = g[i] / 255, q = i * 4;
            let r, gg, b;
            if (o.palette === 'sepia') { r = v * 1.07; gg = v * 0.94; b = v * 0.76; }
            else if (o.palette === 'warm') { r = v * 1.06; gg = v * 0.99; b = v * 0.90; }
            else if (o.palette === 'cool') { r = v * 0.92; gg = v * 0.98; b = v * 1.08; }
            else { // teal-orange 分离色调
              if (v < 0.5) { const t = v / 0.5; r = v * (0.72 + 0.10 * t); gg = v * (0.92 + 0.02 * t); b = v * (1.02 - 0.06 * t); }
              else { const t = (v - 0.5) / 0.5; r = v * (0.82 + 0.22 * t); gg = v * (0.94 + 0.02 * t); b = v * (0.96 - 0.24 * t); }
            }
            out.data[q] = clamp255(src.data[q] * (1 - tint) + clamp255(r * 255) * tint);
            out.data[q + 1] = clamp255(src.data[q + 1] * (1 - tint) + clamp255(gg * 255) * tint);
            out.data[q + 2] = clamp255(src.data[q + 2] * (1 - tint) + clamp255(b * 255) * tint);
          }
        }
        prog(50); await sleep();
        const brush = S.extra.brush;
        if (brush) {
          const pd = brush.ctx2.getImageData(0, 0, w, h).data;
          const a = o.paintStrength / 100;
          for (let i = 0; i < w * h; i++) {
            const al = pd[i * 4 + 3]; if (al < 8) continue;
            const q = i * 4;
            const cr = pd[q], cg = pd[q + 1], cb = pd[q + 2], k = al / 255 * a;
            let br = cr, bg = cg, bb = cb;
            if (o.blend === 'multiply') { br = out.data[q] * cr / 255; bg = out.data[q + 1] * cg / 255; bb = out.data[q + 2] * cb / 255; }
            else if (o.blend === 'screen') { br = 255 - (255 - out.data[q]) * (255 - cr) / 255; bg = 255 - (255 - out.data[q + 1]) * (255 - cg) / 255; bb = 255 - (255 - out.data[q + 2]) * (255 - cb) / 255; }
            else { // color：取笔刷色相饱和度 + 原图明度
              const hs = rgb2hsl(cr, cg, cb), hl = rgb2hsl(out.data[q], out.data[q + 1], out.data[q + 2]);
              const rgb = hsl2rgb(hs[0], hs[1], hl[2]);
              br = rgb[0]; bg = rgb[1]; bb = rgb[2];
            }
            out.data[q] = clamp255(out.data[q] * (1 - k) + br * k);
            out.data[q + 1] = clamp255(out.data[q + 1] * (1 - k) + bg * k);
            out.data[q + 2] = clamp255(out.data[q + 2] * (1 - k) + bb * k);
          }
        }
        prog(100);
        S.extra.srcSat = sat;
        return P2canvas(out);
      },
      after: function (S, ctx) {
        const s = S.extra.srcSat || 0;
        ctx.report(boundsBox('note',
          '真实可用的替代动作：① <b>亮度伪彩</b>只改整体色调倾向；② <b>手动上色画笔</b>由你决定每个区域的颜色，再用 multiply/color 融合。' +
          (s > 0.18 ? ' 检测到输入其实是<b>彩色图</b>（平均饱和度 ' + s.toFixed(2) + '），伪彩着色会被原色彩覆盖，建议只用画笔工具。' : '') +
          ' 需要“一键自动上色”请使用 DeOldify 等神经网络服务。'));
      }
    });
  }
  colorizeSpec('colorize-black-and-white-photos', '黑白照片上色（伪彩 + 手动上色）');
  colorizeSpec('image-colorizer', '图片上色工具（伪彩 + 手动上色）');

  /* ======================= 22. 交互式分割（GrabCut 式近似） ======================= */
  defImg('segment-anything', {
    title: '交互式分割（本地颜色/边缘近似）',
    desc: '在图片主体上点击，本地用「颜色相似度 + 边缘约束 + 泛洪填充」聚合出选区；可多次点击累加或按住 Alt 减选。',
    compare: 'none',
    maxSide: 1200,
    boundsTone: 'warn',
    bounds: '能力边界：这是<b>本地颜色与边缘的交互式分割（GrabCut 式简化版）</b>，<b>不是 SAM（Segment Anything）模型</b>。它对前景与背景颜色差异明显的图（产品图、剪影、纯色背景）表现不错；对颜色接近、纹理复杂的场景会溢出或漏选。真正的「点一下就能分割任意物体」需要 SAM 这类大模型。',
    runLabel: '生成抠图',
    outName: function (o, S) { return fmtName(S.srcName, '-cutout', 'png'); },
    pane: function () {
      return sld('tol', '颜色容差', 6, 140, 34, 1) +
        chkk('edgeAware', '边缘约束（遇到强边缘即停）', true) +
        sld('edgeThresh', '边缘阈值', 20, 200, 70, 5) +
        chkk('accumulate', '多次点击累加（取消=每次重新选择）', true) +
        '<div class="shapes"><button type="button" class="shape" id="segClear">清空选区</button></div>' +
        '<div class="shapes"><button type="button" class="shape" id="segMask">下载蒙版 PNG</button></div>' +
        '<div class="note">在左侧图片上点击要保留的主体。按住 Alt/Option 点击可从选区中减去。</div>';
    },
    bindStage: function (S, ctx) {
      const cv = overlayCanvas(ctx.host, 'segCanvas', S.src.w, S.src.h);
      if (!cv) return;
      const c2 = cv.getContext('2d');
      S.extra.segMask = new Uint8Array(S.src.w * S.src.h);
      S.extra.segCtx = c2;
      cv.addEventListener('click', ev => {
        const r = cv.getBoundingClientRect();
        const x = Math.round((ev.clientX - r.left) / Math.max(1, r.width) * S.src.w);
        const y = Math.round((ev.clientY - r.top) / Math.max(1, r.height) * S.src.h);
        const o = readOpts($('#aiCtl', ctx.host));
        const g = grayArr(S.src), eg = o.edgeAware ? sobel(g, S.src.w, S.src.h).mag : null;
        const m = floodMask(S.src, clamp(x, 0, S.src.w - 1), clamp(y, 0, S.src.h - 1), o.tol, true, eg, o.edgeThresh);
        const cur = S.extra.segMask;
        const sub = ev.altKey;
        S.extra.segMask = o.accumulate ? mergeMasks(cur, m, S.src.w, S.src.h, !sub) : (sub ? new Uint8Array(cur.length) : m);
        drawSeg(ctx.host, S);
        ctx.run();
      });
      const cl = $('#segClear', ctx.host);
      if (cl) cl.addEventListener('click', () => { S.extra.segMask = new Uint8Array(S.src.w * S.src.h); drawSeg(ctx.host, S); ctx.run(); });
      const mk = $('#segMask', ctx.host);
      if (mk) mk.addEventListener('click', () => {
        const m = S.extra.segMask; if (!m) return;
        const out = newP(S.src.w, S.src.h);
        for (let i = 0; i < S.src.w * S.src.h; i++) { const q = i * 4, v = m[i] ? 255 : 0; out.data[q] = out.data[q + 1] = out.data[q + 2] = v; out.data[q + 3] = 255; }
        toBlob(P2canvas(out), 'image/png').then(b => ctx.download(b, fmtName(S.srcName, '-mask', 'png')));
      });
    },
    process: async function (src, o, prog, ctx, S) {
      const m = S.extra.segMask;
      if (!m) return src;
      let cnt = 0; for (let i = 0; i < m.length; i++) if (m[i]) cnt++;
      if (!cnt) { ctx.note('请先在图片上点击要保留的主体。'); return P2canvas(src); }
      const soft = maskToWeights(m, src.w, src.h, Math.max(1, Math.min(src.w, src.h) * 0.003));
      const A = new Uint8Array(src.w * src.h);
      for (let i = 0; i < A.length; i++) A[i] = clamp255(soft[i]);
      const srcC = canvasOf(src.w, src.h); putP(srcC, src);
      const out = transparentFrom(srcC, A);
      prog(100);
      ctx.note('选区覆盖 <b>' + (cnt / m.length * 100).toFixed(1) + '%</b> 的画面，已生成透明底抠图。');
      return out;
    }
  });
  function drawSeg(host, S) {
    const cv = $('#segCanvas', host); if (!cv || !S.extra.segCtx) return;
    const c2 = S.extra.segCtx, w = cv.width, h = cv.height;
    const img = c2.createImageData(w, h), m = S.extra.segMask;
    for (let i = 0; i < w * h; i++) if (m[i]) { const q = i * 4; img.data[q] = 215; img.data[q + 1] = 244; img.data[q + 2] = 82; img.data[q + 3] = 130; }
    c2.putImageData(img, 0, 0);
  }
  /* ======================= 23. 图像特征分析（真实可测量） ======================= */
  function paletteWithShare(p, cents, stride) {
    const counts = new Array(cents.length).fill(0); let total = 0;
    const d = p.data, st = Math.max(1, stride | 0);
    for (let i = 0; i < p.w * p.h; i += st) {
      const q = i * 4;
      const ci = nearestColor(cents, d[q], d[q + 1], d[q + 2]);
      counts[ci]++; total++;
    }
    const arr = cents.map((c, i) => ({ hex: hexOf(c[0], c[1], c[2]), name: colorName(c[0], c[1], c[2]), pct: counts[i] / Math.max(1, total) }));
    arr.sort((a, b) => b.pct - a.pct);
    return arr;
  }
  async function analyzeImage(p, prog) {
    const w = p.w, h = p.h, n = w * h, d = p.data;
    const f = { w: w, h: h, aspect: w / h };
    f.orient = Math.abs(f.aspect - 1) < 0.06 ? '方构图' : f.aspect > 1 ? '横构图' : '竖构图';
    let sy = 0, sy2 = 0, sat = 0, satHigh = 0, clip = 0, satPix = 0;
    const hueHist = new Float32Array(36);
    for (let i = 0; i < n; i++) {
      const q = i * 4, r = d[q], g = d[q + 1], b = d[q + 2];
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      sy += y; sy2 += y * y;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const s = mx ? (mx - mn) / mx : 0;
      sat += s; if (s > 0.18) satPix++;
      if (s > 0.92) satHigh++;
      if (r <= 1 || g <= 1 || b <= 1 || r >= 254 || g >= 254 || b >= 254) clip++;
      if (s > 0.12) { const hsl = rgb2hsl(r, g, b); hueHist[clamp(Math.floor(hsl[0] / 10), 0, 35)]++; }
    }
    f.bright = sy / n;
    f.contrast = Math.sqrt(Math.max(0, sy2 / n - f.bright * f.bright));
    f.sat = sat / n;
    f.isGray = satPix / n < 0.04;
    f.clipPct = clip / n;
    f.satHighPct = satHigh / n;
    if (prog) prog(15);
    await sleep();
    const g = grayArr(p);
    const sb = sobel(g, w, h), mag = sb.mag;
    let msum = 0, mmx = 0;
    for (let i = 0; i < n; i++) { msum += mag[i]; if (mag[i] > mmx) mmx = mag[i]; }
    f.edgeMean = msum / n;
    const lapVar = (function () {
      let s = 0, s2 = 0, c = 0;
      for (let y = 1; y < h - 1; y += 2) for (let x = 1; x < w - 1; x += 2) {
        const i = y * w + x;
        const v = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
        s += v; s2 += v * v; c++;
      }
      if (!c) return 0;
      const m = s / c; return s2 / c - m * m;
    })();
    f.sharpness = lapVar;
    const thr = mmx * 0.28;
    let ec = 0; for (let i = 0; i < n; i++) if (mag[i] > thr) ec++;
    f.edgeDensity = ec / n;
    if (prog) prog(40); await sleep();
    // 地平线：行梯度能量峰值（限制在中间 80% 高度）
    let bestRow = -1, bestE = -1;
    for (let y = Math.floor(h * 0.1); y < Math.floor(h * 0.9); y += 2) {
      let e = 0; for (let x = 1; x < w - 1; x += 2) e += Math.abs(g[y * w + x + 1] - g[y * w + x - 1]);
      e /= w;
      if (e > bestE) { bestE = e; bestRow = y; }
    }
    f.horizon = { y: bestRow, pct: bestRow / h };
    // 视觉重心（按与均值的偏差加权）
    let cx = 0, cy = 0, ws = 0;
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
      const dv = Math.abs(g[y * w + x] - f.bright);
      cx += x * dv; cy += y * dv; ws += dv;
    }
    if (ws) { cx /= ws; cy /= ws; }
    f.weight = { x: cx / w, y: cy / h };
    if (prog) prog(60); await sleep();
    const cents = kmeansPalette(samplePixels(p, Math.max(1, Math.round(Math.sqrt(n / 6000)))), 5, 5);
    f.colors = paletteWithShare(p, cents, Math.max(1, Math.round(Math.sqrt(n / 6000))));
    if (prog) prog(78); await sleep();
    // 色彩和谐度：主色相之间的角距
    let hd = [];
    for (let i = 0; i < 36; i++) if (hueHist[i] > 0) hd.push(i * 10);
    if (f.isGray || hd.length < 2) f.harmony = '单色 / 近无彩色';
    else {
      hd.sort((a, b) => a - b);
      let maxGap = 0; for (let i = 0; i < hd.length; i++) { const nx = hd[(i + 1) % hd.length]; const gp = (nx - hd[i] + 360) % 360; if (gp > maxGap) maxGap = gp; }
      const spread = 360 - maxGap;
      f.harmony = spread < 40 ? '同类色（单色系）' : spread < 100 ? '邻近色' : spread < 200 ? '对比色' : '互补色 / 高对比';
      f.hueSpread = spread;
    }
    // 人像近似检测：肤色连通域
    const sm = skinMask(p), lab = labelComponents(sm, w, h);
    const boxes = [];
    for (let id = 0; id < lab.count; id++) {
      if (lab.sizes[id] < n * 0.004) continue;
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let i = 0; i < n; i++) if (lab.labels[i] === id) { const x = i % w, y = (i / w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      boxes.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, area: lab.sizes[id] / n });
    }
    boxes.sort((a, b) => b.area - a.area);
    f.faces = { count: boxes.length, boxes: boxes.slice(0, 4) };
    if (prog) prog(100);
    return f;
  }
  function promptFromFeatures(f, o) {
    const isVideo = o.variant === 'video';
    const style = f.edgeDensity > 0.22 ? '高细节写实摄影' : f.edgeDensity < 0.09 ? '极简 / 扁平构图' : '写实摄影';
    let light = f.bright < 80 ? '低照度 / 夜景，弱光氛围' : f.bright > 185 ? '明亮高调，充足自然光' : '柔和自然光';
    if (f.contrast > 62) light += '，强对比、戏剧化明暗';
    else if (f.contrast < 34) light += '，低对比、灰调柔和';
    const main = f.colors.slice(0, 3).map(c => c.name + ' ' + c.hex).join(' / ');
    const tone = f.isGray ? '黑白 / 无彩色' : (f.sat > 0.42 ? '高饱和、色彩浓烈' : f.sat < 0.14 ? '低饱和、克制' : '自然饱和');
    const comp = f.orient + '（比例 ' + f.aspect.toFixed(2) + '）' +
      (f.horizon && f.horizon.pct > 0.15 && f.horizon.pct < 0.85 ? '，地平线约在画面 ' + Math.round(f.horizon.pct * 100) + '% 高度' : '') +
      '，视觉重心约在 (' + Math.round(f.weight.x * 100) + '% , ' + Math.round(f.weight.y * 100) + '%)';
    const detail = f.edgeDensity > 0.2 ? '纹理非常丰富' : f.edgeDensity > 0.12 ? '纹理适中' : '画面干净、负空间大';
    const sharp = f.sharpness > 900 ? '锐利清晰' : f.sharpness > 250 ? '清晰度尚可' : '偏软 / 可能失焦';
    const lines = [];
    lines.push('主体：[在此填写主体，例如 “一位戴草帽的女孩”]');
    lines.push('风格：' + style + (isVideo ? '，电影感' : ''));
    lines.push('光线：' + light);
    lines.push('色调：' + tone + '，主色 ' + main + '，色彩关系 ' + (f.harmony || '—'));
    lines.push('构图：' + comp);
    lines.push('细节：' + detail + '，' + sharp + '（边缘密度 ' + (f.edgeDensity * 100).toFixed(1) + '%，拉普拉斯方差 ' + Math.round(f.sharpness) + '）');
    if (f.faces && f.faces.count) lines.push('人物：检测到 ' + f.faces.count + ' 处疑似肤色区域（可能是人像/皮肤，不保证是人脸）');
    if (isVideo) {
      lines.push('镜头运动：' + (o.camera || '缓慢推近'));
      lines.push('主体动作：' + (o.motion || '自然微动'));
      lines.push('时长 / 帧率：' + (o.duration || 5) + 's / ' + (o.fps || 24) + 'fps');
    }
    lines.push('画质词：highly detailed, sharp focus, ' + (isVideo ? 'cinematic lighting, smooth motion' : '35mm lens, shallow depth of field') + ', 4k');
    lines.push('负面词：blurry, lowres, low quality, watermark, text, deformed, extra limbs');
    const one = '【一句话 prompt】' + (isVideo ? '一段' + (o.duration || 5) + '秒的视频：' : '') +
      '[主体]，' + style + '，' + light + '，' + tone + '，主色 ' + f.colors[0].name + '，' + comp +
      '，' + detail + '，' + (isVideo ? ((o.camera || '') + '，' + (o.motion || '')) : '') + '，highly detailed, 4k';
    return { text: lines.join('\n'), one: one, features: f };
  }
  function featureTable(f) {
    const rows = [
      ['尺寸', f.w + ' × ' + f.h],
      ['构图 / 比例', f.orient + ' · ' + f.aspect.toFixed(2) + ':1'],
      ['平均亮度', f.bright.toFixed(1) + ' / 255'],
      ['对比度（标准差）', f.contrast.toFixed(1)],
      ['平均饱和度', f.sat.toFixed(3)],
      ['是否黑白', f.isGray ? '是（近无彩色）' : '否'],
      ['边缘密度', (f.edgeDensity * 100).toFixed(1) + '%'],
      ['清晰度（拉普拉斯方差）', Math.round(f.sharpness)],
      ['高光/暗部截断像素', (f.clipPct * 100).toFixed(2) + '%'],
      ['高饱和像素', (f.satHighPct * 100).toFixed(2) + '%'],
      ['地平线位置', f.horizon ? Math.round(f.horizon.pct * 100) + '% 高度' : '—'],
      ['视觉重心', Math.round(f.weight.x * 100) + '% , ' + Math.round(f.weight.y * 100) + '%'],
      ['色彩关系', f.harmony || '—'],
      ['疑似肤色区域', String(f.faces ? f.faces.count : 0)]
    ];
    return '<div class="resultbox">' + rows.map(r => '<div class="row"><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>').join('') + '</div>' +
      '<div class="ptitle" style="font-size:15px;margin-top:14px">主色（K-means 聚类，真实统计）</div><div class="shapes" style="margin-top:8px">' +
      f.colors.map(c => '<span class="swatch" style="width:44px;height:44px;display:inline-block;background:' + c.hex + '" title="' + esc(c.name + ' ' + c.hex + ' ' + (c.pct * 100).toFixed(1) + '%') + '"></span>').join('') +
      '</div><div class="resultbox" style="margin-top:8px">' + f.colors.map(c => '<div class="row"><span>' + esc(c.name + ' ' + c.hex) + '</span><b>' + (c.pct * 100).toFixed(1) + '%</b></div>').join('') + '</div>';
  }
  const PROMPT_BOUNDS = '能力边界：本页用<b>本地图像分析</b>提取真实可测量的特征（主色聚类、亮度/对比度/饱和度统计、边缘密度、清晰度、构图重心、地平线、疑似肤色区域、是否黑白、色彩关系），' +
    '再把这些客观数据套进结构化模板生成描述性 prompt。它<b>不是视觉大模型，不会识别画面里到底是什么物体</b>——所以「主体」一栏留给你填。' +
    '好处：完全本地、零成本、结果里的每个数字都是真的、可复核。需要“看图说话”请使用多模态视觉模型。';
  function promptSpec(slug, title, desc, variant) {
    defImg(slug, {
      title: title,
      desc: desc,
      compare: 'none',
      maxSide: 900,
      boundsTone: 'warn',
      bounds: PROMPT_BOUNDS,
      runLabel: '分析并生成',
      pane: function () {
        return (variant === 'video' ? selk('camera', '镜头运动', ['缓慢推近', '横向平移', '环绕运镜', '手持跟随', '缓慢拉远', '俯拍下降'], '缓慢推近') +
          selk('motion', '主体动作', ['自然微动', '缓慢转身', '向前行走', '头发随风飘动', '微笑', '回头'], '自然微动') +
          sld('duration', '视频时长（秒）', 2, 20, 5, 1) +
          selk('fps', '帧率', [['24', '24 fps 电影感'], ['30', '30 fps'], ['60', '60 fps 顺滑']], '24') : '') +
          selk('lang', '输出语言', [['zh', '中文描述'], ['en', 'English prompt']], 'zh') +
          '<div class="note">图像分析在本地完成，分析结果会显示在下方面板，可直接编辑。</div>';
      },
      process: async function (src, o, prog, ctx, S) {
        const f = await analyzeImage(src, prog);
        S.extra.features = f;
        const pr = promptFromFeatures(f, { variant: variant, camera: o.camera, motion: o.motion, duration: o.duration, fps: o.fps });
        S.extra.prompt = pr;
        ctx.note('已完成本地特征分析（' + (variant === 'video' ? '视频' : '图像') + ' prompt）');
        return P2canvas(src);
      },
      after: async function (S, ctx) {
        const pr = S.extra.prompt; if (!pr) return;
        let en = '';
        if ((S.opts.lang || 'zh') === 'en') {
          const f = pr.features;
          en = 'Subject: [put your subject here]\nStyle: ' + (f.edgeDensity > 0.22 ? 'highly detailed realistic photography' : 'clean, minimal composition') +
            '\nLighting: ' + (f.bright < 80 ? 'low-key night scene' : f.bright > 185 ? 'bright natural light' : 'soft natural light') +
            '\nColor: ' + (f.isGray ? 'black and white' : (f.sat > 0.42 ? 'rich, saturated colors' : 'muted, restrained palette')) + ' dominated by ' + f.colors.slice(0, 2).map(c => c.hex).join(' and ') +
            '\nComposition: ' + f.orient + ', ' + f.aspect.toFixed(2) + ':1' + (f.horizon ? ', horizon at ' + Math.round(f.horizon.pct * 100) + '% height' : '') +
            '\nQuality: highly detailed, sharp focus, 35mm, 4k\nNegative: blurry, low quality, watermark, text, deformed';
        }
        const txt = en || pr.text;
        ctx.report(featureTable(pr.features) +
          '<div class="ptitle" style="font-size:15px;margin-top:16px">生成的 prompt（可编辑）</div>' +
          '<textarea id="aiPrompt" style="min-height:200px"></textarea>' +
          '<div class="shapes" style="margin-top:10px"><button type="button" class="btn-ghost btn-sm" id="promptCopy">复制 prompt</button>' +
          '<button type="button" class="btn-ghost btn-sm" id="promptDown">下载 .txt</button>' +
          '<button type="button" class="btn-ghost btn-sm" id="promptOne">复制一句话版</button></div>');
        const ta = $('#aiPrompt', ctx.host);
        if (ta) ta.value = txt;
        const gv = () => { const t = $('#aiPrompt', ctx.host); return t && t.value ? t.value : txt; };
        const b1 = $('#promptCopy', ctx.host); if (b1) b1.addEventListener('click', () => window.copyText(gv()));
        const b2 = $('#promptDown', ctx.host); if (b2) b2.addEventListener('click', () => ctx.download(new Blob([gv()], { type: 'text/plain;charset=utf-8' }), fmtName(S.srcName, '-prompt', 'txt')));
        const b3 = $('#promptOne', ctx.host); if (b3) b3.addEventListener('click', () => window.copyText(pr.one));
      }
    });
  }
  function o0DetectorSupport() { return typeof window.TextDetector === 'function'; }
  promptSpec('image-to-prompt', '图片转 Prompt', '分析图片的客观特征，生成结构化的绘画/摄影 prompt，可编辑、可复制、可导出。', 'image');
  promptSpec('image-to-prompt-generator', '图片转 Prompt（生成器）', '同上：本地特征分析 → 结构化 prompt。每个数值都来自真实测量。', 'image');
  promptSpec('image-prompt-generator', '图片 Prompt 生成器', '把图像的色调、光线、构图、纹理特征转成可控的 prompt 文本。', 'image');
  promptSpec('ai-art-prompt-generator', 'AI 绘画 Prompt 生成器', '从参考图提取风格要素，生成可直接粘贴到绘画工具的 prompt 与负面词。', 'image');
  promptSpec('ai-prompt-generator', 'AI Prompt 生成器', '从参考图生成结构化 prompt：主体占位 + 风格 + 光线 + 色调 + 构图 + 画质词。', 'image');
  promptSpec('video-prompt-generator', '视频 Prompt 生成器', '从参考图/分镜生成视频 prompt，含镜头运动、主体动作、时长与帧率。', 'video');

  /* 图像描述 / 文字提取 */
  defImg('image-caption-generator', {
    title: '图片描述生成器（本地特征描述）',
    desc: '用本地分析生成一段描述性 caption，并（在支持的浏览器上）尝试提取图中文字。',
    compare: 'none', maxSide: 900,
    boundsTone: 'warn',
    bounds: PROMPT_BOUNDS + ' 本页不会输出“一只猫坐在沙发上”这种语义描述——那需要视觉语言模型。',
    runLabel: '生成描述',
    process: async function (src, o, prog, ctx, S) {
      const f = await analyzeImage(src, prog);
      S.extra.features = f;
      const pr = promptFromFeatures(f, { variant: 'image' });
      S.extra.prompt = pr;
      return P2canvas(src);
    },
    after: async function (S, ctx) {
      const f = S.extra.features; if (!f) return;
      let cap = '这是一张' + f.orient + '（' + f.w + '×' + f.h + '），' +
        (f.isGray ? '黑白/近无彩色' : f.sat > 0.42 ? '高饱和' : f.sat < 0.14 ? '低饱和' : '自然饱和') + '的图像。' +
        '平均亮度 ' + f.bright.toFixed(0) + '/255，' + (f.bright < 80 ? '整体偏暗；' : f.bright > 185 ? '整体明亮；' : '曝光适中；') +
        (f.contrast > 62 ? '明暗对比强烈；' : f.contrast < 34 ? '对比度偏低、偏灰；' : '对比度适中；') +
        '画面主色是 ' + f.colors.slice(0, 2).map(c => c.name + c.hex).join(' 与 ') + '；' +
        '纹理复杂度 ' + (f.edgeDensity > 0.2 ? '高' : f.edgeDensity > 0.12 ? '中等' : '低') + '（边缘密度 ' + (f.edgeDensity * 100).toFixed(1) + '%）；' +
        '清晰度 ' + (f.sharpness > 900 ? '锐利' : f.sharpness > 250 ? '一般' : '偏软') + '。' +
        (f.faces && f.faces.count ? '检测到 ' + f.faces.count + ' 处疑似肤色区域。' : '未检测到明显肤色区域。');
      S.extra.caption = cap;
      ctx.report('<div class="outbox" id="capBox"></div><textarea id="aiPrompt" style="min-height:150px;margin-top:10px"></textarea>' +
        '<div class="shapes" style="margin-top:10px"><button type="button" class="btn-ghost btn-sm" id="promptCopy">复制描述</button>' +
        '<button type="button" class="btn-ghost btn-sm" id="promptDown">下载 .txt</button></div>' + featureTable(f));
      const cb = $('#capBox', ctx.host); if (cb) cb.textContent = cap;
      const ta = $('#aiPrompt', ctx.host); if (ta) ta.value = cap;
      const gv = () => { const t = $('#aiPrompt', ctx.host); return t && t.value ? t.value : cap; };
      const b1 = $('#promptCopy', ctx.host); if (b1) b1.addEventListener('click', () => window.copyText(gv()));
      const b2 = $('#promptDown', ctx.host); if (b2) b2.addEventListener('click', () => ctx.download(new Blob([gv()], { type: 'text/plain;charset=utf-8' }), fmtName(S.srcName, '-caption', 'txt')));
      await tryTextDetect(S, ctx);
    }
  });
  defImg('describe-image-ai', {
    title: '看图描述（本地特征 + 文字提取）',
    desc: '本地客观特征描述 + 浏览器 TextDetector（如可用）文字提取，不做语义理解。',
    compare: 'none', maxSide: 900,
    boundsTone: 'warn',
    bounds: PROMPT_BOUNDS,
    runLabel: '开始分析',
    process: async function (src, o, prog, ctx, S) { S.extra.features = await analyzeImage(src, prog); return P2canvas(src); },
    after: async function (S, ctx) {
      const f = S.extra.features; if (!f) return;
      ctx.report('<div class="outbox">图像客观特征如下，右侧为生成的结构化描述（可编辑）：</div>' + featureTable(f) +
        '<div class="ptitle" style="font-size:15px;margin-top:14px">结构化描述</div><textarea id="aiPrompt" style="min-height:160px"></textarea>' +
        '<div class="shapes" style="margin-top:10px"><button type="button" class="btn-ghost btn-sm" id="promptCopy">复制</button><button type="button" class="btn-ghost btn-sm" id="promptDown">下载 .txt</button></div>');
      const txt = promptFromFeatures(f, { variant: 'image' }).text;
      const ta = $('#aiPrompt', ctx.host); if (ta) ta.value = txt;
      const gv = () => { const t = $('#aiPrompt', ctx.host); return (t && t.value) || txt; };
      const b1 = $('#promptCopy', ctx.host); if (b1) b1.addEventListener('click', () => window.copyText(gv()));
      const b2 = $('#promptDown', ctx.host); if (b2) b2.addEventListener('click', () => ctx.download(new Blob([gv()], { type: 'text/plain;charset=utf-8' }), fmtName(S.srcName, '-describe', 'txt')));
      await tryTextDetect(S, ctx);
    }
  });
  defImg('image-to-text', {
    title: '图片转文字（文字提取 + 特征描述）',
    desc: '先尝试浏览器原生 TextDetector 做文字识别，同时给出真实的图像特征描述；两者都会明确标注来源。',
    compare: 'none', maxSide: 1100,
    boundsTone: 'warn',
    bounds: '能力边界：浏览器<b>没有内置离线 OCR 引擎</b>。本页做三件事：① 尝试调用 Chrome 的 Shape Detection API（<code>TextDetector</code>），只有部分环境可用；② 给出真实的图像客观特征描述；③ 提供<a href="#" class="linkbtn" style="display:inline;padding:0">手动抄录框</a>，并把识别到的文字绘制成方框供你核对。要稳定识别文字，请使用 OCR 服务或 Chrome 的 TextDetector 环境。',
    runLabel: '提取并分析',
    process: async function (src, o, prog, ctx, S) {
      const f = await analyzeImage(src, prog);
      S.extra.features = f;
      const canvas = P2canvas(src);
      S.extra.canvas = canvas;
      ctx.note('本地特征分析完成 · ' + (o0DetectorSupport() ? '已尝试 TextDetector 文字识别' : '本环境不支持 TextDetector（可把图交给 OCR 服务）'));
      return canvas;
    },
    after: async function (S, ctx) {
      const f = S.extra.features;
      ctx.report('<div class="ptitle" style="font-size:15px">文字识别结果</div><div class="outbox" id="ocrOut">正在尝试…</div>' +
        '<div class="plabel">手动抄录 / 修正（下方已预填本地特征描述，可直接改写为你要的文字）</div><textarea id="aiPrompt" style="min-height:180px" placeholder="把图片中的文字抄在这里，或用识别结果修正"></textarea>' +
        '<div class="shapes" style="margin-top:10px"><button type="button" class="btn-ghost btn-sm" id="promptCopy">复制文字</button><button type="button" class="btn-ghost btn-sm" id="promptDown">下载 .txt</button></div>' +
        (f ? featureTable(f) : ''));
      const pre = f ? ('【本地特征描述（无 OCR 结果时的可用输出）】\n' +
        '图像 ' + f.w + '×' + f.h + '，' + f.orient + '，' + (f.isGray ? '黑白' : '彩色（平均饱和度 ' + f.sat.toFixed(2) + '）') +
        '，平均亮度 ' + f.bright.toFixed(0) + '/255，对比度 ' + f.contrast.toFixed(0) +
        '，主色 ' + f.colors.slice(0, 3).map(c => c.name + c.hex).join('、') +
        '，边缘密度 ' + (f.edgeDensity * 100).toFixed(1) + '%。\n（本行以下是可编辑区域）\n') : '';
      const ta0 = $('#aiPrompt', ctx.host);
      if (ta0) ta0.value = pre;
      const gv = () => { const t = $('#aiPrompt', ctx.host); return (t && t.value) || ''; };
      const b1 = $('#promptCopy', ctx.host); if (b1) b1.addEventListener('click', () => window.copyText(gv()));
      const b2 = $('#promptDown', ctx.host); if (b2) b2.addEventListener('click', () => ctx.download(new Blob([gv()], { type: 'text/plain;charset=utf-8' }), fmtName(S.srcName, '-text', 'txt')));
      await tryTextDetect(S, ctx);
    }
  });
  async function tryTextDetect(S, ctx) {
    const box = $('#ocrOut', ctx.host);
    const set = h => { if (box) box.innerHTML = h; };
    if (!o0DetectorSupport()) { set('当前浏览器<b>不提供</b> <code>TextDetector</code>（Shape Detection API）。请改用 Chrome 桌面版试试，或把图片交给 OCR 服务；你也可以在下面的文本框手动抄录。'); return; }
    try {
      const td = new window.TextDetector();
      const res = await td.detect(S.extra.canvas || S.srcCanvas);
      if (!res || !res.length) { set('TextDetector 已运行，但<b>没有检测到文字</b>（也可能是文字太小/对比度不足）。'); return; }
      const words = res.map(r => r.rawValue).filter(Boolean);
      set('TextDetector 识别到 <b>' + words.length + '</b> 段文字：<br>' + esc(words.join(' / ')));
      const c = S.extra.canvas || S.srcCanvas, c2 = ctxOf(c);
      c2.strokeStyle = '#d7f452'; c2.lineWidth = Math.max(2, c.width / 400);
      res.forEach(r => { const b = r.boundingBox; c2.strokeRect(b.x, b.y, b.width, b.height); });
      const oc = $('#outCanvas', ctx.host);
      if (oc) { oc.width = c.width; oc.height = c.height; ctxOf(oc).drawImage(c, 0, 0); }
      const ta = $('#aiPrompt', ctx.host); if (ta && !ta.value) ta.value = words.join('\n');
    } catch (e) { set('TextDetector 调用失败：' + esc((e && e.message) || String(e)) + '。请改用 OCR 服务或手动抄录。'); }
  }

  /* ---- OCR 页面（预处理为主，诚实说明） ---- */
  defImg('ocr', {
    title: 'OCR 文字识别（预处理 + 诚实降级）',
    desc: '提供真实的图像预处理（灰度、二值化、去斜、去噪、放大），并尝试浏览器原生 TextDetector；识别不到时给出明确说明与手动抄录框。',
    compare: 'slider', maxSide: 1400,
    boundsTone: 'warn',
    bounds: '能力边界：<b>浏览器原生没有离线 OCR 引擎</b>。本页提供：① 真实可用的<b>图像预处理</b>（灰度 / 自适应二值化 / 倾斜校正 / 去噪 / 放大），显著提高任何 OCR 服务的识别率；② 尝试调用 Chrome 的 <code>TextDetector</code>（仅部分环境可用）；③ 预处理图下载 + 手动抄录框。<b>绝不返回伪造的文字</b>。',
    runLabel: '预处理并尝试识别',
    outName: function (o, S) { return fmtName(S.srcName, '-ocr-prep', 'png'); },
    pane: function () {
      return chkk('gray', '转为灰度', true) +
        chkk('binarize', '二值化（Otsu）', false) +
        chkk('invert', '反相（深底浅字）', false) +
        sld('denoise', '去噪 / 去底纹', 0, 60, 12, 2) +
        chkk('deskew', '自动倾斜校正', true) +
        sld('scale', '放大倍数', 1, 3, 1.4, 0.2) +
        chkk('sharpen', '锐化笔画', true);
    },
    process: async function (src, o, prog, ctx, S) {
      const w = src.w, h = src.h;
      let g = grayArr(src);
      if (o.denoise > 0) { const p2 = bilateral(src, 2, 2, 12 + o.denoise); g = grayArr(p2); }
      prog(20); await sleep();
      let ang = 0;
      if (o.deskew) {
        const sw = Math.min(320, w), sh = Math.max(1, Math.round(h * sw / w));
        const sg = new Float32Array(sw * sh);
        for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) sg[y * sw + x] = g[Math.min(h - 1, Math.round(y * h / sh)) * w + Math.min(w - 1, Math.round(x * w / sw))];
        const score = a => {
          const rows = new Float32Array(sh);
          const rad = a * Math.PI / 180, cs = Math.cos(rad), sn = Math.sin(rad);
          const cx = sw / 2, cy = sh / 2;
          for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
            const dx = x - cx, dy = y - cy;
            const ny = Math.round(sn * dx + cs * dy + cy);
            if (ny >= 0 && ny < sh) rows[ny] += (255 - sg[y * sw + x]);
          }
          let m = 0; for (let i = 0; i < sh; i++) m += rows[i]; m /= sh;
          let v = 0; for (let i = 0; i < sh; i++) v += (rows[i] - m) * (rows[i] - m);
          return v;
        };
        let best = -1;
        for (let a = -8; a <= 8; a += 1) { const s = score(a); if (s > best) { best = s; ang = a; } }
        if (Math.abs(ang) > 0.5) {
          const tmp = canvasOf(w, h), tc = ctxOf(tmp);
          tc.fillStyle = '#ffffff'; tc.fillRect(0, 0, w, h);
          tc.translate(w / 2, h / 2); tc.rotate(-ang * Math.PI / 180); tc.translate(-w / 2, -h / 2);
          tc.drawImage(S.srcCanvas, 0, 0);
          const np = getP(tmp);
          const ng = grayArr(np);
          src = np; g = ng;
        }
      }
      prog(50); await sleep();
      let lo = 0, hi = 255;
      if (o.binarize) {
        const hist = histogram(g, w, h), total = w * h;
        let sum = 0, sumB = 0, wB = 0, maxV = -1;
        for (let i = 0; i < 256; i++) sum += i * hist[i];
        for (let t = 0; t < 256; t++) {
          wB += hist[t]; if (!wB) continue;
          const wF = total - wB; if (!wF) break;
          sumB += t * hist[t];
          const mB = sumB / wB, mF = (sum - sumB) / wF;
          const v = wB * wF * (mB - mF) * (mB - mF);
          if (v > maxV) { maxV = v; lo = t; }
        }
      }
      const out = newP(w, h);
      for (let i = 0; i < w * h; i++) {
        const q = i * 4;
        let v = (o.binarize || o.gray) ? g[i] : src.data[q];
        if (o.binarize) v = v > lo ? 255 : 0;
        if (o.invert) v = 255 - v;
        out.data[q] = out.data[q + 1] = out.data[q + 2] = v; out.data[q + 3] = 255;
      }
      prog(70); await sleep();
      let canvas = P2canvas(out);
      const sc = parseFloat(o.scale) || 1;
      if (sc > 1.01) {
        const big = await lanczosResize(out, Math.round(w * sc), Math.round(h * sc), p => prog(70 + p * 0.2));
        canvas = P2canvas(big);
      }
      if (o.sharpen) { const p3 = getP(canvas); const s3 = unsharp(p3, 0.8, 0.6, 0); canvas = P2canvas(s3); }
      S.extra.canvas = canvas;
      prog(95); await sleep();
      ctx.report('<div class="ptitle" style="font-size:15px">识别</div><div class="outbox" id="ocrOut">正在尝试 TextDetector…</div>' +
        '<div class="plabel">手动抄录 / 修正</div><textarea id="aiPrompt" style="min-height:180px" placeholder="在此输入或粘贴识别到的文字"></textarea>' +
        '<div class="shapes" style="margin-top:10px"><button type="button" class="btn-ghost btn-sm" id="promptCopy">复制文字</button><button type="button" class="btn-ghost btn-sm" id="promptDown">下载 .txt</button></div>');
      const gv = () => { const t = $('#aiPrompt', ctx.host); return (t && t.value) || ''; };
      const b1 = $('#promptCopy', ctx.host); if (b1) b1.addEventListener('click', () => window.copyText(gv()));
      const b2 = $('#promptDown', ctx.host); if (b2) b2.addEventListener('click', () => ctx.download(new Blob([gv()], { type: 'text/plain;charset=utf-8' }), fmtName(S.srcName, '-ocr', 'txt')));
      ctx.note('预处理完成（倾斜校正 ' + ang.toFixed(0) + '°，二值化阈值 ' + (o.binarize ? lo : '未启用') + '）。可下载预处理图交给 OCR 服务，识别率会明显提升。');
      await tryTextDetect(S, ctx);
      prog(100);
      return canvas;
    }
  });
  /* ======================= 24. 图像取证分析（诚实的“AI 检测”） ======================= */
  function strOf(u8) { let s = ''; for (let i = 0; i < u8.length; i++) { const c = u8[i]; if (c >= 32 && c < 127) s += String.fromCharCode(c); else if (c === 0) break; else s += ' '; } return s; }
  function readDQT(seg, out) {
    let p = 0;
    while (p < seg.length) {
      const pq = seg[p] >> 4, tq = seg[p] & 15; p++;
      const t = [];
      for (let k = 0; k < 64 && p < seg.length; k++) { t.push(pq ? ((seg[p] << 8) | seg[p + 1]) : seg[p]); p += pq ? 2 : 1; }
      out.push({ id: tq, precision: pq ? 16 : 8, values: t });
      if (p >= seg.length - 1) break;
    }
  }
  function readTIFF(t, exif) {
    if (t.length < 8) return;
    const le = t[0] === 0x49;
    const u16 = o => le ? (t[o] | (t[o + 1] << 8)) : ((t[o] << 8) | t[o + 1]);
    const u32 = o => le ? ((t[o] | (t[o + 1] << 8) | (t[o + 2] << 16) | (t[o + 3] << 24)) >>> 0) : (((t[o] << 24) | (t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3]) >>> 0);
    const tags = { 0x010F: 'Make', 0x0110: 'Model', 0x0131: 'Software', 0x0132: 'DateTime', 0x013B: 'Artist', 0x8298: 'Copyright', 0xA434: 'LensModel' };
    const seen = {};
    const readIFD = off => {
      if (off + 2 > t.length || seen[off]) return; seen[off] = 1;
      const n = u16(off);
      for (let i = 0; i < n; i++) {
        const e = off + 2 + i * 12;
        if (e + 12 > t.length) break;
        const tag = u16(e), type = u16(e + 2), cnt = u32(e + 4);
        const sz = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 }[type] || 1;
        const valOff = sz * cnt > 4 ? u32(e + 8) : e + 8;
        if (tags[tag] && valOff < t.length) exif[tags[tag]] = strOf(t.subarray(valOff, Math.min(t.length, valOff + Math.min(cnt, 160)))).replace(/\0+$/g, '').trim();
        if (tag === 0x8769) { const p = u32(e + 8); if (p > 8 && p < t.length) readIFD(p); }
      }
    };
    readIFD(u32(4));
  }
  function readAPP1(seg, r) {
    if (seg.length > 6 && seg[0] === 0x45 && seg[1] === 0x78 && seg[2] === 0x69 && seg[3] === 0x66) {
      try { readTIFF(seg.subarray(6), r.exif); } catch (e) { r.exifErr = String(e); }
    } else {
      const head = strOf(seg.subarray(0, 48));
      if (/xap|<?xpacket|<x:xmpmeta/i.test(head)) r.hasXMP = true;
    }
  }
  function parseJPEG(buf) {
    const r = { format: 'JPEG', dqt: [], exif: {}, app: [], width: 0, height: 0, sof: '', components: 0, progressive: false, eoi: false };
    let i = 2;
    while (i < buf.length - 3) {
      if (buf[i] !== 0xFF) { i++; continue; }
      const m = buf[i + 1];
      if (m === 0xFF) { i++; continue; }
      if (m === 0xD8 || m === 0xD9) { if (m === 0xD9) r.eoi = true; i += 2; continue; }
      if (m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
      const len = (buf[i + 2] << 8) | buf[i + 3];
      if (len < 2) break;
      const seg = buf.subarray(i + 4, Math.min(buf.length, i + 2 + len));
      if (m === 0xDB) readDQT(seg, r.dqt);
      else if (m === 0xC0 || m === 0xC1 || m === 0xC2) { r.sof = m === 0xC2 ? 'progressive' : 'baseline'; r.progressive = m === 0xC2; r.height = (seg[1] << 8) | seg[2]; r.width = (seg[3] << 8) | seg[4]; r.components = seg[5]; }
      else if (m >= 0xE0 && m <= 0xEF) { r.app.push('APP' + (m - 0xE0)); if (m === 0xE1) readAPP1(seg, r); }
      else if (m === 0xDA) { r.scanStart = i; break; }
      i += 2 + len;
    }
    return r;
  }
  function parsePNG(buf) {
    const r = { format: 'PNG', chunks: [], text: [], width: 0, height: 0 };
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let i = 8;
    while (i + 8 <= buf.length) {
      const len = dv.getUint32(i);
      if (len > buf.length) break;
      const type = strOf(buf.subarray(i + 4, i + 8));
      const data = buf.subarray(i + 8, Math.min(buf.length, i + 8 + len));
      r.chunks.push(type);
      if (type === 'IHDR') { r.width = dv.getUint32(i + 8); r.height = dv.getUint32(i + 12); }
      if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') r.text.push(strOf(data.subarray(0, Math.min(data.length, 600))));
      i += 12 + len;
      if (type === 'IEND') break;
    }
    return r;
  }
  const AI_KEYWORDS = ['Midjourney', 'Stable Diffusion', 'StableDiffusion', 'stable-diffusion', 'DALL-E', 'DALL·E', 'Dall-E', 'ComfyUI', 'Automatic1111', 'AUTOMATIC1111', 'NovelAI', 'InvokeAI', 'Fooocus', 'sd-webui', 'SDXL', 'DreamStudio', 'NightCafe', 'Krea', 'Firefly', 'Bing Image Creator', 'Image Creator', 'Imagen', 'Leonardo', 'Playground', 'Grok', 'Negative prompt', 'Sampler:', 'CFG scale', 'Model hash', 'Steps:', 'Software', 'xmp', 'Photoshop', 'GIMP', 'Snapseed', 'Lightroom', 'MediaStore'];
  function scanKeywords(buf) {
    const lim = Math.min(buf.length, 700 * 1024);
    const s = strOf(buf.subarray(0, lim));
    const tail = buf.length > lim ? strOf(buf.subarray(buf.length - 128 * 1024)) : '';
    const hits = [];
    AI_KEYWORDS.forEach(k => { if (s.indexOf(k) >= 0 || (tail && tail.indexOf(k) >= 0)) hits.push(k); });
    return hits;
  }
  const STD_LUMA = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
  const STD_CHROMA = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99];
  function dhash(p) {
    const c = canvasOf(9, 8), x = ctxOf(c);
    x.imageSmoothingEnabled = true; x.drawImage(P2canvas(p), 0, 0, 9, 8);
    const d = x.getImageData(0, 0, 9, 8).data;
    let lo = 0, hi = 0, n = 0;
    for (let y = 0; y < 8; y++) for (let xx = 0; xx < 8; xx++) {
      const i = (y * 9 + xx) * 4, j = (y * 9 + xx + 1) * 4;
      const a = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const b = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
      if (a > b) { if (n < 32) lo = (lo | (1 << n)) >>> 0; else hi = (hi | (1 << (n - 32))) >>> 0; }
      n++;
    }
    const hx = v => ('00000000' + v.toString(16)).slice(-8);
    return hx(hi) + hx(lo);
  }
  function noiseConsistency(p) {
    const w = p.w, h = p.h, g = grayArr(p), B = 24;
    const vars = [];
    for (let by = 1; by + B < h; by += B) for (let bx = 1; bx + B < w; bx += B) {
      let s = 0, s2 = 0, c = 0;
      for (let y = by; y < by + B; y += 2) for (let x = bx; x < bx + B; x += 2) {
        const i = y * w + x;
        const v = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
        s += v; s2 += v * v; c++;
      }
      if (c) vars.push(s2 / c - (s / c) * (s / c));
    }
    if (!vars.length) return { mean: 0, cv: 0, uniform: 0, blocks: 0 };
    let mean = 0; vars.forEach(v => mean += v); mean /= vars.length;
    let sd = 0, uni = 0;
    vars.forEach(v => { sd += (v - mean) * (v - mean); if (v < 0.6) uni++; });
    sd = Math.sqrt(sd / vars.length);
    return { mean: mean, cv: mean > 0 ? sd / mean : 0, uniform: uni / vars.length, blocks: vars.length };
  }
  function checkQTable(t, std) {
    if (!t || t.values.length < 64) return null;
    let same = true;
    for (let i = 0; i < 64; i++) if (t.values[i] !== std[i]) { same = false; break; }
    let sum = 0; t.values.forEach(v => sum += v);
    return { same: same, quality: Math.round(100 - clamp(sum / 1000, 0, 100)), sum: sum };
  }
  function forensicSpec(slug, title) {
    defImg(slug, {
      title: title,
      desc: '读取文件的真实取证线索：JPEG 量化表、EXIF/XMP 元数据、生成工具关键字、尺寸类别、噪声一致性、色阶截断、哈希，供人工判断。',
      compare: 'none',
      maxSide: 900,
      boundsTone: 'warn',
      bounds: '重要：<b>本页无法可靠判定一张图是不是 AI 生成的</b>，因此<b>不会输出“87% 是 AI 生成”这类假置信度</b>。它只做真实可复核的取证分析：JPEG 量化表（是否标准表 / 二次压缩痕迹）、EXIF/XMP 是否有相机机型或生成工具关键字、尺寸是否为常见的生成尺寸、噪声在分块上的均匀性、色阶是否异常截断、以及内容哈希。' +
        '这些线索需要你结合上下文判断，<b>不构成鉴定结论</b>。想了解原理，请把本页当“取证工具箱”而非“检测器”。',
      runLabel: '生成取证报告',
      pane: function () { return '<div class="note">点击下方按钮开始分析。全部在本机读取文件字节，不上传。</div>'; },
      process: async function (src, o, prog, ctx, S) {
        const f = await analyzeImage(src, prog);
        S.extra.features = f;
        prog(60);
        const rep = { clues: [], facts: [] };
        let jp = null, pn = null, hits = [], sha = '';
        const fname = S.srcFile ? S.srcFile.name : '';
        try {
          const buf = new Uint8Array(await S.srcFile.arrayBuffer());
          sha = await hashOf(buf);
          if (buf[0] === 0xFF && buf[1] === 0xD8) jp = parseJPEG(buf);
          else if (buf[0] === 0x89 && buf[1] === 0x50) pn = parsePNG(buf);
          hits = scanKeywords(buf);
        } catch (e) { rep.err = String(e && e.message || e); }
        prog(80);
        S.extra.forensics = { jp: jp, pn: pn, hits: hits, sha: sha, f: f, name: fname };
        prog(100);
        return P2canvas(src);
      },
      after: function (S, ctx) {
        const F = S.extra.forensics; if (!F) return;
        const f = F.f, jp = F.jp, pn = F.pn;
        const rows = [];
        rows.push(['文件', F.name || '—']);
        rows.push(['格式', jp ? ('JPEG ' + (jp.progressive ? '渐进式' : '基线')) : pn ? 'PNG' : '其他/未知']);
        rows.push(['尺寸', f.w + ' × ' + f.h]);
        if (jp) { rows.push(['色彩分量', String(jp.components)]); rows.push(['APP 段', jp.app.join(', ') || '无']); }
        if (pn) rows.push(['PNG 块', pn.chunks.slice(0, 12).join(', ')]);
        rows.push(['SHA-256', F.sha ? F.sha.slice(0, 32) + '…' : '不可用']);
        rows.push(['感知哈希 dHash', dhash(S.src)]);
        const ex = jp ? jp.exif : {};
        ['Make', 'Model', 'Software', 'DateTime', 'Artist', 'Copyright', 'LensModel'].forEach(k => { if (ex[k]) rows.push(['EXIF ' + k, ex[k]]); });
        if (pn && pn.text.length) pn.text.slice(0, 4).forEach((t, i) => rows.push(['PNG 文本 ' + (i + 1), t.slice(0, 160)]));
        const clue = [];
        const hasCam = !!(ex.Make || ex.Model);
        if (hasCam) clue.push('✅ EXIF 里存在相机厂商/机型（' + [ex.Make, ex.Model].filter(Boolean).join(' ') + '），倾向于来自真实拍摄设备。');
        else clue.push('⚠️ 没有找到相机厂商/机型字段。相机原图通常带 Make/Model；但社交平台、截图、导出都会剥掉元数据，所以这<b>不能证明</b>它来自 AI。');
        if (jp && jp.exif && jp.exif.Software) clue.push('📷 EXIF Software = “' + ex.Software + '”。');
        if (F.hits.length) clue.push('🔎 文件字节中出现关键字：<b>' + esc(F.hits.join('、')) + '</b>。若包含生成工具名（如 Midjourney / Stable Diffusion / ComfyUI / DALL·E）或 “Negative prompt / Steps: / CFG scale” 这类扩散模型参数，是很强的线索。');
        else clue.push('🔎 未在文件头尾找到明显的生成工具关键字（元数据被剥离时也会出现这种情况）。');
        if (jp && jp.dqt && jp.dqt.length) {
          const l = checkQTable(jp.dqt.find(t => t.id === 0) || jp.dqt[0], STD_LUMA);
          const c = jp.dqt.length > 1 ? checkQTable(jp.dqt.find(t => t.id === 1), STD_CHROMA) : null;
          rows.push(['量化表数量', String(jp.dqt.length)]);
          if (l) rows.push(['亮度量化表', l.same ? '与标准 IJG 表一致（普通编码器输出）' : '非标准（可能是自定义质量/二次编码/裁剪）']);
          if (l) rows.push(['估计 JPEG 质量', l.quality + ' 左右（按表求和粗估）']);
          if (c) rows.push(['色度量化表', c.same ? '标准' : '非标准']);
          clue.push(l && l.same ? '📊 量化表与标准表一致：说明是常规 JPEG 编码路径，常见于相机、截图或普通导出。<b>AI 生成图经普通 JPEG 导出也会这样</b>，所以这条只能排除“奇怪的自定义编码”，不能证明来源。'
            : '📊 量化表不是标准表：可能经过自定义质量压缩、二次编码或裁剪拼接 —— 值得进一步检查是否二次压缩过。');
        } else if (jp) clue.push('📊 未解析到量化表（可能是极小文件或非标准 JPEG）。');
        const nc = noiseConsistency(S.src);
        rows.push(['噪声一致性', '均值 ' + nc.mean.toFixed(1) + ' · 变异系数 ' + nc.cv.toFixed(2) + ' · 完全平坦块 ' + (nc.uniform * 100).toFixed(1) + '%']);
        clue.push('🎛 分块拉普拉斯能量变异系数 ' + nc.cv.toFixed(2) + (nc.cv < 0.55 ? '（噪声分布偏均匀）' : '（噪声分布较不均匀）') + '，完全平坦块占 ' + (nc.uniform * 100).toFixed(1) + '%。' +
          '老式相机原图噪点通常不均匀（按亮度分布），部分 AI 图与强降噪图会异常均匀 —— 但「强降噪的照片」与「AI 图」在这里表现相同，<b>单看这条无法区分</b>。');
        const sizes = [512, 640, 768, 1024, 1152, 1280, 1536, 2048, 2560, 4096];
        const isStd = sizes.indexOf(f.w) >= 0 && sizes.indexOf(f.h) >= 0;
        const isSq = f.w === f.h;
        rows.push(['常见生成尺寸', isStd ? '是（' + f.w + '×' + f.h + ' 属于常用生成分辨率）' : '否']);
        clue.push(isStd ? '📐 尺寸 ' + f.w + '×' + f.h + ' 正好是常用的生成分辨率之一（512/768/1024/2048 等）。' + (isSq ? '且是正方形，常见于扩散模型默认输出。' : '') + '这是一条弱线索，很多素材图也是这个尺寸。'
          : '📐 尺寸 ' + f.w + '×' + f.h + ' 不是常见的扩散模型默认输出尺寸，更可能是相机或编辑导出。');
        rows.push(['亮度截断像素', (f.clipPct * 100).toFixed(2) + '%']);
        if (f.clipPct > 0.02) clue.push('💡 有 ' + (f.clipPct * 100).toFixed(2) + '% 的像素在高光或暗部被截断（纯 0/255），可能是强对比处理或生成时的过曝。');
        rows.push(['高饱和像素', (f.satHighPct * 100).toFixed(2) + '%']);
        if (f.satHighPct > 0.03) clue.push('🌈 有 ' + (f.satHighPct * 100).toFixed(2) + '% 的像素接近满饱和，部分生成模型在色彩上会偏“艳丽失真”。');
        if (F.err) clue.push('⚠️ 解析文件时出现问题：' + esc(F.err));

        ctx.report(
          '<div class="ptitle" style="font-size:15px">取证数据（全部可在本机复核）</div>' +
          '<div class="resultbox">' + rows.map(r => '<div class="row"><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>').join('') + '</div>' +
          '<div class="ptitle" style="font-size:15px;margin-top:14px">线索解读</div>' +
          '<div class="outbox">' + clue.map(c => '<div style="margin-bottom:6px">• ' + c + '</div>').join('') + '</div>' +
          '<div class="warnbox" style="margin-top:12px"><b>结论与免责声明：</b>以上是可供人工判断的取证线索，<b>无法可靠判定是否为 AI 生成</b>。不构成鉴定结论。' +
          '元数据可以被清除或伪造，量化表与噪声特征在“压缩—导出—截图”之后同样会失真。请勿把本页结果作为唯一依据用于指控、审核或公开结论。' +
          '如果确实需要判定，请结合来源溯源（反向图片搜索）、相机原始文件、以及可信的模型检测服务综合评估。</div>' +
          '<div class="shapes" style="margin-top:10px"><button type="button" class="btn-ghost btn-sm" id="repDown">下载 .txt 报告</button></div>');
        const b = $('#repDown', ctx.host);
        if (b) b.addEventListener('click', () => {
          const txt = rows.map(r => r[0] + ': ' + r[1]).join('\n') + '\n\n线索解读:\n' + clue.map(c => '- ' + c.replace(/<[^>]+>/g, '')).join('\n') +
            '\n\n免责声明：以上为取证线索，无法可靠判定是否为 AI 生成，不构成鉴定结论。';
          ctx.download(new Blob([txt], { type: 'text/plain;charset=utf-8' }), fmtName(S.srcName, '-forensics', 'txt'));
        });
        ctx.note('取证分析完成（' + (jp ? 'JPEG' : pn ? 'PNG' : '未知格式') + '）。请注意：结果为线索而非鉴定结论。');
      }
    });
  }
  forensicSpec('ai-image-detector', 'AI 图像检测（取证线索面板）');
  forensicSpec('ai-generated-image-checker', 'AI 生成图检查（取证线索面板）');
  /* ======================= 25. 音频特征分析（诚实的“AI 音乐检测”） ======================= */
  function fft(re, im, n) {
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const ur = re[i + k], ui = im[i + k];
          const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
          const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
          const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  }
  function detectBPM(buf, prog) {
    const sr = buf.sampleRate, ch = buf.numberOfChannels;
    const n = Math.min(buf.length, Math.floor(sr * 90));
    const mono = new Float32Array(n);
    for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / ch; }
    const N = 1024, H = 256;
    const frames = Math.max(2, Math.floor((n - N) / H));
    const env = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      let e = 0; const off = f * H;
      for (let i = 0; i < N; i += 2) { const v = mono[off + i]; e += v * v; }
      env[f] = Math.sqrt(e / (N / 2));
    }
    const onset = new Float32Array(frames);
    let mean = 0; for (let f = 0; f < frames; f++) mean += env[f]; mean /= frames;
    for (let f = 1; f < frames; f++) onset[f] = Math.max(0, env[f] - env[f - 1] - mean * 0.05);
    const fps = sr / H;
    const minLag = Math.max(3, Math.round(fps * 60 / 210)), maxLag = Math.min(frames - 2, Math.round(fps * 60 / 55));
    const ac = new Float32Array(maxLag + 2);
    let bestLag = 0, bestV = -1, total = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let v = 0;
      for (let i = 0; i < frames - lag; i++) v += onset[i] * onset[i + lag];
      v /= Math.max(1, frames - lag);
      ac[lag] = v; total += v;
      if (v > bestV) { bestV = v; bestLag = lag; }
    }
    if (prog) prog(45);
    // 抛物线插值，得到亚帧精度（否则节拍周期不是整帧时误差会累积）
    let lagF = bestLag;
    if (bestLag > minLag && bestLag < maxLag) {
      const y0 = ac[bestLag - 1], y1 = ac[bestLag], y2 = ac[bestLag + 1];
      const den = (y0 - 2 * y1 + y2);
      if (den !== 0) { const dl = 0.5 * (y0 - y2) / den; if (Math.abs(dl) < 1) lagF = bestLag + dl; }
    }
    const bpm = lagF > 0 ? 60 * fps / lagF : 0;
    const conf = total > 0 ? bestV / (total / Math.max(1, maxLag - minLag)) : 0;
    let mxOn = 0; for (let f = 0; f < frames; f++) if (onset[f] > mxOn) mxOn = onset[f];
    const thr = mxOn * 0.35;
    const peaks = [];
    for (let f = 2; f < frames - 1; f++) if (onset[f] > onset[f - 1] && onset[f] >= onset[f + 1] && onset[f] > thr) peaks.push(f);
    let ivar = 0;
    if (peaks.length > 4) {
      const d = []; for (let i = 1; i < peaks.length; i++) d.push(peaks[i] - peaks[i - 1]);
      const m = d.reduce((a, b) => a + b, 0) / d.length;
      ivar = Math.sqrt(d.reduce((a, b) => a + (b - m) * (b - m), 0) / d.length) / Math.max(1, m);
    }
    return { bpm: bpm, confidence: conf, beatCount: peaks.length, intervalCV: ivar, seconds: n / sr };
  }
  function analyzeAudio(buf, prog) {
    const sr = buf.sampleRate, ch = buf.numberOfChannels, len = buf.length;
    const L = buf.getChannelData(0);
    const R = ch > 1 ? buf.getChannelData(1) : L;
    let peak = 0, sum2 = 0, clip = 0, zc = 0, prev = 0;
    for (let i = 0; i < len; i++) {
      const v = L[i], a = Math.abs(v);
      if (a > peak) peak = a;
      sum2 += v * v;
      if (a >= 0.999) clip++;
      if ((v >= 0) !== (prev >= 0)) zc++;
      prev = v;
    }
    const rms = Math.sqrt(sum2 / len);
    // 立体声相关性
    let corr = 1, sideE = 0, midE = 0;
    for (let i = 0; i < len; i += 2) {
      const l = L[i], r = R[i];
      corr += 0; midE += (l + r) * (l + r) / 4; sideE += (l - r) * (l - r) / 4;
    }
    let sl = 0, sr2 = 0, slr = 0;
    for (let i = 0; i < len; i += 4) { sl += L[i] * L[i]; sr2 += R[i] * R[i]; slr += L[i] * R[i]; }
    corr = sl && sr2 ? slr / Math.sqrt(sl * sr2) : 1;
    // 频谱：均匀抽取 240 帧做 1024 点 FFT
    const N = 1024, H = 512, maxFrames = Math.floor((len - N) / H);
    const step = Math.max(1, Math.floor(maxFrames / 240));
    let centroidSum = 0, flatSum = 0, framesUsed = 0;
    let band = [0, 0, 0], bandTotal = 0;
    const re = new Float32Array(N), im = new Float32Array(N);
    for (let f = 0; f < maxFrames; f += step) {
      const off = f * H;
      for (let i = 0; i < N; i++) {
        const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)); // Hann
        const s = ch > 1 ? (L[off + i] + R[off + i]) * 0.5 : L[off + i];
        re[i] = s * w; im[i] = 0;
      }
      fft(re, im, N);
      let cw = 0, cs = 0, logSum = 0, linSum = 0, cnt = 0;
      for (let k = 1; k < N / 2; k++) {
        const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
        const freq = k * sr / N;
        cs += freq * mag; cw += mag;
        logSum += Math.log(mag + 1e-10); linSum += mag; cnt++;
        if (freq < 250) band[0] += mag; else if (freq < 2000) band[1] += mag; else band[2] += mag;
        bandTotal += mag;
      }
      if (cw > 0) centroidSum += cs / cw;
      if (cnt) flatSum += Math.exp(logSum / cnt) / Math.max(1e-9, linSum / cnt);
      framesUsed++;
    }
    if (prog) prog(80);
    return {
      sr: sr, ch: ch, dur: buf.duration, peak: peak, rms: rms,
      crestDb: 20 * Math.log10(Math.max(1e-6, peak) / Math.max(1e-9, rms)),
      clipPct: clip / len, zcr: zc / len,
      corr: corr, sideRatio: (midE + sideE) > 0 ? sideE / (midE + sideE) : 0,
      centroid: framesUsed ? centroidSum / framesUsed : 0,
      flatness: framesUsed ? flatSum / framesUsed : 0,
      bands: bandTotal > 0 ? [band[0] / bandTotal, band[1] / bandTotal, band[2] / bandTotal] : [0, 0, 0]
    };
  }
  function audioPanel(slug, title) {
    return function mount(host, cfg) {
      const T = window.TUI;
      const shell = T.shell(host, true);
      const stage = shell.stage, pane = shell.pane;
      const S = { file: null, ctxAC: null, buf: null, res: null };
      stage.innerHTML = T.drop('<div class="ic">' + window.icon('audio', 30) + '</div><h3>选择一首歌或一段音频</h3><p>支持 mp3 / wav / m4a / flac / ogg，也支持视频里的音轨</p>' +
        '<button class="btn-lime" type="button">' + window.icon('audio', 16) + ' 选择文件 <span><svg data-lucide="arrow-right" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></span></button>', 'audio/*,video/*', false) +
        '<div id="apLoaded" class="hide" style="flex:1;display:flex;flex-direction:column"></div>';
      pane.innerHTML = '<div class="ptitle">' + esc(title) + '</div>' +
        '<div class="pdesc">用 Web Audio 做真实的音频测量：BPM（起音包络自相关）、频谱质心、动态范围、立体声相关性、削波比例、频段能量分布、频谱平坦度。</div>' +
        boundsBox('warn', '重要：<b>本页无法判定一首歌是否为 AI 生成</b>，所以不会给出“AI 概率”。它只给出真实可复核的声学测量值，以及「人类演奏 / 录音 vs 纯合成程序」在一些特征上的常见差异说明。最终判断需要专业鉴定与来源信息，<b>不构成鉴定结论</b>。') +
        '<button class="btn-lime btn-run" id="apRun">开始分析</button>' +
        '<div class="progress" id="aiProg"><i></i></div>' +
        '<div class="outbox" id="aiOut">输出：—</div>' +
        '<div id="aiReport"></div>' +
        '<div class="runnote">文件不会上传，分析在本机完成。</div>';
      const pick = $('.drop button', host);
      if (pick) pick.addEventListener('click', e => { e.stopPropagation(); $('#tFile', host).click(); });
      T.bindDrop(host, 'audio/*,video/*', false, files => load(files[0]));

      async function load(f) {
        if (!f) return;
        S.file = f;
        $('#tDrop', host).classList.add('hide');
        $('#apLoaded', host).classList.remove('hide');
        const box = $('#apLoaded', host);
        box.innerHTML = '<div class="canvaswrap" style="padding:20px;flex-direction:column;gap:12px">' +
          (/^video\//.test(f.type) ? '<video id="apMedia" controls playsinline style="max-width:100%;max-height:300px"></video>' : '<audio id="apMedia" controls style="width:100%"></audio>') +
          '<canvas id="apWave" style="width:100%;height:120px;background:#0d0d0d;border-radius:10px"></canvas></div>' +
          '<div class="filebar"><span><b>' + esc(f.name) + '</b> <span>' + window.fmtSize(f.size) + '</span></span><span class="newv" id="apNew">换一个</span></div>';
        const media = $('#apMedia', host); media.src = URL.createObjectURL(f);
        $('#apNew', host).addEventListener('click', () => {
          S.file = null;
          $('#apLoaded', host).classList.add('hide'); $('#tDrop', host).classList.remove('hide');
          const fi = $('#tFile', host); if (fi) fi.value = '';
          if (S.ctxAC) { try { S.ctxAC.close(); } catch (e) { } S.ctxAC = null; }
        });
        try { await ensureBuf(f); drawWave(); } catch (e) { T.prog($('#aiProg', host), 0); $('#aiOut', host).textContent = '无法解码该音频：' + (e && e.message || e); }
      }
      async function ensureBuf(f) {
        if (S.buf) return S.buf;
        const AC = window.AudioContext || window.webkitAudioContext;
        const ac = new AC();
        S.ctxAC = ac;
        const ab = await f.arrayBuffer();
        S.buf = await new Promise((res, rej) => { const p = ac.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); });
        return S.buf;
      }
      function drawWave() {
        const cv = $('#apWave', host); if (!cv || !S.buf) return;
        const w = cv.width = 900, h = cv.height = 120, c = ctxOf(cv);
        c.fillStyle = '#0d0d0d'; c.fillRect(0, 0, w, h);
        const d = S.buf.getChannelData(0), step = Math.max(1, Math.floor(d.length / w));
        c.strokeStyle = '#d7f452'; c.beginPath();
        for (let x = 0; x < w; x++) {
          let mn = 1, mx = -1;
          for (let i = x * step; i < (x + 1) * step && i < d.length; i += 4) { const v = d[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
          c.moveTo(x, (1 - mx) * h / 2); c.lineTo(x, (1 - mn) * h / 2);
        }
        c.stroke();
      }
      $('#apRun', host).addEventListener('click', async () => {
        if (!S.file) { toast('请先选择音频文件'); return; }
        const btn = $('#apRun', host); btn.disabled = true; btn.textContent = '分析中…';
        T.prog($('#aiProg', host), 5);
        try {
          const buf = await ensureBuf(S.file);
          T.prog($('#aiProg', host), 20); await sleep();
          const a = analyzeAudio(buf, p => T.prog($('#aiProg', host), 20 + p * 0.4));
          const b = detectBPM(buf, p => T.prog($('#aiProg', host), 60 + p * 0.3));
          await sleep();
          S.res = { a: a, b: b };
          render(a, b);
          T.prog($('#aiProg', host), 100);
        } catch (e) {
          $('#aiOut', host).textContent = '分析失败：' + ((e && e.message) || e) + '（可能是浏览器无法解码该编码）';
          toast('分析失败');
        }
        btn.disabled = false; btn.textContent = '开始分析';
      });
      function render(a, b) {
        const rows = [
          ['时长', a.dur.toFixed(2) + ' s'],
          ['采样率 / 声道', a.sr + ' Hz · ' + a.ch + ' ch'],
          ['峰值电平', (20 * Math.log10(Math.max(1e-6, a.peak))).toFixed(1) + ' dBFS'],
          ['RMS 电平', (20 * Math.log10(Math.max(1e-9, a.rms))).toFixed(1) + ' dBFS'],
          ['波峰因数（峰值-RMS）', a.crestDb.toFixed(1) + ' dB'],
          ['削波样本比例', (a.clipPct * 100).toFixed(4) + '%'],
          ['过零率', a.zcr.toFixed(4)],
          ['估计 BPM', b.bpm ? b.bpm.toFixed(1) + '（拍点 ' + b.beatCount + ' 个，间隔变异 ' + b.intervalCV.toFixed(2) + '）' : '未检出'],
          ['拍点规整度（间隔变异系数）', b.intervalCV ? b.intervalCV.toFixed(3) + (b.intervalCV < 0.06 ? '（非常规整，接近节拍器/程序鼓）' : b.intervalCV < 0.15 ? '（较规整）' : '（有明显人性化晃动）') : '—'],
          ['频谱质心', Math.round(a.centroid) + ' Hz'],
          ['频谱平坦度', a.flatness.toFixed(3) + (a.flatness > 0.12 ? '（噪声成分多）' : '（音调成分多）')],
          ['低频 / 中频 / 高频能量', (a.bands[0] * 100).toFixed(1) + '% / ' + (a.bands[1] * 100).toFixed(1) + '% / ' + (a.bands[2] * 100).toFixed(1) + '%'],
          ['左右声道相关系数', a.corr.toFixed(3)],
          ['侧声道能量占比', (a.sideRatio * 100).toFixed(1) + '%']
        ];
        const clues = [];
        clues.push('🎚 <b>动态范围</b>：波峰因数 ' + a.crestDb.toFixed(1) + ' dB。' + (a.crestDb < 9 ? '偏低，接近“全程压满”的商业母带或纯程序化编曲；真实乐器演奏的未压缩录音通常更高。' : a.crestDb < 15 ? '属于常见商业混音区间。' : '较高，保留有自然动态。注意：母带处理会同时降低两者，所以这条不能单独下结论。'));
        clues.push('🥁 <b>节拍规整度</b>：' + (b.intervalCV && b.intervalCV < 0.06 ? '拍点间隔极其规整，与“程序鼓机 / 量化到网格的编曲”一致；真人鼓手通常会有 3%~10% 的自然晃动。但现代制作大量使用量化，人类作品同样会非常规整。' : '拍点间隔存在波动，更接近真人演奏或未量化的编排（也可能是检测误差）。'));
        clues.push('🎻 <b>频谱质心</b> ' + Math.round(a.centroid) + ' Hz、<b>平坦度</b> ' + a.flatness.toFixed(3) + '：' + (a.flatness > 0.15 ? '噪声性成分较多（可能是密集打击乐、失真吉他或合成噪声源）。' : '音调性成分占主导。'));
        clues.push('📻 <b>频段分布</b>：低频 ' + (a.bands[0] * 100).toFixed(0) + '%，中频 ' + (a.bands[1] * 100).toFixed(0) + '%，高频 ' + (a.bands[2] * 100).toFixed(0) + '%。');
        clues.push('🎧 <b>立体声</b>：左右相关系数 ' + a.corr.toFixed(2) + '（' + (a.corr > 0.95 ? '几乎单声道，或强相关；纯程序生成的素材常见' : a.corr < 0.5 ? '声道差异很大，空间感强' : '常见立体声宽度') + '）。');
        if (a.clipPct > 0.0005) clues.push('✂️ 检测到削波（' + (a.clipPct * 100).toFixed(3) + '% 的样本达到满刻度），通常是过度限幅/响度战争的结果——人类混音与 AI 生成都可能出现。');
        else clues.push('✂️ 未检测到明显削波。');
        clues.push('📝 常见差异总结：<b>人类演奏录音</b>常带环境噪声底、房间混响、演奏力度与音准的自然波动、麦克风串音；<b>纯合成/程序生成</b>常见异常干净的声底、精确到毫秒的量化、以及个别频段的规律性重复。但“AI 生成”与“人类用软件制作”在这些指标上高度重叠——<b>下表数值不能证明来源</b>。');
        $('#aiOut', host).innerHTML = '分析完成：时长 <b>' + a.dur.toFixed(1) + 's</b>，估计 <b>' + (b.bpm ? b.bpm.toFixed(0) + ' BPM' : '未检出拍点') + '</b>';
        $('#aiReport', host).innerHTML =
          '<div class="ptitle" style="font-size:15px">真实测量值</div><div class="resultbox">' +
          rows.map(r => '<div class="row"><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>').join('') + '</div>' +
          '<div class="ptitle" style="font-size:15px;margin-top:14px">特征解读</div><div class="outbox">' +
          clues.map(c => '<div style="margin-bottom:6px">• ' + c + '</div>').join('') + '</div>' +
          '<div class="warnbox" style="margin-top:12px"><b>结论与免责声明：</b>以上全部是可在本机复算的声学测量值，<b>不构成“是否为 AI 生成音乐”的鉴定结论</b>。' +
          '本页不输出任何 AI 概率。若需要判定，请结合创作过程记录、分轨文件、版权登记与专业机构鉴定。</div>' +
          '<div class="shapes" style="margin-top:10px"><button type="button" class="btn-ghost btn-sm" id="apDown">下载 .txt 报告</button></div>';
        const b2 = $('#apDown', host);
        if (b2) b2.addEventListener('click', () => {
          const txt = rows.map(r => r[0] + ': ' + r[1]).join('\n') + '\n\n特征解读:\n' + clues.map(c => '- ' + c.replace(/<[^>]+>/g, '')).join('\n') +
            '\n\n免责声明：以上为声学测量值，不构成 AI 生成音乐鉴定结论。';
          window.downloadBlob(new Blob([txt], { type: 'text/plain;charset=utf-8' }), fmtName(S.file ? S.file.name : 'audio', '-analysis', 'txt'));
        });
      }
    };
  }
  const MOUNTS = {};

  /* ======================= 26. 换脸（诚实演示） ======================= */
  defImg('face-swapper', {
    title: '换脸预览（诚实降级）',
    desc: '本地检测人脸大致区域（FaceDetector API 或肤色连通域），把来源人脸缩放贴合到目标脸的椭圆区域并羽化混合。',
    compare: 'slider',
    maxSide: 1400,
    boundsTone: 'warn',
    bounds: '重要：本页<b>不做真正的人脸替换</b>。真正的人脸替换需要人脸关键点检测与生成模型（如 InsightFace + inswapper），浏览器端纯本地做不到。本页提供的是<b>人脸区域椭圆羽化叠加预览</b>，仅用于演示、教学与算法学习，效果是“贴上去”而不是“换脸”。<br><b>安全提示：请勿使用本工具伪造他人身份、制作虚假影像或用于任何欺骗、骚扰、诽谤用途。</b>使用他人肖像需取得授权。',
    runLabel: '合成预览',
    outName: function (o, S) { return fmtName(S.srcName, '-faceswap-preview', 'png'); },
    pane: function () {
      return '<div class="plabel">来源人脸图</div><div class="drop-mini" id="facePick">点击选择一张人脸照片</div>' +
        '<input type="file" id="faceFile" accept="image/*" style="display:none">' +
        sld('fx', '人脸中心 X (%)', 0, 100, 50, 1) +
        sld('fy', '人脸中心 Y (%)', 0, 100, 40, 1) +
        sld('fs', '人脸大小 (%短边)', 8, 90, 34, 1) +
        sld('feather', '羽化', 0, 60, 22, 2) +
        sld('blend', '混合强度', 20, 100, 85, 5) +
        sld('warm', '肤色匹配（暖/冷）', -50, 50, 0, 2) +
        chkk('autoDetect', '自动尝试检测人位置（FaceDetector / 肤色）', true) +
        '<div class="note" id="faceInfo">尚未选择来源人脸。</div>';
    },
    mountAfter: function (S, ctx) {
      const d = $('#facePick', ctx.host), fi = $('#faceFile', ctx.host);
      if (d && fi) {
        d.addEventListener('click', () => fi.click());
        fi.addEventListener('change', async () => {
          if (!fi.files[0]) return;
          try { S.extra.face = imageToCanvas(await loadImg(fi.files[0]), 1200); d.textContent = '已选择：' + fi.files[0].name; d.style.borderColor = '#d7f452'; ctx.run(); }
          catch (e) { toast('人脸图读取失败'); }
        });
      }
    },
    onLoad: async function (S, ctx) {
      if (typeof window.FaceDetector === 'function') {
        try {
          const fd = new window.FaceDetector();
          const faces = await fd.detect(S.srcCanvas);
          if (faces && faces.length) {
            const b = faces[0].boundingBox;
            S.extra.detected = { x: (b.x + b.width / 2) / S.src.w, y: (b.y + b.height / 2) / S.src.h, s: Math.max(b.width, b.height) / Math.min(S.src.w, S.src.h) };
            ctx.note('FaceDetector 检测到 ' + faces.length + ' 张人脸，已自动定位。');
            return;
          }
        } catch (e) { }
      }
      const sm = skinMask(S.src), lab = labelComponents(sm, S.src.w, S.src.h);
      let best = -1, bi = -1;
      for (let i = 0; i < lab.count; i++) if (lab.sizes[i] > best) { best = lab.sizes[i]; bi = i; }
      if (bi >= 0 && best > S.src.w * S.src.h * 0.01) {
        let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
        for (let i = 0; i < S.src.w * S.src.h; i++) if (lab.labels[i] === bi) { const x = i % S.src.w, y = (i / S.src.w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        S.extra.detected = { x: (x0 + x1) / 2 / S.src.w, y: (y0 + y1) / 2 / S.src.h, s: Math.max(x1 - x0, y1 - y0) / Math.min(S.src.w, S.src.h) };
        ctx.note('未检测到 FaceDetector，改用肤色连通域近似定位（仅供参考，请用滑块手动校正）。');
      } else ctx.note('未能自动定位人脸，请用下方滑块手动指定人脸中心与大小。');
    },
    process: async function (src, o, prog, ctx, S) {
      const w = src.w, h = src.h;
      let cx = w * o.fx / 100, cy = h * o.fy / 100, rad = Math.min(w, h) * o.fs / 100;
      if (o.autoDetect && S.extra.detected) { cx = w * S.extra.detected.x; cy = h * S.extra.detected.y; rad = Math.min(w, h) * S.extra.detected.s * 0.62; }
      const out = P2canvas(src);
      if (!S.extra.face) { ctx.note('请先在右侧选择一张「来源人脸图」，再合成预览。'); return out; }
      const face = S.extra.face;
      const size = rad * 1.62;
      const tmp = canvasOf(Math.round(size), Math.round(size)), tc = ctxOf(tmp);
      const sc = Math.max(size / face.width, size / face.height);
      const dw = face.width * sc, dh = face.height * sc;
      tc.drawImage(face, (size - dw) / 2, (size - dh) / 2, dw, dh);
      if (o.warm) {
        const d = tc.getImageData(0, 0, tmp.width, tmp.height);
        const wm = o.warm / 100;
        for (let i = 0; i < d.data.length; i += 4) { d.data[i] = clamp255(d.data[i] * (1 + wm * 0.2)); d.data[i + 2] = clamp255(d.data[i + 2] * (1 - wm * 0.2)); }
        tc.putImageData(d, 0, 0);
      }
      tc.globalCompositeOperation = 'destination-in';
      const g = tc.createRadialGradient(tmp.width / 2, tmp.height / 2, 0, tmp.width / 2, tmp.height / 2, tmp.width / 2);
      const inner = clamp(1 - o.feather / 100, 0.05, 0.95);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(inner, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      tc.fillStyle = g; tc.fillRect(0, 0, tmp.width, tmp.height);
      tc.globalCompositeOperation = 'source-over';
      prog(70); await sleep();
      const oc = ctxOf(out);
      oc.globalAlpha = o.blend / 100;
      oc.drawImage(tmp, cx - size / 2, cy - size / 2, size, size);
      oc.globalAlpha = 1;
      prog(100);
      ctx.report(boundsBox('warn', '再次提醒：这是<b>椭圆羽化叠加预览</b>，不是人脸替换。请勿用于伪造他人身份或任何误导性用途。'));
      return out;
    }
  });
  /* ======================= 27. 语法检查（本地规则引擎） ======================= */
  const EN_DICT = (' the be to of and a in that have i it for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us is are was were been being has had did does doing said says going get got made make made take took taken see saw seen run ran running big small large little old young long short high low light dark fast slow open close start stop help need try keep let put set show tell ask call move turn play read write learn study make work live give find tell use try want need feel become leave start show hear listen speak talk walk watch follow create build change add remove update delete install download upload design test debug launch deploy review plan check report edit format parse render fetch save load send receive connect manage handle process analyze compare convert extract merge split filter sort group count sum average support access secure encrypt decrypt hash sign verify token session api sdk cli gui url uri http https html css json xml yaml sql gpu cpu ram disk file folder path name size text image video audio music photo camera phone computer laptop screen keyboard mouse button window page site web app mobile desktop server client cloud data user admin login logout password email address number value result error warning message string array object function method class module package import export return true false null none empty full half quarter minute hour day week month year today tomorrow yesterday morning evening night summer winter spring autumn color red green blue yellow white black gray grey orange purple pink brown gold silver').split(' ').filter(Boolean);
  const EN_SET = {}; EN_DICT.forEach(w => { EN_SET[w] = 1; });
  function editDist1(w, dict) {
    const first = w[0], out = [];
    for (let i = 0; i < dict.length; i++) {
      const d = dict[i];
      if (Math.abs(d.length - w.length) > 1) continue;
      if (d[0] !== first) continue;
      // 快速汉明/编辑距离判断
      let i2 = 0, j = 0, ops = 0;
      while (i2 < w.length && j < d.length && ops < 2) {
        if (w[i2] === d[j]) { i2++; j++; continue; }
        ops++;
        if (w.length > d.length) i2++;
        else if (w.length < d.length) j++;
        else { i2++; j++; }
      }
      if (ops + (w.length - i2) + (d.length - j) <= 1) out.push(d);
      if (out.length >= 3) break;
    }
    return out;
  }
  function checkEnglish(text, opt) {
    const issues = [];
    const add = (m, msg, sug, fixAll) => issues.push({ index: m.index, len: m[0].length, text: m[0], msg: msg, sug: sug, fix: fixAll });
    let m;
    const re = (r, g) => { const rr = new RegExp(r, g || 'g'); const out = []; let x; while ((x = rr.exec(text)) !== null) { out.push({ index: x.index, 0: x[0], groups: x }); if (rr.lastIndex === x.index) rr.lastIndex++; } return out; };
    re('\\b(\\w+)\\s+\\1\\b', 'gi').forEach(x => add(x, '重复词：“' + x.groups[1] + ' ' + x.groups[1] + '”', null, x.groups[1]));
    re('\\ba\\s+([aeiouAEIOU]\\w*)').forEach(x => add(x, '冠词误用：元音音素前应用 “an”', 'an ' + x.groups[1], 'an ' + x.groups[1]));
    re('\\ban\\s+([^aeiouAEIOU\\s\\d]\\w*)').forEach(x => add(x, '冠词误用：辅音音素前应用 “a”', 'a ' + x.groups[1], 'a ' + x.groups[1]));
    re('\\s+([,.!?;:])').forEach(x => add(x, '标点前多了空格', x.groups[1], x.groups[1]));
    re('\\s{2,}').forEach(x => { if (x[0].indexOf('\n') < 0) add(x, '多余的连续空格', ' ', ' '); });
    re('\\b(its)\\s+(a|an|the|not|been|going|very|own|time|way)\\b', 'gi').forEach(x => add(x, '“its” 与 “it is” 混淆，此处应为 it’s', 'it’s ' + x.groups[2], 'it’s ' + x.groups[2]));
    re('\\b(your)\\s+(a|an|the|not|very|going|welcome|right|wrong|awesome|great)\\b', 'gi').forEach(x => add(x, '“your” 与 “you are” 混淆，此处应为 you’re', 'you’re ' + x.groups[2], 'you’re ' + x.groups[2]));
    re('\\b(their)\\s+(is|are|was|were|will|has|have)\\b', 'gi').forEach(x => add(x, '“their” 与 “there” 混淆，此处应为 there', 'there ' + x.groups[2], 'there ' + x.groups[2]));
    re('\\b(recieve|seperate|definately|occured|thier|adress|accomodate|beleive|calender|neccessary|occassion|publically|recomend|succesful|untill|wich|writting|arguement|begining|commited|concious|enviroment|existance|foriegn|goverment|independant|maintainance|occurence|persistant|priviledge|questionaire|refered|relevent|resistence|sieze|supercede|tommorow|truely|wierd)\\b', 'gi').forEach(x => {
      const fixmap = { recieve: 'receive', seperate: 'separate', definately: 'definitely', occured: 'occurred', thier: 'their', adress: 'address', accomodate: 'accommodate', beleive: 'believe', calender: 'calendar', neccessary: 'necessary', occassion: 'occasion', publically: 'publicly', recomend: 'recommend', succesful: 'successful', untill: 'until', wich: 'which', writting: 'writing', arguement: 'argument', begining: 'beginning', commited: 'committed', concious: 'conscious', enviroment: 'environment', existance: 'existence', foriegn: 'foreign', goverment: 'government', independant: 'independent', maintainance: 'maintenance', occurence: 'occurrence', persistant: 'persistent', priviledge: 'privilege', questionaire: 'questionnaire', refered: 'referred', relevent: 'relevant', resistence: 'resistance', sieze: 'seize', supercede: 'supersede', tommorow: 'tomorrow', truely: 'truly', wierd: 'weird' };
      const w = x[0].toLowerCase(), s = fixmap[w] || w;
      add(x, '常见拼写错误：“' + x[0] + '” → “' + s + '”', s, s);
    });
    re('\\b(alot)\\b', 'gi').forEach(x => add(x, '“alot” 应为 “a lot”', 'a lot', 'a lot'));
    re("\\b(cant|dont|wont|isnt|arent|didnt|doesnt|couldnt|shouldnt|wouldnt|hasnt|havent|wasnt|werent)\\b", 'gi').forEach(x => {
      const map = { cant: "can't", dont: "don't", wont: "won't", isnt: "isn't", arent: "aren't", didnt: "didn't", doesnt: "doesn't", couldnt: "couldn't", shouldnt: "shouldn't", wouldnt: "wouldn't", hasnt: "hasn't", havent: "haven't", wasnt: "wasn't", werent: "weren't" };
      const w = x[0].toLowerCase();
      add(x, '缺少撇号：“' + x[0] + '” → “' + map[w] + '”', map[w], map[w]);
    });
    re('\\b(could|should|would|must|might)\\s+of\\b', 'gi').forEach(x => add(x, '“' + x.groups[1] + ' of” 应为 “' + x.groups[1] + ' have”', x.groups[1] + ' have', x.groups[1] + ' have'));
    re('\\b(in order to)\\b', 'gi').forEach(x => add(x, '冗词：“in order to” 可简化为 “to”', 'to', 'to'));
    re('\\b(due to the fact that)\\b', 'gi').forEach(x => add(x, '冗词：可改为 “because”', 'because', 'because'));
    re('\\b(at this point in time)\\b', 'gi').forEach(x => add(x, '冗词：可改为 “now”', 'now', 'now'));
    re('\\b(very unique|each and every|absolutely essential|basic fundamentals)\\b', 'gi').forEach(x => add(x, '冗词 / 语义重复', null, null));
    re('\\b(is|are|was|were|be|been|being)\\s+(\\w+ed|written|made|done|given|taken|seen|shown|known|held)\\s+by\\b', 'gi').forEach(x => add(x, '被动语态，可考虑改为主动式使句子更有力', null, null));
    re('([,.!?;:]{2,})').forEach(x => { if (!/^\.\.\.$/.test(x[0])) add(x, '重复标点', x[0][0], x[0][0]); });
    re('([.!?])([A-Za-z])').forEach(x => add(x, '标点后缺空格', x.groups[1] + ' ' + x.groups[2], x.groups[1] + ' ' + x.groups[2]));
    re('(^|[.!?]\\s+)([a-z])').forEach(x => add({ index: x.index + x[0].length - 1, 0: x.groups[2] }, '句首字母应大写', x.groups[2].toUpperCase(), x.groups[2].toUpperCase()));
    if (!/[.!?"'”’)]\s*$/.test(text.trim()) && text.trim().length > 12) issues.push({ index: text.trim().length, len: 0, text: '', msg: '句末缺少标点符号（. ! ?）', sug: '.', fix: null, noPos: true });
    if (opt && opt.spelling) {
      const words = re('[A-Za-z]{4,}', 'g');
      words.forEach(x => {
        const w = x[0];
        if (w[0] === w[0].toUpperCase()) return;
        if (EN_SET[w] || EN_SET[w.toLowerCase()]) return;
        const sug = editDist1(w.toLowerCase(), EN_DICT);
        if (sug.length) add(x, '拼写可疑（内置词表 + 编辑距离建议，可能误报）', sug[0], sug[0]);
      });
    }
    return issues;
  }
  function checkChinese(text) {
    const issues = [];
    const add = (index, len, txt, msg, sug, fix) => issues.push({ index: index, len: len, text: txt, msg: msg, sug: sug, fix: fix });
    const han = /[\u4e00-\u9fa5]/;
    let m;
    const re = (r) => { const rr = new RegExp(r, 'g'); const out = []; let x; while ((x = rr.exec(text)) !== null) { out.push({ index: x.index, 0: x[0], groups: x }); if (rr.lastIndex === x.index) rr.lastIndex++; } return out; };
    re('([\\u4e00-\\u9fa5])\\s+(?=[\\u4e00-\\u9fa5])').forEach(x => add(x.index, x[0].length, x[0], '中文之间出现了空格', x.groups[1], x.groups[1]));
    re('([\\u4e00-\\u9fa5])([,;:!?])').forEach(x => {
      const map = { ',': '，', ';': '；', ':': '：', '!': '！', '?': '？' };
      add(x.index + 1, 1, x.groups[2], '中文语境下应使用全角标点', map[x.groups[2]], map[x.groups[2]]);
    });
    re('([,;:!?])([\\u4e00-\\u9fa5])').forEach(x => {
      const map = { ',': '，', ';': '；', ':': '：', '!': '！', '?': '？' };
      add(x.index, 1, x.groups[1], '中文语境下应使用全角标点', map[x.groups[1]], map[x.groups[1]]);
    });
    re('([\\u4e00-\\u9fa5])(\\.)(?![0-9])').forEach(x => add(x.index + 1, 1, '.', '中文句号应使用「。」', '。', '。'));
    re('([，。！？；：、]{2,})').forEach(x => add(x.index, x[0].length, x[0], '重复标点', x[0][0], x[0][0]));
    const typos = [['登陆', '登录'], ['帐号', '账号'], ['再接再励', '再接再厉'], ['一如继往', '一如既往'], ['按耐不住', '按捺不住'], ['金壁辉煌', '金碧辉煌'], ['不径而走', '不胫而走'], ['重蹈复辙', '重蹈覆辙'], ['唇枪舌箭', '唇枪舌剑'], ['欢渡', '欢度'], ['默守成规', '墨守成规'], ['兴高彩烈', '兴高采烈'], ['相形见拙', '相形见绌'], ['走头无路', '走投无路'], ['前扑后继', '前仆后继'], ['坐阵', '坐镇'], ['即使如此', '即便如此']];
    typos.forEach(p => {
      let idx = text.indexOf(p[0]);
      while (idx >= 0) { add(idx, p[0].length, p[0], '常见错别字：「' + p[0] + '」→「' + p[1] + '」', p[1], p[1]); idx = text.indexOf(p[0], idx + p[0].length); }
    });
    re('(\\u3000)').forEach(x => add(x.index, 1, '　', '全角空格', ' ', ' '));
    re('([\\d])([\\u4e00-\\u9fa5])').forEach(x => { if (!/个|次|年|月|日|岁|米|克|期|点|线|号|页|人|元|分|秒|时/.test(x.groups[2])) add(x.index + 1, 0, '', '数字与中文之间建议保持不加空格，或统一规范（本项仅提示）', null, null); });
    re('([\\u4e00-\\u9fa5])([!?])(?=[\\u4e00-\\u9fa5])').forEach(x => { });
    return issues;
  }
  function applyFixes(text, issues) {
    const fixable = issues.filter(i => i.fix != null && i.len >= 0 && !i.noPos).sort((a, b) => a.index - b.index);
    let out = '', cur = 0;
    fixable.forEach(i => { if (i.index < cur) return; out += text.slice(cur, i.index) + i.fix; cur = i.index + i.len; });
    out += text.slice(cur);
    return out;
  }
  MOUNTS['grammar-checker'] = function (host, cfg) {
    const shell = window.TUI.shell(host, true);
    const stage = shell.stage, pane = shell.pane;
    stage.innerHTML =
      '<div class="io">' +
      '<div class="col"><div class="colhead"><span class="t">原文</span><span class="mini" id="gSample">载入示例</span></div>' +
      '<textarea id="gIn" placeholder="把英文或中文文本粘贴到这里…"></textarea></div>' +
      '<div class="col"><div class="colhead"><span class="t">检查结果</span><span class="mini" id="gCopy">复制结果</span></div>' +
      '<div class="ioout" id="gOut">点击右侧「开始检查」。</div></div>' +
      '</div>' +
      '<div id="gIssues" style="margin-top:16px"></div>';
    pane.innerHTML = '<div class="ptitle">语言与选项</div>' +
      '<div class="pdesc">选择语言后点击检查。规则引擎完全本地运行。</div>' +
      selk('gLang', '语言', [['auto', '自动判断'], ['en', '英文'], ['zh', '中文']], 'auto') +
      chkk('gSpelling', '启用拼写检查（内置词表 + 编辑距离，可能误报）', false) +
      chkk('gStyle', '包含风格建议（被动语态、冗词）', true) +
      boundsBox('warn', '能力边界：这是<b>本地规则引擎</b>（正则 + 常用词表 + 编辑距离），<b>不是语言模型</b>。它能抓常见拼写/标点/冠词/重复词/冗词等问题，但<b>不会理解语义</b>，无法判断从句结构、时态一致性、逻辑连贯性，也会有误报与漏报。' +
        '把结果当作“拼写与格式的第一遍草稿检查”即可，正式文稿请人工复核。') +
      '<button class="btn-lime btn-run" id="gRun">开始检查</button>' +
      '<button class="btn-ghost btn-run" id="gApply">一键应用全部建议</button>' +
      '<button class="btn-ghost btn-run" id="gDown">下载检查结果 (.txt)</button>' +
      '<div class="outbox" id="gStat">尚未检查。</div>' +
      '<div class="runnote">文本不会上传，全部在本机处理。</div>';

    function run() {
      const txt = $('#gIn', host).value || '';
      let lang = $('#gLang', host).value;
      if (!txt.trim()) { toast('请先输入文本'); return; }
      if (lang === 'auto') {
        let han = 0, lat = 0;
        for (let i = 0; i < txt.length; i++) { if (/[\u4e00-\u9fa5]/.test(txt[i])) han++; else if (/[A-Za-z]/.test(txt[i])) lat++; }
        lang = han > lat ? 'zh' : 'en';
      }
      const opts = { spelling: $('#gSpelling', host).classList.contains('on'), style: $('#gStyle', host).classList.contains('on') };
      let issues = (lang === 'zh' ? checkChinese(txt) : checkEnglish(txt, opts));
      if (lang === 'en' && !opts.style) issues = issues.filter(i => i.msg.indexOf('被动语态') < 0 && i.msg.indexOf('冗词') < 0);
      issues.sort((a, b) => a.index - b.index);
      S.issues = issues; S.text = txt;
      const outEl = $('#gOut', host);
      if (!issues.length) outEl.textContent = '没有发现问题。\n\n注意：这不代表文本完全正确——本地规则引擎无法覆盖复杂的语法与语义问题。';
      else outEl.innerHTML = issues.map((i, k) => (k + 1) + '. [' + (i.index + 1) + '] ' + window.TUI.esc(i.msg) + (i.sug ? '\n   → 建议：' + window.TUI.esc(i.sug) : '')).join('\n');
      const fixable = issues.filter(i => i.fix != null).length;
      $('#gStat', host).innerHTML = '语言：<b>' + (lang === 'zh' ? '中文' : '英文') + '</b> · 问题 <b>' + issues.length + '</b> 条（其中 <b>' + fixable + '</b> 条可一键修正）';
      const box = $('#gIssues', host);
      box.innerHTML = issues.length ? '<div class="ptitle" style="font-size:15px">逐条建议</div>' + issues.map((i, k) =>
        '<div class="resultbox" style="margin-top:8px"><div class="row"><span>#' + (k + 1) + ' · ' + window.TUI.esc(i.msg) + '</span><b>' + (i.sug ? window.TUI.esc(i.sug) : '—') + '</b></div>' +
        (i.fix != null ? '<div class="shapes" style="margin-top:8px"><button type="button" class="shape" data-fix="' + k + '">应用这一条</button></div>' : '') + '</div>').join('') : '';
    }
    const S = { issues: [], text: '' };
    host.addEventListener('click', e => {
      if (e.target.closest('#gRun')) { run(); return; }
      if (e.target.closest('#gApply')) {
        if (!S.issues.length) { toast('请先检查'); return; }
        const n = S.issues.filter(i => i.fix != null).length;
        $('#gIn', host).value = applyFixes(S.text, S.issues);
        toast('已应用 ' + n + ' 条建议');
        run();
        return;
      }
      if (e.target.closest('#gDown')) {
        const txt = $('#gOut', host).textContent;
        window.downloadBlob(new Blob([txt], { type: 'text/plain;charset=utf-8' }), 'grammar-report.txt');
        return;
      }
      if (e.target.closest('#gCopy')) { window.copyText($('#gOut', host).textContent); return; }
      if (e.target.closest('#gSample')) {
        $('#gIn', host).value = 'i think this is a apple. Their is a problem with you\'re code ,and it dont work. I recieve the file but in order to open it i need the password.  \n它的登陆界面很好用，，但是帐号的验证码经常不显示。';
        run(); return;
      }
      const fx = e.target.closest('[data-fix]');
      if (fx) {
        const i = S.issues[parseInt(fx.getAttribute('data-fix'), 10)];
        if (i && i.fix != null) {
          const t = $('#gIn', host).value;
          $('#gIn', host).value = t.slice(0, i.index) + i.fix + t.slice(i.index + i.len);
          run();
        }
        return;
      }
    });
  };

  /* ======================= 28. 语音转字幕 / 字幕生成 ======================= */
  function ts(t, comma) {
    t = Math.max(0, t);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60), ms = Math.round((t - Math.floor(t)) * 1000);
    const p = (v, n) => String(v).padStart(n, '0');
    return p(h, 2) + ':' + p(m, 2) + ':' + p(s, 2) + (comma ? ',' : '.') + p(ms, 3);
  }
  function toSubs(segs, vtt) {
    const head = vtt ? 'WEBVTT\n\n' : '';
    return head + segs.map((s, i) => (i + 1) + '\n' + ts(s.start, !vtt) + ' --> ' + ts(s.end, !vtt) + '\n' + s.text + '\n').join('\n');
  }
  function textToSegs(text, cps, maxChars, gap) {
    const parts = text.replace(/\r/g, '').split(/(?<=[。！？!?\.\;\n])/).map(s => s.trim()).filter(Boolean);
    const chunks = [];
    const limit = Math.max(6, maxChars || 18);
    parts.forEach(p => {
      let i = 0;
      while (i < p.length) {
        let n = Math.min(limit, p.length - i);
        // 尽量在标点或空格处断
        const seg = p.substr(i, n);
        if (i + n < p.length) {
          const m = seg.match(/^[\s\S]*[，,、；;：: ]/);
          if (m && m[0].length > limit * 0.5) n = m[0].length;
        }
        chunks.push(p.substr(i, n).trim());
        i += n;
      }
    });
    const rate = Math.max(1, cps || 5);
    let t = 0;
    return chunks.filter(Boolean).map(c => {
      const d = Math.max(0.8, c.length / rate);
      const s = { start: t, end: t + d, text: c };
      t += d + (gap == null ? 0.06 : gap);
      return s;
    });
  }
  function speechMount(slug, title, defaultMode) {
    return function (host, cfg) {
      const shell = window.TUI.shell(host, true);
      const stage = shell.stage, pane = shell.pane;
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      const S = { rec: null, listening: false, segs: [], t0: 0, lastEnd: 0, interim: '' };
      stage.innerHTML =
        '<div class="seg" style="max-width:420px"><button type="button" id="mSpeech" class="' + (defaultMode === 'speech' ? 'on' : '') + '">麦克风实时转写</button><button type="button" id="mText" class="' + (defaultMode === 'text' ? 'on' : '') + '">文本 → 字幕</button></div>' +
        '<div id="sBody" style="flex:1;display:flex;flex-direction:column"></div>';
      pane.innerHTML = '<div class="ptitle">' + esc(title) + '</div>' +
        '<div class="pdesc">麦克风实时转写（Web Speech API）或把已有文本自动切成带时间轴的字幕。</div>' +
        selk('sLang', '语言', [['zh-CN', '中文（普通话）'], ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['ja-JP', '日本語'], ['ko-KR', '한국어'], ['es-ES', 'Español'], ['fr-FR', 'Français'], ['de-DE', 'Deutsch']], 'zh-CN') +
        selk('sCps', '阅读速度（字/秒）', [['3', '3（慢）'], ['4', '4'], ['5', '5（推荐）'], ['6', '6'], ['8', '8（快）']], '5') +
        sld('sMaxChars', '每行最大字数', 8, 42, 18, 1) +
        sld('sGap', '字幕间隔（秒）', 0, 0.5, 0.06, 0.01) +
        boundsBox('warn', SR
          ? '能力边界：Web Speech API 的语音识别<b>由浏览器与系统提供的语音服务完成</b>（Chrome 通常把音频发到服务端），<b>不是本站的本地模型</b>，也<b>不是 Whisper</b>。它能给出最终文本，但<b>不提供字级时间戳</b>——本页的时间轴是按「每段识别结果的到达时间」估算的，会有偏差，可手动微调。' +
          '首次使用需要授予麦克风权限。若需要离线或高精度转写，请自建 Whisper 服务并把音频交给它。'
          : '⚠️ 当前浏览器<b>不支持 Web Speech API</b>（SpeechRecognition）。麦克风转写不可用。你仍然可以使用本页的「文本 → 字幕」模式：把音频的转写文本粘贴进来，自动生成带时间轴的 SRT / VTT。要离线自动转写，请自建 Whisper 服务。') +
        '<button class="btn-lime btn-run" id="sStart">开始</button>' +
        '<button class="btn-ghost btn-run" id="sStop">停止</button>' +
        '<button class="btn-ghost btn-run" id="sClear">清空</button>' +
        '<div class="shapes" style="margin-top:12px"><button type="button" class="btn-ghost btn-sm" id="sSrt">下载 .srt</button><button type="button" class="btn-ghost btn-sm" id="sVtt">下载 .vtt</button><button type="button" class="btn-ghost btn-sm" id="sTxt">下载 .txt</button></div>' +
        '<div class="progress" id="aiProg"><i></i></div>' +
        '<div class="outbox" id="aiOut">输出：—</div>' +
        '<div class="runnote">音频不上传本站；麦克风音频由浏览器自身的语音服务处理。</div>';

      function renderSpeech() {
        $('#sBody', host).innerHTML =
          '<div class="canvaswrap" style="flex-direction:column;align-items:stretch;gap:12px;padding:16px">' +
          '<div class="outbox" id="sLive" style="min-height:60px">点击「开始」后，这里显示实时转写…</div>' +
          '<div class="ioout" id="sSegs" style="min-height:180px;max-height:320px">转写结果会按段落带时间轴出现在这里。</div></div>';
        upd();
      }
      function renderText() {
        $('#sBody', host).innerHTML =
          '<div class="io">' +
          '<div class="col"><div class="colhead"><span class="t">原始文本</span><span class="mini" id="tSample">载入示例</span></div>' +
          '<textarea id="tIn" placeholder="把音频的转写文本粘贴到这里，每行或每句会自动切成一条字幕。"></textarea></div>' +
          '<div class="col"><div class="colhead"><span class="t">生成的字幕（SRT 预览）</span></div><div class="ioout" id="tOut"></div></div>' +
          '</div>' +
          '<div class="shapes" style="margin-top:12px"><button type="button" class="btn-ghost btn-sm" id="tGo">生成字幕</button></div>';
      }
      function upd() {
        const box = $('#sSegs', host); if (!box) return;
        box.textContent = S.segs.length ? S.segs.map((s, i) => (i + 1) + '\n' + ts(s.start, true) + ' --> ' + ts(s.end, true) + '\n' + s.text).join('\n\n') : '（暂无）';
      }
      function startRec() {
        if (!SR) { toast('当前浏览器不支持 Web Speech API'); return; }
        if (S.listening) return;
        try {
          const rec = new SR();
          S.rec = rec;
          rec.lang = $('#sLang', host).value;
          rec.continuous = true;
          rec.interimResults = true;
          S.t0 = performance.now(); S.lastEnd = 0;
          rec.onresult = ev => {
            let interim = '';
            for (let i = ev.resultIndex; i < ev.results.length; i++) {
              const r = ev.results[i];
              if (r.isFinal) {
                const now = (performance.now() - S.t0) / 1000;
                const text = (r[0] && r[0].transcript || '').trim();
                if (text) { S.segs.push({ start: S.lastEnd, end: now, text: text }); S.lastEnd = now; }
              } else interim += (r[0] && r[0].transcript) || '';
            }
            S.interim = interim;
            const live = $('#sLive', host);
            if (live) live.textContent = interim || (S.segs.length ? S.segs[S.segs.length - 1].text : '正在聆听…');
            upd();
            $('#aiOut', host).innerHTML = '已转写 <b>' + S.segs.length + '</b> 段 · 时长 ' + ((performance.now() - S.t0) / 1000).toFixed(1) + 's';
          };
          rec.onerror = e => {
            S.listening = false;
            const map = { 'not-allowed': '麦克风权限被拒绝', 'service-not-allowed': '浏览器语音服务不可用', 'no-speech': '没有检测到语音', 'network': '语音服务网络错误', 'audio-capture': '找不到麦克风设备' };
            $('#aiOut', host).innerHTML = '识别中断：<b>' + esc(map[e.error] || e.error || '未知错误') + '</b>。可改用「文本 → 字幕」模式，或检查麦克风权限后重试。';
            toast('语音识别中断：' + (map[e.error] || e.error));
          };
          rec.onend = () => { if (S.listening) { try { rec.start(); } catch (e) { S.listening = false; } } };
          rec.start();
          S.listening = true;
          $('#aiOut', host).innerHTML = '正在聆听…请对着麦克风说话。';
        } catch (e) { toast('无法启动识别：' + (e && e.message || e)); S.listening = false; }
      }
      function stopRec() {
        S.listening = false;
        if (S.rec) { try { S.rec.stop(); } catch (e) { } }
        $('#aiOut', host).innerHTML = '已停止。共 <b>' + S.segs.length + '</b> 段。';
      }
      $('#sStart', host).addEventListener('click', startRec);
      $('#sStop', host).addEventListener('click', stopRec);
      $('#sClear', host).addEventListener('click', () => { S.segs = []; S.lastEnd = 0; upd(); $('#aiOut', host).innerHTML = '输出：—'; });
      host.addEventListener('click', e => {
        if (e.target.closest('#mSpeech')) { $('#mSpeech', host).classList.add('on'); $('#mText', host).classList.remove('on'); renderSpeech(); }
        if (e.target.closest('#mText')) { $('#mText', host).classList.add('on'); $('#mSpeech', host).classList.remove('on'); renderText(); }
        if (e.target.closest('#sSrt')) { if (!S.segs.length) { toast('还没有转写结果'); return; } window.downloadBlob(new Blob([toSubs(S.segs, false)], { type: 'text/plain;charset=utf-8' }), 'speech.srt'); }
        if (e.target.closest('#sVtt')) { if (!S.segs.length) { toast('还没有转写结果'); return; } window.downloadBlob(new Blob([toSubs(S.segs, true)], { type: 'text/vtt;charset=utf-8' }), 'speech.vtt'); }
        if (e.target.closest('#sTxt')) { if (!S.segs.length) { toast('还没有转写结果'); return; } window.downloadBlob(new Blob([S.segs.map(s => s.text).join('\n')], { type: 'text/plain;charset=utf-8' }), 'transcript.txt'); }
        if (e.target.closest('#tSample')) {
          $('#tIn', host).value = '欢迎使用本地字幕工具。\n这是一个完全在浏览器里运行的演示。\n你可以把任意文本粘贴进来，它会按标点和长度自动切分成字幕。\n时间轴按你设置的阅读速度估算，可以逐句微调。';
          doText();
        }
        if (e.target.closest('#tGo')) doText();
      });
      function doText() {
        const ta = $('#tIn', host); if (!ta) return;
        const text = ta.value;
        if (!text.trim()) { toast('请先输入文本'); return; }
        const segs = textToSegs(text, parseFloat($('#sCps', host).value) || 5, parseFloat($('#sMaxChars', host).value) || 18, parseFloat($('#sGap', host).value) || 0.06);
        S.segs = segs;
        const out = $('#tOut', host); if (out) out.textContent = toSubs(segs, false);
        $('#aiOut', host).innerHTML = '已生成 <b>' + segs.length + '</b> 条字幕，总时长约 <b>' + (segs.length ? segs[segs.length - 1].end.toFixed(1) : 0) + 's</b>（按阅读速度估算，请按实际音频微调）。';
      }
      if (defaultMode === 'text') renderText(); else renderSpeech();
      if (!SR && defaultMode === 'speech') { $('#sBody', host).insertAdjacentHTML('afterbegin', boundsBox('warn', '当前浏览器不支持 Web Speech API，麦克风转写不可用。请使用「文本 → 字幕」模式，或换用 Chrome 桌面版。')); }
    };
  }
  MOUNTS['speech-to-text'] = speechMount('speech-to-text', '语音转文字 / 字幕', 'speech');
  MOUNTS['subtitle-generator'] = speechMount('subtitle-generator', '字幕生成器', 'text');

  /* ======================= 29. 文字转语音 ======================= */
  MOUNTS['text-to-speech'] = function (host, cfg) {
    const shell = window.TUI.shell(host, true);
    const stage = shell.stage, pane = shell.pane;
    const S = { voices: [], rec: null, chunks: [], recStream: null };
    stage.innerHTML =
      '<div class="io"><div class="col"><div class="colhead"><span class="t">要朗读的文本</span><span class="mini" id="ttsSample">载入示例</span></div>' +
      '<textarea id="ttsText" style="min-height:280px" placeholder="输入要朗读的文本，空行会作为段落停顿。"></textarea></div>' +
      '<div class="col"><div class="colhead"><span class="t">实时状态</span></div><div class="ioout" id="ttsOut" style="min-height:280px">尚未播放。\n\n提示：播放使用系统语音合成，声音来自你的操作系统，不联网、不上传。</div></div></div>';
    pane.innerHTML = '<div class="ptitle">语音设置</div>' +
      '<div class="pdesc">使用浏览器 speechSynthesis 调用系统内置语音。</div>' +
      selk('ttsVoice', '音色（来自你的系统）', [['', '（点击下方刷新）']], '') +
      sld('ttsRate', '语速', 0.5, 2, 1, 0.05) +
      sld('ttsPitch', '音调', 0, 2, 1, 0.05) +
      sld('ttsVolume', '音量', 0, 1, 1, 0.05) +
      sld('ttsPause', '段落间隔（毫秒）', 0, 1200, 260, 20) +
      boundsBox('warn', '能力边界：speechSynthesis 是<b>系统级 TTS</b>（由操作系统/浏览器提供声音），音色取决于你的设备，且<b>浏览器不提供语音合成的音频流</b>，因此<b>无法直接导出为 mp3/wav</b>——这不是本工具偷懒，而是 Web 平台没有这个 API。<br>' +
        '本页给出两个真实可用的替代动作：① <b>播放</b>朗读文本；② <b>用麦克风录制你的朗读</b>（MediaRecorder，真实录音，可下载 webm）。若要“机器音直接导出音频文件”，请使用系统自带的“文字转语音”功能或服务端 TTS。') +
      '<button class="btn-lime btn-run" id="ttsPlay">播放</button>' +
      '<div class="shapes"><button type="button" class="shape" id="ttsPause">暂停</button><button type="button" class="shape" id="ttsResume">继续</button><button type="button" class="shape" id="ttsStop">停止</button></div>' +
      '<div class="plabel">导出替代方案</div>' +
      '<div class="shapes"><button type="button" class="shape" id="ttsRec">开始录制我的朗读</button><button type="button" class="shape" id="ttsRecStop">停止录制</button></div>' +
      '<button class="btn-ghost btn-run" id="ttsTxt">下载文本 (.txt)</button>' +
      '<button class="btn-ghost btn-run" id="ttsRefresh">刷新音色列表</button>' +
      '<div class="outbox" id="ttsInfo">音色：加载中…</div>' +
      '<div class="runnote">注意：部分系统需先有用户交互才允许发声，这是浏览器的自动播放策略。</div>';

    function fillVoices() {
      const list = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
      S.voices = list;
      const sel = $('#ttsVoice', host);
      if (!sel) return;
      const cur = sel.value;
      sel.innerHTML = list.length ? list.map((v, i) => '<option value="' + i + '">' + esc(v.name + ' · ' + v.lang + (v.default ? ' · 默认' : '')) + '</option>').join('')
        : '<option value="">（系统没有报告可用音色）</option>';
      if (cur && list[+cur]) sel.value = cur;
      const zh = list.filter(v => /^zh/i.test(v.lang)).length;
      $('#ttsInfo', host).innerHTML = '共 <b>' + list.length + '</b> 个音色（中文 ' + zh + ' 个）。音色由你的操作系统提供，不同设备差别很大。';
    }
    fillVoices();
    if (window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = fillVoices;
      setTimeout(fillVoices, 400);
    }
    $('#ttsRefresh', host).addEventListener('click', fillVoices);
    $('#ttsSample', host).addEventListener('click', () => {
      $('#ttsText', host).value = '你好，这是一个完全在浏览器本地运行的工具站。\n所有处理都在你的设备上完成，文件不会被上传。\n\n这是第二段，用来演示段落之间的停顿。';
    });
    $('#ttsPlay', host).addEventListener('click', () => {
      const SS = window.speechSynthesis;
      if (!SS) { $('#ttsOut', host).textContent = '当前浏览器不支持 speechSynthesis，无法朗读。'; return; }
      const text = $('#ttsText', host).value;
      if (!text.trim()) { toast('请输入要朗读的文本'); return; }
      SS.cancel();
      const chunks = text.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
      const gap = parseFloat($('#ttsPause', host).value) || 0;
      const voice = S.voices[parseInt($('#ttsVoice', host).value, 10) || 0];
      const rate = parseFloat($('#ttsRate', host).value), pitch = parseFloat($('#ttsPitch', host).value), vol = parseFloat($('#ttsVolume', host).value);
      S.chunks = chunks;
      let i = 0;
      const out = $('#ttsOut', host);
      const next = () => {
        if (i >= chunks.length) { out.textContent = '朗读完成。\n\n如需音频文件，请使用「开始录制我的朗读」，或用系统自带文字转语音导出。'; return; }
        const u = new SpeechSynthesisUtterance(chunks[i]);
        if (voice) u.voice = voice;
        if (voice) u.lang = voice.lang;
        u.rate = rate; u.pitch = pitch; u.volume = vol;
        u.onend = () => { out.textContent = '正在朗读第 ' + (i + 1) + ' / ' + chunks.length + ' 段…'; i++; setTimeout(next, gap); };
        u.onerror = e => { out.textContent = '朗读出错：' + (e && e.error || '未知错误') + '。可能是系统缺少该语言的语音包。'; };
        SS.speak(u);
        out.textContent = '正在朗读第 ' + (i + 1) + ' / ' + chunks.length + ' 段…';
      };
      next();
    });
    $('#ttsPause', host).addEventListener('click', () => { if (window.speechSynthesis) window.speechSynthesis.pause(); });
    $('#ttsResume', host).addEventListener('click', () => { if (window.speechSynthesis) window.speechSynthesis.resume(); });
    $('#ttsStop', host).addEventListener('click', () => { if (window.speechSynthesis) window.speechSynthesis.cancel(); $('#ttsOut', host).textContent = '已停止。'; });
    $('#ttsTxt', host).addEventListener('click', () => {
      const t = $('#ttsText', host).value || '';
      window.downloadBlob(new Blob([t], { type: 'text/plain;charset=utf-8' }), 'speech-text.txt');
    });
    $('#ttsRec', host).addEventListener('click', async () => {
      if (!navigator.mediaDevices || !window.MediaRecorder) { $('#ttsOut', host).textContent = '当前浏览器不支持麦克风录制。'; return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        S.recStream = stream;
        const chunks = [];
        const rec = new MediaRecorder(stream);
        S.rec = rec;
        rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onstop = () => {
          const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
          window.downloadBlob(blob, 'my-recording.webm');
          $('#ttsOut', host).textContent = '录音完成，已下载（' + window.fmtSize(blob.size) + '）。\n这是你自己的朗读，不是机器音——这是浏览器允许的真实替代方案。';
          try { stream.getTracks().forEach(t => t.stop()); } catch (e) { }
        };
        rec.start();
        $('#ttsOut', host).textContent = '正在录制…请朗读左侧文本。完成后点「停止录制」。';
      } catch (e) {
        $('#ttsOut', host).textContent = '无法访问麦克风：' + ((e && e.message) || e) + '（请检查权限设置，或改用系统文字转语音功能导出音频）。';
      }
    });
    $('#ttsRecStop', host).addEventListener('click', () => { if (S.rec && S.rec.state !== 'inactive') S.rec.stop(); });
    S.mountCleanup = () => { if (window.speechSynthesis) window.speechSynthesis.cancel(); if (S.recStream) { try { S.recStream.getTracks().forEach(t => t.stop()); } catch (e) { } } };
  };
  /* ======================= 30. 音视频（ffmpeg.wasm）工具定义 ======================= */
  const AV = {};
  function defAV(slug, spec) { AV[slug] = spec; }
  function atempoChain(sp) {
    const parts = []; let s = sp;
    while (s < 0.5) { parts.push('atempo=0.5'); s /= 0.5; }
    while (s > 2) { parts.push('atempo=2'); s /= 2; }
    parts.push('atempo=' + s.toFixed(4));
    return parts.join(',');
  }
  function pitchFilter(p, sr) {
    const R = sr || 44100;
    return 'aresample=' + R + ',asetrate=' + Math.round(R * p) + ',aresample=' + R + ',' + atempoChain(1 / p);
  }
  const VIDEO_BOUNDS = '能力边界：转码由 <b>ffmpeg.wasm 在本机运行</b>，不上传文件；因此速度取决于你的设备与视频长度，4K 或长视频可能很慢甚至因内存不足而失败（可用「压缩」工具先减小尺寸）。';
  const VC_BOUNDS = '能力边界：这里的“抠视频背景”是 <b>颜色键控（colorkey / chromakey）</b>，<b>不是 AI 视频分割</b>。' +
    '它把画面中与指定颜色相近的像素变透明，<b>纯色背景（绿幕、蓝幕、白墙、纯色布）效果很好</b>；背景有渐变、纹理、阴影，或前景与背景颜色相近时会出现残留与破洞。想要“不用绿幕也能抠人”，那需要 AI 视频分割模型，本页做不到。';
  const VOC_BOUNDS = '能力边界：这是<b>相位相消 / 中置提取</b>，<b>不是 MDX / Demucs 这类神经网络的音源分离</b>。' +
    '原理：立体声混音里人声通常位于中央（左右声道相位与幅度接近），把左右声道相减就能抵消中置成分，从而得到伴奏；把左右相加则突出中置（近似人声）。' +
    '<b>因此它只对真正的立体声混音有效</b>：单声道文件、人声被处理过（混响/延迟/宽声场）、或人声不在正中时，效果会明显变差——这是原理限制，不是参数没调好。想要接近录音室级别的分离，请使用 Demucs / MDX 等模型。';

  function slowMotionSpec(slug, title) {
    defAV(slug, {
      title: title, kind: 'video', accept: 'video/*', ext: '.mp4', outMime: 'video/mp4',
      dropTitle: '选择一段视频', runLabel: '生成慢动作',
      desc: '用 <b>minterpolate 光流插帧</b>真正补出中间帧再放慢，而不是简单拉长时间造成卡顿。',
      boundsTone: 'warn',
      bounds: '这是<b>真正的光流插帧慢动作</b>（minterpolate，mi_mode=mci + aobmc 遮挡感知运动补偿）：先生成合成的中间帧，再把时间轴拉长，所以动作是连贯的，不是简单复制帧造成的卡顿。' +
        '它仍是运动估计——大面积遮挡、快速旋转、透明物体、闪烁光线下可能出现“鬼影”与撕裂。0.25× 且 60fps 输出时计算量约为原片的 8 倍，请预期较长的处理时间。<br>' + VIDEO_BOUNDS,
      pane: function () {
        return selk('speed', '放慢倍数', [['0.5', '0.5× （2 倍时长）'], ['0.25', '0.25× （4 倍时长）'], ['0.75', '0.75×']], '0.5') +
          selk('outFps', '输出帧率', [['60', '60 fps'], ['30', '30 fps'], ['120', '120 fps（更平滑，更慢）']], '60') +
          selk('interpFps', '插帧中间帧率', [['auto', '自动（输出帧率 ÷ 速度倍数）'], ['120', '120 fps'], ['240', '240 fps']], 'auto') +
          chkk('keepAudio', '保留音频（同步放慢）', true) +
          sld('crf', '画质（数值越小越好）', 14, 30, 19, 1);
      },
      outName: function (o, S) { return fmtName(S.name, '-slowmo', 'mp4'); },
      buildArgs: function (o, S, inName, outName) {
        const f = parseFloat(o.speed) || 0.5;
        const outFps = parseInt(o.outFps, 10) || 60;
        let interp = o.interpFps === 'auto' ? Math.round(outFps / f) : parseInt(o.interpFps, 10);
        interp = clamp(interp, outFps, 240);
        const vf = 'minterpolate=fps=' + interp + ':mi_mode=mci:mc_mode=aobmc:vsbmc=1,setpts=' + (1 / f).toFixed(3) + '*PTS';
        const a = [];
        a.push('-i', inName, '-vf', vf, '-r', String(outFps));
        if (o.keepAudio) a.push('-af', atempoChain(f), '-c:a', 'aac', '-b:a', '160k');
        else a.push('-an');
        a.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(o.crf | 0), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', outName);
        return a;
      }
    });
  }
  slowMotionSpec('ai-slow-motion', 'AI 慢动作（光流插帧）');
  slowMotionSpec('ai-slow-motion-video', '视频慢动作（光流插帧）');

  function fpsSpec(slug, title, isFrame) {
    defAV(slug, {
      title: title, kind: 'video', accept: 'video/*', ext: '.mp4', outMime: 'video/mp4',
      dropTitle: '选择一段视频', runLabel: '补帧并导出',
      desc: isFrame ? '在任意帧率之间做运动插值（mci / blend / dup 三种模式可切换）。' : '用 minterpolate 把视频补到 60 / 120 fps，动作更顺滑。',
      boundsTone: 'warn',
      bounds: '这是<b>真实的运动补偿插帧</b>（minterpolate）：<b>mci</b> 用光流估计生成中间帧（最平滑，最慢，可能有鬼影）；<b>blend</b> 混合前后帧（快，但快速运动会重影）；<b>dup</b> 复制帧（最快，只是把时间分辨率填满，视觉上并不更平滑）。它不会“无中生有”地生成新细节，也无法修好本身模糊或剧烈抖动的画面。<br>' + VIDEO_BOUNDS,
      pane: function () {
        return selk('fps', '目标帧率', [['60', '60 fps'], ['120', '120 fps'], ['30', '30 fps']], '60') +
          selk('mi', '插帧模式', [['mci', 'mci · 运动补偿（最好）'], ['blend', 'blend · 混合（快）'], ['dup', 'dup · 复制帧（最快）']], 'mci') +
          chkk('aobmc', '启用遮挡感知运动补偿（仅 mci）', true) +
          sld('crf', '画质（数值越小越好）', 14, 30, 19, 1) +
          '<div class="note">源帧率越低、目标帧率越高，需要生成的中间帧就越多，处理时间也越长。</div>';
      },
      outName: function (o, S) { return fmtName(S.name, '-' + o.fps + 'fps', 'mp4'); },
      buildArgs: function (o, S, inName, outName) {
        let vf = 'minterpolate=fps=' + (o.fps | 0) + ':mi_mode=' + o.mi;
        if (o.mi === 'mci' && o.aobmc) vf += ':mc_mode=aobmc:vsbmc=1';
        return ['-i', inName, '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(o.crf | 0), '-pix_fmt', 'yuv420p',
          '-c:a', 'copy', '-movflags', '+faststart', '-y', outName];
      }
    });
  }
  fpsSpec('increase-video-fps', '提升视频帧率（插帧）', false);
  fpsSpec('frame-interpolation', '视频插帧（帧率转换）', true);

  function scaleSpec(slug, title, forced) {
    defAV(slug, {
      title: title, kind: 'video', accept: 'video/*', ext: '.mp4', outMime: 'video/mp4',
      dropTitle: '选择一段视频', runLabel: '放大并导出',
      desc: '用 scale 重采样到 720p / 1080p / 2K / 4K，可选 Lanczos 与锐化。',
      boundsTone: 'warn',
      bounds: '能力边界：这是<b>高质量传统重采样（Lanczos / bicubic）+ 锐化</b>，<b>不是超分神经网络</b>。分辨率提升会真实发生（画面放大、边缘更干净），但<b>不会补出原本没有的细节</b>。4K 输出会显著增加显存/内存与时间开销，长视频请谨慎。<br>' + VIDEO_BOUNDS,
      pane: function () {
        return (forced ? '' : selk('h', '目标分辨率', [['720', '720p'], ['1080', '1080p'], ['1440', '2K (1440p)'], ['2160', '4K (2160p)']], '1080')) +
          selk('algo', '重采样算法', [['lanczos', 'lanczos（最锐）'], ['bicubic', 'bicubic（柔和）'], ['bilinear', 'bilinear（最快）']], 'lanczos') +
          sld('sharpen', '锐化强度', 0, 100, 40, 5) +
          sld('crf', '画质（数值越小越好）', 14, 32, 20, 1);
      },
      outName: function (o, S) { return fmtName(S.name, '-up' + (forced || o.h), 'mp4'); },
      buildArgs: function (o, S, inName, outName) {
        const H = forced ? forced : (o.h | 0);
        let vf = 'scale=-2:' + H + ':flags=' + o.algo;
        if (o.sharpen > 0) { const a = (o.sharpen / 100 * 1.2).toFixed(2); vf += ',unsharp=5:5:' + a + ':5:5:0.0'; }
        return ['-i', inName, '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(o.crf | 0), '-pix_fmt', 'yuv420p',
          '-c:a', 'copy', '-movflags', '+faststart', '-y', outName];
      }
    });
  }
  scaleSpec('video-upscaler', '视频放大（分辨率提升）', null);
  scaleSpec('upscale-video-to-4k', '视频放大到 4K', '2160');

  defAV('enhance-video-quality', {
    title: '视频画质增强', kind: 'video', accept: 'video/*', ext: '.mp4', outMime: 'video/mp4',
    dropTitle: '选择一段视频', runLabel: '增强并导出',
    desc: 'eq 对比度/亮度/饱和度 + hqdn3d 时域去噪 + unsharp 锐化的组合预设。',
    boundsTone: 'warn',
    bounds: '这是<b>经典画质增强组合</b>（色彩均衡 eq + 时域/空域去噪 hqdn3d + 反锐化 unsharp），能改善发灰、噪点、发闷的画面。它<b>不能修复严重失焦或压缩块</b>——那属于 AI 修复/超分的范围。<br>' + VIDEO_BOUNDS,
    pane: function () {
      return selk('preset', '预设', [['light', '轻（保留原始质感）'], ['medium', '中（推荐）'], ['strong', '强（明显提升）'], ['vivid', '鲜艳（社交平台向）']], 'medium') +
        sld('denoise', '去噪强度', 0, 100, 35, 5) +
        sld('sharpen', '锐化强度', 0, 100, 45, 5) +
        sld('contrast', '对比度微调', 80, 130, 106, 1) +
        sld('sat', '饱和度微调', 50, 160, 110, 2) +
        sld('crf', '输出画质', 14, 30, 20, 1);
    },
    outName: function (o, S) { return fmtName(S.name, '-enhanced', 'mp4'); },
    buildArgs: function (o, S, inName, outName) {
      const k = { light: 0.6, medium: 1, strong: 1.5, vivid: 1.2 }[o.preset] || 1;
      const dn = (o.denoise / 100) * k * 4;
      const vf = [
        'eq=contrast=' + (o.contrast / 100).toFixed(3) + ':brightness=0.01:saturation=' + (o.sat / 100).toFixed(3),
        'hqdn3d=' + dn.toFixed(2) + ':' + (dn * 0.7).toFixed(2) + ':' + (dn * 1.5).toFixed(2) + ':' + (dn * 1.2).toFixed(2),
        'unsharp=5:5:' + ((o.sharpen / 100) * k).toFixed(2) + ':3:3:0.0'
      ].join(',');
      return ['-i', inName, '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(o.crf | 0), '-pix_fmt', 'yuv420p',
        '-c:a', 'copy', '-movflags', '+faststart', '-y', outName];
    }
  });

  defAV('remove-noise-from-video', {
    title: '视频降噪', kind: 'video', accept: 'video/*', ext: '.mp4', outMime: 'video/mp4',
    dropTitle: '选择一段视频', runLabel: '降噪并导出',
    desc: 'hqdn3d 时域/空域快速降噪，或 nlmeans 非局部均值高质量降噪（明显更慢）。',
    boundsTone: 'warn',
    bounds: '这是<b>经典视频降噪</b>：<b>hqdn3d</b> 快、适合轻微噪点（会轻微损失细节、可能产生轻微拖影）；<b>nlmeans</b> 质量更高但<b>极慢</b>（1080p 短片也可能要几分钟到十几分钟）。它不是基于学习的降噪模型，无法在“完全去噪”和“细节全留”之间做到完美平衡。<br>' + VIDEO_BOUNDS,
    pane: function () {
      return selk('method', '算法', [['hqdn3d', 'hqdn3d · 快（推荐）'], ['nlmeans', 'nlmeans · 慢但更干净']], 'hqdn3d') +
        sld('strength', '降噪强度', 1, 100, 40, 5) +
        chkk('keepDetail', '尽量保留细节（降低时域强度）', true) +
        sld('crf', '输出画质', 14, 30, 20, 1) +
        '<div class="note">nlmeans 的运算量与环境光/噪点强度强相关，务必先用短片段试跑。</div>';
    },
    outName: function (o, S) { return fmtName(S.name, '-denoised', 'mp4'); },
    buildArgs: function (o, S, inName, outName) {
      const s = o.strength / 100;
      let vf;
      if (o.method === 'nlmeans') vf = 'nlmeans=s=' + Math.max(0.5, s * 4).toFixed(2) + ':p=7:r=15';
      else {
        const sp = s * 6, tp = o.keepDetail ? s * 2.5 : s * 6;
        vf = 'hqdn3d=' + sp.toFixed(2) + ':' + (sp * 0.75).toFixed(2) + ':' + tp.toFixed(2) + ':' + (tp * 0.8).toFixed(2);
      }
      return ['-i', inName, '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(o.crf | 0), '-pix_fmt', 'yuv420p',
        '-c:a', 'copy', '-movflags', '+faststart', '-y', outName];
    }
  });

  function bgVideoSpec(slug, title) {
    defAV(slug, {
      title: title, kind: 'video', accept: 'video/*', ext: '.webm', outMime: 'video/webm',
      dropTitle: '选择一段视频', runLabel: '抠像并导出',
      desc: '用颜色键控（colorkey / chromakey）抠掉指定颜色的背景：可自动从四角取色、手动取色，输出透明 WebM 或合成到指定颜色的背景。',
      boundsTone: 'warn', bounds: VC_BOUNDS,
      pane: function () {
        return selk('key', '取色方式', [['auto', '自动（四角取色）'], ['manual', '手动取色'], ['green', '绿幕（0x00FF00）'], ['blue', '蓝幕（0x0000FF）']], 'auto') +
          colk('color', '手动背景色（#RRGGBB）', '#00ff00') +
          sld('similarity', '颜色相似度阈值', 1, 60, 15, 1) +
          sld('blend', '边缘羽化', 0, 40, 8, 1) +
          selk('out', '输出方式', [['alpha', '透明（WebM + Alpha，可叠到任意背景）'], ['solid', '合成到纯色背景（MP4）']], 'alpha') +
          colk('bgcolor', '合成背景色', '#101014') +
          '<div class="note">自动取色会在开始处理时抽取视频第 0.5 秒的画面，取四角区域的平均颜色作为键色。若背景不是纯色，请改用「合成到纯色背景」或换用 AI 分割服务。</div>';
      },
      pre: async function (S, ctx) {
        if (S.opts.key !== 'auto') return;
        const c = await grabFrame(S.file, 0.5);
        if (!c || c.width < 2) return;
        const p = getP(c);
        const rgb = avgCorners(p, 0.12);
        S.extra.autoKey = hexOf(rgb[0], rgb[1], rgb[2]);
        const el = $('[data-k=color]', ctx.host);
        if (el) el.value = S.extra.autoKey;
        ctx.note('已自动取色：<b>' + S.extra.autoKey + '</b>');
      },
      outName: function (o, S) { return fmtName(S.name, '-nobg', o.out === 'alpha' ? 'webm' : 'mp4'); },
      buildArgs: function (o, S, inName, outName) {
        let key = o.color || '#00ff00';
        if (o.key === 'green') key = '#00ff00';
        else if (o.key === 'blue') key = '#0000ff';
        else if (o.key === 'auto') key = S.extra.autoKey || o.color || '#00ff00';
        const hex = '0x' + String(key).replace('#', '');
        const sim = (o.similarity / 100).toFixed(3), bl = (o.blend / 200).toFixed(3);
        if (o.out === 'alpha') {
          return ['-i', inName, '-vf', 'chromakey=' + hex + ':' + sim + ':' + bl + ',format=yuva420p',
            '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-b:v', '0', '-crf', '32',
            '-c:a', 'libopus', '-b:a', '128k', '-y', outName];
        }
        const w = (S.info && S.info.w) || 1280, h = (S.info && S.info.h) || 720;
        const bg = '0x' + String(o.bgcolor || '#101014').replace('#', '');
        return ['-i', inName, '-filter_complex',
          '[0:v]chromakey=' + hex + ':' + sim + ':' + bl + ',format=yuva420p[fg];color=c=' + bg + ':s=' + w + 'x' + h + ':r=30[bg];[bg][fg]overlay=shortest=1,format=yuv420p[v]',
          '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-movflags', '+faststart', '-y', outName];
      },
      after: function (S, ctx) {
        const o = S.opts;
        if (o.out === 'alpha') {
          ctx.report(boundsBox('note', '输出为 <b>WebM（VP9 + Alpha 通道）</b>。播放时背景透明，可以拖进剪辑软件叠在任意画面上。注意：部分播放器不支持 Alpha 通道，看起来会是黑底，导入剪辑软件后正常。'));
        } else {
          ctx.report(boundsBox('note', '已经把抠出的前景合成到纯色背景上。如果要换成图片/视频背景，可再导入剪辑软件处理。'));
        }
      }
    });
  }
  bgVideoSpec('remove-video-background', '移除视频背景（颜色键控）');
  bgVideoSpec('video-background-remover', '视频背景移除（颜色键控）');
  bgVideoSpec('video-background-remover-online', '在线视频背景移除（颜色键控）');

  function vocalSpec(slug, title, mode) {
    defAV(slug, {
      title: title, kind: 'audio', accept: 'audio/*,video/*', ext: '.mp3', outMime: 'audio/mpeg',
      inExt: '.mp3',
      dropTitle: '选择歌曲', runLabel: mode === 'instrumental' ? '分离伴奏' : '分离人声',
      desc: mode === 'instrumental' ? '相位相消法导出伴奏（instrumental）。' : '中置提取法导出人声近似（acapella）。',
      boundsTone: 'warn', bounds: VOC_BOUNDS,
      pane: function () {
        return selk('fmt', '输出格式', [['mp3', 'MP3（体积小）'], ['wav', 'WAV（无损）']], 'mp3') +
          sld('gain', '补偿增益', 0, 100, 45, 5) +
          chkk('both', '同时导出另一半（便于对比试听）', true) +
          '<div class="note">建议使用 320kbps 以上的立体声源文件；单声道音源请换成立体声版本，否则效果会很差。</div>';
      },
      outName: function (o, S) { return fmtName(S.name, mode === 'instrumental' ? '-instrumental' : '-vocals', o.fmt || 'mp3'); },
      buildArgs: function (o, S, inName, outName) {
        const g = 1 + (o.gain / 100);
        const af = mode === 'instrumental'
          ? 'pan=stereo|c0=1*c0-1*c1|c1=1*c0-1*c1,volume=' + g.toFixed(2)
          : 'pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1,volume=' + g.toFixed(2);
        const args = ['-i', inName, '-vn', '-af', af];
        if (o.fmt === 'wav') args.push('-c:a', 'pcm_s16le');
        else args.push('-c:a', 'libmp3lame', '-b:a', '320k');
        args.push('-y', outName);
        return args;
      },
      after: async function (S, ctx, blob) {
        const o = S.opts;
        const other = mode === 'instrumental' ? 'vocals（中置提取近似）' : 'instrumental（相位相消伴奏）';
        ctx.report(boundsBox('note', '同时可导出另一半：<b>' + other + '</b>。点下方按钮会再跑一次 ffmpeg（需要额外时间）。') +
          '<div class="shapes" style="margin-top:10px"><button type="button" class="shape" id="otherHalf">导出' + (mode === 'instrumental' ? '人声' : '伴奏') + '</button></div>');
        const b = $('#otherHalf', ctx.host);
        if (b) b.addEventListener('click', async () => {
          b.disabled = true; b.textContent = '处理中…';
          try {
            const ff = S.ff || await getFF(p => ctx.prog(p), null);
            const inName = 'in2_' + Date.now() + '.mp3';
            await ff.writeFile(inName, new Uint8Array(await S.file.arrayBuffer()));
            const outName = 'out2_' + Date.now() + '.' + (o.fmt || 'mp3');
            const g = 1 + (o.gain / 100);
            const af = mode === 'instrumental'
              ? 'pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1,volume=' + (g * 0.9).toFixed(2)
              : 'pan=stereo|c0=1*c0-1*c1|c1=1*c0-1*c1,volume=' + g.toFixed(2);
            const args = ['-i', inName, '-vn', '-af', af];
            if (o.fmt === 'wav') args.push('-c:a', 'pcm_s16le'); else args.push('-c:a', 'libmp3lame', '-b:a', '320k');
            args.push('-y', outName);
            await ff.exec(args);
            const data = await ff.readFile(outName);
            const b2 = new Blob([data], { type: o.fmt === 'wav' ? 'audio/wav' : 'audio/mpeg' });
            const url = URL.createObjectURL(b2);
            const extra = $('#aiExtra', ctx.host);
            if (extra) extra.innerHTML = '<div class="plabel">另一半试听</div><audio controls src="' + url + '" style="width:100%"></audio>' +
              '<div class="shapes" style="margin-top:8px"><button type="button" class="btn-ghost btn-sm" id="dl2">下载另一半</button></div>';
            const d2 = $('#dl2', ctx.host);
            if (d2) d2.addEventListener('click', () => window.downloadBlob(b2, fmtName(S.name, mode === 'instrumental' ? '-vocals' : '-instrumental', o.fmt || 'mp3')));
            b.textContent = '已导出';
          } catch (e) { b.disabled = false; b.textContent = '重试'; toast('导出失败：' + ((e && e.message) || e)); }
        });
      }
    });
  }
  vocalSpec('remove-vocals-from-song', '去除人声（导出伴奏）', 'instrumental');
  vocalSpec('vocal-remover', '人声去除器', 'instrumental');
  vocalSpec('acapella-extractor', '提取人声（Acapella）', 'vocals');

  defAV('remove-audio-from-video', {
    title: '移除视频中的音频', kind: 'video', accept: 'video/*', ext: '.mp4', outMime: 'video/mp4',
    dropTitle: '选择一段视频', runLabel: '移除音频并导出',
    desc: '直接丢弃音轨（-an），视频流不重新编码，速度主要取决于复制文件。',
    boundsTone: 'note',
    bounds: '这是<b>真正的无损操作</b>：视频流直接复制（<code>-c:v copy</code>），只丢弃音频轨（<code>-an</code>），不重新编码，所以画质零损失、速度很快。唯一需要注意的是：某些播放器对“无音轨的 MP4”提示略有不同，文件本身是正常的。',
    pane: function () { return '<div class="note">无需额外参数：视频流原样复制，只删除音轨。</div>'; },
    outName: function (o, S) { return fmtName(S.name, '-muted', 'mp4'); },
    buildArgs: function (o, S, inName, outName) {
      return ['-i', inName, '-c:v', 'copy', '-an', '-movflags', '+faststart', '-y', outName];
    }
  });

  defAV('remove-background-noise-from-audio', {
    title: '音频降噪（背景噪声移除）', kind: 'audio', accept: 'audio/*,video/*', ext: '.mp3', outMime: 'audio/mpeg',
    inExt: '.mp3', dropTitle: '选择音频或视频', runLabel: '降噪并导出',
    desc: 'afftdn 频域降噪 + anlmdn 非局部均值降噪，可调强度与噪声底。',
    boundsTone: 'warn',
    bounds: '这是<b>经典音频降噪</b>（afftdn 频域谱减法 / anlmdn 非局部均值），对稳定的底噪（空调声、电流声、风扇、嘶声）有效。' +
      '它<b>不是语音增强模型</b>：强度开大时会出现“水下音”“金属音”（音乐性噪声 / musical noise），人声也会变闷。建议从低强度开始，逐步调高。<br>' + VIDEO_BOUNDS,
    pane: function () {
      return selk('method', '算法', [['afftdn', 'afftdn · 频域降噪（推荐）'], ['anlmdn', 'anlmdn · 保留更多细节'], ['both', '两者串联（最强）']], 'afftdn') +
        sld('strength', '降噪强度', 1, 40, 12, 1) +
        sld('noiseFloor', '噪声底（dB，越小越激进）', -60, -10, -25, 1) +
        selk('fmt', '输出格式', [['mp3', 'MP3'], ['wav', 'WAV'], ['flac', 'FLAC']], 'mp3');
    },
    outName: function (o, S) { return fmtName(S.name, '-denoised', o.fmt || 'mp3'); },
    buildArgs: function (o, S, inName, outName) {
      let af;
      if (o.method === 'afftdn') af = 'afftdn=nr=' + (o.strength | 0) + ':nf=' + (o.noiseFloor | 0);
      else if (o.method === 'anlmdn') af = 'anlmdn=s=' + (o.strength / 5000).toFixed(5) + ':p=0.002:r=0.006';
      else af = 'afftdn=nr=' + (o.strength | 0) + ':nf=' + (o.noiseFloor | 0) + ',anlmdn=s=0.0002:p=0.002:r=0.006';
      const args = ['-i', inName, '-vn', '-af', af];
      if (o.fmt === 'wav') args.push('-c:a', 'pcm_s16le');
      else if (o.fmt === 'flac') args.push('-c:a', 'flac');
      else args.push('-c:a', 'libmp3lame', '-b:a', '256k');
      args.push('-y', outName);
      return args;
    }
  });

  function voiceSpec(slug, title) {
    defAV(slug, {
      title: title, kind: 'audio', accept: 'audio/*,video/*', ext: '.mp3', outMime: 'audio/mpeg',
      inExt: '.mp3', dropTitle: '选择要变声的音频', runLabel: '变声并导出',
      desc: '用 asetrate + aresample + atempo 做真实的音高变换（保持时长），再叠加回声等效果模拟不同角色。',
      boundsTone: 'warn',
      bounds: '这是<b>真实的音高/共振峰处理</b>（<code>asetrate</code> 改变采样率来移调，<code>aresample</code> 回到标准采样率，<code>atempo</code> 把时长还原），所以变声时语句长短不变、不会变成快放/慢放。' +
        '需要说明的是：<b>它不是 AI 音色克隆</b>（那需要 RVC / So-VITS 这类模型），不能把你说的话变成某个具体人的声音；它做的是“机器人 / 怪兽 / 小黄人 / 电话音 / 大厅混响”这类经典效果。音高移得越多，声音越不自然（共振峰没跟着移动）。',
      pane: function () {
        return selk('preset', '预设', [['robot', '机器人'], ['monster', '怪兽（低沉）'], ['minion', '小黄人（高亢）'], ['child', '童声'], ['deep', '变低沉'], ['high', '变尖细'], ['phone', '电话音'], ['room', '大厅混响'], ['slow', '慢速'], ['fast', '快速'], ['custom', '自定义']], 'robot') +
          sld('pitch', '音高倍数（>1 更高）', 0.5, 2, 1, 0.01) +
          sld('tempo', '语速倍数', 0.5, 2, 1, 0.01) +
          sld('echo', '回声强度', 0, 100, 0, 5) +
          selk('fmt', '输出格式', [['mp3', 'MP3'], ['wav', 'WAV']], 'mp3') +
          '<div class="note">预设会自动设置音高/语速/回声，你仍可手动微调。</div>';
      },
      mountAfter: function (S, ctx) {
        const setP = () => {
          const p = $('[data-k=preset]', ctx.host); if (!p) return;
          const v = p.value;
          const map = {
            robot: [1.0, 1.0, 55], monster: [0.68, 1.0, 30], minion: [1.55, 1.0, 25],
            child: [1.3, 1.05, 0], deep: [0.82, 1.0, 0], high: [1.22, 1.0, 0],
            phone: [1.0, 1.0, 0], room: [0.95, 1.0, 70], slow: [1.0, 0.78, 0], fast: [1.0, 1.32, 0]
          }[v];
          if (map) {
            const sp = $('[data-k=pitch]', ctx.host), st = $('[data-k=tempo]', ctx.host), se = $('[data-k=echo]', ctx.host);
            if (sp) { sp.value = map[0]; const l = $('#pitchV', ctx.host); if (l) l.textContent = map[0]; }
            if (st) { st.value = map[1]; const l = $('#tempoV', ctx.host); if (l) l.textContent = map[1]; }
            if (se) { se.value = map[2]; const l = $('#echoV', ctx.host); if (l) l.textContent = map[2]; }
          }
          const info = $('#aiOut', ctx.host);
          if (info) info.innerHTML = '预设：<b>' + esc(v) + '</b>' + (v === 'phone' ? '（电话音使用 300–3400Hz 带通）' : '') + (v === 'robot' ? '（机器人叠加短延迟回声）' : '');
        };
        const p = $('[data-k=preset]', ctx.host);
        if (p) { p.addEventListener('change', setP); setP(); }
      },
      outName: function (o, S) { return fmtName(S.name, '-voice-' + (o.preset || 'custom'), o.fmt || 'mp3'); },
      buildArgs: function (o, S, inName, outName) {
        const preset = o.preset || 'custom';
        let pitch = parseFloat(o.pitch) || 1, tempo = parseFloat(o.tempo) || 1, echo = o.echo;
        if (preset === 'robot') { pitch = 1; tempo = 1; echo = Math.max(echo, 55); }
        if (preset === 'phone') { /* 带通 + 轻微削波 */ }
        const parts = [];
        if (pitch !== 1) parts.push(pitchFilter(pitch));
        if (tempo !== 1) parts.push(atempoChain(tempo));
        if (preset === 'phone') parts.push('highpass=f=300', 'lowpass=f=3400');
        if (echo > 0) parts.push('aecho=0.8:0.88:' + Math.round(20 + echo * 1.2) + ':' + (echo / 200).toFixed(2));
        if (preset === 'robot') parts.push('chorus=0.6:0.9:50:0.4:0.25:2');
        const af = parts.length ? parts.join(',') : 'anull';
        const args = ['-i', inName, '-vn', '-af', af];
        if (o.fmt === 'wav') args.push('-c:a', 'pcm_s16le'); else args.push('-c:a', 'libmp3lame', '-b:a', '192k');
        args.push('-y', outName);
        return args;
      },
      after: function (S, ctx) {
        ctx.report(boundsBox('note', '处理完成后上方播放器会自动播放结果，可直接试听与「下载结果」对比原声。若要 AI 音色克隆（把声音变成某个具体人），需要 RVC / So-VITS 这类模型，本页做不到。'));
      }
    });
  }
  voiceSpec('change-voice-online', '在线变声器');
  voiceSpec('voice-changer', '变声器');

  /* ======================= 31. 路由与挂载 ======================= */
  const ROUTES = {};
  Object.keys(IMG).forEach(function (k) {
    ROUTES[k] = function (host, cfg, slug) { imgTool(host, cfg, slug, IMG[k]); };
  });
  Object.keys(AV).forEach(function (k) {
    ROUTES[k] = function (host, cfg, slug) { avTool(host, cfg, slug, AV[k]); };
  });
  Object.keys(MOUNTS).forEach(function (k) { ROUTES[k] = MOUNTS[k]; });
  ROUTES['ai-music-detector'] = audioPanel('ai-music-detector', 'AI 音乐检测（音频特征分析）');
  ROUTES['ai-song-checker'] = audioPanel('ai-song-checker', 'AI 歌曲检测（音频特征分析）');

  E.mount = function (host, cfg, slug) {
    try {
      if (!host) return;
      cfg = cfg || {};
      const fn = ROUTES[slug];
      if (!fn) {
        window.TUI.soon(host, '这个工具（' + slug + '）还没有接入本地引擎。');
        return;
      }
      fn(host, cfg, slug);
    } catch (e) {
      try {
        window.TUI.soon(host, '工具初始化失败：' + ((e && e.message) || e) + '。可以刷新页面重试，或换用其它工具。');
      } catch (e2) {
        host.innerHTML = '<div class="tool-body single"><div class="stage"><div class="soon">工具初始化失败，请刷新页面重试。</div></div></div>';
      }
    }
  };
  /* 调试用：暴露纯算法，便于自动化测试复核（不影响任何功能） */
  E._internals = {
    medianCut: medianCut, kmeansPalette: kmeansPalette, simplify: simplify, sobel: sobel,
    traceContours: traceContours, clahe: clahe, gaussBlurGray: gaussBlurGray, labelComponents: labelComponents,
    detectBPM: detectBPM, toSubs: toSubs, textToSegs: textToSegs, checkEnglish: checkEnglish,
    checkChinese: checkChinese, applyFixes: applyFixes, analyzeImage: analyzeImage, promptFromFeatures: promptFromFeatures,
    parseJPEG: parseJPEG, dhash: dhash, atempoChain: atempoChain, readOpts: readOpts, ROUTES: ROUTES,
    getFF: getFF, forensicsNoise: noiseConsistency, colorName: colorName, hexOf: hexOf
  };
  window.TOOL_ENGINES.ai = E;
})();
