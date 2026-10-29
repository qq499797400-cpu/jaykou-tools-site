/* ==========================================================================
   engine-av.js — 音视频引擎（基于 ffmpeg.wasm，全部本地处理）
   覆盖：格式转换 / 提取音频 / 转 GIF / 裁剪时长 / 画面裁剪 / 旋转翻转 /
        倒放 / 变速 / 静音 / 压缩 / 改帧率 / 降分辨率 / 多文件合并 / 音量归一
   ========================================================================== */
(function () {
  'use strict';
  const VENDOR = '../assets/vendor/';
  const E = {};
  window.TOOL_ENGINES = window.TOOL_ENGINES || {};
  window.TOOL_ENGINES.av = E;

  const T = {
    load: '正在加载视频引擎…',
    run: '全部在你的设备上运行，耗时取决于电脑或手机性能与视频时长。',
  };

  /* ---------- ffmpeg 单例 ---------- */
  async function getFF(onProg, onLog) {
    if (window.__FF) return window.__FF;
    if (window.__FFP) return window.__FFP;
    window.__FFP = (async () => {
      const { FFmpeg } = FFmpegWASM;
      const ff = new FFmpeg();
      ff.on('progress', ({ progress }) => onProg && onProg(Math.min(99, Math.round((progress || 0) * 100))));
      if (onLog) ff.on('log', ({ message }) => onLog(message));
      const toBlob = async (u, t) => URL.createObjectURL(new Blob([await (await fetch(u)).blob()], { type: t }));
      await ff.load({
        coreURL: await toBlob(VENDOR + 'ffmpeg-core.js', 'text/javascript'),
        wasmURL: await toBlob(VENDOR + 'ffmpeg-core.wasm', 'application/wasm')
      });
      window.__FF = ff;
      return ff;
    })();
    return window.__FFP;
  }
  window.__getFF = getFF;

  /* ---------- 元信息 ---------- */
  function meta(file) {
    return new Promise(res => {
      const v = document.createElement('video');
      const url = URL.createObjectURL(file);
      let done = false;
      const fin = () => { if (done) return; done = true; res({ url, duration: v.duration || 0, w: v.videoWidth || 0, h: v.videoHeight || 0 }); };
      v.preload = 'metadata';
      v.onloadedmetadata = fin; v.onerror = fin; v.src = url;
      setTimeout(fin, 6000);
    });
  }

  /* ---------- 样式小工具 ---------- */
  const el = (h) => { const d = document.createElement('div'); d.innerHTML = h.trim(); return d.firstElementChild; };
  const row = (label, inner) => `<div class="plabel">${label}</div>${inner}`;

  /* ---------- 各 mode 的设置面板定义 ---------- */
  function paneFor(mode, cfg, S) {
    const p = [];
    const P = (html) => p.push(html);
    switch (mode) {
      case 'convert':
        P(`<div class="ptitle">输出格式</div><div class="pdesc">选择目标格式，全部在本地编码。</div>
           <select id="avFmt">${(cfg.targets || ['mp4', 'webm', 'mov', 'mkv', 'gif', 'mp3', 'wav']).map(f => `<option value="${f}">${f.toUpperCase()}</option>`).join('')}</select>`);
        break;
      case 'toaudio':
        P(`<div class="ptitle">音频格式</div><div class="pdesc">提取视频音轨，或转换音频文件。</div>
           <div class="aopts">${(cfg.targets || ['mp3', 'm4a', 'wav', 'flac', 'ogg', 'opus']).map((f, i) => `<div class="aopt ${i === 0 ? 'on' : ''}" data-f="${f}"><b>${f.toUpperCase()}</b><span>${({ mp3: '处处可播，兼容性最好。', m4a: 'AAC，体积小、兼容好。', wav: '无压缩，无损。', flac: '无损，文件较大。', ogg: '开放格式，音质不错。', opus: '同音质下体积最小。' })[f] || ''}</span></div>`).join('')}</div>
           <div id="avBitwrap"><div class="plabel">质量</div><select id="avBit"><option value="192">192 kbps · 推荐</option><option value="128">128 kbps · 更小</option><option value="320">320 kbps · 最佳</option></select></div>`);
        break;
      case 'togif':
        P(`<div class="ptitle">GIF 设置</div><div class="pdesc">循环播放的 GIF，无水印。</div>
           <div class="sliderrow"><span style="font-size:13px;color:#c9c9c9;min-width:62px">帧/秒</span><input type="range" id="gifFps" min="5" max="24" step="1" value="12"><span class="val" id="gifFpsV">12</span></div>
           <div class="plabel">宽度</div><select id="gifW"><option value="480">480 px</option><option value="320">320 px</option><option value="640">640 px</option><option value="0">原始</option></select>
           <div class="tinputs"><div class="fld"><div class="plabel">开始</div><input id="gifA" value="0:00.0"></div><div class="fld"><div class="plabel">结束</div><input id="gifB" value="0:03.0"></div></div>`);
        break;
      case 'trim':
        P(`<div class="ptitle">裁剪时长</div><div class="pdesc">拖动时间轴手柄或直接输入时间，剪切精确。</div>
           <div class="tinputs"><div class="fld"><div class="plabel" style="margin-top:0">开始</div><input id="avStart" value="0:00.0"></div><div class="fld"><div class="plabel" style="margin-top:0">结束</div><input id="avEnd" value="0:00.0"></div></div>
           <div class="selnote" id="avSel">已选：0:00.0</div>
           <div class="chk" id="avFast"><span class="box"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><path d="M4 12l6 6L20 6" stroke-linecap="round" stroke-linejoin="round"/></svg></span> 快速模式（直接复制，对齐关键帧）</div>`);
        break;
      case 'crop':
        P(`<div class="ptitle">画面裁剪</div><div class="pdesc">在视频上拖动裁剪框，或选择比例。</div>
           <div class="plabel" style="margin-top:0">比例</div>
           <div class="shapes" id="avShapes">${['free', '9/16', '1/1', '4/5', '16/9', '4/3', '3/4'].map((r, i) => `<button class="shape ${i === 0 ? 'on' : ''}" data-r="${r}">${r === 'free' ? '自由' : r.replace('/', ':')}</button>`).join('')}</div>
           <div class="selnote" id="avCropSel">输出：0 × 0</div>`);
        break;
      case 'rotate':
        P(`<div class="ptitle">旋转与翻转</div><div class="pdesc">旋转视频或镜像翻转。</div>
           <div class="shapes" id="avRot">
             <button class="shape" data-r="90">↻ 90°</button><button class="shape" data-r="180">↻ 180°</button><button class="shape" data-r="270">↻ 270°</button><button class="shape" data-r="hflip">⇋ 水平翻转</button><button class="shape" data-r="vflip">⇅ 垂直翻转</button>
           </div>
           <div class="selnote" id="avRotSel">输出：0 × 0</div>`);
        break;
      case 'reverse':
        P(`<div class="ptitle">倒放</div><div class="pdesc">倒序播放片段，声音也会倒放。</div>
           <div class="chk on" id="avRevAudio"><span class="box"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><path d="M4 12l6 6L20 6" stroke-linecap="round" stroke-linejoin="round"/></svg></span> 同时倒放音频</div>`);
        break;
      case 'speed':
        P(`<div class="ptitle">变速</div><div class="pdesc">加速或减速，0.25× 到 4×。</div>
           <div class="sliderrow"><input type="range" id="avSpd" min="0.25" max="4" step="0.05" value="${cfg.speed || 2}"><span class="val" id="avSpdV">${cfg.speed || 2}×</span></div>
           <div class="speeds shapes" id="avSpds">${[0.25, 0.5, 0.75, 1.25, 1.5, 2, 3, 4].map(s => `<button class="shape" data-s="${s}">${s}×</button>`).join('')}</div>
           <div class="chk" id="avMute"><span class="box"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><path d="M4 12l6 6L20 6" stroke-linecap="round" stroke-linejoin="round"/></svg></span> 移除声音</div>
           <div class="note">音调保持不变，高于原帧率的多余帧会被丢弃。</div>`);
        break;
      case 'compress':
        P(`<div class="ptitle">压缩</div><div class="pdesc">让文件变小：按质量或目标大小压缩。</div>
           <div class="seg"><button id="cq1" class="on">质量</button><button id="cq2">目标大小</button></div>
           <div id="cQual">
             <div class="optcard on" data-q="smallest"><b>最小体积</b><span>最高 720p，适合聊天和邮件。</span></div>
             <div class="optcard" data-q="balanced"><b>均衡</b><span>最高 1080p，观感接近原片。</span></div>
             <div class="optcard" data-q="high"><b>高画质</b><span>保持原分辨率，压缩幅度较小。</span></div>
           </div>
           <div id="cSize" class="hide"><div class="plabel" style="margin-top:0">目标大小</div>
             <select id="cSizeSel"><option value="10">10 MB — Discord</option><option value="25">25 MB — 邮件附件</option><option value="50">50 MB</option><option value="100">100 MB</option></select></div>`);
        break;
      case 'fps':
        P(`<div class="ptitle">帧率</div><div class="pdesc">修改视频每秒帧数。</div>
           <select id="avFps">${(cfg.targets || [24, 30, 60, 120]).map(f => `<option value="${f}" ${cfg.fps === f ? 'selected' : ''}>${f} fps</option>`).join('')}</select>
           <div class="note">帧率越高画面越流畅、文件越大。画面不会重拍，只是重新采样。</div>`);
        break;
      case 'resize':
        P(`<div class="ptitle">输出尺寸</div><div class="pdesc">放大或缩小视频。</div>
           <select id="avRes">${(cfg.presets || [['原始', 0], ['1080p · 1920', 1080], ['720p · 1280', 720], ['480p · 854', 480], ['360p · 640', 360], ['正方形 1080', -1]]).map(x => `<option value="${x[1]}">${x[0]}</option>`).join('')}</select>`);
        break;
      case 'merge':
        P(`<div class="ptitle">文件</div><div class="pdesc">添加两个及以上片段，将按此顺序拼接，且分辨率和格式需一致。</div>
           <div id="mList" class="note">还没有更多片段。</div>
           <button class="btn-ghost btn-sm" id="mAdd" style="margin-top:10px">添加片段</button>`);
        break;
      case 'audiofx':
        P(`<div class="ptitle">${cfg.paneTitle || '音频'}</div><div class="pdesc">${cfg.paneDesc || '在本地处理音轨。'}</div>
           ${cfg.controls || ''}`);
        break;
      default:
        P(`<div class="ptitle">${cfg.paneTitle || '设置'}</div><div class="pdesc">${cfg.paneDesc || '设置好参数后开始转换。'}</div>`);
    }
    P(`<div class="outbox" id="avOut">输出：—</div><div class="warnbox hide" id="avWarn"></div>
       <button class="btn-lime btn-run" id="avRun">${cfg.runLabel || '转换'}</button>
       <div class="progress" id="avProg"><i></i></div>
       <div class="runnote">${T.run}</div>`);
    return p.join('');
  }

  /* ---------- 参数生成 ---------- */
  function atempoChain(sp) {
    const out = []; let r = sp;
    while (r > 2) { out.push('atempo=2.0'); r /= 2; }
    while (r < 0.5) { out.push('atempo=0.5'); r *= 2; }
    out.push('atempo=' + r.toFixed(3));
    return out.join(',');
  }

  function buildArgs(mode, cfg, S, meta, q) {
    const inName = 'input' + S.ext;
    const A = [];
    switch (mode) {
      case 'convert': {
        const f = q('avFmt') || 'mp4';
        S.outName = cfg.outBase(S) + '.' + f;
        if (['mp3', 'wav', 'm4a', 'ogg', 'opus', 'flac'].includes(f)) {
          A.push('-i', inName, '-vn');
          A.push(...audioArgs(f, 192));
        } else if (f === 'gif') {
          A.push('-i', inName, '-vf', 'fps=12,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse');
        } else if (f === 'webm') {
          A.push('-i', inName, '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-row-mt', '1', '-c:a', 'libopus', '-b:a', '96k');
        } else {
          A.push('-i', inName, '-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart');
        }
        A.push(S.outName);
        S.outMime = mimeFor(f);
        break;
      }
      case 'toaudio': {
        const f = S.audioFmt || 'mp3';
        const k = +(q('avBit') || 192);
        S.outName = cfg.outBase(S) + '.' + f;
        A.push('-i', inName, '-vn');
        A.push(...audioArgs(f, k));
        A.push(S.outName);
        S.outMime = mimeFor(f);
        break;
      }
      case 'togif': {
        const fps = +(q('gifFps') || 12), w = +(q('gifW') || 480);
        const a = q('gifA') || '0', b = q('gifB') || String(meta.duration.toFixed(1));
        S.outName = cfg.outBase(S) + '.gif';
        A.push('-ss', String(parseT(a) ?? 0), '-to', String(parseT(b) ?? meta.duration), '-i', inName,
          '-vf', `fps=${fps},${w ? 'scale=' + w + ':-1:flags=lanczos,' : ''}split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`, '-loop', '0', S.outName);
        S.outMime = 'image/gif';
        break;
      }
      case 'trim': {
        const a = parseT(q('avStart')) ?? 0, b = parseT(q('avEnd')) ?? meta.duration;
        S.outName = cfg.outBase(S) + '-' + a.toFixed(1) + 's' + S.ext;
        if (S.fast) A.push('-ss', String(a), '-i', inName, '-t', String(Math.max(0.1, b - a)), '-c', 'copy', '-avoid_negative_ts', 'make_zero');
        else A.push('-ss', String(a), '-i', inName, '-t', String(Math.max(0.1, b - a)), '-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '128k');
        A.push(S.outName);
        S.outMime = S.mime;
        break;
      }
      case 'crop': {
        const r = S.cropRect;
        S.outName = cfg.outBase(S) + '-' + (r.w - r.w % 2) + 'x' + (r.h - r.h % 2) + '.mp4';
        A.push('-i', inName, '-vf', `crop=${r.w - r.w % 2}:${r.h - r.h % 2}:${r.x}:${r.y}`,
          '-c:v', 'libx264', '-crf', '22', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', S.outName);
        S.outMime = 'video/mp4';
        break;
      }
      case 'rotate': {
        const r = S.rot || '90';
        const vf = { 90: 'transpose=1', 180: 'transpose=1,transpose=1', 270: 'transpose=2', hflip: 'hflip', vflip: 'vflip' }[r];
        S.outName = cfg.outBase(S) + '-rotated.mp4';
        A.push('-i', inName, '-vf', vf, '-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', S.outName);
        S.outMime = 'video/mp4';
        break;
      }
      case 'reverse': {
        S.outName = cfg.outBase(S) + '-reversed.mp4';
        const vf = 'reverse';
        if (S.revAudio) A.push('-i', inName, '-vf', vf, '-af', 'areverse', '-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast', '-c:a', 'aac', S.outName);
        else A.push('-i', inName, '-vf', vf, '-an', '-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast', S.outName);
        S.outMime = 'video/mp4';
        break;
      }
      case 'speed': {
        const sp = S.speed;
        S.outName = cfg.outBase(S) + (sp > 1 ? '-faster' : '-slower') + '.mp4';
        A.push('-i', inName, '-vf', `setpts=PTS/${sp}`);
        if (S.mute) A.push('-an');
        else A.push('-af', atempoChain(sp), '-c:a', 'aac', '-b:a', '128k');
        A.push('-c:v', 'libx264', '-crf', '22', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', S.outName);
        S.outMime = 'video/mp4';
        break;
      }
      case 'compress': {
        const { H, crf, vbit } = S.comp;
        S.outName = cfg.outBase(S) + '-compressed.mp4';
        A.push('-i', inName);
        if (H && H < meta.h) A.push('-vf', `scale=-2:${H}`);
        if (vbit) A.push('-b:v', Math.round(vbit / 1000) + 'k');
        else A.push('-crf', String(crf));
        A.push('-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', S.outName);
        S.outMime = 'video/mp4';
        break;
      }
      case 'fps': {
        const f = +(q('avFps') || 30);
        S.outName = cfg.outBase(S) + '-' + f + 'fps.mp4';
        A.push('-i', inName, '-vf', `fps=${f}`, '-c:v', 'libx264', '-crf', '22', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', S.outName);
        S.outMime = 'video/mp4';
        break;
      }
      case 'resize': {
        const h = +(q('avRes') || 0);
        S.outName = cfg.outBase(S) + (h ? '-' + h + 'p' : '-original') + '.mp4';
        A.push('-i', inName);
        if (h > 0) A.push('-vf', `scale=-2:${h}`);
        else if (h === -1) A.push('-vf', `scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2`);
        A.push('-c:v', 'libx264', '-crf', '22', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', S.outName);
        S.outMime = 'video/mp4';
        break;
      }
      case 'audiofx': {
        S.outName = cfg.outBase(S) + (cfg.outExt || '.mp3');
        A.push('-i', inName, '-vn', ...(cfg.audioFilters || []).flatMap(f => ['-af', f]));
        A.push(...(cfg.audioOut || audioArgs('mp3', 192)), S.outName);
        S.outMime = mimeFor((cfg.outExt || '.mp3').slice(1));
        break;
      }
    }
    S.inName = inName;
    return A;
  }

  function audioArgs(f, k) {
    switch (f) {
      case 'mp3': return ['-c:a', 'libmp3lame', '-b:a', k + 'k'];
      case 'm4a': return ['-c:a', 'aac', '-b:a', k + 'k'];
      case 'wav': return ['-c:a', 'pcm_s16le'];
      case 'flac': return ['-c:a', 'flac'];
      case 'ogg': return ['-c:a', 'libvorbis', '-q:a', '5'];
      case 'opus': return ['-c:a', 'libopus', '-b:a', k + 'k'];
      case 'aac': return ['-c:a', 'aac', '-b:a', k + 'k'];
      default: return ['-c:a', 'libmp3lame', '-b:a', '192k'];
    }
  }
  function mimeFor(f) {
    return { mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', mov: 'video/quicktime', gif: 'image/gif', webp: 'image/webp', apng: 'image/apng', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/opus', aac: 'audio/aac' }[f] || 'application/octet-stream';
  }
  function parseT(str) {
    if (str == null) return null;
    const m = String(str).trim().match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
    if (!m) return null;
    return (m[1] ? +m[1] * 60 : 0) + +m[2];
  }

  /* ---------- 主挂载 ---------- */
  E.mount = function (host, cfg, slug) {
    const mode = cfg.mode || 'convert';
    const multiple = mode === 'merge';
    const accept = cfg.accept || (mode === 'toaudio' && cfg.src === 'audio' ? 'audio/*' : 'video/*,audio/*,.mkv');

    host.innerHTML = `
      <div class="tool-body wide">
        <div class="stage">
          <div class="drop" id="avDrop">
            <div class="ic">${window.icon(cfg.icon || 'video', 30)}</div>
            <h3>${cfg.dropTitle || '选择文件'}</h3>
            <p>拖放文件到这里，或粘贴、点击选择</p>
            <button class="btn-lime" id="avPick">${window.icon('video', 16)} ${cfg.pickLabel || '选择文件'} <span><svg data-lucide="arrow-right" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></span></button>
            <div class="fmts">${cfg.formats || '<b>MP4、MOV、WebM、MKV</b> · 最大 <b>4 GB</b>'}</div>
          </div>
          <input type="file" id="avFile" hidden ${multiple ? 'multiple' : ''} accept="${accept}">
          <div id="avLoaded" class="hide" style="flex:1;flex-direction:column">
            <div class="preview"><video id="avVid" controls playsinline></video>
              <div class="cropwrap hide" id="avCropWrap"><div class="cropbox" id="avCropBox"><div class="grid3"></div><i class="c c-tl"></i><i class="c c-tr"></i><i class="c c-bl"></i><i class="c c-br"></i></div></div>
            </div>
            <div class="filmstrip hide" id="avFilm"><div class="strip" id="avStrip"></div><div class="trimshade" id="avShadeL"></div><div class="trimshade" id="avShadeR"></div><div class="handle handleL" id="avHL"></div><div class="handle handleR" id="avHR"></div></div>
            <div class="trimrow hide" id="avTrimRow"><button class="btn-play" id="avPlaySel">${window.icon('video', 12)} 播放选区</button><span id="avSelTime">0:00.0 / 0:00.0</span></div>
            <div class="filebar"><span><b id="avName"></b>&nbsp;&nbsp;<span id="avMeta"></span></span><span class="newv" id="avNew">换个文件</span></div>
            <div class="thumbrow" id="avExtra" ${multiple ? '' : 'hidden'}></div>
          </div>
        </div>
        <div class="pane" id="avPane">${paneFor(mode, cfg, {})}</div>
      </div>`;

    const $ = s => host.querySelector(s);
    const S = {
      file: null, url: '', ext: '.mp4', mime: 'video/mp4', meta: { duration: 0, w: 0, h: 0 },
      audioFmt: (cfg.targets || ['mp3'])[0], speed: cfg.speed || 2, mute: false, revAudio: true,
      rot: '90', fast: false, comp: { H: 720, crf: 30 }, cropRect: { x: 0, y: 0, w: 0, h: 0 }, extras: []
    };
    S.outBase = cfg.outBase || (st => (st.file?.name || 'file').replace(/\.[^.]+$/, ''));

    const q = id => { const e = $('#' + id); return e ? e.value : null; };
    const setOut = txt => { $('#avOut').innerHTML = txt; };
    const showProg = p => { $('#avProg').style.display = ''; $('#avProg').firstElementChild.style.width = p + '%'; };
    const hideProg = () => { $('#avProg').style.display = 'none'; };

    /* ---- 文件加载 ---- */
    async function load(input) {
      const files = input instanceof File ? [input] : Array.from(input || []);
      const f = files[0];
      if (!f) return;
      S.file = f;
      S.ext = (f.name.match(/\.[^.]+$/) || ['.mp4'])[0].toLowerCase();
      S.mime = f.type || 'video/mp4';
      const m = await meta(f);
      S.meta = m;
      $('#avVid').src = m.url; S.url = m.url;
      $('#avDrop').classList.add('hide');
      $('#avLoaded').classList.remove('hide');
      $('#avName').textContent = f.name;
      $('#avMeta').textContent = `${m.w} × ${m.h} · ${window.fmtT(m.duration)} · ${window.fmtSize(f.size)}`;
      if (mode === 'trim') { if ($('#avStart')) $('#avStart').value = window.fmtT(0, true); if ($('#avEnd')) $('#avEnd').value = window.fmtT(m.duration, true); buildFilm(); }
      if (mode === 'togif' && $('#gifB')) $('#gifB').value = window.fmtT(Math.min(3, m.duration), true);
      if (mode === 'crop') initCrop();
      update();
    }

    window.bindFileInput($('#avDrop'), $('#avFile'), accept, load);
    $('#avPick').addEventListener('click', e => { e.stopPropagation(); $('#avFile').click(); });
    $('#avNew').addEventListener('click', () => {
      S.file = null; if (S.url) URL.revokeObjectURL(S.url);
      $('#avLoaded').classList.add('hide'); $('#avDrop').classList.remove('hide');
      setOut('输出：—');
    });
    window.addEventListener('paste', e => {
      const f = [...(e.clipboardData?.files || [])].find(x => /video|audio|image/.test(x.type));
      if (f) load([f]);
    });

    /* ---- 输出预估 ---- */
    function update() {
      const m = S.meta, d = m.duration || 1;
      if (!S.file) return;
      const warn = $('#avWarn'); warn.classList.add('hide');
      if (mode === 'toaudio') {
        const k = mode === 'toaudio' ? +(q('avBit') || 192) : 192;
        setOut(`输出：<b>${S.audioFmt.toUpperCase()}</b> · ${window.fmtT(d)} · 约 ${window.fmtSize(k * 1000 * d / 8)}`);
      } else if (mode === 'togif') {
        const fps = +(q('gifFps') || 12), w = +(q('gifW') || 480);
        const a = parseT(q('gifA')) ?? 0, b = parseT(q('gifB')) ?? d;
        const dur = Math.max(0.1, b - a);
        const oh = w ? Math.round(m.h * w / m.w) : m.h;
        setOut(`输出：<b>GIF</b> · ${w || m.w} × ${oh} · ${dur.toFixed(1)} 秒 @ ${fps} fps`);
      } else if (mode === 'trim') {
        const a = parseT(q('avStart')) ?? 0, b = parseT(q('avEnd')) ?? d;
        const sel = Math.max(0, b - a);
        const est = S.file.size * sel / d;
        setOut(`输出：<b>${S.ext.slice(1).toUpperCase()}</b> · ${m.w} × ${m.h} · ${window.fmtT(sel)} · 约 ${window.fmtSize(est)}`);
        $('#avSel').textContent = '已选：' + window.fmtT(sel);
        if ($('#avSelTime')) $('#avSelTime').textContent = window.fmtT(a) + ' / ' + window.fmtT(b);
      } else if (mode === 'crop') {
        const r = cropRect(); S.cropRect = r;
        setOut(`输出：<b>MP4</b> · ${r.w} × ${r.h} · ${window.fmtT(d)} · 约 ${window.fmtSize(S.file.size * r.w * r.h / (m.w * m.h))}`);
        $('#avCropSel').textContent = '输出：' + r.w + ' × ' + r.h;
      } else if (mode === 'rotate') {
        const swapped = S.rot === '90' || S.rot === '270';
        setOut(`输出：<b>MP4</b> · ${swapped ? m.h + ' × ' + m.w : m.w + ' × ' + m.h} · ${window.fmtT(d)}`);
        $('#avRotSel').textContent = '输出：' + (swapped ? m.h + ' × ' + m.w : m.w + ' × ' + m.h);
      } else if (mode === 'speed') {
        const sp = S.speed;
        setOut(`输出：<b>MP4</b> · ${m.w} × ${m.h} · ${window.fmtT(d / sp)} · 约 ${window.fmtSize(S.file.size * (0.55 / sp + 0.45))}`);
      } else if (mode === 'reverse') {
        setOut(`输出：<b>MP4</b> · ${m.w} × ${m.h} · ${window.fmtT(d)}`);
      } else if (mode === 'compress') {
        const quality = S.quality || 'smallest';
        let H = { smallest: 720, balanced: 1080, high: m.h }[quality];
        H = Math.min(H, m.h);
        let vbit = 0, crf = { smallest: 30, balanced: 26, high: 22 }[quality];
        let est = S.file.size * (quality === 'smallest' ? .38 : quality === 'balanced' ? .58 : .8);
        if (S.sizeMode) {
          const tgt = +(q('cSizeSel') || 10) * 8 * 1024 * 1024;
          vbit = Math.max(25000, tgt / d - 128000 - 40000);
          est = tgt / 8;
        }
        S.comp = { H, crf, vbit };
        setOut(`输出：<b>MP4</b> · ${Math.round(m.w * H / m.h / 2) * 2} × ${H} · ${window.fmtT(d)} · 约 ${window.fmtSize(est)}`);
        if (!S.sizeMode && S.file.size < 300 * 1024) { warn.classList.remove('hide'); warn.textContent = '这个文件本身已经很小，再压缩可能不会再变小。可以试试更低画质，或保留原始文件。'; }
      } else if (mode === 'fps') {
        const f = +(q('avFps') || 30);
        setOut(`输出：<b>MP4</b> · ${m.w} × ${m.h} · ${f} fps · 约 ${window.fmtSize(S.file.size * (f / 30) * .9)}`);
      } else if (mode === 'resize') {
        const h = +(q('avRes') || 0);
        const oh = h > 0 ? h : h === -1 ? 1080 : m.h;
        const ow = h === -1 ? 1080 : Math.round(m.w * oh / m.h / 2) * 2;
        setOut(`输出：<b>MP4</b> · ${ow} × ${oh} · 约 ${window.fmtSize(S.file.size * (oh / m.h))}`);
      } else if (mode === 'convert') {
        const f = q('avFmt') || 'mp4';
        setOut(`输出：<b>${f.toUpperCase()}</b> · ${['mp3', 'wav', 'm4a', 'flac', 'ogg', 'opus'].includes(f) ? '仅音频' : m.w + ' × ' + m.h} · ${window.fmtT(d)}`);
      } else if (mode === 'audiofx') {
        setOut(`输出：<b>${(cfg.outExt || '.mp3').slice(1).toUpperCase()}</b> · ${window.fmtT(d)}`);
      } else {
        setOut(`输出：<b>${S.ext.slice(1).toUpperCase()}</b> · ${m.w} × ${m.h} · ${window.fmtT(d)}`);
      }
    }
    host.addEventListener('input', update);
    host.addEventListener('change', update);
    host.addEventListener('click', e => {
      const a = e.target.closest('.aopt');
      if (a) {
        host.querySelectorAll('.aopt').forEach(x => x.classList.remove('on')); a.classList.add('on');
        S.audioFmt = a.dataset.f;
        const bw = $('#avBitwrap'); if (bw) bw.style.display = ['wav', 'flac'].includes(S.audioFmt) ? 'none' : '';
        update();
      }
      const o = e.target.closest('.optcard');
      if (o) { host.querySelectorAll('.optcard').forEach(x => x.classList.remove('on')); o.classList.add('on'); S.quality = o.dataset.q; update(); }
      const sh = e.target.closest('#avShapes .shape');
      if (sh) {
        host.querySelectorAll('#avShapes .shape').forEach(x => x.classList.remove('on')); sh.classList.add('on');
        S.shape = sh.dataset.r; applyShape(); update();
      }
      const rb = e.target.closest('#avRot .shape');
      if (rb) { host.querySelectorAll('#avRot .shape').forEach(x => x.classList.remove('on')); rb.classList.add('on'); S.rot = rb.dataset.r; update(); }
      const sp = e.target.closest('#avSpds .shape');
      if (sp) { S.speed = +sp.dataset.s; if ($('#avSpd')) { $('#avSpd').value = S.speed; $('#avSpdV').textContent = S.speed + '×'; } host.querySelectorAll('#avSpds .shape').forEach(x => x.classList.toggle('on', +x.dataset.s === S.speed)); update(); }
      if (e.target.closest('#cq1')) { S.sizeMode = false; $('#cq1').classList.add('on'); $('#cq2').classList.remove('on'); $('#cQual').classList.remove('hide'); $('#cSize').classList.add('hide'); update(); }
      if (e.target.closest('#cq2')) { S.sizeMode = true; $('#cq2').classList.add('on'); $('#cq1').classList.remove('on'); $('#cSize').classList.remove('hide'); $('#cQual').classList.add('hide'); update(); }
      const ck = e.target.closest('.chk');
      if (ck) {
        ck.classList.toggle('on');
        if (ck.id === 'avMute') S.mute = ck.classList.contains('on');
        if (ck.id === 'avRevAudio') S.revAudio = ck.classList.contains('on');
        if (ck.id === 'avFast') { S.fast = ck.classList.contains('on'); update(); }
      }
    });
    const sr = $('#avSpd');
    if (sr) sr.addEventListener('input', () => {
      S.speed = +sr.value; $('#avSpdV').textContent = (Math.round(S.speed * 100) / 100) + '×';
      const pct = (S.speed - .25) / 3.75 * 100;
      sr.style.background = `linear-gradient(to right,var(--lime) 0%,var(--lime) ${pct}%,var(--card3) ${pct}%)`;
      host.querySelectorAll('#avSpds .shape').forEach(x => x.classList.toggle('on', +x.dataset.s === S.speed)); update();
    });
    const gf = $('#gifFps');
    if (gf) gf.addEventListener('input', () => { $('#gifFpsV').textContent = gf.value; update(); });

    /* ---- 合并：多文件 ---- */
    if (mode === 'merge') {
      $('#mAdd').addEventListener('click', () => $('#avFile').click());
      $('#avFile').addEventListener('change', () => {
        const fs = [...$('#avFile').files];
        if (fs.length > 1) {
          S.extras = fs.slice(1);
          $('#avExtra').hidden = false;
          $('#avExtra').innerHTML = S.extras.map(x => `<div class="th"><div style="height:60px;display:flex;align-items:center;justify-content:center;font-size:11px;color:#8a8a8a">视频</div><span>${x.name.slice(0, 14)}</span></div>`).join('');
          $('#mList').textContent = (1 + S.extras.length) + ' 个片段待合并：' + [fs[0].name, ...S.extras.map(x => x.name)].join(' → ');
        }
      });
    }

    /* ---- 裁剪框 ---- */
    function initCrop() {
      const wrap = $('#avCropWrap'), box = $('#avCropBox');
      wrap.classList.remove('hide');
      const place = () => {
        box.style.left = '0'; box.style.top = '0'; box.style.width = '100%'; box.style.height = '100%';
        update();
      };
      setTimeout(place, 60);
      const video = $('#avVid');
      [['pointerdown', null]].forEach(() => { });
      box.addEventListener('pointerdown', e => {
        if (e.target.classList.contains('c')) return;
        const wr = wrap.getBoundingClientRect(), br = box.getBoundingClientRect();
        const sx = e.clientX, sy = e.clientY, l = br.left - wr.left, t = br.top - wr.top;
        const mv = ev => {
          box.style.left = Math.min(wr.width - br.width, Math.max(0, l + ev.clientX - sx)) + 'px';
          box.style.top = Math.min(wr.height - br.height, Math.max(0, t + ev.clientY - sy)) + 'px'; update();
        };
        const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); e.preventDefault();
      });
      wrap.querySelectorAll('.c').forEach(ch => ch.addEventListener('pointerdown', e => {
        const wr = wrap.getBoundingClientRect(), br = box.getBoundingClientRect();
        const cls = ch.className.replace('c ', '').trim();
        const sx = e.clientX, sy = e.clientY, st = { l: br.left - wr.left, t: br.top - wr.top, w: br.width, h: br.height };
        const ratio = (S.shape && S.shape !== 'free') ? eval('(' + S.shape + ')') : null;
        const mv = ev => {
          let dx = ev.clientX - sx, dy = ev.clientY - sy, l = st.l, t = st.t, w = st.w, h = st.h;
          if (cls.includes('br')) { w = st.w + dx; h = st.h + dy; }
          else if (cls.includes('bl')) { w = st.w - dx; h = st.h + dy; l = st.l + dx; }
          else if (cls.includes('tr')) { w = st.w + dx; h = st.h - dy; t = st.t + dy; }
          else { w = st.w - dx; h = st.h - dy; l = st.l + dx; t = st.t + dy; }
          if (ratio) { h = w / ratio; if (cls.includes('t')) t = st.t + (st.h - h); if (cls.includes('l')) l = st.l + (st.w - w); }
          w = Math.max(32, Math.min(w, wr.width)); h = Math.max(32, Math.min(h, wr.height));
          l = Math.max(0, Math.min(l, wr.width - w)); t = Math.max(0, Math.min(t, wr.height - h));
          box.style.left = l + 'px'; box.style.top = t + 'px'; box.style.width = w + 'px'; box.style.height = h + 'px'; update(); e.preventDefault();
        };
        const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
      }));
    }
    function applyShape() {
      const wrap = $('#avCropWrap'), box = $('#avCropBox');
      if (!wrap || wrap.classList.contains('hide')) return;
      const wr = wrap.getBoundingClientRect();
      if (!S.shape || S.shape === 'free') { box.style.left = '0'; box.style.top = '0'; box.style.width = '100%'; box.style.height = '100%'; update(); return; }
      const r = eval('(' + S.shape + ')');
      let w = wr.width * 0.8, h = w / r;
      if (h > wr.height * 0.9) { h = wr.height * 0.9; w = h * r; }
      box.style.left = ((wr.width - w) / 2) + 'px'; box.style.top = ((wr.height - h) / 2) + 'px';
      box.style.width = w + 'px'; box.style.height = h + 'px';
      update();
    }
    function cropRect() {
      const wrap = $('#avCropWrap'), box = $('#avCropBox');
      if (!wrap || wrap.classList.contains('hide')) return { x: 0, y: 0, w: S.meta.w, h: S.meta.h };
      const wr = wrap.getBoundingClientRect(), br = box.getBoundingClientRect();
      if (!wr.width || !br.width) return { x: 0, y: 0, w: S.meta.w, h: S.meta.h };
      const sc = S.meta.w / wr.width;
      return {
        x: Math.max(0, Math.round((br.left - wr.left) * sc)), y: Math.max(0, Math.round((br.top - wr.top) * sc)),
        w: Math.round(br.width * sc), h: Math.round(br.height * sc)
      };
    }

    /* ---- 时间轴（trim / togif）---- */
    function buildFilm() {
      const film = $('#avFilm'); if (!film) return;
      film.classList.remove('hide'); $('#avTrimRow').classList.remove('hide');
      const strip = $('#avStrip');
      const N = 10, c = document.createElement('canvas');
      const sc = 160 / (S.meta.w || 160);
      c.width = 160; c.height = Math.max(40, Math.round((S.meta.h || 90) * sc));
      const tmp = document.createElement('video'); tmp.src = S.url; tmp.muted = true; tmp.preload = 'auto';
      let i = 0;
      const grab = () => {
        if (i >= N) { tmp.src = ''; place(); return; }
        tmp.currentTime = (i + .5) * S.meta.duration / N;
        tmp.onseeked = () => { c.getContext('2d').drawImage(tmp, 0, 0, c.width, c.height); const im = document.createElement('img'); im.src = c.toDataURL('image/jpeg', .6); strip.appendChild(im); i++; grab(); };
      };
      tmp.onloadeddata = grab;
      function place() {
        const w = film.getBoundingClientRect().width;
        const a = parseT($('#avStart')?.value) ?? 0, b = parseT($('#avEnd')?.value) ?? S.meta.duration;
        const p1 = Math.max(0, Math.min(1, a / S.meta.duration)) * w, p2 = Math.max(0, Math.min(1, b / S.meta.duration)) * w;
        $('#avHL').style.left = (p1 - 7) + 'px'; $('#avHR').style.left = (p2 - 7) + 'px';
        $('#avShadeL').style.width = p1 + 'px'; $('#avShadeR').style.width = (w - p2) + 'px';
        update();
      }
      let drag = null;
      const pos = e => {
        const r = film.getBoundingClientRect();
        const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
        return Math.min(1, Math.max(0, x / r.width)) * S.meta.duration;
      };
      film.addEventListener('pointerdown', e => {
        const h = e.target.closest('.handle'); if (!h) return;
        drag = h.id === 'avHL' ? 'L' : 'R'; e.preventDefault();
      });
      window.addEventListener('pointermove', e => {
        if (!drag) return;
        const t = pos(e);
        const a = parseT($('#avStart').value) ?? 0, b = parseT($('#avEnd').value) ?? S.meta.duration;
        if (drag === 'L') $('#avStart').value = window.fmtT(Math.min(t, b - .1), true);
        else $('#avEnd').value = window.fmtT(Math.max(t, a + .1), true);
        place();
      });
      window.addEventListener('pointerup', () => drag = null);
      $('#avStart')?.addEventListener('change', place);
      $('#avEnd')?.addEventListener('change', place);
      $('#avPlaySel')?.addEventListener('click', () => {
        const v = $('#avVid'), a = parseT($('#avStart').value) ?? 0, b = parseT($('#avEnd').value) ?? S.meta.duration;
        v.currentTime = a; v.play();
        const tv = () => { if (v.currentTime >= b) { v.pause(); v.removeEventListener('timeupdate', tv); } };
        v.addEventListener('timeupdate', tv);
      });
    }

    /* ---- 运行 ---- */
    $('#avRun').addEventListener('click', async () => {
      if (!S.file) { window.toast('请先选择文件'); return; }
      const btn = $('#avRun'); const label = btn.textContent;
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 处理中…';
      $('#avOut').innerHTML = '<b>正在加载视频引擎…</b>首次运行约需下载 32 MB，之后会缓存。';
      showProg(2);
      try {
        const ff = await getFF(p => { showProg(p); if (p > 3) $('#avOut').innerHTML = '编码中… <b>' + p + '%</b>'; });
        S.outName = null;
        const args = buildArgs(mode, cfg, S, S.meta, q);
        await ff.writeFile(S.inName, new Uint8Array(await S.file.arrayBuffer()));
        if (mode === 'merge' && S.extras.length) {
          for (let i = 0; i < S.extras.length; i++) {
            await ff.writeFile('part' + i + S.ext, new Uint8Array(await S.extras[i].arrayBuffer()));
          }
          await ff.exec(['-i', S.inName, ...S.extras.map((x, i) => ['-i', 'part' + i + S.ext]).flat(), '-filter_complex', `concat=n=${1 + S.extras.length}:v=1:a=1[v][a]`, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-crf', '22', '-preset', 'veryfast', ...audioArgs('aac', 128), S.outName = 'merged.mp4']);
          S.outMime = 'video/mp4';
        } else {
          await ff.exec(args);
        }
        const data = await ff.readFile(S.outName);
        await ff.deleteFile(S.inName).catch(() => { });
        const blob = new Blob([data.buffer || data], { type: S.outMime });
        hideProg();
        btn.disabled = false; btn.textContent = label;
        resultUI(blob, S.outName, S.outMime);
        await ff.deleteFile(S.outName).catch(() => { });
      } catch (err) {
        console.error(err);
        window.toast('出错了：' + (err.message || err));
        $('#avOut').innerHTML = '<b style="color:#ef4444">处理失败。</b> ' + (err.message || '');
        hideProg(); btn.disabled = false; btn.textContent = label;
      }
    });

    function resultUI(blob, name, mime) {
      const pane = $('#avPane');
      pane.innerHTML = `<div class="ptitle">完成</div><div class="pdesc">文件已就绪，始终保存在本机。</div>
        <div class="resultbox">
          <div class="row"><span>文件</span><b>${name}</b></div>
          <div class="row"><span>格式</span><b>${(mime.split('/')[1] || '').toUpperCase()}</b></div>
          <div class="row"><span>大小</span><b>${window.fmtSize(blob.size)}</b></div>
          <div class="row"><span>原始大小</span><b>${window.fmtSize(S.file.size)}</b></div>
          <div class="saved">${blob.size < S.file.size ? '▼ 比原文件小 ' + (100 - blob.size / S.file.size * 100).toFixed(0) + '%。' : '输出完成。'}</div>
        </div>
        <button class="btn-lime btn-run" id="avDl">下载</button>
        <span class="linkbtn" id="avBack">← 返回设置</span>`;
      $('#avDl').addEventListener('click', () => window.downloadBlob(blob, name));
      $('#avBack').addEventListener('click', () => { pane.innerHTML = paneFor(mode, cfg, {}); location.reload(); });
      const v = $('#avVid');
      if (mime.startsWith('video')) { v.src = URL.createObjectURL(blob); v.play().catch(() => { }); }
      else if (mime.startsWith('audio')) {
        const au = document.createElement('audio'); au.controls = true; au.src = URL.createObjectURL(blob);
        au.style.width = '100%'; au.style.marginTop = '16px';
        const stage = host.querySelector('.stage'); stage.appendChild(au);
      } else if (mime === 'image/gif') {
        const im = document.createElement('img'); im.src = URL.createObjectURL(blob); im.style.maxWidth = '100%';
        const stage = host.querySelector('.stage'); stage.appendChild(im);
      }
    }

    // 初始输出提示
    setOut('输出：—');
  };
})();
