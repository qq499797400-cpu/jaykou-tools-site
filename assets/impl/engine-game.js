/* ==========================================================================
   engine-game.js — 游戏 / 模拟 / 小工具 引擎
   覆盖工具（按 slug 分发，正则回退）：

   A 真游戏：snake-game, 2048, minesweeper, sudoku, chess, solitaire,
             pinball(online-pinball/pinball-game), block-puzzle,
             word-guess-game(five-letter-word-game/daily-word-puzzle),
             bubble-popper(bubble-wrap-popper), online-piano, online-guitar,
             fidget-spinner(fidget-spinner-online), pop-it, spin-the-wheel,
             dice-roller, flip-a-coin, random-name-race, bar-chart-race-maker
   B 物理/粒子模拟：falling-sand-game/falling-sand-simulator, sand-simulator/
             sand-art/sand-painting-online, water-simulator, cloth-simulator/
             rope-cloth-simulator, smoke-simulator/fluid-smoke-simulator,
             ball-physics-simulator/bouncing-ball-simulator,
             gravity-orbit-simulator, solar-system-simulator,
             three-body-problem-simulator, galton-board, plinko-simulator,
             marble-race-simulator/marble-race-maker, domino-chain-reaction/
             chain-reaction-simulator, ragdoll-physics-game/ragdoll-playground,
             boids-simulator/flocking-simulator/bird-flock-simulation,
             cellular-automaton-simulator, conways-game-of-life/game-of-life,
             logic-circuit-simulator, corner-bounce-screensaver/dvd-screensaver,
             lava-lamp/lava-lamp-simulator, fireplace-screensaver/
             virtual-fireplace/campfire-simulator, rain-window/rain-on-window,
             snow-globe/snow-globe-online, screen-size-simulator/
             mobile-view-tester/responsive-tester
   C 计时/测量：stopwatch, online-timer/countdown-timer, pomodoro-timer,
             world-clock, keyboard-test, mouse-test, webcam-test, mic-test,
             speaker-test, screen-test, typing-test, 6502-assembler/
             6502-emulator, risc-v-assembler/riscv-simulator, chip8-emulator/
             chip-8-emulator, arduino-simulator/arduino-uno-simulator,
             dos-emulator/linux-emulator/pc-emulator/kolibrios-online/
             retro-console-player/handheld-console-player, online-python-compiler
   D 音频与录制：metronome（音频时钟排程 + 重音/细分/摇摆/复节奏/速度训练）,
             tuner（自相关音高检测 + 6 种乐器调弦 + 参考音）,
             white-noise（6 种噪声颜色 + 6 种环境音混音 + 睡眠定时器淡出）,
             voice-recorder（MediaRecorder + PCM 缓冲导出 WAV）,
             screen-recorder（getDisplayMedia + 摄像头画中画 + 音轨混音）
   E 视频生成 / 屏保：bouncing-ball-video-maker, countdown-video-maker
             （canvas.captureStream + MediaRecorder 实时录制，含合成音频）,
             bouncing-logo-screensaver（折返展开精确预测下一个撞角时刻 + Wake Lock）

   —— 共覆盖 build.mjs 路由到本引擎的 100 个 slug；未命中的 slug 走 ROUTES
      正则回退，仍未命中则退回 TUI.soon，绝不白屏。
   —— 所有音频由 Web Audio 实时合成，无任何外部资源；循环用 rAF + deltaTime，
      document.hidden 自动暂停，pagehide 时清理 rAF、AudioContext、
      MediaStream、MediaRecorder 与 Wake Lock。
   ========================================================================== */
(function () {
  'use strict';

  const E = {};
  window.TOOL_ENGINES = window.TOOL_ENGINES || {};
  const TUI = window.TUI;

  /* ---------------- 基础 ---------------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  // 控制条按钮（#gStart / #gPause / #gReset）在部分工具里被自定义按钮替代；
  // 取不到时返回惰性占位对象，避免抛错导致整个工具白屏（mount 会整体 try/catch）。
  const CTL_STUB = {
    textContent: '', value: '', innerHTML: '', disabled: false, style: {},
    classList: { add() { }, remove() { }, toggle() { }, contains() { return false; } },
    addEventListener() { }, appendChild() { }, click() { }, focus() { }
  };
  const ctlEl = s => $(s) || CTL_STUB;
  const esc = s => TUI.esc(s);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const ri = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
  const rf = (a, b) => a + Math.random() * (b - a);
  const pad2 = n => (n < 10 ? '0' : '') + n;
  const fmtClock = t => {
    t = Math.max(0, t);
    const m = Math.floor(t / 60), s = Math.floor(t % 60), d = Math.floor((t % 1) * 10);
    return pad2(m) + ':' + pad2(s) + '.' + d;
  };
  const fmtHMS = t => {
    t = Math.max(0, Math.floor(t));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return (h ? pad2(h) + ':' : '') + pad2(m) + ':' + pad2(s);
  };
  const el = (tag, cls, html) => { const d = document.createElement(tag); if (cls) d.className = cls; if (html != null) d.innerHTML = html; return d; };

  /* ---------------- 存档（wsft: 前缀，读时 try/catch） ---------------- */
  function save(k, v) { try { localStorage.setItem('wsft:' + k, JSON.stringify(v)); } catch (e) { } }
  function load(k, d) { try { const s = localStorage.getItem('wsft:' + k); return s == null ? d : JSON.parse(s); } catch (e) { return d; } }

  /* ---------------- 清理登记 ---------------- */
  const CLEAN = [], ACTS = [];
  function onClean(fn) { CLEAN.push(fn); }
  window.addEventListener('pagehide', function () {
    CLEAN.splice(0).forEach(f => { try { f(); } catch (e) { } });
    ACTS.forEach(c => { try { c.close(); } catch (e) { } });
  });

  /* ---------------- Web Audio ---------------- */
  let ACX = null;
  function ac() {
    if (ACX && ACX.state !== 'closed') { if (ACX.state === 'suspended') ACX.resume().catch(() => { }); return ACX; }
    try { ACX = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ACX = null; return null; }
    ACTS.push(ACX);
    return ACX;
  }
  function tone(freq, dur, type, vol, when) {
    const c = ac(); if (!c) return;
    const t0 = c.currentTime + (when || 0);
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t0);
    o.connect(g); g.connect(c.destination);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0003, vol || 0.18), t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.03, dur));
    o.start(t0); o.stop(t0 + Math.max(0.03, dur) + 0.03);
  }
  function noiseSound(dur, vol, freq, q) {
    const c = ac(); if (!c) return;
    const n = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 1.6);
    const src = c.createBufferSource(); src.buffer = buf;
    const g = c.createGain(); g.gain.value = vol || 0.15;
    if (freq) { const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q || 1; src.connect(f); f.connect(g); }
    else src.connect(g);
    g.connect(c.destination);
    src.start();
  }
  let audioUnlocked = false;
  function unlockAudio() { const c = ac(); if (c && c.state === 'suspended') c.resume().catch(() => { }); audioUnlocked = true; }
  window.addEventListener('pointerdown', unlockAudio); onClean(() => window.removeEventListener('pointerdown', unlockAudio));

  /* ---------------- canvas（适配 devicePixelRatio） ---------------- */
  function mkCanvas(parent, W, H) {
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');
    cv.style.display = 'block'; cv.style.maxWidth = '100%'; cv.style.touchAction = 'none';
    cv.style.background = '#0d0d0d'; cv.style.borderRadius = '10px';
    cv.width = W; cv.height = H;
    function layout() {
      const pw = parent.clientWidth || W;
      const avail = Math.max(180, pw - 26);
      const dispW = Math.min(W, avail);
      const dispH = Math.max(1, dispW * H / W);
      const d = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.max(1, Math.round(dispW * d));
      cv.height = Math.max(1, Math.round(dispH * d));
      cv.style.width = dispW + 'px'; cv.style.height = dispH + 'px';
      const s = cv.width / W;
      ctx.setTransform(s, 0, 0, s, 0, 0);
    }
    parent.appendChild(cv);
    layout();
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => layout());
      ro.observe(parent);
      onClean(() => ro.disconnect());
    } else {
      window.addEventListener('resize', layout);
      onClean(() => window.removeEventListener('resize', layout));
    }
    function pos(e) {
      const r = cv.getBoundingClientRect();
      const p = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
      return { x: (p.clientX - r.left) / r.width * W, y: (p.clientY - r.top) / r.height * H };
    }
    return { cv, ctx, W, H, pos, layout };
  }

  /* ---------------- 统一动画循环 ---------------- */
  function Loop(fn) {
    let raf = null, last = 0, running = false, auto = false;
    function step(t) {
      if (!running) return;
      let dt = (t - last) / 1000; last = t;
      if (!isFinite(dt) || dt < 0) dt = 0;
      if (dt > 0.05) dt = 0.05;
      try { fn(dt, t); } catch (e) { }
      raf = requestAnimationFrame(step);
    }
    const api = {
      start() { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(step); },
      stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = null; },
      toggle() { running ? api.stop() : api.start(); }
    };
    Object.defineProperty(api, 'running', { get: () => running });
    function vis() {
      if (document.hidden) { if (running) { auto = true; api.stop(); } }
      else if (auto) { auto = false; api.start(); }
    }
    document.addEventListener('visibilitychange', vis);
    onClean(() => { api.stop(); document.removeEventListener('visibilitychange', vis); });
    return api;
  }

  /* ---------------- 交互助手 ---------------- */
  function swipeOn(cv, cb) {
    let sx = 0, sy = 0;
    cv.addEventListener('touchstart', e => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; }, { passive: true });
    cv.addEventListener('touchend', e => {
      const t = e.changedTouches[0]; if (!t) return;
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) < 22 && Math.abs(dy) < 22) return;
      cb(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    }, { passive: true });
  }
  function ctrlRow(extra) {
    return `<div class="shapes" style="margin-top:12px;gap:8px">
      <button class="btn-lime btn-sm" id="gStart">开始</button>
      <button class="btn-ghost btn-sm" id="gPause">暂停</button>
      <button class="btn-ghost btn-sm" id="gReset">重开</button>${extra || ''}</div>`;
  }
  function bindCtrl(o) {
    const g = id => $(id);
    // 若页面没有提供标准控制条（有些工具用自定义按钮），就在 pane 末尾补出缺失的那几个，
    // 保证「开始 / 暂停 / 重开」这三个回调永远有地方可挂。
    const need = [];
    if (o.start && !g('#gStart')) need.push(['gStart', '开始']);
    if (o.pause && !g('#gPause')) need.push(['gPause', '暂停']);
    if (o.reset && !g('#gReset')) need.push(['gReset', '重开']);
    if (need.length) {
      const pane = $('.pane') || $('.stage');
      if (pane) pane.insertAdjacentHTML('beforeend',
        '<div class="shapes" style="margin-top:12px;gap:8px">' +
        need.map(n => '<button class="btn-lime btn-sm" id="' + n[0] + '">' + n[1] + '</button>').join('') + '</div>');
    }
    if (o.start && g('#gStart')) g('#gStart').addEventListener('click', o.start);
    if (o.pause && g('#gPause')) g('#gPause').addEventListener('click', o.pause);
    if (o.reset && g('#gReset')) g('#gReset').addEventListener('click', o.reset);
  }
  function scorebar(items) {
    return `<div class="scorebar">${items.map(it => `<span>${esc(it[0])} <b id="${it[1]}">${it[3] != null ? it[3] : '0'}</b></span>`).join('')}</div>`;
  }
  function paneBox(title, desc, body) {
    return `<div class="pane">${TUI.head(title, desc)}${body || ''}</div>`;
  }
  function bindRange(id, cb) {
    const r = $(id); if (!r) return;
    const v = $(id + 'V');
    const upd = () => { if (v) v.textContent = r.value; if (cb) cb(+r.value); };
    r.addEventListener('input', upd); upd();
  }
  function bindChk(sel, cb) {
    const c = $(sel); if (!c) return;
    c.addEventListener('click', () => { c.classList.toggle('on'); if (cb) cb(c.classList.contains('on')); });
    if (cb) cb(c.classList.contains('on'));
  }
  function bindPills(sel, cb) {
    const box = $(sel); if (!box) return;
    box.addEventListener('click', e => {
      const b = e.target.closest('.shape'); if (!b) return;
      $$('.shape', box).forEach(x => x.classList.remove('on'));
      b.classList.add('on'); if (cb) cb(b.dataset.v);
    });
  }
  function keys(map, opts) {
    const h = e => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      const fn = map[e.code] || map[e.key] || map[e.key.toLowerCase()];
      if (fn) { if (!(opts && opts.noPrevent)) e.preventDefault(); fn(e); }
    };
    window.addEventListener('keydown', h);
    onClean(() => window.removeEventListener('keydown', h));
  }
  function downloadText(name, text, mime) {
    window.downloadBlob(new Blob([text], { type: mime || 'text/plain;charset=utf-8' }), name);
  }
  function csvCell(v) { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function toCSV(rows) { return rows.map(r => r.map(csvCell).join(',')).join('\r\n'); }
  function pngOf(cv, name) { cv.toBlob(b => { if (b) window.downloadBlob(b, name); }); }

  const G = {};

  /* ==========================================================================
     A. 真游戏
     ========================================================================== */

  /* ---------------- 贪吃蛇 ---------------- */
  G['snake-game'] = function (host) {
    const COLS = 22, ROWS = 22, CELL = 22;
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          ${scorebar([['得分', 'snScore'], ['最高分', 'snBest'], ['等级', 'snLv']])}
          <div id="snWrap"></div>
          <div class="runnote" id="snMsg">按「开始」或任意方向键开始游戏。</div>
        </div>
      </div>
      ${paneBox('贪吃蛇', '方向键 / WASD / 在画面上滑动来控制。撞墙或咬到自己就结束。',
      ctrlRow() +
      TUI.field('初始速度（越快等级涨得越猛）', TUI.range('snSpeed', 1, 9, 4, 1)) +
      `<div class="plabel">穿墙模式</div>${TUI.chk('snWrapMode', '允许从墙的一侧穿到另一侧', false)}
      <div class="runnote">最高分会写入本机 localStorage（键 wsft:snake.best）。</div>`)}
    </div>`;
    const wrap = $('#snWrap');
    const C = mkCanvas(wrap, COLS * CELL, ROWS * CELL);
    let snake, dir, queue, food, score, alive, acc, lv, baseSpeed, wrapMode = false;
    const best = () => load('snake.best', 0);
    $('#snBest').textContent = best();
    bindRange('#snSpeed', () => { });
    bindChk('#snWrapMode', v => { wrapMode = v; });
    function reset() {
      snake = [{ x: 8, y: 11 }, { x: 7, y: 11 }, { x: 6, y: 11 }];
      dir = { x: 1, y: 0 }; queue = []; score = 0; alive = true; acc = 0; lv = 0;
      baseSpeed = Math.max(0.055, 0.19 - (+$('#snSpeed').value) * 0.014);
      placeFood();
      paint(); $('#snScore').textContent = '0'; $('#snLv').textContent = '1';
      $('#snMsg').textContent = '进行中…';
    }
    function placeFood() {
      let p, guard = 0;
      do { p = { x: ri(0, COLS - 1), y: ri(0, ROWS - 1) }; guard++; }
      while (snake.some(s => s.x === p.x && s.y === p.y) && guard < 900);
      food = p;
    }
    function turn(nx, ny) {
      const last = queue.length ? queue[queue.length - 1] : dir;
      if (last.x === -nx && last.y === -ny) return;
      if (last.x === nx && last.y === ny) return;
      if (queue.length < 2) queue.push({ x: nx, y: ny });
      if (!loop.running && alive) start();
    }
    function step() {
      if (queue.length) dir = queue.shift();
      const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
      if (wrapMode) { head.x = (head.x + COLS) % COLS; head.y = (head.y + ROWS) % ROWS; }
      if (head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS) return die();
      if (snake.some((s, i) => i < snake.length - 1 && s.x === head.x && s.y === head.y)) return die();
      snake.unshift(head);
      if (head.x === food.x && head.y === food.y) {
        score += 10; tone(660 + lv * 20, 0.08, 'square', 0.14); placeFood();
        lv = Math.floor(score / 50);
        $('#snScore').textContent = score; $('#snLv').textContent = lv + 1;
        if (score > best()) { save('snake.best', score); $('#snBest').textContent = score; }
      } else snake.pop();
    }
    function die() {
      alive = false; loop.stop();
      tone(200, 0.35, 'sawtooth', 0.2); noiseSound(0.3, 0.1, 400, 0.7);
      $('#snMsg').textContent = '游戏结束 — 得分 ' + score + '，点击「重开」再来一局。';
    }
    function paint() {
      const ctx = C.ctx;
      ctx.fillStyle = '#0d0d0d'; ctx.fillRect(0, 0, C.W, C.H);
      ctx.strokeStyle = '#161616'; ctx.lineWidth = 1;
      for (let x = 0; x <= COLS; x++) { ctx.beginPath(); ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, ROWS * CELL); ctx.stroke(); }
      for (let y = 0; y <= ROWS; y++) { ctx.beginPath(); ctx.moveTo(0, y * CELL); ctx.lineTo(COLS * CELL, y * CELL); ctx.stroke(); }
      ctx.fillStyle = '#d7f452';
      snake.forEach((s, i) => { ctx.globalAlpha = i === 0 ? 1 : 0.55 + 0.45 * (1 - i / snake.length); ctx.fillRect(s.x * CELL + 1, s.y * CELL + 1, CELL - 2, CELL - 2); });
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ff5f56';
      ctx.beginPath(); ctx.arc(food.x * CELL + CELL / 2, food.y * CELL + CELL / 2, CELL / 2 - 3, 0, Math.PI * 2); ctx.fill();
      if (!alive) { ctx.fillStyle = 'rgba(0,0,0,.62)'; ctx.fillRect(0, 0, C.W, C.H); ctx.fillStyle = '#fff'; ctx.font = '600 26px Inter,sans-serif'; ctx.textAlign = 'center'; ctx.fillText('游戏结束', C.W / 2, C.H / 2); }
    }
    const loop = Loop(dt => {
      if (!alive) return;
      acc += dt;
      const interval = Math.max(0.035, baseSpeed - lv * 0.008);
      while (acc >= interval) { acc -= interval; step(); if (!alive) break; }
      paint();
    });
    function start() { if (!alive) reset(); loop.start(); $('#snMsg').textContent = '进行中…'; }
    function pause() { loop.stop(); $('#snMsg').textContent = loop.running ? '进行中…' : '已暂停 — 按「开始」继续。'; }
    bindCtrl({ start, pause, reset: () => { loop.stop(); reset(); start(); } });
    keys({ ArrowUp: () => turn(0, -1), ArrowDown: () => turn(0, 1), ArrowLeft: () => turn(-1, 0), ArrowRight: () => turn(1, 0), w: () => turn(0, -1), s: () => turn(0, 1), a: () => turn(-1, 0), d: () => turn(1, 0), W: () => turn(0, -1), S: () => turn(0, 1), A: () => turn(-1, 0), D: () => turn(1, 0) });
    swipeOn(C.cv, d => ({ up: () => turn(0, -1), down: () => turn(0, 1), left: () => turn(-1, 0), right: () => turn(1, 0) }[d]()));
    reset();
  };

  /* ---------------- 2048 ---------------- */
  G['2048'] = function (host) {
    const N = 4, CELL = 92, GAP = 12;
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          ${scorebar([['得分', 't2Score'], ['最高分', 't2Best']])}
          <div id="t2Board" style="position:relative;background:#1a1a1a;border-radius:12px;padding:${GAP}px;width:${N * CELL + (N + 1) * GAP}px;max-width:100%;height:${N * CELL + (N + 1) * GAP}px;box-sizing:border-box;touch-action:none"></div>
          <div class="runnote" id="t2Msg">方向键 / WASD / 滑动。左右键操作，R 重开，U 撤销。</div>
        </div>
      </div>
      ${paneBox('2048', '把相同数字推到一起合并，凑出 2048。带一步撤销与最高分记录。',
      `<div class="shapes" style="margin-top:12px"><button class="btn-lime btn-sm" id="gStart">新游戏</button><button class="btn-ghost btn-sm" id="t2Undo">撤销一步</button><button class="btn-ghost btn-sm" id="t2ClearBest">清除最高分</button></div>
        <div class="plabel">棋盘尺寸</div>${TUI.sel('t2Size', [{ v: '4', t: '4 × 4（经典）' }, { v: '5', t: '5 × 5（更难）' }], '4')}
        <div class="runnote">撤销只回退一步（题目要求）。最高分键 wsft:2048.best。</div>`)}
    </div>`;
    const boardEl = $('#t2Board');
    let grid, tiles, nextId, score, undoSnap, over, size = 4;
    const colors = { 2: '#eee4da', 4: '#ede0c8', 8: '#f2b179', 16: '#f59563', 32: '#f67c5f', 64: '#f65e3b', 128: '#edcf72', 256: '#edcc61', 512: '#edc850', 1024: '#edc53f', 2048: '#edc22e' };
    const best = () => load('2048.best', 0);
    $('#t2Best').textContent = best();
    function layout() {
      boardEl.style.width = '100%';
      boardEl.style.maxWidth = (size * CELL + (size + 1) * GAP) + 'px';
      boardEl.style.height = boardEl.style.maxWidth;
    }
    function newGame() {
      size = +$('#t2Size').value;
      grid = []; for (let i = 0; i < size * size; i++) grid.push(0);
      tiles = []; nextId = 1; score = 0; undoSnap = null; over = false;
      layout(); spawn(); spawn(); render(); $('#t2Score').textContent = '0';
      $('#t2Msg').textContent = '进行中…';
    }
    function spawn() {
      const free = [];
      for (let i = 0; i < grid.length; i++) if (!grid[i]) free.push(i);
      if (!free.length) return;
      const idx = free[ri(0, free.length - 1)];
      const v = Math.random() < 0.9 ? 2 : 4;
      grid[idx] = v;
      tiles.push({ id: nextId++, v: v, i: idx, isNew: true });
    }
    function render(mergedIds) {
      boardEl.innerHTML = '';
      for (let i = 0; i < size * size; i++) {
        const x = i % size, y = Math.floor(i / size);
        const cellW = (boardEl.clientWidth - GAP * (size + 1)) / size;
        const bg = el('div');
        bg.style.cssText = 'position:absolute;border-radius:8px;background:#141414;left:' + (GAP + x * (cellW + GAP)) + 'px;top:' + (GAP + y * (cellW + GAP)) + 'px;width:' + cellW + 'px;height:' + cellW + 'px';
        boardEl.appendChild(bg);
      }
      const cellW = (boardEl.clientWidth - GAP * (size + 1)) / size;
      tiles.forEach(t => {
        const x = t.i % size, y = Math.floor(t.i / size);
        const d = el('div');
        const c = colors[t.v] || '#3c3a32';
        const dark = t.v <= 4;
        const fs = t.v >= 1024 ? cellW * 0.3 : t.v >= 128 ? cellW * 0.36 : cellW * 0.46;
        d.style.cssText = 'position:absolute;display:flex;align-items:center;justify-content:center;border-radius:8px;font-weight:800;transition:left .11s ease,top .11s ease;' +
          'left:' + (GAP + x * (cellW + GAP)) + 'px;top:' + (GAP + y * (cellW + GAP)) + 'px;width:' + cellW + 'px;height:' + cellW + 'px;' +
          'background:' + c + ';color:' + (dark ? '#4a4438' : '#fff') + ';font-size:' + fs + 'px;transform:scale(' + (t.isNew ? 0.2 : 1) + ')';
        d.textContent = t.v;
        boardEl.appendChild(d);
        if (t.isNew) requestAnimationFrame(() => { d.style.transform = 'scale(1)'; d.style.transition += ',transform .12s ease'; });
        if (mergedIds && mergedIds.indexOf(t.id) >= 0) { d.style.boxShadow = '0 0 0 3px #d7f452'; setTimeout(() => { d.style.boxShadow = 'none'; }, 130); }
      });
    }
    function snapshot() { undoSnap = { g: grid.slice(), t: tiles.map(t => ({ id: t.id, v: t.v, i: t.i })), s: score, n: nextId }; }
    function move(dir) {
      if (over) return;
      snapshot();
      const vec = { left: [0, -1], right: [0, 1], up: [-1, 0], down: [1, 0] }[dir];
      const [dy, dx] = vec;
      const before = grid.join(',');
      const merged = [];
      const line = [];
      for (let k = 0; k < size; k++) line.push(k);
      const order = (dx > 0 || dy > 0) ? line.slice().reverse() : line;
      const taken = {};
      function cellAt(cx, cy) { return cy * size + cx; }
      order.forEach(oy => {
        order.forEach(ox => {
          const x = dx ? (dx > 0 ? size - 1 - ox : ox) : ox;
          const y = dy ? (dy > 0 ? size - 1 - oy : oy) : oy;
          const i = cellAt(x, y);
          const v = grid[i];
          if (!v) return;
          let cx = x, cy = y;
          while (true) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= size || ny >= size) break;
            const ni = cellAt(nx, ny);
            if (grid[ni] === 0) { grid[ni] = v; grid[i] = 0; cx = nx; cy = ny; continue; }
            if (grid[ni] === v && !taken[ni]) {
              grid[ni] = v * 2; grid[i] = 0; taken[ni] = true; merged.push(v * 2);
              score += v * 2; cx = nx; cy = ny; break;
            }
            break;
          }
          // 重建 tile 位置（用 id 保持）
          const t = tiles.find(tt => tt.i === i);
          if (t) t.i = cellAt(cx, cy);
        });
      });
      if (grid.join(',') === before) { undoSnap = null; return false; }
      // 合并后清掉被吞掉的 tile
      const seen = {};
      const keep = [];
      merged.forEach(() => { });
      const newTiles = [];
      grid.forEach((v, i) => { if (v) { const t = tiles.find(tt => tt.i === i); if (t) { t.v = v; if (!seen[t.id]) { seen[t.id] = 1; newTiles.push(t); } } } });
      // 补：合并产生的重复 id 已被去除；再补回丢失的 tile（如果某格有值但没 tile）
      grid.forEach((v, i) => { if (v && !newTiles.some(t => t.i === i)) newTiles.push({ id: nextId++, v: v, i: i }); });
      tiles = newTiles;
      const mergedIds = [];
      merged.forEach(mv => { const t = tiles.find(tt => tt.v === mv && !mergedIds.includes(tt.id)); if (t) mergedIds.push(t.id); });
      spawn();
      tiles.forEach(t => t.isNew = false);
      render(mergedIds);
      $('#t2Score').textContent = score;
      if (score > best()) { save('2048.best', score); $('#t2Best').textContent = score; }
      if (merged.length) tone(520, 0.06, 'triangle', 0.12);
      checkOver();
      return true;
    }
    function checkOver() {
      if (grid.some(v => v === 0)) return false;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const i = y * size + x;
        if (x + 1 < size && grid[i] === grid[i + 1]) return false;
        if (y + 1 < size && grid[i] === grid[i + size]) return false;
      }
      over = true; $('#t2Msg').textContent = '无法继续了 — 最终得分 ' + score + '。';
      tone(180, 0.4, 'sawtooth', 0.18);
      return true;
    }
    function undo() {
      if (!undoSnap) { window.toast('没有可撤销的一步'); return; }
      grid = undoSnap.g.slice(); tiles = undoSnap.t.map(t => ({ id: t.id, v: t.v, i: t.i })); score = undoSnap.s; nextId = undoSnap.n;
      undoSnap = null; over = false; render(); $('#t2Score').textContent = score; $('#t2Msg').textContent = '已撤销上一步。';
    }
    keys({ ArrowLeft: () => move('left'), ArrowRight: () => move('right'), ArrowUp: () => move('up'), ArrowDown: () => move('down'), a: () => move('left'), d: () => move('right'), w: () => move('up'), s: () => move('down'), A: () => move('left'), D: () => move('right'), W: () => move('up'), S: () => move('down'), r: newGame, R: newGame, u: undo, U: undo });
    swipeOn(boardEl, d => move(d));
    $('#t2Undo').addEventListener('click', undo);
    $('#t2ClearBest').addEventListener('click', () => { save('2048.best', 0); $('#t2Best').textContent = '0'; });
    ctlEl('#gStart').addEventListener('click', newGame);
    $('#t2Size').addEventListener('change', newGame);
    window.addEventListener('resize', () => { if (tiles) render(); });
    newGame();
  };

  /* ---------------- 扫雷 ---------------- */
  G['minesweeper'] = function (host) {
    const LEVELS = { easy: { w: 9, h: 9, m: 10, t: '初级 9×9 / 10 雷' }, medium: { w: 16, h: 16, m: 40, t: '中级 16×16 / 40 雷' }, hard: { w: 30, h: 16, m: 99, t: '高级 30×16 / 99 雷' }, custom: { w: 12, h: 12, m: 20, t: '自定义' } };
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          ${scorebar([['剩余雷数', 'msMines'], ['计时', 'msTime'], ['状态', 'msState', null, '待开始']])}
          <div id="msBoard" style="display:grid;gap:2px;user-select:none"></div>
          <div class="runnote">左键翻开 · 右键插旗 · 双击数字可快速展开相邻格（首点保证安全）。</div>
        </div>
      </div>
      ${paneBox('扫雷', '三种难度预设 + 自定义。首点安全，支持插旗与和弦展开。',
      `<div class="plabel">难度</div>${TUI.sel('msLevel', Object.keys(LEVELS).map(k => ({ v: k, t: LEVELS[k].t })), 'easy')}
        <div id="msCustom" style="display:none">${TUI.field('宽 × 高 × 雷数', `<div class="fieldrow" style="gap:8px"><input type="number" id="msW" value="12"><input type="number" id="msH" value="12"><input type="number" id="msM" value="20"></div>`)}</div>
        ${ctrlRow()}
        <div class="runnote">双击（或双指轻点）已翻开的数字格，可在周围旗数正确时一次性展开。</div>`)}
    </div>`;
    const boardEl = $('#msBoard');
    let W, H, M, cells, started, dead, won, flags, opened, timerId, secs, firstSafe;
    function cfg() { const l = $('#msLevel').value; if (l === 'custom') return { w: clamp(+$('#msW').value || 12, 5, 40), h: clamp(+$('#msH').value || 12, 5, 30), m: clamp(+$('#msM').value || 20, 1, 400) }; return LEVELS[l]; }
    function reset() {
      const c = cfg(); W = c.w; H = c.h; M = Math.min(c.m, W * H - 9);
      cells = []; started = false; dead = false; won = false; flags = 0; opened = 0; secs = 0; firstSafe = true;
      clearInterval(timerId);
      for (let i = 0; i < W * H; i++) cells.push({ mine: false, open: false, flag: false, n: 0 });
      boardEl.style.gridTemplateColumns = 'repeat(' + W + ',var(--msCell,' + Math.max(20, Math.min(34, Math.floor(560 / W))) + 'px))';
      boardEl.innerHTML = cells.map((c2, i) => `<div data-i="${i}" style="width:100%;aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${Math.max(11, Math.floor(560 / W * 0.55))}px;border-radius:4px;background:#2a2a2a;cursor:pointer;box-sizing:border-box"></div>`).join('');
      $('#msMines').textContent = M; $('#msTime').textContent = '0'; $('#msState').textContent = '待开始';
      paint();
    }
    function idx(x, y) { return y * W + x; }
    function place(safe) {
      const forbid = {};
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = safe % W + dx, y = Math.floor(safe / W) + dy;
        if (x >= 0 && y >= 0 && x < W && y < H) forbid[idx(x, y)] = 1;
      }
      let placed = 0, guard = 0;
      while (placed < M && guard++ < 100000) {
        const i = ri(0, W * H - 1);
        if (cells[i].mine || forbid[i]) continue;
        cells[i].mine = true; placed++;
      }
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let n = 0;
        forNeighbors(x, y, (nx, ny) => { if (cells[idx(nx, ny)].mine) n++; });
        cells[idx(x, y)].n = n;
      }
    }
    function forNeighbors(x, y, cb) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H) cb(nx, ny);
      }
    }
    function open(i) {
      const c = cells[i];
      if (c.open || c.flag || dead || won) return;
      if (!started) { started = true; place(i); startTimer(); $('#msState').textContent = '进行中'; }
      c.open = true; opened++;
      if (c.mine) { dead = true; c.hit = true; endGame(false); return; }
      if (c.n === 0) {
        const x = i % W, y = Math.floor(i / W);
        forNeighbors(x, y, (nx, ny) => { const ni = idx(nx, ny); if (!cells[ni].open) open(ni); });
      }
      checkWin();
    }
    function chord(i) {
      const c = cells[i];
      if (!c.open || !c.n) return;
      const x = i % W, y = Math.floor(i / W);
      let f = 0;
      forNeighbors(x, y, (nx, ny) => { if (cells[idx(nx, ny)].flag) f++; });
      if (f !== c.n) return;
      forNeighbors(x, y, (nx, ny) => { const ni = idx(nx, ny); if (!cells[ni].flag && !cells[ni].open) open(ni); });
    }
    function flag(i) {
      const c = cells[i];
      if (c.open || dead || won) return;
      c.flag = !c.flag; flags += c.flag ? 1 : -1;
      $('#msMines').textContent = M - flags;
      tone(c.flag ? 880 : 440, 0.05, 'square', 0.1);
      paint();
    }
    function checkWin() {
      if (opened === W * H - M) { won = true; endGame(true); }
    }
    function endGame(win) {
      clearInterval(timerId);
      cells.forEach(c => { if (c.mine) c.open = true; });
      $('#msState').textContent = win ? '通关！' : '踩雷了';
      if (win) { tone(660, 0.12, 'triangle', 0.16); tone(880, 0.18, 'triangle', 0.16, 0.12); }
      else { tone(160, 0.4, 'sawtooth', 0.2); }
      const b = load('minesweeper.best', {});
      const key = W + 'x' + H + 'x' + M;
      if (win && (!b[key] || secs < b[key])) { b[key] = secs; save('minesweeper.best', b); window.toast('新纪录：' + secs + ' 秒'); }
      paint();
    }
    function startTimer() {
      clearInterval(timerId);
      timerId = setInterval(() => { secs++; $('#msTime').textContent = secs; }, 1000);
      onClean(() => clearInterval(timerId));
    }
    const numColor = ['', '#7ea6ff', '#4fd08a', '#ff7b7b', '#c08bff', '#ffb457', '#4fd8d8', '#e5e5e5', '#b0b0b0'];
    function paint() {
      cells.forEach((c, i) => {
        const d = boardEl.children[i]; if (!d) return;
        let txt = '', bg = '#2a2a2a', col = '#e5e5e5';
        if (c.open) {
          bg = c.mine ? (c.hit ? '#7a1f1f' : '#3a2020') : '#141414';
          if (c.mine) { txt = '✸'; col = '#ff5f56'; }
          else if (c.n) { txt = c.n; col = numColor[c.n]; }
        } else if (c.flag) { txt = '⚑'; col = '#d7f452'; bg = '#2f2f22'; }
        d.textContent = txt; d.style.background = bg; d.style.color = col;
      });
    }
    boardEl.addEventListener('contextmenu', e => {
      const d = e.target.closest('[data-i]'); if (!d) return;
      e.preventDefault(); flag(+d.dataset.i);
    });
    boardEl.addEventListener('click', e => {
      const d = e.target.closest('[data-i]'); if (!d) return;
      unlockAudio();
      const i = +d.dataset.i;
      if (cells[i].open) { chord(i); paint(); checkWin(); if (dead) paint(); }
      else { open(i); paint(); }
    });
    boardEl.addEventListener('dblclick', e => { const d = e.target.closest('[data-i]'); if (d) { chord(+d.dataset.i); paint(); } });
    $('#msLevel').addEventListener('change', () => { $('#msCustom').style.display = $('#msLevel').value === 'custom' ? 'block' : 'none'; reset(); });
    bindCtrl({ start: () => { }, pause: () => { clearInterval(timerId); $('#msState').textContent = '已暂停'; }, reset: reset });
    ctlEl('#gStart').textContent = '重新计时';
    reset();
  };

  /* ---------------- 数独（保证唯一解） ---------------- */
  G['sudoku'] = function (host) {
    const LEVELS = { easy: 45, medium: 36, hard: 30, expert: 25 };
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          ${scorebar([['提示已用', 'sdHints'], ['已填', 'sdFilled'], ['计时', 'sdTime']])}
          <div id="sdGrid" style="display:grid;grid-template-columns:repeat(9,minmax(0,1fr));gap:2px;width:min(100%,468px);background:#3a3a3a;padding:3px;border-radius:10px;user-select:none"></div>
          <div id="sdNumpad" class="shapes" style="justify-content:center;max-width:468px"></div>
        </div>
      </div>
      ${paneBox('数独', '生成器保证题目有唯一解。可标注候选数、求提示、随时校验。',
      `<div class="plabel">难度</div>${TUI.sel('sdLevel', [{ v: 'easy', t: '入门（45 个已知数）' }, { v: 'medium', t: '中等（36 个）' }, { v: 'hard', t: '困难（30 个）' }, { v: 'expert', t: '专家（25 个）' }], 'medium')}
        <div class="shapes" style="margin-top:12px;gap:8px">
          <button class="btn-lime btn-sm" id="gStart">新题</button>
          <button class="btn-ghost btn-sm" id="sdHint">提示一格</button>
          <button class="btn-ghost btn-sm" id="sdCheck">校验</button>
          <button class="btn-ghost btn-sm" id="sdPencil">候选数模式</button>
        </div>
        <div class="outbox" id="sdOut">点击格子后用键盘 1–9 或右侧数字键盘填数；Backspace / 0 清除。</div>
        <div class="runnote">唯一解由「填到 2 个解就提前退出」的回溯验证器保证。</div>`)}
    </div>`;
    const gridEl = $('#sdGrid');
    let puzzle, solution, board, notes, sel = -1, pencil = false, hints = 0, secs = 0, timerId = null, fixed, ready = false;
    const padEl = $('#sdNumpad');
    padEl.innerHTML = [1, 2, 3, 4, 5, 6, 7, 8, 9, 'clear'].map(v => `<button class="shape" data-n="${v}">${v === 'clear' ? '清空' : v}</button>`).join('');

    function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = ri(0, i); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
    function okCell(g, i, v) {
      const r = Math.floor(i / 9), c = i % 9;
      for (let k = 0; k < 9; k++) { if (g[r * 9 + k] === v) return false; if (g[k * 9 + c] === v) return false; }
      const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
      for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) if (g[(br + y) * 9 + bc + x] === v) return false;
      return true;
    }
    function fillFull(g) {
      const i = g.indexOf(0);
      if (i < 0) return true;
      const cand = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      for (let k = 0; k < 9; k++) { if (okCell(g, i, cand[k])) { g[i] = cand[k]; if (fillFull(g)) return true; g[i] = 0; } }
      return false;
    }
    function countSolutions(g, limit) {
      const rows = new Array(9).fill(0), cols = new Array(9).fill(0), boxes = new Array(9).fill(0);
      for (let i = 0; i < 81; i++) { const v = g[i]; if (v) { const bit = 1 << v; rows[Math.floor(i / 9)] |= bit; cols[i % 9] |= bit; boxes[Math.floor(Math.floor(i / 9) / 3) * 3 + Math.floor((i % 9) / 3)] |= bit; } }
      let count = 0;
      const g2 = g.slice();
      function rec() {
        if (count >= limit) return;
        let best = -1, bestMask = 0, bestCnt = 99;
        for (let i = 0; i < 81; i++) {
          if (g2[i]) continue;
          const r = Math.floor(i / 9), c = i % 9, b = Math.floor(r / 3) * 3 + Math.floor(c / 3);
          const mask = (~(rows[r] | cols[c] | boxes[b])) & 0x3FE;
          let cnt = 0, m = mask;
          while (m) { m &= m - 1; cnt++; }
          if (cnt === 0) return;
          if (cnt < bestCnt) { bestCnt = cnt; best = i; bestMask = mask; if (cnt === 1) break; }
        }
        if (best < 0) { count++; return; }
        const r = Math.floor(best / 9), c = best % 9, b = Math.floor(r / 3) * 3 + Math.floor(c / 3);
        let m = bestMask;
        while (m) {
          const bit = m & -m; m ^= bit;
          const v = Math.log2(bit) | 0;
          g2[best] = v; rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
          rec();
          g2[best] = 0; rows[r] &= ~bit; cols[c] &= ~bit; boxes[b] &= ~bit;
          if (count >= limit) return;
        }
      }
      rec();
      return count;
    }
    function makePuzzle(clues) {
      const full = new Array(81).fill(0); fillFull(full);
      const p = full.slice();
      const order = shuffle(Array.from({ length: 81 }, (_, i) => i));
      let filled = 81;
      for (let k = 0; k < order.length && filled > clues; k++) {
        const i = order[k];
        const bak = p[i];
        p[i] = 0;
        if (countSolutions(p, 2) !== 1) p[i] = bak; else filled--;
      }
      return { puzzle: p, solution: full, filled: filled };
    }
    window.__wsftInternals = window.__wsftInternals || {};
    window.__wsftInternals.sudoku = { make: makePuzzle, count: countSolutions, ok: okCell };
    function newGame() {
      ready = false;
      $('#sdOut').textContent = '正在生成唯一解题…';
      setTimeout(() => {
        const gen = makePuzzle(LEVELS[$('#sdLevel').value]);
        puzzle = gen.puzzle; solution = gen.solution;
        board = puzzle.slice(); notes = Array.from({ length: 81 }, () => []);
        fixed = puzzle.map(v => v > 0); sel = -1; hints = 0; secs = 0; pencil = false;
        ready = true;
        $('#sdHints').textContent = '0'; $('#sdTime').textContent = '0:00'; $('#sdPencil').classList.remove('on');
        clearInterval(timerId);
        timerId = setInterval(() => { secs++; $('#sdTime').textContent = Math.floor(secs / 60) + ':' + pad2(secs % 60); }, 1000);
        onClean(() => clearInterval(timerId));
        paint(); updateFilled();
        $('#sdOut').textContent = '题目已生成（' + gen.filled + ' 个已知数，唯一解已验证）。';
      }, 16);
    }
    function updateFilled() {
      let n = 0; for (let i = 0; i < 81; i++) if (board[i]) n++;
      $('#sdFilled').textContent = n;
    }
    function paint() {
      if (!ready) { gridEl.innerHTML = ''; return; }
      gridEl.innerHTML = board.map((v, i) => {
        const r = Math.floor(i / 9), c = i % 9;
        const bTop = r % 3 === 0 && r !== 0, bLeft = c % 3 === 0 && c !== 0;
        let bg = fixed[i] ? '#1b1b1b' : '#141414';
        if (i === sel) bg = '#2b3312';
        const wrong = v && board[i] !== solution[i] && !fixed[i];
        const noteHtml = (!v && notes[i].length) ? `<span style="font-size:9px;line-height:1;color:#8a8a8a;display:grid;grid-template-columns:repeat(3,1fr);width:100%;height:100%;place-items:center">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => notes[i].includes(n) ? n : '').map(t => `<span>${t}</span>`).join('')}</span>` : '';
        return `<div data-i="${i}" style="position:relative;display:flex;align-items:center;justify-content:center;aspect-ratio:1;background:${bg};border-radius:5px;cursor:pointer;` +
          `border-left:${bLeft ? '2px solid #4a4a4a' : 'none'};border-top:${bTop ? '2px solid #4a4a4a' : 'none'};` +
          `font-size:min(5.5vw,24px);font-weight:${fixed[i] ? '750' : '600'};color:${fixed[i] ? '#e5e5e5' : (wrong ? '#ff6b6b' : '#d7f452')}">${v ? v : ''}${noteHtml}</div>`;
      }).join('');
    }
    function togglePencil() { pencil = !pencil; $('#sdPencil').classList.toggle('on', pencil); $('#sdOut').textContent = pencil ? '候选数模式：输入的数字会作为小候选标记。' : '填数模式。'; }
    function type(n) {
      if (!ready) { window.toast('题目正在生成…'); return; }
      if (sel < 0) { window.toast('先点一个格子'); return; }
      if (fixed[sel]) { window.toast('这是题面给出的数字'); return; }
      if (pencil && n) {
        const k = notes[sel].indexOf(n);
        if (k < 0) notes[sel].push(n); else notes[sel].splice(k, 1);
        notes[sel].sort();
      } else {
        board[sel] = n;
        if (n) notes[sel] = [];
        if (n && n !== solution[sel]) { tone(220, 0.12, 'sawtooth', 0.12); }
        else if (n) tone(720, 0.06, 'triangle', 0.1);
      }
      paint(); updateFilled(); checkDone();
    }
    function checkDone() {
      for (let i = 0; i < 81; i++) if (board[i] !== solution[i]) return;
      clearInterval(timerId);
      tone(660, 0.1, 'triangle', 0.16); tone(880, 0.12, 'triangle', 0.16, 0.1); tone(1100, 0.18, 'triangle', 0.16, 0.2);
      $('#sdOut').innerHTML = '<b style="color:#d7f452">完成！用时 ' + Math.floor(secs / 60) + ' 分 ' + (secs % 60) + ' 秒，用了 ' + hints + ' 次提示。</b>';
    }
    gridEl.addEventListener('click', e => {
      const d = e.target.closest('[data-i]'); if (!d) return;
      unlockAudio(); sel = +d.dataset.i; paint();
    });
    padEl.addEventListener('click', e => {
      const b = e.target.closest('[data-n]'); if (!b) return;
      type(b.dataset.n === 'clear' ? 0 : +b.dataset.n);
    });
    keys({ '1': () => type(1), '2': () => type(2), '3': () => type(3), '4': () => type(4), '5': () => type(5), '6': () => type(6), '7': () => type(7), '8': () => type(8), '9': () => type(9), Backspace: () => type(0), Delete: () => type(0), '0': () => type(0) });
    $('#sdPencil').addEventListener('click', togglePencil);
    $('#sdHint').addEventListener('click', () => {
      if (!ready) { window.toast('题目正在生成…'); return; }
      const empty = []; for (let i = 0; i < 81; i++) if (board[i] !== solution[i]) empty.push(i);
      if (!empty.length) return;
      const i = empty[ri(0, empty.length - 1)];
      board[i] = solution[i]; notes[i] = []; hints++; $('#sdHints').textContent = hints;
      sel = i; paint(); updateFilled(); checkDone();
    });
    $('#sdCheck').addEventListener('click', () => {
      if (!ready) { window.toast('题目正在生成…'); return; }
      let wrong = 0, empty = 0;
      for (let i = 0; i < 81; i++) { if (!board[i]) empty++; else if (board[i] !== solution[i]) wrong++; }
      $('#sdOut').innerHTML = wrong ? '<b style="color:#ff6b6b">发现 ' + wrong + ' 处错误</b>，还有 ' + empty + ' 格未填。' : (empty ? '目前填的都对，还剩 ' + empty + ' 格。' : '全部正确！');
      paint();
    });
    $('#sdLevel').addEventListener('change', newGame);
    ctlEl('#gStart').addEventListener('click', newGame);
    newGame();
  };

  /* ---------------- 国际象棋 ---------------- */
  G['chess'] = function (host) {
    const CH = (function () {
      const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
      const PST = {
        p: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
        n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
        b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
        r: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
        q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
        k: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20]
      };
      const KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
      const BD = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
      const RD = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      const KD = RD.concat(BD);
      function start() {
        const b = 'rnbqkbnr'.split('').concat('pppppppp'.split('')).concat(new Array(32).fill(null)).concat('PPPPPPPP'.split('')).concat('RNBQKBNR'.split(''));
        return { board: b, turn: 'w', castling: { K: true, Q: true, k: true, q: true }, ep: -1, half: 0, full: 1 };
      }
      function clone(st) { return { board: st.board.slice(), turn: st.turn, castling: { K: st.castling.K, Q: st.castling.Q, k: st.castling.k, q: st.castling.q }, ep: st.ep, half: st.half, full: st.full }; }
      const col = p => (!p ? null : (p === p.toUpperCase() ? 'w' : 'b'));
      const other = c => c === 'w' ? 'b' : 'w';
      function pseudo(st, c) {
        const out = [], b = st.board;
        for (let i = 0; i < 64; i++) {
          const p = b[i]; if (!p || col(p) !== c) continue;
          const r = i >> 3, f = i & 7, u = p.toUpperCase();
          if (u === 'P') {
            const dr = c === 'w' ? -1 : 1, startR = c === 'w' ? 6 : 1, promoR = c === 'w' ? 0 : 7;
            const r1 = r + dr;
            if (r1 >= 0 && r1 < 8 && !b[r1 * 8 + f]) {
              if (r1 === promoR) ['q', 'r', 'b', 'n'].forEach(pr => out.push({ from: i, to: r1 * 8 + f, promo: pr }));
              else {
                out.push({ from: i, to: r1 * 8 + f });
                const r2 = r + 2 * dr;
                if (r === startR && !b[r2 * 8 + f]) out.push({ from: i, to: r2 * 8 + f, double: true });
              }
            }
            [-1, 1].forEach(df => {
              const nf = f + df; if (nf < 0 || nf > 7 || r1 < 0 || r1 > 7) return;
              const ni = r1 * 8 + nf, tp = b[ni];
              if (tp && col(tp) !== c) {
                if (r1 === promoR) ['q', 'r', 'b', 'n'].forEach(pr => out.push({ from: i, to: ni, promo: pr, cap: true }));
                else out.push({ from: i, to: ni, cap: true });
              } else if (!tp && ni === st.ep) out.push({ from: i, to: ni, cap: true, ep: true });
            });
          } else if (u === 'N') {
            KN.forEach(d => { const nr = r + d[0], nf = f + d[1]; if (nr < 0 || nr > 7 || nf < 0 || nf > 7) return; const tp = b[nr * 8 + nf]; if (!tp || col(tp) !== c) out.push({ from: i, to: nr * 8 + nf, cap: !!tp }); });
          } else if (u === 'K') {
            KD.forEach(d => { const nr = r + d[0], nf = f + d[1]; if (nr < 0 || nr > 7 || nf < 0 || nf > 7) return; const tp = b[nr * 8 + nf]; if (!tp || col(tp) !== c) out.push({ from: i, to: nr * 8 + nf, cap: !!tp }); });
            const homeR = c === 'w' ? 7 : 0;
            if (r === homeR && f === 4) {
              const rk = c === 'w' ? st.castling.K : st.castling.k, rq = c === 'w' ? st.castling.Q : st.castling.q;
              if (rk && !b[homeR * 8 + 5] && !b[homeR * 8 + 6]) out.push({ from: i, to: homeR * 8 + 6, castle: 'K' });
              if (rq && !b[homeR * 8 + 1] && !b[homeR * 8 + 2] && !b[homeR * 8 + 3]) out.push({ from: i, to: homeR * 8 + 2, castle: 'Q' });
            }
          } else {
            const dirs = u === 'B' ? BD : u === 'R' ? RD : KD;
            dirs.forEach(d => {
              let nr = r + d[0], nf = f + d[1];
              while (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
                const ni = nr * 8 + nf, tp = b[ni];
                if (!tp) out.push({ from: i, to: ni });
                else { if (col(tp) !== c) out.push({ from: i, to: ni, cap: true }); break; }
                nr += d[0]; nf += d[1];
              }
            });
          }
        }
        return out;
      }
      function attacked(b, sq, by) {
        const r = sq >> 3, f = sq & 7;
        for (let k = 0; k < 8; k++) {
          const nr = r + KN[k][0], nf = f + KN[k][1];
          if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) { const p = b[nr * 8 + nf]; if (p && col(p) === by && p.toUpperCase() === 'N') return true; }
        }
        for (let k = 0; k < 8; k++) {
          const nr = r + KD[k][0], nf = f + KD[k][1];
          if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) { const p = b[nr * 8 + nf]; if (p && col(p) === by && p.toUpperCase() === 'K') return true; }
        }
        const pd = by === 'w' ? 1 : -1;
        [[pd, -1], [pd, 1]].forEach(d => {
          const nr = r + d[0], nf = f + d[1];
          if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) { const p = b[nr * 8 + nf]; if (p && col(p) === by && p.toUpperCase() === 'P') return true; }
        });
        const rays = [[[-1, -1], [-1, 1], [1, -1], [1, 1], ['B', 'Q']], [[-1, 0], [1, 0], [0, -1], [0, 1], ['R', 'Q']]];
        for (let g = 0; g < rays.length; g++) {
          const dirs = rays[g], types = dirs[dirs.length - 1];
          for (let k = 0; k < 4; k++) {
            let nr = r + dirs[k][0], nf = f + dirs[k][1];
            while (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
              const p = b[nr * 8 + nf];
              if (p) { if (col(p) === by && types.indexOf(p.toUpperCase()) >= 0) return true; break; }
              nr += dirs[k][0]; nf += dirs[k][1];
            }
          }
        }
        return false;
      }
      function kingSq(b, c) { const k = c === 'w' ? 'K' : 'k'; for (let i = 0; i < 64; i++) if (b[i] === k) return i; return -1; }
      function apply(st, m) {
        const s = clone(st), b = s.board, p = b[m.from], c = col(p), u = p.toUpperCase();
        b[m.from] = null;
        if (m.ep) { const capR = (m.from >> 3); b[capR * 8 + (m.to & 7)] = null; }
        b[m.to] = m.promo ? (c === 'w' ? m.promo.toUpperCase() : m.promo) : p;
        if (m.castle === 'K') { b[(m.from >> 3) * 8 + 5] = b[(m.from >> 3) * 8 + 7]; b[(m.from >> 3) * 8 + 7] = null; }
        if (m.castle === 'Q') { b[(m.from >> 3) * 8 + 3] = b[(m.from >> 3) * 8 + 0]; b[(m.from >> 3) * 8 + 0] = null; }
        if (u === 'K') { if (c === 'w') { s.castling.K = false; s.castling.Q = false; } else { s.castling.k = false; s.castling.q = false; } }
        if (m.from === 63 || m.to === 63) s.castling.K = false;
        if (m.from === 56 || m.to === 56) s.castling.Q = false;
        if (m.from === 7 || m.to === 7) s.castling.k = false;
        if (m.from === 0 || m.to === 0) s.castling.q = false;
        s.ep = m.double ? ((m.from + m.to) / 2) : -1;
        s.half = (u === 'P' || m.cap) ? 0 : s.half + 1;
        if (c === 'b') s.full++;
        s.turn = other(c);
        return s;
      }
      function legal(st) {
        const c = st.turn, out = [];
        pseudo(st, c).forEach(m => {
          const s2 = apply(st, m);
          const k = kingSq(s2.board, c);
          if (k >= 0 && !attacked(s2.board, k, other(c))) {
            if (m.castle) {
              const hr = m.from >> 3;
              const pass = m.castle === 'K' ? [4, 5, 6] : [4, 3, 2];
              let okc = true;
              for (let i = 0; i < pass.length; i++) if (attacked(st.board, hr * 8 + pass[i], other(c))) okc = false;
              if (!okc) return;
            }
            out.push(m);
          }
        });
        return out;
      }
      function inCheck(st, c) { const k = kingSq(st.board, c); return k >= 0 && attacked(st.board, k, other(c)); }
      function status(st) {
        const mv = legal(st);
        if (!mv.length) return inCheck(st, st.turn) ? 'checkmate' : 'stalemate';
        if (st.half >= 100) return 'draw50';
        return 'ok';
      }
      function evalState(st) {
        let s = 0;
        for (let i = 0; i < 64; i++) {
          const p = st.board[i]; if (!p) continue;
          const c = col(p), u = p.toLowerCase();
          const sq = c === 'w' ? i : (7 - (i >> 3)) * 8 + (i & 7);
          const pv = VAL[u] + (PST[u] ? PST[u][sq] : 0);
          s += c === 'w' ? pv : -pv;
        }
        return st.turn === 'w' ? s : -s;
      }
      function search(st, depth, alpha, beta, nodes) {
        nodes.n++;
        if (nodes.n > 260000) return evalState(st);
        const mv = legal(st);
        if (!mv.length) return inCheck(st, st.turn) ? -100000 + (5 - depth) : 0;
        if (depth === 0) return evalState(st);
        mv.sort((a, b) => (b.cap ? 1 : 0) - (a.cap ? 1 : 0) || (b.promo ? 1 : 0) - (a.promo ? 1 : 0));
        let best = -1e9;
        for (let i = 0; i < mv.length; i++) {
          const v = -search(apply(st, mv[i]), depth - 1, -beta, -alpha, nodes);
          if (v > best) best = v;
          if (v > alpha) alpha = v;
          if (alpha >= beta) break;
        }
        return best;
      }
      function bestMove(st, depth) {
        const mv = legal(st);
        if (!mv.length) return null;
        mv.sort((a, b) => (b.cap ? 1 : 0) - (a.cap ? 1 : 0));
        const nodes = { n: 0 };
        let best = mv[0], bestV = -1e9;
        for (let i = 0; i < mv.length; i++) {
          const v = -search(apply(st, mv[i]), depth - 1, -1e9, 1e9, nodes) + (Math.random() * 4);
          if (v > bestV) { bestV = v; best = mv[i]; }
        }
        return best;
      }
      const FILES = 'abcdefgh';
      function sq2str(i) { return FILES[i & 7] + (8 - (i >> 3)); }
      function san(st, m, legalList) {
        const p = st.board[m.from], u = p.toUpperCase();
        if (m.castle) return m.castle === 'K' ? 'O-O' : 'O-O-O';
        let s = '';
        if (u === 'P') { if (m.cap) s += FILES[m.from & 7] + 'x'; }
        else {
          s += u;
          const others = legalList.filter(x => x.to === m.to && x.from !== m.from && st.board[x.from] && st.board[x.from].toUpperCase() === u);
          if (others.length) {
            const sameFile = others.some(x => (x.from & 7) === (m.from & 7));
            const sameRank = others.some(x => (x.from >> 3) === (m.from >> 3));
            if (!sameFile) s += FILES[m.from & 7];
            else if (!sameRank) s += (8 - (m.from >> 3));
            else s += FILES[m.from & 7] + (8 - (m.from >> 3));
          }
          if (m.cap) s += 'x';
        }
        s += sq2str(m.to);
        if (m.promo) s += '=' + m.promo.toUpperCase();
        const s2 = apply(st, m);
        const st2 = status(s2);
        if (st2 === 'checkmate') s += '#';
        else if (inCheck(s2, s2.turn)) s += '+';
        return s;
      }
      return { start, clone, legal, apply, status, inCheck, bestMove, san, sq2str, col, other, evalState };
    })();
    window.__wsftInternals = window.__wsftInternals || {};
    window.__wsftInternals.chess = CH;

    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          ${scorebar([['状态', 'chStat', null, '白方走棋'], ['走子数', 'chPly']])}
          <div id="chWrap"></div>
        </div>
      </div>
      ${paneBox('国际象棋', '完整合法走子生成（含王车易位 / 吃过路兵 / 兵升变），Python 端无依赖的极小极大 + α-β 搜索。',
      `<div class="plabel">AI 搜索深度</div>${TUI.sel('chDepth', [{ v: '1', t: '1 层（随机感强）' }, { v: '2', t: '2 层（较快）' }, { v: '3', t: '3 层（默认）' }, { v: '4', t: '4 层（慢）' }], '3')}
        <div class="plabel">升变棋子</div>${TUI.sel('chPromo', [{ v: 'q', t: '后 Queen' }, { v: 'r', t: '车 Rook' }, { v: 'b', t: '象 Bishop' }, { v: 'n', t: '马 Knight' }], 'q')}
        <div class="shapes" style="margin-top:12px;gap:8px">
          <button class="btn-lime btn-sm" id="gStart">新对局</button>
          <button class="btn-ghost btn-sm" id="chUndo">悔棋</button>
          <button class="btn-ghost btn-sm" id="chFlip">翻转棋盘</button>
          <button class="btn-ghost btn-sm" id="chAi">AI 代走一步</button>
        </div>
        <div class="plabel">走子记录（PGN 风格）</div>
        <div class="ioout" id="chLog" style="min-height:150px;max-height:230px;font-size:12.5px">1.</div>
        <div class="runnote">点自己的棋子选中，再点高亮的落点。AI 只有子力 + 位置表评估，不是引擎级棋力。</div>`)}
    </div>`;
    let st, hist, snaps, sel = -1, flip = false, legalList = [], ply = 0, thinking = false;
    const wrap = $('#chWrap');
    const C = mkCanvas(wrap, 512, 512);
    const GLYPH = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚', P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕', K: '♔' };
    function newGame() {
      st = CH.start(); hist = []; snaps = []; sel = -1; ply = 0; thinking = false;
      legalList = CH.legal(st); draw(); log(); setStat('白方走棋');
      $('#chLog').textContent = '1.';
    }
    function setStat(t) { $('#chStat').textContent = t; }
    function draw() {
      const ctx = C.ctx, S = C.W / 8;
      for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
        const rr = flip ? 7 - r : r, ff = flip ? 7 - f : f;
        ctx.fillStyle = (r + f) % 2 ? '#5b6b3a' : '#e8e2cf';
        ctx.fillRect(f * S, r * S, S, S);
      }
      const targets = sel >= 0 ? legalList.filter(m => m.from === sel) : [];
      ctx.fillStyle = 'rgba(215,244,82,.45)';
      targets.forEach(m => { const t = flip ? (7 - (m.to >> 3)) * 8 + (7 - (m.to & 7)) : m.to; ctx.beginPath(); ctx.arc((t & 7) * S + S / 2, (t >> 3) * S + S / 2, m.cap ? S * 0.42 : S * 0.16, 0, Math.PI * 2); ctx.fill(); });
      for (let i = 0; i < 64; i++) {
        const p = st.board[i]; if (!p) continue;
        const vi = flip ? (7 - (i >> 3)) * 8 + (7 - (i & 7)) : i;
        const x = (vi & 7) * S, y = (vi >> 3) * S;
        if (i === sel) { ctx.fillStyle = 'rgba(215,244,82,.55)'; ctx.fillRect(x, y, S, S); }
        ctx.font = (S * 0.82) + 'px "Segoe UI Symbol","Apple Symbols",serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = CH.col(p) === 'w' ? '#ffffff' : '#111111';
        ctx.strokeStyle = CH.col(p) === 'w' ? '#333' : '#bbb'; ctx.lineWidth = 1.4;
        ctx.strokeText(GLYPH[p], x + S / 2, y + S / 2 + 1);
        ctx.fillText(GLYPH[p], x + S / 2, y + S / 2 + 1);
      }
      if (CH.inCheck(st, st.turn)) { const k = (function () { for (let i = 0; i < 64; i++) if (st.board[i] === (st.turn === 'w' ? 'K' : 'k')) return i; return -1; })(); if (k >= 0) { const vi = flip ? (7 - (k >> 3)) * 8 + (7 - (k & 7)) : k; ctx.strokeStyle = '#ff5f56'; ctx.lineWidth = 3; ctx.strokeRect((vi & 7) * S + 2, (vi >> 3) * S + 2, S - 4, S - 4); } }
      $('#chPly').textContent = ply;
    }
    function log() {
      const parts = [];
      for (let i = 0; i < hist.length; i += 2) {
        parts.push((i / 2 + 1) + '. ' + hist[i] + (hist[i + 1] ? ' ' + hist[i + 1] : ''));
      }
      $('#chLog').textContent = parts.join('\n') || '1.';
      $('#chLog').scrollTop = 1e6;
    }
    function afterMove() {
      ply++;
      const s = CH.status(st);
      if (s === 'checkmate') { setStat((st.turn === 'w' ? '黑方' : '白方') + '将死获胜'); tone(880, 0.2, 'triangle', 0.18); tone(1180, 0.3, 'triangle', 0.16, 0.18); }
      else if (s === 'stalemate' || s === 'draw50') { setStat('和棋'); tone(300, 0.3, 'sine', 0.14); }
      else setStat((st.turn === 'w' ? '白方' : '黑方') + '走棋' + (CH.inCheck(st, st.turn) ? '（被将军！）' : ''));
      draw(); log();
    }
    function play(m) {
      const list = CH.legal(st);
      const sanStr = CH.san(st, m, list);
      snaps.push(CH.clone(st));
      hist.push(sanStr);
      st = CH.apply(st, m);
      legalList = CH.legal(st);
      sel = -1;
      afterMove();
    }
    function onBoard(e) {
      if (thinking) return;
      const p = C.pos(e);
      const S = C.W / 8;
      let f = Math.floor(p.x / S), r = Math.floor(p.y / S);
      if (flip) { f = 7 - f; r = 7 - r; }
      const i = r * 8 + f;
      if (i < 0 || i > 63) return;
      unlockAudio();
      const piece = st.board[i];
      if (sel >= 0) {
        const moves = legalList.filter(m => m.from === sel && m.to === i);
        if (moves.length) {
          const promo = $('#chPromo').value;
          const m = moves.find(x => x.promo === promo) || moves[0];
          play(m);
          setTimeout(aiIfNeeded, 60);
          return;
        }
      }
      if (piece && CH.col(piece) === st.turn) { sel = i; draw(); }
      else { sel = -1; draw(); }
    }
    C.cv.addEventListener('click', onBoard);
    C.cv.addEventListener('touchend', e => { e.preventDefault(); onBoard(e.changedTouches ? { clientX: e.changedTouches[0].clientX, clientY: e.changedTouches[0].clientY } : e); }, { passive: false });
    function aiIfNeeded() {
      const s = CH.status(st);
      if (s === 'checkmate' || s === 'stalemate' || s === 'draw50') return;
      if (st.turn === 'b') {
        thinking = true; setStat('AI 思考中…');
        setTimeout(() => {
          const m = CH.bestMove(st, +$('#chDepth').value);
          thinking = false;
          if (m) play(m);
        }, 30);
      }
    }
    keys({ ArrowLeft: () => { flip = !flip; draw(); }, f: () => { flip = !flip; draw(); }, F: () => { flip = !flip; draw(); }, u: () => undo(), Escape: () => { sel = -1; draw(); } });
    function undo() {
      if (!snaps.length) { window.toast('没有可悔的棋'); return; }
      let steps = (st.turn === 'w' && snaps.length >= 2) ? 2 : 1;
      while (steps-- > 0 && snaps.length) { st = snaps.pop(); hist.pop(); }
      legalList = CH.legal(st); sel = -1; ply = hist.length; draw(); log();
      setStat((st.turn === 'w' ? '白方' : '黑方') + '走棋');
    }
    $('#chFlip').addEventListener('click', () => { flip = !flip; draw(); });
    $('#chUndo').addEventListener('click', undo);
    $('#chAi').addEventListener('click', () => { if (!thinking && (CH.status(st) === 'ok')) { const m = CH.bestMove(st, +$('#chDepth').value); if (m) play(m); } });
    ctlEl('#gStart').addEventListener('click', newGame);
    newGame();
  };

  /* ---------------- 克朗代克纸牌 ---------------- */
  G['solitaire'] = function (host) {
    const SUITS = ['♠', '♥', '♦', '♣'];
    const RED = { '♥': 1, '♦': 1 };
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          ${scorebar([['步数', 'soMoves'], ['已归位', 'soDone'], ['用时', 'soTime']])}
          <div id="soBoard" style="display:grid;grid-template-columns:repeat(7,1fr);gap:8px;width:min(100%,760px)"></div>
          <div class="runnote" id="soMsg">把牌拖到目标堆：红黑交替、点数列递减；A 先上右上花色的归位堆。</div>
        </div>
      </div>
      ${paneBox('克朗代克纸牌', '拖拽移动（也支持「点选 → 点目标堆」），含自动收牌与完整撤销。',
      `<div class="shapes" style="margin-top:12px;gap:8px">
          <button class="btn-lime btn-sm" id="gStart">重新发牌</button>
          <button class="btn-ghost btn-sm" id="soUndo">撤销</button>
          <button class="btn-ghost btn-sm" id="soAuto">自动收牌</button>
          <button class="btn-ghost btn-sm" id="soHint">提示</button>
        </div>
        <div class="plabel">每次翻牌张数</div>${TUI.sel('soDraw', [{ v: '1', t: '翻 1 张（简单）' }, { v: '3', t: '翻 3 张（标准）' }], '1')}
        <div class="runnote">胜利条件：四种花色 A→K 全部归位。统计数据存 wsft:solitaire。</div>`)}
    </div>`;
    const boardEl = $('#soBoard');
    let stock, waste, found, tab, moves, snapshots, sel = null, secs = 0, timerId, won = false;
    function newDeck() {
      const d = []; let id = 0;
      SUITS.forEach(s => { for (let r = 1; r <= 13; r++) d.push({ s: s, r: r, up: false, id: id++ }); });
      for (let i = d.length - 1; i > 0; i--) { const j = ri(0, i); const t = d[i]; d[i] = d[j]; d[j] = t; }
      return d;
    }
    function deal() {
      const d = newDeck();
      tab = [[], [], [], [], [], [], []];
      for (let i = 0; i < 7; i++) for (let j = 0; j <= i; j++) { const c = d.pop(); c.up = (j === i); tab[i].push(c); }
      stock = d; waste = []; found = { '♠': [], '♥': [], '♦': [], '♣': [] };
      moves = 0; snapshots = []; sel = null; won = false; secs = 0;
      $('#soMoves').textContent = '0'; $('#soDone').textContent = '0'; $('#soTime').textContent = '0:00';
      clearInterval(timerId);
      timerId = setInterval(() => { secs++; $('#soTime').textContent = Math.floor(secs / 60) + ':' + pad2(secs % 60); }, 1000);
      onClean(() => clearInterval(timerId));
      $('#soMsg').textContent = '发牌完成 — 拖动或点击选牌。';
      paint();
    }
    function snapshot() { snapshots.push(JSON.stringify({ stock, waste, found, tab, moves })); if (snapshots.length > 200) snapshots.shift(); }
    function restore() {
      if (!snapshots.length) { window.toast('没有可撤销的操作'); return; }
      const s = JSON.parse(snapshots.pop());
      stock = s.stock; waste = s.waste; found = s.found; tab = s.tab; moves = s.moves; sel = null; won = false;
      paint();
    }
    function cardHtml(c, i, pile, extra) {
      const red = RED[c.s] ? '#ff6b6b' : '#e5e5e5';
      if (!c.up) return `<div class="card" data-pile="${pile}" data-i="${i}" style="position:absolute;top:${extra.top}px;left:0;right:0;height:88px;border-radius:8px;background:repeating-linear-gradient(45deg,#1c2a4a,#1c2a4a 6px,#22335c 6px,#22335c 12px);border:1px solid #3a4a6a;cursor:pointer;box-sizing:border-box"></div>`;
      return `<div class="card" draggable="true" data-pile="${pile}" data-i="${i}" style="position:absolute;top:${extra.top}px;left:0;right:0;height:88px;border-radius:8px;background:#f4f1e8;border:1px solid #c9c4b4;cursor:grab;box-sizing:border-box;padding:5px 7px;font-weight:750;color:${red};font-size:15px">${c.r === 1 ? 'A' : c.r === 11 ? 'J' : c.r === 12 ? 'Q' : c.r === 13 ? 'K' : c.r}${c.s}</div>`;
    }
    function canPutOnTab(c, dest) {
      if (!dest.length) return c.r === 13;
      const t = dest[dest.length - 1];
      if (!t.up) return false;
      return RED[t.s] !== RED[c.s] && t.r === c.r + 1;
    }
    function canPutOnFound(c, s) {
      const p = found[s];
      if (!p.length) return c.r === 1;
      return p[p.length - 1].r === c.r - 1;
    }
    function paint() {
      boardEl.innerHTML = '';
      const top = el('div');
      top.style.cssText = 'grid-column:span 7;display:flex;gap:8px;align-items:flex-start;position:relative;min-height:96px';
      top.innerHTML = `<div data-zone="stock" style="width:66px;height:88px;border-radius:8px;border:1.5px dashed #4a4a4a;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#8a8a8a;font-size:11px">${stock.length ? '抽牌 ' + stock.length : '空'}</div>
        <div data-zone="waste" style="position:relative;width:66px;height:88px"></div>
        <div style="flex:1"></div>
        ${SUITS.map(s => `<div data-zone="found" data-suit="${s}" style="position:relative;width:66px;height:88px;border-radius:8px;border:1.5px dashed ${RED[s] ? '#6a3a3a' : '#3a4a3a'};display:flex;align-items:center;justify-content:center;color:#5a5a5a;font-size:18px">${s}</div>`).join('')}`;
      boardEl.appendChild(top);
      const wasteEl = top.querySelector('[data-zone="waste"]');
      const show = waste.slice(-3);
      show.forEach((c, k) => { wasteEl.insertAdjacentHTML('beforeend', cardHtml(c, waste.length - show.length + k, 'waste', { top: k * 14 })); });
      SUITS.forEach(s => {
        const box = top.querySelector('[data-zone="found"][data-suit="' + s + '"]');
        const p = found[s];
        if (p.length) box.insertAdjacentHTML('beforeend', cardHtml(p[p.length - 1], p.length - 1, 'found', { top: 0 }));
      });
      tab.forEach((pile, i) => {
        const col = el('div');
        col.style.cssText = 'position:relative;min-height:96px';
        col.setAttribute('data-zone', 'tab');
        col.setAttribute('data-col', i);
        col.innerHTML = `<div style="position:absolute;top:0;left:0;right:0;height:88px;border-radius:8px;border:1.5px dashed #333"></div>`;
        pile.forEach((c, j) => { col.insertAdjacentHTML('beforeend', cardHtml(c, j, 'tab', { top: j * 22 })); });
        col.style.height = (88 + Math.max(0, pile.length - 1) * 22 + 12) + 'px';
        boardEl.appendChild(col);
      });
      const done = SUITS.reduce((a, s) => a + found[s].length, 0);
      $('#soDone').textContent = done;
      $('#soMoves').textContent = moves;
      if (done === 52 && !won) {
        won = true; clearInterval(timerId);
        $('#soMsg').innerHTML = '<b style="color:#d7f452">恭喜通关！用了 ' + moves + ' 步 / ' + Math.floor(secs / 60) + ' 分 ' + (secs % 60) + ' 秒。</b>';
        tone(660, 0.12, 'triangle', 0.16); tone(880, 0.14, 'triangle', 0.16, 0.12); tone(1046, 0.2, 'triangle', 0.16, 0.26);
      }
    }
    let pending = null;
    function clickCard(pile, idx, col) {
      unlockAudio();
      if (pile === 'stock') {
        snapshot();
        const n = +$('#soDraw').value;
        if (!stock.length) { stock = waste.reverse().map(c => { c.up = false; return c; }); waste = []; }
        else { for (let k = 0; k < n && stock.length; k++) { const c = stock.pop(); c.up = true; waste.push(c); } }
        moves++; tone(500, 0.04, 'triangle', 0.08); sel = null; paint(); return;
      }
      if (pile === 'waste') {
        if (pending && pending.from === 'waste') { pending = null; paint(); return; }
        const c = waste[waste.length - 1]; if (!c) return;
        pending = { from: 'waste', cards: [c], col: -1, idx: waste.length - 1 }; paint(); return;
      }
      if (pile === 'tab') {
        const c = tab[col][idx]; if (!c || !c.up) return;
        if (pending) {
          const moved = dropTo('tab', col);
          if (!moved) { pending = { from: 'tab', cards: tab[col].slice(idx), col: col, idx: idx }; }
          paint(); return;
        }
        pending = { from: 'tab', cards: tab[col].slice(idx), col: col, idx: idx };
        paint(); return;
      }
      if (pile === 'found') {
        if (pending) { dropTo('found', col); paint(); }
        return;
      }
    }
    function dropTo(zone, col, suit) {
      if (!pending) return false;
      const cards = pending.cards;
      if (!cards.length) { pending = null; return false; }
      // 目标堆不能是来源本身
      if (pending.from === 'tab' && zone === 'tab' && pending.col === col) { pending = null; return false; }
      snapshot();
      let ok = false;
      if (zone === 'tab') {
        if (canPutOnTab(cards[0], tab[col])) {
          if (pending.from === 'waste') waste.pop();
          else { tab[pending.col].splice(pending.idx); if (tab[pending.col].length && !tab[pending.col][tab[pending.col].length - 1].up) tab[pending.col][tab[pending.col].length - 1].up = true; }
          cards.forEach(c => tab[col].push(c));
          ok = true;
        }
      } else if (zone === 'found') {
        if (cards.length === 1 && canPutOnFound(cards[0], suit)) {
          if (pending.from === 'waste') waste.pop();
          else { tab[pending.col].splice(pending.idx); if (tab[pending.col].length && !tab[pending.col][tab[pending.col].length - 1].up) tab[pending.col][tab[pending.col].length - 1].up = true; }
          found[suit].push(cards[0]);
          ok = true;
        }
      }
      if (!ok) { snapshots.pop(); pending = null; return false; }
      moves++; pending = null; tone(720, 0.05, 'triangle', 0.1);
      paint();
      return true;
    }
    boardEl.addEventListener('click', e => {
      const card = e.target.closest('.card');
      const zone = e.target.closest('[data-zone]');
      if (card) {
        const pile = card.dataset.pile, ci = +card.dataset.i;
        if (pile === 'tab') clickCard('tab', ci, +card.closest('[data-col]').dataset.col);
        else clickCard(pile, ci, 0);
      } else if (zone) {
        const z = zone.dataset.zone;
        if (z === 'stock') clickCard('stock', 0, 0);
        else if (z === 'waste') clickCard('waste', 0, 0);
        else if (z === 'tab') { if (pending) { dropTo('tab', +zone.dataset.col); paint(); } }
        else if (z === 'found') { if (pending) { dropTo('found', 0, zone.dataset.suit); paint(); } }
      }
    });
    boardEl.addEventListener('dragstart', e => {
      const card = e.target.closest('.card'); if (!card) return;
      const pile = card.dataset.pile;
      if (pile === 'tab') { const col = +card.closest('[data-col]').dataset.col; pending = { from: 'tab', cards: tab[col].slice(+card.dataset.i), col: col, idx: +card.dataset.i }; }
      else if (pile === 'waste') { pending = { from: 'waste', cards: [waste[waste.length - 1]], col: -1, idx: waste.length - 1 }; }
      else return;
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', 'card'); } catch (x) { }
    });
    boardEl.addEventListener('dragover', e => { if (pending) e.preventDefault(); });
    boardEl.addEventListener('drop', e => {
      e.preventDefault();
      const zone = e.target.closest('[data-zone]');
      if (!zone) { pending = null; return; }
      if (zone.dataset.zone === 'tab') dropTo('tab', +zone.dataset.col);
      else if (zone.dataset.zone === 'found') dropTo('found', 0, zone.dataset.suit);
      paint();
    });
    $('#soUndo').addEventListener('click', restore);
    $('#soAuto').addEventListener('click', () => {
      snapshot();
      let did = 0, go = true;
      while (go) {
        go = false;
        SUITS.forEach(s => {
          const cands = [];
          if (waste.length) cands.push({ from: 'waste' });
          tab.forEach((p, i) => { if (p.length) cands.push({ from: 'tab', col: i }); });
          for (let k = 0; k < cands.length; k++) {
            const c = cands[k].from === 'waste' ? waste[waste.length - 1] : tab[cands[k].col][tab[cands[k].col].length - 1];
            if (c && c.up && canPutOnFound(c, s)) {
              if (cands[k].from === 'waste') waste.pop();
              else { tab[cands[k].col].pop(); if (tab[cands[k].col].length && !tab[cands[k].col][tab[cands[k].col].length - 1].up) tab[cands[k].col][tab[cands[k].col].length - 1].up = true; }
              found[s].push(c); did++; go = true; moves++; break;
            }
          }
        });
      }
      if (!did) window.toast('当前没有可直接归位的牌'); else tone(800, 0.06, 'triangle', 0.1);
      paint();
    });
    $('#soHint').addEventListener('click', () => {
      for (let i = 0; i < 7; i++) { const p = tab[i]; if (p.length && !p[p.length - 1].up) { $('#soMsg').textContent = '第 ' + (i + 1) + ' 列有可以翻开的暗牌。'; return; } }
      $('#soMsg').textContent = stock.length ? '先从左上角抽牌。' : '试试把 K 移到空的列上。';
    });
    ctlEl('#gStart').addEventListener('click', deal);
    deal();
  };

  /* ---------------- 弹珠台 ---------------- */
  G['pinball'] = function (host) {
    const W = 340, H = 560;
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          ${scorebar([['得分', 'pbScore'], ['最高分', 'pbBest'], ['剩余球', 'pbBalls']])}
          <div id="pbWrap"></div>
          <div class="runnote">← / → 或 A / D 控制左右挡板；触摸屏幕左右半边也可以。空格 / 上箭头发射。</div>
        </div>
      </div>
      ${paneBox('弹珠台', '挡板转动会传递真实冲量，球与圆柱碰撞用连续圆碰撞求解，掉到底部扣一条命。',
      ctrlRow('<button class="btn-ghost btn-sm" id="pbLaunch">发射</button>') +
      `<div class="plabel">重力</div>${TUI.range('pbG', 300, 1600, 820, 20)}
        <div class="plabel">挡板力度</div>${TUI.range('pbF', 4, 20, 11, 1)}
        <div class="runnote">最高分键 wsft:pinball.best。3 条命。</div>`)}
    </div>`;
    const C = mkCanvas($('#pbWrap'), W, H);
    const ctx = C.ctx;
    let ball, fl = {}, score, balls, best = load('pinball.best', 0), running = false, stuck = 0;
    $('#pbBest').textContent = best;
    const bumpers = [{ x: 90, y: 150, r: 18 }, { x: 250, y: 150, r: 18 }, { x: 170, y: 235, r: 22 }, { x: 90, y: 330, r: 14 }, { x: 250, y: 330, r: 14 }];
    function newBall() {
      ball = { x: 300, y: H - 60, vx: 0, vy: 0, r: 8, held: true };
      fl = { l: { a: 0.5, om: 0, sp: 0 }, r: { a: -0.5, om: 0, sp: 0 } };
    }
    function reset() { score = 0; balls = 3; $('#pbScore').textContent = '0'; $('#pbBalls').textContent = '3'; newBall(); }
    function launch() {
      if (!ball || !ball.held) return;
      ball.held = false;
      ball.vy = -Math.max(560, 900 - (H - ball.y) * 1.4);
      ball.vx = rf(-30, 30);
      tone(220, 0.12, 'square', 0.14);
    }
    function flipperAngle(side, dt) {
      const target = side === 'l' ? (fl.l.down ? 0.55 : -0.35) : (fl.r.down ? -0.55 : 0.35);
      const f = fl[side];
      f.om = (target - f.a) * 26;
      f.a += f.om * dt;
    }
    function collideCapsule(b, cx, cy, ang, len, side) {
      const ex = cx + Math.cos(ang) * len, ey = cy + Math.sin(ang) * len;
      const dx = ex - cx, dy = ey - cy;
      const t = clamp(((b.x - cx) * dx + (b.y - cy) * dy) / (dx * dx + dy * dy), 0, 1);
      const px = cx + dx * t, py = cy + dy * t;
      let nx = b.x - px, ny = b.y - py;
      let d = Math.hypot(nx, ny);
      const R = b.r + 6;
      if (d < R) {
        if (d < 0.0001) { d = 0.0001; nx = 0; ny = -1; }
        nx /= d; ny /= d;
        b.x = px + nx * R; b.y = py + ny * R;
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) {
          const power = 1 + (+$('#pbF').value) * 0.045;
          b.vx -= 2 * vn * nx * power; b.vy -= 2 * vn * ny * power;
          b.vx += Math.abs(fl[side].om) * 40 * nx; b.vy += Math.abs(fl[side].om) * 40 * ny;
          if (Math.abs(fl[side].om) > 3) { tone(360, 0.05, 'square', 0.1); score += 25; }
        }
      }
    }
    function step(dt) {
      const g = +$('#pbG').value;
      flipperAngle('l', dt); flipperAngle('r', dt);
      if (ball.held) { ball.x = 300; ball.y = H - 60; return; }
      ball.vy += g * dt;
      ball.x += ball.vx * dt; ball.y += ball.vy * dt;
      // 墙
      if (ball.x - ball.r < 12) { ball.x = 12 + ball.r; ball.vx = Math.abs(ball.vx) * 0.85; }
      if (ball.x + ball.r > W - 12) { ball.x = W - 12 - ball.r; ball.vx = -Math.abs(ball.vx) * 0.85; }
      if (ball.y - ball.r < 12) { ball.y = 12 + ball.r; ball.vy = Math.abs(ball.vy) * 0.85; }
      bumpers.forEach(bp => {
        const dx = ball.x - bp.x, dy = ball.y - bp.y;
        const d = Math.hypot(dx, dy);
        if (d < bp.r + ball.r) {
          const nx = dx / (d || 1), ny = dy / (d || 1);
          ball.x = bp.x + nx * (bp.r + ball.r); ball.y = bp.y + ny * (bp.r + ball.r);
          const vn = ball.vx * nx + ball.vy * ny;
          ball.vx -= 2.1 * vn * nx; ball.vy -= 2.1 * vn * ny;
          score += 100; $('#pbScore').textContent = score;
          tone(700 + ri(0, 200), 0.07, 'square', 0.12);
        }
      });
      collideCapsule(ball, 108, H - 92, fl.l.a, 62, 'l');
      collideCapsule(ball, W - 108, H - 92, Math.PI + fl.r.a, 62, 'r');
      // 底部排水
      if (ball.y > H + 20) {
        balls--; $('#pbBalls').textContent = balls;
        noiseSound(0.3, 0.12, 300, 0.6);
        if (balls <= 0) {
          running = false;
          if (score > best) { best = score; save('pinball.best', best); $('#pbBest').textContent = best; window.toast('新最高分 ' + score); }
        } else newBall();
      }
      if (Math.abs(ball.vx) < 8 && Math.abs(ball.vy) < 8) stuck += dt; else stuck = 0;
      if (stuck > 2) { ball.vx += rf(-90, 90); ball.vy -= 60; stuck = 0; }
    }
    function draw() {
      ctx.fillStyle = '#0b0b0b'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(12, 12); ctx.lineTo(W - 12, 12); ctx.lineTo(W - 12, H - 12); ctx.lineTo(12, H - 12); ctx.closePath(); ctx.stroke();
      bumpers.forEach(bp => {
        const g = ctx.createRadialGradient(bp.x - 4, bp.y - 4, 2, bp.x, bp.y, bp.r);
        g.addColorStop(0, '#e9ff9a'); g.addColorStop(1, '#8fae1e');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bp.x, bp.y, bp.r, 0, Math.PI * 2); ctx.fill();
      });
      [['l', 108], ['r', W - 108]].forEach(p => {
        const a = p[0] === 'l' ? fl[p[0]].a : Math.PI + fl[p[0]].a;
        ctx.strokeStyle = '#d7f452'; ctx.lineWidth = 10; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(p[1], H - 92); ctx.lineTo(p[1] + Math.cos(a) * 62, H - 92 + Math.sin(a) * 62); ctx.stroke();
      });
      if (ball) {
        const g = ctx.createRadialGradient(ball.x - 3, ball.y - 3, 1, ball.x, ball.y, ball.r);
        g.addColorStop(0, '#fff'); g.addColorStop(1, '#9aa0a6');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2); ctx.fill();
      }
      if (!running && balls <= 0) { ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#fff'; ctx.font = '700 26px Inter,sans-serif'; ctx.textAlign = 'center'; ctx.fillText('游戏结束', W / 2, H / 2); }
    }
    const loop = Loop(dt => { if (running) step(dt); draw(); });
    function start() { if (balls <= 0) reset(); running = true; showCtrl(); }
    function showCtrl() { $('#pbLaunch').style.display = ball && ball.held ? 'inline-flex' : 'none'; }
    bindCtrl({ start: () => { start(); loop.start(); }, pause: () => { running = false; }, reset: () => { reset(); running = true; showCtrl(); } });
    $('#pbLaunch').addEventListener('click', launch);
    const held = {};
    keys({
      ArrowLeft: e => { fl.l.down = true; }, ArrowRight: e => { fl.r.down = true; }, a: () => { fl.l.down = true; }, d: () => { fl.r.down = true; },
      ' ': () => launch(), ArrowUp: () => launch()
    });
    window.addEventListener('keyup', e => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') fl.l.down = false;
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') fl.r.down = false;
    });
    onClean(() => { });
    C.cv.addEventListener('pointerdown', e => {
      const p = C.pos(e);
      if (p.x < W / 2) fl.l.down = true; else fl.r.down = true;
      if (ball && ball.held) launch();
      unlockAudio();
    });
    window.addEventListener('pointerup', () => { fl.l.down = false; fl.r.down = false; });
    reset(); loop.start(); running = true; showCtrl();
  };

  /* ---------------- 方块拼图 ---------------- */
  G['block-puzzle'] = function (host) {
    const N = 8;
    const SHAPES = [
      [[0, 0]], [[0, 0], [0, 1]], [[0, 0], [1, 0]], [[0, 0], [0, 1], [0, 2]], [[0, 0], [1, 0], [2, 0]],
      [[0, 0], [0, 1], [0, 2], [0, 3]], [[0, 0], [1, 0], [2, 0], [3, 0]], [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]], [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]],
      [[0, 0], [0, 1], [1, 0], [1, 1]], [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]], [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
      [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]], [[0, 0], [0, 1], [0, 2], [1, 0], [2, 0]], [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]], [[2, 0], [2, 1], [2, 2], [0, 2], [1, 2]],
      [[0, 0], [0, 1], [1, 1], [1, 2]], [[0, 1], [0, 2], [1, 0], [1, 1]], [[0, 0], [1, 0], [2, 0], [1, 1]], [[0, 1], [1, 0], [1, 1], [1, 2]], [[0, 0], [0, 1], [1, 1], [2, 1]], [[2, 0], [2, 1], [2, 2], [1, 2]], [[0, 0], [1, 0], [2, 0], [2, 1]], [[0, 0], [0, 1], [1, 0], [2, 0]], [[0, 0], [0, 1], [0, 2], [1, 1]], [[0, 1], [1, 0], [1, 1], [1, 2]], [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [1, 1]], [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]]
    ];
    const COLORS = ['#d7f452', '#5fd0ff', '#ff8fb1', '#ffd166', '#9be564', '#c39bff', '#ff9f6b'];
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          ${scorebar([['得分', 'bpScore'], ['最高分', 'bpBest'], ['连击', 'bpCombo']])}
          <div id="bpBoard" style="position:relative;display:grid;grid-template-columns:repeat(${N},1fr);gap:4px;background:#141414;padding:6px;border-radius:12px;width:min(100%,420px);aspect-ratio:1;touch-action:none"></div>
          <div id="bpTray" style="display:flex;gap:14px;justify-content:center;padding:12px 0;min-height:96px"></div>
          <div class="runnote">拖动下方方块放到 8×8 棋盘；整行或整列填满即消除。放不下任何一块就结束。</div>
        </div>
      </div>
      ${paneBox('方块拼图', '每轮 3 块，整行/整列消除，连击有额外分数。',
      ctrlRow() + `<div class="runnote">最高分键 wsft:blockpuzzle.best。</div>`)}
    </div>`;
    const boardEl = $('#bpBoard'), trayEl = $('#bpTray');
    let grid, tray, score, combo, over, drag = null, best = load('blockpuzzle.best', 0), cellSize = 44;
    $('#bpBest').textContent = best;
    function reset() {
      grid = new Array(N * N).fill(0); tray = []; score = 0; combo = 0; over = false;
      $('#bpScore').textContent = '0'; $('#bpCombo').textContent = '0';
      refill(); paint();
    }
    function refill() {
      tray = [];
      for (let i = 0; i < 3; i++) tray.push({ shape: SHAPES[ri(0, SHAPES.length - 1)], used: false, color: COLORS[ri(0, COLORS.length - 1)] });
    }
    function fits(shape, r, c) {
      for (let i = 0; i < shape.length; i++) {
        const rr = r + shape[i][0], cc = c + shape[i][1];
        if (rr < 0 || cc < 0 || rr >= N || cc >= N) return false;
        if (grid[rr * N + cc]) return false;
      }
      return true;
    }
    function anyFit() {
      for (let t = 0; t < tray.length; t++) {
        if (tray[t].used) continue;
        for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (fits(tray[t].shape, r, c)) return true;
      }
      return false;
    }
    function paint(preview) {
      boardEl.innerHTML = '';
      const pv = preview || null;
      for (let i = 0; i < N * N; i++) {
        const d = el('div');
        let on = grid[i] ? grid[i] : 0;
        let isPv = false;
        if (pv) { for (let k = 0; k < pv.shape.length; k++) { const idx = (pv.r + pv.shape[k][0]) * N + (pv.c + pv.shape[k][1]); if (idx === i) isPv = true; } }
        d.style.cssText = 'border-radius:6px;background:' + (on ? on : (isPv ? pv.color : '#1e1e1e')) + ';opacity:' + (isPv && !on ? 0.55 : 1) + ';transition:background .1s';
        boardEl.appendChild(d);
      }
      trayEl.innerHTML = tray.map((t, i) => {
        if (t.used) return `<div style="width:88px;height:88px"></div>`;
        const rows = Math.max.apply(null, t.shape.map(s => s[0])) + 1;
        const cols = Math.max.apply(null, t.shape.map(s => s[1])) + 1;
        const m = {};
        t.shape.forEach(s => m[s[0] + ',' + s[1]] = 1);
        let inner = '';
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) inner += `<div style="width:18px;height:18px;border-radius:4px;background:${m[r + ',' + c] ? t.color : 'transparent'}"></div>`;
        return `<div data-t="${i}" style="width:88px;height:88px;display:grid;grid-template-columns:repeat(${cols},18px);grid-template-rows:repeat(${rows},18px);gap:2px;place-content:center;cursor:grab;border:1px solid #262626;border-radius:10px;background:#161616">${inner}</div>`;
      }).join('');
    }
    function place(ti, r, c) {
      const t = tray[ti];
      if (!fits(t.shape, r, c)) return false;
      t.shape.forEach(s => { grid[(r + s[0]) * N + (c + s[1])] = t.color; });
      t.used = true;
      score += t.shape.length;
      let cleared = 0;
      for (let rr = 0; rr < N; rr++) { let full = true; for (let cc = 0; cc < N; cc++) if (!grid[rr * N + cc]) full = false; if (full) { for (let cc = 0; cc < N; cc++) grid[rr * N + cc] = 0; cleared++; } }
      for (let cc = 0; cc < N; cc++) { let full = true; for (let rr = 0; rr < N; rr++) if (!grid[rr * N + cc]) full = false; if (full) { for (let rr = 0; rr < N; rr++) grid[rr * N + cc] = 0; cleared++; } }
      if (cleared) { combo++; score += cleared * 10 * combo; tone(700, 0.07, 'square', 0.14); tone(950, 0.08, 'square', 0.12, 0.06); }
      else combo = 0;
      $('#bpCombo').textContent = combo;
      if (tray.every(x => x.used)) refill();
      $('#bpScore').textContent = score;
      if (score > best) { best = score; save('blockpuzzle.best', best); $('#bpBest').textContent = best; }
      paint();
      if (!anyFit()) {
        over = true;
        $('#bpScore').textContent = score;
        window.toast('无处可放了 — 本局得分 ' + score);
      }
      return true;
    }
    function cellFromEvent(e) {
      const rect = boardEl.getBoundingClientRect();
      const p = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
      const cs = rect.width / N;
      const c = Math.round((p.clientX - rect.left) / cs - 0.5);
      const r = Math.round((p.clientY - rect.top) / cs - 0.5);
      return { r: clamp(r, 0, N - 1), c: clamp(c, 0, N - 1), inside: p.clientX > rect.left && p.clientX < rect.right && p.clientY > rect.top && p.clientY < rect.bottom, cs: cs };
    }
    trayEl.addEventListener('pointerdown', e => {
      const d = e.target.closest('[data-t]'); if (!d) return;
      unlockAudio();
      drag = { ti: +d.dataset.t };
      try { d.setPointerCapture(e.pointerId); } catch (x) { }
    });
    window.addEventListener('pointermove', e => {
      if (!drag) return;
      const c = cellFromEvent(e);
      if (c.inside) paint({ shape: tray[drag.ti].shape, r: c.r, c: c.c, color: tray[drag.ti].color });
      else paint();
    });
    function endDrag(e) {
      if (!drag) return;
      const c = cellFromEvent(e);
      const ti = drag.ti; drag = null;
      if (c.inside) { if (!place(ti, c.r, c.c)) paint(); } else paint();
    }
    window.addEventListener('pointerup', endDrag);
    trayEl.addEventListener('click', e => {
      const d = e.target.closest('[data-t]'); if (!d) return;
      // 点击选中后，点棋盘直接放
      drag = { ti: +d.dataset.t, click: true };
      window.setTimeout(() => { if (drag && drag.click) { /* 等棋盘点击 */ } }, 0);
    });
    boardEl.addEventListener('pointerup', e => {
      const c = cellFromEvent(e);
      if (drag && drag.click && c.inside) { const ti = drag.ti; drag = null; place(ti, c.r, c.c); }
    });
    bindCtrl({ start: () => { }, pause: () => { }, reset: reset });
    ctlEl('#gStart').textContent = '新一局';
    reset();
  };

  /* ---------------- 猜词游戏（5 字母） ---------------- */
  const RAW_WORDS = ('aback abase abate abbey abbot abide abode abort about above abuse abyss ached acorn acrid actor acute adage adapt adept adieu adobe adore adorn adult affix afoot after again agape agate agent agile aging aglow agony agree ahead aisle alarm album alert algae alibi alien align alike alive alley allow alloy aloft alone along aloof aloud alpha altar alter amass amaze amber amble amend amiss amity among ample amuse angel anger angle angry ankle annex annoy annul antic anvil aorta apart aphid apple apply apron arbor arena argue arise armed armor aroma arose array arrow arson ascot ashen aside asked askew assay asset atlas atoll atone attic audio audit avail avert avian avoid await awake award aware awash awful awoke axial axiom bacon badge badly bagel baggy baker balmy banal banjo barge baron basil basin basis baste batch bathe baton bawdy bayou beach beady beard beast beech beefy befit began beget begin begun being belch belie belle belly below bench beret berry berth beset bevel bible bicep bigot bilge binge bingo biome birch birth bison bitty black blade blame bland blank blast blaze bleak bleat bleed blend bless blimp blind blink bliss blitz bloat block bloke blond blood bloom blown blues bluff blunt blurb blurt blush board boast bobby boney bongo bonus booby boost booth booty booze borax borne bosom bossy botch bough bound bowel boxer brace braid brain brake brand brash brass brave bravo brawl brawn bread break breed briar bribe brick bride brief brine bring brink briny brisk broad broil broke brood brook broom broth brown brunt brush brute buddy budge buggy bugle build built bulge bulky bully bunch bunny burly burnt burst bushy cabin cable cacao cache cadet cagey cairn camel cameo canal candy canoe canon caper carat cared cargo carol carry caste catch cater cause cease cedar cello chaff chain chair chalk champ chant chaos chard charm chart chase chasm cheap cheat check cheek cheer chess chest chick chide chief child chili chill chime china chirp chock choir choke chord chore chose chuck chump chunk churn chute cider cigar cinch circa civic civil clamp clash clasp class clean clear cleat clerk click cliff climb cling clink cloak clock clone close cloth cloud clout clove clown cluck clump clung coach coast cobra cocoa colon color comet comic comma coral corny couch cough could count coupe court coven cover covet covey cower coyly crack craft cramp crane crank crash crass crate crave crawl craze crazy creak cream credo creed creek creep creme crepe crest crick cried crime crimp crisp croak crock crone crony crook cross crowd crown crude cruel crumb crush crust crypt cubic cumin curly curse curve curvy cyber cycle cynic daily dairy daisy dance dandy datum daunt dealt death debit debug debut decal decay decor decoy decry defer deity delay delta delve demon dense depot depth derby deter detox devil diary dicey diner dingo dingy dimly dirty disco ditch ditto ditty divan diver dizzy dodge dodgy dogma doing dolly donor donut dopey doubt dough dowdy dowel downy dowry dozen draft drain drake drama drank drape drawl drawn dread dream dress dried drier drift drill drink drive droll drone drool droop drops drove drown drunk dryer dryly duchy dully dummy dumpy dunce dusky dusty dutch dwarf dwell dying eager eagle early earth easel eaten eater ebony edict edify eerie egret eight eject elate elbow elder elect elegy elfin elite elope elude email embed ember emcee empty enact endow enema enemy enjoy ennui ensue enter entry envoy epoch equal equip erase erect error erupt essay ester ether ethic ethos evade event every evict evoke exact exalt excel exert exile exist expel extol extra exult eying fable facet faint fairy faith false famed fancy farce fatal fatty fault fauna favor feast fecal feign fella felon femur fence feral ferry fetal fetch fever fewer fiber field fiend fiery fifth fifty fight filet filly filmy filth final finch finer first fishy fixer fizzy fjord flail flair flake flaky flame flank flare flash flask fleck fleet flesh flick flier fling flint flirt float flock flood floor flora floss flour flout flown fluid fluke flung flush flute foamy focal focus foggy foist folks folly foray force forge forgo forte forth forty forum found foyer frail frame frank fraud freak freed freer fresh friar fried frill frisk frock frond front frost froth frown froze fruit fudge fugue fully fungi funky funny furor furry fussy fuzzy gaffe gaily gamer gamma gamut gassy gaudy gauge gaunt gauze gavel gawky gayer gazer gecko geeky geese genie genre ghost ghoul giant giddy girly girth given giver glade gland glare glass glaze gleam glean glide glint gloat globe gloom glory gloss glove glyph gnash gnome godly going golem golly gonad goner goody gooey goofy goose gorge gouge gourd grace grade graft grail grain grand grant grape graph grasp grass grate grave gravy graze great greed green greet grief grill grime grimy grind gripe groan groin groom grope gross group grout grove growl grown gruel gruff grunt guard guava guess guest guide guild guile guilt guise gulch gully gumbo gummy guppy gusto gusty gypsy habit hairy halve handy happy hardy harem harsh haste hasty hatch hater haunt haven havoc hazel heady heard heart heath heave heavy hedge hefty heist hello hence herbs heron hilly hinge hippo hitch hoard hobby hoist holly homer honey honor horde horse hotel hound house hover howdy human humid humor hunch hurry husky hyena hymns icing ideal idiom idiot idler igloo image imbue impel imply inane inbox incur index inept inert infer ingest? ingot inlet inner input inter intro irate irony islet issue itchy ivory jaunt jazzy jelly jerky jetty jewel jiffy joint joker jolly joust judge juice juicy jumbo jumpy junta juror kappa karma kayak kebab khaki kinky kiosk kitty knack knave knead kneel knelt knife knock knoll known koala krill label labor laden ladle lager lance lanky lapel lapse large larva laser lasso latch later lathe latte laugh layer leach leafy leaky leant leapt learn lease leash least leave ledge leech leery lefty legal lemon lemur level lever libel light liken lilac limbo limit linen liner lingo lipid lithe liver livid llama loamy loath lobby local locus lodge lofty logic loose lorry loser louse lousy lover lower loyal lucid lucky lumen lumpy lunar lunch lunge lupus lurch lurid lusty lying lymph lyric macaw macho macro madam madly mafia magic magma maize major maker mamba mambo mango mangy mania manic manor maple march marry marsh mason match matey mauve maxim maybe mayor mealy meant meaty medal media medic melon mercy merge merit merry metal meter metro micro midge midst might mimic mince miner minim minor minty minus mirth miser missy mixed mixer modal model modem moist molar moldy money month moody moose moral moron morph mossy motel motif motor motto moult mound mount mourn mouse mouth mover movie mower mucky mucus muddy mulch mummy mumps mural murky mushy music musky musty myrrh nadir naive naked nanny nasal nasty natal naval navel needy neigh nerdy nerve never newer newly nicer niche niece night ninja ninth noble nobly noise noisy nomad noose north nosey notch novel nudge nurse nutty nylon oasis obese occur ocean octet odder oddly offal offer often olden older olive omega onion onset opera opine opium optic orbit order organ other otter ought ounce outdo outer outgo ovary overt ovine ovoid owing owner oxide ozone paddy pagan paint paler palsy panel panic pansy papal paper parka parry parse party pasta paste pasty patch patio patsy patty pause payee payer peace peach pearl pedal pecan penal pence penny perch peril perky pesky pesto petal petty phase phone phony photo piano picky piece piety piggy pilot pinch piney pinky pinto piper pique pitch pithy pivot pixel pixie pizza place plaid plain plait plane plank plant plate plaza plead pleat plied plier pluck plumb plume plump plush poach point poise poker polar polka polyp pooch poppy porch poser posit posse pouch pound pouty power prank prawn preen press price prick pride pried prime primo print prior prism privy prize probe prone prong proof prose proud prove prowl proxy prude prune psalm pubic pudgy puffy pulse punch pupal pupil puppy puree purer purge purse pushy putty pygmy quack quail quake qualm quart quash quasi queen queer quell query quest queue quick quiet quill quilt quirk quite quota quote rabid racer radar radio rafts rainy raise rajah rally ramen ranch range rapid rarer raspy ratio ratty raven rayon razor reach react ready realm rebel rebus rebut recap recur reedy refer refit regal rehab reign relax relay relic remit renal renew repay repel reply rerun reset resin retch retro retry reuse revel revue rhino rhyme rider ridge rifle right rigid rigor rinse ripen riper risen riser risky rival river rivet roach roast robin robot rocky rodeo rogue roomy roost rotor rouge rough round rouse route rover rowdy royal ruddy ruder rugby ruins ruler rumor rupee rural rusty saber sadly safer saint salad salon salvo sandy saner sappy sassy satin satyr sauce saucy sauna saute savor savvy scald scale scalp scaly scamp scant scare scarf scary scene scent scion scoff scold scone scoop scope score scorn scour scout scowl scram scrap scree screw scrub scrum scuba sedan seedy segue seine seize semen sense sepia serum serve setup seven sever sewer shack shade shady shaft shake shaky shale shall shame shank shape shard share shark sharp shave shawl sheaf shear sheen sheep sheer sheet shelf shell shied shift shine shiny shire shirk shirt shoal shock shone shook shoot shore shorn short shout shove shown showy shrew shrub shrug shuck shunt shush shyly sider? sidebar? no. sidle siege sieve sight sigma silky silly since sinew singe siren sissy sixth sixty skate skier skiff skill skimp skirt skulk skull skunk slack slain slant slash slate slave sleek sleep sleet slept slice slick slide slime slimy sling slink sloop slope slosh sloth slump slung slurp slush slyly smack small smart smash smear smell smelt smile smirk smite smith smock smoke smoky smote snack snail snake snaky snare snarl sneak sneer snide sniff snipe snoop snore snort snout snowy snuck snuff soapy sober soggy solar solid solve sonar sonic sooth sooty sorry sound south sower space spade spank spare spark spasm spawn speak spear speck speed spell spelt spend spent sperm spice spicy spied spiel spike spiky spill spilt spine spiny spire spite splat split spoil spoke spoof spook spool spoon spore sport spout spray spree sprig spurn spurt squad squat squib stack staff stage staid stain stair stake stale stalk stall stamp stand stank stare stark start stash state stave stead steak steal steam steed steel steep steer stein stern stick stiff still stilt sting stink stint stock stoic stoke stole stomp stone stony stood stool stoop store stork storm story stout stove strap straw stray strip strut stuck study stuff stump stung stunk stunt style suave sugar suite suits sulky sully sumac sunny super surge surly sushi swami swamp swarm swash swath swear sweat sweep sweet swell swept swift swill swine swing swirl swish swoon swoop sworn sword swore syrup table taboo tacit tacky taffy taint taken taker tally talon tamer tango tangy taper tapir tardy tarot taste tasty tatty taunt tawny teach teary tease teddy teeth tempo tenet tenor tense tenth tepee tepid terra terse testy thank theft their theme there these theta thick thief thigh thing think third thong thorn those three threw throb throw thrum thumb thump thyme tiara tibia tidal tiger tight tilde timer timid tipsy titan tithe title toast today toddy token tonal tonic tooth topaz topic torch torso total totem touch tough towel tower toxic toxin trace track tract trade trail train trait tramp trash trawl tread treat trend triad trial tribe trice trick tried tripe trite troll troop trope trout truce truck truly trump trunk truss trust truth tryst tubal tuber tulip tumor tunic turbo tutor twang tweak tweed tweet twice twine twirl twist twixt tying udder ulcer ultra umbra uncle uncut under undid undue unfed unfit unify union unite unity unlit unmet until unwed unzip upper upset urban urine usage usher using usual utter vague valet valid valor value valve vapor vault vegan venom venue verge verse verso verve vicar video vigil vigor villa vinyl viola viper viral virus visit visor vista vital vivid vixen vocal vodka vogue voice voila? no(voila 5) voter vouch vowel vying wacky wafer wager wagon waist waive waltz warty waste watch water waver waxen weary weave wedge weedy weeks weeny weigh weird welch welsh wench whack whale wharf wheat wheel where which whiff while whine whiny whirl whisk white whole whoop whose widen wider widow width wield wiggy wight willy wimpy wince winch windy wiper wired wiser wispy witch witty woken woman women woody wooer wooly woozy wordy world worry worse worst worth would wound woven wrack wrath wreak wreck wrest wring wrist write wrong wrote wrung wryly yacht yearn yeast yield young youth yummy zebra zesty zonal zoned zippy zonal'.split(/\s+/)).filter(w => w.length === 5);
  const WORDS5 = [];
  (function () { const seen = {}; RAW_WORDS.forEach(w => { const lw = w.toLowerCase(); if (!seen[lw]) { seen[lw] = 1; WORDS5.push(lw); } }); })();

  G['word-guess-game'] = function (host, cfg, slug) {
    const daily = slug === 'daily-word-puzzle';
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          <div id="wgBoard" style="display:grid;grid-row-gap:8px;grid-template-rows:repeat(6,auto)"></div>
          <div id="wgKey" style="display:flex;flex-direction:column;gap:6px;margin-top:16px;align-items:center"></div>
          <div class="runnote" id="wgMsg">${daily ? '每日一词：用当天日期做种子，所有人当天题目一致。' : '输入 5 个字母的英文单词，回车提交。'}</div>
        </div>
      </div>
      ${paneBox('猜词游戏', '内置 ' + WORDS5.length + ' 个 5 字母英文单词。绿色=位置正确，黄色=字母存在但位置不对，灰色=没有这个字母。',
      `<div class="shapes" style="margin-top:12px;gap:8px">
          <button class="btn-lime btn-sm" id="gStart">${daily ? '换一个每日词' : '新游戏'}</button>
          <button class="btn-ghost btn-sm" id="wgGive">看答案</button>
        </div>
        <div class="plabel">玩法</div>${TUI.sel('wgMode', [{ v: 'free', t: '随机词（可重开）' }, { v: 'daily', t: '每日一词（按日期）' }], daily ? 'daily' : 'free')}
        <div class="outbox" id="wgStats">—</div>
        <div class="runnote">键盘支持实体键盘与屏幕键盘；统计写 wsft:wordguess。</div>`)}
    </div>`;
    let answer = '', guesses = [], row = 0, cur = '', done = false;
    const boardEl = $('#wgBoard'), keyEl = $('#wgKey');
    function dailyIndex() { const d = new Date(); return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000) % WORDS5.length; }
    function pickAnswer() {
      const mode = $('#wgMode').value;
      answer = mode === 'daily' ? WORDS5[dailyIndex()] : WORDS5[ri(0, WORDS5.length - 1)];
      if (cfg && cfg.word && WORDS5.indexOf(String(cfg.word).toLowerCase()) >= 0) answer = String(cfg.word).toLowerCase();
    }
    function newGame() {
      pickAnswer(); guesses = []; row = 0; cur = ''; done = false;
      boardEl.innerHTML = Array.from({ length: 6 }, () => `<div style="display:flex;gap:8px;justify-content:center">${Array.from({ length: 5 }, () => '<div class="wgcell" style="width:54px;height:54px;border:2px solid #333;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:800;text-transform:uppercase;color:#e5e5e5"></div>').join('')}</div>`).join('');
      keyEl.innerHTML = '';
      [['qwertyuiop'], ['asdfghjkl'], ['zxcvbnm']].forEach((r, i) => {
        const d = el('div'); d.style.cssText = 'display:flex;gap:5px';
        if (i === 2) d.innerHTML = `<button class="key" data-k="enter" style="padding:0 12px;height:44px;border-radius:8px;background:#2a2a2a;color:#e5e5e5;border:none;font-weight:700">ENTER</button>`;
        d.innerHTML += r[0].split('').map(c => `<button class="key" data-k="${c}" style="width:38px;height:44px;border-radius:8px;background:#2a2a2a;color:#e5e5e5;border:none;font-weight:700;text-transform:uppercase">${c}</button>`).join('');
        if (i === 2) d.innerHTML += `<button class="key" data-k="back" style="padding:0 12px;height:44px;border-radius:8px;background:#2a2a2a;color:#e5e5e5;border:none;font-weight:700">⌫</button>`;
        keyEl.appendChild(d);
      });
      $('#wgMsg').textContent = daily ? '每日一词：用当天日期做种子。' : '输入 5 个字母的英文单词，回车提交。';
      render(); stats();
    }
    function stats() {
      const s = load('wordguess', { played: 0, won: 0, streak: 0, best: 0 });
      $('#wgStats').innerHTML = '已玩 <b>' + s.played + '</b> 局 · 胜 <b>' + s.won + '</b> · 当前连胜 <b>' + s.streak + '</b> · 最长 <b>' + s.best + '</b>';
    }
    function render(anim) {
      const cells = $$('.wgcell', boardEl);
      for (let r = 0; r < 6; r++) for (let c = 0; c < 5; c++) {
        const d = cells[r * 5 + c]; if (!d) continue;
        const g = guesses[r];
        if (g) { d.textContent = g.word[c]; d.style.background = g.marks[c] === 2 ? '#4f9e3f' : g.marks[c] === 1 ? '#b59f2e' : '#262626'; d.style.borderColor = 'transparent'; }
        else if (r === row) { d.textContent = cur[c] || ''; d.style.borderColor = cur[c] ? '#555' : '#333'; }
      }
      $$('.key', keyEl).forEach(k => {
        const ch = k.dataset.k; if (ch.length !== 1) return;
        let best = -1;
        guesses.forEach(g => g.word.split('').forEach((w, i) => { if (w === ch) best = Math.max(best, g.marks[i]); }));
        if (best === 2) { k.style.background = '#4f9e3f'; }
        else if (best === 1) { k.style.background = '#b59f2e'; }
        else if (best === 0) { k.style.background = '#141414'; k.style.color = '#555'; }
      });
    }
    function mark(guess) {
      const res = new Array(5).fill(0);
      const pool = {};
      for (let i = 0; i < 5; i++) { if (guess[i] === answer[i]) res[i] = 2; else pool[answer[i]] = (pool[answer[i]] || 0) + 1; }
      for (let i = 0; i < 5; i++) { if (res[i] === 2) continue; const ch = guess[i]; if (pool[ch] > 0) { res[i] = 1; pool[ch]--; } }
      return res;
    }
    function submit() {
      if (done) return;
      if (cur.length !== 5) { $('#wgMsg').textContent = '需要 5 个字母。'; return; }
      if (WORDS5.indexOf(cur) < 0) { $('#wgMsg').textContent = '「' + cur.toUpperCase() + '」不在内置词库里，换一个试试。'; tone(200, 0.1, 'square', 0.1); return; }
      const g = { word: cur, marks: mark(cur) };
      guesses.push(g); render();
      const s = load('wordguess', { played: 0, won: 0, streak: 0, best: 0 });
      if (cur === answer) {
        done = true; s.played++; s.won++; s.streak++; s.best = Math.max(s.best, s.streak); save('wordguess', s);
        $('#wgMsg').innerHTML = '<b style="color:#d7f452">猜对了！用了 ' + guesses.length + ' 次。</b>';
        tone(660, 0.1, 'triangle', 0.16); tone(880, 0.12, 'triangle', 0.16, 0.1); tone(1100, 0.16, 'triangle', 0.16, 0.22);
      } else if (guesses.length >= 6) {
        done = true; s.played++; s.streak = 0; save('wordguess', s);
        $('#wgMsg').innerHTML = '没机会了，答案是 <b>' + answer.toUpperCase() + '</b>。';
        tone(200, 0.35, 'sawtooth', 0.18);
      } else {
        $('#wgMsg').textContent = '继续猜（还剩 ' + (6 - guesses.length) + ' 次）。';
        tone(420, 0.05, 'triangle', 0.1);
      }
      row = guesses.length; cur = ''; render(); stats();
    }
    function type(ch) {
      if (done) return;
      if (ch === 'enter') { submit(); return; }
      if (ch === 'back') { cur = cur.slice(0, -1); render(); return; }
      if (cur.length < 5 && /^[a-z]$/.test(ch)) { cur += ch; render(); tone(600, 0.03, 'square', 0.06); }
    }
    keyEl.addEventListener('click', e => { const k = e.target.closest('.key'); if (k) { unlockAudio(); type(k.dataset.k); } });
    keys({ Enter: () => type('enter'), Backspace: () => type('back') });
    window.addEventListener('keydown', e => {
      const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (/^[a-zA-Z]$/.test(e.key)) type(e.key.toLowerCase());
    });
    $('#wgGive').addEventListener('click', () => { done = true; $('#wgMsg').innerHTML = '答案是 <b>' + answer.toUpperCase() + '</b>。'; });
    $('#wgMode').addEventListener('change', newGame);
    ctlEl('#gStart').addEventListener('click', newGame);
    window.__wsftInternals = window.__wsftInternals || {};
    window.__wsftInternals.words5 = WORDS5;
    newGame();
  };
  G['five-letter-word-game'] = G['word-guess-game'];
  G['daily-word-puzzle'] = G['word-guess-game'];

  /* ---------------- 气泡纸 ---------------- */
  G['bubble-popper'] = function (host) {
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          ${scorebar([['已捏破', 'bubCount'], ['连击', 'bubCombo'], ['剩余', 'bubLeft']])}
          <div id="bubGrid" style="display:grid;gap:6px;justify-content:center;padding:14px;background:#141414;border-radius:14px;width:min(100%,600px)"></div>
          <div class="runnote">点一个气泡就爆一个，连破不中断会有连击加成。</div>
        </div>
      </div>
      ${paneBox('气泡纸', '每个气泡用 Web Audio 合成一段短促的爆破噪声，不是加载音频文件。',
      ctrlRow() + `<div class="plabel">行列</div>${TUI.range('bubN', 4, 16, 10, 1)}
        <div class="plabel">音高</div>${TUI.range('bubPitch', 300, 1800, 900, 20)}
        <div class="runnote">最高连击写 wsft:bubble。</div>`)}
    </div>`;
    const gridEl = $('#bubGrid');
    let count, combo, total, best = load('bubble.best', 0);
    function build() {
      const n = +$('#bubN').value;
      total = n * n; count = 0; combo = 0;
      $('#bubCount').textContent = '0'; $('#bubCombo').textContent = '0'; $('#bubLeft').textContent = total;
      gridEl.style.gridTemplateColumns = 'repeat(' + n + ',1fr)';
      gridEl.innerHTML = Array.from({ length: total }, (_, i) => `<div class="bub" data-i="${i}" style="width:100%;aspect-ratio:1;border-radius:50%;background:radial-gradient(circle at 34% 30%,#cfe9ff,#5fa8d3 60%,#2b5d80);box-shadow:inset 0 -2px 6px rgba(0,0,0,.3);cursor:pointer;transition:transform .08s"></div>`).join('');
    }
    gridEl.addEventListener('click', e => {
      const b = e.target.closest('.bub'); if (!b || b.dataset.popped) return;
      unlockAudio();
      b.dataset.popped = '1';
      b.style.transform = 'scale(.35)';
      b.style.background = '#1b1b1b';
      b.style.boxShadow = 'none';
      count++; combo++;
      const bestC = load('bubble.best', 0);
      if (combo > bestC) save('bubble.best', combo);
      $('#bubCount').textContent = count; $('#bubCombo').textContent = combo;
      $('#bubLeft').textContent = total - count;
      const base = +$('#bubPitch').value;
      noiseSound(0.045, 0.22, base + combo * 25, 6);
      tone(base * 0.6, 0.04, 'sine', 0.08);
      if (count === total) { tone(880, 0.12, 'triangle', 0.16); tone(1180, 0.2, 'triangle', 0.14, 0.12); }
    });
    gridEl.addEventListener('contextmenu', e => {
      const b = e.target.closest('.bub'); if (!b) return; e.preventDefault();
      combo = 0; $('#bubCombo').textContent = '0';
    });
    bindRange('#bubN', () => build());
    bindRange('#bubPitch', () => { });
    bindCtrl({ start: () => { }, pause: () => { combo = 0; $('#bubCombo').textContent = '0'; }, reset: build });
    ctlEl('#gStart').textContent = '重新铺纸';
    build();
  };
  G['bubble-wrap-popper'] = G['bubble-popper'];

  /* ---------------- 捏捏乐 ---------------- */
  G['pop-it'] = function (host) {
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          ${scorebar([['按下', 'popDown'], ['总数', 'popTotal']])}
          <div id="popGrid" style="display:grid;gap:8px;justify-content:center;padding:16px;background:#141414;border-radius:14px;width:min(100%,560px)"></div>
          <div class="runnote">点一下按下，再点一下弹回。按住鼠标划过可以连续捏。</div>
        </div>
      </div>
      ${paneBox('捏捏乐 Pop It', '每个泡泡是软胶质感的按下/弹起状态，配一段合成「啵」声。',
      ctrlRow() + `<div class="plabel">行列</div>${TUI.range('popN', 3, 10, 6, 1)}
        <div class="plabel">形状</div><div class="shapes" id="popShape">${TUI.pill('square', '方形', true)}${TUI.pill('circle', '圆形')}${TUI.pill('heart', '心形')}</div>`)}
    </div>`;
    const gridEl = $('#popGrid');
    let state = [], shape = 'square', down = false, count = 0;
    function build() {
      const n = +$('#popN').value;
      state = new Array(n * n).fill(0); count = 0; $('#popDown').textContent = '0'; $('#popTotal').textContent = n * n;
      gridEl.style.gridTemplateColumns = 'repeat(' + n + ',1fr)';
      gridEl.innerHTML = Array.from({ length: n * n }, (_, i) => {
        const r = Math.floor(i / n), c = i % n;
        let visible = true;
        if (shape === 'circle') { const dx = c - (n - 1) / 2, dy = r - (n - 1) / 2; visible = Math.hypot(dx, dy) <= n / 2; }
        if (shape === 'heart') { const x = (c - (n - 1) / 2) / (n / 2), y = ((n - 1) / 2 - r) / (n / 2); const f = Math.pow(x * x + y * y - 1, 3) - x * x * y * y * y; visible = f <= 0.35; }
        return `<div class="pop" data-i="${i}" style="width:100%;aspect-ratio:1;border-radius:50%;visibility:${visible ? 'visible' : 'hidden'};background:radial-gradient(circle at 35% 30%,#ffd9ec,#ff78b4 55%,#c04a86);cursor:pointer;transition:transform .07s,background .07s"></div>`;
      }).join('');
    }
    function toggle(i, force) {
      const el2 = gridEl.querySelector('[data-i="' + i + '"]'); if (!el2 || el2.style.visibility === 'hidden') return;
      const want = force != null ? force : !state[i];
      if (want === !!state[i]) return;
      state[i] = want ? 1 : 0;
      count += want ? 1 : -1;
      if (want) {
        el2.style.transform = 'scale(.86)';
        el2.style.background = 'radial-gradient(circle at 35% 30%,#b8508a,#7d2c5c 60%,#4a1a38)';
        noiseSound(0.05, 0.2, 700 + ri(-80, 120), 5);
        count = Math.max(count, 0);
      } else {
        el2.style.transform = 'scale(1)';
        el2.style.background = 'radial-gradient(circle at 35% 30%,#ffd9ec,#ff78b4 55%,#c04a86)';
        tone(520, 0.05, 'sine', 0.12);
      }
      $('#popDown').textContent = count;
    }
    gridEl.addEventListener('pointerdown', e => {
      const d = e.target.closest('.pop'); if (!d) return;
      unlockAudio(); down = true; toggle(+d.dataset.i);
    });
    gridEl.addEventListener('pointermove', e => { if (down) { const d = e.target.closest('.pop'); if (d) toggle(+d.dataset.i, true); } });
    window.addEventListener('pointerup', () => { down = false; });
    bindRange('#popN', () => build());
    bindPills('#popShape', v => { shape = v; build(); });
    bindCtrl({ start: () => { }, pause: () => { }, reset: build });
    ctlEl('#gStart').textContent = '全部弹回';
    build();
  };

  /* ---------------- 转盘 ---------------- */
  G['spin-the-wheel'] = function (host) {
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          <div id="swWrap" style="position:relative"></div>
          <div class="runnote" id="swMsg">编辑右侧列表后点「转！」。列表每行可以是「选项」或「选项,权重」。</div>
        </div>
      </div>
      ${paneBox('转盘', '支持权重：权重越大，扇区越宽、越容易被选中。指针固定在上方。',
      `${TUI.field('选项（每行一个，可写「选项,权重」）', TUI.area('swList', '吃火锅\n吃寿司\n吃汉堡\n吃沙拉,0.5\n吃面条\n吃烧烤', '', 10))}
        <button class="btn-lime btn-run" id="swGo">转！</button>
        <div class="outbox" id="swOut">—</div>
        <div class="runnote">最近 10 次结果保存在本机。</div>`)}
    </div>`;
    const C = mkCanvas($('#swWrap'), 420, 420);
    const ctx = C.ctx;
    let angle = 0, spinning = false, vel = 0, items = [], targetAngle = 0, decel = 0, result = null;
    const COLORS = ['#d7f452', '#5fd0ff', '#ff8fb1', '#ffd166', '#9be564', '#c39bff', '#ff9f6b', '#7ee0c5'];
    function parse() {
      items = $('#swList').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
        const p = l.split(/[,，]\s*/);
        const w = p.length > 1 ? Math.max(0.01, parseFloat(p[1]) || 1) : 1;
        return { t: p[0], w: w };
      });
      if (!items.length) items = [{ t: '空', w: 1 }];
    }
    function draw() {
      const W = C.W, R = W / 2 - 12, cx = W / 2, cy = W / 2;
      ctx.clearRect(0, 0, W, W);
      const total = items.reduce((a, b) => a + b.w, 0);
      let a0 = angle;
      items.forEach((it, i) => {
        const sweep = it.w / total * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a0, a0 + sweep); ctx.closePath();
        ctx.fillStyle = COLORS[i % COLORS.length]; ctx.fill();
        ctx.strokeStyle = '#0b0b0b'; ctx.lineWidth = 2; ctx.stroke();
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(a0 + sweep / 2);
        ctx.fillStyle = '#0b0b0b'; ctx.font = '600 14px Inter,sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        const label = it.t.length > 14 ? it.t.slice(0, 13) + '…' : it.t;
        ctx.fillText(label, R - 12, 0);
        ctx.restore();
        a0 += sweep;
      });
      ctx.beginPath(); ctx.arc(cx, cy, 16, 0, Math.PI * 2); ctx.fillStyle = '#0b0b0b'; ctx.fill(); ctx.strokeStyle = '#d7f452'; ctx.lineWidth = 3; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - R - 4); ctx.lineTo(cx - 12, cy - R - 22); ctx.lineTo(cx + 12, cy - R - 22); ctx.closePath();
      ctx.fillStyle = '#d7f452'; ctx.fill();
    }
    function spin() {
      if (spinning) return;
      parse(); result = null; $('#swOut').textContent = '转动中…';
      const total = items.reduce((a, b) => a + b.w, 0);
      let r = Math.random() * total, pick = 0;
      for (let i = 0; i < items.length; i++) { r -= items[i].w; if (r <= 0) { pick = i; break; } }
      let acc = 0; for (let i = 0; i < pick; i++) acc += items[i].w;
      const start = acc / total * Math.PI * 2, sweep = items[pick].w / total * Math.PI * 2;
      const mid = start + sweep / 2;
      targetAngle = -Math.PI / 2 - mid + Math.PI * 2 * (4 + ri(0, 2));
      vel = 0; spinning = true; decel = 0;
      tone(300, 0.05, 'square', 0.08);
    }
    const loop = Loop(dt => {
      if (spinning) {
        const remain = (targetAngle - angle);
        if (Math.abs(remain) < 0.004) {
          angle = targetAngle % (Math.PI * 2);
          spinning = false;
          const total = items.reduce((a, b) => a + b.w, 0);
          const norm = ((-Math.PI / 2 - angle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
          let acc = 0, pick = items.length - 1;
          for (let i = 0; i < items.length; i++) { const s = items[i].w / total * Math.PI * 2; if (norm >= acc && norm < acc + s) { pick = i; break; } acc += s; }
          result = items[pick].t;
          $('#swOut').innerHTML = '<b style="color:#d7f452;font-size:20px">' + esc(result) + '</b>';
          tone(660, 0.1, 'triangle', 0.16); tone(990, 0.18, 'triangle', 0.14, 0.1);
          const his = load('wheel.history', []); his.unshift(result); save('wheel.history', his.slice(0, 10));
        } else {
          angle += remain * Math.min(1, dt * 3.2);
          const tick = Math.floor(angle / (Math.PI / 12));
          if (tick !== loopTick) { loopTick = tick; if (Math.random() < 0.35) tone(1200, 0.02, 'square', 0.03); }
        }
      }
      draw();
    });
    let loopTick = 0;
    $('#swGo').addEventListener('click', spin);
    C.cv.addEventListener('click', e => { unlockAudio(); spin(); });
    bindCtrl({ start: () => loop.start(), pause: () => loop.stop(), reset: () => { angle = 0; result = null; parse(); $('#swOut').textContent = '—'; } });
    ctlEl('#gStart').textContent = '启动动画';
    $('#swList').addEventListener('change', () => { parse(); });
    parse(); loop.start();
  };

  /* ---------------- 骰子 ---------------- */
  G['dice-roller'] = function (host) {
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          ${scorebar([['总和', 'drSum'], ['次数', 'drRolls']])}
          <div id="drWrap"></div>
          <div class="outbox" id="drHist" style="width:min(100%,560px);font-size:12.5px">—</div>
        </div>
      </div>
      ${paneBox('骰子', '1–6 颗骰子，翻滚动画是真随机 + 缓动，不是预设动画。',
      `${TUI.field('骰子数量', TUI.range('drN', 1, 6, 2, 1))}
        <div class="plabel">面数</div>${TUI.sel('drSides', [{ v: '6', t: 'd6（标准）' }, { v: '4', t: 'd4' }, { v: '8', t: 'd8' }, { v: '12', t: 'd12' }, { v: '20', t: 'd20' }], '6')}
        <button class="btn-lime btn-run" id="drGo">掷骰子</button>
        <button class="btn-ghost btn-sm" id="drClear" style="width:100%;justify-content:center;margin-top:10px">清空记录</button>
        <div class="runnote">空格键也可以掷。</div>`)}
    </div>`;
    const C = mkCanvas($('#drWrap'), 560, 180);
    let values = [], anim = 0, rolls = 0, history = [];
    function n() { return +$('#drN').value; }
    function sides() { return +$('#drSides').value; }
    function pip(v, x, y, s) {
      const p = { 1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [0, 2], [2, 0], [2, 2]], 5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]], 6: [[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]] }[v] || [[1, 1]];
      p.forEach(q => { C.ctx.beginPath(); C.ctx.arc(x + (q[0] + 0.5) * s / 3, y + (q[1] + 0.5) * s / 3, s * 0.075, 0, Math.PI * 2); C.ctx.fillStyle = '#0b0b0b'; C.ctx.fill(); });
    }
    function draw() {
      const W = C.W, H = C.H;
      C.ctx.clearRect(0, 0, W, H);
      const count = values.length || n();
      const gap = 14, size = Math.min(120, (W - gap * (count + 1)) / count);
      const y = (H - size) / 2;
      for (let i = 0; i < count; i++) {
        const x = gap + i * (size + gap);
        const v = values[i] || 1;
        const sq = v <= 6 ? 1 : 1;
        C.ctx.fillStyle = '#f4f1e8';
        C.ctx.beginPath();
        const rr = 14;
        C.ctx.moveTo(x + rr, y); C.ctx.lineTo(x + size - rr, y); C.ctx.quadraticCurveTo(x + size, y, x + size, y + rr);
        C.ctx.lineTo(x + size, y + size - rr); C.ctx.quadraticCurveTo(x + size, y + size, x + size - rr, y + size);
        C.ctx.lineTo(x + rr, y + size); C.ctx.quadraticCurveTo(x, y + size, x, y + size - rr);
        C.ctx.lineTo(x, y + rr); C.ctx.quadraticCurveTo(x, y, x + rr, y); C.ctx.closePath(); C.ctx.fill();
        if (v <= 6) pip(v, x, y, size);
        else {
          C.ctx.fillStyle = '#0b0b0b'; C.ctx.font = '800 ' + (size * 0.5) + 'px Inter,sans-serif'; C.ctx.textAlign = 'center'; C.ctx.textBaseline = 'middle';
          C.ctx.fillText(v, x + size / 2, y + size / 2);
        }
      }
    }
    function roll() {
      const count = n(), sd = sides();
      values = Array.from({ length: count }, () => ri(1, sd));
      rolls++;
      $('#drSum').textContent = values.reduce((a, b) => a + b, 0);
      $('#drRolls').textContent = rolls;
      history.unshift(values.join(' + ') + ' = ' + values.reduce((a, b) => a + b, 0));
      $('#drHist').textContent = history.slice(0, 8).join('   ·   ');
      tone(400, 0.04, 'square', 0.08);
      for (let i = 0; i < 6; i++) setTimeout(() => { values = values.map(v => ri(1, sd) <= sd ? v : v); draw(); }, i * 55);
    }
    C.cv.addEventListener('click', () => { unlockAudio(); roll(); });
    keys({ ' ': () => roll() });
    bindRange('#drN', () => { values = []; draw(); });
    $('#drSides').addEventListener('change', () => { values = []; draw(); });
    $('#drGo').addEventListener('click', roll);
    $('#drClear').addEventListener('click', () => { history = []; rolls = 0; $('#drHist').textContent = '—'; $('#drRolls').textContent = '0'; });
    values = Array.from({ length: 2 }, () => 1); draw();
    bindCtrl({
      start: roll, pause: () => { },
      reset: () => { values = []; rolls = 0; history = []; $('#drHist').textContent = '—'; $('#drRolls').textContent = '0'; $('#drSum').textContent = '0'; draw(); }
    });
    ctlEl('#gStart').textContent = '掷骰子';
    ctlEl('#gPause').textContent = '暂停动画';
    ctlEl('#gPause').addEventListener('click', () => { });
    ctlEl('#gReset').textContent = '清空记录';
  };

  /* ---------------- 抛硬币 ---------------- */
  G['flip-a-coin'] = function (host) {
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          ${scorebar([['正面', 'cnH'], ['反面', 'cnT'], ['总次数', 'cnN']])}
          <div id="cnWrap"></div>
          <div class="runnote">币面翻飞是 CSS 3D 变换，落定结果用 crypto.getRandomValues 生成。</div>
        </div>
      </div>
      ${paneBox('抛硬币', '统计正面/反面次数，数据保存在本机。',
      `<button class="btn-lime btn-run" id="cnGo">抛！</button>
        <div class="plabel">连续抛</div>${TUI.range('cnBatch', 1, 50, 1, 1)}
        <div class="outbox" id="cnOut">—</div>
        <button class="btn-ghost btn-sm" id="cnClear" style="width:100%;justify-content:center;margin-top:10px">清空统计</button>`)}
    </div>`;
    const wrap = $('#cnWrap');
    wrap.innerHTML = `<div style="perspective:700px;width:min(100%,340px)"><div id="cnCoin" style="width:150px;height:150px;margin:0 auto;position:relative;transform-style:preserve-3d;transition:transform 1.1s cubic-bezier(.2,.7,.3,1)">
      <div style="position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle at 34% 30%,#ffe9a8,#d9a72c 60%,#8a6712);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:44px;color:#6a4c08;backface-visibility:hidden">正</div>
      <div style="position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle at 34% 30%,#f4f1e8,#bdb8a6 60%,#7b7466);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:44px;color:#4a463a;transform:rotateY(180deg);backface-visibility:hidden">反</div>
    </div></div>`;
    const coin = $('#cnCoin');
    let stats = load('coin.stats', { h: 0, t: 0 });
    let rot = 0, busy = false;
    function paint() { $('#cnH').textContent = stats.h; $('#cnT').textContent = stats.t; $('#cnN').textContent = stats.h + stats.t; }
    function rnd() { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; }
    function flip() {
      if (busy) return;
      busy = true; unlockAudio();
      const batch = +$('#cnBatch').value;
      const res = [];
      for (let i = 0; i < batch; i++) res.push(rnd() < 0.5 ? 'h' : 't');
      res.forEach(r => stats[r]++);
      save('coin.stats', stats);
      const last = res[res.length - 1];
      rot += 360 * (batch > 1 ? 3 : 3) + (last === 'h' ? 0 : 180);
      coin.style.transform = 'rotateY(' + rot + 'deg)';
      tone(700, 0.06, 'triangle', 0.12);
      setTimeout(() => {
        busy = false;
        if (batch === 1) $('#cnOut').innerHTML = '结果：<b style="color:#d7f452">' + (last === 'h' ? '正面' : '反面') + '</b>';
        else $('#cnOut').innerHTML = '本批：正面 <b>' + res.filter(r => r === 'h').length + '</b> · 反面 <b>' + res.filter(r => r === 't').length + '</b>';
        paint();
        tone(last === 'h' ? 880 : 620, 0.12, 'triangle', 0.12, 0.1);
      }, 1150);
    }
    $('#cnGo').addEventListener('click', flip);
    coin.addEventListener('click', flip);
    $('#cnClear').addEventListener('click', () => { stats = { h: 0, t: 0 }; save('coin.stats', stats); paint(); });
    bindCtrl({ start: flip, pause: () => { }, reset: () => { rot = 0; coin.style.transform = ''; } });
    bindRange('#cnBatch', () => { });
    ctlEl('#gStart').textContent = '抛硬币';
    ctlEl('#gPause').style.display = 'none';
    ctlEl('#gReset').textContent = '重置动画';
    paint();
  };

  /* ---------------- 名字赛跑 / 名次赛跑 ---------------- */
  G['random-name-race'] = function (host) {
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          <div id="nrWrap"></div>
          <div class="outbox" id="nrOut" style="width:min(100%,700px)">—</div>
        </div>
      </div>
      ${paneBox('随机名次赛跑', '输入名单，每轮随机推进，先到终点者获胜。用 crypto 随机源，不是预设结果。',
      `${TUI.field('参赛者（每行一个）', TUI.area('nrList', '小明\n小红\n小刚\n小美\n阿强', '', 8))}
        <button class="btn-lime btn-run" id="nrGo">开始比赛</button>
        <div class="plabel">速度</div>${TUI.range('nrSpeed', 1, 10, 5, 1)}
        <div class="runnote">结果可以直接复制。</div>`)}
    </div>`;
    const C = mkCanvas($('#nrWrap'), 700, 380);
    let names = [], pos = [], running = false, finished = [], speedMul = 5;
    function rnd() { const a = new Uint32Array(4); crypto.getRandomValues(a); return (a[0] + a[1] + a[2] + a[3]) / 17179869184; }
    function parse() { names = $('#nrList').value.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 12); if (!names.length) names = ['选手']; }
    function reset() { parse(); pos = names.map(() => 0); finished = []; $('#nrOut').textContent = '—'; draw(); }
    function startRace() { reset(); running = true; tone(660, 0.1, 'triangle', 0.12); }
    function draw() {
      const W = C.W, H = C.H;
      C.ctx.fillStyle = '#0d0d0d'; C.ctx.fillRect(0, 0, W, H);
      const laneH = Math.min(46, (H - 20) / Math.max(1, names.length));
      const goal = W - 70;
      C.ctx.strokeStyle = '#d7f452'; C.ctx.setLineDash([6, 6]); C.ctx.beginPath(); C.ctx.moveTo(goal, 8); C.ctx.lineTo(goal, H - 8); C.ctx.stroke(); C.ctx.setLineDash([]);
      names.forEach((nm, i) => {
        const y = 14 + i * laneH;
        C.ctx.fillStyle = '#1a1a1a'; C.ctx.fillRect(0, y, W, laneH - 8);
        const x = pos[i] * goal;
        C.ctx.fillStyle = finished.indexOf(i) === 0 ? '#d7f452' : finished.indexOf(i) >= 0 ? '#8fae1e' : '#5fd0ff';
        C.ctx.beginPath(); C.ctx.arc(16 + x, y + (laneH - 8) / 2, Math.min(11, (laneH - 14) / 2), 0, Math.PI * 2); C.ctx.fill();
        C.ctx.fillStyle = '#e5e5e5'; C.ctx.font = '600 13px Inter,sans-serif'; C.ctx.textAlign = 'left'; C.ctx.textBaseline = 'middle';
        C.ctx.fillText(nm, 16 + x + 16, y + (laneH - 8) / 2);
      });
    }
    const loop = Loop(dt => {
      if (running) {
        let allDone = true;
        for (let i = 0; i < names.length; i++) {
          if (finished.indexOf(i) >= 0) continue;
          allDone = false;
          pos[i] += rnd() * 0.14 * speedMul * dt * 3;
          if (pos[i] >= 1) { pos[i] = 1; finished.push(i); tone(700 + finished.length * 90, 0.08, 'triangle', 0.12); }
        }
        if (allDone || finished.length === names.length) {
          running = false;
          const list = finished.map((i, k) => (k + 1) + '. ' + names[i]).join('   ');
          $('#nrOut').innerHTML = '最终名次：<b style="color:#d7f452">' + esc(list) + '</b>';
        }
      }
      draw();
    });
    $('#nrGo').addEventListener('click', startRace);
    $('#nrList').addEventListener('change', reset);
    bindRange('#nrSpeed', v => { speedMul = v; });
    bindCtrl({ start: startRace, pause: () => { running = false; }, reset: reset });
    ctlEl('#gStart').textContent = '开始比赛';
    reset(); loop.start();
  };
  G['bar-chart-race-maker'] = function (host) {
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          <div id="bcWrap"></div>
          <div class="runnote" id="bcMsg">输入「名称,数值」，点播放，柱子会按数值重新排序生长。</div>
        </div>
      </div>
      ${paneBox('柱状图赛跑', '用 Canvas 实时排序绘制的动态条形图（原站叫 Bar Chart Race）。',
      `${TUI.field('数据（每行「名称,数值」）', TUI.area('bcData', '产品 A,420\n产品 B,390\n产品 C,310\n产品 D,260\n产品 E,180\n产品 F,120', '', 10))}
        <button class="btn-lime btn-run" id="bcPlay">播放</button>
        <div class="plabel">时长（秒）</div>${TUI.range('bcDur', 2, 12, 6, 1)}
        <div class="shapes" style="margin-top:12px"><button class="btn-ghost btn-sm" id="bcPng">导出 PNG</button></div>`)}
    </div>`;
    const C = mkCanvas($('#bcWrap'), 700, 400);
    let data = [], t = 0, playing = false, dur = 6;
    const COLORS = ['#d7f452', '#5fd0ff', '#ff8fb1', '#ffd166', '#9be564', '#c39bff', '#ff9f6b'];
    function parse() {
      data = $('#bcData').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
        const p = l.split(/[,，\s]+/);
        return { name: p[0], v: Math.max(0, parseFloat(p[1]) || 0) };
      }).slice(0, 15);
      t = 0;
    }
    function draw() {
      const W = C.W, H = C.H;
      C.ctx.fillStyle = '#0d0d0d'; C.ctx.fillRect(0, 0, W, H);
      const p = clamp(t / dur, 0, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const rows = data.map(d => ({ name: d.name, cur: d.v * eased, v: d.v })).sort((a, b) => b.cur - a.cur);
      const max = Math.max(1, Math.max.apply(null, rows.map(r => r.cur)));
      const rowH = Math.min(48, (H - 20) / Math.max(1, rows.length));
      rows.forEach((r, i) => {
        const y = 12 + i * rowH;
        const w = r.cur / max * (W - 220);
        C.ctx.fillStyle = COLORS[i % COLORS.length];
        C.ctx.fillRect(0, y + rowH * 0.18, Math.max(2, w), rowH * 0.62);
        C.ctx.fillStyle = '#e5e5e5'; C.ctx.font = '600 14px Inter,sans-serif'; C.ctx.textAlign = 'left'; C.ctx.textBaseline = 'middle';
        C.ctx.fillText(r.name, w + 12, y + rowH / 2);
        C.ctx.fillStyle = '#d7f452'; C.ctx.textAlign = 'right';
        C.ctx.fillText(Math.round(r.cur).toLocaleString(), W - 8, y + rowH / 2);
      });
      C.ctx.fillStyle = '#8a8a8a'; C.ctx.font = '12px Inter,sans-serif'; C.ctx.textAlign = 'right'; C.ctx.textBaseline = 'top';
      C.ctx.fillText(Math.round(eased * 100) + '%', W - 8, 4);
    }
    const loop = Loop(dt => {
      if (playing) { t += dt; if (t > dur + 0.6) { t = dur; playing = false; } }
      draw();
    });
    $('#bcPlay').addEventListener('click', () => { parse(); t = 0; playing = true; });
    $('#bcData').addEventListener('change', () => { parse(); draw(); });
    $('#bcPng').addEventListener('click', () => pngOf(C.cv, 'bar-chart-race.png'));
    bindRange('#bcDur', v => { dur = v; });
    bindCtrl({ start: () => { parse(); t = 0; playing = true; }, pause: () => { playing = false; }, reset: () => { t = 0; playing = false; draw(); } });
    parse(); draw(); loop.start();
  };

  /* ---------------- 指尖陀螺 ---------------- */
  G['fidget-spinner'] = function (host) {
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          ${scorebar([['转速', 'fsRpm'], ['总圈数', 'fsTurns'], ['最长连续', 'fsBest', null, '0 圈']])}
          <div id="fsWrap"></div>
          <div class="runnote">按住并横向甩动陀螺，松手后靠惯性继续转；转速越快风声越尖。</div>
        </div>
      </div>
      ${paneBox('指尖陀螺', '转动惯量 + 阻尼积分；声音是一个随转速变调的带通噪声，不是音频文件。',
      ctrlRow('<button class="btn-ghost btn-sm" id="fsFlick">随手一甩</button>') +
      `<div class="plabel">阻尼（越大停得越快）</div>${TUI.range('fsFriction', 1, 30, 6, 1)}
        <div class="plabel">轴承顺滑度</div>${TUI.range('fsBearing', 1, 10, 7, 1)}
        <div class="plabel">声音</div>${TUI.chk('fsSound', '开启转动音效', true)}
        <div class="runnote">最高连续圈数写 wsft:spinner。</div>`)}
    </div>`;
    const C = mkCanvas($('#fsWrap'), 420, 420);
    let ang = 0, vel = 0, dragging = false, lastX = 0, lastT = 0, turns = 0, soundOn = true, audio = null;
    function startWhir() {
      if (!soundOn) return;
      const c = ac(); if (!c) return;
      if (!audio) {
        const n = Math.floor(c.sampleRate * 2);
        const buf = c.createBuffer(1, n, c.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
        const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
        const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3.2; f.frequency.value = 500;
        const g = c.createGain(); g.gain.value = 0;
        src.connect(f); f.connect(g); g.connect(c.destination); src.start();
        audio = { src: src, f: f, g: g };
      }
    }
    function stopWhir() { if (audio) { try { audio.g.gain.value = 0; } catch (e) { } } }
    function draw() {
      const W = C.W, cx = W / 2, cy = W / 2, R = W * 0.3;
      C.ctx.clearRect(0, 0, W, W);
      C.ctx.save(); C.ctx.translate(cx, cy);
      C.ctx.strokeStyle = '#2a2a2a'; C.ctx.lineWidth = 2;
      C.ctx.beginPath(); C.ctx.arc(0, 0, R + 28, 0, Math.PI * 2); C.ctx.stroke();
      C.ctx.rotate(ang);
      for (let i = 0; i < 3; i++) {
        C.ctx.save(); C.ctx.rotate(i * Math.PI * 2 / 3);
        C.ctx.fillStyle = i === 0 ? '#d7f452' : i === 1 ? '#5fd0ff' : '#ff8fb1';
        C.ctx.beginPath();
        C.ctx.moveTo(0, -14); C.ctx.quadraticCurveTo(R, -34, R + 16, 0); C.ctx.quadraticCurveTo(R, 34, 0, 14);
        C.ctx.closePath(); C.ctx.fill();
        C.ctx.beginPath(); C.ctx.arc(R - 4, 0, 12, 0, Math.PI * 2); C.ctx.fillStyle = '#0b0b0b'; C.ctx.fill();
        C.ctx.restore();
      }
      C.ctx.restore();
      C.ctx.beginPath(); C.ctx.arc(cx, cy, 20, 0, Math.PI * 2); C.ctx.fillStyle = '#2a2a2a'; C.ctx.fill();
      C.ctx.strokeStyle = '#555'; C.ctx.stroke();
      C.ctx.fillStyle = '#0b0b0b'; C.ctx.font = '700 13px Inter,sans-serif'; C.ctx.textAlign = 'center'; C.ctx.textBaseline = 'middle';
      C.ctx.fillText('WS', cx, cy);
    }
    const loop = Loop(dt => {
      if (!dragging) {
        const fr = +$('#fsFriction').value / 100;
        vel *= Math.exp(-fr * dt * 3);
        if (Math.abs(vel) < 0.02) vel = 0;
        const prev = ang;
        ang += vel * dt;
        if (Math.floor(Math.abs(ang) / (Math.PI * 2)) > Math.floor(Math.abs(prev) / (Math.PI * 2))) {
          turns++;
          $('#fsTurns').textContent = Math.floor(Math.abs(ang) / (Math.PI * 2));
        }
      }
      $('#fsRpm').textContent = Math.round(Math.abs(vel) * 60 / (Math.PI * 2));
      if (Math.abs(vel) > 0.01) {
        if (!audio) startWhir();
        if (audio) {
          const v = clamp(Math.abs(vel) / 28, 0, 1);
          audio.g.gain.value = soundOn ? v * 0.06 : 0;
          audio.f.frequency.value = 380 + Math.min(2400, Math.abs(vel) * 130);
        }
      } else stopWhir();
      draw();
    });
    function pdown(e) { dragging = true; lastX = (e.touches ? e.touches[0].clientX : e.clientX); lastT = performance.now(); unlockAudio(); startWhir(); }
    function pmove(e) {
      if (!dragging) return;
      const x = (e.touches ? e.touches[0].clientX : e.clientX);
      const now = performance.now();
      const dx = x - lastX, dtm = Math.max(8, now - lastT) / 1000;
      vel = clamp(dx / dtm / 60, -40, 40);
      ang += dx * 0.045;
      lastX = x; lastT = now;
    }
    function pup() { dragging = false; }
    C.cv.addEventListener('pointerdown', pdown);
    window.addEventListener('pointermove', pmove);
    window.addEventListener('pointerup', pup);
    C.cv.addEventListener('touchstart', e => { pdown(e); }, { passive: true });
    window.addEventListener('touchmove', e => { if (dragging) { pmove(e); e.preventDefault(); } }, { passive: false });
    window.addEventListener('touchend', pup);
    $('#fsFlick').addEventListener('click', () => { unlockAudio(); vel = rf(12, 30) * (Math.random() < 0.5 ? -1 : 1); startWhir(); });
    bindChk('#fsSound', v => { soundOn = v; if (!v) stopWhir(); });
    bindCtrl({ start: () => loop.start(), pause: () => { vel = 0; }, reset: () => { ang = 0; vel = 0; turns = 0; $('#fsTurns').textContent = '0'; } });
    ctlEl('#gStart').textContent = '启动动画';
    ctlEl('#gPause').textContent = '急停';
    loop.start();
  };
  G['fidget-spinner-online'] = G['fidget-spinner'];

  /* ---------------- 在线钢琴 ---------------- */
  function midiFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function encodeWAV(channels, sampleRate) {
    const len = channels[0].length;
    const buffer = new ArrayBuffer(44 + len * 2);
    const view = new DataView(buffer);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); view.setUint32(4, 36 + len * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); ws(36, 'data'); view.setUint32(40, len * 2, true);
    let o = 44;
    for (let i = 0; i < len; i++) { const s = clamp(channels[0][i], -1, 1); view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true); o += 2; }
    return buffer;
  }
  function synthIntoUnused() { return null; }

  G['online-piano'] = function (host) {
    const WHITE = [{ m: 60, n: 'C' }, { m: 62, n: 'D' }, { m: 64, n: 'E' }, { m: 65, n: 'F' }, { m: 67, n: 'G' }, { m: 69, n: 'A' }, { m: 71, n: 'B' }, { m: 72, n: 'C' }, { m: 74, n: 'D' }, { m: 76, n: 'E' }, { m: 77, n: 'F' }, { m: 79, n: 'G' }, { m: 81, n: 'A' }, { m: 83, n: 'B' }];
    const BLACK = [{ m: 61, a: 1 }, { m: 63, a: 2 }, { m: 66, a: 4 }, { m: 68, a: 5 }, { m: 70, a: 6 }, { m: 73, a: 8 }, { m: 75, a: 9 }, { m: 78, a: 11 }, { m: 80, a: 12 }, { m: 82, a: 13 }];
    const KEYMAP = { a: 60, w: 61, s: 62, e: 63, d: 64, f: 65, t: 66, g: 67, y: 68, h: 69, u: 70, j: 71, k: 72, o: 73, l: 74, p: 75, ';': 76, "'": 77 };
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap" style="width:100%">
          <div class="scorebar" style="margin-bottom:6px"><span>音色 <b id="pnWaveOut">triangle</b></span><span>音量 <b id="pnVolOut">50</b></span></div>
          <div id="pnKeys" style="position:relative;width:min(100%,860px);height:210px;user-select:none;touch-action:none"></div>
          <div class="runnote">键盘映射：A S D F G H J K L ; 对应白键，W E T Y U O P 对应黑键。</div>
        </div>
      </div>
      ${paneBox('在线钢琴', 'Web Audio 合成器：振荡器 + ADSR 包络（起音/衰减/保持/释放）+ 轻微低通滤波。',
      `<div class="plabel">音色</div>${TUI.sel('pnTimbre', [{ v: 'triangle', t: '电子琴（triangle）' }, { v: 'sine', t: '柔音（sine）' }, { v: 'sawtooth', t: '弦乐（sawtooth）' }, { v: 'square', t: '方波（square）' }], 'triangle')}
        <div class="plabel">音量</div>${TUI.range('pnVol', 0, 100, 50, 1)}
        <div class="plabel">延音（秒）</div>${TUI.range('pnSustain', 1, 30, 12, 1)}
        <div class="shapes" style="margin-top:12px;gap:8px">
          <button class="btn-lime btn-sm" id="pnRec">开始录音</button>
          <button class="btn-ghost btn-sm" id="pnPlay">回放</button>
          <button class="btn-ghost btn-sm" id="pnWav">导出 WAV</button>
          <button class="btn-ghost btn-sm" id="pnClear">清空录音</button>
        </div>
        <div class="outbox" id="pnOut">录音：0 个音符</div>
        <div class="runnote">导出使用 OfflineAudioContext 离线渲染 + 手写 WAV 编码，全程本地。</div>`)}
    </div>`;
    const keysEl = $('#pnKeys');
    let rec = [], recording = false, recStart = 0, playing = false;
    function build() {
      keysEl.innerHTML = '';
      const w = 100 / WHITE.length;
      WHITE.forEach((k, i) => {
        const d = el('div');
        d.className = 'wkey'; d.dataset.m = k.m;
        d.style.cssText = 'position:absolute;left:' + (i * w) + '%;top:0;width:' + (w - 0.3) + '%;height:100%;background:linear-gradient(#fff,#eee);border-radius:0 0 8px 8px;border:1px solid #999;box-sizing:border-box;cursor:pointer;display:flex;align-items:flex-end;justify-content:center;padding-bottom:8px;color:#777;font-size:11px';
        d.textContent = k.n;
        keysEl.appendChild(d);
      });
      BLACK.forEach(k => {
        const d = el('div');
        d.className = 'bkey'; d.dataset.m = k.m;
        d.style.cssText = 'position:absolute;left:calc(' + (k.a * w - w * 0.3) + '%);top:0;width:' + (w * 0.6) + '%;height:62%;background:linear-gradient(#333,#111);border-radius:0 0 6px 6px;border:1px solid #000;box-sizing:border-box;cursor:pointer;z-index:2';
        keysEl.appendChild(d);
      });
    }
    function press(m, on) {
      const d = keysEl.querySelector('[data-m="' + m + '"]');
      if (d) d.style.background = on ? (d.classList.contains('bkey') ? 'linear-gradient(#666,#333)' : 'linear-gradient(#d7f452,#b1cc39)') : (d.classList.contains('bkey') ? 'linear-gradient(#333,#111)' : 'linear-gradient(#fff,#eee)');
    }
    function playNote(m, dur) {
      const c = ac(); if (!c) return;
      const type = $('#pnTimbre').value;
      const vol = (+$('#pnVol').value) / 100 * 0.5;
      const t0 = c.currentTime;
      const o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
      o.type = type; o.frequency.value = midiFreq(m);
      o2.type = 'sine'; o2.frequency.value = midiFreq(m) * 2; o2.detune.value = 4;
      f.type = 'lowpass'; f.frequency.value = 6000; f.Q.value = 0.6;
      o.connect(f); o2.connect(f); f.connect(g); g.connect(c.destination);
      const atk = 0.008, dec = 0.16, sus = (+$('#pnSustain').value) / 10, rel = 0.35;
      const hold = dur || sus;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + atk);
      g.gain.exponentialRampToValueAtTime(vol * 0.62, t0 + atk + dec);
      g.gain.setValueAtTime(vol * 0.62, t0 + atk + dec + hold);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + atk + dec + hold + rel);
      o.start(t0); o2.start(t0);
      o.stop(t0 + atk + dec + hold + rel + 0.05); o2.stop(t0 + atk + dec + hold + rel + 0.05);
      const d = keysEl.querySelector('[data-m="' + m + '"]');
      if (d) { d.style.transform = 'translateY(2px)'; setTimeout(() => { d.style.transform = ''; }, 110); }
    }
    function hit(m) {
      unlockAudio();
      playNote(m);
      if (recording) rec.push({ m: m, t: (performance.now() - recStart) / 1000, d: 0.5 });
      updateOut();
    }
    function updateOut() { $('#pnOut').textContent = '录音：' + rec.length + ' 个音符' + (recording ? '（录制中…）' : ''); }
    keysEl.addEventListener('pointerdown', e => {
      const d = e.target.closest('[data-m]'); if (!d) return;
      hit(+d.dataset.m);
      const m = +d.dataset.m;
      press(m, true);
      window.__pnUp = () => press(m, false);
    });
    window.addEventListener('pointerup', () => { if (window.__pnUp) { window.__pnUp(); window.__pnUp = null; } });
    window.addEventListener('keydown', e => {
      const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      const m = KEYMAP[e.key.toLowerCase()];
      if (m != null && !e.repeat) { e.preventDefault(); hit(m); press(m, true); }
    });
    window.addEventListener('keyup', e => { const m = KEYMAP[e.key.toLowerCase()]; if (m != null) press(m, false); });
    $('#pnRec').addEventListener('click', () => {
      recording = !recording;
      if (recording) { rec = []; recStart = performance.now(); $('#pnRec').textContent = '停止录音'; }
      else { $('#pnRec').textContent = '开始录音'; }
      updateOut();
    });
    $('#pnClear').addEventListener('click', () => { rec = []; updateOut(); });
    $('#pnPlay').addEventListener('click', () => {
      if (playing || !rec.length) { if (!rec.length) window.toast('还没有录音'); return; }
      playing = true;
      const c = ac(); if (!c) { playing = false; return; }
      const base = c.currentTime + 0.05;
      const start = performance.now();
      const timers = rec.map(n => setTimeout(() => { playNote(n.m, n.d); }, n.t * 1000));
      setTimeout(() => { playing = false; }, (rec[rec.length - 1].t + 1) * 1000);
      onClean(() => timers.forEach(t => clearTimeout(t)));
    });
    $('#pnWav').addEventListener('click', async () => {
      if (!rec.length) { window.toast('先录一段再导出'); return; }
      const durSec = rec[rec.length - 1].t + 1.2;
      const sr = 22050;
      const off = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, Math.ceil(sr * durSec), sr);
      const type = $('#pnTimbre').value;
      const vol = (+$('#pnVol').value) / 100 * 0.5;
      rec.forEach(n => {
        const t0 = n.t + 0.03, hold = n.d;
        const o = off.createOscillator(), g = off.createGain(), f = off.createBiquadFilter();
        o.type = type; o.frequency.value = midiFreq(n.m);
        f.type = 'lowpass'; f.frequency.value = 6000;
        o.connect(f); f.connect(g); g.connect(off.destination);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
        g.gain.exponentialRampToValueAtTime(vol * 0.6, t0 + 0.18);
        g.gain.setValueAtTime(vol * 0.6, t0 + 0.18 + hold);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18 + hold + 0.35);
        o.start(t0); o.stop(t0 + 0.18 + hold + 0.4);
      });
      const buf = await off.startRendering();
      const wav = encodeWAV([buf.getChannelData(0)], sr);
      window.downloadBlob(new Blob([wav], { type: 'audio/wav' }), 'piano-recording.wav');
    });
    bindRange('#pnVol', v => { $('#pnVolOut').textContent = v; });
    $('#pnTimbre').addEventListener('change', () => { $('#pnWaveOut').textContent = $('#pnTimbre').value; });
    bindCtrl({ start: () => loopStart(), pause: () => { }, reset: () => { rec = []; updateOut(); } });
    ctlEl('#gStart').textContent = '试听音阶';
    ctlEl('#gPause').style.display = 'none';
    ctlEl('#gReset').textContent = '清空录音';
    function loopStart() { [60, 62, 64, 65, 67, 69, 71, 72].forEach((m, i) => setTimeout(() => hit(m), i * 260)); }
    build(); updateOut();
  };

  /* ---------------- 在线吉他（Karplus-Strong） ---------------- */
  G['online-guitar'] = function (host) {
    const TUNING = [{ n: 'E2', m: 40 }, { n: 'A2', m: 45 }, { n: 'D3', m: 50 }, { n: 'G3', m: 55 }, { n: 'B3', m: 59 }, { n: 'E4', m: 64 }];
    const CHORDS = {
      'C': [null, 3, 2, 0, 1, 0], 'G': [3, 2, 0, 0, 0, 3], 'D': [null, null, 0, 2, 3, 2], 'Am': [null, 0, 2, 2, 1, 0],
      'Em': [0, 2, 2, 0, 0, 0], 'F': [1, 3, 3, 2, 1, 1], 'A': [null, 0, 2, 2, 2, 0], 'E': [0, 2, 2, 1, 0, 0],
      'Dm': [null, null, 0, 2, 3, 1], 'Bm': [null, 2, 4, 4, 3, 2], 'B7': [null, 2, 1, 2, 0, 2], 'C7': [null, 3, 2, 3, 1, 0],
      'G7': [3, 2, 0, 0, 0, 1], 'Am7': [null, 0, 2, 0, 1, 0], 'FM7': [null, null, 3, 2, 1, 0], 'D7': [null, null, 0, 2, 1, 2]
    };
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap" style="width:100%">
          <div id="gtFret" style="width:min(100%,880px);user-select:none;touch-action:none"></div>
          <div class="runnote">点任意「弦 × 品」位置拨弦；点上方和弦按钮可整和弦扫弦。低音弦 E2 → 高音弦 E4。</div>
        </div>
      </div>
      ${paneBox('在线吉他', '拨弦音色用 Karplus-Strong 物理模型在本地逐样本合成（噪声激励 + 延迟线平均滤波），不是采样文件。',
      `<div class="plabel">和弦库（${Object.keys(CHORDS).length} 个）</div>
        <div class="shapes" id="gtChords" style="max-height:180px;overflow:auto">${Object.keys(CHORDS).map(c => TUI.pill(c, c)).join('')}</div>
        <div class="plabel">扫弦间隔（毫秒）</div>${TUI.range('gtStrum', 0, 240, 55, 5)}
        <div class="plabel">衰减（秒）</div>${TUI.range('gtDecay', 1, 60, 30, 1)}
        <div class="runnote">所有声音在本地合成，没有音频文件。</div>`)}
    </div>`;
    const fretEl = $('#gtFret');
    const FRETS = 13;
    let audioCtx = null;
    function ksBuffer(freq, dur, bright) {
      const c = ac(); if (!c) return null;
      const sr = c.sampleRate;
      const N = Math.max(2, Math.round(sr / freq));
      const len = Math.floor(sr * dur);
      const buf = c.createBuffer(1, len, sr);
      const out = buf.getChannelData(0);
      const line = new Float32Array(N);
      for (let i = 0; i < N; i++) line[i] = Math.random() * 2 - 1;
      let prev = 0;
      const damp = 0.5 - (bright || 0.5) * 0.16;
      for (let i = 0; i < len; i++) {
        const cur = line[i % N];
        out[i] = cur;
        const next = line[(i + 1) % N];
        const v = (cur * (1 - damp) + next * damp) * 0.9965;
        line[i % N] = v;
      }
      return buf;
    }
    function pluck(stringIdx, fret) {
      const c = ac(); if (!c) return;
      const m = TUNING[stringIdx].m + fret;
      const freq = midiFreq(m);
      const dur = (+$('#gtDecay').value) / 10;
      const buf = ksBuffer(freq, dur, clamp(1 - fret / 14, 0.2, 1));
      if (!buf) return;
      const src = c.createBufferSource(); src.buffer = buf;
      const g = c.createGain(); g.gain.value = 0.42 / Math.sqrt(Math.max(1, stringIdx === 0 ? 1 : 1));
      src.connect(g); g.connect(c.destination); src.start();
      const el2 = fretEl.querySelector('[data-s="' + stringIdx + '"][data-f="' + fret + '"]');
      if (el2) { el2.style.background = '#d7f452'; setTimeout(() => { el2.style.background = el2.classList.contains('nut') ? '#e8e8e8' : '#1c1c1c'; }, 90); }
    }
    function build() {
      let html = '<div style="display:flex;gap:2px;margin-bottom:8px">' + '</div>';
      html = '<div style="position:relative;padding:10px;background:#141414;border-radius:12px">';
      TUNING.forEach((t, si) => {
        html += '<div style="display:flex;align-items:center;gap:4px;margin-bottom:4px"><span style="width:34px;font-size:11px;color:#8a8a8a">' + t.n + '</span>';
        for (let f = 0; f < FRETS; f++) {
          html += `<div data-s="${si}" class="${f === 0 ? 'nut' : ''}" data-f="${f}" style="flex:1;height:26px;border-radius:3px;background:${f === 0 ? '#e8e8e8' : '#1c1c1c'};border:1px solid #2a2a2a;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:9px;color:#555">${f === 0 ? 'O' : ''}</div>`;
        }
        html += '</div>';
      });
      html += '<div style="display:flex;gap:4px;margin-left:38px;color:#555;font-size:10px">' + Array.from({ length: FRETS }, (_, i) => '<span style="flex:1;text-align:center">' + i + '</span>').join('') + '</div>';
      html += '</div>';
      fretEl.innerHTML = html;
    }
    fretEl.addEventListener('pointerdown', e => {
      const d = e.target.closest('[data-s]'); if (!d) return;
      unlockAudio(); pluck(+d.dataset.s, +d.dataset.f);
    });
    $('#gtChords').addEventListener('click', e => {
      const b = e.target.closest('.shape'); if (!b) return;
      unlockAudio();
      const name = b.dataset.v; const shape = CHORDS[name];
      const gap = +$('#gtStrum').value;
      shape.forEach((f, si) => { if (f == null) return; setTimeout(() => pluck(si, f), si * gap); });
    });
    bindChk('#gtSound', () => { });
    bindCtrl({ start: () => { unlockAudio(); [0, 1, 2, 3, 4, 5].forEach((s, i) => setTimeout(() => pluck(s, 0), i * 260)); }, pause: () => { }, reset: () => { } });
    ctlEl('#gStart').textContent = '扫弦试听';
    ctlEl('#gPause').style.display = 'none';
    ctlEl('#gReset').style.display = 'none';
    build();
  };

  /* ==========================================================================
     B. 物理 / 粒子模拟
     ========================================================================== */

  /* ---------------- 落沙元胞自动机 ---------------- */
  const SAND_MATS = [
    { id: 0, name: '空气', c: [13, 13, 13], solid: false },
    { id: 1, name: '沙子', c: [214, 187, 108], solid: true },
    { id: 2, name: '水', c: [64, 132, 222], solid: false, liquid: true },
    { id: 3, name: '石头', c: [120, 120, 126], solid: true, static: true },
    { id: 4, name: '火', c: [255, 122, 40], solid: false, fire: true },
    { id: 5, name: '植物', c: [92, 200, 96], solid: true, static: true },
    { id: 6, name: '酸液', c: [160, 240, 90], solid: false, liquid: true, acid: true }
  ];

  function fallingSandUI(host, slug) {
    const GW = 160, GH = 110, SCALE = 4;
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          <div id="fsCanvasWrap" style="position:relative"></div>
          <div class="runnote" id="fsTip">鼠标 / 手指在画布上涂抹，左上角选择材质。</div>
        </div>
      </div>
      ${paneBox('落沙模拟器', '六种材质（沙 / 水 / 石 / 火 / 植物 / 酸）的元胞自动机，逐格更新，用 ImageData 直接写像素。',
      `<div class="shapes" id="fsMat" style="margin-top:12px">${SAND_MATS.map((m, i) => TUI.pill(i, m.name, i === 1)).join('')}</div>
        <div class="plabel">笔刷大小</div>${TUI.range('fsBrush', 1, 14, 4, 1)}
        <div class="plabel">模拟速度（步/秒）</div>${TUI.range('fsSpeed', 10, 240, 60, 10)}
        <div class="plabel">重力</div>${TUI.range('fsGrav', 1, 5, 2, 1)}
        ${ctrlRow()}
        <div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="fsClear">清空</button><button class="btn-ghost btn-sm" id="fsPng">导出 PNG</button><button class="btn-ghost btn-sm" id="fsRain">下雨</button></div>`)}
    </div>`;
    const holder = $('#fsCanvasWrap');
    const C = mkCanvas(holder, GW * SCALE, GH * SCALE);
    C.ctx.imageSmoothingEnabled = false;
    const off = document.createElement('canvas'); off.width = GW; off.height = GH;
    const octx = off.getContext('2d');
    const img = octx.createImageData(GW, GH);
    const grid = new Uint8Array(GW * GH);
    const life = new Uint8Array(GW * GH);
    let mat = 1, brush = 4, speed = 60, grav = 2, acc = 0, paused = false, painting = false;
    function idx(x, y) { return y * GW + x; }
    function set(x, y, v) {
      if (x < 0 || y < 0 || x >= GW || y >= GH) return;
      grid[idx(x, y)] = v;
      if (v === 4) life[idx(x, y)] = 40 + ri(0, 40); else life[idx(x, y)] = 0;
    }
    function paint(x, y, r) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        if (Math.random() < 0.75) set(x + dx, y + dy, mat);
      }
    }
    function stepCell(x, y, t) {
      const i = idx(x, y), v = grid[i];
      if (v === 0) return;
      if (v === 1) {
        for (let g = 0; g < grav; g++) {
          const b = idx(x, y + 1);
          if (y + 1 < GH && (grid[b] === 0 || grid[b] === 2 || grid[b] === 6)) { const t2 = grid[b]; grid[b] = v; grid[i] = t2 === 2 ? 2 : (t2 === 6 ? 6 : 0); return; }
          if (y + 1 < GH) {
            const dl = x > 0 ? idx(x - 1, y + 1) : -1, dr = x < GW - 1 ? idx(x + 1, y + 1) : -1;
            const opts = [];
            if (dl >= 0 && (grid[dl] === 0 || grid[dl] === 2)) opts.push([x - 1, y + 1]);
            if (dr >= 0 && (grid[dr] === 0 || grid[dr] === 2)) opts.push([x + 1, y + 1]);
            if (opts.length) { const o = opts[ri(0, opts.length - 1)]; const b2 = idx(o[0], o[1]); grid[b2] = v; grid[i] = 0; return; }
          }
        }
        return;
      }
      if (v === 2 || v === 6) {
        if (v === 6) {
          [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(d => {
            const nx = x + d[0], ny = y + d[1];
            if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) return;
            const ni = idx(nx, ny);
            if (grid[ni] === 3 || grid[ni] === 1) { if (Math.random() < 0.03) { grid[ni] = 0; if (Math.random() < 0.25) grid[i] = 0; } }
            if (grid[ni] === 5) { if (Math.random() < 0.06) grid[ni] = 0; }
          });
        }
        const b = y + 1 < GH ? idx(x, y + 1) : -1;
        if (b >= 0 && grid[b] === 0) { grid[b] = v; grid[i] = 0; return; }
        if (b >= 0 && v === 2) { /* 与沙交错（简化密度：水不下穿沙） */ }
        const moves = [];
        if (b >= 0 && (grid[b] === 0)) moves.push([x, y + 1]);
        const dirs = Math.random() < 0.5 ? [-1, 1] : [1, -1];
        dirs.forEach(dx => {
          const nx = x + dx;
          if (nx < 0 || nx >= GW) return;
          const ni = idx(nx, y);
          if (grid[ni] === 0) moves.push([nx, y]);
          const nd = y + 1 < GH ? idx(nx, y + 1) : -1;
          if (nd >= 0 && grid[nd] === 0) moves.push([nx, y + 1]);
        });
        if (moves.length) { const m = moves[ri(0, moves.length - 1)]; grid[idx(m[0], m[1])] = v; grid[i] = 0; }
        return;
      }
      if (v === 4) {
        life[i]--;
        if (life[i] <= 0) { grid[i] = 0; return; }
        [[0, -1], [0, 1], [1, 0], [-1, 0]].forEach(d => {
          const nx = x + d[0], ny = y + d[1];
          if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) return;
          const ni = idx(nx, ny);
          if (grid[ni] === 5 && Math.random() < 0.12) set(nx, ny, 4);
          if (grid[ni] === 2) { if (Math.random() < 0.4) { grid[ni] = 0; grid[i] = 0; } }
        });
        if (y > 0 && grid[idx(x, y - 1)] === 0 && Math.random() < 0.55) { grid[idx(x, y - 1)] = 4; life[idx(x, y - 1)] = life[i]; grid[i] = 0; }
        return;
      }
      if (v === 5) {
        if (Math.random() < 0.05) {
          const up = y > 0 ? idx(x, y - 1) : -1;
          if (up >= 0 && grid[up] === 2) { grid[up] = 5; }
          else {
            const nx = x + (Math.random() < 0.5 ? -1 : 1);
            if (nx >= 0 && nx < GW && y > 0 && grid[idx(nx, y - 1)] === 2) grid[idx(nx, y - 1)] = 5;
          }
        }
        return;
      }
    }
    function step() {
      for (let y = GH - 2; y >= 0; y--) {
        const leftToRight = Math.random() < 0.5;
        for (let k = 0; k < GW; k++) {
          const x = leftToRight ? k : GW - 1 - k;
          stepCell(x, y);
        }
      }
    }
    function render() {
      const d = img.data;
      for (let i = 0; i < GW * GH; i++) {
        const v = grid[i];
        let c = SAND_MATS[v].c;
        if (v === 4 && life[i] > 0) { const t2 = life[i] / 80; c = [255, Math.min(255, 100 + t2 * 155) | 0, Math.max(0, 60 * t2) | 0]; }
        const o = i * 4;
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
      }
      octx.putImageData(img, 0, 0);
      C.ctx.imageSmoothingEnabled = false;
      C.ctx.clearRect(0, 0, C.W, C.H);
      C.ctx.drawImage(off, 0, 0, GW, GH, 0, 0, C.W, C.H);
    }
    const loop = Loop(dt => {
      if (!paused) {
        acc += dt * speed;
        let n = 0;
        while (acc >= 1 && n < 8) { step(); acc -= 1; n++; }
      } else acc = 0;
      render();
    });
    function ev2pos(e) { const p = C.pos(e); return { x: Math.floor(p.x / SCALE), y: Math.floor(p.y / SCALE) }; }
    function down(e) { painting = true; unlockAudio(); const p = ev2pos(e); paint(p.x, p.y, brush); }
    C.cv.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', e => { if (painting) { const p = ev2pos(e); paint(p.x, p.y, brush); } });
    window.addEventListener('pointerup', () => painting = false);
    C.cv.addEventListener('touchstart', e => { down(e.touches[0]); }, { passive: true });
    window.addEventListener('touchmove', e => { if (painting) { const p = ev2pos(e.touches[0]); paint(p.x, p.y, brush); e.preventDefault(); } }, { passive: false });
    window.addEventListener('touchend', () => painting = false);
    bindPills('#fsMat', v => { mat = +v; });
    bindRange('#fsBrush', v => brush = v);
    bindRange('#fsSpeed', v => speed = v);
    bindRange('#fsGrav', v => grav = v);
    bindCtrl({ start: () => { paused = false; loop.start(); }, pause: () => { paused = true; }, reset: () => { grid.fill(0); life.fill(0); } });
    ctlEl('#gStart').textContent = '播放';
    ctlEl('#gPause').textContent = '暂停';
    ctlEl('#gReset').textContent = '重开';
    $('#fsClear').addEventListener('click', () => { grid.fill(0); life.fill(0); });
    $('#fsRain').addEventListener('click', () => { for (let i = 0; i < 400; i++) set(ri(0, GW - 1), ri(0, 3), 2); });
    $('#fsPng').addEventListener('click', () => {
      const tmp = document.createElement('canvas'); tmp.width = GW; tmp.height = GH;
      tmp.getContext('2d').putImageData(img, 0, 0);
      const big = document.createElement('canvas'); big.width = GW * 4; big.height = GH * 4;
      const bx = big.getContext('2d'); bx.imageSmoothingEnabled = false; bx.drawImage(tmp, 0, 0, GW * 4, GH * 4);
      pngOf(big, slug + '.png');
    });
    if (slug === 'falling-sand-game') $('#fsTip').textContent = '试试点「下雨」再放一把火（火会烧掉植物、被水浇灭）。';
    render(); loop.start();
  }
  G['falling-sand-game'] = fallingSandUI;
  G['falling-sand-simulator'] = fallingSandUI;

  /* ---------------- 沙画 / 沙画在线 ---------------- */
  function sandArtUI(host, slug) {
    const GW = 150, GH = 110, SCALE = 4;
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          <div id="saWrap"></div>
          <div class="runnote">颜料会像沙一样往下沉并堆叠；点「分层」可以让沙子按颜色分层。</div>
        </div>
      </div>
      ${paneBox('沙画', '用像素沙粒作画：颜料有堆积和侧滑行为，可以清屏、导出 PNG。',
      `<div class="plabel">颜色</div><div class="shapes" id="saCol">${['#ffd166', '#ff8fb1', '#5fd0ff', '#d7f452', '#c39bff', '#ff9f6b', '#ffffff', '#7ee0c5'].map((c, i) => `<button class="shape${i === 0 ? ' on' : ''}" data-v="${c}" style="background:${c};color:#111;border-color:transparent">　</button>`).join('')}</div>
        <div class="plabel">笔刷大小</div>${TUI.range('saBrush', 1, 18, 5, 1)}
        <div class="plabel">下落速度</div>${TUI.range('saSpeed', 1, 10, 5, 1)}
        ${ctrlRow()}
        <div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="saClear">清屏</button><button class="btn-ghost btn-sm" id="saLayer">随机分层</button><button class="btn-ghost btn-sm" id="saPng">导出 PNG</button></div>`)}
    </div>`;
    const C = mkCanvas($('#saWrap'), GW * SCALE, GH * SCALE);
    const off = document.createElement('canvas'); off.width = GW; off.height = GH;
    const octx = off.getContext('2d');
    const img = octx.createImageData(GW, GH);
    const type = new Uint8Array(GW * GH);
    const col = new Uint8Array(GW * GH);
    const PALETTE = [[255, 209, 102], [255, 143, 177], [95, 208, 255], [215, 244, 82], [195, 155, 255], [255, 159, 107], [255, 255, 255], [126, 224, 197]];
    let cur = 0, brush = 5, spd = 5, acc = 0, running = true, painting = false;
    const idx = (x, y) => y * GW + x;
    function paint(x, y, r) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        if (Math.random() < 0.8) { type[idx(nx, ny)] = 1; col[idx(nx, ny)] = cur; }
      }
    }
    function step() {
      for (let y = GH - 2; y >= 0; y--) {
        for (let x = 0; x < GW; x++) {
          const i = idx(x, y);
          if (type[i] !== 1) continue;
          const below = idx(x, y + 1);
          if (type[below] === 0) { type[below] = 1; col[below] = col[i]; type[i] = 0; continue; }
          const dl = x > 0 ? idx(x - 1, y + 1) : -1, dr = x < GW - 1 ? idx(x + 1, y + 1) : -1;
          const opts = [];
          if (dl >= 0 && type[dl] === 0 && col[dl] !== col[i]) opts.push([x - 1, y + 1]);
          if (dr >= 0 && type[dr] === 0 && col[dr] !== col[i]) opts.push([x + 1, y + 1]);
          if (opts.length) {
            const o = opts[ri(0, opts.length - 1)];
            type[idx(o[0], o[1])] = 1; col[idx(o[0], o[1])] = col[i]; type[i] = 0;
          }
        }
      }
    }
    function render() {
      const d = img.data;
      for (let i = 0; i < GW * GH; i++) {
        const o = i * 4;
        if (type[i]) { const c = PALETTE[col[i]]; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; }
        else { d[o] = 13; d[o + 1] = 13; d[o + 2] = 13; }
        d[o + 3] = 255;
      }
      octx.putImageData(img, 0, 0);
      C.ctx.imageSmoothingEnabled = false;
      C.ctx.drawImage(off, 0, 0, GW, GH, 0, 0, C.W, C.H);
    }
    const loop = Loop(dt => {
      if (running) { acc += dt * spd * 6; let n = 0; while (acc >= 1 && n < 6) { step(); acc -= 1; n++; } }
      render();
    });
    const p2 = e => { const p = C.pos(e); return { x: Math.floor(p.x / SCALE), y: Math.floor(p.y / SCALE) }; };
    C.cv.addEventListener('pointerdown', e => { painting = true; unlockAudio(); const p = p2(e); paint(p.x, p.y, brush); });
    window.addEventListener('pointermove', e => { if (painting) { const p = p2(e); paint(p.x, p.y, brush); } });
    window.addEventListener('pointerup', () => painting = false);
    C.cv.addEventListener('touchstart', e => { painting = true; const p = p2(e.touches[0]); paint(p.x, p.y, brush); }, { passive: true });
    window.addEventListener('touchmove', e => { if (painting) { const p = p2(e.touches[0]); paint(p.x, p.y, brush); e.preventDefault(); } }, { passive: false });
    window.addEventListener('touchend', () => painting = false);
    bindPills('#saCol', v => { const i = PALETTE.findIndex(c => '#' + c.map(x => x.toString(16).padStart(2, '0')).join('') === v); cur = i < 0 ? 0 : i; });
    bindRange('#saBrush', v => brush = v);
    bindRange('#saSpeed', v => spd = v);
    bindCtrl({ start: () => { running = true; loop.start(); }, pause: () => running = false, reset: () => { type.fill(0); } });
    ctlEl('#gStart').textContent = '继续流动';
    ctlEl('#gReset').textContent = '清空';
    $('#saClear').addEventListener('click', () => type.fill(0));
    $('#saLayer').addEventListener('click', () => {
      type.fill(0);
      for (let i = 0; i < 3; i++) {
        const h = ri(3, 8);
        const y0 = GH - 6 - i * 6;
        for (let y = y0; y < y0 + h && y < GH; y++) for (let x = 0; x < GW; x++) { type[idx(x, y)] = 1; col[idx(x, y)] = i; }
      }
    });
    $('#saPng').addEventListener('click', () => {
      const tmp = document.createElement('canvas'); tmp.width = GW; tmp.height = GH;
      tmp.getContext('2d').putImageData(img, 0, 0);
      const big = document.createElement('canvas'); big.width = GW * 4; big.height = GH * 4;
      const bx = big.getContext('2d'); bx.imageSmoothingEnabled = false; bx.drawImage(tmp, 0, 0, GW * 4, GH * 4);
      pngOf(big, slug + '.png');
    });
    render(); loop.start();
  }
  G['sand-simulator'] = sandArtUI;
  G['sand-art'] = sandArtUI;
  G['sand-painting-online'] = sandArtUI;

  /* ---------------- 水面波动 ---------------- */
  G['water-simulator'] = function (host) {
    const N = 140, SCALE = 4;
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          <div id="wsWrap"></div>
          <div class="runnote">在画面上点击或拖动会激起涟漪；这是高度场法（h = 2h − h₋₁ + c²∇²h）逐帧求解。</div>
        </div>
      </div>
      ${paneBox('水面模拟器', '二维波动方程 + 阻尼。水面用高度→颜色映射渲染，带高光。',
      `<div class="plabel">波速</div>${TUI.range('wsC', 1, 40, 18, 1)}
        <div class="plabel">阻尼（越小越持久）</div>${TUI.range('wsDamp', 1, 40, 8, 1)}
        <div class="plabel">降水量</div>${TUI.range('wsRain', 0, 60, 0, 1)}
        ${ctrlRow()}
        <div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="wsDrop">投一块石头</button><button class="btn-ghost btn-sm" id="wsPng">导出 PNG</button></div>`)}
    </div>`;
    const C = mkCanvas($('#wsWrap'), N * SCALE, N * SCALE);
    let h = new Float32Array(N * N), hp = new Float32Array(N * N), hn = new Float32Array(N * N);
    const off = document.createElement('canvas'); off.width = N; off.height = N;
    const octx = off.getContext('2d');
    const img = octx.createImageData(N, N);
    let paused = false, acc = 0;
    const idx = (x, y) => y * N + x;
    function disturb(cx, cy, r, amp) {
      for (let y = Math.max(1, cy - r); y < Math.min(N - 1, cy + r); y++)
        for (let x = Math.max(1, cx - r); x < Math.min(N - 1, cx + r); x++) {
          const d = Math.hypot(x - cx, y - cy);
          if (d < r) h[idx(x, y)] -= amp * (1 - d / r);
        }
    }
    function step() {
      const c2 = (+$('#wsC').value) / 10, damp = 1 - (+$('#wsDamp').value) / 400;
      for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
        const i = idx(x, y);
        const lap = h[i - 1] + h[i + 1] + h[i - N] + h[i + N] - 4 * h[i];
        hn[i] = (2 * h[i] - hp[i] + c2 * lap) * damp;
      }
      const t = hp; hp = h; h = hn; hn = t;
      const rain = +$('#wsRain').value;
      if (rain > 0 && Math.random() < rain / 60) disturb(ri(4, N - 5), ri(4, N - 5), 2, 4);
    }
    function render(pausedNow) {
      const d = img.data;
      for (let i = 0; i < N * N; i++) {
        const v = clamp(h[i], -6, 6);
        const t = (v + 6) / 12;
        const o = i * 4;
        d[o] = 8 + t * 40;
        d[o + 1] = 30 + t * 150;
        d[o + 2] = 70 + t * 180;
        if (v > 2.2) { d[o] = 200; d[o + 1] = 230; d[o + 2] = 255; }
        d[o + 3] = 255;
      }
      octx.putImageData(img, 0, 0);
      C.ctx.imageSmoothingEnabled = true;
      C.ctx.drawImage(off, 0, 0, N, N, 0, 0, C.W, C.H);
    }
    const loop = Loop(dt => {
      if (!paused) { acc += dt * 60; let n = 0; while (acc >= 1 && n < 3) { step(); acc -= 1; n++; } }
      render();
    });
    let painting = false;
    const p2 = e => { const p = C.pos(e); return { x: Math.floor(p.x / SCALE), y: Math.floor(p.y / SCALE) }; };
    function drop(e) { const p = p2(e); disturb(clamp(p.x, 2, N - 3), clamp(p.y, 2, N - 3), 8, 9); noiseSound(0.12, 0.1, 500, 1.2); }
    C.cv.addEventListener('pointerdown', e => { painting = true; unlockAudio(); drop(e); });
    window.addEventListener('pointermove', e => { if (painting) { const p = p2(e); disturb(clamp(p.x, 2, N - 3), clamp(p.y, 2, N - 3), 3, 3); } });
    window.addEventListener('pointerup', () => painting = false);
    C.cv.addEventListener('touchstart', e => { painting = true; drop(e.touches[0]); }, { passive: true });
    window.addEventListener('touchmove', e => { if (painting) { const p = p2(e.touches[0]); disturb(clamp(p.x, 2, N - 3), clamp(p.y, 2, N - 3), 3, 3); } }, { passive: true });
    window.addEventListener('touchend', () => painting = false);
    $('#wsDrop').addEventListener('click', () => disturb(ri(10, N - 10), ri(10, N - 10), 12, 12));
    $('#wsPng').addEventListener('click', () => {
      const tmp = document.createElement('canvas'); tmp.width = N; tmp.height = N;
      tmp.getContext('2d').putImageData(img, 0, 0);
      const big = document.createElement('canvas'); big.width = N * 4; big.height = N * 4;
      const bx = big.getContext('2d'); bx.imageSmoothingEnabled = true; bx.drawImage(tmp, 0, 0, N * 4, N * 4);
      pngOf(big, 'water-simulator.png');
    });
    bindRange('#wsC', () => { }); bindRange('#wsDamp', () => { }); bindRange('#wsRain', () => { });
    bindCtrl({ start: () => { paused = false; loop.start(); }, pause: () => { paused = true; }, reset: () => { h.fill(0); hp.fill(0); hn.fill(0); } });
    ctlEl('#gStart').textContent = '播放';
    ctlEl('#gReset').textContent = '平静水面';
    disturb(70, 70, 16, 8); loop.start();
  };

  /* ---------------- 布料 / 绳索（Verlet） ---------------- */
  function clothUI(host, slug) {
    const W = 520, H = 380;
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          <div id="clWrap"></div>
          <div class="runnote">按住鼠标拖动布料上的点；点「剪断」会随机剪掉一根约束。</div>
        </div>
      </div>
      ${paneBox('布料 / 绳索模拟', '质点-弹簧模型 + Verlet 积分 + 约束迭代（默认 8 次）。可拽动、可调重力/风/刚度。',
      `<div class="plabel">结构</div>${TUI.sel('clMode', [{ v: 'cloth', t: '布料 24×18' }, { v: 'rope', t: '绳索（单列）' }, { v: 'flag', t: '旗帜（只挂左边缘）' }], 'cloth')}
        <div class="plabel">重力</div>${TUI.range('clG', 0, 2400, 900, 20)}
        <div class="plabel">风力（左右摆动）</div>${TUI.range('clWind', -600, 600, 0, 10)}
        <div class="plabel">刚度（约束迭代次数）</div>${TUI.range('clIter', 1, 14, 8, 1)}
        ${ctrlRow()}
        <div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="clCut">剪断随机一根</button><button class="btn-ghost btn-sm" id="clWindBtn">来阵风</button></div>`)}
    </div>`;
    const C = mkCanvas($('#clWrap'), W, H);
    let pts = [], cons = [], cols = 24, rows = 18, spacing = 20, dragP = null, paused = false;
    function build() {
      const mode = $('#clMode').value;
      if (mode === 'cloth') { cols = 24; rows = 18; }
      else if (mode === 'rope') { cols = 1; rows = 26; }
      else { cols = 26; rows = 16; }
      spacing = Math.min(20, 460 / cols);
      const ox = (W - (cols - 1) * spacing) / 2, oy = mode === 'cloth' ? 40 : 30;
      pts = []; cons = [];
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const px = ox + x * spacing, py = oy + y * spacing;
        const pin = mode === 'cloth' ? (y === 0 && x % 4 === 0) : mode === 'rope' ? (y === 0) : (x === 0 && y % 3 === 0);
        pts.push({ x: px, y: py, ox: px, oy: py, pin: pin });
      }
      const id = (x, y) => y * cols + x;
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        if (x < cols - 1) cons.push({ a: id(x, y), b: id(x + 1, y), len: spacing });
        if (y < rows - 1) cons.push({ a: id(x, y), b: id(x, y + 1), len: spacing });
      }
      dragP = null;
    }
    function step(dt) {
      const g = +$('#clG').value, wind = +$('#clWind').value;
      const dtc = Math.min(dt, 0.033);
      pts.forEach((p, i) => {
        if (p.pin) { p.x = p.ox; p.y = p.oy; return; }
        const vx = (p.x - p.ox) * 0.995, vy = (p.y - p.oy) * 0.995;
        p.ox = p.x; p.oy = p.y;
        p.x += vx + Math.sin(performance.now() / 800 + i * 0.12) * wind * dtc * dtc * 60;
        p.y += vy + g * dtc * dtc;
      });
      const iters = +$('#clIter').value;
      for (let k = 0; k < iters; k++) {
        for (let c = 0; c < cons.length; c++) {
          const a = pts[cons[c].a], b = pts[cons[c].b];
          let dx = b.x - a.x, dy = b.y - a.y;
          let d = Math.hypot(dx, dy) || 0.0001;
          const diff = (d - cons[c].len) / d * 0.5;
          const ox = dx * diff, oy = dy * diff;
          if (!a.pin) { a.x += ox; a.y += oy; }
          if (!b.pin) { b.x -= ox; b.y -= oy; }
        }
        if (dragP != null) { const p = pts[dragP]; p.x = p.tx; p.y = p.ty; }
      }
    }
    function draw() {
      C.ctx.fillStyle = '#0d0d0d'; C.ctx.fillRect(0, 0, W, H);
      C.ctx.lineWidth = 1;
      for (let c = 0; c < cons.length; c++) {
        const a = pts[cons[c].a], b = pts[cons[c].b];
        C.ctx.strokeStyle = dragP != null ? 'rgba(215,244,82,.6)' : 'rgba(120,220,160,.55)';
        C.ctx.beginPath(); C.ctx.moveTo(a.x, a.y); C.ctx.lineTo(b.x, b.y); C.ctx.stroke();
      }
      pts.forEach(p => {
        if (p.pin) { C.ctx.fillStyle = '#d7f452'; C.ctx.beginPath(); C.ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2); C.ctx.fill(); }
      });
    }
    const loop = Loop(dt => { if (!paused) step(dt); draw(); });
    function grab(e) {
      const p = C.pos(e);
      let best = -1, bd = 26 * 26;
      pts.forEach((q, i) => { const d = (q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y); if (d < bd) { bd = d; best = i; } });
      if (best >= 0) { dragP = best; pts[best].tx = p.x; pts[best].ty = p.y; }
      unlockAudio();
    }
    C.cv.addEventListener('pointerdown', grab);
    window.addEventListener('pointermove', e => { if (dragP != null) { const p = C.pos(e); pts[dragP].tx = p.x; pts[dragP].ty = p.y; } });
    window.addEventListener('pointerup', () => dragP = null);
    C.cv.addEventListener('touchstart', e => grab(e.touches[0]), { passive: true });
    window.addEventListener('touchmove', e => { if (dragP != null) { const p = C.pos(e.touches[0]); pts[dragP].tx = p.x; pts[dragP].ty = p.y; } }, { passive: true });
    window.addEventListener('touchend', () => dragP = null);
    $('#clCut').addEventListener('click', () => { if (cons.length > 8) cons.splice(ri(0, cons.length - 1), 1); toastSafe('剪断了一根约束'); });
    $('#clWindBtn').addEventListener('click', () => { const el = $('#clWind'); el.value = ri(-500, 500); el.dispatchEvent(new Event('input')); toastSafe('来了一阵风'); });
    bindRange('#clG', () => { }); bindRange('#clWind', () => { }); bindRange('#clIter', () => { });
    $('#clMode').addEventListener('change', build);
    bindCtrl({ start: () => { paused = false; loop.start(); }, pause: () => paused = true, reset: build });
    ctlEl('#gStart').textContent = '播放';
    ctlEl('#gReset').textContent = '重新挂起';
    build(); loop.start();
  }
  function toastSafe(m) { try { window.toast(m); } catch (e) { } }
  G['cloth-simulator'] = clothUI;
  G['rope-cloth-simulator'] = clothUI;

  /* ---------------- 烟雾 / 流体（Stam 简化求解器） ---------------- */
  function smokeUI(host, slug) {
    let N = 128;
    const SCALE = 4;
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          <div id="smWrap"></div>
          <div class="runnote">按住鼠标在画布上拖动：既加力也注入烟雾。</div>
        </div>
      </div>
      ${paneBox('流体烟雾', '基于 Stam 稳定流体思路：半拉格朗日平流 + 速度扩散 + 压力投影（Gauss-Seidel）+ 涡量约束，全部用 Float32 网格手写实现。',
      `<div class="plabel">分辨率</div>${TUI.sel('smRes', [{ v: '64', t: '64（快）' }, { v: '96', t: '96' }, { v: '128', t: '128（默认，较重）' }], '128')}
        <div class="plabel">粘滞（扩散）</div>${TUI.range('smVisc', 1, 60, 12, 1)}
        <div class="plabel">烟雾衰减</div>${TUI.range('smDiss', 1, 40, 6, 1)}
        <div class="plabel">涡量强度</div>${TUI.range('smVort', 0, 40, 14, 1)}
        <div class="plabel">注入半径</div>${TUI.range('smBrush', 2, 16, 6, 1)}
        ${ctrlRow()}
        <div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="smUp">持续上升气流</button><button class="btn-ghost btn-sm" id="smPng">导出 PNG</button></div>`)}
    </div>`;
    const C = mkCanvas($('#smWrap'), N * SCALE, (N * 0.62 | 0) * SCALE);
    let W = N, H = N * 0.62 | 0;
    let vx, vy, vx0, vy0, d, d0, pr, dv;
    const off = document.createElement('canvas');
    const octx = off.getContext('2d');
    let img;
    let paused = false, upflow = 0;
    function alloc() {
      const n = (W + 2) * (H + 2);
      vx = new Float32Array(n); vy = new Float32Array(n); vx0 = new Float32Array(n); vy0 = new Float32Array(n);
      d = new Float32Array(n); d0 = new Float32Array(n); pr = new Float32Array(n); dv = new Float32Array(n);
      off.width = W; off.height = H; img = octx.createImageData(W, H);
    }
    alloc();
    const IX = (i, j) => i + (W + 2) * j;
    function setBnd(b) {
      for (let i = 1; i <= W; i++) { b[IX(i, 0)] = b[IX(i, 1)]; b[IX(i, H + 1)] = b[IX(i, H)]; }
      for (let j = 1; j <= H; j++) { b[IX(0, j)] = b[IX(1, j)]; b[IX(W + 1, j)] = b[IX(W, j)]; }
      b[IX(0, 0)] = (b[IX(1, 0)] + b[IX(0, 1)]) / 2; b[IX(0, H + 1)] = (b[IX(1, H + 1)] + b[IX(0, H)]) / 2;
      b[IX(W + 1, 0)] = (b[IX(W, 0)] + b[IX(W + 1, 1)]) / 2; b[IX(W + 1, H + 1)] = (b[IX(W, H + 1)] + b[IX(W + 1, H)]) / 2;
    }
    function deadCodePlaceholder() { }
    // 平流（速度场与密度场共用）
    function advectField(dst, src, u, v, dt) {
      const dtx = dt * W, dty = dt * H;
      for (let j = 1; j <= H; j++) for (let i = 1; i <= W; i++) {
        let x = i - dtx * u[IX(i, j)], y = j - dty * v[IX(i, j)];
        x = clamp(x, 0.5, W + 0.5); y = clamp(y, 0.5, H + 0.5);
        const i0 = x | 0, j0 = y | 0, s1 = x - i0, s0 = 1 - s1, t1 = y - j0, t0 = 1 - t1;
        dst[IX(i, j)] = s0 * t0 * src[IX(i0, j0)] + s1 * t0 * src[IX(i0 + 1, j0)] + s0 * t1 * src[IX(i0, j0 + 1)] + s1 * t1 * src[IX(i0 + 1, j0 + 1)];
      }
      setBnd(dst);
    }
    function diffuseField(dst, src, k, iters) {
      const a = k * W * H;
      dst.set(src);
      for (let n = 0; n < iters; n++) {
        for (let j = 1; j <= H; j++) for (let i = 1; i <= W; i++) {
          dst[IX(i, j)] = (src[IX(i, j)] + a * (dst[IX(i - 1, j)] + dst[IX(i + 1, j)] + dst[IX(i, j - 1)] + dst[IX(i, j + 1)])) / (1 + 4 * a);
        }
        setBnd(dst);
      }
    }
    function project(u, v, p, div) {
      for (let j = 1; j <= H; j++) for (let i = 1; i <= W; i++) {
        div[IX(i, j)] = -0.5 * (u[IX(i + 1, j)] - u[IX(i - 1, j)] + v[IX(i, j + 1)] - v[IX(i, j - 1)]) / W;
        p[IX(i, j)] = 0;
      }
      setBnd(div); setBnd(p);
      for (let n = 0; n < 12; n++) {
        for (let j = 1; j <= H; j++) for (let i = 1; i <= W; i++) {
          p[IX(i, j)] = (div[IX(i, j)] + p[IX(i - 1, j)] + p[IX(i + 1, j)] + p[IX(i, j - 1)] + p[IX(i, j + 1)]) / 4;
        }
        setBnd(p);
      }
      for (let j = 1; j <= H; j++) for (let i = 1; i <= W; i++) {
        u[IX(i, j)] -= 0.5 * (p[IX(i + 1, j)] - p[IX(i - 1, j)]) * W;
        v[IX(i, j)] -= 0.5 * (p[IX(i, j + 1)] - p[IX(i, j - 1)]) * H;
      }
      setBnd(u); setBnd(v);
    }
    function vorticity(strength) {
      for (let j = 2; j < H; j++) for (let i = 2; i < W; i++) {
        const curl = (vy[IX(i + 1, j)] - vy[IX(i - 1, j)]) - (vx[IX(i, j + 1)] - vx[IX(i, j - 1)]);
        const dwdx = Math.abs(curl) - Math.abs((vy[IX(i + 2, j)] - vy[IX(i, j)]) - (vx[IX(i + 1, j + 1)] - vx[IX(i + 1, j - 1)]));
        const dwdy = Math.abs(curl) - Math.abs((vy[IX(i, j + 1)] - vy[IX(i, j - 1)]) - (vx[IX(i + 1, j + 1)] - vx[IX(i - 1, j + 1)]));
        const len = Math.hypot(dwdx, dwdy) + 0.0001;
        const nx = dwdx / len, ny = dwdy / len;
        vx[IX(i, j)] += strength * ny * curl;
        vy[IX(i, j)] -= strength * nx * curl;
      }
    }
    function addForce(cx, cy, r, fx, fy, addDens) {
      for (let j = Math.max(1, cy - r); j <= Math.min(H, cy + r); j++) for (let i = Math.max(1, cx - r); i <= Math.min(W, cx + r); i++) {
        const dd = Math.hypot(i - cx, j - cy);
        if (dd > r) continue;
        const k = 1 - dd / r;
        vx[IX(i, j)] += fx * k; vy[IX(i, j)] += fy * k;
        if (addDens) d[IX(i, j)] = Math.min(2.4, d[IX(i, j)] + addDens * k);
      }
    }
    function step(sdt) {
      const visc = (+$('#smVisc').value) / 3000, diss = (+$('#smDiss').value) / 200, vs = (+$('#smVort').value) / 400;
      if (upflow) for (let j = 1; j <= H; j++) for (let i = 1; i <= W; i++) vy[IX(i, j)] -= 12 / H;
      vx0.set(vx); diffuseField(vx, vx0, visc, 3);
      vy0.set(vy); diffuseField(vy, vy0, visc, 3);
      vorticity(vs);
      project(vx, vy, pr, dv);
      vx0.set(vx); vy0.set(vy);
      advectField(vx, vx0, vx0, vy0, sdt);
      advectField(vy, vy0, vx0, vy0, sdt);
      project(vx, vy, pr, dv);
      d0.set(d);
      advectField(d, d0, vx, vy, sdt);
      for (let i = 0; i < d.length; i++) d[i] = Math.max(0, d[i] - diss * sdt);
    }
    function render() {
      const px = img.data;
      for (let j = 1; j <= H; j++) for (let i = 1; i <= W; i++) {
        const v = clamp(d[IX(i, j)], 0, 2.4) / 2.4;
        const o = ((j - 1) * W + (i - 1)) * 4;
        px[o] = 30 + v * 225;
        px[o + 1] = 34 + v * 215;
        px[o + 2] = 40 + v * 205;
        px[o + 3] = 255;
      }
      octx.putImageData(img, 0, 0);
      C.ctx.imageSmoothingEnabled = true;
      C.ctx.clearRect(0, 0, C.W, C.H);
      C.ctx.drawImage(off, 0, 0, W, H, 0, 0, C.W, C.H);
    }
    const loop = Loop(dt => { if (!paused) { step(Math.min(dt, 0.033)); } render(); });
    let painting = false, px0 = 0, py0 = 0;
    function p2(e) { const p = C.pos(e); return { x: Math.round(p.x / SCALE), y: Math.round(p.y / SCALE) }; }
    function down(e) { painting = true; unlockAudio(); const p = p2(e); px0 = p.x; py0 = p.y; }
    function move(e) {
      if (!painting) return;
      const p = p2(e), r = +$('#smBrush').value;
      const fx = (p.x - px0) * 0.9, fy = (p.y - py0) * 0.9;
      addForce(p.x, p.y, r, clamp(fx, -30, 30), clamp(fy, -30, 30), 0.55);
      px0 = p.x; py0 = p.y;
    }
    C.cv.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', () => painting = false);
    C.cv.addEventListener('touchstart', e => down(e.touches[0]), { passive: true });
    window.addEventListener('touchmove', e => { move(e.touches[0]); }, { passive: true });
    window.addEventListener('touchend', () => painting = false);
    function rebuild(res) {
      N = res; W = N; H = Math.max(40, Math.round(N * 0.62));
      C.layout();
      alloc();
      C.ctx.setTransform(C.cv.width / C.W, 0, 0, C.cv.height / C.H, 0, 0);
    }
    // 分辨率切换：重建网格与画布逻辑尺寸
    $('#smRes').addEventListener('change', () => {
      const oldW = C.W, oldH = C.H;
      N = +$('#smRes').value;
      W = N; H = Math.max(40, Math.round(N * 0.62));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      C.W = W * SCALE; C.H = H * SCALE;
      C.cv.width = Math.round(C.W * 1); C.cv.height = Math.round(C.H * 1);
      C.cv.style.width = '100%'; C.cv.style.height = 'auto';
      C.ctx.setTransform(C.cv.width / C.W, 0, 0, C.cv.height / C.H, 0, 0);
      void oldW; void oldH; void dpr;
      alloc();
    });
    bindRange('#smVisc', () => { }); bindRange('#smDiss', () => { }); bindRange('#smVort', () => { }); bindRange('#smBrush', () => { });
    bindCtrl({ start: () => { paused = false; loop.start(); }, pause: () => paused = true, reset: () => { vx.fill(0); vy.fill(0); d.fill(0); } });
    ctlEl('#gStart').textContent = '播放';
    ctlEl('#gReset').textContent = '清空烟';
    $('#smUp').addEventListener('click', () => { upflow = upflow ? 0 : 1; for (let i = 20; i < W - 20; i++) d[IX(i, H - 2)] = 1.6; toastSafe(upflow ? '已开启持续上升气流' : '已关闭上升气流'); });
    $('#smPng').addEventListener('click', () => {
      const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H;
      tmp.getContext('2d').putImageData(img, 0, 0);
      const big = document.createElement('canvas'); big.width = W * 3; big.height = H * 3;
      const bx = big.getContext('2d'); bx.imageSmoothingEnabled = true; bx.drawImage(tmp, 0, 0, W * 3, H * 3);
      pngOf(big, slug + '.png');
    });
    for (let i = 20; i < W - 20; i++) d[IX(i, 6)] = 1.4;
    render(); loop.start();
  }
  G['smoke-simulator'] = smokeUI;
  G['fluid-smoke-simulator'] = smokeUI;

  /* ---------------- 刚性球碰撞 ---------------- */
  G['ball-physics-simulator'] = function (host) {
    const W = 560, H = 400;
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          ${scorebar([['球数', 'bpBalls'], ['总碰撞', 'bpHits'], ['动能', 'bpE']])}
          <div id="bpxWrap"></div>
          <div class="runnote">点画布空白处扔一个球；按住拖动可以甩出去。</div>
        </div>
      </div>
      ${paneBox('刚性球物理', '等质量圆球：弹性碰撞（动量+能量守恒）+ 恢复系数 + 重力 + 墙体。',
      `<div class="plabel">重力</div>${TUI.range('bpxG', 0, 2000, 700, 20)}
        <div class="plabel">恢复系数</div>${TUI.range('bpxRest', 10, 100, 82, 1)}
        <div class="plabel">空气阻力</div>${TUI.range('bpxDrag', 0, 60, 6, 1)}
        <div class="plabel">球半径</div>${TUI.range('bpxR', 6, 34, 14, 1)}
        ${ctrlRow()}
        <div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="bpxAdd">加 10 个球</button><button class="btn-ghost btn-sm" id="bpxBoom">爆开</button></div>`)}
    </div>`;
    const C = mkCanvas($('#bpxWrap'), W, H);
    let balls = [], hits = 0, paused = false;
    function addBall(x, y) {
      const r = +$('#bpxR').value;
      balls.push({ x: x == null ? rf(r, W - r) : x, y: y == null ? rf(r, H * 0.2) : y, vx: rf(-160, 160), vy: rf(-120, 60), r: r, hue: ri(60, 100) * 3 % 360 });
    }
    function reset(n) { balls = []; hits = 0; for (let i = 0; i < (n || 18); i++) addBall(); $('#bpBalls').textContent = balls.length; $('#bpHits').textContent = '0'; }
    function step(dt) {
      const g = +$('#bpxG').value, rest = (+$('#bpxRest').value) / 100, drag = (+$('#bpxDrag').value) / 1000;
      for (let i = 0; i < balls.length; i++) {
        const b = balls[i];
        b.vy += g * dt;
        b.vx -= b.vx * drag; b.vy -= b.vy * drag;
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.x - b.r < 0) { b.x = b.r; b.vx = -b.vx * rest; hits++; }
        if (b.x + b.r > W) { b.x = W - b.r; b.vx = -b.vx * rest; hits++; }
        if (b.y - b.r < 0) { b.y = b.r; b.vy = -b.vy * rest; hits++; }
        if (b.y + b.r > H) { b.y = H - b.r; b.vy = -b.vy * rest; b.vx *= 0.99; hits++; if (Math.abs(b.vy) < 12) b.vy = 0; }
      }
      for (let i = 0; i < balls.length; i++) for (let j = i + 1; j < balls.length; j++) {
        const a = balls[i], b = balls[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.hypot(dx, dy), min = a.r + b.r;
        if (dist < min && dist > 0) {
          const nx = dx / dist, ny = dy / dist;
          const overlap = (min - dist) / 2;
          a.x -= nx * overlap; a.y -= ny * overlap; b.x += nx * overlap; b.y += ny * overlap;
          const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
          const vn = rvx * nx + rvy * ny;
          if (vn < 0) {
            const imp = -(1 + rest) * vn / 2;
            a.vx -= imp * nx; a.vy -= imp * ny;
            b.vx += imp * nx; b.vy += imp * ny;
            hits++;
            if (Math.abs(vn) > 300) tone(300 + ri(0, 200), 0.03, 'square', 0.05);
          }
        }
      }
      $('#bpBalls').textContent = balls.length;
      $('#bpHits').textContent = hits;
      let ke = 0; balls.forEach(b => ke += 0.5 * (b.vx * b.vx + b.vy * b.vy));
      $('#bpE').textContent = Math.round(ke / 1000);
    }
    function draw() {
      C.ctx.fillStyle = '#0d0d0d'; C.ctx.fillRect(0, 0, W, H);
      balls.forEach(b => {
        const g = C.ctx.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.3, 1, b.x, b.y, b.r);
        g.addColorStop(0, 'hsl(' + b.hue + ',90%,78%)'); g.addColorStop(1, 'hsl(' + b.hue + ',70%,42%)');
        C.ctx.fillStyle = g; C.ctx.beginPath(); C.ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); C.ctx.fill();
      });
    }
    const loop = Loop(dt => { if (!paused) step(Math.min(dt, 0.033)); draw(); });
    C.cv.addEventListener('pointerdown', e => { const p = C.pos(e); unlockAudio(); addBall(p.x, p.y); });
    bindRange('#bpxG', () => { }); bindRange('#bpxRest', () => { }); bindRange('#bpxDrag', () => { }); bindRange('#bpxR', () => { });
    $('#bpxAdd').addEventListener('click', () => { for (let i = 0; i < 10; i++) addBall(); });
    $('#bpxBoom').addEventListener('click', () => { balls.forEach(b => { const a = Math.atan2(b.y - H / 2, b.x - W / 2); b.vx = Math.cos(a) * 600; b.vy = Math.sin(a) * 600; }); tone(180, 0.2, 'square', 0.16); });
    bindCtrl({ start: () => { paused = false; loop.start(); }, pause: () => paused = true, reset: () => reset(18) });
    ctlEl('#gStart').textContent = '播放';
    ctlEl('#gReset').textContent = '重新来 18 个球';
    reset(18); loop.start();
  };
  G['bouncing-ball-simulator'] = G['ball-physics-simulator'];

  /* ---------------- 引力轨道（N 体） ---------------- */
  G['gravity-orbit-simulator'] = function (host) {
    const W = 620, H = 460, CX = W / 2, CY = H / 2;
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          <div id="gosWrap"></div>
          <div class="runnote">点画布扔一个天体（自动给定切向速度）；滚轮 / 滑块调时间倍速。</div>
        </div>
      </div>
      ${paneBox('引力轨道模拟', '真正的 N 体引力积分（velocity-Verlet），带轨迹尾迹。',
      `<div class="plabel">预设</div>${TUI.sel('gosPreset', [{ v: 'solar', t: '太阳系（1 恒星 + 4 行星）' }, { v: 'binary', t: '双星 + 行星' }, { v: 'cluster', t: '随机星团' }, { v: 'chaos', t: '三个大质量天体' }], 'solar')}
        <div class="plabel">引力常数</div>${TUI.range('gosG', 1, 200, 60, 1)}
        <div class="plabel">时间倍速</div>${TUI.range('gosSpeed', 1, 30, 8, 1)}
        <div class="plabel">轨迹长度</div>${TUI.range('gosTrail', 20, 600, 200, 10)}
        ${ctrlRow()}
        <div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="gosPng">导出 PNG</button></div>`)}
    </div>`;
    const C = mkCanvas($('#gosWrap'), W, H);
    let bodies = [], paused = false;
    function preset(name) {
      bodies = [];
      const add = (x, y, vx, vy, m, c) => bodies.push({ x: x, y: y, vx: vx, vy: vy, m: m, c: c, trail: [] });
      if (name === 'solar') {
        add(CX, CY, 0, 0, 4000, '#ffd166');
        [[90, 0.9, 1.2], [140, 0.75, 6], [190, 0.62, 12], [250, 0.5, 22]].forEach(p => {
          const v = Math.sqrt(60 * 4000 / p[0]) * p[1];
          add(CX + p[0], CY, 0, v, p[2], 'hsl(' + ri(150, 260) + ',70%,65%)');
        });
      } else if (name === 'binary') {
        add(CX - 40, CY, 0, 2.1, 1600, '#ffd166');
        add(CX + 40, CY, 0, -2.1, 1600, '#5fd0ff');
        add(CX, CY - 210, 1.9, 0, 6, '#d7f452');
      } else if (name === 'cluster') {
        for (let i = 0; i < 26; i++) add(rf(80, W - 80), rf(70, H - 70), rf(-1.4, 1.4), rf(-1.4, 1.4), rf(6, 40), 'hsl(' + ri(0, 360) + ',70%,66%)');
      } else {
        add(CX - 120, CY - 60, 0.9, 1.4, 900, '#ffd166');
        add(CX + 110, CY - 30, -1.2, -1.1, 800, '#5fd0ff');
        add(CX, CY + 130, 0.4, -0.9, 850, '#ff8fb1');
      }
    }
    function step(dt) {
      const Gc = +$('#gosG').value;
      const trailLen = +$('#gosTrail').value;
      for (let i = 0; i < bodies.length; i++) {
        let ax = 0, ay = 0;
        for (let j = 0; j < bodies.length; j++) {
          if (i === j) continue;
          const dx = bodies[j].x - bodies[i].x, dy = bodies[j].y - bodies[i].y;
          const r2 = dx * dx + dy * dy + 40;
          const f = Gc * bodies[j].m / (r2 * Math.sqrt(r2));
          ax += dx * f; ay += dy * f;
        }
        bodies[i].vx += ax * dt; bodies[i].vy += ay * dt;
        bodies[i].x += bodies[i].vx * dt * 60; bodies[i].y += bodies[i].vy * dt * 60;
        bodies[i].trail.push([bodies[i].x, bodies[i].y]);
        if (bodies[i].trail.length > trailLen) bodies[i].trail.shift();
      }
    }
    function draw() {
      C.ctx.fillStyle = '#0b0b0b'; C.ctx.fillRect(0, 0, W, H);
      bodies.forEach(b => {
        C.ctx.strokeStyle = b.c; C.ctx.globalAlpha = 0.45; C.ctx.lineWidth = 1.2;
        C.ctx.beginPath();
        b.trail.forEach((p, i) => { i ? C.ctx.lineTo(p[0], p[1]) : C.ctx.moveTo(p[0], p[1]); });
        C.ctx.stroke(); C.ctx.globalAlpha = 1;
        const r = Math.max(2.5, Math.min(16, Math.cbrt(b.m) * 2.4));
        const g = C.ctx.createRadialGradient(b.x - r * 0.3, b.y - r * 0.3, 1, b.x, b.y, r);
        g.addColorStop(0, '#fff'); g.addColorStop(0.45, b.c); g.addColorStop(1, 'rgba(0,0,0,0.15)');
        C.ctx.fillStyle = g; C.ctx.beginPath(); C.ctx.arc(b.x, b.y, r, 0, Math.PI * 2); C.ctx.fill();
      });
    }
    const loop = Loop(dt => {
      if (!paused) { const sp = +$('#gosSpeed').value; for (let k = 0; k < 3; k++) step(Math.min(dt, 0.02) * sp / 3 * 3); }
      draw();
    });
    C.cv.addEventListener('click', e => {
      const p = C.pos(e); unlockAudio();
      let mx = 0, my = 0, mt = 1;
      bodies.forEach(b => { mx += b.x * b.m; my += b.y * b.m; mt += b.m; });
      mx /= mt; my /= mt;
      const dx = p.x - mx, dy = p.y - my, r = Math.hypot(dx, dy) || 1;
      const v = Math.sqrt(60 * 4000 / Math.max(60, r)) * 0.8;
      bodies.push({ x: p.x, y: p.y, vx: -dy / r * v, vy: dx / r * v, m: rf(5, 40), c: 'hsl(' + ri(0, 360) + ',70%,66%)', trail: [] });
    });
    $('#gosPreset').addEventListener('change', () => preset($('#gosPreset').value));
    bindRange('#gosG', () => { }); bindRange('#gosSpeed', () => { }); bindRange('#gosTrail', () => { });
    $('#gosPng').addEventListener('click', () => pngOf(C.cv, 'gravity-orbit.png'));
    bindCtrl({ start: () => { paused = false; loop.start(); }, pause: () => paused = true, reset: () => preset($('#gosPreset').value) });
    ctlEl('#gStart').textContent = '播放';
    ctlEl('#gReset').textContent = '重置预设';
    preset('solar'); loop.start();
  };

  /* ---------------- 太阳系 ---------------- */
  G['solar-system-simulator'] = function (host) {
    const W = 640, H = 480, CX = W / 2, CY = H / 2;
    const PLANETS = [
      { n: '水星', a: 44, T: 0.241, r: 2.4, c: '#b8b0a4' }, { n: '金星', a: 60, T: 0.615, r: 4.0, c: '#e8c98a' },
      { n: '地球', a: 78, T: 1.0, r: 4.2, c: '#4f9be8' }, { n: '火星', a: 96, T: 1.881, r: 3.2, c: '#d0704a' },
      { n: '木星', a: 132, T: 11.86, r: 9.2, c: '#d8b48a' }, { n: '土星', a: 168, T: 29.46, r: 8.0, c: '#e0cf9a' },
      { n: '天王星', a: 202, T: 84.01, r: 6.0, c: '#8fd8e8' }, { n: '海王星', a: 234, T: 164.8, r: 5.8, c: '#5f7fe0' }
    ];
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          <div id="ssWrap"></div>
          <div class="runnote">公转周期使用真实相对值（地球 = 1 年），因此外行星慢得几乎不动，这是真实的比例。</div>
        </div>
      </div>
      ${paneBox('太阳系模拟', '真实相对公转周期 + 可调尺寸比例 + 时间倍速（1 秒 = 多少地球年）。',
      `<div class="plabel">时间倍速</div>${TUI.range('ssSpeed', 1, 300, 60, 5)}
        <div class="plabel">尺寸夸张倍数</div>${TUI.range('ssSize', 1, 6, 1, 1)}
        <div class="plabel">轨道间隔</div>${TUI.range('ssGap', 60, 160, 100, 5)}
        <div class="plabel">显示轨道线</div>${TUI.chk('ssOrbits', '显示轨道', true)}
        ${ctrlRow()}
        <div class="outbox" id="ssOut">已过 0.0 地球年</div>`)}
    </div>`;
    const C = mkCanvas($('#ssWrap'), W, H);
    let t = 0, paused = false, showOrbits = true;
    function draw() {
      const gap = (+$('#ssGap').value) / 100;
      const sizeMul = +$('#ssSize').value;
      C.ctx.fillStyle = '#05070d'; C.ctx.fillRect(0, 0, W, H);
      // 星空
      for (let i = 0; i < 90; i++) {
        const x = (i * 97.13) % W, y = (i * 53.71) % H;
        C.ctx.fillStyle = 'rgba(255,255,255,' + (0.15 + (i % 5) * 0.06) + ')';
        C.ctx.fillRect(x, y, 1.4, 1.4);
      }
      const sunG = C.ctx.createRadialGradient(CX, CY, 2, CX, CY, 34);
      sunG.addColorStop(0, '#fff6c0'); sunG.addColorStop(0.5, '#ffd166'); sunG.addColorStop(1, 'rgba(255,180,60,0)');
      C.ctx.fillStyle = sunG; C.ctx.beginPath(); C.ctx.arc(CX, CY, 34, 0, Math.PI * 2); C.ctx.fill();
      PLANETS.forEach(p => {
        const a = p.a * gap;
        if (showOrbits) { C.ctx.strokeStyle = 'rgba(255,255,255,.09)'; C.ctx.lineWidth = 1; C.ctx.beginPath(); C.ctx.arc(CX, CY, a, 0, Math.PI * 2); C.ctx.stroke(); }
        const ang = t / p.T * Math.PI * 2 + p.a * 0.7;
        const x = CX + Math.cos(ang) * a, y = CY + Math.sin(ang) * a * 0.62;
        const r = p.r * sizeMul;
        const g = C.ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, 1, x, y, r);
        g.addColorStop(0, '#ffffff'); g.addColorStop(0.4, p.c); g.addColorStop(1, 'rgba(0,0,0,.3)');
        C.ctx.fillStyle = g; C.ctx.beginPath(); C.ctx.arc(x, y, r, 0, Math.PI * 2); C.ctx.fill();
        if (p.n === '土星') { C.ctx.strokeStyle = 'rgba(224,207,154,.7)'; C.ctx.lineWidth = 1.6; C.ctx.beginPath(); C.ctx.ellipse(x, y, r * 1.9, r * 0.7, 0.4, 0, Math.PI * 2); C.ctx.stroke(); }
        C.ctx.fillStyle = '#8a8a8a'; C.ctx.font = '10px Inter,sans-serif'; C.ctx.textAlign = 'center';
        C.ctx.fillText(p.n, x, y - r - 5);
      });
    }
    const loop = Loop(dt => {
      if (!paused) { t += dt * (+$('#ssSpeed').value) / 60; $('#ssOut').textContent = '已过 ' + t.toFixed(2) + ' 地球年'; }
      draw();
    });
    bindRange('#ssSpeed', () => { }); bindRange('#ssSize', () => { }); bindRange('#ssGap', () => { });
    bindChk('#ssOrbits', v => showOrbits = v);
    bindCtrl({ start: () => { paused = false; loop.start(); }, pause: () => paused = true, reset: () => { t = 0; } });
    ctlEl('#gStart').textContent = '播放';
    ctlEl('#gReset').textContent = '回到起点';
    loop.start();
  };

  /* ---------------- 三体问题 ---------------- */
  G['three-body-problem-simulator'] = function (host) {
    const W = 620, H = 460;
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          <div id="tbWrap"></div>
          <div class="runnote">三体系统的初值极其敏感——同一个初始条件，微小的数值扰动就会走向完全不同的结局。</div>
        </div>
      </div>
      ${paneBox('三体问题', 'N 体引力 + 轨迹；点「随机初值」会生成一个新的混沌系统。',
      `<div class="plabel">天体数</div>${TUI.range('tbN', 3, 6, 3, 1)}
        <div class="plabel">引力常数</div>${TUI.range('tbG', 10, 200, 70, 5)}
        <div class="plabel">时间倍速</div>${TUI.range('tbSpeed', 1, 30, 9, 1)}
        ${ctrlRow()}
        <div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="tbRand">随机初值</button><button class="btn-ghost btn-sm" id="tbPng">导出 PNG</button></div>`)}
    </div>`;
    const C = mkCanvas($('#tbWrap'), W, H);
    let bodies = [], paused = false;
    function rndInit() {
      const n = +$('#tbN').value;
      bodies = [];
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2;
        bodies.push({
          x: W / 2 + Math.cos(a) * 150, y: H / 2 + Math.sin(a) * 130,
          vx: -Math.sin(a) * 0.9 + rf(-0.15, 0.15), vy: Math.cos(a) * 0.9 + rf(-0.15, 0.15),
          m: rf(200, 400), c: 'hsl(' + (i * 360 / n | 0) + ',72%,65%)', trail: []
        });
      }
    }
    function step(dt) {
      const Gc = +$('#tbG').value;
      bodies.forEach((b, i) => {
        let ax = 0, ay = 0;
        bodies.forEach((o, j) => {
          if (i === j) return;
          const dx = o.x - b.x, dy = o.y - b.y;
          const r2 = dx * dx + dy * dy + 25;
          const f = Gc * o.m / (r2 * Math.sqrt(r2));
          ax += dx * f; ay += dy * f;
        });
        b.vx += ax * dt; b.vy += ay * dt;
        b.x += b.vx * dt * 60; b.y += b.vy * dt * 60;
        b.trail.push([b.x, b.y]);
        if (b.trail.length > 420) b.trail.shift();
      });
    }
    function draw() {
      C.ctx.fillStyle = 'rgba(8,8,8,.22)'; C.ctx.fillRect(0, 0, W, H);
      bodies.forEach(b => {
        C.ctx.strokeStyle = b.c; C.ctx.globalAlpha = 0.5; C.ctx.lineWidth = 1;
        C.ctx.beginPath(); b.trail.forEach((p, i) => i ? C.ctx.lineTo(p[0], p[1]) : C.ctx.moveTo(p[0], p[1])); C.ctx.stroke();
        C.ctx.globalAlpha = 1;
        const g = C.ctx.createRadialGradient(b.x - 3, b.y - 3, 1, b.x, b.y, 9);
        g.addColorStop(0, '#fff'); g.addColorStop(1, b.c);
        C.ctx.fillStyle = g; C.ctx.beginPath(); C.ctx.arc(b.x, b.y, 8, 0, Math.PI * 2); C.ctx.fill();
      });
    }
    const loop = Loop(dt => { if (!paused) step(Math.min(dt, 0.02) * (+$('#tbSpeed').value) / 8); draw(); });
    $('#tbRand').addEventListener('click', rndInit);
    bindRange('#tbN', () => rndInit()); bindRange('#tbG', () => { }); bindRange('#tbSpeed', () => { });
    $('#tbPng').addEventListener('click', () => pngOf(C.cv, 'three-body.png'));
    bindCtrl({ start: () => { paused = false; loop.start(); }, pause: () => paused = true, reset: rndInit });
    ctlEl('#gStart').textContent = '播放';
    ctlEl('#gReset').textContent = '重置初值';
    C.ctx.fillStyle = '#080808'; C.ctx.fillRect(0, 0, W, H);
    rndInit(); loop.start();
  };

  /* ---------------- 高尔顿板 ---------------- */
  G['galton-board'] = function (host) {
    const W = 620, H = 470;
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          ${scorebar([['小球数', 'gaN'], ['众数落槽', 'gaMode'], ['标准差', 'gaSd']])}
          <div id="gaWrap"></div>
          <div class="runnote">每一颗球在每一排钉子上左右各 50% 概率——这正是二项分布的物理实现。</div>
        </div>
      </div>
      ${paneBox('高尔顿板', '球落钉子后随机左右，落入底部槽位并统计直方图（黑线为理论二项分布）。',
      `<div class="plabel">钉排数</div>${TUI.range('gaRows', 6, 16, 11, 1)}
        <div class="plabel">落球速度（球/秒）</div>${TUI.range('gaRate', 1, 60, 14, 1)}
        ${ctrlRow()}
        <div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="gaFast">快丢 500 球</button><button class="btn-ghost btn-sm" id="gaPng">导出 PNG</button></div>
        <div class="outbox" id="gaOut">—</div>`)}
    </div>`;
    const C = mkCanvas($('#gaWrap'), W, H);
    let rows = 11, pegs = [], balls = [], bins = [], slots = 0, total = 0, acc = 0, paused = false, rate = 14;
    function build() {
      rows = +$('#gaRows').value;
      slots = rows + 1;
      pegs = []; balls = []; bins = new Array(slots).fill(0); total = 0;
      const topY = 46, gapX = Math.min(46, (W - 80) / slots), gapY = (H - 170) / rows;
      for (let r = 0; r < rows; r++) {
        const n = r + 1;
        for (let i = 0; i < n; i++) {
          pegs.push({ x: W / 2 + (i - (n - 1) / 2) * gapX, y: topY + r * gapY, r: 3.4, gapY: gapY });
        }
      }
      updateOut();
    }
    function dropBall() {
      balls.push({ x: W / 2 + rf(-2, 2), y: 14, vx: 0, vy: 60, r: 3.4, bin: -1 });
    }
    function step(dt) {
      const gapY = (H - 170) / rows;
      for (let bi = balls.length - 1; bi >= 0; bi--) {
        const b = balls[bi];
        b.vy += 520 * dt;
        b.x += b.vx * dt; b.y += b.vy * dt;
        pegs.forEach(p => {
          const dx = b.x - p.x, dy = b.y - p.y;
          const d = Math.hypot(dx, dy);
          if (d < p.r + b.r) {
            b.x = p.x + dx / (d || 1) * (p.r + b.r);
            b.y = p.y + dy / (d || 1) * (p.r + b.r);
            const side = dx === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(dx);
            b.vx = side * Math.abs(b.vy) * 0.62 + rf(-8, 8);
            b.vy = Math.abs(b.vy) * 0.6;
            tone(900 + ri(0, 200), 0.012, 'square', 0.02);
          }
        });
        if (b.x < 10) { b.x = 10; b.vx = Math.abs(b.vx); }
        if (b.x > W - 10) { b.x = W - 10; b.vx = -Math.abs(b.vx); }
        if (b.y > H - 84) {
          const slotW = (W - 60) / slots;
          const idx = clamp(Math.floor((b.x - 30) / slotW), 0, slots - 1);
          bins[idx]++; total++;
          balls.splice(bi, 1);
          updateOut();
        }
      }
    }
    function updateOut() {
      const mean = bins.reduce((a, c, i) => a + c * i, 0) / Math.max(1, total);
      const varr = bins.reduce((a, c, i) => a + c * (i - mean) * (i - mean), 0) / Math.max(1, total);
      let mi = 0; bins.forEach((c, i) => { if (c > bins[mi]) mi = i; });
      $('#gaN').textContent = total;
      $('#gaMode').textContent = total ? mi : '—';
      $('#gaSd').textContent = total ? Math.sqrt(varr).toFixed(2) : '0';
      $('#gaOut').innerHTML = '理论二项分布 B(' + rows + ', 0.5)：均值 <b>' + (rows / 2).toFixed(2) + '</b>，标准差 <b>' + (Math.sqrt(rows * 0.25)).toFixed(2) + '</b>；实测均值 <b>' + (total ? mean.toFixed(2) : '—') + '</b>。';
    }
    function draw() {
      C.ctx.fillStyle = '#0d0d0d'; C.ctx.fillRect(0, 0, W, H);
      C.ctx.fillStyle = '#3a3a3a';
      pegs.forEach(p => { C.ctx.beginPath(); C.ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); C.ctx.fill(); });
      const maxB = Math.max(1, Math.max.apply(null, bins));
      const slotW = (W - 60) / slots;
      bins.forEach((c, i) => {
        const h = c / maxB * 78;
        C.ctx.fillStyle = '#d7f452';
        C.ctx.fillRect(30 + i * slotW + 1, H - 6 - h, slotW - 2, h);
        C.ctx.fillStyle = '#5a5a5a'; C.ctx.font = '9px Inter,sans-serif'; C.ctx.textAlign = 'center';
        if (c) C.ctx.fillText(c, 30 + i * slotW + slotW / 2, H - 10 - h);
      });
      // 理论曲线
      C.ctx.strokeStyle = 'rgba(255,255,255,.75)'; C.ctx.lineWidth = 1.6; C.ctx.beginPath();
      const fact = n => { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; };
      const Cnk = n => fact(rows) / (fact(n) * fact(rows - n));
      const theoMax = Cnk(Math.floor(rows / 2)) / Math.pow(2, rows);
      const scale = total ? (maxB / total) * 78 / (theoMax || 1) : 78 / (theoMax || 1);
      for (let i = 0; i <= rows; i++) {
        const y = H - 6 - (Cnk(i) / Math.pow(2, rows)) * scale;
        const x = 30 + i * slotW + slotW / 2;
        i ? C.ctx.lineTo(x, y) : C.ctx.moveTo(x, y);
      }
      C.ctx.stroke();
      C.ctx.fillStyle = '#fff';
      balls.forEach(b => { C.ctx.beginPath(); C.ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); C.ctx.fill(); });
      C.ctx.fillStyle = '#8a8a8a'; C.ctx.font = '11px Inter,sans-serif'; C.ctx.textAlign = 'left';
      C.ctx.fillText('落槽统计（上方数字为计数）', 30, H - 92);
    }
    const loop = Loop(dt => {
      if (!paused) { acc += dt * rate; let n = 0; while (acc >= 1 && n < 6) { dropBall(); acc -= 1; n++; } step(Math.min(dt, 0.033)); }
      draw();
    });
    bindRange('#gaRows', () => build());
    bindRange('#gaRate', v => rate = v);
    bindCtrl({ start: () => { paused = false; loop.start(); }, pause: () => paused = true, reset: build });
    ctlEl('#gStart').textContent = '播放';
    ctlEl('#gReset').textContent = '清空统计';
    $('#gaFast').addEventListener('click', () => { for (let i = 0; i < 500; i++) { let x = W / 2; for (let r = 0; r < rows; r++) x += (Math.random() < 0.5 ? -1 : 1) * 20; const idx = clamp(Math.floor((clamp(x, 12, W - 12) - 30) / ((W - 60) / slots)), 0, slots - 1); bins[idx]++; total++; } updateOut(); });
    $('#gaPng').addEventListener('click', () => pngOf(C.cv, 'galton-board.png'));
    build(); loop.start();
  };

  /* ---------------- Plinko ---------------- */
  G['plinko-simulator'] = function (host) {
    const W = 560, H = 480;
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          ${scorebar([['投币', 'plDrops'], ['收益', 'plPay'], ['回收率', 'plRtp']])}
          <div id="plWrap"></div>
          <div class="runnote">点顶部落币口投一颗；落袋按倍数计分，统计长期回收率。</div>
        </div>
      </div>
      ${paneBox('Plinko 模拟器', '钉子碰撞 + 逐格随机偏移 + 底部倍数袋，统计 RTP。',
      `<div class="plabel">钉排数</div>${TUI.range('plRows', 6, 14, 10, 1)}
        <div class="plabel">自动投币（颗/秒）</div>${TUI.range('plRate', 0, 30, 0, 1)}
        ${ctrlRow()}
        <div class="outbox" id="plOut">袋位倍数：—</div>`)}
    </div>`;
    const C = mkCanvas($('#plWrap'), W, H);
    const MULT = [8, 5, 3, 2, 1.2, 0.6, 0.4, 0.6, 1.2, 2, 3, 5, 8];
    let rows = 10, pegs = [], balls = [], drops = 0, pay = 0, acc = 0, paused = false;
    function build() {
      rows = +$('#plRows').value;
      pegs = []; balls = []; drops = 0; pay = 0; acc = 0;
      const gapX = Math.min(40, (W - 80) / (rows + 1)), gapY = (H - 180) / rows;
      for (let r = 0; r < rows; r++) {
        const n = r + 1;
        for (let i = 0; i < n; i++) pegs.push({ x: W / 2 + (i - (n - 1) / 2) * gapX, y: 40 + r * gapY, r: 3 });
      }
      $('#plOut').textContent = '袋位倍数：' + MULT.slice(0, rows + 1).join(' / ');
      update();
    }
    function update() {
      $('#plDrops').textContent = drops;
      $('#plPay').textContent = pay.toFixed(1);
      $('#plRtp').textContent = drops ? (pay / drops * 100).toFixed(1) + '%' : '—';
    }
    function drop() { balls.push({ x: W / 2 + rf(-3, 3), y: 14, vx: 0, vy: 40, r: 3.2 }); drops++; update(); }
    function step(dt) {
      for (let i = balls.length - 1; i >= 0; i--) {
        const b = balls[i];
        b.vy += 560 * dt; b.x += b.vx * dt; b.y += b.vy * dt;
        pegs.forEach(p => {
          const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy);
          if (d < p.r + b.r) {
            const nx = dx / (d || 1), ny = dy / (d || 1);
            b.x = p.x + nx * (p.r + b.r); b.y = p.y + ny * (p.r + b.r);
            const side = nx === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(nx);
            b.vx = side * Math.max(40, Math.abs(b.vy) * 0.5);
            b.vy = Math.abs(b.vy) * 0.45;
            tone(760 + ri(0, 220), 0.01, 'square', 0.015);
          }
        });
        if (b.y > H - 60) {
          const idx = clamp(Math.round((b.x - 40) / ((W - 80) / rows)), 0, Math.min(rows, MULT.length - 1));
          const m = MULT[Math.min(idx, MULT.length - 1)];
          pay += m; balls.splice(i, 1); update();
          tone(m >= 3 ? 900 : 500, 0.06, 'triangle', 0.1);
        }
      }
    }
    function draw() {
      C.ctx.fillStyle = '#0d0d0d'; C.ctx.fillRect(0, 0, W, H);
      C.ctx.fillStyle = '#3a3a3a';
      pegs.forEach(p => { C.ctx.beginPath(); C.ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); C.ctx.fill(); });
      const slotW = (W - 80) / rows;
      for (let i = 0; i <= rows; i++) {
        const m = MULT[Math.min(i, MULT.length - 1)];
        C.ctx.fillStyle = m >= 3 ? '#d7f452' : m >= 1 ? '#8fae1e' : '#3a3a20';
        C.ctx.fillRect(40 + i * slotW + 1, H - 52, slotW - 2, 40);
        C.ctx.fillStyle = '#0b0b0b'; C.ctx.font = '600 10px Inter,sans-serif'; C.ctx.textAlign = 'center';
        C.ctx.fillText('×' + m, 40 + i * slotW + slotW / 2, H - 30);
      }
      C.ctx.fillStyle = '#fff';
      balls.forEach(b => { C.ctx.beginPath(); C.ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); C.ctx.fill(); });
    }
    const loop = Loop(dt => {
      if (!paused) {
        const rate = +$('#plRate').value;
        if (rate > 0) { acc += dt * rate; let n = 0; while (acc >= 1 && n < 5) { drop(); acc -= 1; n++; } }
        step(Math.min(dt, 0.033));
      }
      draw();
    });
    C.cv.addEventListener('click', e => { unlockAudio(); drop(); });
    bindRange('#plRows', () => build());
    bindRange('#plRate', () => { });
    bindCtrl({ start: () => { paused = false; loop.start(); }, pause: () => paused = true, reset: build });
    ctlEl('#gStart').textContent = '播放';
    ctlEl('#gReset').textContent = '清空统计';
    build(); loop.start();
  };

  /* ---------------- 弹珠赛道 ---------------- */
  function marbleRaceUI(host, slug) {
    const W = 640, H = 440;
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          <div id="mrWrap"></div>
          <div class="outbox" id="mrOut" style="width:min(100%,640px)">点「开始比赛」生成随机赛道并放球。</div>
        </div>
      </div>
      ${paneBox('弹珠赛道', '每次生成新的随机障碍赛道，多颗弹珠同时下落，按到达终点顺序排名。',
      `<div class="plabel">弹珠数</div>${TUI.range('mrN', 2, 12, 6, 1)}
        <div class="plabel">障碍密度</div>${TUI.range('mrDens', 5, 40, 18, 1)}
        <div class="plabel">重力</div>${TUI.range('mrG', 200, 1400, 700, 20)}
        ${ctrlRow()}
        <div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="mrNew">换一条赛道</button></div>`)}
    </div>`;
    const C = mkCanvas($('#mrWrap'), W, H);
    let pegs = [], balls = [], order = [], running = false, started = false;
    function genTrack() {
      pegs = [];
      const dens = +$('#mrDens').value;
      for (let i = 0; i < dens; i++) {
        pegs.push({ x: rf(40, W - 40), y: rf(90, H - 90), r: rf(8, 20), spin: rf(-1, 1) });
      }
      balls = []; order = []; running = false; started = false;
      draw();
      $('#mrOut').textContent = '赛道已生成（' + pegs.length + ' 个障碍）— 点「开始比赛」。';
    }
    function startRace() {
      const n = +$('#mrN').value;
      balls = [];
      const lane = (W - 60) / n;
      for (let i = 0; i < n; i++) balls.push({ x: 30 + lane * (i + 0.5), y: 18, vx: rf(-20, 20), vy: 40, r: 6, c: 'hsl(' + (i * 360 / n | 0) + ',72%,62%)', done: false });
      order = []; running = true; started = true;
      $('#mrOut').textContent = '比赛中…';
    }
    function step(dt) {
      const g = +$('#mrG').value;
      balls.forEach(b => {
        if (b.done) return;
        b.vy += g * dt; b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.x - b.r < 0) { b.x = b.r; b.vx = Math.abs(b.vx) * 0.85; }
        if (b.x + b.r > W) { b.x = W - b.r; b.vx = -Math.abs(b.vx) * 0.85; }
        pegs.forEach(p => {
          const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy);
          if (d < p.r + b.r) {
            const nx = dx / (d || 1), ny = dy / (d || 1);
            b.x = p.x + nx * (p.r + b.r); b.y = p.y + ny * (p.r + b.r);
            const vn = b.vx * nx + b.vy * ny;
            b.vx -= 2 * vn * nx * 1.1; b.vy -= 2 * vn * ny * 1.1;
            b.vx += rf(-25, 25);
          }
        });
        if (b.y + b.r > H - 10) { b.done = true; b.y = H - 10 - b.r; if (order.indexOf(b) < 0) { order.push(b); tone(660 + order.length * 70, 0.08, 'triangle', 0.1); } }
      });
      if (balls.length && order.length === balls.length) {
        running = false;
        $('#mrOut').innerHTML = '最终排名：<b style="color:#d7f452">' + order.map((b, i) => (i + 1) + '号').join(' > ') + '</b>';
      }
    }
    function draw() {
      C.ctx.fillStyle = '#0d0d0d'; C.ctx.fillRect(0, 0, W, H);
      C.ctx.fillStyle = '#242424';
      pegs.forEach(p => { C.ctx.beginPath(); C.ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); C.ctx.fill(); C.ctx.strokeStyle = '#3a3a3a'; C.ctx.stroke(); });
      C.ctx.strokeStyle = '#d7f452'; C.ctx.setLineDash([8, 8]); C.ctx.beginPath(); C.ctx.moveTo(0, H - 10); C.ctx.lineTo(W, H - 10); C.ctx.stroke(); C.ctx.setLineDash([]);
      balls.forEach((b, i) => {
        C.ctx.fillStyle = b.c; C.ctx.beginPath(); C.ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); C.ctx.fill();
        C.ctx.fillStyle = '#fff'; C.ctx.font = '8px Inter,sans-serif'; C.ctx.textAlign = 'center'; C.ctx.textBaseline = 'middle';
        C.ctx.fillText(i + 1, b.x, b.y);
      });
    }
    const loop = Loop(dt => { if (running) step(Math.min(dt, 0.033)); draw(); });
    bindRange('#mrN', () => { }); bindRange('#mrDens', () => genTrack()); bindRange('#mrG', () => { });
    $('#mrNew').addEventListener('click', genTrack);
    bindCtrl({ start: startRace, pause: () => running = false, reset: genTrack });
    ctlEl('#gStart').textContent = '开始比赛';
    ctlEl('#gPause').textContent = '暂停比赛';
    ctlEl('#gReset').textContent = '换赛道';
    genTrack(); loop.start();
  }
  G['marble-race-simulator'] = marbleRaceUI;
  G['marble-race-maker'] = marbleRaceUI;

  /* ---------------- 多米诺连锁 ---------------- */
  function dominoUI(host, slug) {
    const W = 640, H = 300;
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          ${scorebar([['已倒下', 'domN'], ['总数', 'domTot']])}
          <div id="domWrap"></div>
          <div class="runnote">点第一个多米诺（或按空格）推倒它，连锁会一路传下去。</div>
        </div>
      </div>
      ${paneBox('多米诺连锁反应', '每块牌有独立角度与角速度，倒下的牌在角度超过阈值时把动量传给下一块。',
      `<div class="plabel">形状</div>${TUI.sel('domShape', [{ v: 'line', t: '直线' }, { v: 'curve', t: '弧线' }, { v: 'spiral', t: '螺旋' }, { v: 'random', t: '随机折线' }], 'curve')}
        <div class="plabel">数量</div>${TUI.range('domCount', 10, 90, 34, 1)}
        <div class="plabel">间距</div>${TUI.range('domGap', 10, 40, 18, 1)}
        <div class="plabel">重力</div>${TUI.range('domG', 1, 20, 8, 1)}
        ${ctrlRow()}`)}
    </div>`;
    const C = mkCanvas($('#domWrap'), W, H);
    let doms = [], paused = false, pushedIdx = -1;
    function build() {
      const shape = $('#domShape').value, n = +$('#domCount').value, gap = +$('#domGap').value;
      doms = [];
      for (let i = 0; i < n; i++) {
        let x, y;
        if (shape === 'line') { x = 40 + i * gap; y = H - 70; }
        else if (shape === 'curve') { const a = i / n * Math.PI; x = 40 + i * gap; y = H - 70 - Math.sin(a) * 90; }
        else if (shape === 'spiral') { const a = i / n * Math.PI * 3; const r = 60 + i * 2.2; x = W / 2 + Math.cos(a) * r; y = H / 2 + Math.sin(a) * r * 0.7; }
        else { x = 30 + i * gap; y = H - 70 - (Math.sin(i * 1.7) * 50); }
        doms.push({ x: x, y: y, a: 0, w: 0, fall: false, h: 40, hue: 30 + i * 3 });
      }
      pushedIdx = -1;
      update();
    }
    function update() { $('#domTot').textContent = doms.length; $('#domN').textContent = doms.filter(d => d.fall).length; }
    function push(i) {
      if (i < 0 || i >= doms.length || doms[i].fall) return;
      doms[i].fall = true; doms[i].w = 2.4 + rf(0, 0.6);
      tone(500 + i * 6, 0.05, 'square', 0.08);
      update();
    }
    function step(dt) {
      const g = +$('#domG').value / 8;
      doms.forEach((d, i) => {
        if (!d.fall) return;
        if (d.a < Math.PI / 2) {
          d.w += Math.sin(Math.PI / 2 - d.a) * g * dt * 6;
          d.a += d.w * dt * 3;
          if (d.a > Math.PI / 2) { d.a = Math.PI / 2; d.w *= 0.2; }
        }
        if (d.a > 0.42) {
          const nx = doms[i + 1];
          if (nx && !nx.fall) {
            const dist = Math.hypot(nx.x - d.x, nx.y - d.y);
            if (dist < d.h * 1.6) push(i + 1);
          }
        }
      });
    }
    function draw() {
      C.ctx.fillStyle = '#0f0f0f'; C.ctx.fillRect(0, 0, W, H);
      C.ctx.fillStyle = '#1c1c1c'; C.ctx.fillRect(0, H - 14, W, 14);
      doms.forEach((d, i) => {
        C.ctx.save();
        C.ctx.translate(d.x, d.y);
        C.ctx.rotate(d.a);
        const g = C.ctx.createLinearGradient(-5, -d.h, 5, 0);
        g.addColorStop(0, 'hsl(' + d.hue + ',70%,64%)'); g.addColorStop(1, 'hsl(' + (d.hue + 20) + ',70%,42%)');
        C.ctx.fillStyle = g;
        C.ctx.fillRect(-5, -d.h, 10, d.h);
        C.ctx.strokeStyle = 'rgba(0,0,0,.4)'; C.ctx.strokeRect(-5, -d.h, 10, d.h);
        C.ctx.restore();
      });
    }
    const loop = Loop(dt => { if (!paused) step(Math.min(dt, 0.033)); draw(); });
    C.cv.addEventListener('click', e => {
      const p = C.pos(e); unlockAudio();
      let best = -1, bd = 1e9;
      doms.forEach((d, i) => { const dd = Math.hypot(d.x - p.x, (d.y - d.h / 2) - p.y); if (dd < bd) { bd = dd; best = i; } });
      if (best >= 0 && bd < 60) push(best);
    });
    keys({ ' ': () => push(0) });
    $('#domShape').addEventListener('change', build);
    bindRange('#domCount', () => build()); bindRange('#domGap', () => build()); bindRange('#domG', () => { });
    bindCtrl({ start: () => { paused = false; loop.start(); }, pause: () => paused = true, reset: build });
    ctlEl('#gStart').textContent = '播放';
    ctlEl('#gPause').textContent = '暂停';
    ctlEl('#gReset').textContent = '重排';
    build(); loop.start();
  }
  G['domino-chain-reaction'] = dominoUI;
  G['chain-reaction-simulator'] = dominoUI;

  /* ---------------- 布娃娃 ---------------- */
  function ragdollUI(host, slug) {
    const W = 460, H = 420;
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap"><div id="rdWrap"></div>
        <div class="runnote">拖拽任意关节：Verlet 骨骼 + 距离约束会自然带动其余部位。</div></div>
      </div>
      ${paneBox('布娃娃物理', 'Verlet 质点 + 骨骼距离约束 + 关节，含地面与墙体碰撞。',
      `<div class="plabel">重力</div>${TUI.range('rdG', 0, 2400, 1000, 20)}
        <div class="plabel">约束迭代</div>${TUI.range('rdIter', 1, 16, 10, 1)}
        <div class="plabel">阻尼</div>${TUI.range('rdDamp', 90, 100, 99, 1)}
        ${ctrlRow()}
        <div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="rdKick">踹一脚</button></div>`)}
    </div>`;
    const C = mkCanvas($('#rdWrap'), W, H);
    let pts = [], bones = [], drag = null, paused = false;
    function build() {
      pts = []; bones = [];
      const cx = W / 2, cy = 120;
      const P = (x, y, pin) => { pts.push({ x: x, y: y, ox: x, oy: y, pin: !!pin }); return pts.length - 1; };
      const head = P(cx, cy - 46), neck = P(cx, cy - 22), hip = P(cx, cy + 40);
      const sL = P(cx - 46, cy - 12), eL = P(cx - 62, cy + 26), hL = P(cx - 66, cy + 62);
      const sR = P(cx + 46, cy - 12), eR = P(cx + 62, cy + 26), hR = P(cx + 66, cy + 62);
      const kL = P(cx - 20, cy + 96), fL = P(cx - 22, cy + 152);
      const kR = P(cx + 20, cy + 96), fR = P(cx + 22, cy + 152);
      const B = (a, b) => bones.push({ a: a, b: b, len: Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y) });
      B(head, neck); B(neck, hip);
      B(neck, sL); B(sL, eL); B(eL, hL);
      B(neck, sR); B(sR, eR); B(eR, hR);
      B(hip, kL); B(kL, fL);
      B(hip, kR); B(kR, fR);
      B(sL, hip, true); B(sR, hip, true);
      bones.forEach(b => { if (bones.filter(x => x.a === b.a && x.b === b.b).length > 1) b.len = Math.hypot(pts[b.a].x - pts[b.b].x, pts[b.a].y - pts[b.b].y); });
      drag = null;
    }
    function step(dt) {
      const g = +$('#rdG').value, damp = (+$('#rdDamp').value) / 100;
      const dtc = Math.min(dt, 0.033);
      pts.forEach(p => {
        if (p.pin) return;
        const vx = (p.x - p.ox) * damp, vy = (p.y - p.oy) * damp;
        p.ox = p.x; p.oy = p.y;
        p.x += vx + rf(-0.6, 0.6);
        p.y += vy + g * dtc * dtc;
      });
      const it = +$('#rdIter').value;
      for (let k = 0; k < it; k++) {
        bones.forEach(b => {
          const a = pts[b.a], c = pts[b.b];
          let dx = c.x - a.x, dy = c.y - a.y;
          const d = Math.hypot(dx, dy) || 0.001;
          const diff = (d - b.len) / d * 0.5;
          if (!a.pin) { a.x += dx * diff; a.y += dy * diff; }
          if (!c.pin) { c.x -= dx * diff; c.y -= dy * diff; }
        });
        pts.forEach(p => { if (p.y > H - 8) { p.y = H - 8; p.ox = p.x - (p.x - p.ox) * 0.6; p.oy = p.y + (p.y - p.oy) * 0.2; } });
        if (drag != null) { const p = pts[drag.i]; p.x = drag.x; p.y = drag.y; }
      }
    }
    function draw() {
      C.ctx.fillStyle = '#0d0d0d'; C.ctx.fillRect(0, 0, W, H);
      C.ctx.fillStyle = '#1c1c1c'; C.ctx.fillRect(0, H - 8, W, 8);
      C.ctx.strokeStyle = '#d7f452'; C.ctx.lineWidth = 5; C.ctx.lineCap = 'round';
      bones.forEach(b => {
        const a = pts[b.a], c = pts[b.b];
        C.ctx.beginPath(); C.ctx.moveTo(a.x, a.y); C.ctx.lineTo(c.x, c.y); C.ctx.stroke();
      });
      pts.forEach(p => { C.ctx.fillStyle = '#5fd0ff'; C.ctx.beginPath(); C.ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); C.ctx.fill(); });
      C.ctx.fillStyle = '#fff'; C.ctx.beginPath(); C.ctx.arc(pts[0].x, pts[0].y, 13, 0, Math.PI * 2); C.ctx.fill();
    }
    const loop = Loop(dt => { if (!paused) step(dt); draw(); });
    function down(e) {
      const p = C.pos(e); unlockAudio();
      let best = -1, bd = 900;
      pts.forEach((q, i) => { const d = (q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y); if (d < bd) { bd = d; best = i; } });
      if (best >= 0) drag = { i: best, x: p.x, y: p.y };
    }
    C.cv.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', e => { if (drag) { const p = C.pos(e); drag.x = p.x; drag.y = p.y; } });
    window.addEventListener('pointerup', () => drag = null);
    C.cv.addEventListener('touchstart', e => down(e.touches[0]), { passive: true });
    window.addEventListener('touchmove', e => { if (drag) { const p = C.pos(e.touches[0]); drag.x = p.x; drag.y = p.y; } }, { passive: true });
    window.addEventListener('touchend', () => drag = null);
    $('#rdKick').addEventListener('click', () => { pts.forEach(p => { p.pin = false; p.ox -= rf(6, 16); p.oy -= rf(-16, 4); }); tone(220, 0.08, 'square', 0.1); });
    bindRange('#rdG', () => { }); bindRange('#rdIter', () => { }); bindRange('#rdDamp', () => { });
    bindCtrl({ start: () => { paused = false; loop.start(); }, pause: () => paused = true, reset: build });
    ctlEl('#gStart').textContent = '播放';
    ctlEl('#gReset').textContent = '重新摆好';
    build(); loop.start();
  }
  G['ragdoll-physics-game'] = ragdollUI;
  G['ragdoll-playground'] = ragdollUI;

  /* ---------------- Boids 鸟群 ---------------- */
  function boidsUI(host, slug) {
    const W = 640, H = 440;
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          ${scorebar([['个体数', 'boN'], ['平均速度', 'boV'], ['帧率', 'boFps']])}
          <div id="boWrap"></div>
          <div class="runnote">鼠标移动会驱散鸟群；松开后它们重新聚成一群。</div>
        </div>
      </div>
      ${paneBox('Boids 鸟群', 'Reynolds 三条规则：分离（separation）+ 对齐（alignment）+ 聚合（cohesion），逐条可调权重。',
      `<div class="plabel">数量</div>${TUI.range('boCount', 20, 400, 140, 10)}
        <div class="plabel">分离权重</div>${TUI.range('boSep', 0, 40, 14, 1)}
        <div class="plabel">对齐权重</div>${TUI.range('boAli', 0, 40, 10, 1)}
        <div class="plabel">聚合权重</div>${TUI.range('boCoh', 0, 40, 8, 1)}
        <div class="plabel">感知半径</div>${TUI.range('boR', 20, 140, 60, 2)}
        <div class="plabel">最大速度</div>${TUI.range('boMax', 20, 260, 120, 5)}
        ${ctrlRow()}`)}
    </div>`;
    const C = mkCanvas($('#boWrap'), W, H);
    let birds = [], paused = false, fps = 60;
    function spawn() {
      const n = +$('#boCount').value;
      birds = [];
      for (let i = 0; i < n; i++) birds.push({ x: rf(0, W), y: rf(0, H), vx: rf(-1, 1), vy: rf(-1, 1) });
      $('#boN').textContent = n;
    }
    function step(dt) {
      const sep = +$('#boSep').value, ali = +$('#boAli').value, coh = +$('#boCoh').value;
      const R = +$('#boR').value, maxV = +$('#boMax').value;
      const R2 = R * R;
      for (let i = 0; i < birds.length; i++) {
        const b = birds[i];
        let sx = 0, sy = 0, ax = 0, ay = 0, cx = 0, cy = 0, cn = 0, sn = 0;
        for (let j = 0; j < birds.length; j++) {
          if (i === j) continue;
          const o = birds[j];
          const dx = o.x - b.x, dy = o.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > R2 || d2 === 0) continue;
          cx += o.x; cy += o.y; ax += o.vx; ay += o.vy; cn++;
          const d = Math.sqrt(d2);
          if (d < R * 0.45) { sx -= dx / d; sy -= dy / d; sn++; }
        }
        let fx = 0, fy = 0;
        if (sn) { fx += sx / sn * sep; fy += sy / sn * sep; }
        if (cn) {
          fx += (ax / cn - b.vx) * ali / 10; fy += (ay / cn - b.vy) * ali / 10;
          fx += (cx / cn - b.x) * coh / 400; fy += (cy / cn - b.y) * coh / 400;
        }
        if (mouse.x != null) {
          const dx = b.x - mouse.x, dy = b.y - mouse.y, d = Math.hypot(dx, dy);
          if (d < 90) { fx += dx / (d || 1) * 60 * (1 - d / 90); fy += dy / (d || 1) * 60 * (1 - d / 90); }
        }
        if (b.x < 20) fx += 60; if (b.x > W - 20) fx -= 60;
        if (b.y < 20) fy += 60; if (b.y > H - 20) fy -= 60;
        b.vx += fx * dt; b.vy += fy * dt;
        const sp = Math.hypot(b.vx, b.vy);
        const minV = 30;
        if (sp > maxV) { b.vx = b.vx / sp * maxV; b.vy = b.vy / sp * maxV; }
        else if (sp < minV && sp > 0) { b.vx = b.vx / sp * minV; b.vy = b.vy / sp * minV; }
        b.x += b.vx * dt; b.y += b.vy * dt;
      }
      let sum = 0; birds.forEach(b => sum += Math.hypot(b.vx, b.vy));
      $('#boV').textContent = birds.length ? Math.round(sum / birds.length) : '0';
      $('#boFps').textContent = Math.round(fps);
    }
    function draw() {
      C.ctx.fillStyle = 'rgba(11,11,11,.32)'; C.ctx.fillRect(0, 0, W, H);
      C.ctx.lineWidth = 1.4;
      birds.forEach(b => {
        const a = Math.atan2(b.vy, b.vx);
        C.ctx.strokeStyle = 'rgba(215,244,82,.85)';
        C.ctx.beginPath();
        C.ctx.moveTo(b.x - Math.cos(a - 0.4) * 7, b.y - Math.sin(a - 0.4) * 7);
        C.ctx.lineTo(b.x, b.y);
        C.ctx.lineTo(b.x - Math.cos(a + 0.4) * 7, b.y - Math.sin(a + 0.4) * 7);
        C.ctx.stroke();
      });
    }
    const mouse = { x: null, y: null };
    const loop = Loop((dt, t) => { fps = fps * 0.9 + (1 / Math.max(0.001, dt)) * 0.1; if (!paused) step(Math.min(dt, 0.033)); draw(); });
    C.cv.addEventListener('pointermove', e => { const p = C.pos(e); mouse.x = p.x; mouse.y = p.y; });
    C.cv.addEventListener('pointerleave', () => { mouse.x = null; mouse.y = null; });
    C.cv.addEventListener('touchmove', e => { const p = C.pos(e.touches[0]); mouse.x = p.x; mouse.y = p.y; }, { passive: true });
    C.cv.addEventListener('touchend', () => { mouse.x = null; mouse.y = null; });
    bindRange('#boCount', () => spawn());
    ['#boSep', '#boAli', '#boCoh', '#boR', '#boMax'].forEach(id => bindRange(id, () => { }));
    bindCtrl({ start: () => { paused = false; loop.start(); }, pause: () => paused = true, reset: spawn });
    ctlEl('#gStart').textContent = '播放';
    ctlEl('#gReset').textContent = '重新撒鸟';
    C.ctx.fillStyle = '#0b0b0b'; C.ctx.fillRect(0, 0, W, H);
    spawn(); loop.start();
  }
  G['boids-simulator'] = boidsUI;
  G['flocking-simulator'] = boidsUI;
  G['bird-flock-simulation'] = boidsUI;

  /* ---------------- 元胞自动机（自定义 B/S 规则） ---------------- */
  function caUI(host, slug) {
    const GW = 140, GH = 92, SCALE = 4;
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          ${scorebar([['世代', 'caGen'], ['存活', 'caAlive'], ['规则', 'caRule', null, 'B3/S23']])}
          <div id="caWrap"></div>
          <div class="runnote">左键涂活细胞，右键涂死细胞；拖动可连续画。</div>
        </div>
      </div>
      ${paneBox('元胞自动机', '自定义出生/存活规则（B…/S…），支持网格编辑、随机播种、单步与调速。',
      `<div class="plabel">规则</div>${TUI.input('caRule', 'B3/S23', '例如 B3/S23 或 B36/S23')}
        <div class="shapes" id="caPresets" style="margin-top:10px">${[['生命游戏', 'B3/S23'], ['高生命', 'B36/S23'], ['种子', 'B2/S'], ['日芒', 'B345/S5'], ['迷宫', 'B3/S12345'], ['没有死亡', 'B3/S012345678']].map(p => `<button class="shape" data-v="${p[1]}">${p[0]}</button>`).join('')}</div>
        <div class="plabel">速度（代/秒）</div>${TUI.range('caSpeed', 1, 60, 14, 1)}
        <div class="plabel">随机密度</div>${TUI.range('caDens', 5, 90, 32, 1)}
        ${ctrlRow()}
        <div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="caRnd">随机播种</button><button class="btn-ghost btn-sm" id="caClear">清空</button><button class="btn-ghost btn-sm" id="caStep">单步</button></div>`)}
    </div>`;
    const C = mkCanvas($('#caWrap'), GW * SCALE, GH * SCALE);
    const off = document.createElement('canvas'); off.width = GW; off.height = GH;
    const octx = off.getContext('2d');
    const img = octx.createImageData(GW, GH);
    let a = new Uint8Array(GW * GH), b = new Uint8Array(GW * GH);
    let gen = 0, acc = 0, paused = false, painting = 0, birth = [3], surv = [2, 3];
    function parseRule(txt) {
      const m = /B([0-8]*)\/S([0-8]*)/i.exec(String(txt).replace(/\s/g, ''));
      if (!m) return false;
      birth = m[1].split('').map(Number).filter(n => !isNaN(n));
      surv = m[2].split('').map(Number).filter(n => !isNaN(n));
      return true;
    }
    function step() {
      for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = (x + dx + GW) % GW, ny = (y + dy + GH) % GH;
          if (a[ny * GW + nx]) n++;
        }
        const alive = a[y * GW + x];
        b[y * GW + x] = (alive ? (surv.indexOf(n) >= 0 ? 1 : 0) : (birth.indexOf(n) >= 0 ? 1 : 0));
      }
      const t = a; a = b; b = t; gen++;
    }
    function render() {
      const d = img.data; let cnt = 0;
      for (let i = 0; i < GW * GH; i++) {
        const v = a[i];
        if (v) cnt++;
        const o = i * 4;
        d[o] = v ? 215 : 13; d[o + 1] = v ? 244 : 13; d[o + 2] = v ? 82 : 15; d[o + 3] = 255;
      }
      octx.putImageData(img, 0, 0);
      C.ctx.imageSmoothingEnabled = false;
      C.ctx.drawImage(off, 0, 0, GW, GH, 0, 0, C.W, C.H);
      $('#caGen').textContent = gen; $('#caAlive').textContent = cnt;
    }
    const loop = Loop(dt => {
      if (!paused) { acc += dt * (+$('#caSpeed').value); let n = 0; while (acc >= 1 && n < 4) { step(); acc -= 1; n++; } }
      render();
    });
    function seed() {
      const p = (+$('#caDens').value) / 100;
      for (let i = 0; i < GW * GH; i++) a[i] = Math.random() < p ? 1 : 0;
      gen = 0;
    }
    const p2 = e => { const p = C.pos(e); return { x: Math.floor(p.x / SCALE), y: Math.floor(p.y / SCALE) }; };
    C.cv.addEventListener('pointerdown', e => { painting = e.button === 2 ? 2 : 1; unlockAudio(); const p = p2(e); a[p.y * GW + p.x] = painting === 1 ? 1 : 0; });
    C.cv.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('pointermove', e => { if (painting) { const p = p2(e); if (p.x >= 0 && p.y >= 0 && p.x < GW && p.y < GH) a[p.y * GW + p.x] = painting === 1 ? 1 : 0; } });
    window.addEventListener('pointerup', () => painting = 0);
    C.cv.addEventListener('touchstart', e => { painting = 1; const p = p2(e.touches[0]); a[p.y * GW + p.x] = 1; }, { passive: true });
    window.addEventListener('touchmove', e => { if (painting) { const p = p2(e.touches[0]); if (p.x >= 0 && p.y >= 0 && p.x < GW && p.y < GH) a[p.y * GW + p.x] = 1; } }, { passive: true });
    window.addEventListener('touchend', () => painting = 0);
    $('#caRule').addEventListener('change', () => {
      const t = $('#caRule').value;
      const okRule = parseRule(t);
      if (!okRule) window.toast('规则格式应为 B3/S23');
      $('#caRule').style.borderColor = okRule ? '#3a3a3a' : '#7a1f1f';
    });
    $('#caPresets').addEventListener('click', e => {
      const bt = e.target.closest('.shape'); if (!bt) return;
      $('#caRule').value = bt.dataset.v; parseRule(bt.dataset.v);
      toastSafe('已切换规则 ' + bt.dataset.v);
    });
    bindRange('#caSpeed', () => { }); bindRange('#caDens', () => { });
    $('#caRnd').addEventListener('click', seed);
    $('#caClear').addEventListener('click', () => { a.fill(0); gen = 0; });
    $('#caStep').addEventListener('click', () => { step(); });
    bindCtrl({ start: () => { paused = false; loop.start(); }, pause: () => paused = true, reset: () => { a.fill(0); gen = 0; } });
    ctlEl('#gStart').textContent = '播放';
    ctlEl('#gReset').textContent = '清空';
    parseRule('B3/S23');
    if (slug === 'conways-game-of-life' || slug === 'game-of-life') {
      a.fill(0); gen = 0;
      const put = (x0, y0, cells) => cells.forEach(c => { const x = x0 + c[0], y = y0 + c[1]; if (x >= 0 && y >= 0 && x < GW && y < GH) a[y * GW + x] = 1; });
      const GLIDER = [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]];
      const PULSAR = [[2, 0], [3, 0], [4, 0], [8, 0], [9, 0], [10, 0], [0, 2], [5, 2], [7, 2], [12, 2], [0, 3], [5, 3], [7, 3], [12, 3], [0, 4], [5, 4], [7, 4], [12, 4], [2, 5], [3, 5], [4, 5], [8, 5], [9, 5], [10, 5], [2, 7], [3, 7], [4, 7], [8, 7], [9, 7], [10, 7], [0, 8], [5, 8], [7, 8], [12, 8], [0, 9], [5, 9], [7, 9], [12, 9], [0, 10], [5, 10], [7, 10], [12, 10], [2, 12], [3, 12], [4, 12], [8, 12], [9, 12], [10, 12]];
      const GUN = [];
      const GUNROWS = [[24, 0], [22, 1], [24, 1], [12, 2], [13, 2], [20, 2], [21, 2], [34, 2], [35, 2], [11, 3], [15, 3], [20, 3], [21, 3], [34, 3], [35, 3], [0, 4], [1, 4], [10, 4], [16, 4], [20, 4], [21, 4], [0, 5], [1, 5], [10, 5], [14, 5], [16, 5], [17, 5], [22, 5], [24, 5], [10, 6], [16, 6], [24, 6], [11, 7], [15, 7], [12, 8], [13, 8]];
      GUNROWS.forEach(c => GUN.push(c));
      put(4, 4, GLIDER); put(30, 20, PULSAR); put(70, 4, GUN);
      $('#caRule').value = 'B3/S23'; parseRule('B3/S23');
      $('#caRule').closest('.pane').insertAdjacentHTML('afterbegin', '<div class="pdesc" style="color:#d7f452">已预置图案：滑翔机（左上）、脉冲星（中）、高斯帕滑翔机枪（右上）。可以在此基础上继续涂画。</div>');
    } else seed();
    render(); loop.start();
  }
  G['cellular-automaton-simulator'] = caUI;
  G['conways-game-of-life'] = caUI;
  G['game-of-life'] = caUI;

  /* ---------------- 逻辑电路 ---------------- */
  G['logic-circuit-simulator'] = function (host) {
    const W = 640, H = 420;
    const GATES = { AND: 2, OR: 2, NOT: 1, NAND: 2, NOR: 2, XOR: 2, SWITCH: 0, LED: 1 };
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          <div id="lcWrap"></div>
          <div class="runnote">从右侧工具箱选一个元件，点画布空白处放置；从元件右侧圆点拖到另一个元件左侧圆点即可连线。</div>
        </div>
      </div>
      ${paneBox('逻辑电路模拟', '真值仿真：每帧迭代求值到稳定。开关可点击切换 0/1，导线与元件会按电平着色。',
      `<div class="shapes" id="lcPalette" style="margin-top:12px">${Object.keys(GATES).map(k => TUI.pill(k, k, k === 'AND')).join('')}</div>
        <div class="shapes" style="margin-top:12px;gap:8px">
          <button class="btn-lime btn-sm" id="gStart">放置选中元件</button>
          <button class="btn-ghost btn-sm" id="lcDel">删除模式</button>
          <button class="btn-ghost btn-sm" id="lcClear">清空</button>
        </div>
        <div class="outbox" id="lcOut">元件：0 · 连线：0</div>
        <div class="runnote">提示：点「放置选中元件」后在画布上点一下即可放在该位置；拖动元件可移动，点开关可翻转电平。</div>`)}
    </div>`;
    const C = mkCanvas($('#lcWrap'), W, H);
    let nodes = [], wires = [], nextId = 1, mode = 'AND', placeMode = false, delMode = false, drag = null, wireFrom = null;
    function addNode(type, x, y) {
      const n = { id: nextId++, type: type, x: x, y: y, ins: GATES[type], val: 0, sw: 0 };
      for (let i = 0; i < n.ins; i++) n['in' + i] = 0;
      nodes.push(n); return n;
    }
    function inPos(n, i) { return { x: n.x - 34, y: n.y - (n.ins - 1) * 12 + i * 24 }; }
    function outPos(n) { return { x: n.x + 34, y: n.y }; }
    function nodeAt(x, y) { for (let i = nodes.length - 1; i >= 0; i--) if (Math.abs(nodes[i].x - x) < 40 && Math.abs(nodes[i].y - y) < 26) return nodes[i]; return null; }
    function inAt(x, y) { for (let i = 0; i < nodes.length; i++) { const n = nodes[i]; for (let k = 0; k < n.ins; k++) { const p = inPos(n, k); if (Math.hypot(p.x - x, p.y - y) < 10) return { n: n, i: k }; } } return null; }
    function outAt(x, y) { for (let i = 0; i < nodes.length; i++) { const n = nodes[i]; const p = outPos(n); if (Math.hypot(p.x - x, p.y - y) < 10) return n; } return null; }
    function inputOf(n, i) { for (let k = 0; k < wires.length; k++) { if (wires[k].to === n.id && wires[k].port === i) return wires[k]; } return null; }
    function evalCircuit() {
      for (let pass = 0; pass < 12; pass++) {
        nodes.forEach(n => {
          const vals = [];
          for (let i = 0; i < n.ins; i++) {
            const w = inputOf(n, i);
            const src = w ? nodes.find(x => x.id === w.from) : null;
            vals.push(src ? src.val : 0);
          }
          let v = 0;
          if (n.type === 'SWITCH') v = n.sw;
          else if (n.type === 'LED') v = vals[0] || 0;
          else if (n.type === 'AND') v = vals[0] && vals[1] ? 1 : 0;
          else if (n.type === 'OR') v = vals[0] || vals[1] ? 1 : 0;
          else if (n.type === 'NOT') v = vals[0] ? 0 : 1;
          else if (n.type === 'NAND') v = (vals[0] && vals[1]) ? 0 : 1;
          else if (n.type === 'NOR') v = (vals[0] || vals[1]) ? 0 : 1;
          else if (n.type === 'XOR') v = (vals[0] !== vals[1]) ? 1 : 0;
          n.val = v;
        });
      }
    }
    function draw() {
      C.ctx.fillStyle = '#0d0d0d'; C.ctx.fillRect(0, 0, W, H);
      C.ctx.strokeStyle = '#161616'; C.ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 20) { C.ctx.beginPath(); C.ctx.moveTo(x, 0); C.ctx.lineTo(x, H); C.ctx.stroke(); }
      for (let y = 0; y < H; y += 20) { C.ctx.beginPath(); C.ctx.moveTo(0, y); C.ctx.lineTo(W, y); C.ctx.stroke(); }
      wires.forEach(w => {
        const a = nodes.find(n => n.id === w.from), b = nodes.find(n => n.id === w.to);
        if (!a || !b) return;
        const p1 = outPos(a), p2 = inPos(b, w.port);
        C.ctx.strokeStyle = a.val ? '#d7f452' : '#3a3a3a'; C.ctx.lineWidth = a.val ? 2.6 : 2;
        C.ctx.beginPath();
        C.ctx.moveTo(p1.x, p1.y);
        C.ctx.bezierCurveTo(p1.x + 40, p1.y, p2.x - 40, p2.y, p2.x, p2.y);
        C.ctx.stroke();
      });
      if (wireFrom) {
        const p = outPos(wireFrom.n);
        C.ctx.strokeStyle = 'rgba(215,244,82,.7)'; C.ctx.setLineDash([5, 5]); C.ctx.lineWidth = 2;
        C.ctx.beginPath(); C.ctx.moveTo(p.x, p.y); C.ctx.lineTo(wireFrom.x, wireFrom.y); C.ctx.stroke(); C.ctx.setLineDash([]);
      }
      nodes.forEach(n => {
        const w = n.type === 'SWITCH' ? 60 : 68, h = 44;
        C.ctx.fillStyle = n.val && n.type !== 'SWITCH' ? '#20240e' : '#141414';
        C.ctx.strokeStyle = n.val ? '#d7f452' : '#3a3a3a'; C.ctx.lineWidth = 2;
        C.ctx.beginPath();
        if (C.ctx.roundRect) C.ctx.roundRect(n.x - w / 2, n.y - h / 2, w, h, 9); else C.ctx.rect(n.x - w / 2, n.y - h / 2, w, h);
        C.ctx.fill(); C.ctx.stroke();
        C.ctx.fillStyle = '#e5e5e5'; C.ctx.font = '700 13px Inter,sans-serif'; C.ctx.textAlign = 'center'; C.ctx.textBaseline = 'middle';
        C.ctx.fillText(n.type === 'SWITCH' ? (n.sw ? '1' : '0') : n.type, n.x, n.y);
        if (n.type === 'LED') {
          C.ctx.fillStyle = n.val ? '#d7f452' : '#333';
          C.ctx.beginPath(); C.ctx.arc(n.x + 22, n.y, 5, 0, Math.PI * 2); C.ctx.fill();
        }
        for (let i = 0; i < n.ins; i++) {
          const p = inPos(n, i);
          const w2 = inputOf(n, i);
          const src = w2 ? nodes.find(x => x.id === w2.from) : null;
          C.ctx.fillStyle = src && src.val ? '#d7f452' : '#555';
          C.ctx.beginPath(); C.ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); C.ctx.fill();
        }
        const op = outPos(n);
        C.ctx.fillStyle = n.val ? '#d7f452' : '#555';
        C.ctx.beginPath(); C.ctx.arc(op.x, op.y, 5, 0, Math.PI * 2); C.ctx.fill();
      });
      $('#lcOut').textContent = '元件：' + nodes.length + ' · 连线：' + wires.length;
    }
    const loop = Loop(() => { evalCircuit(); draw(); });
    C.cv.addEventListener('pointerdown', e => {
      const p = C.pos(e); unlockAudio();
      const n = nodeAt(p.x, p.y);
      if (delMode) { if (n) { nodes = nodes.filter(x => x !== n); wires = wires.filter(w => w.from !== n.id && w.to !== n.id); } return; }
      const o = outAt(p.x, p.y);
      if (o && !(n && n.type === 'LED')) { wireFrom = { n: o, x: p.x, y: p.y }; return; }
      if (n) {
        if (n.type === 'SWITCH') { n.sw = n.sw ? 0 : 1; tone(n.sw ? 700 : 400, 0.05, 'square', 0.1); }
        drag = { n: n, dx: p.x - n.x, dy: p.y - n.y, moved: false };
      }
    });
    window.addEventListener('pointermove', e => {
      if (wireFrom) { const p = C.pos(e); wireFrom.x = p.x; wireFrom.y = p.y; }
      if (drag) { const p = C.pos(e); drag.n.x = clamp(p.x - drag.dx, 40, W - 40); drag.n.y = clamp(p.y - drag.dy, 24, H - 24); drag.moved = true; }
    });
    window.addEventListener('pointerup', e => {
      if (wireFrom) {
        const p = C.pos(e); const t = inAt(p.x, p.y);
        if (t && t.n.id !== wireFrom.n.id) {
          wires = wires.filter(w => !(w.to === t.n.id && w.port === t.i));
          wires.push({ from: wireFrom.n.id, to: t.n.id, port: t.i });
          tone(880, 0.04, 'square', 0.08);
        }
        wireFrom = null;
      }
      drag = null;
    });
    C.cv.addEventListener('click', e => {
      if (!placeMode) return;
      const p = C.pos(e);
      if (nodeAt(p.x, p.y)) return;
      addNode(mode, clamp(p.x, 40, W - 40), clamp(p.y, 24, H - 24));
      placeMode = false;
      ctlEl('#gStart').classList.remove('on');
    });
    bindPills('#lcPalette', v => { mode = v; });
    ctlEl('#gStart').addEventListener('click', () => { addNode(mode, 160 + rf(-60, 60), 90 + rf(-40, 40)); });
    $('#lcDel').addEventListener('click', () => { delMode = !delMode; $('#lcDel').classList.toggle('on', delMode); toastSafe(delMode ? '删除模式：点元件即删除' : '退出删除模式'); });
    $('#lcClear').addEventListener('click', () => { nodes = []; wires = []; nextId = 1; });
    bindCtrl({ pause: () => loop.stop(), reset: () => { nodes = []; wires = []; nextId = 1; } });
    ctlEl('#gStart').textContent = '加一个选中元件';
    ctlEl('#gPause').textContent = '暂停仿真';
    ctlEl('#gReset').textContent = '清空电路';
    // 预置：一半加器示例
    (function demo() {
      const A = addNode('SWITCH', 130, 140), B = addNode('SWITCH', 130, 240);
      const X = addNode('XOR', 300, 140), An = addNode('AND', 300, 250);
      const S = addNode('LED', 480, 140), Co = addNode('LED', 480, 250);
      A.sw = 1;
      wires.push({ from: A.id, to: X.id, port: 0 }, { from: B.id, to: X.id, port: 1 });
      wires.push({ from: A.id, to: An.id, port: 0 }, { from: B.id, to: An.id, port: 1 });
      wires.push({ from: X.id, to: S.id, port: 0 }, { from: An.id, to: Co.id, port: 0 });
    })();
    loop.start();
  };

  /* ---------------- 撞角屏保 / DVD 屏保 ---------------- */
  function bounceScreenUI(host, slug) {
    const W = 640, H = 420;
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          ${scorebar([['撞墙次数', 'bsHits'], ['当前颜色', 'bsCol', null, '—']])}
          <div id="bsWrap"></div>
          <div class="runnote">每次撞墙换一种颜色；可以全屏当作真正的屏保。</div>
        </div>
      </div>
      ${paneBox('撞角屏保', '经典 DVD 标志弹跳 + 撞墙变色，附带拖尾效果。',
      `<div class="plabel">速度</div>${TUI.range('bsSpeed', 30, 600, 180, 10)}
        <div class="plabel">拖尾长度</div>${TUI.range('bsTrail', 0, 40, 14, 1)}
        <div class="plabel">显示文字</div>${TUI.input('bsText', slug === 'dvd-screensaver' ? 'DVD' : '我的工作台', '文字')}
        ${ctrlRow()}
        <div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="bsFull">全屏</button></div>`)}
    </div>`;
    const C = mkCanvas($('#bsWrap'), W, H);
    let x = 80, y = 60, vx = 170, vy = 130, hits = 0, paused = false, trail = [];
    const COLORS = ['#d7f452', '#5fd0ff', '#ff8fb1', '#ffd166', '#9be564', '#c39bff', '#ff9f6b'];
    let ci = 0;
    function step(dt) {
      const sp = +$('#bsSpeed').value;
      const L = Math.hypot(vx, vy) || 1;
      vx = vx / L * sp; vy = vy / L * sp;
      x += vx * dt; y += vy * dt;
      const bw = 150, bh = 52;
      let hit = false;
      if (x < 0) { x = 0; vx = Math.abs(vx); hit = true; }
      if (x + bw > C.W) { x = C.W - bw; vx = -Math.abs(vx); hit = true; }
      if (y < 0) { y = 0; vy = Math.abs(vy); hit = true; }
      if (y + bh > C.H) { y = C.H - bh; vy = -Math.abs(vy); hit = true; }
      if (hit) {
        hits++; ci = (ci + 1) % COLORS.length;
        $('#bsHits').textContent = hits; $('#bsCol').textContent = COLORS[ci];
        tone(500 + ci * 60, 0.05, 'triangle', 0.07);
      }
      const tl = +$('#bsTrail').value;
      trail.push([x, y, COLORS[ci]]);
      while (trail.length > Math.max(1, tl)) trail.shift();
    }
    function draw() {
      C.ctx.fillStyle = 'rgba(11,11,11,' + (trail.length > 1 ? 0.22 : 1) + ')';
      C.ctx.fillRect(0, 0, C.W, C.H);
      if (trail.length > 1) {
        trail.forEach((t, i) => {
          C.ctx.globalAlpha = i / trail.length * 0.35;
          C.ctx.fillStyle = t[2];
          C.ctx.fillRect(t[0], t[1], 150, 52);
        });
        C.ctx.globalAlpha = 1;
      }
      const g = C.ctx.createLinearGradient(x, y, x + 150, y + 52);
      g.addColorStop(0, COLORS[ci]); g.addColorStop(1, '#ffffff');
      C.ctx.fillStyle = g;
      C.ctx.fillRect(x, y, 150, 52);
      C.ctx.fillStyle = '#0b0b0b';
      C.ctx.font = '800 24px Inter,sans-serif';
      C.ctx.textAlign = 'center'; C.ctx.textBaseline = 'middle';
      C.ctx.fillText(($('#bsText').value || '我的工作台').slice(0, 14), x + 75, y + 26);
    }
    const loop = Loop(dt => { if (!paused) step(Math.min(dt, 0.05)); draw(); });
    $('#bsFull').addEventListener('click', () => {
      const el2 = C.cv;
      if (el2.requestFullscreen) el2.requestFullscreen().catch(() => window.toast('浏览器拒绝了全屏请求'));
      else window.toast('当前浏览器不支持全屏 API');
    });
    bindRange('#bsSpeed', () => { }); bindRange('#bsTrail', () => { });
    bindCtrl({ start: () => { paused = false; loop.start(); }, pause: () => paused = true, reset: () => { x = 80; y = 60; hits = 0; trail = []; } });
    ctlEl('#gStart').textContent = '播放';
    ctlEl('#gReset').textContent = '回到起点';
    loop.start();
  }
  G['corner-bounce-screensaver'] = bounceScreenUI;
  G['dvd-screensaver'] = bounceScreenUI;

  /* ---------------- 熔岩灯 ---------------- */
  function lavaLampUI(host, slug) {
    const GW = 190, GH = 150, SCALE = 4;
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap"><div id="llWrap"></div>
        <div class="runnote">团块用 SDF（软体元球）合成，颜色按「温度」在冷紫 ↔ 暖橙之间插值。</div></div>
      </div>
      ${paneBox('熔岩灯', 'Metaball 软体团缓慢上升下降，背景是温度渐变。',
      `<div class="plabel">团块数量</div>${TUI.range('llN', 4, 30, 14, 1)}
        <div class="plabel">上升速度</div>${TUI.range('llSpeed', 1, 40, 12, 1)}
        <div class="plabel">表面张力（阈值）</div>${TUI.range('llTh', 10, 90, 42, 1)}
        <div class="plabel">颜色模式</div>${TUI.sel('llMode', [{ v: 'lava', t: '熔岩（橙紫）' }, { v: 'ocean', t: '深海（青蓝）' }, { v: 'acid', t: '荧光（黄绿）' }], 'lava')}
        ${ctrlRow()}
        <div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="llPng">导出 PNG</button></div>`)}
    </div>`;
    const C = mkCanvas($('#llWrap'), GW * SCALE, GH * SCALE);
    const off = document.createElement('canvas'); off.width = GW; off.height = GH;
    const octx = off.getContext('2d');
    const img = octx.createImageData(GW, GH);
    let blobs = [], paused = false;
    function seed() {
      const n = +$('#llN').value;
      blobs = [];
      for (let i = 0; i < n; i++) {
        const r = rf(9, 22);
        blobs.push({ x: rf(r + 6, GW - r - 6), y: rf(r + 6, GH - r - 6), r: r, vy: rf(-1, 1), vx: rf(-0.4, 0.4), temp: rf(0, 1) });
      }
    }
    function step(dt) {
      const sp = +$('#llSpeed').value / 12;
      const t = performance.now() / 1000;
      blobs.forEach((b, i) => {
        b.temp = 0.5 + 0.5 * Math.sin(t * 0.35 + i * 1.7);
        const buoy = (b.temp - 0.5) * sp * 22;
        b.vy += (buoy - b.vy) * 0.02;
        b.x += b.vx * sp * 8 * dt; b.y -= b.vy * dt * 2.2;
        if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx); }
        if (b.x > GW - b.r) { b.x = GW - b.r; b.vx = -Math.abs(b.vx); }
        if (b.y < b.r) { b.y = b.r; b.vy = -Math.abs(b.vy) * 0.6; }
        if (b.y > GH - b.r) { b.y = GH - b.r; b.vy = Math.abs(b.vy) * 0.6; }
      });
      // 软体分离
      for (let i = 0; i < blobs.length; i++) for (let j = i + 1; j < blobs.length; j++) {
        const a = blobs[i], c = blobs[j];
        const dx = c.x - a.x, dy = c.y - a.y, d = Math.hypot(dx, dy), minD = (a.r + c.r) * 0.62;
        if (d < minD && d > 0.01) {
          const push = (minD - d) / 2;
          a.x -= dx / d * push; a.y -= dy / d * push;
          c.x += dx / d * push; c.y += dy / d * push;
        }
      }
    }
    function render() {
      const mode = $('#llMode').value;
      const th = (+$('#llTh').value) / 100 * 8;
      const d = img.data;
      for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
        let sum = 0, hot = 0;
        for (let i = 0; i < blobs.length; i++) {
          const b = blobs[i];
          const dx = x - b.x, dy = y - b.y;
          const dist2 = dx * dx + dy * dy + 1;
          const f = b.r * b.r / dist2;
          sum += f; hot += f * b.temp;
        }
        const o = (y * GW + x) * 4;
        const tt = sum / (th || 1);
        if (tt > 1) {
          const k = clamp((hot / (sum || 1)), 0, 1);
          const q = clamp((tt - 1) * 0.5, 0, 1);
          if (mode === 'lava') { d[o] = 120 + k * 135; d[o + 1] = 30 + k * 90 + q * 40; d[o + 2] = 60 + (1 - k) * 130; }
          else if (mode === 'ocean') { d[o] = 20 + k * 60; d[o + 1] = 90 + k * 120; d[o + 2] = 150 + k * 100; }
          else { d[o] = 90 + k * 150; d[o + 1] = 200 + k * 55; d[o + 2] = 40 + (1 - k) * 50; }
        } else {
          const v = y / GH;
          if (mode === 'lava') { d[o] = 24 + v * 26; d[o + 1] = 10 + v * 8; d[o + 2] = 34 + v * 18; }
          else if (mode === 'ocean') { d[o] = 6 + v * 10; d[o + 1] = 18 + v * 26; d[o + 2] = 34 + v * 40; }
          else { d[o] = 12 + v * 16; d[o + 1] = 22 + v * 30; d[o + 2] = 10 + v * 6; }
        }
        d[o + 3] = 255;
      }
      octx.putImageData(img, 0, 0);
      C.ctx.imageSmoothingEnabled = true;
      C.ctx.drawImage(off, 0, 0, GW, GH, 0, 0, C.W, C.H);
      // 玻璃罩高光
      const g = C.ctx.createLinearGradient(0, 0, C.W, C.H);
      g.addColorStop(0, 'rgba(255,255,255,.10)'); g.addColorStop(0.35, 'rgba(255,255,255,0)');
      C.ctx.fillStyle = g; C.ctx.fillRect(0, 0, C.W, C.H);
    }
    const loop = Loop(dt => { if (!paused) step(Math.min(dt, 0.05)); render(); });
    bindRange('#llN', () => seed()); bindRange('#llSpeed', () => { }); bindRange('#llTh', () => { });
    $('#llMode').addEventListener('change', render);
    $('#llPng').addEventListener('click', () => {
      const tmp = document.createElement('canvas'); tmp.width = GW; tmp.height = GH;
      tmp.getContext('2d').putImageData(img, 0, 0);
      const big = document.createElement('canvas'); big.width = GW * 3; big.height = GH * 3;
      const bx = big.getContext('2d'); bx.drawImage(tmp, 0, 0, GW * 3, GH * 3);
      pngOf(big, slug + '.png');
    });
    bindCtrl({ start: () => { paused = false; loop.start(); }, pause: () => paused = true, reset: seed });
    ctlEl('#gStart').textContent = '播放';
    ctlEl('#gReset').textContent = '重新注入';
    seed(); loop.start();
  }
  G['lava-lamp'] = lavaLampUI;
  G['lava-lamp-simulator'] = lavaLampUI;

  /* ---------------- 壁炉 / 篝火 ---------------- */
  function fireplaceUI(host, slug) {
    const W = 620, H = 400;
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          <div id="fpWrap"></div>
          <div class="runnote">火焰是粒子系统：上升、收缩、颜色随温度衰减；柴火会随着燃烧慢慢变暗。</div>
        </div>
      </div>
      ${paneBox('壁炉 / 篝火', '火焰粒子 + 木柴 + 火光闪烁，环境音由 Web Audio 合成（低通白噪 + 随机噼啪），不加载任何音频文件。',
      `<div class="plabel">火势</div>${TUI.range('fpPower', 10, 100, 55, 1)}
        <div class="plabel">环境音音量</div>${TUI.range('fpVol', 0, 100, 25, 1)}
        <div class="plabel">木柴数量</div>${TUI.range('fpLogs', 2, 8, 4, 1)}
        ${ctrlRow()}
        <div class="outbox" id="fpOut">声音：关（点击「点火」后自动开启）</div>`)}
    </div>`;
    const C = mkCanvas($('#fpWrap'), W, H);
    let parts = [], logs = [], paused = false, t0 = 0, crackleTimer = 0, amb = null, burning = true;
    function seedLogs() {
      const n = +$('#fpLogs').value;
      logs = [];
      for (let i = 0; i < n; i++) logs.push({ x: W / 2 + rf(-70, 70), y: H - 46 + rf(-8, 8), a: rf(-0.5, 0.5), len: rf(70, 130), w: rf(14, 22), burn: 1 });
    }
    function ambStart() {
      const c = ac(); if (!c || amb) return;
      const n = Math.floor(c.sampleRate * 2);
      const buf = c.createBuffer(1, n, c.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; last = last * 0.96 + w * 0.04; d[i] = last * 3.2; }
      const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
      const g = c.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(c.destination); src.start();
      amb = { src: src, f: f, g: g };
      onClean(() => { try { src.stop(); } catch (e) { } });
    }
    function step(dt) {
      const power = +$('#fpPower').value / 100;
      if (burning) {
        const n = Math.round(power * 5);
        for (let i = 0; i < n; i++) {
          parts.push({
            x: W / 2 + rf(-46, 46), y: H - 60 - rf(0, 20),
            vx: rf(-16, 16), vy: -rf(50, 150) * (0.6 + power),
            r: rf(3, 12) * (0.6 + power * 0.7), life: 1
          });
        }
      }
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vy -= 30 * dt; p.vx += rf(-12, 12) * dt;
        p.r *= (1 - 0.8 * dt); p.life -= dt * 1.15;
        if (p.life <= 0 || p.r < 0.6) parts.splice(i, 1);
      }
      if (parts.length > 1400) parts.splice(0, parts.length - 1400);
      logs.forEach(l => { if (burning) l.burn = Math.max(0.25, l.burn - dt * 0.004); });
      if (amb) {
        const flick = 0.6 + 0.4 * Math.abs(Math.sin(performance.now() / 140)) * Math.abs(Math.sin(performance.now() / 41));
        amb.g.gain.value = (burning ? (+$('#fpVol').value) / 100 * 0.28 : 0) * flick;
        amb.f.frequency.value = 320 + flick * 260;
      }
      crackleTimer -= dt;
      if (burning && crackleTimer <= 0) {
        crackleTimer = rf(0.08, 0.5);
        if (+$('#fpVol').value > 0) noiseSound(0.03, 0.12 * (+$('#fpVol').value) / 100, rf(900, 3200), 3);
      }
      t0 += dt;
    }
    function draw() {
      C.ctx.fillStyle = '#07070a'; C.ctx.fillRect(0, 0, W, H);
      const flick = 0.75 + 0.25 * Math.abs(Math.sin(performance.now() / 130));
      const g = C.ctx.createRadialGradient(W / 2, H - 70, 10, W / 2, H - 70, 300 * flick);
      g.addColorStop(0, 'rgba(255,170,60,' + (0.22 * flick * (burning ? 1 : 0.2)) + ')');
      g.addColorStop(1, 'rgba(255,120,20,0)');
      C.ctx.fillStyle = g; C.ctx.fillRect(0, 0, W, H);
      // 砖炉膛
      C.ctx.fillStyle = '#241a14'; C.ctx.fillRect(0, H - 34, W, 34);
      logs.forEach(l => {
        C.ctx.save(); C.ctx.translate(l.x, l.y); C.ctx.rotate(l.a);
        const lg = C.ctx.createLinearGradient(0, -l.w / 2, 0, l.w / 2);
        lg.addColorStop(0, 'rgb(' + Math.round(90 * l.burn) + ',' + Math.round(60 * l.burn) + ',' + Math.round(38 * l.burn) + ')');
        lg.addColorStop(1, 'rgb(' + Math.round(52 * l.burn) + ',' + Math.round(33 * l.burn) + ',' + Math.round(20 * l.burn) + ')');
        C.ctx.fillStyle = lg;
        C.ctx.fillRect(-l.len / 2, -l.w / 2, l.len, l.w);
        C.ctx.strokeStyle = 'rgba(0,0,0,.4)'; C.ctx.strokeRect(-l.len / 2, -l.w / 2, l.len, l.w);
        C.ctx.restore();
      });
      parts.forEach(p => {
        const t = clamp(p.life, 0, 1);
        const r = Math.round(255);
        const gg = Math.round(60 + 180 * t);
        const bb = Math.round(20 * t * t);
        C.ctx.fillStyle = 'rgba(' + r + ',' + gg + ',' + bb + ',' + (0.14 + 0.5 * t) + ')';
        C.ctx.beginPath(); C.ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); C.ctx.fill();
      });
      C.ctx.fillStyle = '#8a8a8a'; C.ctx.font = '12px Inter,sans-serif'; C.ctx.textAlign = 'left';
      C.ctx.fillText('粒子 ' + parts.length + ' · 火光 ' + flick.toFixed(2), 12, 20);
    }
    const loop = Loop(dt => { if (!paused) step(Math.min(dt, 0.033)); draw(); });
    ctlEl('#gStart').addEventListener('click', () => { unlockAudio(); ambStart(); burning = true; $('#fpOut').textContent = '声音：开（可调音量滑块）'; tone(320, 0.2, 'sawtooth', 0.08); });
    ctlEl('#gPause').addEventListener('click', () => { burning = !burning; $('#fpOut').textContent = burning ? '燃烧中' : '已熄灭（再点「点火」重新点燃）'; });
    ctlEl('#gReset').addEventListener('click', () => { parts = []; seedLogs(); });
    ctlEl('#gStart').textContent = '点火';
    ctlEl('#gPause').textContent = '熄灭 / 复燃';
    ctlEl('#gReset').textContent = '换柴';
    bindRange('#fpLogs', () => seedLogs());
    bindRange('#fpPower', () => { }); bindRange('#fpVol', () => { });
    seedLogs(); loop.start();
  }
  G['fireplace-screensaver'] = fireplaceUI;
  G['virtual-fireplace'] = fireplaceUI;
  G['campfire-simulator'] = fireplaceUI;

  /* ---------------- 雨窗 ---------------- */
  G['rain-window'] = function (host, slug) {
    const W = 640, H = 420;
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap"><div id="rwWrap"></div>
        <div class="runnote">水珠滑落会带出细痕并彼此汇流；每颗水珠通过放大+翻转背景来模拟折射。</div></div>
      </div>
      ${paneBox('雨窗', '雨滴滑落 + 汇流 + 折射背景。背景是程序生成的夜景，不加载图片。',
      `<div class="plabel">雨量</div>${TUI.range('rwRate', 1, 120, 45, 1)}
        <div class="plabel">雨滴重力</div>${TUI.range('rwG', 20, 400, 120, 5)}
        <div class="plabel">水珠大小</div>${TUI.range('rwSize', 4, 26, 12, 1)}
        ${ctrlRow()}
        <div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="rwBg">换背景</button><button class="btn-ghost btn-sm" id="rwPng">导出 PNG</button></div>`)}
    </div>`;
    const C = mkCanvas($('#rwWrap'), W, H);
    const bg = document.createElement('canvas'); bg.width = W; bg.height = H;
    let drops = [], acc = 0, paused = false, bgMode = 0;
    function makeBg() {
      const b = bg.getContext('2d');
      const sky = b.createLinearGradient(0, 0, 0, H);
      const night = bgMode % 2 === 0;
      sky.addColorStop(0, night ? '#070b1c' : '#0d1a2a');
      sky.addColorStop(0.55, night ? '#122046' : '#26456a');
      sky.addColorStop(1, night ? '#2a1f3d' : '#5a6f8a');
      b.fillStyle = sky; b.fillRect(0, 0, W, H);
      b.fillStyle = night ? 'rgba(255,220,150,.9)' : 'rgba(255,255,255,.85)';
      b.beginPath(); b.arc(W - 110, 80, 34, 0, Math.PI * 2); b.fill();
      for (let i = 0; i < 26; i++) {
        const bw = rf(24, 64), bh = rf(70, 240), bx = rf(-20, W), by = H - bh;
        b.fillStyle = night ? 'rgba(12,16,30,.92)' : 'rgba(20,30,46,.85)';
        b.fillRect(bx, by, bw, bh);
        for (let wy = by + 14; wy < H - 10; wy += 20) for (let wx = bx + 6; wx < bx + bw - 6; wx += 14) {
          if (Math.random() < 0.55) { b.fillStyle = night ? 'rgba(255,214,120,' + rf(0.25, 0.95) + ')' : 'rgba(180,220,255,.5)'; b.fillRect(wx, wy, 6, 8); }
        }
      }
      const glow = b.createLinearGradient(0, H - 90, 0, H);
      glow.addColorStop(0, 'rgba(255,180,90,0)'); glow.addColorStop(1, 'rgba(255,170,80,.35)');
      b.fillStyle = glow; b.fillRect(0, H - 90, W, 90);
    }
    function step(dt) {
      acc += dt * (+$('#rwRate').value);
      const sizeMul = (+$('#rwSize').value) / 12;
      let n = 0;
      while (acc >= 1 && n < 12) {
        acc -= 1; n++;
        drops.push({ x: rf(10, W - 10), y: rf(-20, H * 0.5), r: rf(2, 4) * sizeMul, vy: rf(0, 20), vx: rf(-3, 3), trail: [] });
      }
      const g = +$('#rwG').value;
      drops.forEach(d => {
        d.vy += g * dt;
        d.trail.push([d.x, d.y, d.r]);
        if (d.trail.length > 26) d.trail.shift();
        // 汇流：碰到更大的水珠就被吸收
        for (let i = 0; i < drops.length; i++) {
          const o = drops[i];
          if (o === d) continue;
          const dd = Math.hypot(o.x - d.x, o.y - d.y);
          if (dd < o.r && o.r > d.r && o.y < d.y) {
            o.r = Math.min(16 * sizeMul, o.r + d.r * 0.28);
            o.vy += 18 * (d.r / (o.r || 1));
            d.dead = true;
            break;
          }
        }
        if (d.y > H + 20) d.dead = true;
      });
      drops = drops.filter(d => !d.dead && !(d.frozen));
      if (drops.length > 320) drops.splice(0, drops.length - 320);
    }
    function draw() {
      C.ctx.drawImage(bg, 0, 0, W, H);
      drops.forEach(d => {
        C.ctx.strokeStyle = 'rgba(200,230,255,.18)'; C.ctx.lineWidth = d.r * 0.5;
        C.ctx.beginPath();
        d.trail.forEach((t, i) => { i ? C.ctx.lineTo(t[0], t[1]) : C.ctx.moveTo(t[0], t[1]); });
        C.ctx.lineTo(d.x, d.y); C.ctx.stroke();
        // 折射：取反方向的一小块背景放大画进圆里
        const r = d.r;
        const sx = clamp(d.x, 0, W - 1), sy = clamp(d.y, 0, H - 1);
        C.ctx.save();
        C.ctx.beginPath(); C.ctx.arc(d.x, d.y, r, 0, Math.PI * 2); C.ctx.clip();
        C.ctx.translate(d.x, d.y); C.ctx.scale(-1, 1);
        C.ctx.drawImage(bg, sx - r * 0.9, sy - r * 0.9, r * 1.8, r * 1.8, -r * 1.25, -r * 1.25, r * 2.5, r * 2.5);
        C.ctx.restore();
        C.ctx.strokeStyle = 'rgba(255,255,255,.5)'; C.ctx.lineWidth = 1;
        C.ctx.beginPath(); C.ctx.arc(d.x, d.y, r, 0, Math.PI * 2); C.ctx.stroke();
        C.ctx.fillStyle = 'rgba(255,255,255,.75)';
        C.ctx.beginPath(); C.ctx.arc(d.x - r * 0.35, d.y - r * 0.35, Math.max(0.6, r * 0.22), 0, Math.PI * 2); C.ctx.fill();
      });
    }
    const loop = Loop(dt => { if (!paused) step(Math.min(dt, 0.033)); draw(); });
    $('#rwBg').addEventListener('click', () => { bgMode++; makeBg(); });
    bindRange('#rwRate', () => { }); bindRange('#rwG', () => { }); bindRange('#rwSize', () => { });
    $('#rwPng').addEventListener('click', () => pngOf(C.cv, slug + '.png'));
    bindCtrl({ start: () => { paused = false; loop.start(); }, pause: () => paused = true, reset: () => { drops = []; } });
    ctlEl('#gStart').textContent = '播放';
    ctlEl('#gReset').textContent = '擦干玻璃';
    makeBg(); loop.start();
  };
  G['rain-on-window'] = G['rain-window'];

  /* ---------------- 雪花球 ---------------- */
  function snowGlobeUI(host, slug) {
    const W = 440, H = 440;
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap"><div id="sgWrap"></div>
        <div class="runnote">拖动雪花球用力摇晃，雪花会飞起来再慢慢落下。</div></div>
      </div>
      ${paneBox('雪花球', '玻璃球用渐层高光绘制，雪花是带阻尼的粒子；摇晃会给所有粒子一个随机冲量。',
      `<div class="plabel">雪花数量</div>${TUI.range('sgN', 30, 400, 160, 10)}
        <div class="plabel">重力</div>${TUI.range('sgG', 10, 200, 45, 5)}
        <div class="plabel">球体风格</div>${TUI.sel('sgStyle', [{ v: 'classic', t: '经典小屋' }, { v: 'night', t: '星空夜景' }, { v: 'pink', t: '粉雪' }], 'classic')}
        ${ctrlRow()}
        <div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="sgShake">使劲摇一摇</button><button class="btn-ghost btn-sm" id="sgPng">导出 PNG</button></div>`)}
    </div>`;
    const C = mkCanvas($('#sgWrap'), W, H);
    const CX = W / 2, CY = H / 2 + 6, R = W * 0.38;
    let flakes = [], paused = false, lastX = null, lastY = null, shakeImpulse = 0;
    function seed() {
      flakes = [];
      const n = +$('#sgN').value;
      for (let i = 0; i < n; i++) {
        const a = rf(0, Math.PI * 2), rr = Math.sqrt(Math.random()) * R * 0.95;
        flakes.push({ x: CX + Math.cos(a) * rr, y: CY + Math.sin(a) * rr, vx: 0, vy: 0, r: rf(1, 3), s: rf(0.7, 1.3) });
      }
    }
    function shake(power) {
      flakes.forEach(f => { f.vx += rf(-1, 1) * power; f.vy += rf(-1.4, 0.3) * power; });
      shakeImpulse = power;
      tone(400, 0.06, 'sine', 0.1);
      noiseSound(0.16, 0.08, 1600, 0.8);
    }
    function step(dt) {
      const g = +$('#sgG').value;
      shakeImpulse *= 0.94;
      flakes.forEach(f => {
        f.vy += g * dt * 0.5;
        f.vx += Math.sin(performance.now() / 700 + f.s * 9) * 6 * dt;
        f.vx *= 0.992; f.vy *= 0.992;
        f.x += f.vx * dt * 30; f.y += f.vy * dt * 30;
        const dx = f.x - CX, dy = f.y - CY;
        const d = Math.hypot(dx, dy);
        const limit = R - f.r - 6;
        if (d > limit) {
          const nx = dx / d, ny = dy / d;
          f.x = CX + nx * limit; f.y = CY + ny * limit;
          const vn = f.vx * nx + f.vy * ny;
          f.vx -= 2 * vn * nx * 0.55; f.vy -= 2 * vn * ny * 0.55;
        }
      });
    }
    function draw() {
      const style = $('#sgStyle').value;
      const bgc = style === 'night' ? ['#050a1a', '#0d1730'] : style === 'pink' ? ['#2a1420', '#4a2038'] : ['#101820', '#1b2b38'];
      C.ctx.fillStyle = '#0b0b0b'; C.ctx.fillRect(0, 0, W, H);
      C.ctx.save();
      C.ctx.beginPath(); C.ctx.arc(CX, CY, R, 0, Math.PI * 2); C.ctx.clip();
      const sky = C.ctx.createLinearGradient(CX, CY - R, CX, CY + R);
      sky.addColorStop(0, bgc[0]); sky.addColorStop(1, bgc[1]);
      C.ctx.fillStyle = sky; C.ctx.fillRect(CX - R, CY - R, R * 2, R * 2);
      // 底座雪堆
      C.ctx.fillStyle = 'rgba(240,248,255,.92)';
      C.ctx.beginPath(); C.ctx.ellipse(CX, CY + R * 0.72, R * 0.9, R * 0.3, 0, 0, Math.PI * 2); C.ctx.fill();
      // 小房子 / 树
      if (style === 'classic' || style === 'pink') {
        C.ctx.fillStyle = '#6b4b32'; C.ctx.fillRect(CX - 34, CY + R * 0.24, 68, 46);
        C.ctx.fillStyle = style === 'pink' ? '#c04a86' : '#8a3b2a';
        C.ctx.beginPath(); C.ctx.moveTo(CX - 46, CY + R * 0.24); C.ctx.lineTo(CX, CY + R * 0.24 - 40); C.ctx.lineTo(CX + 46, CY + R * 0.24); C.ctx.closePath(); C.ctx.fill();
        C.ctx.fillStyle = '#ffd166'; C.ctx.fillRect(CX - 12, CY + R * 0.42, 22, 18);
      } else {
        for (let i = 0; i < 40; i++) {
          C.ctx.fillStyle = 'rgba(255,255,255,' + rf(0.2, 0.9) + ')';
          C.ctx.fillRect(CX - R + (i * 53.7) % (R * 2), CY - R + (i * 31.3) % (R * 1.2), 1.6, 1.6);
        }
      }
      C.ctx.fillStyle = style === 'pink' ? '#ffd0e4' : 'rgba(255,255,255,.95)';
      flakes.forEach(f => { C.ctx.beginPath(); C.ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); C.ctx.fill(); });
      C.ctx.restore();
      // 玻璃
      const gl = C.ctx.createRadialGradient(CX - R * 0.4, CY - R * 0.45, R * 0.1, CX, CY, R);
      gl.addColorStop(0, 'rgba(255,255,255,.22)'); gl.addColorStop(0.55, 'rgba(255,255,255,.03)'); gl.addColorStop(1, 'rgba(255,255,255,.16)');
      C.ctx.beginPath(); C.ctx.arc(CX, CY, R, 0, Math.PI * 2); C.ctx.fillStyle = gl; C.ctx.fill();
      C.ctx.strokeStyle = 'rgba(255,255,255,.35)'; C.ctx.lineWidth = 3;
      C.ctx.beginPath(); C.ctx.arc(CX, CY, R, 0, Math.PI * 2); C.ctx.stroke();
      C.ctx.beginPath(); C.ctx.ellipse(CX - R * 0.35, CY - R * 0.45, R * 0.22, R * 0.12, -0.6, 0, Math.PI * 2);
      C.ctx.fillStyle = 'rgba(255,255,255,.35)'; C.ctx.fill();
      // 底座
      const ped = C.ctx.createLinearGradient(CX - 90, 0, CX + 90, 0);
      ped.addColorStop(0, '#3a2a1c'); ped.addColorStop(0.5, '#6b4f33'); ped.addColorStop(1, '#3a2a1c');
      C.ctx.fillStyle = ped;
      C.ctx.beginPath();
      C.ctx.moveTo(CX - 86, CY + R - 6); C.ctx.lineTo(CX + 86, CY + R - 6);
      C.ctx.lineTo(CX + 62, H - 12); C.ctx.lineTo(CX - 62, H - 12); C.ctx.closePath(); C.ctx.fill();
    }
    const loop = Loop(dt => { if (!paused) step(Math.min(dt, 0.033)); draw(); });
    function down(e) { lastX = (e.touches ? e.touches[0].clientX : e.clientX); lastY = (e.touches ? e.touches[0].clientY : e.clientY); unlockAudio(); }
    function move(e) {
      if (lastX == null) return;
      const x = (e.touches ? e.touches[0].clientX : e.clientX), y = (e.touches ? e.touches[0].clientY : e.clientY);
      const d = Math.hypot(x - lastX, y - lastY);
      if (d > 12) shake(clamp(d / 10, 0.6, 6));
      lastX = x; lastY = y;
    }
    C.cv.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', () => { lastX = null; });
    C.cv.addEventListener('touchstart', e => down(e), { passive: true });
    window.addEventListener('touchmove', e => { move(e); }, { passive: true });
    window.addEventListener('touchend', () => { lastX = null; });
    $('#sgShake').addEventListener('click', () => { unlockAudio(); shake(7); });
    bindRange('#sgN', () => seed()); bindRange('#sgG', () => { });
    $('#sgStyle').addEventListener('change', draw);
    $('#sgPng').addEventListener('click', () => pngOf(C.cv, slug + '.png'));
    bindCtrl({ start: () => { paused = false; loop.start(); }, pause: () => paused = true, reset: seed });
    ctlEl('#gStart').textContent = '播放';
    ctlEl('#gReset').textContent = '重新装雪';
    seed(); loop.start();
  }
  G['snow-globe'] = snowGlobeUI;
  G['snow-globe-online'] = snowGlobeUI;

  /* ---------------- 屏幕尺寸模拟器 ---------------- */
  function screenSizeUI(host, slug) {
    const DEVICES = {
      'iPhone 15': [393, 852, 55], 'iPhone SE': [375, 667, 40], 'iPhone 15 Pro Max': [430, 932, 60],
      'Pixel 8': [412, 915, 55], 'Galaxy S23': [360, 780, 50], 'iPad Mini': [744, 1133, 40],
      'iPad Pro 12.9': [1024, 1366, 40], 'Surface Pro': [1368, 912, 30], 'MacBook Air 13': [1280, 832, 34],
      'Desktop 1440p': [1440, 900, 24], 'Desktop 1080p': [1920, 1080, 22], 'Watch 45mm': [198, 242, 70]
    };
    const SAMPLE = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' +
      'body{margin:0;font-family:Inter,system-ui,sans-serif;background:#0b0b0b;color:#e5e5e5}' +
      'header{padding:16px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #222}' +
      'h1{font-size:18px;margin:0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;padding:16px}' +
      '.card{background:#141414;border:1px solid #242424;border-radius:12px;padding:14px}.card b{color:#d7f452}' +
      '.hero{padding:28px 16px}.hero h2{font-size:26px;margin:0 0 8px}.hero p{color:#8a8a8a;margin:0}' +
      'nav a{color:#8a8a8a;margin-left:12px;font-size:13px;text-decoration:none}' +
      '@media(max-width:520px){nav{display:none}}</style></head><body>' +
      '<header><h1>Responsive Demo</h1><nav><a>Docs</a><a>Pricing</a><a>About</a></nav></header>' +
      '<div class="hero"><h2>用真实 CSS 媒体查询测试断点</h2><p>把下面 iframe 的宽度改小，会看到网格和导航自动重排——这不是截图，是同一份 HTML 在不同视口下渲染。</p></div>' +
      '<div class="grid">' + [1, 2, 3, 4, 5, 6].map(i => '<div class="card"><b>卡片 ' + i + '</b><p style="color:#8a8a8a;font-size:13px">随宽度自动换行，minmax(180px,1fr) 生效。</p></div>').join('') + '</div></body></html>';
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div style="display:flex;justify-content:center;padding:14px;background:#141414;border-radius:12px;overflow:auto">
          <div id="scFrame" style="position:relative;transition:width .2s,height .2s">
            <div id="scChrome" style="position:absolute;left:50%;transform:translateX(-50%);top:-6px;height:24px;background:#1c1c1c;border-radius:10px 10px 0 0;border:1px solid #2a2a2a;border-bottom:none"></div>
            <iframe id="scIframe" title="viewport preview" style="border:1px solid #2a2a2a;border-radius:14px;background:#0b0b0b;display:block" sandbox="allow-same-origin"></iframe>
          </div>
        </div>
      </div>
      ${paneBox('屏幕尺寸模拟器', '用真实 iframe 视口渲染同一份响应式页面（srcdoc 注入，同源可控，不请求外部地址）。',
      `<div class="plabel">设备预设</div>${TUI.sel('scDev', Object.keys(DEVICES).map(k => ({ v: k, t: k + ' · ' + DEVICES[k][0] + '×' + DEVICES[k][1] })), 'iPhone 15')}
        <div class="fieldrow" style="margin-top:10px"><div class="fld" style="flex:1"><div class="plabel" style="margin-top:0">宽度</div><input type="number" id="scW" value="393"></div><div class="fld" style="flex:1"><div class="plabel" style="margin-top:0">高度</div><input type="number" id="scH" value="852"></div></div>
        <div class="plabel">缩放</div>${TUI.range('scZoom', 20, 100, 70, 5)}
        <div class="plabel">预览内容</div>${TUI.sel('scTarget', [{ v: 'demo', t: '内置响应式示例页' }, { v: 'current', t: '当前站点首页（同源 iframe）' }], 'demo')}
        ${ctrlRow()}
        <div class="outbox" id="scOut">—</div>
        <div class="runnote">注意：如果换成外部网址，站点可能通过 X-Frame-Options 拒绝被嵌套；本工具默认使用同源内容。</div>`)}
    </div>`;
    const frame = $('#scFrame'), iframe = $('#scIframe'), chrome = $('#scChrome');
    let dev = 'iPhone 15';
    function apply() {
      const w = clamp(+$('#scW').value || 393, 160, 2560);
      const h = clamp(+$('#scH').value || 852, 160, 1600);
      const z = (+$('#scZoom').value) / 100;
      const notch = DEVICES[dev] ? DEVICES[dev][2] : 40;
      frame.style.width = (w * z) + 'px';
      frame.style.height = (h * z) + 'px';
      iframe.style.width = w + 'px';
      iframe.style.height = h + 'px';
      iframe.style.transform = 'scale(' + z + ')';
      iframe.style.transformOrigin = '0 0';
      chrome.style.width = Math.min(w, 220) * z + 'px';
      chrome.style.height = Math.max(0, notch * z) + 'px';
      $('#scOut').innerHTML = '视口 <b>' + w + ' × ' + h + '</b> · 缩放 ' + Math.round(z * 100) + '%' +
        (w <= 520 ? ' · 命中手机断点（导航隐藏）' : w <= 900 ? ' · 平板断点' : ' · 桌面断点');
    }
    function load() {
      const target = $('#scTarget').value;
      if (target === 'current') { iframe.removeAttribute('srcdoc'); iframe.src = '../index.html'; }
      else { iframe.removeAttribute('src'); iframe.srcdoc = SAMPLE; }
    }
    $('#scDev').addEventListener('change', () => {
      dev = $('#scDev').value;
      const d = DEVICES[dev];
      $('#scW').value = d[0]; $('#scH').value = d[1];
      apply();
    });
    $('#scW').addEventListener('input', apply);
    $('#scH').addEventListener('input', apply);
    $('#scTarget').addEventListener('change', load);
    bindRange('#scZoom', () => apply());
    bindCtrl({ start: () => apply(), pause: () => { }, reset: () => { dev = 'iPhone 15'; $('#scDev').value = dev; $('#scW').value = 393; $('#scH').value = 852; apply(); } });
    ctlEl('#gStart').textContent = '刷新预览';
    ctlEl('#gStart').addEventListener('click', load);
    ctlEl('#gPause').style.display = 'none';
    ctlEl('#gReset').textContent = '恢复默认设备';
    load(); apply();
  }
  G['screen-size-simulator'] = screenSizeUI;
  G['mobile-view-tester'] = screenSizeUI;
  G['responsive-tester'] = screenSizeUI;

  /* ==========================================================================
     C. 计时 / 测量
     ========================================================================== */

  /* ---------------- 秒表 ---------------- */
  G['stopwatch'] = function (host) {
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="ioout" id="swDisplay" style="font-size:56px;font-weight:800;text-align:center;letter-spacing:-2px;padding:34px 12px;font-family:var(--mono)">00:00.00</div>
        <div class="scorebar" style="justify-content:center;margin-top:8px"><span>分:秒.厘秒</span><span>圈数 <b id="swLaps">0</b></span></div>
        <div class="ioout" id="swList" style="max-height:300px;overflow:auto;margin-top:14px;min-height:120px">还没有分段记录</div>
      </div>
      ${paneBox('秒表', '分段计时 + 圈速表，可以导出 CSV。空格开始/暂停，L 记一圈。',
      `<div class="shapes" style="margin-top:12px;gap:8px">
          <button class="btn-lime btn-sm" id="gStart">开始</button>
          <button class="btn-ghost btn-sm" id="swLap">记一圈</button>
          <button class="btn-ghost btn-sm" id="gReset">归零</button>
        </div>
        <div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="swCsv">导出 CSV</button><button class="btn-ghost btn-sm" id="swCopy">复制全部</button></div>
        <div class="outbox" id="swStats">最快 / 最慢圈会显示在这里</div>
        <div class="runnote">时间用 performance.now() 累加，不依赖帧率。</div>`)}
    </div>`;
    let running = false, elapsed = 0, t0 = 0, laps = [], lastLap = 0;
    function fmt(ms) {
      const cs = Math.floor(ms % 1000 / 10), s = Math.floor(ms / 1000) % 60, m = Math.floor(ms / 60000);
      return pad2(m) + ':' + pad2(s) + '.' + pad2(cs);
    }
    function paint() {
      $('#swDisplay').textContent = fmt(elapsed + (running ? performance.now() - t0 : 0));
    }
    function startPause() {
      if (running) { elapsed += performance.now() - t0; running = false; ctlEl('#gStart').textContent = '继续'; }
      else { t0 = performance.now(); running = true; ctlEl('#gStart').textContent = '暂停'; }
      tone(running ? 880 : 440, 0.05, 'square', 0.1);
    }
    function lap() {
      const now = elapsed + (running ? performance.now() - t0 : 0);
      laps.push(now);
      renderLaps();
      tone(660, 0.04, 'triangle', 0.1);
    }
    function renderLaps() {
      $('#swLaps').textContent = laps.length;
      if (!laps.length) { $('#swList').textContent = '还没有分段记录'; $('#swStats').textContent = '最快 / 最慢圈会显示在这里'; return; }
      const split = laps.map((v, i) => v - (i ? laps[i - 1] : 0));
      let fast = 0, slow = 0;
      split.forEach((s, i) => { if (s < split[fast]) fast = i; if (s > split[slow]) slow = i; });
      $('#swList').innerHTML = laps.map((v, i) => `<div class="row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #1e1e1e"><span>第 ${i + 1} 圈 · 分段 ${fmt(split[i])}</span><b style="color:${i === fast ? '#7ee0c5' : i === slow ? '#ff8fb1' : '#d7f452'}">${fmt(v)}</b></div>`).join('') + `<div class="row" style="display:flex;justify-content:space-between;padding:8px 0;font-weight:700"><span>总计</span><b>${fmt(laps[laps.length - 1])}</b></div>`;
      $('#swStats').innerHTML = '最快第 <b>' + (fast + 1) + '</b> 圈（' + fmt(split[fast]) + '） · 最慢第 <b>' + (slow + 1) + '</b> 圈（' + fmt(split[slow]) + '）';
    }
    const timer = setInterval(paint, 33);
    onClean(() => clearInterval(timer));
    ctlEl('#gStart').addEventListener('click', startPause);
    $('#swLap').addEventListener('click', lap);
    ctlEl('#gReset').addEventListener('click', () => { running = false; elapsed = 0; laps = []; ctlEl('#gStart').textContent = '开始'; renderLaps(); paint(); });
    keys({ ' ': startPause, l: lap, L: lap });
    $('#swCsv').addEventListener('click', () => {
      if (!laps.length) { window.toast('还没有分段'); return; }
      const rows = [['lap', 'split_seconds', 'total_seconds']];
      laps.forEach((v, i) => rows.push([i + 1, ((v - (i ? laps[i - 1] : 0)) / 1000).toFixed(2), (v / 1000).toFixed(2)]));
      downloadText('stopwatch-laps.csv', toCSV(rows), 'text/csv;charset=utf-8');
    });
    $('#swCopy').addEventListener('click', () => {
      const txt = laps.map((v, i) => 'Lap ' + (i + 1) + ': ' + fmt(v)).join('\n') || 'no laps';
      window.copyText(txt);
    });
    renderLaps(); paint();
  };

  /* ---------------- 倒计时 ---------------- */
  function countdownUI(host, slug) {
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          <div id="cdRing" style="width:min(100%,420px)"></div>
          <div class="runnote">页面标题也会显示剩余时间；到点会响铃（Web Audio 合成）。</div>
        </div>
      </div>
      ${paneBox('倒计时', '时/分/秒输入 + 预设，可发送桌面通知（需要授权）。',
      `<div class="fieldrow" style="gap:8px"><div class="fld" style="flex:1"><div class="plabel" style="margin-top:0">时</div><input type="number" id="cdH" value="0"></div>
          <div class="fld" style="flex:1"><div class="plabel" style="margin-top:0">分</div><input type="number" id="cdM" value="5"></div>
          <div class="fld" style="flex:1"><div class="plabel" style="margin-top:0">秒</div><input type="number" id="cdS" value="0"></div></div>
        <div class="shapes" id="cdPresets" style="margin-top:12px">${[1, 3, 5, 10, 25, 60].map(m => TUI.pill(m, m + ' 分')).join('')}</div>
        <div class="shapes" style="margin-top:12px;gap:8px">
          <button class="btn-lime btn-sm" id="gStart">开始</button>
          <button class="btn-ghost btn-sm" id="gPause">暂停</button>
          <button class="btn-ghost btn-sm" id="gReset">重置</button>
        </div>
        <div class="plabel">到点提醒</div>${TUI.chk('cdNotify', '发送桌面通知（需授权）', false)}
        <div class="plabel">铃声</div>${TUI.sel('cdSound', [{ v: 'beep', t: '电子哔哔' }, { v: 'chime', t: '和弦提示音' }, { v: 'none', t: '静音' }], 'chime')}
        <div class="outbox" id="cdOut">就绪</div>`)}
    </div>`;
    const R = 150, SIZE = 360;
    const holder = $('#cdRing');
    holder.innerHTML = `<svg viewBox="0 0 ${SIZE} ${SIZE}" style="width:100%;height:auto;display:block">
      <circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${R}" fill="none" stroke="#1e1e1e" stroke-width="18"/>
      <circle id="cdArc" cx="${SIZE / 2}" cy="${SIZE / 2}" r="${R}" fill="none" stroke="#d7f452" stroke-width="18"
        stroke-linecap="round" transform="rotate(-90 ${SIZE / 2} ${SIZE / 2})" stroke-dasharray="${2 * Math.PI * R}" stroke-dashoffset="0"/>
      <text id="cdText" x="${SIZE / 2}" y="${SIZE / 2 + 12}" text-anchor="middle" fill="#fff" font-size="44" font-family="var(--mono,monospace)" font-weight="800">00:00</text>
      <text id="cdSub" x="${SIZE / 2}" y="${SIZE / 2 + 48}" text-anchor="middle" fill="#8a8a8a" font-size="14">设定时间</text>
    </svg>`;
    let total = 300, remain = 300, running = false, last = 0, ringing = false;
    function readInputs() { return clamp(+$('#cdH').value || 0, 0, 99) * 3600 + clamp(+$('#cdM').value || 0, 0, 59) * 60 + clamp(+$('#cdS').value || 0, 0, 59); }
    function paint() {
      const m = Math.floor(remain / 60), s = Math.floor(remain % 60);
      $('#cdText').textContent = (m >= 60 ? Math.floor(m / 60) + ':' + pad2(m % 60) : pad2(m)) + ':' + pad2(s);
      const frac = total > 0 ? remain / total : 0;
      $('#cdArc').setAttribute('stroke-dashoffset', String(2 * Math.PI * R * (1 - frac)));
      document.title = running ? '⏳ ' + $('#cdText').textContent + ' — 倒计时' : '倒计时';
    }
    function set(sec) { total = sec; remain = sec; ringing = false; paint(); $('#cdSub').textContent = '设定时间'; }
    function start() {
      if (remain <= 0) set(readInputs());
      if (remain <= 0) { window.toast('先设定一个大于 0 的时间'); return; }
      unlockAudio(); running = true; last = performance.now();
      $('#cdSub').textContent = '倒计时中';
    }
    function pauseF() { running = false; $('#cdSub').textContent = '已暂停'; }
    function alarm() {
      const kind = $('#cdSound').value;
      if (kind === 'beep') { for (let i = 0; i < 6; i++) tone(880, 0.12, 'square', 0.22, i * 0.22); }
      else if (kind === 'chime') { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.42, 'triangle', 0.2, i * 0.16)); }
      if ($('#cdNotify').classList.contains('on') && 'Notification' in window) {
        try {
          if (Notification.permission === 'granted') new Notification('倒计时结束', { body: '设定的时间到了。' });
          else if (Notification.permission !== 'denied') Notification.requestPermission().then(p => { if (p === 'granted') new Notification('倒计时结束', { body: '设定的时间到了。' }); });
        } catch (e) { }
      }
    }
    const timer = setInterval(() => {
      if (!running) return;
      const now = performance.now();
      remain -= (now - last) / 1000; last = now;
      if (remain <= 0) {
        remain = 0; running = false; $('#cdSub').textContent = '时间到！';
        $('#cdOut').textContent = '倒计时结束 ' + new Date().toLocaleTimeString();
        if (!ringing) { ringing = true; alarm(); }
      }
      paint();
    }, 100);
    onClean(() => { clearInterval(timer); document.title = '我的工作台 · 免费工具'; });
    $('#cdPresets').addEventListener('click', e => {
      const b = e.target.closest('.shape'); if (!b) return;
      const m = +b.dataset.v; if (isNaN(m)) return;
      $('#cdH').value = Math.floor(m / 60); $('#cdM').value = m % 60; $('#cdS').value = 0;
      set(m * 60);
    });
    ['#cdH', '#cdM', '#cdS'].forEach(id => $(id).addEventListener('input', () => { if (!running) set(readInputs()); }));
    bindCtrl({ start: start, pause: pauseF, reset: () => { running = false; set(readInputs()); document.title = '倒计时'; } });
    bindChk('#cdNotify', () => { });
    set(300); paint();
  }
  G['online-timer'] = countdownUI;
  G['countdown-timer'] = countdownUI;

  /* ---------------- 番茄钟 ---------------- */
  G['pomodoro-timer'] = function (host) {
    const PHASES = { work: '专注', short: '短休息', long: '长休息' };
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div style="text-align:center;padding:20px 0">
          <div class="shapes" id="pdPhase" style="justify-content:center">${Object.keys(PHASES).map(k => TUI.pill(k, PHASES[k], k === 'work')).join('')}</div>
          <div id="pdTime" style="font-size:74px;font-weight:800;letter-spacing:-3px;margin:18px 0 4px;font-family:var(--mono)">25:00</div>
          <div class="scorebar" style="justify-content:center"><span>第 <b id="pdCycle">1</b> 轮</span><span>今日完成 <b id="pdDone">0</b></span><span>状态 <b id="pdState">待开始</b></span></div>
          <div class="progress" id="pdProg" style="display:block;max-width:460px;margin:18px auto"><i></i></div>
        </div>
        <div class="plabel">任务清单</div>
        <div class="fieldrow" style="gap:8px"><input type="text" id="pdTaskInput" placeholder="添加一个任务后回车" style="flex:1"><button class="btn-ghost btn-sm" id="pdTaskAdd">添加</button></div>
        <div id="pdTasks" style="margin-top:12px"></div>
      </div>
      ${paneBox('番茄钟', '工作 / 短休 / 长休自动轮转，带音效、任务清单与当日统计。',
      `<div class="plabel">专注时长（分）</div>${TUI.range('pdWork', 5, 60, 25, 1)}
        <div class="plabel">短休（分）</div>${TUI.range('pdShort', 1, 20, 5, 1)}
        <div class="plabel">长休（分）</div>${TUI.range('pdLong', 5, 45, 15, 1)}
        <div class="plabel">每几轮长休</div>${TUI.range('pdEvery', 2, 8, 4, 1)}
        <div class="shapes" style="margin-top:12px;gap:8px">
          <button class="btn-lime btn-sm" id="gStart">开始</button>
          <button class="btn-ghost btn-sm" id="gPause">暂停</button>
          <button class="btn-ghost btn-sm" id="gReset">重置本轮</button>
        </div>
        <div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="pdSkip">跳到下一阶段</button><button class="btn-ghost btn-sm" id="pdClearStat">清空统计</button></div>
        <div class="runnote">统计按日期存 wsft:pomodoro，只记录你自己设备上的数据。</div>`)}
    </div>`;
    let phase = 'work', cycle = 1, running = false, remain = 1500, total = 1500, last = 0, doneToday = 0;
    let tasks = load('pomodoro.tasks', []);
    function dayKey() { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function loadStats() { const s = load('pomodoro.stats', {}); return s[dayKey()] || 0; }
    function saveStats(n) { const s = load('pomodoro.stats', {}); s[dayKey()] = n; save('pomodoro.stats', s); }
    function dur(p) { return (+$({ work: '#pdWork', short: '#pdShort', long: '#pdLong' }[p]).value) * 60; }
    function setPhase(p, keepCycle) {
      phase = p; total = dur(p); remain = total;
      if (!keepCycle && p === 'work') { }
      $('#pdPhase').querySelectorAll('.shape').forEach(b => b.classList.toggle('on', b.dataset.v === p));
      $('#pdTime').textContent = pad2(Math.floor(remain / 60)) + ':' + pad2(remain % 60);
      $('#pdCycle').textContent = cycle;
      TUI.prog($('#pdProg'), 100);
    }
    function paint() {
      $('#pdTime').textContent = pad2(Math.floor(remain / 60)) + ':' + pad2(remain % 60);
      TUI.prog($('#pdProg'), total ? (1 - remain / total) * 100 : 0);
      $('#pdDone').textContent = doneToday;
      document.title = running ? '🍅 ' + $('#pdTime').textContent + ' · ' + PHASES[phase] : '番茄钟';
    }
    function nextPhase() {
      const every = +$('#pdEvery').value;
      if (phase === 'work') {
        doneToday++; saveStats(doneToday);
        tone(880, 0.2, 'triangle', 0.2); tone(660, 0.3, 'triangle', 0.16, 0.2);
        if (cycle % every === 0) { setPhase('long'); } else { setPhase('short'); }
      } else {
        if (phase === 'long') cycle++;
        tone(520, 0.2, 'triangle', 0.18);
        setPhase('work');
      }
      running = false; $('#pdState').textContent = '阶段结束，按「开始」继续';
      paint();
    }
    function start() { unlockAudio(); if (remain <= 0) setPhase(phase); running = true; last = performance.now(); $('#pdState').textContent = '进行中'; }
    function pause() { running = false; $('#pdState').textContent = '已暂停'; }
    const timer = setInterval(() => {
      if (!running) return;
      const now = performance.now();
      remain -= (now - last) / 1000; last = now;
      if (remain <= 0) { remain = 0; paint(); nextPhase(); return; }
      paint();
    }, 120);
    onClean(() => { clearInterval(timer); document.title = '我的工作台 · 免费工具'; });
    function renderTasks() {
      $('#pdTasks').innerHTML = tasks.length ? tasks.map((t, i) => `<div class="chk${t.done ? ' on' : ''}" data-i="${i}" style="margin-top:8px"><span class="box">${window.icon('gen', 11)}</span><span style="flex:1">${esc(t.text)}</span><span class="mini" data-del="${i}" style="cursor:pointer;color:#8a8a8a">删除</span></div>`).join('') : '<div class="note">还没有任务，加一条试试。</div>';
      save('pomodoro.tasks', tasks);
    }
    $('#pdTasks').addEventListener('click', e => {
      const del = e.target.closest('[data-del]');
      if (del) { tasks.splice(+del.dataset.del, 1); renderTasks(); return; }
      const c = e.target.closest('.chk');
      if (c) { tasks[+c.dataset.i].done = !tasks[+c.dataset.i].done; renderTasks(); }
    });
    function addTask() {
      const v = $('#pdTaskInput').value.trim(); if (!v) return;
      tasks.push({ text: v, done: false }); $('#pdTaskInput').value = ''; renderTasks();
    }
    $('#pdTaskAdd').addEventListener('click', addTask);
    $('#pdTaskInput').addEventListener('keydown', e => { if (e.key === 'Enter') addTask(); });
    bindPills('#pdPhase', v => { running = false; setPhase(v); paint(); });
    bindCtrl({ start: start, pause: pause, reset: () => { running = false; setPhase(phase); $('#pdState').textContent = '待开始'; paint(); } });
    $('#pdSkip').addEventListener('click', nextPhase);
    $('#pdClearStat').addEventListener('click', () => { doneToday = 0; saveStats(0); paint(); });
    ['#pdWork', '#pdShort', '#pdLong'].forEach(id => $(id).addEventListener('input', () => { if (!running) { setPhase(phase); paint(); } }));
    doneToday = loadStats();
    setPhase('work'); renderTasks(); paint();
  };

  /* ---------------- 世界时钟 ---------------- */
  G['world-clock'] = function (host) {
    const CITIES = [
      ['檀香山', 'Pacific/Honolulu'], ['洛杉矶', 'America/Los_Angeles'], ['丹佛', 'America/Denver'], ['芝加哥', 'America/Chicago'],
      ['纽约', 'America/New_York'], ['圣保罗', 'America/Sao_Paulo'], ['伦敦', 'Europe/London'], ['巴黎', 'Europe/Paris'],
      ['柏林', 'Europe/Berlin'], ['开罗', 'Africa/Cairo'], ['莫斯科', 'Europe/Moscow'], ['迪拜', 'Asia/Dubai'],
      ['加尔各答', 'Asia/Kolkata'], ['曼谷', 'Asia/Bangkok'], ['北京', 'Asia/Shanghai'], ['东京', 'Asia/Tokyo'],
      ['悉尼', 'Australia/Sydney'], ['奥克兰', 'Pacific/Auckland'], ['UTC', 'UTC']
    ];
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="scorebar" style="margin-bottom:12px"><span>本地时间 <b id="wcLocal">—</b></span><span>本地时区 <b id="wcZone">—</b></span></div>
        <div id="wcGrid" class="statgrid"></div>
      </div>
      ${paneBox('世界时钟', '用 Intl.DateTimeFormat + IANA 时区真实计算（含夏令时），不是固定偏移。',
      `<div class="plabel">显示格式</div>${TUI.sel('wcFmt', [{ v: '24', t: '24 小时制' }, { v: '12', t: '12 小时制' }], '24')}
        <div class="plabel">显示秒</div>${TUI.chk('wcSec', '显示秒', true)}
        <div class="plabel">城市</div>${TUI.chk('wcAll', '显示全部 ' + CITIES.length + ' 个城市', true)}
        <div class="runnote">昼夜指示按当地小时数推断（6–18 点为白天）。</div>`)}
    </div>`;
    let showSec = true, fmt12 = false, showAll = true;
    const fmtCache = {};
    function fmtFor(tz, h12, withSec) {
      const key = tz + '|' + h12 + '|' + withSec;
      if (!fmtCache[key]) {
        fmtCache[key] = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: withSec ? '2-digit' : undefined, hour12: h12 });
      }
      return fmtCache[key];
    }
    function dateFor(tz) { return new Intl.DateTimeFormat('zh-CN', { timeZone: tz, month: '2-digit', day: '2-digit', weekday: 'short' }); }
    function partsOf(tz) {
      const d = new Date();
      const t = fmtFor(tz, fmt12, showSec).format(d);
      let hour = +new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(d);
      return { t: t, hour: hour, date: dateFor(tz).format(d) };
    }
    function render() {
      const local = new Date();
      $('#wcLocal').textContent = pad2(local.getHours()) + ':' + pad2(local.getMinutes()) + ':' + pad2(local.getSeconds());
      $('#wcZone').textContent = (Intl.DateTimeFormat().resolvedOptions().timeZone || '本地') + ' · UTC' + (local.getTimezoneOffset() <= 0 ? '+' : '-') + pad2(Math.abs(local.getTimezoneOffset() / 60)) + ':' + pad2(Math.abs(local.getTimezoneOffset() % 60));
      const list = showAll ? CITIES : CITIES.slice(0, 6);
      $('#wcGrid').innerHTML = list.map(c => {
        const p = partsOf(c[1]);
        const day = p.hour >= 6 && p.hour < 18;
        return `<div class="stat" style="border-color:${day ? '#2a3a1a' : '#1e1e2e'}"><b style="font-size:22px">${p.t}</b><span>${esc(c[0])} ${day ? '☀' : '🌙'}<br>${p.date} · ${c[1]}</span></div>`;
      }).join('');
    }
    render();
    const timer = setInterval(render, 1000);
    onClean(() => clearInterval(timer));
    bindChk('#wcSec', v => { showSec = v; render(); });
    bindChk('#wcAll', v => { showAll = v; render(); });
    $('#wcFmt').addEventListener('change', () => { fmt12 = $('#wcFmt').value === '12'; render(); });
    bindCtrl({ start: () => render(), pause: () => { }, reset: () => render() });
    ['#gStart', '#gPause', '#gReset'].forEach(id => { const el2 = $(id); if (el2) el2.style.display = 'none'; });
  };

  /* ---------------- 键盘测试 ---------------- */
  G['keyboard-test'] = function (host) {
    const ROWS = [
      [['Escape', 'Esc', 1.4], ['F1', 'F1'], ['F2', 'F2'], ['F3', 'F3'], ['F4', 'F4'], ['F5', 'F5'], ['F6', 'F6'], ['F7', 'F7'], ['F8', 'F8'], ['F9', 'F9'], ['F10', 'F10'], ['F11', 'F11'], ['F12', 'F12']],
      [['Backquote', '`'], ['Digit1', '1'], ['Digit2', '2'], ['Digit3', '3'], ['Digit4', '4'], ['Digit5', '5'], ['Digit6', '6'], ['Digit7', '7'], ['Digit8', '8'], ['Digit9', '9'], ['Digit0', '0'], ['Minus', '-'], ['Equal', '='], ['Backspace', '退格', 2]],
      [['Tab', 'Tab', 1.5], ['KeyQ', 'Q'], ['KeyW', 'W'], ['KeyE', 'E'], ['KeyR', 'R'], ['KeyT', 'T'], ['KeyY', 'Y'], ['KeyU', 'U'], ['KeyI', 'I'], ['KeyO', 'O'], ['KeyP', 'P'], ['BracketLeft', '['], ['BracketRight', ']'], ['Backslash', '\\', 1.5]],
      [['CapsLock', 'Caps', 1.8], ['KeyA', 'A'], ['KeyS', 'S'], ['KeyD', 'D'], ['KeyF', 'F'], ['KeyG', 'G'], ['KeyH', 'H'], ['KeyJ', 'J'], ['KeyK', 'K'], ['KeyL', 'L'], ['Semicolon', ';'], ['Quote', "'"], ['Enter', 'Enter', 2.2]],
      [['ShiftLeft', 'Shift', 2.4], ['KeyZ', 'Z'], ['KeyX', 'X'], ['KeyC', 'C'], ['KeyV', 'V'], ['KeyB', 'B'], ['KeyN', 'N'], ['KeyM', 'M'], ['Comma', ','], ['Period', '.'], ['Slash', '/'], ['ShiftRight', 'Shift', 2.6]],
      [['ControlLeft', 'Ctrl', 1.5], ['MetaLeft', 'Win', 1.2], ['AltLeft', 'Alt', 1.2], ['Space', '空格', 7], ['AltRight', 'Alt', 1.2], ['MetaRight', 'Win', 1.2], ['ContextMenu', '菜单', 1.2], ['ControlRight', 'Ctrl', 1.5]],
      [['ArrowUp', '↑'], ['ArrowLeft', '←'], ['ArrowDown', '↓'], ['ArrowRight', '→']]
    ];
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="statgrid">
          <div class="stat"><b id="kbCount">0</b><span>本次按键数</span></div>
          <div class="stat"><b id="kbCode">—</b><span>code</span></div>
          <div class="stat"><b id="kbKey">—</b><span>key</span></div>
          <div class="stat"><b id="kbWhich">—</b><span>keyCode</span></div>
          <div class="stat"><b id="kbMax">0</b><span>同时按下最多</span></div>
        </div>
        <div id="kbBoard" style="margin-top:16px;background:#141414;border:1px solid #242424;border-radius:12px;padding:12px;overflow:auto"></div>
        <div class="runnote" id="kbMsg">按任意键开始测试。按住不放可以感受键盘是否为「真 N-key rollover」。</div>
      </div>
      ${paneBox('键盘测试', '完整键位图 + 实时按下高亮 + 显示 code / key / keyCode，并统计多键同时按下的能力。',
      `<div class="plabel">布局</div>${TUI.sel('kbLayout', [{ v: 'full', t: '全尺寸（含 F 键与方向键）' }, { v: 'main', t: '仅主键区' }], 'full')}
        <div class="plabel">高亮保留</div>${TUI.chk('kbSticky', '松开后保留 1 秒高亮', true)}
        <div class="plabel">测试区间</div><div class="note">部分廉价键盘共用矩阵，同时按住 3 个以上键时会丢键（ghosting）——本页能如实显示。</div>
        <div class="shapes" style="margin-top:12px"><button class="btn-ghost btn-sm" id="gReset">重置计数</button></div>
        <div class="outbox" id="kbHist">还没有按键</div>`)}
    </div>`;
    let count = 0, held = {}, maxHeld = 0, sticky = true, hist = [];
    function build() {
      const mainOnly = $('#kbLayout').value === 'main';
      $('#kbBoard').innerHTML = ROWS.map((row, ri) => {
        if (mainOnly && ri === 0) return '';
        return `<div style="display:flex;gap:5px;margin-bottom:5px;justify-content:center">` +
          row.map(k => `<div class="kbd" data-code="${k[0]}" style="flex:${k[2] || 1};min-width:${(k[2] || 1) * 30}px;height:34px;display:flex;align-items:center;justify-content:center;font-size:12px;text-align:center;transition:background .08s">${esc(k[1])}</div>`).join('') + '</div>';
      }).join('');
    }
    function upd() {
      $('#kbCount').textContent = count;
      $('#kbMax').textContent = maxHeld;
      $('#kbHist').innerHTML = hist.length ? hist.slice(0, 8).map(h => `<div class="row"><span>${esc(h.code)}</span><b>key=${esc(h.key)} · keyCode=${h.which}</b></div>`).join('') : '还没有按键';
    }
    window.addEventListener('keydown', e => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].indexOf(e.code) >= 0) e.preventDefault();
      if (!held[e.code]) { count++; held[e.code] = true; }
      const n = Object.keys(held).length;
      if (n > maxHeld) maxHeld = n;
      $('#kbCode').textContent = e.code || '—';
      $('#kbKey').textContent = e.key === ' ' ? 'Space' : (e.key || '—');
      $('#kbWhich').textContent = e.keyCode || e.which || '0';
      hist.unshift({ code: e.code, key: e.key, which: e.keyCode || e.which });
      hist = hist.slice(0, 12);
      const kb = $('#kbBoard').querySelector('[data-code="' + e.code + '"]');
      if (kb) { kb.style.background = '#d7f452'; kb.style.color = '#0b0b0b'; }
      $('#kbMsg').textContent = '正在测试：同时按下 ' + n + ' 个键' + (n >= 3 ? '（能同时识别多个说明不是常见 ghosting 键盘）' : '');
      upd();
    });
    window.addEventListener('keyup', e => {
      held[e.code] = false; delete held[e.code];
      const kb = $('#kbBoard').querySelector('[data-code="' + e.code + '"]');
      if (kb) {
        if (sticky) setTimeout(() => { kb.style.background = ''; kb.style.color = ''; }, 900);
        else { kb.style.background = ''; kb.style.color = ''; }
      }
      upd();
    });
    window.addEventListener('blur', () => { held = {}; });
    $('#kbLayout').addEventListener('change', build);
    bindChk('#kbSticky', v => sticky = v);
    ctlEl('#gReset').addEventListener('click', () => { count = 0; maxHeld = 0; hist = []; held = {}; upd(); $('#kbMsg').textContent = '计数已重置。'; });
    bindCtrl({ start: () => { }, pause: () => { }, reset: () => { count = 0; maxHeld = 0; hist = []; upd(); } });
    ctlEl('#gStart').style.display = 'none'; ctlEl('#gPause').style.display = 'none';
    ctlEl('#gReset').textContent = '重置计数';
    build(); upd();
  };

  /* ---------------- 鼠标测试 ---------------- */
  G['mouse-test'] = function (host) {
    const W = 620, H = 380;
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="statgrid">
          <div class="stat"><b id="moBtn">—</b><span>当前按键</span></div>
          <div class="stat"><b id="moWheel">0</b><span>滚轮累计</span></div>
          <div class="stat"><b id="moDbl">0</b><span>双击次数</span></div>
          <div class="stat"><b id="moDpi">—</b><span>估算 DPI</span></div>
        </div>
        <div id="moWrap" style="margin-top:16px"></div>
        <div class="runnote">在区域内移动鼠标可以看到轨迹；按下不同键会显示左/中/右。</div>
      </div>
      ${paneBox('鼠标测试', '按键 / 滚轮 / 双击 / 轨迹 + DPI 手动标定（画出你屏幕上的 100mm 对应像素长度）。',
      `<div class="plabel">轨迹长度</div>${TUI.range('moTrail', 20, 900, 260, 20)}
        <div class="plabel">DPI 标定：把下面这条线拖到 100 毫米长</div>
        <div id="moRuler" style="position:relative;height:56px;background:#141414;border-radius:10px;border:1px solid #242424;overflow:hidden">
          <div id="moBar" style="position:absolute;top:18px;left:0;height:20px;background:#d7f452;width:200px;border-radius:4px"></div>
          <div id="moHandle" style="position:absolute;top:12px;left:200px;width:14px;height:32px;background:#fff;border-radius:4px;cursor:ew-resize"></div>
        </div>
        <div class="outbox" id="moOut">拖动白色把手，使绿色条宽度正好等于你屏幕上 10 厘米（100mm）的长度。</div>
        <div class="shapes" style="margin-top:12px"><button class="btn-ghost btn-sm" id="gReset">清空轨迹</button></div>`)}
    </div>`;
    const C = mkCanvas($('#moWrap'), W, H);
    let trail = [], buttons = 0, wheel = 0, dbl = 0, showTrail = 260;
    function draw() {
      C.ctx.fillStyle = '#0d0d0d'; C.ctx.fillRect(0, 0, W, H);
      C.ctx.strokeStyle = '#1c1c1c';
      for (let x = 0; x < W; x += 30) { C.ctx.beginPath(); C.ctx.moveTo(x, 0); C.ctx.lineTo(x, H); C.ctx.stroke(); }
      for (let y = 0; y < H; y += 30) { C.ctx.beginPath(); C.ctx.moveTo(0, y); C.ctx.lineTo(W, y); C.ctx.stroke(); }
      trail.forEach((p, i) => {
        C.ctx.fillStyle = 'rgba(215,244,82,' + (i / trail.length * 0.9 + 0.05) + ')';
        C.ctx.beginPath(); C.ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2); C.ctx.fill();
      });
      C.ctx.fillStyle = '#8a8a8a'; C.ctx.font = '12px Inter,sans-serif'; C.ctx.textAlign = 'left';
      C.ctx.fillText('按钮位掩码：' + buttons + '（左 1 / 右 2 / 中 4）', 12, 20);
    }
    C.cv.addEventListener('pointermove', e => {
      const p = C.pos(e);
      trail.push({ x: p.x, y: p.y });
      while (trail.length > showTrail) trail.shift();
    });
    C.cv.addEventListener('pointerdown', e => {
      buttons = e.buttons; $('#moBtn').textContent = ['—', '左键', '右键', '左+右', '中键', '左+中', '右+中', '三键'][e.buttons] || String(e.buttons);
      if (e.button === 1) e.preventDefault();
    });
    C.cv.addEventListener('pointerup', () => { buttons = 0; $('#moBtn').textContent = '—'; });
    C.cv.addEventListener('contextmenu', e => e.preventDefault());
    C.cv.addEventListener('dblclick', () => { dbl++; $('#moDbl').textContent = dbl; });
    C.cv.addEventListener('wheel', e => { wheel += Math.sign(e.deltaY); $('#moWheel').textContent = wheel; e.preventDefault(); }, { passive: false });
    const loop = Loop(() => draw());
    bindRange('#moTrail', v => showTrail = v);
    let dragging = false;
    const handle = $('#moHandle'), bar = $('#moBar'), ruler = $('#moRuler');
    function setLen(px) {
      const w = clamp(px, 40, (ruler.clientWidth || 400) - 20);
      bar.style.width = w + 'px'; handle.style.left = (w - 7) + 'px';
      const dpi = w / (100 / 25.4);
      $('#moDpi').textContent = Math.round(dpi);
      $('#moOut').innerHTML = '当前标定长度 <b>' + w + 'px</b> = 100mm → 估算 <b>' + Math.round(dpi) + ' DPI</b>（约 ' + (dpi * 2.54).toFixed(0) + ' 点/厘米）。';
    }
    handle.addEventListener('pointerdown', e => { dragging = true; unlockAudio(); try { handle.setPointerCapture(e.pointerId); } catch (x) { } });
    window.addEventListener('pointermove', e => {
      if (!dragging) return;
      const r = ruler.getBoundingClientRect();
      setLen((e.clientX - r.left) * (ruler.clientWidth / r.width));
    });
    window.addEventListener('pointerup', () => dragging = false);
    bindCtrl({ start: () => { }, pause: () => { }, reset: () => { trail = []; wheel = 0; dbl = 0; $('#moWheel').textContent = '0'; $('#moDbl').textContent = '0'; } });
    ctlEl('#gStart').style.display = 'none'; ctlEl('#gPause').style.display = 'none';
    ctlEl('#gReset').textContent = '清空轨迹';
    setLen(200); loop.start();
  };

  /* ---------------- 摄像头测试 ---------------- */
  G['webcam-test'] = function (host) {
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="preview" id="wcPrev"><video id="wcVideo" autoplay playsinline muted style="width:100%"></video></div>
        <div class="statgrid">
          <div class="stat"><b id="wcRes">—</b><span>实际分辨率</span></div>
          <div class="stat"><b id="wcFps">—</b><span>实测帧率</span></div>
          <div class="stat"><b id="wcDev">0</b><span>摄像头数量</span></div>
        </div>
        <div class="warnbox" id="wcErr" style="display:none"></div>
      </div>
      ${paneBox('摄像头测试', 'getUserMedia 实时预览，显示真实分辨率与实测帧率，可截图。',
      `${TUI.field('设备', TUI.sel('wcDevice', [{ v: '', t: '默认摄像头' }], ''))}
        <div class="plabel">请求分辨率</div>${TUI.sel('wcReq', [{ v: '640x480', t: '640 × 480' }, { v: '1280x720', t: '1280 × 720' }, { v: '1920x1080', t: '1920 × 1080' }], '1280x720')}
        <div class="shapes" style="margin-top:12px;gap:8px">
          <button class="btn-lime btn-sm" id="gStart">开启摄像头</button>
          <button class="btn-ghost btn-sm" id="gPause">停止</button>
          <button class="btn-ghost btn-sm" id="wcShot">截图</button>
        </div>
        <div class="runnote">权限只在本地使用，视频不会上传到任何服务器。</div>`)}
    </div>`;
    const video = $('#wcVideo');
    let stream = null, frames = 0, lastFps = 0, fpsTimer = null, track = null;
    function fail(msg) {
      $('#wcErr').style.display = 'block';
      $('#wcErr').innerHTML = '<b>无法访问摄像头：</b>' + esc(msg) + '<br>常见原因：浏览器未授权、没有摄像头、或当前环境（如无摄像头的服务器 / 无头浏览器）不支持。你可以授权后重试。';
      $('#wcRes').textContent = '—'; $('#wcFps').textContent = '—';
    }
    async function listDevices() {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
        const list = await navigator.mediaDevices.enumerateDevices();
        const cams = list.filter(d => d.kind === 'videoinput');
        $('#wcDev').textContent = cams.length;
        const sel = $('#wcDevice');
        sel.innerHTML = [{ v: '', t: '默认摄像头' }].concat(cams.map((c, i) => ({ v: c.deviceId, t: c.label || ('摄像头 ' + (i + 1)) })))
          .map(o => `<option value="${esc(o.v)}">${esc(o.t)}</option>`).join('');
      } catch (e) { }
    }
    async function start() {
      stop();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { fail('当前浏览器不支持 getUserMedia（需要 https 或 localhost 环境）。'); return; }
      const [w, h] = $('#wcReq').value.split('x').map(Number);
      const id = $('#wcDevice').value;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: w }, height: { ideal: h }, deviceId: id ? { exact: id } : undefined }, audio: false });
        video.srcObject = stream;
        await video.play().catch(() => { });
        track = stream.getVideoTracks()[0];
        const st = track.getSettings ? track.getSettings() : {};
        $('#wcRes').textContent = (st.width || video.videoWidth || '?') + ' × ' + (st.height || video.videoHeight || '?');
        $('#wcErr').style.display = 'none';
        frames = 0;
        clearInterval(fpsTimer);
        fpsTimer = setInterval(() => {
          $('#wcFps').textContent = frames + ' fps（实测）';
          frames = 0;
        }, 1000);
        onClean(() => clearInterval(fpsTimer));
        const count = () => { frames++; if (stream) requestAnimationFrame(count); };
        requestAnimationFrame(count);
        listDevices();
      } catch (e) {
        fail((e && (e.name ? e.name + ' · ' : '') + (e.message || '未知错误')) || '未知错误');
      }
    }
    function stop() {
      if (stream) { stream.getTracks().forEach(t => { try { t.stop(); } catch (e) { } }); stream = null; }
      video.srcObject = null;
      clearInterval(fpsTimer);
    }
    onClean(stop);
    $('#wcShot').addEventListener('click', () => {
      if (!video.videoWidth) { window.toast('还没有画面'); return; }
      const c = document.createElement('canvas');
      c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      pngOf(c, 'webcam-shot.png');
    });
    $('#wcDevice').addEventListener('change', start);
    bindCtrl({ start: start, pause: stop, reset: () => { stop(); start(); } });
    ctlEl('#gStart').textContent = '开启摄像头';
    ctlEl('#gPause').textContent = '停止';
    ctlEl('#gReset').textContent = '重新连接';
    listDevices();
  };

  /* ---------------- 麦克风测试 ---------------- */
  G['mic-test'] = function (host) {
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div id="miWrap"></div>
        <div class="statgrid">
          <div class="stat"><b id="miPeak">—</b><span>峰值 dBFS</span></div>
          <div class="stat"><b id="miAvg">—</b><span>平均值 dBFS</span></div>
          <div class="stat"><b id="miMsg">未开始</b><span>状态</span></div>
        </div>
        <div class="progress" id="miBar" style="display:block;margin-top:12px"><i></i></div>
        <audio id="miPlay" controls style="width:100%;margin-top:12px;display:none"></audio>
        <div class="warnbox" id="miErr" style="display:none"></div>
      </div>
      ${paneBox('麦克风测试', 'getUserMedia + AnalyserNode 实时波形与电平，可录一段回放。全部在本地处理。',
      `<div class="shapes" style="margin-top:12px;gap:8px">
          <button class="btn-lime btn-sm" id="gStart">开始监听</button>
          <button class="btn-ghost btn-sm" id="gPause">停止</button>
          <button class="btn-ghost btn-sm" id="miRec">录一段</button>
        </div>
        <div class="plabel">波形显示</div>${TUI.sel('miView', [{ v: 'wave', t: '示波器波形' }, { v: 'bars', t: '频谱柱' }], 'wave')}
        <div class="plabel">增益</div>${TUI.range('miGain', 1, 20, 6, 1)}
        <div class="runnote">dBFS = 20·log10(采样峰值)，0 dBFS 是数字满刻度。</div>`)}
    </div>`;
    const C = mkCanvas($('#miWrap'), 620, 200);
    let stream = null, ctxA = null, analyser = null, data = null, raf = null, recorder = null, chunks = [], recording = false;
    function fail(msg) {
      $('#miErr').style.display = 'block';
      $('#miErr').innerHTML = '<b>无法访问麦克风：</b>' + esc(msg) + '<br>请检查系统权限、是否有输入设备；无头浏览器通常没有麦克风，这属于预期情况。';
      $('#miMsg').textContent = '失败';
    }
    async function start() {
      stop();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { fail('当前浏览器不支持 getUserMedia。'); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        const c = ac(); if (!c) { fail('无法创建 AudioContext。'); return; }
        ctxA = c;
        const src = ctxA.createMediaStreamSource(stream);
        analyser = ctxA.createAnalyser();
        analyser.fftSize = 2048;
        data = new Uint8Array(analyser.fftSize);
        src.connect(analyser);
        $('#miErr').style.display = 'none';
        $('#miMsg').textContent = '监听中';
        loop();
      } catch (e) { fail((e && (e.name ? e.name + ' · ' : '') + (e.message || '')) || '未知错误'); }
    }
    function stop() {
      if (raf) cancelAnimationFrame(raf); raf = null;
      if (stream) { stream.getTracks().forEach(t => { try { t.stop(); } catch (e) { } }); stream = null; }
      analyser = null;
      if ($('#miMsg').textContent === '监听中') $('#miMsg').textContent = '已停止';
    }
    onClean(stop);
    function loop() {
      if (!analyser) return;
      analyser.getByteTimeDomainData(data);
      let peak = 0, sum = 0;
      for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; peak = Math.max(peak, Math.abs(v)); sum += v * v; }
      const rms = Math.sqrt(sum / data.length);
      const dB = v => v > 0 ? Math.round(20 * Math.log10(v)) : -Infinity;
      $('#miPeak').textContent = peak > 0 ? dB(peak) + ' dB' : '−∞';
      $('#miAvg').textContent = rms > 0 ? dB(rms) + ' dB' : '−∞';
      TUI.prog($('#miBar'), Math.max(0, 100 + dB(peak) * 1.5));
      const gain = (+$('#miGain').value) / 3;
      C.ctx.fillStyle = '#0d0d0d'; C.ctx.fillRect(0, 0, C.W, C.H);
      const view = $('#miView').value;
      if (view === 'wave') {
        C.ctx.strokeStyle = '#d7f452'; C.ctx.lineWidth = 2; C.ctx.beginPath();
        for (let i = 0; i < data.length; i++) {
          const x = i / data.length * C.W;
          const y = C.H / 2 + ((data[i] - 128) / 128) * gain * C.H * 0.5;
          i ? C.ctx.lineTo(x, y) : C.ctx.moveTo(x, y);
        }
        C.ctx.stroke();
      } else {
        analyser.getByteFrequencyData(data);
        const n = 64, bw = C.W / n;
        for (let i = 0; i < n; i++) {
          const v = data[Math.floor(i * (data.length / n))] / 255;
          C.ctx.fillStyle = 'rgba(215,244,82,' + (0.25 + v * 0.75) + ')';
          C.ctx.fillRect(i * bw, C.H - v * C.H, bw - 2, v * C.H);
        }
      }
      raf = requestAnimationFrame(loop);
    }
    $('#miRec').addEventListener('click', () => {
      if (!stream) { window.toast('先开始监听'); return; }
      if (!recording) {
        if (typeof MediaRecorder === 'undefined') { window.toast('当前浏览器不支持 MediaRecorder'); return; }
        try {
          recorder = new MediaRecorder(stream);
          chunks = [];
          recorder.ondataavailable = e => chunks.push(e.data);
          recorder.onstop = () => {
            const blob = new Blob(chunks, { type: chunks[0] ? chunks[0].type : 'audio/webm' });
            const url = URL.createObjectURL(blob);
            const a = $('#miPlay'); a.src = url; a.style.display = 'block';
            onClean(() => URL.revokeObjectURL(url));
          };
          recorder.start();
          recording = true; $('#miRec').textContent = '停止录音';
        } catch (e) { window.toast('录音失败：' + e.message); }
      } else {
        try { recorder.stop(); } catch (e) { }
        recording = false; $('#miRec').textContent = '录一段';
      }
    });
    $('#miView').addEventListener('change', () => { });
    bindRange('#miGain', () => { });
    bindCtrl({ start: start, pause: stop, reset: () => { stop(); start(); } });
    ctlEl('#gStart').textContent = '开始监听';
    ctlEl('#gPause').textContent = '停止';
    ctlEl('#gReset').textContent = '重新连接';
  };

  /* ---------------- 扬声器测试 ---------------- */
  G['speaker-test'] = function (host) {
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          <div id="spVisual" style="width:min(100%,560px);height:150px;background:#141414;border:1px solid #242424;border-radius:12px;position:relative;overflow:hidden">
            <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#8a8a8a;font-size:13px">声道示意图：L · C · R</div>
            <div id="spL" style="position:absolute;left:14%;top:50%;transform:translate(-50%,-50%);width:54px;height:54px;border-radius:50%;background:#242424;transition:background .1s"></div>
            <div id="spC" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:54px;height:54px;border-radius:50%;background:#242424;transition:background .1s"></div>
            <div id="spR" style="position:absolute;left:86%;top:50%;transform:translate(-50%,-50%);width:54px;height:54px;border-radius:50%;background:#242424;transition:background .1s"></div>
          </div>
          <div class="outbox" id="spOut" style="width:min(100%,560px)">选择下面的测试项，声音由 Web Audio 实时合成。</div>
        </div>
      </div>
      ${paneBox('扬声器 / 声道测试', '左/右/中置声道测试音、频率扫描 20Hz–20kHz、声道平衡。',
      `<div class="shapes" style="margin-top:12px;gap:8px">
          <button class="btn-lime btn-sm" id="spLbtn">左声道</button>
          <button class="btn-ghost btn-sm" id="spCbtn">中置</button>
          <button class="btn-ghost btn-sm" id="spRbtn">右声道</button>
          <button class="btn-ghost btn-sm" id="spBbtn">双声道</button>
        </div>
        <div class="shapes" style="margin-top:10px">
          <button class="btn-ghost btn-sm" id="spSweep">20Hz → 20kHz 扫频</button>
          <button class="btn-ghost btn-sm" id="spPhase">相位测试</button>
        </div>
        <div class="plabel">音量</div>${TUI.range('spVol', 0, 100, 35, 1)}
        <div class="plabel">平衡（左 ← → 右）</div>${TUI.range('spBal', -100, 100, 0, 5)}
        <div class="plabel">单音频率</div>${TUI.range('spFreq', 20, 20000, 440, 10)}
        <div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="spTone">播放该频率 1.5 秒</button></div>
        <div class="runnote">20kHz 以上多数人听不到属于正常；低频需要好一点的耳机/音箱才能听到。</div>`)}
    </div>`;
    let playing = null, stopWhen = 0;
    function vol() { return (+$('#spVol').value) / 100 * 0.35; }
    function lights(which) {
      [['spL', 'L'], ['spC', 'C'], ['spR', 'R']].forEach(p => {
        const active = which === 'both' || which === p[1].toLowerCase();
        $(  '#' + p[0]).style.background = active ? '#d7f452' : '#242424';
      });
    }
    function playChannel(which, durSec) {
      const c = ac(); if (!c) return;
      stopAll();
      const pan = which === 'l' ? -1 : which === 'r' ? 1 : 0;
      const o1 = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain();
      const p = c.createStereoPanner ? c.createStereoPanner() : null;
      o1.type = 'sine'; o1.frequency.value = 440; o2.type = 'sine'; o2.frequency.value = 440;
      g.gain.value = vol();
      o1.connect(g); o2.connect(g);
      if (p) { p.pan.value = pan; g.connect(p); p.connect(c.destination); } else g.connect(c.destination);
      o2.detune.value = which === 'c' ? 0 : 6;
      o1.start(); o2.start();
      const t = setTimeout(() => { try { o1.stop(); o2.stop(); } catch (e) { } lights(null); }, (durSec || 1.5) * 1000);
      playing = () => { clearTimeout(t); try { o1.stop(); o2.stop(); } catch (e) { } lights(null); };
      lights(which === 'c' ? 'c' : which);
      $('#spOut').textContent = ({ l: '正在播放：左声道 440Hz', r: '正在播放：右声道 440Hz', c: '正在播放：中置（左右同相）', both: '双声道 440Hz' })[which] || '';
    }
    function stopAll() { if (playing) { playing(); playing = null; } if (sweepState.o) { try { sweepState.o.stop(); } catch (e) { } sweepState.o = null; } lights(null); }
    const sweepState = { o: null };
    function sweep() {
      const c = ac(); if (!c) return;
      stopAll();
      const o = c.createOscillator(), g = c.createGain();
      const p = c.createStereoPanner ? c.createStereoPanner() : null;
      o.type = 'sine'; o.frequency.setValueAtTime(20, c.currentTime);
      o.frequency.exponentialRampToValueAtTime(20000, c.currentTime + 8);
      g.gain.value = vol() * 0.7;
      o.connect(g);
      if (p) { p.pan.value = (+$('#spBal').value) / 100; g.connect(p); p.connect(c.destination); } else g.connect(c.destination);
      o.start();
      o.onended = () => { sweepState.o = null; };
      sweepState.o = o;
      $('#spOut').textContent = '正在扫频：20Hz → 20kHz（约 8 秒），留意你从哪个频率开始听不到。';
    }
    $('#spLbtn').addEventListener('click', () => { unlockAudio(); playChannel('l'); });
    $('#spCbtn').addEventListener('click', () => { unlockAudio(); playChannel('c'); });
    $('#spRbtn').addEventListener('click', () => { unlockAudio(); playChannel('r'); });
    $('#spBbtn').addEventListener('click', () => { unlockAudio(); playChannel('both'); });
    $('#spSweep').addEventListener('click', () => { unlockAudio(); sweep(); });
    $('#spPhase').addEventListener('click', () => { unlockAudio(); playChannel('both', 2.2); $('#spOut').textContent = '相位测试：两个声道同相播放。若听起来声音很小或散开，说明接线极性可能反了。'; });
    $('#spTone').addEventListener('click', () => {
      unlockAudio();
      const f = +$('#spFreq').value;
      const c = ac(); if (!c) return;
      const o = c.createOscillator(), g = c.createGain(), p = c.createStereoPanner ? c.createStereoPanner() : null;
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, c.currentTime);
      g.gain.exponentialRampToValueAtTime(vol(), c.currentTime + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 1.5);
      o.connect(g);
      if (p) { p.pan.value = (+$('#spBal').value) / 100; g.connect(p); p.connect(c.destination); } else g.connect(c.destination);
      o.start(); o.stop(c.currentTime + 1.6);
      $('#spOut').textContent = '播放 ' + f + ' Hz';
    });
    bindRange('#spFreq', v => { $('#spOut').textContent = '当前频率 ' + v + ' Hz'; });
    bindRange('#spBal', () => { });
    bindRange('#spVol', () => { });
    bindCtrl({ start: () => { unlockAudio(); playChannel('both'); }, pause: stopAll, reset: stopAll });
    ctlEl('#gStart').textContent = '测试左右声道';
    ctlEl('#gPause').textContent = '停止';
    ctlEl('#gReset').textContent = '停止';
    lights(null);
  };

  /* ---------------- 屏幕测试 ---------------- */
  G['screen-test'] = function (host) {
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          <div id="scStage" style="width:min(100%,640px);height:360px;border-radius:12px;border:1px solid #242424;display:flex;align-items:center;justify-content:center;background:#d7f452;color:#0b0b0b;font-weight:800;font-size:16px;transition:background .12s">纯色模式</div>
          <div class="shapes" id="scColors"></div>
          <div class="scorebar"><span>估算刷新率 <b id="scHz">—</b></span><span>分辨率 <b id="scRes">—</b></span></div>
        </div>
      </div>
      ${paneBox('屏幕测试', '纯色 / 坏点 / 灰阶带（banding）/ 视角 / 刷新率估算。点「全屏」后按 Esc 退出。',
      `<div class="shapes" style="margin-top:12px">
          <button class="btn-lime btn-sm" id="scFull">全屏纯色</button>
          <button class="btn-ghost btn-sm" id="scCycle">自动轮播</button>
        </div>
        <div class="plabel">测试项</div>${TUI.sel('scMode', [{ v: 'solid', t: '纯色（点色块切换）' }, { v: 'pixel', t: '坏点检测（黑白棋盘）' }, { v: 'grad', t: '灰阶渐变（banding）' }, { v: 'angle', t: '视角测试（多角度色块）' }, { v: 'gamma', t: '伽马 / 黑位测试' }], 'solid')}
        <div class="runnote">刷新率通过 rAF 时间间隔估算，会略低于真实值。</div>`)}
    </div>`;
    const stage = $('#scStage');
    const COLORS = [['#ffffff', '白'], ['#000000', '黑'], ['#ff0000', '红'], ['#00ff00', '绿'], ['#0000ff', '蓝'], ['#808080', '灰'], ['#d7f452', 'Lime']];
    $('#scColors').innerHTML = COLORS.map((c, i) => `<button class="shape" data-c="${c[0]}" style="${i === 0 ? '' : 'border-color:' + c[0]}">${c[1]}</button>`).join('');
    $('#scRes').textContent = window.screen.width + ' × ' + window.screen.height + '（CSS px）· DPR ' + (window.devicePixelRatio || 1);
    function render() {
      const mode = $('#scMode').value;
      if (mode === 'solid') return;
      if (mode === 'grad') {
        stage.style.background = 'linear-gradient(90deg,#000 0%,#fff 100%)';
        stage.textContent = '灰阶渐变：能看到阶梯说明 8bit banding 明显'; stage.style.color = '#ff8fb1';
      } else if (mode === 'pixel') {
        stage.style.background = 'repeating-conic-gradient(#fff 0% 25%, #000 0% 50%) 50% / 24px 24px';
        stage.textContent = ''; 
      } else if (mode === 'angle') {
        stage.style.background = 'linear-gradient(135deg,#ff0000,#00ff00 33%,#0000ff 66%,#ffffff)';
        stage.textContent = '走到侧面 / 上下倾斜看色偏'; stage.style.color = '#000';
      } else if (mode === 'gamma') {
        stage.style.background = 'linear-gradient(90deg,#000000,#101010,#181818,#202020,#282828)';
        stage.textContent = '1–5 号黑阶若分不清，说明黑位被裁切'; stage.style.color = '#d7f452';
      }
      if (mode !== 'solid') stage.style.fontSize = '14px';
    }
    $('#scColors').addEventListener('click', e => {
      const b = e.target.closest('.shape'); if (!b) return;
      stage.style.background = b.dataset.c;
      stage.textContent = '';
    });
    $('#scMode').addEventListener('change', render);
    $('#scFull').addEventListener('click', () => {
      const el2 = stage;
      el2.textContent = '';
      if (el2.requestFullscreen) el2.requestFullscreen().catch(() => window.toast('浏览器拒绝了全屏请求'));
      else window.toast('当前浏览器不支持全屏 API');
    });
    let cycling = false, ci = 0;
    $('#scCycle').addEventListener('click', () => {
      cycling = !cycling;
      $('#scCycle').textContent = cycling ? '停止轮播' : '自动轮播';
    });
    let frames = 0, fpsT0 = performance.now(), lastCycle = 0;
    const loop = Loop(() => {
      frames++;
      const now = performance.now();
      if (now - fpsT0 > 1000) {
        $('#scHz').textContent = frames + ' Hz（估算）';
        frames = 0; fpsT0 = now;
      }
      if (cycling) {
        if (now - lastCycle > 900) { lastCycle = now; ci = (ci + 1) % COLORS.length; stage.style.background = COLORS[ci][0]; stage.textContent = ''; }
      }
    });
    bindCtrl({ start: () => loop.start(), pause: () => loop.stop(), reset: () => { stage.style.background = COLORS[ci][0]; stage.textContent = ''; render(); } });
    ctlEl('#gStart').textContent = '启动测速';
    ctlEl('#gPause').textContent = '停止测速';
    ctlEl('#gReset').textContent = '复位显示';
    loop.start();
  };

  /* ---------------- 打字测试 ---------------- */
  G['typing-test'] = function (host) {
    const EN = [
      'The quick brown fox jumps over the lazy dog while the sleepy cat watches from the warm windowsill.',
      'Typing speed improves when you keep your eyes on the screen instead of looking down at the keyboard.',
      'A good test measures both speed and accuracy, because fast typing with many errors is not really fast.',
      'Local tools run entirely in your browser, so your text never leaves your device at any point.'
    ];
    const ZH = [
      '打字速度的提升来自稳定的节奏，而不是一时的爆发。',
      '这个测试完全在浏览器本地运行，你输入的内容不会离开这台设备。',
      '中文输入法的速度与准确率同样重要，先求准，再求快。',
      '保持手腕放松，眼睛看屏幕，不要低头看键盘。'
    ];
    const CODE = [
      'const sum = (a, b) => a + b; console.log(sum(2, 3));',
      'for (let i = 0; i < 10; i++) { console.log(i * i); }'
    ];
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="scorebar" style="margin-bottom:10px">
          <span>WPM <b id="tyWpm">0</b></span><span>CPM <b id="tyCpm">0</b></span>
          <span>准确率 <b id="tyAcc">100%</b></span><span>时间 <b id="tyTime">0.0s</b></span>
        </div>
        <div id="tyText" style="font-size:19px;line-height:1.9;background:#141414;border:1px solid #242424;border-radius:12px;padding:18px;font-family:var(--mono);min-height:150px;letter-spacing:.2px"></div>
        <textarea id="tyInput" placeholder="在这里开始打字…（内容不会离开你的设备）" style="margin-top:12px;min-height:110px"></textarea>
        <div class="resultbox" id="tyResult" style="display:none"></div>
      </div>
      ${paneBox('打字测试', '英文 / 中文 / 代码三种文本，实时统计 WPM、CPM 与准确率，错误高亮。',
      `<div class="plabel">文本类型</div>${TUI.sel('tyMode', [{ v: 'en', t: '英文段落' }, { v: 'zh', t: '中文句子' }, { v: 'code', t: '代码片段' }], 'en')}
        <div class="plabel">限时（秒，0 = 不限）</div>${TUI.range('tyLimit', 0, 180, 0, 10)}
        <div class="plabel">难度</div>${TUI.chk('tyPunct', '包含标点与大小写', true)}
        ${ctrlRow()}
        <div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="tyCsv">导出本次结果</button></div>
        <div class="runnote">WPM = 正确字符数 / 5 / 分钟；CPM = 正确字符数 / 分钟。</div>`)}
    </div>`;
    let target = '', chars = [], typed = '', startT = 0, tick = null, finished = false, errors = 0, correct = 0;
    function pick() {
      const m = $('#tyMode').value;
      const pool = m === 'zh' ? ZH : m === 'code' ? CODE : EN;
      target = pool[ri(0, pool.length - 1)];
      if (!$('#tyPunct').classList.contains('on')) target = target.replace(/[.,;:!?'"()\-]/g, '');
      chars = target.split('');
      typed = ''; startT = 0; finished = false; errors = 0; correct = 0;
      $('#tyResult').style.display = 'none';
      $('#tyInput').value = '';
      render();
      $('#tyWpm').textContent = '0'; $('#tyCpm').textContent = '0'; $('#tyAcc').textContent = '100%'; $('#tyTime').textContent = '0.0s';
    }
    function render() {
      $('#tyText').innerHTML = chars.map((c, i) => {
        let col = '#6b6b6b';
        if (i < typed.length) col = typed[i] === c ? '#d7f452' : '#ff6b6b';
        else if (i === typed.length) col = '#ffffff';
        const bg = i === typed.length ? 'rgba(215,244,82,.14)' : 'transparent';
        return `<span style="color:${col};background:${bg};border-radius:3px">${esc(c)}</span>`;
      }).join('');
    }
    function stats() {
      const el2 = (performance.now() - startT) / 1000;
      const mins = el2 / 60;
      const wpm = mins > 0 ? (correct / 5 / mins) : 0;
      const cpm = mins > 0 ? correct / mins : 0;
      const total = typed.length || 1;
      $('#tyWpm').textContent = Math.round(wpm);
      $('#tyCpm').textContent = Math.round(cpm);
      $('#tyAcc').textContent = Math.round(100 - errors / total * 100) + '%';
      $('#tyTime').textContent = el2.toFixed(1) + 's';
      return { el: el2, wpm: wpm, cpm: cpm, acc: Math.round(100 - errors / total * 100) };
    }
    function finish() {
      if (finished) return;
      finished = true;
      clearInterval(tick);
      const s = stats();
      $('#tyResult').style.display = 'block';
      $('#tyResult').innerHTML = `<div class="row"><span>用时</span><b>${s.el.toFixed(1)} 秒</b></div>
        <div class="row"><span>速度</span><b>${Math.round(s.wpm)} WPM · ${Math.round(s.cpm)} CPM</b></div>
        <div class="row"><span>准确率</span><b>${s.acc}%</b></div>
        <div class="row"><span>错误字符</span><b>${errors}</b></div>
        <div class="row"><span>正确字符</span><b>${correct} / ${chars.length}</b></div>`;
      tone(880, 0.12, 'triangle', 0.16); tone(1180, 0.16, 'triangle', 0.14, 0.12);
    }
    $('#tyInput').addEventListener('input', () => {
      if (finished) return;
      typed = $('#tyInput').value;
      if (!startT) { startT = performance.now(); tick = setInterval(() => { if (!finished) { stats(); const lim = +$('#tyLimit').value; if (lim > 0 && (performance.now() - startT) / 1000 >= lim) finish(); } }, 200); onClean(() => clearInterval(tick)); }
      errors = 0; correct = 0;
      for (let i = 0; i < typed.length && i < chars.length; i++) { if (typed[i] === chars[i]) correct++; else errors++; }
      render(); stats();
      if (typed.length >= chars.length) finish();
    });
    $('#tyCsv').addEventListener('click', () => {
      const s = finished ? stats() : { el: 0, wpm: 0, cpm: 0, acc: 0 };
      downloadText('typing-test.csv', toCSV([['mode', 'seconds', 'wpm', 'cpm', 'accuracy_percent', 'errors'], [$('#tyMode').value, s.el.toFixed(2), Math.round(s.wpm), Math.round(s.cpm), s.acc, errors]]), 'text/csv;charset=utf-8');
    });
    $('#tyMode').addEventListener('change', pick);
    bindChk('#tyPunct', () => pick());
    bindRange('#tyLimit', () => { });
    bindCtrl({ start: () => { pick(); $('#tyInput').focus(); }, pause: () => { }, reset: pick });
    ctlEl('#gStart').textContent = '换一段文本';
    ctlEl('#gPause').style.display = 'none';
    ctlEl('#gReset').textContent = '重新开始';
    pick();
  };

  /* ---------------- 6502 汇编器 + 模拟器 ---------------- */
  const CPU6502 = (function () {
    // 助记符 → { 寻址模式: 操作码 }（本引擎真实支持的一组 6502 指令）
    const OPCODES = {
      LDA: { imm: 0xA9, zp: 0xA5, zpx: 0xB5, abs: 0xAD, absx: 0xBD, absy: 0xB9, indx: 0xA1, indy: 0xB1 },
      LDX: { imm: 0xA2, zp: 0xA6, zpy: 0xB6, abs: 0xAE, absy: 0xBE },
      LDY: { imm: 0xA0, zp: 0xA4, zpx: 0xB4, abs: 0xAC, absx: 0xBC },
      STA: { zp: 0x85, zpx: 0x95, abs: 0x8D, absx: 0x9D, absy: 0x99, indx: 0x81, indy: 0x91 },
      STX: { zp: 0x86, zpy: 0x96, abs: 0x8E },
      STY: { zp: 0x84, zpx: 0x94, abs: 0x8C },
      ADC: { imm: 0x69, zp: 0x65, zpx: 0x75, abs: 0x6D, absx: 0x7D, absy: 0x79, indx: 0x61, indy: 0x71 },
      SBC: { imm: 0xE9, zp: 0xE5, zpx: 0xF5, abs: 0xED, absx: 0xFD, absy: 0xF9, indx: 0xE1, indy: 0xF1 },
      AND: { imm: 0x29, zp: 0x25, zpx: 0x35, abs: 0x2D, absx: 0x3D, absy: 0x39, indx: 0x21, indy: 0x31 },
      ORA: { imm: 0x09, zp: 0x05, zpx: 0x15, abs: 0x0D, absx: 0x1D, absy: 0x19, indx: 0x01, indy: 0x11 },
      EOR: { imm: 0x49, zp: 0x45, zpx: 0x55, abs: 0x4D, absx: 0x5D, absy: 0x59, indx: 0x41, indy: 0x51 },
      CMP: { imm: 0xC9, zp: 0xC5, zpx: 0xD5, abs: 0xCD, absx: 0xDD, absy: 0xD9, indx: 0xC1, indy: 0xD1 },
      CPX: { imm: 0xE0, zp: 0xE4, abs: 0xEC },
      CPY: { imm: 0xC0, zp: 0xC4, abs: 0xCC },
      BIT: { zp: 0x24, abs: 0x2C },
      INC: { zp: 0xE6, zpx: 0xF6, abs: 0xEE, absx: 0xFE },
      DEC: { zp: 0xC6, zpx: 0xD6, abs: 0xCE, absx: 0xDE },
      ASL: { acc: 0x0A, zp: 0x06, zpx: 0x16, abs: 0x0E, absx: 0x1E },
      LSR: { acc: 0x4A, zp: 0x46, zpx: 0x56, abs: 0x4E, absx: 0x5E },
      ROL: { acc: 0x2A, zp: 0x26, zpx: 0x36, abs: 0x2E, absx: 0x3E },
      ROR: { acc: 0x6A, zp: 0x66, zpx: 0x76, abs: 0x6E, absx: 0x7E },
      JMP: { abs: 0x4C, ind: 0x6C },
      JSR: { abs: 0x20 },
      BEQ: { rel: 0xF0 }, BNE: { rel: 0xD0 }, BCC: { rel: 0x90 }, BCS: { rel: 0xB0 },
      BPL: { rel: 0x10 }, BMI: { rel: 0x30 }, BVC: { rel: 0x50 }, BVS: { rel: 0x70 },
      TAX: { imp: 0xAA }, TAY: { imp: 0xA8 }, TXA: { imp: 0x8A }, TYA: { imp: 0x98 },
      TSX: { imp: 0xBA }, TXS: { imp: 0x9A },
      INX: { imp: 0xE8 }, INY: { imp: 0xC8 }, DEX: { imp: 0xCA }, DEY: { imp: 0x88 },
      PHA: { imp: 0x48 }, PLA: { imp: 0x68 }, PHP: { imp: 0x08 }, PLP: { imp: 0x28 },
      CLC: { imp: 0x18 }, SEC: { imp: 0x38 }, CLI: { imp: 0x58 }, SEI: { imp: 0x78 },
      CLV: { imp: 0xB8 }, CLD: { imp: 0xD8 }, SED: { imp: 0xF8 },
      RTS: { imp: 0x60 }, RTI: { imp: 0x40 }, BRK: { imp: 0x00 }, NOP: { imp: 0xEA }
    };
    const BY_OPCODE = {};
    Object.keys(OPCODES).forEach(m => Object.keys(OPCODES[m]).forEach(mode => { BY_OPCODE[OPCODES[m][mode]] = { m: m, mode: mode }; }));
    let COUNT = 0; Object.keys(OPCODES).forEach(m => { COUNT += Object.keys(OPCODES[m]).length; });
    function parseImm(t) {
      t = t.trim();
      if (/^\$[0-9a-f]+$/i.test(t)) return parseInt(t.slice(1), 16);
      if (/^%[01]+$/.test(t)) return parseInt(t.slice(1), 2);
      if (/^0x[0-9a-f]+$/i.test(t)) return parseInt(t.slice(2), 16);
      if (/^-?\d+$/.test(t)) return parseInt(t, 10);
      return null;
    }
    function assemble(src, org) {
      org = org || 0x0600;
      const errors = [], symbols = {}, lines = [];
      const raw = String(src).split(/\r?\n/);
      // 第一遍：收集标签
      let pc = org;
      const parsed = raw.map((line, ln) => {
        let s = line.replace(/;.*$/, '').trim();
        let label = null;
        const lm = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(s);
        if (lm) { label = lm[1]; symbols[label] = pc; s = s.slice(lm[0].length).trim(); }
        if (!s) return null;
        const parts = s.split(/\s+/);
        const mnem = parts[0].toUpperCase();
        const operand = parts.slice(1).join(' ');
        let size = 1;
        if (!(mnem in OPCODES) && !['DB', 'BYTE', '*=', 'ORG', 'EQU'].includes(mnem)) { errors.push('第 ' + (ln + 1) + ' 行：未知助记符 ' + mnem); }
        else {
          if (mnem === 'DB' || mnem === 'BYTE') {
            size = operand.split(',').length;
          } else if (mnem === '*=' || mnem === 'ORG') {
            const v = parseImm(operand); if (v == null) errors.push('第 ' + (ln + 1) + ' 行：ORG 需要一个数值'); else { pc = v; return { ln: ln, label: label, mnem: mnem, operand: operand, addr: pc, size: 0 }; }
          } else {
            const mode = detectMode(operand, OPCODES[mnem]);
            if (!mode) errors.push('第 ' + (ln + 1) + ' 行：' + mnem + ' 不支持该寻址方式「' + operand + '」');
            else size = (mode === 'imp' || mode === 'acc') ? 1 : (mode === 'imm' || mode === 'zp' || mode === 'zpx' || mode === 'zpy' || mode === 'indx' || mode === 'indy' || mode === 'rel') ? 2 : 3;
          }
        }
        const rec = { ln: ln, label: label, mnem: mnem, operand: operand, addr: pc, size: size };
        pc += size;
        return rec;
      }).filter(Boolean);
      // 第二遍：生成机器码
      const bytes = [];
      let cur = org;
      parsed.forEach(rec => {
        if (rec.mnem === '*=' || rec.mnem === 'ORG') { while (cur < rec.addr) { bytes.push(0); cur++; } return; }
        if (rec.mnem === 'DB' || rec.mnem === 'BYTE') {
          rec.operand.split(',').forEach(t => { const v = parseImm(t) != null ? parseImm(t) : symbols[t.trim()]; bytes.push(v == null ? 0 : v & 0xFF); cur++; });
          return;
        }
        const table = OPCODES[rec.mnem];
        if (!table) { errors.push('第 ' + (rec.ln + 1) + ' 行：未知指令 ' + rec.mnem); bytes.push(0xEA); cur++; return; }
        const mode = detectMode(rec.operand, table);
        if (!mode) { bytes.push(0xEA); cur++; return; }
        const op = table[mode];
        bytes.push(op); cur++;
        const val = resolve(rec.operand, mode, cur, org, symbols);
        if (val == null) { errors.push('第 ' + (rec.ln + 1) + ' 行：无法解析操作数 ' + rec.operand); }
        const v = val == null ? 0 : val;
        if (mode === 'imp' || mode === 'acc') return;
        if (mode === 'rel') { bytes.push((v - (cur + 1)) & 0xFF); cur++; return; }
        if (mode === 'zp' || mode === 'zpx' || mode === 'zpy' || mode === 'indx' || mode === 'indy' || mode === 'imm') { bytes.push(v & 0xFF); cur++; }
        else { bytes.push(v & 0xFF); bytes.push((v >> 8) & 0xFF); cur += 2; }
      });
      lines.push('; 目标地址 $' + org.toString(16).toUpperCase().padStart(4, '0') + '，共 ' + bytes.length + ' 字节');
      return { ok: errors.length === 0, bytes: bytes, errors: errors, symbols: symbols, org: org };
    }
    function detectMode(operand, table) {
      table = table || {};
      const o = String(operand).trim();
      if (!o) return table.imp != null ? 'imp' : (table.acc != null ? 'acc' : null);
      if (o.toUpperCase() === 'A' && table.acc != null) return 'acc';
      if (o[0] === '#') return table.imm != null ? 'imm' : null;
      let m = /^\((.+),\s*[Xx]\)$/.exec(o); if (m && table.indx != null) return 'indx';
      m = /^\((.+)\)\s*,\s*[Yy]$/.exec(o); if (m && table.indy != null) return 'indy';
      m = /^\((.+)\)$/.exec(o); if (m && table.ind != null) return 'ind';
      m = /^(.+),\s*[Xx]$/.exec(o); if (m) { const inner = m[1].trim(); const v = parseImm(inner) != null ? parseImm(inner) : null; if (table.absx != null && (v == null || v > 0xFF)) return 'absx'; if (table.zpx != null) return 'zpx'; if (table.absx != null) return 'absx'; }
      m = /^(.+),\s*[Yy]$/.exec(o); if (m) { const inner = m[1].trim(); const v = parseImm(inner) != null ? parseImm(inner) : null; if (table.absy != null && (v == null || v > 0xFF)) return 'absy'; if (table.zpy != null) return 'zpy'; if (table.absy != null) return 'absy'; }
      if (table.rel != null) return 'rel';
      const v = parseImm(o);
      if (table.zp != null && v != null && v <= 0xFF) return 'zp';
      if (table.abs != null) return 'abs';
      if (table.zp != null) return 'zp';
      return null;
    }
    function resolve(operand, mode, cur, org, symbols) {
      let o = String(operand).trim();
      if (o[0] === '#') o = o.slice(1).trim();
      let m = /^\((.+),\s*[Xx]\)$/.exec(o); if (m) o = m[1].trim();
      m = /^\((.+)\)\s*,\s*[Yy]$/.exec(o); if (m) o = m[1].trim();
      m = /^\((.+)\)$/.exec(o); if (m) o = m[1].trim();
      m = /^(.+),\s*[XxYy]$/.exec(o); if (m) o = m[1].trim();
      const v = parseImm(o);
      if (v != null) return v;
      const key = o.toUpperCase();
      if (symbols[key] != null) return symbols[key];
      if (symbols[o] != null) return symbols[o];
      return null;
    }
    /* ---- 模拟器：由 BY_OPCODE 反查助记符后统一执行 ---- */
    function CPU() {
      const mem = new Uint8Array(65536);
      const s = { a: 0, x: 0, y: 0, sp: 0xFD, pc: 0x0600, p: 0x24, cyc: 0, brk: false };
      function setFlag(f, v) { if (v) s.p |= f; else s.p &= ~f; }
      function setZN(v) { v &= 0xFF; setFlag(0x80, v & 0x80); setFlag(0x02, v === 0); return v; }
      function rd(a) { return mem[a & 0xFFFF]; }
      function wr(a, v) { mem[a & 0xFFFF] = v & 0xFF; }
      function rd16(a) { return rd(a) | (rd((a + 1) & 0xFFFF) << 8); }
      function push(v) { wr(0x100 + s.sp, v); s.sp = (s.sp - 1) & 0xFF; }
      function pop() { s.sp = (s.sp + 1) & 0xFF; return rd(0x100 + s.sp); }
      function operandAddr(mode) {
        const p = s.pc;
        switch (mode) {
          case 'imm': return { v: rd(p + 1), addr: null, next: p + 2 };
          case 'zp': { const a = rd(p + 1); return { addr: a, next: p + 2 }; }
          case 'zpx': { const a = (rd(p + 1) + s.x) & 0xFF; return { addr: a, next: p + 2 }; }
          case 'zpy': { const a = (rd(p + 1) + s.y) & 0xFF; return { addr: a, next: p + 2 }; }
          case 'abs': { const a = rd16(p + 1); return { addr: a, next: p + 3 }; }
          case 'absx': { const a = (rd16(p + 1) + s.x) & 0xFFFF; return { addr: a, next: p + 3 }; }
          case 'absy': { const a = (rd16(p + 1) + s.y) & 0xFFFF; return { addr: a, next: p + 3 }; }
          case 'ind': { const a = rd16(p + 1); const hi = (a & 0xFF00) | ((a + 1) & 0xFF); return { addr: rd(a) | (rd(hi) << 8), next: p + 3 }; }
          case 'indx': { const a = (rd(p + 1) + s.x) & 0xFF; return { addr: rd(a) | (rd((a + 1) & 0xFF) << 8), next: p + 2 }; }
          case 'indy': { const a = rd(p + 1); const base = rd(a) | (rd((a + 1) & 0xFF) << 8); return { addr: (base + s.y) & 0xFFFF, next: p + 2 }; }
          case 'rel': { const off = rd(p + 1); return { v: off < 128 ? off : off - 256, next: p + 2 }; }
          default: return { next: p + 1 };
        }
      }
      function step() {
        if (s.brk) return false;
        const op = rd(s.pc);
        const info = BY_OPCODE[op];
        if (!info) { s.brk = true; return false; }
        const o = operandAddr(info.mode);
        let v;
        switch (info.m) {
          case 'LDA': v = info.mode === 'imm' ? o.v : rd(o.addr); s.a = setZN(v); break;
          case 'LDX': v = info.mode === 'imm' ? o.v : rd(o.addr); s.x = setZN(v); break;
          case 'LDY': v = info.mode === 'imm' ? o.v : rd(o.addr); s.y = setZN(v); break;
          case 'STA': wr(o.addr, s.a); break;
          case 'STX': wr(o.addr, s.x); break;
          case 'STY': wr(o.addr, s.y); break;
          case 'ADC': {
            const m = info.mode === 'imm' ? o.v : rd(o.addr);
            const c = (s.p & 0x01) ? 1 : 0;
            const r = s.a + m + c;
            setFlag(0x01, r > 0xFF);
            setFlag(0x40, (~(s.a ^ m) & (s.a ^ r) & 0x80) !== 0);
            s.a = setZN(r & 0xFF); break;
          }
          case 'SBC': {
            const m = info.mode === 'imm' ? o.v : rd(o.addr);
            const c = (s.p & 0x01) ? 1 : 0;
            const r = s.a - m - (1 - c);
            setFlag(0x01, r >= 0);
            setFlag(0x40, ((s.a ^ m) & (s.a ^ r) & 0x80) !== 0);
            s.a = setZN(r & 0xFF); break;
          }
          case 'AND': s.a = setZN(s.a & (info.mode === 'imm' ? o.v : rd(o.addr))); break;
          case 'ORA': s.a = setZN(s.a | (info.mode === 'imm' ? o.v : rd(o.addr))); break;
          case 'EOR': s.a = setZN(s.a ^ (info.mode === 'imm' ? o.v : rd(o.addr))); break;
          case 'CMP': { const m = info.mode === 'imm' ? o.v : rd(o.addr); setFlag(0x01, s.a >= m); setZN((s.a - m) & 0xFF); break; }
          case 'CPX': { const m = info.mode === 'imm' ? o.v : rd(o.addr); setFlag(0x01, s.x >= m); setZN((s.x - m) & 0xFF); break; }
          case 'CPY': { const m = info.mode === 'imm' ? o.v : rd(o.addr); setFlag(0x01, s.y >= m); setZN((s.y - m) & 0xFF); break; }
          case 'BIT': { const m = rd(o.addr); setFlag(0x80, m & 0x80); setFlag(0x40, m & 0x40); setFlag(0x02, (s.a & m) === 0); break; }
          case 'INC': { const m = (rd(o.addr) + 1) & 0xFF; wr(o.addr, m); setZN(m); break; }
          case 'DEC': { const m = (rd(o.addr) - 1) & 0xFF; wr(o.addr, m); setZN(m); break; }
          case 'INX': s.x = setZN(s.x + 1); break;
          case 'INY': s.y = setZN(s.y + 1); break;
          case 'DEX': s.x = setZN(s.x - 1); break;
          case 'DEY': s.y = setZN(s.y - 1); break;
          case 'ASL': case 'LSR': case 'ROL': case 'ROR': {
            const isAcc = info.mode === 'acc';
            const src = isAcc ? s.a : rd(o.addr);
            let res;
            if (info.m === 'ASL') { setFlag(0x01, src & 0x80); res = (src << 1) & 0xFF; }
            else if (info.m === 'LSR') { setFlag(0x01, src & 1); res = (src >> 1) & 0xFF; }
            else if (info.m === 'ROL') { const c = (s.p & 1); setFlag(0x01, src & 0x80); res = ((src << 1) | c) & 0xFF; }
            else { const c = (s.p & 1); setFlag(0x01, src & 1); res = ((src >> 1) | (c << 7)) & 0xFF; }
            if (isAcc) s.a = setZN(res); else { wr(o.addr, res); setZN(res); }
            break;
          }
          case 'JMP': s.pc = o.addr; s.cyc++; return true;
          case 'JSR': { const ret = (o.next - 1) & 0xFFFF; push((ret >> 8) & 0xFF); push(ret & 0xFF); s.pc = o.addr; s.cyc += 6; return true; }
          case 'RTS': { const lo = pop(), hi = pop(); s.pc = ((hi << 8 | lo) + 1) & 0xFFFF; s.cyc += 6; return true; }
          case 'RTI': { s.p = (pop() | 0x20) & 0xFF; const lo = pop(), hi = pop(); s.pc = (hi << 8 | lo) & 0xFFFF; s.cyc += 6; return true; }
          case 'BEQ': if (s.p & 0x02) { s.pc = (o.next + o.v) & 0xFFFF; s.cyc++; } break;
          case 'BNE': if (!(s.p & 0x02)) { s.pc = (o.next + o.v) & 0xFFFF; s.cyc++; } break;
          case 'BCC': if (!(s.p & 0x01)) { s.pc = (o.next + o.v) & 0xFFFF; s.cyc++; } break;
          case 'BCS': if (s.p & 0x01) { s.pc = (o.next + o.v) & 0xFFFF; s.cyc++; } break;
          case 'BPL': if (!(s.p & 0x80)) { s.pc = (o.next + o.v) & 0xFFFF; s.cyc++; } break;
          case 'BMI': if (s.p & 0x80) { s.pc = (o.next + o.v) & 0xFFFF; s.cyc++; } break;
          case 'BVC': if (!(s.p & 0x40)) { s.pc = (o.next + o.v) & 0xFFFF; s.cyc++; } break;
          case 'BVS': if (s.p & 0x40) { s.pc = (o.next + o.v) & 0xFFFF; s.cyc++; } break;
          case 'TAX': s.x = setZN(s.a); break;
          case 'TAY': s.y = setZN(s.a); break;
          case 'TXA': s.a = setZN(s.x); break;
          case 'TYA': s.a = setZN(s.y); break;
          case 'TSX': s.x = setZN(s.sp); break;
          case 'TXS': s.sp = s.x; break;
          case 'PHA': push(s.a); break;
          case 'PLA': s.a = setZN(pop()); break;
          case 'PHP': push(s.p | 0x30); break;
          case 'PLP': s.p = (pop() | 0x20) & 0xFF; break;
          case 'CLC': setFlag(0x01, 0); break;
          case 'SEC': setFlag(0x01, 1); break;
          case 'CLI': setFlag(0x04, 0); break;
          case 'SEI': setFlag(0x04, 1); break;
          case 'CLV': setFlag(0x40, 0); break;
          case 'CLD': setFlag(0x08, 0); break;
          case 'SED': setFlag(0x08, 1); break;
          case 'BRK': s.brk = true; return false;
          case 'NOP': break;
          default: break;
        }
        s.pc = o.next; s.cyc++;
        return true;
      }
      return { s: s, mem: mem, step: step, rd: rd, wr: wr,
        load: function (bytes, org) { for (let i = 0; i < bytes.length; i++) mem[(org + i) & 0xFFFF] = bytes[i]; s.pc = org; s.brk = false; },
        flags: function () { return { N: !!(s.p & 0x80), V: !!(s.p & 0x40), D: !!(s.p & 0x08), I: !!(s.p & 0x04), Z: !!(s.p & 0x02), C: !!(s.p & 0x01) }; } };
    }
    return { assemble: assemble, CPU: CPU, OPCODES: OPCODES, BY_OPCODE: BY_OPCODE, COUNT: COUNT };
  })();
  window.__wsftInternals = window.__wsftInternals || {};
  window.__wsftInternals.cpu6502 = CPU6502;

  const SAMPLE_6502 = `; 计算 1..10 的和，结果放在 $10/$11
        *=$0600
        LDA #0
        STA $10
        STA $11
        LDX #10
LOOP:   TXA
        CLC
        ADC $10
        STA $10
        BCC NOCARRY
        INC $11
NOCARRY:
        DEX
        BNE LOOP
        BRK`;

  function cpu6502UI(host, slug) {
    const isAsm = slug === '6502-assembler';
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        ${TUI.field('源代码（支持 ' + CPU6502.COUNT + ' 条操作的寻址组合）', TUI.area('csSrc', SAMPLE_6502, '', 16))}
        <div id="csView" style="margin-top:14px"></div>
      </div>
      ${paneBox(isAsm ? '6502 汇编器' : '6502 模拟器', '真实的两遍汇编（标签、各种寻址模式）+ 逐指令解释器。这里只实现了 6502 常用的一部分指令，未实现中断、PPU/APU 等外设。',
      `<div class="shapes" style="margin-top:12px;gap:8px">
          <button class="btn-lime btn-sm" id="csAsm">汇编</button>
          <button class="btn-ghost btn-sm" id="csRun">连续运行</button>
          <button class="btn-ghost btn-sm" id="csStep">单步</button>
          <button class="btn-ghost btn-sm" id="csReset">复位</button>
        </div>
        <div class="outbox" id="csOut">点击「汇编」查看机器码。</div>
        <div class="plabel">已支持指令（部分）</div>
        <div class="note">LDA/LDX/LDY/STA/STX/STY · ADC/SBC/AND/ORA/EOR/CMP/CPX/CPY/BIT · INC/DEC/INX/INY/DEX/DEY/ASL/LSR/ROL/ROR · JMP/JSR/RTS/RTI/BRK/NOP · 分支 BEQ/BNE/BCC/BCS/BPL/BMI/BVC/BVS · 寄存器传送与栈操作 · 标志位 CLC/SEC/CLI/SEI/CLV/CLD/SED。
        <b>未实现</b>：中断/复位向量、十进制模式精确行为、以及全部外设。</div>`)}
    </div>`;
    let cpu = null, last = null;
    function doAsm() {
      const r = CPU6502.assemble($('#csSrc').value, 0x0600);
      last = r;
      const hex = r.bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
      $('#csOut').innerHTML = r.ok ? '汇编成功：<b>' + r.bytes.length + '</b> 字节，装载到 $0600。' : '<b style="color:#ff6b6b">' + r.errors.length + ' 个错误</b><br>' + r.errors.join('<br>');
      $('#csView').innerHTML = `<div class="plabel">机器码</div><div class="ioout" style="min-height:auto;max-height:180px">${esc(hex)}</div>
        <div class="plabel">符号表</div><div class="ioout" style="min-height:auto;max-height:140px">${Object.keys(r.symbols).map(k => k + ' = $' + r.symbols[k].toString(16).toUpperCase().padStart(4, '0')).join('<br>') || '（无标签）'}</div>`;
    }
    function view(trace) {
      if (!cpu) return;
      const s = cpu.s, f = cpu.flags();
      $('#csView').innerHTML = `<div class="plabel">寄存器</div>
        <div class="statgrid">
          <div class="stat"><b>$${s.a.toString(16).toUpperCase().padStart(2, '0')}</b><span>A 累加器</span></div>
          <div class="stat"><b>$${s.x.toString(16).toUpperCase().padStart(2, '0')}</b><span>X 索引</span></div>
          <div class="stat"><b>$${s.y.toString(16).toUpperCase().padStart(2, '0')}</b><span>Y 索引</span></div>
          <div class="stat"><b>$${s.pc.toString(16).toUpperCase().padStart(4, '0')}</b><span>PC</span></div>
          <div class="stat"><b>$${s.sp.toString(16).toUpperCase().padStart(2, '0')}</b><span>SP</span></div>
          <div class="stat"><b>${['N', 'V', '-', 'B', 'D', 'I', 'Z', 'C'].map(k => k === '-' ? '·' : (f[k] ? k : k.toLowerCase())).join('')}</b><span>标志位 NV-BDIZC</span></div>
          <div class="stat"><b>${s.cyc}</b><span>已执行指令</span></div>
        </div>
        <div class="plabel">零页内存（$00-$7F）</div>
        <div class="ioout" style="min-height:auto;font-size:11.5px;line-height:1.6">${Array.from({ length: 8 }, (_, r) => '$' + (r * 16).toString(16).toUpperCase().padStart(2, '0') + ': ' + Array.from({ length: 16 }, (_, c) => cpu.rd(r * 16 + c).toString(16).toUpperCase().padStart(2, '0')).join(' ')).join('<br>')}</div>
        ${trace ? '<div class="plabel">最近执行</div><div class="ioout" style="min-height:auto;font-size:12px">' + trace.join('<br>') + '</div>' : ''}`;
    }
    function ensure() {
      if (!last || !last.ok) doAsm();
      cpu = CPU6502.CPU();
      cpu.load(last.bytes, 0x0600);
      cpu.s.pc = 0x0600;
    }
    $('#csAsm').addEventListener('click', () => { doAsm(); ensure(); view(); });
    $('#csStep').addEventListener('click', () => { if (!cpu) ensure(); cpu.step(); view(); });
    $('#csReset').addEventListener('click', () => { cpu = null; doAsm(); ensure(); view(); $('#csOut').textContent = '已复位到 $0600。'; });
    $('#csRun').addEventListener('click', () => {
      if (!cpu) ensure();
      const trace = [];
      let n = 0;
      while (n < 200000) {
        const pc = cpu.s.pc;
        const op = cpu.rd(pc);
        const info = CPU6502.BY_OPCODE[op];
        trace.unshift('$' + pc.toString(16).toUpperCase().padStart(4, '0') + '  ' + op.toString(16).toUpperCase().padStart(2, '0') + '  ' + (info ? info.m + ' (' + info.mode + ')' : '???'));
        if (trace.length > 14) trace.pop();
        if (!cpu.step()) break;
        n++;
      }
      view(trace);
      $('#csOut').innerHTML = '运行结束：执行了 <b>' + cpu.s.cyc + '</b> 条指令' + (cpu.s.brk ? '（遇到 BRK 停止）' : '（达到 200000 条上限，可能有死循环）') + '。';
    });
    doAsm(); ensure(); view();
    bindCtrl({ start: () => { const b = $('#csRun'); if (b) b.click(); }, pause: () => { }, reset: () => { cpu = null; ensure(); view(); } });
    ctlEl('#gStart').textContent = '运行';
    ctlEl('#gPause').style.display = 'none';
    ctlEl('#gReset').textContent = '复位';
  }
  G['6502-assembler'] = cpu6502UI;
  G['6502-emulator'] = cpu6502UI;

  /* ---------------- RISC-V（RV32I 子集） ---------------- */
  const RISCV = (function () {
    const R = { zero: 0, ra: 1, sp: 2, gp: 3, tp: 4, t0: 5, t1: 6, t2: 7, s0: 8, fp: 8, s1: 9, a0: 10, a1: 11, a2: 12, a3: 13, a4: 14, a5: 15, a6: 16, a7: 17, s2: 18, s3: 19, s4: 20, s5: 21, s6: 22, s7: 23, s8: 24, s9: 25, s10: 26, s11: 27, t3: 28, t4: 29, t5: 30, t6: 31 };
    function reg(t) {
      t = String(t).trim().replace(/^%/, '');
      if (/^x\d+$/.test(t)) return +t.slice(1);
      if (R[t] != null) return R[t];
      return null;
    }
    const OPS = {
      add: 'R', sub: 'R', sll: 'R', slt: 'R', sltu: 'R', xor: 'R', srl: 'R', sra: 'R', or: 'R', and: 'R',
      addi: 'I', slti: 'I', sltiu: 'I', xori: 'I', ori: 'I', andi: 'I', slli: 'I', srli: 'I', srai: 'I',
      lw: 'IL', lh: 'IL', lb: 'IL', lbu: 'IL', lhu: 'IL', sw: 'S', sh: 'S', sb: 'S',
      beq: 'B', bne: 'B', blt: 'B', bge: 'B', bltu: 'B', bgeu: 'B',
      jal: 'J', jalr: 'IL', lui: 'U', auipc: 'U', ecall: 'N', nop: 'N', ret: 'N', mv: 'MV', li: 'LI', j: 'J1'
    };
    const F3 = { add: 0, sub: 0, sll: 1, slt: 2, sltu: 3, xor: 4, srl: 5, sra: 5, or: 6, and: 7, addi: 0, slti: 2, sltiu: 3, xori: 4, ori: 6, andi: 7, slli: 1, srli: 5, srai: 5, lw: 2, lh: 1, lb: 0, lbu: 4, lhu: 5, sw: 2, sh: 1, sb: 0, beq: 0, bne: 1, blt: 4, bge: 5, bltu: 6, bgeu: 7, jalr: 0 };
    function num(t) {
      t = String(t).trim();
      if (/^-?0x[0-9a-f]+$/i.test(t)) return parseInt(t, 16);
      if (/^-?\d+$/.test(t)) return parseInt(t, 10);
      return null;
    }
    function assemble(src, org) {
      org = org || 0x1000;
      const errors = [], symbols = {};
      const raw = String(src).split(/\r?\n/);
      let pc = org;
      const prog = [];
      raw.forEach((line, ln) => {
        let s = line.replace(/[#;].*$/, '').trim();
        if (!s) return;
        const lm = /^([A-Za-z_.$][\w.$]*)\s*:/.exec(s);
        if (lm) { symbols[lm[1]] = pc; s = s.slice(lm[0].length).trim(); if (!s) return; }
        const i = s.indexOf(' ');
        const mnem = (i < 0 ? s : s.slice(0, i)).toLowerCase();
        const args = i < 0 ? '' : s.slice(i + 1).trim();
        if (!OPS[mnem]) { errors.push('第 ' + (ln + 1) + ' 行：未实现的指令 ' + mnem); return; }
        prog.push({ ln: ln, mnem: mnem, args: args, addr: pc });
        pc += 4;
      });
      const bytes = [];
      const b32 = (v) => { bytes.push(v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >>> 24) & 0xFF); };
      const val = t => { const v = num(t); if (v != null) return v; const k = String(t).trim(); if (symbols[k] != null) return symbols[k]; return null; };
      prog.forEach(p => {
        const a = p.args.split(',').map(x => x.trim()).filter(x => x !== '');
        const m = p.mnem;
        let code = null;
        const enc = (opc, f3, f7, rd, rs1, rs2) => ((f7 << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | opc) >>> 0;
        if (OPS[m] === 'R') { const rd = reg(a[0]), rs1 = reg(a[1]), rs2 = reg(a[2]); if (rd == null || rs1 == null || rs2 == null) errors.push('第 ' + (p.ln + 1) + ' 行：寄存器名不对'); else code = enc(0x33, F3[m], m === 'sub' || m === 'sra' ? 0x20 : 0, rd, rs1, rs2); }
        else if (OPS[m] === 'I' || OPS[m] === 'IL') {
          const rd = reg(a[0]);
          let imm = null, rs1 = null;
          if (OPS[m] === 'IL') { const mem = /(-?\w+)?\(([^)]+)\)/.exec(p.args); if (mem) { imm = val(mem[1] || '0'); rs1 = reg(mem[2]); } }
          else { rs1 = reg(a[1]); imm = val(a[2]); }
          if (rd == null || rs1 == null || imm == null) errors.push('第 ' + (p.ln + 1) + ' 行：操作数无法解析');
          else {
            let sh = imm & 0x1F;
            if (m === 'slli' || m === 'srli' || m === 'srai') code = enc(0x13, F3[m], m === 'srai' ? 0x20 : 0, rd, rs1, sh);
            else code = enc(m === 'jalr' ? 0x67 : (['lw', 'lh', 'lb', 'lbu', 'lhu'].indexOf(m) >= 0 ? 0x03 : 0x13), F3[m], 0, rd, rs1, imm & 0xFFF);
          }
        }
        else if (OPS[m] === 'S') { const mem = /(-?\w+)?\(([^)]+)\)/.exec(p.args); const rs2 = reg(a[0]); if (!mem) errors.push('第 ' + (p.ln + 1) + ' 行：sw/sb 需要 offset(rs1) 形式'); else { const imm = val(mem[1] || '0'), rs1 = reg(mem[2]); if (imm == null || rs1 == null) errors.push('第 ' + (p.ln + 1) + ' 行：操作数无法解析'); else code = (((imm >> 5) & 0x7F) << 25 | (rs2 << 20) | (rs1 << 15) | (F3[m] << 12) | ((imm & 0x1F) << 7) | 0x23) >>> 0; } }
        else if (OPS[m] === 'B') { const rs1 = reg(a[0]), rs2 = reg(a[1]), off = val(a[2]); if (off == null) errors.push('第 ' + (p.ln + 1) + ' 行：分支目标无法解析'); else code = ((((off >> 12) & 1) << 31) | (((off >> 5) & 0x3F) << 25) | (rs2 << 20) | (rs1 << 15) | (F3[m] << 12) | (((off >> 1) & 0xF) << 8) | (((off >> 11) & 1) << 7) | 0x63) >>> 0; }
        else if (OPS[m] === 'U') { const rd = reg(a[0]), imm = val(a[1]); if (rd == null || imm == null) errors.push('第 ' + (p.ln + 1) + ' 行：操作数无法解析'); else code = (((imm & 0xFFFFF) << 12) | (rd << 7) | (m === 'lui' ? 0x37 : 0x17)) >>> 0; }
        else if (OPS[m] === 'J' || OPS[m] === 'J1') {
          let rd, target;
          if (OPS[m] === 'J1') { rd = 0; target = val(a[0]); }
          else { rd = reg(a[0]); target = val(a[1]); }
          if (target == null) { const k = String(a[a.length - 1]).trim(); target = symbols[k] != null ? symbols[k] : null; }
          if (target == null) errors.push('第 ' + (p.ln + 1) + ' 行：跳转目标无法解析');
          else { const off = target - p.addr; code = ((((off >> 20) & 1) << 31) | (((off >> 1) & 0x3FF) << 21) | (((off >> 11) & 1) << 20) | (((off >> 12) & 0xFF) << 12) | (rd << 7) | 0x6F) >>> 0; }
        }
        else if (m === 'mv') { const rd = reg(a[0]), rs = reg(a[1]); code = enc(0x13, 0, 0, rd, rs, 0); }
        else if (m === 'li') { const rd = reg(a[0]), imm = val(a[1]); if (imm == null) errors.push('第 ' + (p.ln + 1) + ' 行：li 需要立即数'); else code = enc(0x13, 0, 0, rd, 0, imm & 0xFFF); }
        else if (m === 'nop') code = 0x00000013;
        else if (m === 'ret') code = enc(0x67, 0, 0, 0, 1, 0);
        else if (m === 'ecall') code = 0x00000073;
        b32(code == null ? 0 : code);
      });
      return { ok: errors.length === 0, bytes: bytes, errors: errors, symbols: symbols, org: org, count: prog.length };
    }
    function CPU() {
      const regs = new Int32Array(32);
      const mem = new Int32Array(4096);   // 16KB，按字索引
      const st = { pc: 0x1000, cyc: 0, out: '', halted: false };
      function rdW(addr) { return mem[(addr >> 2) & 0xFFF] | 0; }
      function wrW(addr, v) { mem[(addr >> 2) & 0xFFF] = v | 0; }
      function rdB(addr) { return (mem[(addr >> 2) & 0xFFF] >> ((addr & 3) * 8)) & 0xFF; }
      function wrB(addr, v) { const i = (addr >> 2) & 0xFFF, sh = (addr & 3) * 8; mem[i] = ((mem[i] & ~(0xFF << sh)) | ((v & 0xFF) << sh)) | 0; }
      function step() {
        if (st.halted) return false;
        const pc = st.pc;
        const ins = rdW(pc);
        const opc = ins & 0x7F;
        const rd = (ins >>> 7) & 0x1F, rs1 = (ins >>> 15) & 0x1F, rs2 = (ins >>> 20) & 0x1F, f3 = (ins >>> 12) & 7;
        const immI = ins >> 20, immS = ((ins >> 25) << 5) | ((ins >>> 7) & 0x1F);
        let next = (pc + 4) | 0;
        try {
          if (opc === 0x33) {
            const v1 = regs[rs1], v2 = regs[rs2];
            let v = 0;
            if (f3 === 0 && (ins >>> 25) === 0) v = v1 + v2;
            else if (f3 === 0) v = v1 - v2;
            else if (f3 === 1) v = v1 << (v2 & 31);
            else if (f3 === 2) v = v1 < v2 ? 1 : 0;
            else if (f3 === 3) v = (v1 >>> 0) < (v2 >>> 0) ? 1 : 0;
            else if (f3 === 4) v = v1 ^ v2;
            else if (f3 === 5 && (ins >>> 25) === 0) v = v1 >>> (v2 & 31);
            else if (f3 === 5) v = v1 >> (v2 & 31);
            else if (f3 === 6) v = v1 | v2;
            else if (f3 === 7) v = v1 & v2;
            regs[rd] = v | 0;
          } else if (opc === 0x13) {
            const v1 = regs[rs1];
            let v = 0;
            if (f3 === 0) v = v1 + immI;
            else if (f3 === 1) v = v1 << (immI & 31);
            else if (f3 === 2) v = v1 < immI ? 1 : 0;
            else if (f3 === 3) v = (v1 >>> 0) < (immI >>> 0) ? 1 : 0;
            else if (f3 === 4) v = v1 ^ immI;
            else if (f3 === 5 && (immI >>> 5) === 0) v = v1 >>> (immI & 31);
            else if (f3 === 5) v = v1 >> (immI & 31);
            else if (f3 === 6) v = v1 | immI;
            else if (f3 === 7) v = v1 & immI;
            regs[rd] = v | 0;
          } else if (opc === 0x03) {
            const addr = (regs[rs1] + immI) | 0;
            if (f3 === 2) regs[rd] = rdW(addr);
            else if (f3 === 1) regs[rd] = (rdB(addr) << 24 >> 24);
            else if (f3 === 0) regs[rd] = (rdB(addr) << 24 >> 24);
            else if (f3 === 4) regs[rd] = rdB(addr);
            else if (f3 === 5) regs[rd] = (rdB(addr)) | (rdB(addr + 1) << 8);
          } else if (opc === 0x23) {
            const addr = (regs[rs1] + immS) | 0;
            if (f3 === 2) wrW(addr, regs[rs2]);
            else if (f3 === 1) { wrB(addr, regs[rs2]); wrB(addr + 1, regs[rs2] >> 8); }
            else if (f3 === 0) wrB(addr, regs[rs2]);
          } else if (opc === 0x63) {
            const immB = (((ins >> 31) & 1) << 12) | (((ins >>> 25) & 0x3F) << 5) | (((ins >>> 8) & 0xF) << 1) | (((ins >>> 7) & 1) << 11);
            const sImm = (immB << 19) >> 19;
            const a = regs[rs1], b = regs[rs2];
            let take = false;
            if (f3 === 0) take = a === b;
            else if (f3 === 1) take = a !== b;
            else if (f3 === 4) take = a < b;
            else if (f3 === 5) take = a >= b;
            else if (f3 === 6) take = (a >>> 0) < (b >>> 0);
            else if (f3 === 7) take = (a >>> 0) >= (b >>> 0);
            if (take) next = (pc + sImm) | 0;
          } else if (opc === 0x37) { regs[rd] = (ins & 0xFFFFF000) | 0; }
          else if (opc === 0x17) { regs[rd] = ((pc + (ins & 0xFFFFF000)) | 0); }
          else if (opc === 0x6F) {
            const immJ = (((ins >> 31) & 1) << 20) | (((ins >>> 12) & 0xFF) << 12) | (((ins >>> 20) & 1) << 11) | (((ins >>> 21) & 0x3FF) << 1);
            const sJ = (immJ << 11) >> 11;
            regs[rd] = next;
            next = (pc + sJ) | 0;
          } else if (opc === 0x67) { const t = (regs[rs1] + immI) & ~1; regs[rd] = next; next = t | 0; }
          else if (opc === 0x73) {
            const a7 = regs[17], a0 = regs[10];
            if (a7 === 1) st.out += a0 + '\n';
            else if (a7 === 4) { let s = '', addr = a0; for (let i = 0; i < 600; i++) { const ch = rdB(addr + i); if (!ch) break; s += String.fromCharCode(ch); } st.out += s; }
            else if (a7 === 10 || a7 === 0) { st.halted = true; return false; }
            else st.out += '[ecall a7=' + a7 + ' 未实现]\n';
          } else { st.out += '[未知指令 0x' + (ins >>> 0).toString(16) + ' @ 0x' + pc.toString(16) + ']\n'; st.halted = true; return false; }
        } catch (e) { st.out += '[执行异常 ' + e.message + ']'; st.halted = true; return false; }
        regs[0] = 0;
        st.pc = next; st.cyc++;
        return true;
      }
      return {
        regs: regs, st: st, mem: mem, step: step,
        load: function (bytes, org) { for (let i = 0; i < bytes.length; i += 4) { const w = bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24); mem[((org + i) >> 2) & 0xFFF] = w; } st.pc = org; st.halted = false; },
        wrB: wrB, rdB: rdB
      };
    }
    return { assemble: assemble, CPU: CPU, REG: R, OPS: OPS };
  })();
  window.__wsftInternals.riscv = RISCV;

  const SAMPLE_RV = `# 计算 1..10 的和并打印（a7=1 → 打印整数，a7=10 → 退出）
        li   t0, 10        # 计数
        li   t1, 0         # 累加
loop:   add  t1, t1, t0
        addi t0, t0, -1
        bne  t0, zero, loop
        mv   a0, t1
        li   a7, 1
        ecall
        li   a7, 10
        ecall`;

  function riscvUI(host, slug) {
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        ${TUI.field('RV32I 汇编源码', TUI.area('rvSrc', SAMPLE_RV, '', 14))}
        <div id="rvView" style="margin-top:14px"></div>
      </div>
      ${paneBox('RISC-V 模拟器（RV32I 子集）', '真实的 RV32I 编码 + 逐指令模拟。这里只实现了 RV32I 常用指令，没有 CSR、中断、乘除法（M 扩展）与虚拟内存。',
      `<div class="shapes" style="margin-top:12px;gap:8px">
          <button class="btn-lime btn-sm" id="rvAsm">汇编</button>
          <button class="btn-ghost btn-sm" id="rvStep">单步</button>
          <button class="btn-ghost btn-sm" id="rvRun">运行到结束</button>
          <button class="btn-ghost btn-sm" id="rvReset">复位</button>
        </div>
        <div class="outbox" id="rvOut">点击「汇编」查看机器码。</div>
        <div class="plabel">已实现</div>
        <div class="note">add/sub/and/or/xor/sll/srl/sra/slt/sltu · addi/andi/ori/xori/slti/sltiu/slli/srli/srai · lw/lh/lb/lbu/lhu/sw/sh/sb · beq/bne/blt/bge/bltu/bgeu · jal/jalr/lui/auipc/ecall（a7=1 打印整数，a7=4 打印字符串，a7=10 退出）。<br><b>未实现</b>：M/A/F/D 扩展、CSR、异常与中断、真实操作系统。</div>`)}
    </div>`;
    let cpu = null, last = null;
    function doAsm() {
      const r = RISCV.assemble($('#rvSrc').value, 0x1000);
      last = r;
      const hex = [];
      for (let i = 0; i < r.bytes.length; i += 4) {
        const w = (r.bytes[i] | (r.bytes[i + 1] << 8) | (r.bytes[i + 2] << 16) | (r.bytes[i + 3] << 24)) >>> 0;
        hex.push(w.toString(16).toUpperCase().padStart(8, '0'));
      }
      $('#rvOut').innerHTML = r.ok ? '汇编成功：<b>' + r.count + '</b> 条指令，共 ' + r.bytes.length + ' 字节。' : '<b style="color:#ff6b6b">' + r.errors.length + ' 个错误</b><br>' + r.errors.join('<br>');
      return hex;
    }
    function ensure() { if (!last || !last.ok) doAsm(); cpu = RISCV.CPU(); cpu.load(last.bytes, 0x1000); }
    const ABI = ['zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2', 's0', 's1', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6'];
    function view() {
      if (!cpu) return;
      const hex = last && last.bytes ? last.bytes.length / 4 : 0;
      $('#rvView').innerHTML = `<div class="plabel">机器码（每 4 字节一条）</div>
        <div class="ioout" style="min-height:auto;max-height:120px;font-size:12px">${(() => { const out = []; for (let i = 0; i < (last ? last.bytes.length : 0); i += 4) { const w = (last.bytes[i] | (last.bytes[i + 1] << 8) | (last.bytes[i + 2] << 16) | (last.bytes[i + 3] << 24)) >>> 0; out.push('0x' + (0x1000 + i).toString(16) + ': ' + w.toString(16).toUpperCase().padStart(8, '0')); } return out.join('<br>'); })()}</div>
        <div class="plabel">寄存器（非零）</div>
        <div class="ioout" style="min-height:auto;font-size:12px">${Array.from({ length: 32 }, (_, i) => i).filter(i => cpu.regs[i] !== 0).map(i => 'x' + i + ' (' + ABI[i] + ') = ' + cpu.regs[i] + '  [0x' + (cpu.regs[i] >>> 0).toString(16) + ']').join('<br>') || '（全部为 0）'}</div>
        <div class="plabel">状态</div>
        <div class="statgrid">
          <div class="stat"><b>0x${(cpu.st.pc >>> 0).toString(16).toUpperCase()}</b><span>PC</span></div>
          <div class="stat"><b>${cpu.st.cyc}</b><span>已执行指令</span></div>
          <div class="stat"><b>${cpu.st.halted ? '已停机' : '运行中'}</b><span>状态</span></div>
        </div>
        <div class="plabel">串口输出（ecall）</div>
        <div class="ioout" style="min-height:auto;max-height:160px">${esc(cpu.st.out || '（还没有输出）')}</div>`;
    }
    $('#rvAsm').addEventListener('click', () => { doAsm(); ensure(); view(); });
    $('#rvStep').addEventListener('click', () => { if (!cpu) ensure(); cpu.step(); view(); });
    $('#rvReset').addEventListener('click', () => { cpu = null; doAsm(); ensure(); view(); });
    $('#rvRun').addEventListener('click', () => {
      if (!cpu) ensure();
      let n = 0;
      while (n < 2000000 && cpu.step()) n++;
      view();
      $('#rvOut').innerHTML = '执行结束：共 <b>' + cpu.st.cyc + '</b> 条指令。';
    });
    doAsm(); ensure(); view();
    bindCtrl({ start: () => $('#rvRun').click(), pause: () => { }, reset: () => { cpu = null; ensure(); view(); } });
    ctlEl('#gStart').textContent = '运行';
    ctlEl('#gPause').style.display = 'none';
    ctlEl('#gReset').textContent = '复位';
  }
  G['risc-v-assembler'] = riscvUI;
  G['riscv-simulator'] = riscvUI;

  /* ---------------- CHIP-8 模拟器 ---------------- */
  const CHIP8 = (function () {
    const FONTSET = [
      0xF0, 0x90, 0x90, 0x90, 0xF0, 0x20, 0x60, 0x20, 0x20, 0x70, 0xF0, 0x10, 0xF0, 0x80, 0xF0, 0xF0, 0x10, 0xF0, 0x10, 0xF0,
      0x90, 0x90, 0xF0, 0x10, 0x10, 0xF0, 0x80, 0xF0, 0x10, 0xF0, 0xF0, 0x80, 0xF0, 0x90, 0xF0, 0xF0, 0x10, 0x20, 0x40, 0x40,
      0xF0, 0x90, 0xF0, 0x90, 0xF0, 0xF0, 0x90, 0xF0, 0x10, 0xF0, 0xF0, 0x90, 0xF0, 0x90, 0x90, 0xE0, 0x90, 0xE0, 0x90, 0xE0,
      0xF0, 0x80, 0x80, 0x80, 0xF0, 0xE0, 0x90, 0x90, 0x90, 0xE0, 0xF0, 0x80, 0xF0, 0x80, 0xF0, 0xF0, 0x80, 0xF0, 0x80, 0x80
    ];
    // 内置示例 ROM：一个左右弹跳的方块（自写机器码，见下方注释）
    const DEMO = [
      0x60, 0x02, 0x61, 0x08, 0x62, 0x01, 0x64, 0x08, 0x00, 0xE0, 0xA2, 0x30, 0xD0, 0x15, 0x80, 0x04,
      0x40, 0x02, 0x62, 0x01, 0x40, 0x30, 0x62, 0xFF, 0xF4, 0x15, 0xF5, 0x07, 0x35, 0x00, 0x12, 0x1A,
      0x12, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0xF0, 0x90, 0x90, 0x90, 0xF0
    ];
    function Machine() {
      const mem = new Uint8Array(4096);
      const V = new Uint8Array(16);
      const stack = [];
      const gfx = new Uint8Array(64 * 32);
      const keys = new Uint8Array(16);
      const st = { I: 0, pc: 0x200, sp: 0, dt: 0, sound: 0, halted: false, op: 0 };
      for (let i = 0; i < 80; i++) mem[0x50 + i] = FONTSET[i];
      function loadRom(bytes) {
        mem.fill(0); for (let i = 0; i < 80; i++) mem[0x50 + i] = FONTSET[i];
        for (let i = 0; i < bytes.length && 0x200 + i < 4096; i++) mem[0x200 + i] = bytes[i];
        V.fill(0); gfx.fill(0); stack.length = 0;
        st.I = 0; st.pc = 0x200; st.sp = 0; st.dt = 0; st.sound = 0; st.halted = false;
      }
      loadRom(DEMO);
      function tickTimers() { if (st.dt > 0) st.dt--; if (st.sound > 0) st.sound--; }
      function step() {
        if (st.halted) return false;
        const op = (mem[st.pc] << 8) | mem[st.pc + 1];
        st.op = op; st.pc = (st.pc + 2) & 0xFFF;
        const x = (op >> 8) & 0xF, y = (op >> 4) & 0xF;
        const nnn = op & 0xFFF, kk = op & 0xFF, n = op & 0xF;
        switch (op & 0xF000) {
          case 0x0000:
            if (kk === 0xE0) gfx.fill(0);
            else if (kk === 0xEE) { st.pc = stack.pop() || 0x200; st.sp--; }
            else return true;
            break;
          case 0x1000: st.pc = nnn; break;
          case 0x2000: stack.push(st.pc); st.sp++; st.pc = nnn; break;
          case 0x3000: if (V[x] === kk) st.pc += 2; break;
          case 0x4000: if (V[x] !== kk) st.pc += 2; break;
          case 0x5000: if (V[x] === V[y]) st.pc += 2; break;
          case 0x6000: V[x] = kk; break;
          case 0x7000: V[x] = (V[x] + kk) & 0xFF; break;
          case 0x8000:
            switch (n) {
              case 0x0: V[x] = V[y]; break;
              case 0x1: V[x] |= V[y]; break;
              case 0x2: V[x] &= V[y]; break;
              case 0x3: V[x] ^= V[y]; break;
              case 0x4: { const s = V[x] + V[y]; V[0xF] = s > 255 ? 1 : 0; V[x] = s & 0xFF; break; }
              case 0x5: { V[0xF] = V[x] > V[y] ? 1 : 0; V[x] = (V[x] - V[y]) & 0xFF; break; }
              case 0x6: { V[0xF] = V[x] & 1; V[x] = V[x] >> 1; break; }
              case 0x7: { V[0xF] = V[y] > V[x] ? 1 : 0; V[x] = (V[y] - V[x]) & 0xFF; break; }
              case 0xE: { V[0xF] = (V[x] >> 7) & 1; V[x] = (V[x] << 1) & 0xFF; break; }
            }
            break;
          case 0x9000: if (V[x] !== V[y]) st.pc += 2; break;
          case 0xA000: st.I = nnn; break;
          case 0xB000: st.pc = (nnn + V[0]) & 0xFFF; break;
          case 0xC000: V[x] = (Math.random() * 256 | 0) & kk; break;
          case 0xD000: {
            const vx = V[x] % 64, vy = V[y] % 32;
            V[0xF] = 0;
            for (let row = 0; row < n; row++) {
              const bits = mem[(st.I + row) & 0xFFF];
              for (let col = 0; col < 8; col++) {
                if (!(bits & (0x80 >> col))) continue;
                const px = (vx + col) % 64, py = (vy + row) % 32;
                if (gfx[py * 64 + px]) V[0xF] = 1;
                gfx[py * 64 + px] ^= 1;
              }
            }
            break;
          }
          case 0xE000:
            if (kk === 0x9E) { if (keys[V[x] & 0xF]) st.pc += 2; }
            else if (kk === 0xA1) { if (!keys[V[x] & 0xF]) st.pc += 2; }
            break;
          case 0xF000:
            switch (kk) {
              case 0x07: V[x] = st.dt; break;
              case 0x0A: {
                let found = -1;
                for (let i = 0; i < 16; i++) if (keys[i]) { found = i; break; }
                if (found < 0) st.pc -= 2; else V[x] = found;
                break;
              }
              case 0x15: st.dt = V[x]; break;
              case 0x18: st.sound = V[x]; break;
              case 0x1E: st.I = (st.I + V[x]) & 0xFFF; break;
              case 0x29: st.I = 0x50 + (V[x] & 0xF) * 5; break;
              case 0x33: mem[st.I] = Math.floor(V[x] / 100); mem[(st.I + 1) & 0xFFF] = Math.floor(V[x] / 10) % 10; mem[(st.I + 2) & 0xFFF] = V[x] % 10; break;
              case 0x55: for (let i = 0; i <= x; i++) mem[(st.I + i) & 0xFFF] = V[i]; break;
              case 0x65: for (let i = 0; i <= x; i++) V[i] = mem[(st.I + i) & 0xFFF]; break;
            }
            break;
          default: st.halted = true; return false;
        }
        return true;
      }
      return { mem: mem, V: V, gfx: gfx, keys: keys, st: st, step: step, tickTimers: tickTimers, loadRom: loadRom, sp: function () { return stack.length; } };
    }
    return { Machine: Machine, DEMO: DEMO, FONTSET: FONTSET };
  })();
  window.__wsftInternals.chip8 = CHIP8;

  function chip8UI(host, slug) {
    const COLS = 64, ROWS = 32, SCALE = 8;
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap">
          <div id="c8Wrap"></div>
          <div class="runnote">键位映射：1 2 3 4 / Q W E R / A S D F / Z X C V 对应 CHIP-8 的 123C 456D 789E ABCF。</div>
        </div>
      </div>
      ${paneBox('CHIP-8 模拟器', '完整实现 CHIP-8 的 35 条操作码、64×32 单色显示、16 个寄存器、延时/声音定时器。',
      `<div class="shapes" style="margin-top:12px;gap:8px">
          <button class="btn-lime btn-sm" id="gStart">运行</button>
          <button class="btn-ghost btn-sm" id="gPause">暂停</button>
          <button class="btn-ghost btn-sm" id="gReset">重启</button>
        </div>
        <div class="shapes" style="margin-top:10px"><button class="btn-ghost btn-sm" id="c8Upload">加载 .ch8 ROM</button><input type="file" id="c8File" accept=".ch8,.rom,.bin" style="display:none"></div>
        <div class="plabel">每帧指令数（CPU 速度）</div>${TUI.range('c8Speed', 1, 40, 10, 1)}
        <div class="outbox" id="c8Out">内置示例 ROM：一个左右弹跳的方块。</div>
        <div class="plabel">当前状态</div>
        <div class="statgrid">
          <div class="stat"><b id="c8pc">—</b><span>PC</span></div>
          <div class="stat"><b id="c8op">—</b><span>当前操作码</span></div>
          <div class="stat"><b id="c8dt">0</b><span>延时定时器</span></div>
        </div>
        <div class="plabel">寄存器 V0–VF</div>
        <div class="ioout" style="min-height:auto;font-size:12px" id="c8regs">—</div>`)}
    </div>`;
    const C = mkCanvas($('#c8Wrap'), COLS * SCALE, ROWS * SCALE);
    const off = document.createElement('canvas'); off.width = COLS; off.height = ROWS;
    const octx = off.getContext('2d');
    const img = octx.createImageData(COLS, ROWS);
    let m = CHIP8.Machine(), running = true, acc = 0, soundOn = false;
    function render() {
      const d = img.data;
      for (let i = 0; i < COLS * ROWS; i++) {
        const on = m.gfx[i];
        const o = i * 4;
        d[o] = on ? 215 : 12; d[o + 1] = on ? 244 : 12; d[o + 2] = on ? 82 : 14; d[o + 3] = 255;
      }
      octx.putImageData(img, 0, 0);
      C.ctx.imageSmoothingEnabled = false;
      C.ctx.drawImage(off, 0, 0, COLS, ROWS, 0, 0, C.W, C.H);
    }
    function stats() {
      $('#c8pc').textContent = '0x' + m.st.pc.toString(16).toUpperCase().padStart(3, '0');
      $('#c8op').textContent = '0x' + m.st.op.toString(16).toUpperCase().padStart(4, '0');
      $('#c8dt').textContent = m.st.dt;
      $('#c8regs').textContent = Array.from(m.V).map((v, i) => 'V' + i.toString(16).toUpperCase() + '=' + v.toString(16).toUpperCase().padStart(2, '0')).join(' ');
    }
    const loop = Loop(dt => {
      if (running) {
        acc += dt;
        const cps = (+$('#c8Speed').value) * 60;
        const steps = Math.min(600, Math.max(1, Math.round(acc * cps)));
        for (let i = 0; i < steps; i++) m.step();
        acc = 0;
        if (m.st.sound > 0) { if (!soundOn) { soundOn = true; tone(440, 0.08, 'square', 0.08); } }
        else soundOn = false;
        stats();
      }
      render();
    });
    const tickT = setInterval(() => { m.tickTimers(); }, 1000 / 60);
    onClean(() => clearInterval(tickT));
    const KEYMAP = { '1': 0x1, '2': 0x2, '3': 0x3, '4': 0xC, q: 0x4, w: 0x5, e: 0x6, r: 0xD, a: 0x7, s: 0x8, d: 0x9, f: 0xE, z: 0xA, x: 0x0, c: 0xB, v: 0xF };
    window.addEventListener('keydown', e => { const k = KEYMAP[e.key.toLowerCase()]; if (k != null) { m.keys[k] = 1; e.preventDefault(); } });
    window.addEventListener('keyup', e => { const k = KEYMAP[e.key.toLowerCase()]; if (k != null) m.keys[k] = 0; });
    $('#c8Upload').addEventListener('click', () => $('#c8File').click());
    $('#c8File').addEventListener('change', async () => {
      const f = $('#c8File').files[0]; if (!f) return;
      try {
        const buf = await TUI.readBuf(f);
        const bytes = new Uint8Array(buf);
        m = CHIP8.Machine();
        m.loadRom(bytes);
        running = true;
        $('#c8Out').textContent = '已加载 ' + f.name + '（' + bytes.length + ' 字节）。如果画面空白，可能该 ROM 依赖我们未实现的外设（例如 SCHIP 高分辨率模式）。';
        window.toast('ROM 已加载');
      } catch (e) { $('#c8Out').textContent = '加载失败：' + e.message; }
    });
    bindRange('#c8Speed', () => { });
    bindCtrl({ start: () => { running = true; loop.start(); }, pause: () => running = false, reset: () => { m = CHIP8.Machine(); running = true; } });
    ctlEl('#gStart').textContent = '运行';
    ctlEl('#gPause').textContent = '暂停';
    ctlEl('#gReset').textContent = '重启';
    stats(); loop.start();
  }
  G['chip8-emulator'] = chip8UI;
  G['chip-8-emulator'] = chip8UI;

  /* ---------------- Arduino 仿真 ---------------- */
  const ARDUINO_SAMPLE = `// 支持的一小段 Arduino 子集语法
// pinMode / digitalWrite / delay / analogRead / analogWrite / Serial.print
int led = 13;
int button = 2;
int count = 0;

void setup() {
  pinMode(led, OUTPUT);
  pinMode(button, INPUT);
  Serial.begin(9600);
  Serial.println("boot ok");
}

void loop() {
  int v = digitalRead(button);
  if (v == 1) {
    count = count + 1;
    digitalWrite(led, HIGH);
    Serial.print("button pressed: ");
    Serial.println(count);
  } else {
    digitalWrite(led, LOW);
  }
  delay(200);
}`;

  const ARDUINO = (function () {
    const CONSTS = { HIGH: 1, LOW: 0, INPUT: 'INPUT', OUTPUT: 'OUTPUT', INPUT_PULLUP: 'INPUT_PULLUP', LED_BUILTIN: 13, A0: 'A0', A1: 'A1', A2: 'A2', A3: 'A3', A4: 'A4', A5: 'A5', true: 1, false: 0 };
    function tokenize(src) {
      const clean = String(src).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
      const toks = [];
      const re = /\s*([A-Za-z_]\w*|\d+(?:\.\d+)?|"[^"]*"|'(?:[^'\\]|\\.)'|==|!=|<=|>=|&&|\|\||[{}()[\];,=+\-*/%<>!.])/g;
      let mt;
      while ((mt = re.exec(clean))) {
        const s = mt[1];
        toks.push(s);
        if (re.lastIndex >= clean.length) break;
        if (re.lastIndex === mt.index) break;
      }
      return toks;
    }
    function Parser(toks) {
      let i = 0;
      const peek = () => toks[i], next = () => toks[i++];
      function expect(t) { if (toks[i] !== t) throw new Error('第 ' + i + ' 个 token 处期望 " ' + t + ' " 实际 "' + toks[i] + '"'); i++; }
      function program() {
        const funcs = {};
        while (i < toks.length) {
          // 跳过类型
          if (['int', 'void', 'float', 'bool', 'char', 'String', 'long', 'unsigned', 'boolean'].includes(peek())) next();
          const name = next();
          if (toks[i] === '(' && (name === 'setup' || name === 'loop' || toks[i] === '(')) {
            // 函数定义
            if (toks[i] === '(') {
              while (toks[i] !== ')') i++;
              next();
              if (toks[i] === '{') { const body = block(); funcs[name] = body; continue; }
            }
          }
          // 全局变量
          if (toks[i] === '=' || toks[i] === ';' || toks[i] === ',') {
            const list = [{ name: name, init: parseInit() }];
            while (toks[i] === ',') { next(); const nm = next(); list.push({ name: nm, init: parseInit() }); }
            expect(';');
            funcs['__globals'] = (funcs['__globals'] || []).concat(list);
            continue;
          }
          i++;
        }
        return funcs;
      }
      function parseInit() { if (toks[i] === '=') { next(); return expr(); } return null; }
      function block() {
        expect('{');
        const stmts = [];
        while (i < toks.length && toks[i] !== '}') stmts.push(statement());
        expect('}');
        return stmts;
      }
      function statement() {
        const t = peek();
        if (t === '{') return { k: 'block', body: block() };
        if (t === 'if') {
          next(); expect('('); const cond = expr(); expect(')');
          const then = statement();
          let els = null;
          if (peek() === 'else') { next(); els = statement(); }
          return { k: 'if', cond: cond, then: then, els: els };
        }
        if (t === 'while') { next(); expect('('); const cond = expr(); expect(')'); const body = statement(); return { k: 'while', cond: cond, body: body }; }
        if (t === 'for') {
          next(); expect('(');
          const init = statementNoSemi(); expect(';');
          const cond = expr(); expect(';');
          const post = statementNoSemi(); expect(')');
          const body = statement();
          return { k: 'for', init: init, cond: cond, post: post, body: body };
        }
        if (t === 'return') { next(); let e = null; if (peek() !== ';') e = expr(); expect(';'); return { k: 'return', e: e }; }
        if (t === 'break') { next(); expect(';'); return { k: 'break' }; }
        if (['int', 'float', 'bool', 'char', 'String', 'long', 'unsigned', 'boolean', 'const'].includes(t)) {
          next();
          if (peek() === 'const') next();
          if (['int', 'float', 'bool', 'char', 'String', 'long'].includes(peek())) next();
          const name = next();
          let init = null;
          if (peek() === '=') { next(); init = expr(); }
          if (peek() === '[') { /* 数组声明：简化处理，跳过多余维 */ while (peek() === '[') { next(); if (peek() !== ']') expr(); expect(']'); } }
          expect(';');
          return { k: 'decl', name: name, init: init };
        }
        const st0 = statementNoSemi();
        expect(';');
        return st0;
      }
      function statementNoSemi() {
        const name = peek();
        // 函数调用语句
        if (toks[i + 1] === '(') {
          const call = callExpr();
          return { k: 'expr', e: call };
        }
        const target = expr();
        if (['=', '+=', '-=', '*=', '/='].includes(peek())) {
          const op = next(); const value = expr();
          return { k: 'assign', target: target, op: op, value: value };
        }
        return { k: 'expr', e: target };
        void name;
      }
      function callExpr() {
        const fname = next();
        expect('(');
        const args = [];
        if (peek() !== ')') { args.push(expr()); while (peek() === ',') { next(); args.push(expr()); } }
        expect(')');
        return { k: 'call', name: fname, args: args };
      }
      function expr(prec) {
        prec = prec == null ? 0 : prec;
        const LEVELS = [['||'], ['&&'], ['==', '!='], ['<', '>', '<=', '>='], ['+', '-'], ['*', '/', '%']];
        if (prec >= LEVELS.length) return unary();
        let left = expr(prec + 1);
        while (LEVELS[prec].includes(peek())) {
          const op = next();
          const right = expr(prec + 1);
          left = { k: 'bin', op: op, a: left, b: right };
        }
        return left;
      }
      function unary() {
        if (peek() === '!') { next(); return { k: 'un', op: '!', e: unary() }; }
        if (peek() === '-') { next(); return { k: 'un', op: '-', e: unary() }; }
        return postfix();
      }
      function postfix() {
        let e = primary();
        while (true) {
          if (peek() === '[') { next(); const idx = expr(); expect(']'); e = { k: 'index', a: e, i: idx }; }
          else if (peek() === '.') {
            next(); const prop = next();
            if (peek() === '(') { next(); const args = []; if (peek() !== ')') { args.push(expr()); while (peek() === ',') { next(); args.push(expr()); } } expect(')'); e = { k: 'call', name: 'Serial.' + prop, args: args }; }
            else e = { k: 'member', a: e, p: prop };
          } else break;
        }
        return e;
      }
      function primary() {
        const t = next();
        if (t === '(') { const e = expr(); expect(')'); return e; }
        if (/^\d/.test(t)) return { k: 'num', v: parseFloat(t) };
        if (/^".*"$/.test(t)) return { k: 'str', v: t.slice(1, -1) };
        if (/^'.*'$/.test(t)) return { k: 'num', v: t.charCodeAt(1) };
        if (toks[i] === '(') return callExpr2(t);
        return { k: 'var', name: t };
      }
      function callExpr2(name) {
        expect('(');
        const args = [];
        if (peek() !== ')') { args.push(expr()); while (peek() === ',') { next(); args.push(expr()); } }
        expect(')');
        return { k: 'call', name: name, args: args };
      }
      return program;
    }
    function Interp(ast, io) {
      const vars = {};
      const values = {};   // 引脚电平 0..255
      const modes = {};
      let serial = '';
      function getVar(n) { if (n in vars) return vars[n]; if (n in CONSTS) return CONSTS[n]; if (/^A\d$/.test(n)) return io.analog(n); return 0; }
      function setVar(n, v) { vars[n] = v; }
      function ev(e) {
        if (e == null) return 0;
        switch (e.k) {
          case 'num': return e.v;
          case 'str': return e.v;
          case 'var': return getVar(e.name);
          case 'bin': {
            const a = ev(e.a), b = ev(e.b);
            switch (e.op) {
              case '+': return (typeof a === 'string' || typeof b === 'string') ? String(a) + String(b) : a + b;
              case '-': return a - b; case '*': return a * b; case '/': return b === 0 ? 0 : a / b; case '%': return b === 0 ? 0 : a % b;
              case '==': return a == b ? 1 : 0; case '!=': return a != b ? 1 : 0;
              case '<': return a < b ? 1 : 0; case '>': return a > b ? 1 : 0; case '<=': return a <= b ? 1 : 0; case '>=': return a >= b ? 1 : 0;
              case '&&': return (a && b) ? 1 : 0; case '||': return (a || b) ? 1 : 0;
            }
            return 0;
          }
          case 'un': return e.op === '!' ? (ev(e.e) ? 0 : 1) : -ev(e.e);
          case 'index': return 0;
          case 'call': return callFn(e);
        }
        return 0;
      }
      function callFn(e) {
        const args = e.args.map(ev);
        const name = e.name;
        if (name === 'Serial.print') { serial += String(args[0]); io.serial && io.serial(serial); return 0; }
        if (name === 'Serial.println') { serial += String(args[0]) + '\n'; io.serial && io.serial(serial); return 0; }
        if (name === 'Serial.begin' || name === 'Serial.write') return 0;
        switch (name) {
          case 'pinMode': modes[args[0]] = args[1]; if (io.pinMode) io.pinMode(args[0], args[1]); return 0;
          case 'digitalWrite': values[args[0]] = args[1] ? 255 : 0; if (io.write) io.write(args[0], values[args[0]]); return 0;
          case 'analogWrite': values[args[0]] = clamp(args[1] | 0, 0, 255); if (io.write) io.write(args[0], values[args[0]]); return 0;
          case 'digitalRead': return io.digital ? io.digital(args[0]) : 0;
          case 'analogRead': return Math.round((io.analog ? io.analog(args[0]) : 0));
          case 'delay': if (io.delay) io.delay(args[0] | 0); return 0;
          case 'delayMicroseconds': return 0;
          case 'millis': return io.millis ? io.millis() : 0;
          case 'random': return Math.floor(Math.random() * (args.length > 1 ? (args[1] - args[0]) : (args[0] || 1))) + (args.length > 1 ? args[0] : 0);
          case 'abs': return Math.abs(args[0]); case 'min': return Math.min(args[0], args[1]); case 'max': return Math.max(args[0], args[1]);
          case 'map': return Math.round((args[0] - args[1]) * (args[4] - args[3]) / ((args[2] - args[1]) || 1) + args[3]);
          default: throw new Error('未实现的函数 ' + name + '()');
        }
      }
      function exec(st) {
        switch (st.k) {
          case 'block': for (let i = 0; i < st.body.length; i++) exec(st.body[i]); return;
          case 'decl': setVar(st.name, st.init ? ev(st.init) : 0); return;
          case 'assign': {
            let cur = st.target.k === 'var' ? getVar(st.target.name) : 0;
            let v = ev(st.value);
            if (st.op === '+=') v = cur + v; else if (st.op === '-=') v = cur - v; else if (st.op === '*=') v = cur * v; else if (st.op === '/=') v = cur / v;
            if (st.target.k === 'var') setVar(st.target.name, v);
            return;
          }
          case 'expr': ev(st.e); return;
          case 'if': if (truthy(ev(st.cond))) exec(st.then); else if (st.els) exec(st.els); return;
          case 'while': { let g = 0; while (truthy(ev(st.cond)) && g++ < 100000) { exec(st.body); if (guard.breakFlag) { guard.breakFlag = false; break; } } return; }
          case 'for': { exec(st.init); let g = 0; while (truthy(ev(st.cond)) && g++ < 100000) { exec(st.body); if (guard.breakFlag) { guard.breakFlag = false; break; } exec(st.post); } return; }
          case 'break': guard.breakFlag = true; return;
          case 'return': return;
        }
      }
      const guard = { breakFlag: false };
      function truthy(v) { return !!v && v !== 'LOW'; }
      return {
        run: function (func) { try { exec(func); return null; } catch (e) { return e.message; } },
        vars: vars, values: values, modes: modes, getSerial: function () { return serial; }, clearSerial: function () { serial = ''; }, ev: ev, getVar: getVar
      };
    }
    const TYPES = ['int', 'void', 'float', 'bool', 'char', 'String', 'long', 'unsigned', 'boolean', 'const'];
    return { tokenize: tokenize, Parser: Parser, Interp: Interp, CONSTS: CONSTS };
  })();
  window.__wsftInternals.arduino = ARDUINO;

  function arduinoUI(host, slug) {
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        ${TUI.field('Arduino 草图（支持子集语法）', TUI.area('arSrc', ARDUINO_SAMPLE, '', 14))}
        <div class="plabel">面包板接线（点引脚可切换 LED 接在哪只脚）</div>
        <div id="arBoard" style="background:#141414;border:1px solid #242424;border-radius:12px;padding:12px">
          <div id="arPins" style="display:flex;gap:4px;flex-wrap:wrap"></div>
          <canvas id="arCanvas" width="640" height="150" style="width:100%;max-width:640px;margin-top:12px;background:#0d0d0d;border-radius:10px"></canvas>
        </div>
        <div class="plabel">串口监视器</div>
        <div class="ioout" id="arSerial" style="min-height:110px;max-height:200px;font-size:12.5px">—</div>
      </div>
      ${paneBox('Arduino 仿真器', '解析并模拟一小段 Arduino 子集 C 语法：setup()/loop()、int 变量、算术、if/else、while、for、pinMode/digitalWrite/digitalRead/analogRead/analogWrite/delay/Serial.print。',
      `<div class="plabel">按钮（引脚 2）</div>${TUI.chk('arButton', '按下按钮（给引脚 2 高电平）', false)}
        <div class="plabel">模拟速度</div>${TUI.range('arSpeed', 1, 20, 5, 1)}
        <div class="shapes" style="margin-top:12px;gap:8px">
          <button class="btn-lime btn-sm" id="gStart">编译并运行</button>
          <button class="btn-ghost btn-sm" id="gPause">暂停</button>
          <button class="btn-ghost btn-sm" id="gReset">复位</button>
        </div>
        <div class="outbox" id="arOut">等待运行。</div>
        <div class="note"><b>已实现</b>：setup/loop、引脚电平、串口输出、常见控制流与算术。<br><b>未实现</b>：真实定时器/中断、PWM 频率细节、I2C/SPI、库函数、编译到机器码（这里是解释执行，不是真的 AVR 编译器）。</div>`)}
    </div>`;
    const pinsEl = $('#arPins'), cv = $('#arCanvas'), ctx = cv.getContext('2d');
    let ledPin = 13, interp = null, ast = null, timer = null, running = false, buttonOn = false, loopCount = 0, delayMs = 500;
    pinsEl.innerHTML = Array.from({ length: 14 }, (_, i) => `<button class="shape" data-p="${i}" style="min-width:44px">${i}</button>`).join('') + '<button class="shape" data-p="A0">A0</button>';
    function setLed(p) { ledPin = p; $$('.shape', pinsEl).forEach(b => b.classList.toggle('on', String(b.dataset.p) === String(p))); draw(); }
    pinsEl.addEventListener('click', e => { const b = e.target.closest('.shape'); if (b) setLed(b.dataset.p); });
    function draw() {
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 90, cv.width, 60);
      ctx.fillStyle = '#2a2a2a';
      for (let i = 0; i < 14; i++) { ctx.fillRect(30 + i * 42, 40, 26, 50); }
      ctx.fillStyle = '#8a8a8a'; ctx.font = '10px Inter,sans-serif'; ctx.textAlign = 'center';
      for (let i = 0; i < 14; i++) { ctx.fillText(String(i), 43 + i * 42, 34); }
      const v = interp ? (interp.values[ledPin] || 0) : 0;
      const idx = ledPin === 'A0' ? 14 : +ledPin;
      const x = idx < 14 ? 43 + idx * 42 : cv.width - 40;
      // 电阻
      ctx.strokeStyle = '#d9a72c'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, 90); ctx.lineTo(x, 112); ctx.stroke();
      ctx.fillStyle = '#c8a24a'; ctx.fillRect(x - 8, 112, 16, 22);
      // LED
      const glow = clamp(v / 255, 0, 1);
      ctx.beginPath(); ctx.arc(x, 145, 12, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,90,80,' + (0.18 + glow * 0.82) + ')';
      ctx.fill();
      if (glow > 0.1) {
        const g = ctx.createRadialGradient(x, 145, 2, x, 145, 40 * glow);
        g.addColorStop(0, 'rgba(255,120,90,' + (0.55 * glow) + ')'); g.addColorStop(1, 'rgba(255,80,60,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, 145, 40 * glow, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#8a8a8a'; ctx.font = '11px Inter,sans-serif'; ctx.textAlign = 'left';
      ctx.fillText('LED 接在引脚 ' + ledPin + ' · 亮度 ' + Math.round(v / 255 * 100) + '%', 12, 20);
      ctx.fillText('按钮 → 引脚 2', 12, 36);
    }
    function compile() {
      try {
        const toks = ARDUINO.tokenize($('#arSrc').value);
        const fns = ARDUINO.Parser(toks)();
        if (!fns.setup && !fns.loop) throw new Error('没有找到 setup() 或 loop()');
        return fns;
      } catch (e) { $('#arOut').innerHTML = '<b style="color:#ff6b6b">解析失败：</b>' + esc(e.message); return null; }
    }
    function io() {
      return {
        pinMode: function (p, m) { },
        write: function (p, v) { draw(); },
        digital: function (p) { return (String(p) === '2' && buttonOn) ? 1 : 0; },
        analog: function (p) { return String(p) === 'A0' ? ri(0, 1023) : 0; },
        delay: function (ms) { delayMs = clamp(ms, 1, 5000); },
        millis: function () { return performance.now() | 0; },
        serial: function (s) { const el2 = $('#arSerial'); el2.textContent = s.slice(-4000); el2.scrollTop = 1e6; draw(); }
      };
    }
    function start() {
      const fns = compile();
      if (!fns) return;
      interp = ARDUINO.Interp(fns, io());
      ast = fns; loopCount = 0;
      if (fns.__globals) fns.__globals.forEach(g => { interp.vars[g.name] = g.init ? interp.ev(g.init) : 0; });
      $('#arSerial').textContent = '';
      const err = fns.setup ? interp.run({ k: 'block', body: fns.setup }) : null;
      if (err) { $('#arOut').innerHTML = '<b style="color:#ff6b6b">setup() 出错：</b>' + esc(err); return; }
      $('#arOut').innerHTML = '已编译：' + (fns.setup ? 'setup() ' : '') + (fns.loop ? 'loop() ' : '') + '· 正在循环执行。';
      running = true;
      tick();
    }
    function tick() {
      clearTimeout(timer);
      if (!running || !interp || !ast || !ast.loop) return;
      const err = interp.run({ k: 'block', body: ast.loop });
      if (err) { $('#arOut').innerHTML = '<b style="color:#ff6b6b">loop() 出错：</b>' + esc(err); running = false; return; }
      loopCount++;
      draw();
      const speed = +$('#arSpeed').value;
      timer = setTimeout(tick, clamp(delayMs / speed, 16, 3000));
      onClean(() => clearTimeout(timer));
    }
    bindChk('#arButton', v => { buttonOn = v; });
    bindRange('#arSpeed', () => { });
    ctlEl('#gStart').addEventListener('click', start);
    ctlEl('#gPause').addEventListener('click', () => { running = false; clearTimeout(timer); $('#arOut').textContent = '已暂停（loop 停在 ' + loopCount + ' 次）。'; });
    ctlEl('#gReset').addEventListener('click', () => { running = false; clearTimeout(timer); interp = null; loopCount = 0; $('#arSerial').textContent = '—'; draw(); $('#arOut').textContent = '已复位。'; });
    ctlEl('#gStart').textContent = '编译并运行';
    ctlEl('#gPause').textContent = '暂停';
    ctlEl('#gReset').textContent = '复位';
    setLed(13);
  }
  G['arduino-simulator'] = arduinoUI;
  G['arduino-uno-simulator'] = arduinoUI;

  /* ---------------- 复古终端（DOS / Linux / 掌机 致敬模拟） ---------------- */
  function retroShellUI(host, slug) {
    const IS_DOS = ['dos-emulator', 'pc-emulator', 'retro-console-player'].indexOf(slug) >= 0;
    const NAME = { 'dos-emulator': 'MS-DOS 风味终端', 'linux-emulator': 'Linux 风味终端', 'pc-emulator': 'PC 风味终端', 'kolibrios-online': 'KolibriOS 风味终端', 'retro-console-player': '复古主机风味终端', 'handheld-console-player': '掌机风味终端' }[slug] || '复古终端';
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div style="background:#050505;border:1px solid #222;border-radius:12px;padding:14px;font-family:var(--mono,monospace);font-size:13.5px;color:${IS_DOS ? '#c9c9c9' : '#8ff08f'}; height:440px;display:flex;flex-direction:column">
          <div id="rsScreen" style="flex:1;overflow:auto;white-space:pre-wrap;line-height:1.5"></div>
          <div style="display:flex;gap:8px;margin-top:8px;border-top:1px solid #1e1e1e;padding-top:8px">
            <span id="rsPrompt" style="color:#d7f452">C:\\&gt;</span>
            <input id="rsInput" autocomplete="off" spellcheck="false" style="flex:1;background:transparent;border:none;color:inherit;font-family:inherit;font-size:inherit;outline:none;padding:0">
          </div>
        </div>
        <div class="warnbox" style="display:block;margin-top:12px">
          <b>这是一个致敬性的本地终端模拟，不包含真实的 DOS / Linux / Windows 内核。</b>
          它不会、也不能真的运行 .exe / ELF 程序或挂载文件系统。下面是几十条可玩的命令行小游戏和彩蛋命令，
          全部由本站 JavaScript 实现；这也是我们能做到的「诚实版本」。
        </div>
      </div>
      ${paneBox(NAME, '内置 ' + 34 + ' 条命令：文件系统玩具、时间、计算、以及多个命令行小游戏。',
      `<div class="plabel">可用命令</div>
        <div class="ioout" style="min-height:auto;max-height:280px;font-size:12.5px">${['help', 'about', 'banner', 'echo', 'clear', 'cls', 'ls', 'dir', 'cat', 'pwd', 'cd', 'tree', 'whoami', 'date', 'time', 'uptime', 'calc', 'cowsay', 'fortune', 'neofetch', 'theme', 'history', 'sudo', 'rm', 'ping', 'dice', 'coin', 'guess', 'wordle', 'ttt', 'hangman', 'matrix', 'logo', 'beep', 'exit'].map(c => '<b style="color:#d7f452">' + c + '</b>').join(' · ')}</div>
        <div class="runnote">输入 help 查看每条命令的用法说明。</div>`)}
    </div>`;
    const screen = $('#rsScreen'), input = $('#rsInput'), prompt = $('#rsPrompt');
    let hist = [], hi = -1, cwd = 'C:\\', state = null;
    const FS = {
      'C:\\': ['AUTOEXEC.BAT', 'CONFIG.SYS', 'GAMES', 'DOCS'],
      'C:\\GAMES': ['SNAKE.EXE', 'PONG.BAS', 'DOOM.TXT'],
      'C:\\DOCS': ['README.TXT', 'NOTES.TXT']
    };
    const FORTUNES = ['今天适合把注释写得比代码多。', '任何足够复杂的 bug 都长得像特性。', '先让它跑起来，再让它跑得快。', '本地优先的工具永远不会在服务器上挂掉。', '缓存失效与命名，是计算机科学里最难的两件事。'];
    function w(txt, cls) {
      const d = document.createElement('div');
      if (cls) d.style.color = cls;
      d.textContent = txt;
      screen.appendChild(d);
      screen.scrollTop = screen.scrollHeight;
    }
    function wHtml(html) { const d = document.createElement('div'); d.innerHTML = html; screen.appendChild(d); screen.scrollTop = screen.scrollHeight; }
    function boot() {
      screen.innerHTML = '';
      if (IS_DOS) {
        w('我的工作台 DOS 风味终端 — 致敬版 (非真实 DOS 内核)');
        w('(C) 2026 我的工作台 · 免费工具. 全部命令在浏览器 JS 中实现。');
        w('');
        w('输入 help 查看命令列表。');
      } else {
        w('Welcome to wsft-shell 1.0 (浏览器内 JavaScript 模拟，非真实内核)');
        w('输入 help 查看 ' + 34 + ' 条可用命令。');
        w('');
      }
    }
    const CMDS = {
      help: () => {
        wHtml('<b>命令列表</b>');
        [['help', '显示帮助'], ['about', '关于这个模拟器'], ['banner', '打印 ASCII 标题'], ['echo 文本', '原样输出'], ['clear / cls', '清屏'],
        ['ls / dir', '列出当前目录'], ['cat 文件', '显示文件内容'], ['pwd', '显示当前路径'], ['cd 目录', '切换目录'], ['tree', '目录树'],
        ['whoami', '当前用户'], ['date / time', '日期时间'], ['uptime', '运行时长'], ['calc 表达式', '计算'],
        ['cowsay 文本', '奶牛说话'], ['fortune', '来一句格言'], ['neofetch', '系统信息'], ['theme [绿|琥珀|蓝]', '切换配色'],
        ['history', '命令历史'], ['sudo …', '试试看会发生什么'], ['rm …', '危险操作（假的）'], ['ping 主机', '假的 ping'],
        ['dice [n]', '掷骰子'], ['coin', '抛硬币'], ['guess [n]', '猜数字游戏'], ['wordle', '猜单词（简化版）'],
        ['ttt', '井字棋'], ['hangman', '猜字母'], ['matrix', '字符雨动画'], ['logo', '重绘启动横幅'],
        ['beep [Hz]', '合成一声'], ['exit', '假装退出']].forEach(c => {
          const d = document.createElement('div');
          d.innerHTML = '<b style="color:#d7f452">' + esc(c[0]) + '</b> — ' + esc(c[1]);
          screen.appendChild(d);
        });
        screen.scrollTop = screen.scrollHeight;
      },
      about: () => w('这是一个致敬性的本地终端模拟：所有命令都是浏览器里的 JavaScript 实现。\n它不包含真实的 DOS / Linux 内核，也不能执行真实的可执行文件。这样做的原因是——在浏览器里跑真实内核需要完整模拟 x86 + 硬件，本工具选择把「能真正有趣地玩」的部分做实。', '#ffd166'),
      banner: () => wHtml('<pre style="color:#d7f452"> __        __   _____  __      __  ___   ___  \n \\ \\      / /  /  _  \\ \\ \\    / / /   | /   | \n  \\ \\ /\\ / /   | |_| |  \\ \\  / /  | | | | | | \n   \\ V  V /    |  _  |   \\ \\/ /   | | | | | | \n    \\_/\\_/     |_| |_|    \\__/    |_| |_| |_| \n   F R E E   T O O L S   (local terminal demo)</pre>'),
      echo: a => w(a.join(' ')),
      clear: () => { screen.innerHTML = ''; }, cls: () => { screen.innerHTML = ''; },
      ls: () => lsCmd(), dir: () => lsCmd(),
      cat: a => {
        if (!a[0]) return w('用法：cat 文件名');
        const f = a[0].toUpperCase();
        if (f === 'README.TXT') return w('这是一个浏览器内的终端模拟器。\n它不会真的读取磁盘，所有文件内容都写死在 JavaScript 里。');
        if (f === 'NOTES.TXT') return w('1. 所有命令都真实实现了，不是随便回显。\n2. 游戏（guess / ttt / hangman / wordle）是真的有逻辑的。\n3. 没有内核。');
        if (f === 'AUTOEXEC.BAT') return w('@ECHO OFF\nPROMPT $P$G\nECHO 欢迎来到 WSFT-DOS 模拟终端');
        if (f === 'CONFIG.SYS') return w('DEVICE=HIMEM.SYS\nFILES=30');
        if (f === 'DOOM.TXT') return w('这里没有 DOOM。但你可以输入 matrix 看字符雨，那是真的在跑。');
        w('找不到文件：' + a[0]);
      },
      pwd: () => w(cwd),
      cd: a => {
        const t = (a[0] || '').toUpperCase();
        if (!t || t === '\\' || t === 'C:\\') { cwd = 'C:\\'; return setPrompt(); }
        if (t === '..') { if (cwd !== 'C:\\') cwd = cwd.replace(/\\[^\\]+$/, '') || 'C:\\'; return setPrompt(); }
        const cand = cwd === 'C:\\' ? 'C:\\' + t : cwd + '\\' + t;
        if (FS[cand]) { cwd = cand; return setPrompt(); }
        w('系统找不到指定的路径。');
      },
      tree: () => {
        const lines = ['C:\\'];
        Object.keys(FS).forEach(k => {
          if (k === 'C:\\') return;
          lines.push('  +-- ' + k.split('\\').pop());
          FS[k].forEach(f => lines.push('       ' + f));
        });
        FS['C:\\'].filter(f => f.indexOf('.') > 0).forEach(f => lines.push('  ' + f));
        w(lines.join('\n'));
      },
      whoami: () => w(IS_DOS ? 'C:\\USERS\\我的工作台' : 'guest@wsft-shell'),
      date: () => w(new Date().toLocaleDateString()),
      time: () => w(new Date().toLocaleTimeString()),
      uptime: () => w('本会话已运行 ' + Math.floor((Date.now() - bootAt) / 1000) + ' 秒。' + (IS_DOS ? '' : '\n load average: 0.00, 0.01, 0.05（编的）')),
      calc: a => {
        const expr = a.join(' ');
        if (!expr) return w('用法：calc 1 + 2 * 3');
        if (!/^[\d+\-*/(). %]+$/.test(expr)) return w('只支持数字与 + - * / ( ) %');
        try { w(expr + ' = ' + Function('"use strict";return (' + expr + ')')()); }
        catch (e) { w('表达式错误'); }
      },
      cowsay: a => {
        const t = a.join(' ') || 'Hello from a cow';
        const line = '-' .repeat(t.length + 2);
        w(' ' + line + '\n< ' + t + ' >\n ' + line + '\n        \\   ^__^\n         \\  (oo)\\_______\n            (__)\\       )\\/\\\n                ||----w |\n                ||     ||');
      },
      fortune: () => w(FORTUNES[ri(0, FORTUNES.length)], '#d7f452'),
      neofetch: () => wHtml('<pre>' +
        '        <span style="color:#d7f452">#####</span>   <b>wsft@local</b>\n' +
        '       <span style="color:#d7f452">#######</span>  OS: 我的工作台 · 免费工具 (browser JS)\n' +
        '      <span style="color:#d7f452">##</span>   <span style="color:#5fd0ff">##</span>  Shell: wsft-shell 1.0 (simulated)\n' +
        '      <span style="color:#d7f452">###</span>       Host: ' + navigator.platform + '\n' +
        '                Kernel: ECMAScript (no real kernel)\n' +
        '                Uptime: ' + Math.floor((Date.now() - bootAt) / 1000) + 's\n' +
        '                CPU: ' + (navigator.hardwareConcurrency || '?') + ' cores\n' +
        '                Resolution: ' + window.screen.width + 'x' + window.screen.height + '</pre>'),
      theme: a => {
        const t = (a[0] || '').toLowerCase();
        const col = t === 'amber' ? '#ffb454' : t === 'blue' ? '#5fd0ff' : '#8ff08f';
        screen.style.color = col;
        prompt.style.color = col;
        w('主题已切换为 ' + (t || '绿'));
      },
      history: () => w(hist.map((h, i) => '  ' + (i + 1) + '  ' + h).join('\n') || '（空）'),
      sudo: () => w('guest 不在 sudoers 文件中。此事将被记录。（开玩笑的，这里没有 sudoers 文件）', '#ff8fb1'),
      rm: a => w('拒绝执行：这里没有真实的文件系统可以删除。' + (a.indexOf('-rf') >= 0 ? '（即使有，我们也不会执行 rm -rf /）' : ''), '#ff8fb1'),
      ping: a => {
        const h = a[0] || 'localhost';
        w('正在 Ping ' + h + ' [假的] 具有 32 字节的数据:');
        let i = 0;
        const step = () => {
          if (i >= 4) { w(''); w(h + ' 的 Ping 统计信息: 数据包: 已发送 = 4，已接收 = 4，丢失 = 0 (0% 丢失)'); return; }
          w('来自 ' + h + ' 的回复: 字节=32 时间=' + ri(1, 40) + 'ms TTL=64');
          i++;
          setTimeout(step, 320);
        };
        step();
      },
      dice: a => { const n = clamp(+a[0] || 1, 1, 6); w(Array.from({ length: n }, () => ri(1, 6)).join(' ')); },
      coin: () => w(Math.random() < 0.5 ? '正面' : '反面'),
      guess: a => {
        const max = clamp(+a[0] || 100, 10, 100000);
        state = { k: 'guess', target: ri(1, max), tries: 0, max: max };
        w('我已经想好 1~' + max + ' 之间的一个数字，来猜吧（输入数字，或 q 退出）。');
      },
      wordle: () => {
        state = { k: 'wordle', target: WORDS5[ri(0, WORDS5.length)], tries: 0 };
        w('猜一个 5 字母英文单词，共 6 次机会。每次会告诉你哪些字母位置正确（大写）或存在（小写）。');
      },
      ttt: () => {
        state = { k: 'ttt', b: new Array(9).fill(' ') };
        w('井字棋：你是 X。输入 1-9 表示格子（左上=1，右下=9），q 退出。');
        drawTtt();
      },
      hangman: () => {
        state = { k: 'hangman', word: WORDS5[ri(0, WORDS5.length)], guessed: [], wrong: 0 };
        w('猜字母游戏：输入一个字母。');
        drawHang();
      },
      matrix: () => { matrixMode = !matrixMode; if (matrixMode) w('字符雨开启（输入 matrix 再次关闭）'); },
      logo: () => { boot(); },
      beep: a => { unlockAudio(); tone(clamp(+a[0] || 440, 20, 20000), 0.18, 'square', 0.15); w('beep!'); },
      exit: () => { w('再见！(关闭标签页请用浏览器自己的方式)'); w('—— 提示：这只是模拟，没有内核可以退出。', '#8a8a8a'); }
    };
    let bootAt = Date.now(), matrixMode = false, mTimer = null;
    function lsCmd() { w((FS[cwd] || []).join('   ')); }
    function setPrompt() { prompt.textContent = cwd + '>'; }
    function drawTtt() {
      const b = state.b;
      w('  ' + b[0] + ' | ' + b[1] + ' | ' + b[2] + '\n ---+---+---\n  ' + b[3] + ' | ' + b[4] + ' | ' + b[5] + '\n ---+---+---\n  ' + b[6] + ' | ' + b[7] + ' | ' + b[8]);
    }
    function drawHang() {
      const W = state.word.split('').map(c => state.guessed.indexOf(c) >= 0 ? c : '_').join(' ');
      w(W + '    （已错 ' + state.wrong + '/6）');
    }
    function tttWin(b, p) {
      const L = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
      return L.some(l => l.every(i => b[i] === p));
    }
    function tttAI() {
      const b = state.b;
      const empty = b.map((v, i) => v === ' ' ? i : -1).filter(i => i >= 0);
      const L = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
      for (let p of ['O', 'X']) for (const l of L) {
        const vals = l.map(i => b[i]);
        if (vals.filter(v => v === p).length === 2 && vals.indexOf(' ') >= 0) return l[vals.indexOf(' ')];
      }
      if (b[4] === ' ') return 4;
      return empty[ri(0, empty.length - 1)];
    }
    function handle(line) {
      const parts = line.trim().split(/\s+/);
      const cmd = (parts[0] || '').toLowerCase();
      const args = parts.slice(1);
      if (state) {
        if (cmd === 'q') { state = null; w('已退出小游戏。'); return; }
        if (state.k === 'guess') {
          const n = parseInt(cmd, 10);
          if (isNaN(n)) return w('请输入数字，或 q 退出。');
          state.tries++;
          if (n === state.target) { w('猜对了！用了 ' + state.tries + ' 次。'); tone(880, 0.15, 'triangle', 0.18); state = null; }
          else if (n < state.target) w(n + ' 小了。');
          else w(n + ' 大了。');
          return;
        }
        if (state.k === 'wordle') {
          const g = cmd;
          if (g.length !== 5) return w('需要 5 个字母。');
          state.tries++;
          let out = '';
          for (let i = 0; i < 5; i++) out += g[i] === state.target[i] ? g[i].toUpperCase() : (state.target.indexOf(g[i]) >= 0 ? g[i] : '.') ;
          w(out);
          if (g === state.target) { w('猜对了！'); tone(880, 0.16, 'triangle', 0.18); state = null; }
          else if (state.tries >= 6) { w('机会用完了，答案是 ' + state.target + '。'); state = null; }
          return;
        }
        if (state.k === 'ttt') {
          const n = parseInt(cmd, 10);
          if (isNaN(n) || n < 1 || n > 9) return w('输入 1-9，或 q 退出。');
          if (state.b[n - 1] !== ' ') return w('那一格已经有子了。');
          state.b[n - 1] = 'X';
          if (tttWin(state.b, 'X')) { drawTtt(); w('你赢了！'); state = null; return; }
          if (state.b.indexOf(' ') < 0) { drawTtt(); w('平局。'); state = null; return; }
          state.b[tttAI()] = 'O';
          if (tttWin(state.b, 'O')) { drawTtt(); w('电脑赢了。'); state = null; return; }
          drawTtt();
          if (state.b.indexOf(' ') < 0) { w('平局。'); state = null; }
          return;
        }
        if (state.k === 'hangman') {
          const c = cmd[0];
          if (!c || !/[a-z]/.test(c)) return w('输入一个字母，或 q 退出。');
          if (state.guessed.indexOf(c) >= 0) return w('这个字母已经猜过了。');
          state.guessed.push(c);
          if (state.word.indexOf(c) < 0) { state.wrong++; w('没有这个字母。'); tone(220, 0.1, 'square', 0.1); }
          drawHang();
          if (state.word.split('').every(ch => state.guessed.indexOf(ch) >= 0)) { w('猜对了！答案就是 ' + state.word + '。'); tone(880, 0.16, 'triangle', 0.18); state = null; }
          else if (state.wrong >= 6) { w('失败了，答案是 ' + state.word + '。'); state = null; }
          return;
        }
      }
      if (!cmd) return;
      if (CMDS[cmd]) { CMDS[cmd](args); return; }
      w('「' + parts[0] + '」不是内部或外部命令，也不是可运行的程序。输入 help 查看可用命令。', '#ff8fb1');
    }
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const v = input.value;
        wHtml('<span style="color:#d7f452">' + esc(prompt.textContent) + '</span> ' + esc(v));
        input.value = '';
        if (v.trim()) { hist.push(v.trim()); hi = hist.length; }
        unlockAudio();
        handle(v);
      } else if (e.key === 'ArrowUp') { if (hist.length) { hi = Math.max(0, hi - 1); input.value = hist[hi] || ''; } e.preventDefault(); }
      else if (e.key === 'ArrowDown') { if (hist.length) { hi = Math.min(hist.length, hi + 1); input.value = hist[hi] || ''; } e.preventDefault(); }
      else if (e.key === 'Tab') e.preventDefault();
    });
    host.addEventListener('click', () => input.focus());
    const mLoop = Loop(() => {
      if (!matrixMode) return;
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ｱｲｳｴｵｶｷｸｹｺ';
      const line = Array.from({ length: 60 }, () => chars[ri(0, chars.length - 1)]).join('');
      const d = document.createElement('div');
      d.textContent = line;
      d.style.color = 'rgba(143,240,143,' + rf(0.3, 0.9) + ')';
      screen.appendChild(d);
      if (screen.children.length % 30 === 0) screen.appendChild(document.createElement('div')).textContent = '';
      screen.scrollTop = screen.scrollHeight;
      while (screen.children.length > 400) screen.removeChild(screen.firstChild);
    });
    onClean(() => mLoop.stop());
    setPrompt();
    boot();
    input.focus();
    bindCtrl({ start: () => { boot(); }, pause: () => { matrixMode = false; }, reset: () => { state = null; matrixMode = false; hist = []; cwd = 'C:\\'; setPrompt(); boot(); } });
    ctlEl('#gStart').textContent = '重新启动';
    ctlEl('#gPause').textContent = '停止动画';
    ctlEl('#gReset').textContent = '复位终端';
    mLoop.start();
  }
  G['dos-emulator'] = retroShellUI;
  G['linux-emulator'] = retroShellUI;
  G['pc-emulator'] = retroShellUI;
  G['kolibrios-online'] = retroShellUI;
  G['retro-console-player'] = retroShellUI;
  G['handheld-console-player'] = retroShellUI;

  /* ---------------- Python 子集解释器 ---------------- */
  const PYSUB = (function () {
    function tokenize(src) {
      const lines = String(src).replace(/\r/g, '').split('\n');
      return lines.map((raw, ln) => {
        const noComment = raw.replace(/#.*$/, '');
        if (!noComment.trim()) return null;
        const indent = noComment.match(/^\s*/)[0].replace(/\t/g, '    ').length;
        const toks = [];
        const re = /\s*("[^"]*"|'[^']*'|\d+\.\d+|\d+|[A-Za-z_]\w*|\*\*|==|!=|<=|>=|\/\/|[-+*/%<>=!(),:\[\]]|\.)/g;
        let m;
        while ((m = re.exec(noComment))) {
          toks.push(m[1]);
          if (re.lastIndex >= noComment.length) break;
          if (re.lastIndex === m.index) break;
        }
        return { indent: indent, toks: toks, ln: ln + 1 };
      }).filter(Boolean);
    }
    function parse(src) {
      const lines = tokenize(src);
      let i = 0;
      function block(indent) {
        const body = [];
        while (i < lines.length && lines[i].indent >= indent) {
          const cur = lines[i];
          if (cur.indent > indent) throw new Error('第 ' + cur.ln + ' 行：缩进不正确');
          body.push(stmt(cur, indent));
        }
        return body;
      }
      function stmt(line, indent) {
        i++;
        const t = line.toks;
        const head = t[0];
        if (head === 'if' || head === 'elif' || head === 'while') {
          if (t[t.length - 1] !== ':') throw new Error('第 ' + line.ln + ' 行：缺少冒号');
          const cond = expr(t.slice(1, t.length - 1));
          const body = block(indent + 1);
          let orelse = null;
          if (i < lines.length && lines[i].indent === indent && (lines[i].toks[0] === 'else' || lines[i].toks[0] === 'elif')) {
            const nxt = lines[i];
            if (nxt.toks[0] === 'elif') orelse = [stmt(nxt, indent)];
            else { i++; orelse = block(indent + 1); }
          }
          return { k: head, cond: cond, body: body, orelse: orelse };
        }
        if (head === 'for') {
          if (t[2] !== 'in') throw new Error('第 ' + line.ln + ' 行：for 语法应为 for x in range(...)');
          if (t[t.length - 1] !== ':') throw new Error('第 ' + line.ln + ' 行：缺少冒号');
          const varName = t[1];
          const iterable = expr(t.slice(3, t.length - 1));
          const body = block(indent + 1);
          return { k: 'for', v: varName, it: iterable, body: body };
        }
        if (head === 'def') {
          const name = t[1];
          let p = 2, params = [];
          if (t[p] === '(') {
            p++;
            while (t[p] !== ')') { if (t[p] !== ',') params.push(t[p]); p++; }
          }
          const body = block(indent + 1);
          return { k: 'def', name: name, params: params, body: body };
        }
        if (head === 'return') { i = i; return { k: 'return', e: t.length > 1 ? expr(t.slice(1)) : null }; }
        if (head === 'break') return { k: 'break' };
        if (head === 'continue') return { k: 'continue' };
        if (head === 'pass') return { k: 'pass' };
        if (head === 'print' && t[1] === '(') return { k: 'expr', e: expr(t.slice(1)) };
        if (head === 'import') return { k: 'pass' };
        // 赋值
        const eq = t.indexOf('=');
        if (eq > 0 && t[eq + 1] !== '=' ) {
          const target = t[0];
          return { k: 'assign', name: target, e: expr(t.slice(eq + 1)) };
        }
        return { k: 'expr', e: expr(t) };
      }
      const prog = block(0);
      if (i < lines.length) throw new Error('第 ' + lines[i].ln + ' 行：无法解析');
      return prog;
    }
    let P = 0, TOKS = null;
    function expr(toks) {
      TOKS = toks; P = 0;
      const v = orExpr();
      if (P < TOKS.length) throw new Error('表达式中有多余内容：' + TOKS[P]);
      return v;
    }
    const peek = () => TOKS[P], eat = () => TOKS[P++];
    function orExpr() { let a = andExpr(); while (peek() === 'or') { eat(); a = { k: 'or', a: a, b: andExpr() }; } return a; }
    function andExpr() { let a = notExpr(); while (peek() === 'and') { eat(); a = { k: 'and', a: a, b: notExpr() }; } return a; }
    function notExpr() { if (peek() === 'not') { eat(); return { k: 'not', e: notExpr() }; } return cmp(); }
    function cmp() {
      let a = add();
      while (['==', '!=', '<', '>', '<=', '>='].indexOf(peek()) >= 0) { const op = eat(); a = { k: 'cmp', op: op, a: a, b: add() }; }
      return a;
    }
    function add() { let a = mul(); while (peek() === '+' || peek() === '-') { const op = eat(); a = { k: 'bin', op: op, a: a, b: mul() }; } return a; }
    function mul() { let a = unary(); while (['*', '/', '%', '//'].indexOf(peek()) >= 0) { const op = eat(); a = { k: 'bin', op: op, a: a, b: unary() }; } return a; }
    function unary() { if (peek() === '-') { eat(); return { k: 'neg', e: unary() }; } return power(); }
    function power() { const a = atom(); if (peek() === '**') { eat(); return { k: 'bin', op: '**', a: a, b: unary() }; } return a; }
    function atom() {
      const t = eat();
      if (t === '(') { const e = orExpr(); if (eat() !== ')') throw new Error('缺少右括号'); return e; }
      if (t === '[') { const items = []; if (peek() !== ']') { items.push(orExpr()); while (peek() === ',') { eat(); if (peek() === ']') break; items.push(orExpr()); } } eat(); return { k: 'list', items: items }; }
      if (t == null) throw new Error('表达式不完整');
      if (/^\d/.test(t)) return { k: 'num', v: parseFloat(t) };
      if (/^".*"$/.test(t) || /^'.*'$/.test(t)) return { k: 'str', v: t.slice(1, -1) };
      if (t === 'True') return { k: 'num', v: 1 };
      if (t === 'False') return { k: 'num', v: 0 };
      if (t === 'None') return { k: 'none' };
      if (peek() === '(') { eat(); const args = []; if (peek() !== ')') { args.push(orExpr()); while (peek() === ',') { eat(); if (peek() === ')') break; args.push(orExpr()); } } eat(); return { k: 'call', name: t, args: args }; }
      if (peek() === '[') { eat(); const idx = orExpr(); eat(); return { k: 'index', name: t, i: idx }; }
      return { k: 'var', name: t };
    }
    function Interp(ast, out) {
      const globals = {};
      let steps = 0;
      function truthy(v) { return !(v === 0 || v === '' || v === false || v == null); }
      function ev(e, sc) {
        if (++steps > 3000000) throw new Error('执行步数过多，可能是死循环');
        switch (e.k) {
          case 'num': return e.v;
          case 'str': return e.v;
          case 'none': return null;
          case 'list': return e.items.map(x => ev(x, sc));
          case 'var': if (e.name in sc) return sc[e.name]; if (e.name in globals) return globals[e.name]; throw new Error('未定义的变量 ' + e.name);
          case 'index': { const arr = ev({ k: 'var', name: e.name }, sc); const i = ev(e.i, sc); return arr[i | 0]; }
          case 'neg': return -ev(e.e, sc);
          case 'not': return truthy(ev(e.e, sc)) ? 0 : 1;
          case 'and': return truthy(ev(e.a, sc)) && truthy(ev(e.b, sc)) ? 1 : 0;
          case 'or': return truthy(ev(e.a, sc)) || truthy(ev(e.b, sc)) ? 1 : 0;
          case 'cmp': {
            const a = ev(e.a, sc), b = ev(e.b, sc);
            if (e.op === '==') return a == b ? 1 : 0;
            if (e.op === '!=') return a != b ? 1 : 0;
            if (e.op === '<') return a < b ? 1 : 0;
            if (e.op === '>') return a > b ? 1 : 0;
            if (e.op === '<=') return a <= b ? 1 : 0;
            if (e.op === '>=') return a >= b ? 1 : 0;
          }
          case 'bin': {
            const a = ev(e.a, sc), b = ev(e.b, sc);
            if (e.op === '+') return (typeof a === 'string' || typeof b === 'string') ? String(a) + String(b) : a + b;
            if (e.op === '-') return a - b;
            if (e.op === '*') return a * b;
            if (e.op === '/') return b === 0 ? 0 : a / b;
            if (e.op === '//') return b === 0 ? 0 : Math.floor(a / b);
            if (e.op === '%') return b === 0 ? 0 : a % b;
            if (e.op === '**') return Math.pow(a, b);
          }
          case 'call': {
            const args = e.args.map(x => ev(x, sc));
            if (e.name === 'print') { out.push(args.map(pyStr).join(' ')); return null; }
            if (e.name === 'range') {
              const n = args.length === 1 ? args[0] : args[1] - args[0];
              const start = args.length === 1 ? 0 : args[0];
              const stepv = args.length > 2 ? args[2] : 1;
              const arr = [];
              for (let k = 0; k < Math.max(0, Math.ceil(n / stepv)); k++) arr.push(start + k * stepv);
              return arr;
            }
            if (e.name === 'len') return typeof args[0] === 'string' ? args[0].length : (args[0] ? args[0].length : 0);
            if (e.name === 'abs') return Math.abs(args[0]);
            if (e.name === 'int') return parseInt(args[0], 10) || 0;
            if (e.name === 'float') return parseFloat(args[0]) || 0;
            if (e.name === 'str') return pyStr(args[0]);
            if (e.name === 'min') return Math.min.apply(null, args);
            if (e.name === 'max') return Math.max.apply(null, args);
            if (e.name === 'sum') return args[0].reduce((a, b) => a + b, 0);
            if (e.name === 'sorted') return args[0].slice().sort((a, b) => a - b);
            if (e.name === 'reversed') return args[0].slice().reverse();
            if (e.name === 'input') return promptInput ? promptInput() : '';
            if (e.name in funcs) {
              const f = funcs[e.name];
              const local = {};
              f.params.forEach((p, k) => local[p] = args[k]);
              try { exec1(f.body, local); } catch (ex) { if (ex && ex.__ret !== undefined) return ex.__ret; throw ex; }
              return null;
            }
            throw new Error('未实现的函数 ' + e.name + '()');
          }
        }
        return null;
      }
      function pyStr(v) {
        if (v === null) return 'None';
        if (v === true) return 'True';
        if (Array.isArray(v)) return '[' + v.map(pyStr).join(', ') + ']';
        return typeof v === 'string' ? v : String(v);
      }
      const funcs = {};
      let promptInput = null;
      function exec1(body, sc) {
        for (let k = 0; k < body.length; k++) {
          const st = body[k];
          if (++steps > 3000000) throw new Error('执行步数过多，可能是死循环');
          switch (st.k) {
            case 'assign': {
              const v = ev(st.e, sc);
              if (sc === globals) globals[st.name] = v; else sc[st.name] = v;
              break;
            }
            case 'expr': ev(st.e, sc); break;
            case 'if': if (truthy(ev(st.cond, sc))) exec1(st.body, sc); else if (st.orelse) exec1(st.orelse, sc); break;
            case 'while': { let g = 0; while (truthy(ev(st.cond, sc))) { if (++g > 200000) throw new Error('while 循环次数过多'); try { exec1(st.body, sc); } catch (ex) { if (ex && ex.__brk) break; if (ex && ex.__ret !== undefined) throw ex; throw ex; } } break; }
            case 'for': {
              const it = ev(st.it, sc);
              const arr = typeof it === 'string' ? it.split('') : it;
              for (let q = 0; q < arr.length; q++) {
                sc[st.v] = arr[q];
                try { exec1(st.body, sc); } catch (ex) { if (ex && ex.__brk) break; if (ex && ex.__ret !== undefined) throw ex; throw ex; }
              }
              break;
            }
            case 'def': funcs[st.name] = st; break;
            case 'return': { const r = st.e ? { __ret: ev(st.e, sc) } : { __ret: null }; throw r; }
            case 'break': throw { __brk: true };
            case 'continue': return;
            case 'pass': break;
          }
        }
      }
      return {
        run: function () { try { exec1(ast, globals); return null; } catch (ex) { if (ex && ex.__ret !== undefined) return null; if (ex && ex.__brk) return null; return ex.message || String(ex); } },
        funcs: funcs
      };
    }
    return { parse: parse, Interp: Interp };
  })();
  window.__wsftInternals.pysub = PYSUB;

  const PY_SAMPLE = `# 支持的 Python 子集：变量 / 算术 / 字符串 / print / if / while / for / 列表 / 函数
def fib(n):
    a = 0
    b = 1
    out = []
    for i in range(n):
        out.append(a)
        t = a + b
        a = b
        b = t
    return out

print("fib(10) =", fib(10))
total = 0
for x in fib(10):
    total = total + x
print("sum =", total)

i = 3
while i > 0:
    print("countdown", i)
    i = i - 1
print("done")`;

  G['python-online'] = function (host, cfg, slug) { return G['online-python-compiler'](host, cfg, slug); };
  G['online-python-compiler'] = function (host) {
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        ${TUI.field('Python 子集代码', TUI.area('pySrc', PY_SAMPLE, '', 16))}
        <div class="plabel">输出</div>
        <div class="ioout" id="pyOut" style="min-height:200px">点击「运行」查看结果。</div>
      </div>
      ${paneBox('Python 子集解释器', '这是一个用 JavaScript 手写的解释器（词法 → 语法树 → 求值），不是 Pyodide，也不会下载 CPython。',
      `<div class="shapes" style="margin-top:12px;gap:8px">
          <button class="btn-lime btn-sm" id="gStart">运行</button>
          <button class="btn-ghost btn-sm" id="gPause">清空输出</button>
          <button class="btn-ghost btn-sm" id="gReset">恢复示例</button>
        </div>
        <div class="plabel">已支持</div>
        <div class="note">变量与赋值 · 整数/浮点/字符串/布尔/None · 列表字面量与下标 · 算术 + - * / // % ** 与比较 · and/or/not · if / elif / else · while / for ... in range()/列表 · def / return / break / continue · print、len、range、abs、int、float、str、min、max、sum、sorted、reversed、list.append。<br>
        <b>明确不支持</b>：类、生成器、装饰器、异常处理、推导式、字典/集合、import 标准库（import 会被忽略）、切片与关键字参数。遇到不支持的语法会直接报错，而不是给你一个假结果。</div>`)}
    </div>`;
    function run() {
      const src = $('#pySrc').value;
      const out = [];
      try {
        const ast = PYSUB.parse(src);
        const it = PYSUB.Interp(ast, out);
        const err = it.run();
        $('#pyOut').innerHTML = (out.length ? esc(out.join('\n')) : '<span style="color:#8a8a8a">（没有输出）</span>') +
          (err ? '\n<span style="color:#ff6b6b">错误：' + esc(err) + '</span>' : '');
      } catch (e) {
        $('#pyOut').innerHTML = '<span style="color:#ff6b6b">语法错误：' + esc(e.message) + '</span>';
      }
    }
    ctlEl('#gStart').addEventListener('click', run);
    ctlEl('#gPause').addEventListener('click', () => { $('#pyOut').textContent = ''; });
    ctlEl('#gReset').addEventListener('click', () => { $('#pySrc').value = PY_SAMPLE; run(); });
    bindCtrl({ start: run, pause: () => { $('#pyOut').textContent = ''; }, reset: () => { $('#pySrc').value = PY_SAMPLE; run(); } });
    ctlEl('#gStart').textContent = '运行';
    ctlEl('#gPause').textContent = '清空输出';
    ctlEl('#gReset').textContent = '恢复示例';
    run();
  };

  /* ==========================================================================
     E. 音频 / 录制 / 视频生成 / 屏保（补全 build.mjs 路由到的其余 slug）
        —— 全部基于浏览器原生能力：Web Audio、getUserMedia、getDisplayMedia、
           MediaRecorder、canvas.captureStream、Wake Lock。
        —— 不伪造结果：浏览器只能直接封装 WebM（Chrome/Edge/Firefox）或 MP4
           （部分 Safari），页面会明确说明容器格式并给出 MP4 的替代路径。
     ========================================================================== */

  /* ---------------- 录制通用 ---------------- */
  function pickMime(list) {
    if (typeof MediaRecorder === 'undefined') return '';
    for (let i = 0; i < list.length; i++) {
      if (!MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(list[i])) return list[i];
    }
    return list[0] || '';
  }
  function pickVideoMime() { return pickMime(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=h264', 'video/mp4']); }
  function pickAudioMime() { return pickMime(['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']); }
  function extFor(m) { return /mp4/.test(m || '') ? 'mp4' : (/ogg/.test(m || '') ? 'ogg' : 'webm'); }
  function recorderFor(stream, mime, bps) {
    if (typeof MediaRecorder === 'undefined') return null;
    let chunks = [], resolveBlob = null;
    const blobP = new Promise(r => { resolveBlob = r; });
    const opts = {};
    if (mime) opts.mimeType = mime;
    if (bps) opts.videoBitsPerSecond = bps;
    let rec;
    try { rec = new MediaRecorder(stream, opts); }
    catch (e) { try { rec = new MediaRecorder(stream); } catch (e2) { return null; } }
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => resolveBlob(new Blob(chunks, { type: rec.mimeType || mime || 'video/webm' }));
    return { rec: rec, blob: () => blobP, reset: () => { chunks = []; } };
  }
  async function reqWakeLock() {
    try { if (navigator.wakeLock && navigator.wakeLock.request) return await navigator.wakeLock.request('screen'); } catch (e) { }
    return null;
  }
  function relWakeLock(l) { try { if (l && l.release) l.release(); } catch (e) { } }
  function fmtMS(t) { t = Math.max(0, t); return pad2(Math.floor(t / 60)) + ':' + pad2(Math.floor(t % 60)); }
  function fmtHMSx(t) {
    t = Math.max(0, Math.floor(t));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return (h ? pad2(h) + ':' : '') + pad2(m) + ':' + pad2(s);
  }
  function sizeStr(n) {
    if (!n) return '0 KB';
    if (window.fmtSize) return window.fmtSize(n);
    return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  }
  function noteName(m) { const N = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']; return N[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }

  /* ==========================================================================
     节拍器
     ========================================================================== */
  function metronomeUI(host) {
    const SIGN = { '2/4': 2, '3/4': 3, '4/4': 4, '5/4': 5, '6/8': 6, '7/8': 7 };
    const TERM = b => b < 60 ? 'Largo 广板' : b < 76 ? 'Adagio 慢板' : b < 108 ? 'Andante 行板' : b < 120 ? 'Moderato 中板' : b < 156 ? 'Allegro 快板' : b < 200 ? 'Presto 急板' : 'Prestissimo 最急板';
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap" style="width:100%">
          <div class="scorebar"><span>♩ = <b id="mtBpmOut">100</b></span><span>拍号 <b id="mtSigOut">4/4</b></span><span>小节 <b id="mtBarOut">1</b></span><span>术语 <b id="mtTerm">Moderato 中板</b></span></div>
          <div id="mtDots" style="display:flex;gap:12px;margin:18px 0;flex-wrap:wrap;min-height:60px"></div>
          <div class="runnote" id="mtPolyRow" style="min-height:18px"></div>
          <div class="runnote">点击圆点切换重音（亮色 = 强拍）；空格键开始 / 停止；在页面内按 T 打拍测速。</div>
        </div>
      </div>
      ${paneBox('节拍器', '用 Web Audio 的音频时钟排程（提前 120ms 预约），精度远高于 setInterval；含重音、细分、摇摆、复节奏、速度训练与静音练习。',
      `<div class="plabel">速度 BPM</div>${TUI.range('mtBpm', 20, 400, 100, 1)}
        <div class="plabel">拍号</div>${TUI.sel('mtSig', [{ v: '2/4', t: '2/4' }, { v: '3/4', t: '3/4' }, { v: '4/4', t: '4/4' }, { v: '5/4', t: '5/4' }, { v: '6/8', t: '6/8' }, { v: '7/8', t: '7/8' }], '4/4')}
        <div class="plabel">每拍细分</div>${TUI.sel('mtSub', [{ v: '1', t: '♩ 无细分' }, { v: '2', t: '♫ 八分' }, { v: '3', t: '三连音' }, { v: '4', t: '十六分' }], '1')}
        <div class="plabel">摇摆（后拍延迟 %）</div>${TUI.range('mtSwing', 0, 60, 0, 1)}
        <div class="plabel">复节奏层</div>${TUI.sel('mtPoly', [{ v: 'off', t: '关闭' }, { v: '3:2', t: '3:2（3 对 2）' }, { v: '4:3', t: '4:3' }, { v: '5:4', t: '5:4' }, { v: '2:3', t: '2:3' }], 'off')}
        <div class="plabel">音量</div>${TUI.range('mtVol', 0, 100, 70, 1)}
        <div class="plabel">速度训练</div>${TUI.sel('mtTrain', [{ v: 'off', t: '关闭' }, { v: '2', t: '每 2 小节 +1' }, { v: '4', t: '每 4 小节 +1' }, { v: '8', t: '每 8 小节 +1' }], 'off')}
        <div class="plabel">目标 BPM</div>${TUI.range('mtTarget', 40, 400, 140, 1)}
        <div class="plabel">静音练习</div>${TUI.sel('mtSilent', [{ v: '0:0', t: '关闭' }, { v: '1:1', t: '响 1 / 静 1' }, { v: '2:1', t: '响 2 / 静 1' }, { v: '3:1', t: '响 3 / 静 1' }, { v: '4:2', t: '响 4 / 静 2' }], '0:0')}
        <div class="shapes" style="margin-top:12px;gap:8px">
          <button class="btn-lime btn-sm" id="mtTap">打拍（Tap）</button>
          <button class="btn-ghost btn-sm" id="mtSave">保存预设</button>
          <button class="btn-ghost btn-sm" id="mtLoad">载入预设</button>
        </div>
        <div class="outbox" id="mtOut">未开始</div>`)}
    </div>`;
    const st = { playing: false, tick: 0, bar: 1, nextT: 0, nextP: 0, timer: null, taps: [] };
    let accents = [true, false, false, false];
    const num = () => SIGN[$('#mtSig').value];
    function buildDots() {
      const n = num();
      accents = accents.slice(0, n);
      while (accents.length < n) accents.push(false);
      const box = $('#mtDots'); box.innerHTML = '';
      for (let i = 0; i < n; i++) {
        const d = el('button', 'shape' + (accents[i] ? ' on' : ''), String(i + 1));
        d.style.cssText = 'width:56px;height:56px;border-radius:50%;font-size:15px;transition:transform .06s,box-shadow .06s';
        d.addEventListener('click', () => { accents[i] = !accents[i]; d.classList.toggle('on', accents[i]); });
        box.appendChild(d);
      }
    }
    function flash(i, kind) {
      const d = $('#mtDots').children[i % num()];
      if (!d) return;
      const col = kind === 'acc' ? '#d7f452' : kind === 'poly' ? '#c39bff' : '#8ecae6';
      d.style.transform = 'scale(1.22)'; d.style.boxShadow = '0 0 18px ' + col;
      setTimeout(() => { d.style.transform = ''; d.style.boxShadow = ''; }, 90);
    }
    function clickAt(t, kind, muted) {
      const c = ac(); if (!c || muted) return;
      const vol = (+$('#mtVol').value) / 100;
      const freq = kind === 'acc' ? 1760 : kind === 'beat' ? 1180 : kind === 'poly' ? 830 : 1560;
      const o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
      o.type = kind === 'poly' ? 'triangle' : 'square';
      o.frequency.setValueAtTime(freq, t);
      f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.9;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime((kind === 'sub' ? 0.12 : kind === 'poly' ? 0.18 : 0.34) * vol, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'sub' ? 0.028 : 0.06));
      o.connect(f); f.connect(g); g.connect(c.destination);
      o.start(t); o.stop(t + 0.09);
    }
    function schedule() {
      const c = ac(); if (!c) return;
      const bpm = +$('#mtBpm').value;
      const sub = +$('#mtSub').value;
      const n = num();
      const tickLen = (60 / bpm) / sub;
      const swing = (+$('#mtSwing').value) / 100;
      const look = c.currentTime + 0.12;
      const sb = $('#mtSilent').value.split(':').map(Number);
      while (st.nextT < look) {
        const inBar = st.tick % (n * sub);
        const beat = Math.floor(inBar / sub);
        const isBeat = (inBar % sub) === 0;
        let t = st.nextT;
        if (sub === 2 && (inBar % 2) === 1) t += swing * tickLen;
        let muted = false;
        if (sb[1] > 0) { const cyc = sb[0] + sb[1]; muted = ((st.bar - 1) % cyc) >= sb[0]; }
        const kind = isBeat ? (accents[beat] ? 'acc' : 'beat') : 'sub';
        clickAt(t, kind, muted);
        const dly = Math.max(0, (t - c.currentTime) * 1000), bi = beat, kd = kind, br = st.bar;
        setTimeout(() => { if (st.playing) { flash(bi, kd); $('#mtBarOut').textContent = br; } }, dly);
        st.tick++;
        if (st.tick % (n * sub) === 0) {
          st.bar++;
          const tr = +$('#mtTrain').value;
          if (tr && st.bar % tr === 1) {
            const cur = +$('#mtBpm').value, tgt = +$('#mtTarget').value;
            if (cur < tgt) {
              const nb = Math.min(tgt, cur + 1);
              $('#mtBpm').value = nb; $('#mtBpmV').textContent = nb;
              $('#mtBpmOut').textContent = nb; $('#mtTerm').textContent = TERM(nb);
            }
          }
        }
        st.nextT += tickLen;
      }
      const poly = $('#mtPoly').value;
      if (poly !== 'off') {
        const pr = poly.split(':').map(Number);
        const pLen = (60 / bpm) * pr[0] / pr[1];
        let guard = 0;
        while (st.nextP < look && guard++ < 64) {
          clickAt(st.nextP, 'poly', false);
          const dly = Math.max(0, (st.nextP - c.currentTime) * 1000);
          setTimeout(() => { if (st.playing) flash(0, 'poly'); }, dly);
          st.nextP += pLen;
        }
      }
    }
    function start() {
      if (st.playing) return;
      const c = ac(); if (!c) { window.toast('无法创建 AudioContext'); return; }
      if (c.state === 'suspended') c.resume().catch(() => { });
      st.playing = true; st.tick = 0; st.bar = 1;
      st.nextT = c.currentTime + 0.08; st.nextP = c.currentTime + 0.08;
      $('#mtOut').textContent = '播放中…';
      st.timer = setInterval(schedule, 25);
      schedule();
    }
    function stop() {
      st.playing = false;
      if (st.timer) clearInterval(st.timer);
      st.timer = null;
      $('#mtOut').textContent = '已停止';
    }
    onClean(() => { if (st.timer) clearInterval(st.timer); });
    $('#mtTap').addEventListener('click', () => {
      const now = performance.now();
      st.taps.push(now);
      if (st.taps.length > 6) st.taps.shift();
      if (st.taps.length >= 2) {
        let sum = 0;
        for (let i = 1; i < st.taps.length; i++) sum += st.taps[i] - st.taps[i - 1];
        const avg = sum / (st.taps.length - 1);
        if (avg > 120) {
          const bpm = clamp(Math.round(60000 / avg), 20, 400);
          $('#mtBpm').value = bpm; $('#mtBpmV').textContent = bpm;
          $('#mtBpmOut').textContent = bpm; $('#mtTerm').textContent = TERM(bpm);
        }
      }
      const c = ac(); if (c) clickAt(c.currentTime + 0.01, 'sub', false);
    });
    function snapshot() {
      return {
        bpm: +$('#mtBpm').value, sig: $('#mtSig').value, sub: $('#mtSub').value, swing: +$('#mtSwing').value,
        poly: $('#mtPoly').value, vol: +$('#mtVol').value, accents: accents.slice(),
        silent: $('#mtSilent').value, train: $('#mtTrain').value, target: +$('#mtTarget').value
      };
    }
    function apply(s) {
      $('#mtBpm').value = s.bpm; $('#mtBpmV').textContent = s.bpm; $('#mtBpmOut').textContent = s.bpm;
      $('#mtTerm').textContent = TERM(s.bpm);
      $('#mtSig').value = s.sig; $('#mtSigOut').textContent = s.sig;
      $('#mtSub').value = s.sub;
      $('#mtSwing').value = s.swing; $('#mtSwingV').textContent = s.swing;
      $('#mtPoly').value = s.poly;
      $('#mtVol').value = s.vol; $('#mtVolV').textContent = s.vol;
      $('#mtSilent').value = s.silent || '0:0'; $('#mtTrain').value = s.train || 'off';
      $('#mtTarget').value = s.target || 140; $('#mtTargetV').textContent = s.target || 140;
      accents = (s.accents || []).slice();
      buildDots(); updPoly();
    }
    $('#mtSave').addEventListener('click', () => {
      const name = window.prompt('预设名称', '练习 1');
      if (!name) return;
      const all = load('metronome.presets', {});
      all[name] = snapshot(); save('metronome.presets', all);
      window.toast('已保存预设「' + name + '」');
    });
    $('#mtLoad').addEventListener('click', () => {
      const all = load('metronome.presets', {});
      const names = Object.keys(all);
      if (!names.length) { window.toast('还没有保存过预设'); return; }
      const name = window.prompt('载入哪个预设？\n' + names.join('\n'), names[0]);
      if (!name || !all[name]) return;
      apply(all[name]); window.toast('已载入「' + name + '」');
    });
    function updPoly() {
      const v = $('#mtPoly').value;
      $('#mtPolyRow').textContent = v === 'off' ? '复节奏层：关闭' : '复节奏层：以 ' + v + ' 的独立速率叠加三角波点击（音高更低，便于分辨）。';
    }
    bindRange('#mtBpm', v => { $('#mtBpmOut').textContent = v; $('#mtTerm').textContent = TERM(+v); });
    bindRange('#mtSwing', () => { });
    bindRange('#mtTarget', () => { });
    bindRange('#mtVol', () => { });
    $('#mtSig').addEventListener('change', () => { $('#mtSigOut').textContent = $('#mtSig').value; buildDots(); });
    $('#mtPoly').addEventListener('change', updPoly);
    bindCtrl({ start: start, pause: stop, reset: () => { stop(); st.tick = 0; st.bar = 1; $('#mtBarOut').textContent = '1'; } });
    ctlEl('#gStart').textContent = '开始';
    ctlEl('#gPause').textContent = '停止';
    ctlEl('#gReset').textContent = '复位';
    keys({ ' ': () => { st.playing ? stop() : start(); }, t: () => $('#mtTap').click() });
    buildDots(); updPoly(); $('#mtTerm').textContent = TERM(100);
  }
  G['metronome'] = metronomeUI;

  /* ==========================================================================
     白噪声 / 环境音
     ========================================================================== */
  function liveCtx() { return (ACX && ACX.state !== 'closed') ? ACX : null; }
  function genNoise(type, n) {
    const d = new Float32Array(n);
    let peak = 1e-6;
    if (type === 'white' || type === 'grey' || type === 'blue' || type === 'violet') {
      if (type === 'white' || type === 'grey') {
        for (let i = 0; i < n; i++) { d[i] = Math.random() * 2 - 1; peak = Math.max(peak, Math.abs(d[i])); }
      } else {
        let prev = 0;
        for (let i = 0; i < n; i++) {
          const w = Math.random() * 2 - 1;
          d[i] = type === 'blue' ? (w - prev) * 0.5 : (w - 2 * prev + (i > 1 ? d[i - 2] : 0)) * 0.25;
          prev = w;
          peak = Math.max(peak, Math.abs(d[i]));
        }
      }
    } else if (type === 'pink') {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
        peak = Math.max(peak, Math.abs(d[i]));
      }
    } else {
      let last = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w);
        if (last > 1) last -= 2; if (last < -1) last += 2;
        d[i] = last * 3.2;
        peak = Math.max(peak, Math.abs(d[i]));
      }
    }
    const k = 0.86 / peak;
    for (let i = 0; i < n; i++) d[i] *= k;
    return d;
  }
  function whiteNoiseUI(host) {
    const COLORS = [['white', '白噪声（全频均匀）'], ['pink', '粉红噪声（−3dB/oct）'], ['brown', '布朗噪声（−6dB/oct 低沉）'], ['blue', '蓝噪声（+3dB/oct）'], ['violet', '紫噪声（+6dB/oct）'], ['grey', '灰噪声（近似等响度）']];
    const AMB = [['rain', '雨声'], ['ocean', '海浪'], ['wind', '风'], ['stream', '溪流'], ['fire', '壁炉'], ['crickets', '虫鸣']];
    const row = (k, label, on, lv) => `<div style="display:flex;align-items:center;gap:10px;margin:7px 0">
        ${TUI.chk('wn_' + k, label, on)}
        <div style="flex:1">${TUI.range('wnL_' + k, 0, 100, lv, 1)}</div></div>`;
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap" style="width:100%">
          <div class="scorebar"><span>状态 <b id="wnState">已停止</b></span><span>剩余 <b id="wnLeft">—</b></span><span>总输出 <b id="wnOut">—</b></span></div>
          <div id="wnWrap"></div>
          <div class="runnote">每个声部都是实时合成：噪声由 JS 生成缓冲循环播放，环境音用滤波器 + 随机瞬态合成。</div>
        </div>
      </div>
      ${paneBox('白噪声 / 环境音', '噪声颜色与自然声可以任意叠加；睡眠定时器到点后 8 秒淡出。',
      `<div class="plabel">总音量</div>${TUI.range('wnVol', 0, 100, 60, 1)}
        <div class="plabel" style="margin-top:10px">噪声颜色</div>${COLORS.map(c => row('c_' + c[0], c[1], false, 65)).join('')}
        <div class="plabel" style="margin-top:10px">环境音</div>${AMB.map(c => row('a_' + c[0], c[1], false, 60)).join('')}
        <div class="plabel" style="margin-top:10px">睡眠定时器</div>${TUI.sel('wnSleep', [{ v: '0', t: '关闭' }, { v: '5', t: '5 分钟' }, { v: '15', t: '15 分钟' }, { v: '30', t: '30 分钟' }, { v: '60', t: '60 分钟' }, { v: '120', t: '120 分钟' }], '0')}
        <div class="shapes" style="margin-top:12px;gap:8px">
          <button class="btn-lime btn-sm" id="gStart">播放</button>
          <button class="btn-ghost btn-sm" id="gPause">停止</button>
          <button class="btn-ghost btn-sm" id="gReset">全部关闭</button>
        </div>
        <div class="outbox" id="wnNote">提示：播放后系统可能要求一次用户交互才允许出声（浏览器自动播放策略）。</div>`)}
    </div>`;
    const C = mkCanvas($('#wnWrap'), 620, 170);
    let master = null, alive = [], timers = [], sleepAt = 0;
    const state = {};
    COLORS.concat(AMB).forEach(c => { state[c[0]] = false; });
    const keyOf = k => k.replace(/^[ca]_/, '');
    const isColor = k => k.charAt(0) === 'c';
    function ensureCtx() {
      const c = ac(); if (!c) return null;
      if (!master) { master = c.createGain(); master.gain.value = (+$('#wnVol').value) / 100 * 0.6; master.connect(c.destination); }
      return c;
    }
    function noiseSource(type) {
      const c = ac();
      const buf = c.createBuffer(1, Math.floor(c.sampleRate * 5), c.sampleRate);
      buf.getChannelData(0).set(genNoise(type, buf.length));
      const src = c.createBufferSource();
      src.buffer = buf; src.loop = true;
      return src;
    }
    function buildLayer(k) {
      const c = ensureCtx(); if (!c) return null;
      const g = c.createGain();
      g.gain.value = 0;
      g.connect(master);
      const out = { key: k, gain: g, nodes: [], stop: null };
      const name = keyOf(k);
      if (isColor(k)) {
        const src = noiseSource(name === 'grey' ? 'pink' : name);
        if (name === 'grey') {
          const hs = c.createBiquadFilter(); hs.type = 'highshelf'; hs.frequency.value = 1800; hs.gain.value = 7;
          src.connect(hs); hs.connect(g);
        } else src.connect(g);
        out.nodes.push(src); out.stop = () => { try { src.stop(); } catch (e) { } };
      } else if (name === 'rain') {
        const s1 = noiseSource('white'), bp = c.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.5;
        s1.connect(bp); bp.connect(g);
        const s2 = noiseSource('white'), hp = c.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 3500;
        const g2 = c.createGain(); g2.gain.value = 0.5;
        s2.connect(hp); hp.connect(g2); g2.connect(g);
        out.nodes.push(s1, s2);
        out.stop = () => { [s1, s2].forEach(s => { try { s.stop(); } catch (e) { } }); };
      } else if (name === 'ocean') {
        const s = noiseSource('brown'), lp = c.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 620; lp.Q.value = 0.7;
        const swell = c.createGain(); swell.gain.value = 0.7;
        s.connect(lp); lp.connect(swell); swell.connect(g);
        const lfo = c.createOscillator(), lg = c.createGain();
        lfo.frequency.value = 0.09; lg.gain.value = 0.55;
        lfo.connect(lg); lg.connect(swell.gain);
        lfo.start();
        out.nodes.push(s);
        out.stop = () => { try { s.stop(); } catch (e) { } try { lfo.stop(); } catch (e) { } };
      } else if (name === 'wind') {
        const s = noiseSource('brown'), lp = c.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 1.2;
        s.connect(lp); lp.connect(g);
        const lfo = c.createOscillator(), lg = c.createGain();
        lfo.frequency.value = 0.13; lg.gain.value = 330;
        lfo.connect(lg); lg.connect(lp.frequency);
        lfo.start();
        out.nodes.push(s);
        out.stop = () => { try { s.stop(); } catch (e) { } try { lfo.stop(); } catch (e) { } };
      } else if (name === 'stream') {
        const s = noiseSource('white'), bp = c.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.8;
        s.connect(bp); bp.connect(g);
        const lfo = c.createOscillator(), lg = c.createGain();
        lfo.frequency.value = 0.4; lg.gain.value = 400;
        lfo.connect(lg); lg.connect(bp.frequency);
        lfo.start();
        out.nodes.push(s);
        out.stop = () => { try { s.stop(); } catch (e) { } try { lfo.stop(); } catch (e) { } };
      } else if (name === 'fire') {
        const s = noiseSource('brown'), lp = c.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 900;
        s.connect(lp); lp.connect(g);
        out.nodes.push(s);
        out.stop = () => { try { s.stop(); } catch (e) { } };
        const t = setInterval(() => {
          if (!state[k]) return;
          const sh = c.createBuffer(1, Math.floor(c.sampleRate * 0.05), c.sampleRate);
          const sd = sh.getChannelData(0);
          for (let i = 0; i < sd.length; i++) sd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / sd.length, 3);
          const sn = c.createBufferSource(); sn.buffer = sh;
          const gg = c.createGain(); gg.gain.value = rf(0.06, 0.22);
          sn.connect(gg); gg.connect(g); sn.start();
        }, 260);
        timers.push(t);
      } else if (name === 'crickets') {
        const s = noiseSource('pink'), hp = c.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 3800;
        s.connect(hp); hp.connect(g);
        out.nodes.push(s);
        out.stop = () => { try { s.stop(); } catch (e) { } };
        const t = setInterval(() => {
          if (!state[k]) return;
          const c2 = ac(); if (!c2) return;
          const n = ri(2, 4);
          for (let i = 0; i < n; i++) {
            const o = c2.createOscillator(), gg = c2.createGain();
            o.type = 'triangle'; o.frequency.value = rf(4200, 5200);
            const t0 = c2.currentTime + i * 0.06;
            gg.gain.setValueAtTime(0.0001, t0);
            gg.gain.exponentialRampToValueAtTime(rf(0.05, 0.12), t0 + 0.006);
            gg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
            o.connect(gg); gg.connect(g);
            o.start(t0); o.stop(t0 + 0.07);
          }
        }, 900);
        timers.push(t);
      }
      return out;
    }
    function setVol(k) {
      const l = alive.find(x => x.key === k);
      if (!l || !liveCtx()) return;
      const on = state[k];
      l.gain.gain.value = on ? (+$('#wnL_' + k).value) / 100 * 0.85 : 0;
    }
    function start() {
      const c = ensureCtx(); if (!c) { window.toast('无法创建 AudioContext'); return; }
      if (c.state === 'suspended') c.resume().catch(() => { });
      let any = false;
      COLORS.concat(AMB).forEach(x => {
        const k = (COLORS.some(y => y[0] === x[0]) ? 'c_' : 'a_') + x[0];
        if (!state[k]) return;
        any = true;
        let l = alive.find(z => z.key === k);
        if (!l) { l = buildLayer(k); if (l) alive.push(l); }
        try { l.nodes.forEach(n => { if (n.start) n.start(); }); } catch (e) { }
      });
      $('#wnState').textContent = any ? '播放中' : '未选择声部';
      $('#wnNote').textContent = any ? '正在播放 ' + alive.filter(l => state[l.key]).length + ' 个声部。' : '请先勾选至少一个声部。';
      const mins = +$('#wnSleep').value;
      sleepAt = mins ? Date.now() + mins * 60000 : 0;
      updVolAll();
    }
    function stop(fade) {
      const c = ac();
      if (fade && c && master) {
        try {
          master.gain.cancelScheduledValues(c.currentTime);
          master.gain.setValueAtTime(master.gain.value, c.currentTime);
          master.gain.linearRampToValueAtTime(0.0001, c.currentTime + 8);
        } catch (e) { }
        setTimeout(() => reallyStop(), 8200);
        $('#wnState').textContent = '淡出中…';
        return;
      }
      reallyStop();
    }
    function reallyStop() {
      alive.forEach(l => { if (l.stop) try { l.stop(); } catch (e) { } try { l.gain.disconnect(); } catch (e) { } });
      alive = [];
      timers.splice(0).forEach(t => clearInterval(t));
      sleepAt = 0; $('#wnLeft').textContent = '—';
      const c = ac();
      if (c && master) { master.gain.cancelScheduledValues(c.currentTime); master.gain.value = (+$('#wnVol').value) / 100 * 0.6; }
      $('#wnState').textContent = '已停止';
    }
    function updVolAll() {
      const c = liveCtx();
      if (c && master) { master.gain.value = (+$('#wnVol').value) / 100 * 0.6; }
      COLORS.concat(AMB).forEach(x => {
        const k = (COLORS.some(y => y[0] === x[0]) ? 'c_' : 'a_') + x[0];
        setVol(k);
      });
    }
    COLORS.concat(AMB).forEach(x => {
      const pre = COLORS.some(y => y[0] === x[0]) ? 'c_' : 'a_';
      const k = pre + x[0];
      bindChk('#wn_' + k, on => {
        state[k] = on;
        if (on) {
          let l = alive.find(z => z.key === k);
          const c = ensureCtx();
          if (c) {
            if (!l) { l = buildLayer(k); if (l) alive.push(l); }
            try { l.nodes.forEach(n => { if (n.start) n.start(); }); } catch (e) { }
            if ($('#wnState').textContent === '已停止' || $('#wnState').textContent === '未选择声部') {
              $('#wnState').textContent = '播放中';
              const mins = +$('#wnSleep').value;
              sleepAt = mins ? Date.now() + mins * 60000 : 0;
            }
          }
        }
        setVol(k);
      });
      bindRange('#wnL_' + k, () => setVol(k));
    });
    bindRange('#wnVol', () => updVolAll());
    $('#wnSleep').addEventListener('change', () => {
      const mins = +$('#wnSleep').value;
      sleepAt = mins ? Date.now() + mins * 60000 : 0;
      $('#wnLeft').textContent = mins ? fmtHMSx(mins * 60) : '—';
    });
    const loop = Loop(() => {
      C.ctx.fillStyle = '#0d0d0d'; C.ctx.fillRect(0, 0, C.W, C.H);
      const act = alive.filter(l => state[l.key]);
      C.ctx.font = '600 13px Inter,sans-serif'; C.ctx.textAlign = 'left';
      if (!act.length) {
        C.ctx.fillStyle = '#5c5c5c'; C.ctx.fillText('未播放任何声部', 16, C.H / 2);
      } else {
        act.forEach((l, i) => {
          const y = 24 + i * 22;
          C.ctx.fillStyle = '#8a8a8a'; C.ctx.fillText(keyOf(l.key), 14, y);
          const w = (+$('#wnL_' + l.key).value) / 100 * (C.W - 130);
          C.ctx.fillStyle = '#d7f452'; C.ctx.fillRect(100, y - 10, w, 9);
        });
      }
      if (sleepAt) {
        const left = Math.max(0, (sleepAt - Date.now()) / 1000);
        $('#wnLeft').textContent = fmtHMSx(left);
        if (left <= 0) { sleepAt = 0; stop(true); window.toast('睡眠定时器到点，正在淡出'); }
      }
      $('#wnOut').textContent = act.length + ' 声部';
    });
    loop.start();
    bindCtrl({ start: start, pause: () => stop(false), reset: () => { COLORS.concat(AMB).forEach(x => { const pre = COLORS.some(y => y[0] === x[0]) ? 'c_' : 'a_'; const k = pre + x[0]; state[k] = false; const d = $('#wn_' + k); if (d) d.classList.remove('on'); }); reallyStop(); } });
    ctlEl('#gStart').textContent = '播放';
    ctlEl('#gPause').textContent = '停止';
    ctlEl('#gReset').textContent = '全部关闭';
    onClean(() => { reallyStop(); try { if (master) master.disconnect(); } catch (e) { } master = null; });
  }
  G['white-noise'] = whiteNoiseUI;

  /* ==========================================================================
     调音器
     ========================================================================== */
  function tunerUI(host) {
    const INST = [
      { v: 'chromatic', t: '半音阶（任意乐器）', notes: [] },
      { v: 'guitar', t: '吉他 E A D G B E', notes: [40, 45, 50, 55, 59, 64] },
      { v: 'bass', t: '贝斯 E A D G', notes: [28, 33, 38, 43] },
      { v: 'ukulele', t: '尤克里里 G C E A', notes: [67, 60, 64, 69] },
      { v: 'violin', t: '小提琴 G D A E', notes: [55, 62, 69, 76] },
      { v: 'viola', t: '中提琴 C G D A', notes: [48, 55, 62, 69] },
      { v: 'cello', t: '大提琴 C G D A', notes: [36, 43, 50, 57] },
      { v: 'mandolin', t: '曼陀林 G D A E', notes: [55, 62, 69, 76] }
    ];
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap" style="width:100%">
          <div class="scorebar"><span>音名 <b id="tnNote">—</b></span><span>频率 <b id="tnFreq">—</b></span><span>偏差 <b id="tnCents">—</b></span><span>目标 <b id="tnTarget">—</b></span></div>
          <div id="tnWrap"></div>
          <div id="tnStrings" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"></div>
          <div class="runnote" id="tnMsg">点击「开始调音」并允许麦克风权限。检测用自相关（time-domain），低音需要更长的稳定音。</div>
          <div class="warnbox" id="tnErr" style="display:none"></div>
        </div>
      </div>
      ${paneBox('调音器', '本地做音高检测（自相关 + 抛物线插值），声音不上传；可选择乐器调弦或播放参考音。',
      `<div class="plabel">乐器 / 调弦</div>${TUI.sel('tnInst', INST.map(i => ({ v: i.v, t: i.t })), 'guitar')}
        <div class="plabel">显示方式</div>${TUI.sel('tnView', [{ v: 'needle', t: '指针表' }, { v: 'strobe', t: '频闪条纹' }], 'needle')}
        <div class="plabel">参考音 A4（Hz）</div>${TUI.range('tnA4', 415, 445, 440, 1)}
        <div class="plabel">灵敏度</div>${TUI.range('tnGate', 1, 20, 6, 1)}
        <div class="shapes" style="margin-top:12px;gap:8px">
          <button class="btn-lime btn-sm" id="gStart">开始调音</button>
          <button class="btn-ghost btn-sm" id="gPause">停止</button>
          <button class="btn-ghost btn-sm" id="gReset">清除</button>
        </div>
        <div class="outbox" id="tnOut">等待麦克风…</div>`)}
    </div>`;
    const C = mkCanvas($('#tnWrap'), 620, 190);
    let stream = null, analyser = null, buf = null, raf = null, live = false, frame = 0, lastF = -1;
    function inst() { return INST.find(i => i.v === $('#tnInst').value) || INST[0]; }
    function buildStrings() {
      const box = $('#tnStrings'); box.innerHTML = '';
      inst().notes.forEach(m => {
        const b = el('button', 'btn-ghost btn-sm', esc(noteName(m)));
        b.style.cssText = 'min-width:64px';
        b.addEventListener('click', () => {
          const c = ac(); if (!c) return;
          if (c.state === 'suspended') c.resume().catch(() => { });
          const f = midiFreq(m) * (a4() / 440);
          const o = c.createOscillator(), g = c.createGain();
          o.type = 'sine'; o.frequency.value = f;
          const t0 = c.currentTime;
          g.gain.setValueAtTime(0.0001, t0);
          g.gain.exponentialRampToValueAtTime(0.28, t0 + 0.03);
          g.gain.setValueAtTime(0.28, t0 + 1.6);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.2);
          o.connect(g); g.connect(c.destination);
          o.start(t0); o.stop(t0 + 2.3);
        });
        box.appendChild(b);
      });
    }
    function a4() { return +$('#tnA4').value; }
    function detect(d, sr) {
      const n = Math.min(d.length, 4096);
      let rms = 0;
      for (let i = 0; i < n; i++) rms += d[i] * d[i];
      rms = Math.sqrt(rms / n);
      if (rms < (+$('#tnGate').value) / 800) return -1;
      const lagMax = Math.min(2048, Math.floor(n / 2));
      const win = Math.min(1536, n);
      const corr = new Float32Array(lagMax + 1);
      let bestLag = -1, bestVal = 0;
      for (let lag = 2; lag <= lagMax; lag++) {
        let s = 0, e = 0;
        const lim = Math.min(win, n - lag);
        for (let i = 0; i < lim; i++) { s += d[i] * d[i + lag]; e += d[i] * d[i]; }
        const v = e > 0 ? s / e : 0;
        corr[lag] = v;
        if (v > bestVal) { bestVal = v; bestLag = lag; }
      }
      if (bestLag < 3 || bestVal < 0.35) return -1;
      // 取第一个显著峰值，避免选到倍周期
      for (let lag = 3; lag < bestLag - 1; lag++) {
        if (corr[lag] > corr[lag - 1] && corr[lag] >= corr[lag + 1] && corr[lag] > bestVal * 0.86) { bestLag = lag; break; }
      }
      const y1 = corr[bestLag - 1] || 0, y2 = corr[bestLag], y3 = corr[bestLag + 1] || 0;
      const den = (y1 - 2 * y2 + y3);
      const shift = den ? 0.5 * (y1 - y3) / den : 0;
      const period = bestLag + (isFinite(shift) ? clamp(shift, -0.5, 0.5) : 0);
      if (period <= 0) return -1;
      return sr / period;
    }
    function drawNeedle(f, cents) {
      const cx = C.W / 2, cy = C.H - 24, R = C.H - 44;
      C.ctx.strokeStyle = '#2a2a2a'; C.ctx.lineWidth = 2;
      C.ctx.beginPath(); C.ctx.arc(cx, cy, R, Math.PI, Math.PI * 2); C.ctx.stroke();
      for (let d = -50; d <= 50; d += 10) {
        const a = Math.PI + (d + 50) / 100 * Math.PI;
        const x1 = cx + Math.cos(a) * (R - (d % 50 === 0 ? 16 : 8));
        const y1 = cy + Math.sin(a) * (R - (d % 50 === 0 ? 16 : 8));
        C.ctx.strokeStyle = d === 0 ? '#d7f452' : '#3a3a3a';
        C.ctx.beginPath(); C.ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); C.ctx.lineTo(x1, y1); C.ctx.stroke();
      }
      if (isFinite(cents)) {
        const cc = clamp(cents, -50, 50);
        const a = Math.PI + (cc + 50) / 100 * Math.PI;
        C.ctx.strokeStyle = Math.abs(cc) < 4 ? '#d7f452' : '#ff8fb1';
        C.ctx.lineWidth = 4; C.ctx.lineCap = 'round';
        C.ctx.beginPath(); C.ctx.moveTo(cx, cy); C.ctx.lineTo(cx + Math.cos(a) * (R - 14), cy + Math.sin(a) * (R - 14)); C.ctx.stroke();
      }
      C.ctx.fillStyle = '#5c5c5c'; C.ctx.font = '12px Inter,sans-serif'; C.ctx.textAlign = 'center';
      C.ctx.fillText('−50¢', cx - R + 12, cy - 6); C.ctx.fillText('+50¢', cx + R - 12, cy - 6);
    }
    function drawStrobe(cents) {
      const w = 14, n = Math.floor(C.W / w);
      const dir = isFinite(cents) ? (cents > 0 ? 1 : -1) : 0;
      const phase = dir ? (performance.now() / Math.max(20, 400 - Math.abs(cents) * 6)) % 1 : 0;
      for (let i = 0; i < n; i++) {
        const off = Math.abs(((i / n + phase) % 1) - 0.5) * 2;
        const v = isFinite(cents) ? Math.max(0.06, 1 - Math.abs(cents) / 50) * (1 - off * 0.7) : 0.06;
        C.ctx.fillStyle = Math.abs(cents) < 4 ? 'rgba(215,244,82,' + v + ')' : 'rgba(160,180,200,' + v + ')';
        C.ctx.fillRect(i * w + 2, 24, w - 6, C.H - 60);
      }
      C.ctx.fillStyle = '#d7f452'; C.ctx.fillRect(C.W / 2 - 2, 16, 4, C.H - 44);
    }
    function loop() {
      if (!analyser) { raf = requestAnimationFrame(loop); return; }
      if (buf == null || buf.length !== analyser.fftSize) buf = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(buf);
      frame++;
      let f = -1;
      if (frame % 3 === 0) { f = detect(buf, analyser.context.sampleRate); lastF = f; }
      else f = lastF;
      C.ctx.fillStyle = '#0d0d0d'; C.ctx.fillRect(0, 0, C.W, C.H);
      const view = $('#tnView').value;
      if (likeFreq(f)) {
        const midi = 69 + 12 * Math.log2(f / a4());
        const m = Math.round(midi);
        const cents = (midi - m) * 100;
        $('#tnNote').textContent = noteName(m);
        $('#tnFreq').textContent = f.toFixed(1) + ' Hz';
        $('#tnCents').textContent = (cents >= 0 ? '+' : '') + cents.toFixed(0) + ' ¢';
        const list = inst().notes;
        if (list.length) {
          let near = list[0], best = 1e9;
          list.forEach(x => { const c2 = Math.abs(1200 * Math.log2(f / (midiFreq(x) * a4() / 440))); if (c2 < best) { best = c2; near = x; } });
          $('#tnTarget').textContent = noteName(near) + '（差 ' + best.toFixed(0) + '¢）';
        } else $('#tnTarget').textContent = '半音阶';
        $('#tnOut').textContent = '检测中：' + f.toFixed(1) + ' Hz';
        if (view === 'strobe') drawStrobe(cents); else drawNeedle(f, cents);
      } else {
        if (view === 'strobe') drawStrobe(Infinity); else drawNeedle(-1, Infinity);
        C.ctx.fillStyle = '#5c5c5c'; C.ctx.font = '13px Inter,sans-serif'; C.ctx.textAlign = 'center';
        C.ctx.fillText('没有稳定的音高 — 请靠近麦克风、减小环境噪声', C.W / 2, 20);
      }
      raf = requestAnimationFrame(loop);
    }
    function likeFreq(f) { return isFinite(f) && f > 25 && f < 4200; }
    async function start() {
      stop();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { fail('当前浏览器不支持 getUserMedia（需要 https 或 localhost）。'); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        const c = ac(); if (!c) { fail('无法创建 AudioContext。'); return; }
        if (c.state === 'suspended') c.resume().catch(() => { });
        const src = c.createMediaStreamSource(stream);
        analyser = c.createAnalyser();
        analyser.fftSize = 4096;
        src.connect(analyser);
        $('#tnErr').style.display = 'none';
        $('#tnMsg').textContent = '监听中 —— 拨动一根弦或吹一个长音。';
        $('#tnOut').textContent = '监听中…';
        live = true; loop();
      } catch (e) { fail((e && (e.name ? e.name + ' · ' : '') + (e.message || '')) || '未知错误'); }
    }
    function fail(msg) {
      $('#tnErr').style.display = 'block';
      $('#tnErr').innerHTML = '<b>无法访问麦克风：</b>' + esc(msg) + '<br>请检查权限与输入设备（无头环境通常没有麦克风，属于预期）。';
      $('#tnOut').textContent = '失败';
    }
    function stop() {
      live = false;
      if (raf) cancelAnimationFrame(raf); raf = null;
      if (stream) { stream.getTracks().forEach(t => { try { t.stop(); } catch (e) { } }); stream = null; }
      analyser = null;
      $('#tnMsg').textContent = '已停止。点击「开始调音」重新连接。';
    }
    onClean(stop);
    $('#tnInst').addEventListener('change', buildStrings);
    bindRange('#tnA4', () => { });
    bindRange('#tnGate', () => { });
    $('#tnView').addEventListener('change', () => { });
    bindCtrl({ start: start, pause: stop, reset: () => { $('#tnNote').textContent = '—'; $('#tnFreq').textContent = '—'; $('#tnCents').textContent = '—'; $('#tnTarget').textContent = '—'; } });
    ctlEl('#gStart').textContent = '开始调音';
    ctlEl('#gPause').textContent = '停止';
    ctlEl('#gReset').textContent = '清除读数';
    buildStrings();
    C.ctx.fillStyle = '#0d0d0d'; C.ctx.fillRect(0, 0, C.W, C.H);
  }
  G['tuner'] = tunerUI;

  /* ==========================================================================
     录音机（麦克风）
     ========================================================================== */
  function voiceRecorderUI(host) {
    const mime = pickAudioMime();
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap" style="width:100%">
          <div class="scorebar"><span>计时 <b id="vrTime">00:00</b></span><span>状态 <b id="vrState">未开始</b></span><span>片段 <b id="vrCount">0</b></span></div>
          <div id="vrWrap"></div>
          <div class="runnote">录音不会离开你的设备；页面关闭即丢弃，请及时下载。</div>
          <div class="warnbox" id="vrErr" style="display:none"></div>
        </div>
      </div>
      ${paneBox('在线录音机', 'getUserMedia 采集 → MediaRecorder 封装（' + (mime || '浏览器默认') + '）；同时用 PCM 缓冲保证能导出无损 WAV。',
      `<div class="plabel">输入设备</div>${TUI.sel('vrDev', [{ v: '', t: '默认麦克风' }], '')}
        <div class="plabel">增益（监听表）</div>${TUI.range('vrGain', 1, 20, 6, 1)}
        <div class="shapes" style="margin-top:12px;gap:8px">
          <button class="btn-lime btn-sm" id="vrRec">开始录音</button>
          <button class="btn-ghost btn-sm" id="vrPause">暂停</button>
          <button class="btn-ghost btn-sm" id="vrStop">停止</button>
        </div>
        <div class="plabel" style="margin-top:12px">录音列表</div>
        <div class="outbox" id="vrList">还没有录音。</div>
        <div class="runnote">WAV 由 PCM 缓冲编码（16bit 单声道）；WebM/Opus 是浏览器原生输出，体积更小。MP3 需要编码器，本站不伪造——如需 MP3 请用「音频转换」工具。</div>`)}
    </div>`;
    const C = mkCanvas($('#vrWrap'), 620, 140);
    let stream = null, ctxA = null, analyser = null, data = null, raf = null;
    let rec = null, chunks = [], pcm = [], recording = false, paused = false, t0 = 0, elapsed = 0, items = [], seq = 0;
    function fail(msg) {
      $('#vrErr').style.display = 'block';
      $('#vrErr').innerHTML = '<b>无法录音：</b>' + esc(msg) + '<br>请检查麦克风权限与设备。';
      $('#vrState').textContent = '失败';
    }
    async function connect() {
      if (stream) return true;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { fail('当前浏览器不支持 getUserMedia。'); return false; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        const c = ac(); if (!c) { fail('无法创建 AudioContext。'); return false; }
        ctxA = c;
        if (c.state === 'suspended') c.resume().catch(() => { });
        const src = c.createMediaStreamSource(stream);
        analyser = c.createAnalyser(); analyser.fftSize = 2048;
        data = new Uint8Array(analyser.fftSize);
        src.connect(analyser);
        const sp = c.createScriptProcessor(4096, 1, 1);
        sp.onaudioprocess = e => {
          if (recording && !paused) pcm.push(new Float32Array(e.inputBuffer.getChannelData(0)));
        };
        const sil = c.createGain(); sil.gain.value = 0;
        src.connect(sp); sp.connect(sil); sil.connect(c.destination);
        if (navigator.mediaDevices.enumerateDevices) {
          try {
            const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
            const sel = $('#vrDev');
            sel.innerHTML = devs.map((d, i) => '<option value="' + esc(d.deviceId) + '">' + esc(d.label || ('麦克风 ' + (i + 1))) + '</option>').join('');
          } catch (e) { }
        }
        $('#vrErr').style.display = 'none';
        meter();
        return true;
      } catch (e) { fail((e && (e.name ? e.name + ' · ' : '') + (e.message || '')) || '未知错误'); return false; }
    }
    function meter() {
      if (!analyser) return;
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs((data[i] - 128) / 128));
      C.ctx.fillStyle = '#0d0d0d'; C.ctx.fillRect(0, 0, C.W, C.H);
      const gain = (+$('#vrGain').value) / 3;
      C.ctx.strokeStyle = recording ? '#ff8fb1' : '#d7f452'; C.ctx.lineWidth = 2;
      C.ctx.beginPath();
      for (let i = 0; i < data.length; i++) {
        const x = i / data.length * C.W, y = C.H / 2 + ((data[i] - 128) / 128) * gain * C.H * 0.5;
        i ? C.ctx.lineTo(x, y) : C.ctx.moveTo(x, y);
      }
      C.ctx.stroke();
      C.ctx.fillStyle = 'rgba(0,0,0,0)';
      if (recording) {
        const w = Math.min(1, peak * 2.2) * C.W;
        C.ctx.fillStyle = peak > 0.98 ? '#ff6b6b' : '#d7f452';
        C.ctx.fillRect(0, C.H - 8, w, 6);
      }
      raf = requestAnimationFrame(meter);
    }
    function updTime() { $('#vrTime').textContent = fmtMS(elapsed); }
    async function startRec() {
      if (recording) return;
      if (!(await connect())) return;
      if (typeof MediaRecorder === 'undefined') { fail('当前浏览器不支持 MediaRecorder。'); return; }
      const r = recorderFor(stream, mime);
      if (!r) { fail('MediaRecorder 初始化失败。'); return; }
      rec = r.rec; chunks = []; pcm = []; seq++;
      const origStop = rec.onstop;
      rec.onstop = async e => {
        if (origStop) { try { origStop(e); } catch (e2) { } }
        const blob = await r.blob();
        items.push({ name: '录音 ' + seq, blob: blob, dur: elapsed, pcm: pcm });
        renderList();
        $('#vrState').textContent = '已停止';
      };
      rec.start(200);
      recording = true; paused = false; t0 = performance.now() - elapsed * 1000;
      $('#vrState').textContent = '录音中';
    }
    function stopRec() {
      if (!recording) return;
      try { if (rec.state !== 'inactive') rec.stop(); } catch (e) { }
      recording = false; paused = false;
    }
    function renderList() {
      const box = $('#vrList');
      $('#vrCount').textContent = items.length;
      if (!items.length) { box.innerHTML = '还没有录音。'; return; }
      box.innerHTML = items.map((it, i) => {
        const url = URL.createObjectURL(it.blob);
        onClean(() => URL.revokeObjectURL(url));
        return `<div style="border-top:1px solid #242424;padding:10px 0">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <input id="vrn${i}" value="${esc(it.name)}" style="width:150px">
            <span class="mini">${fmtMS(it.dur)} · ${sizeStr(it.blob.size)} · ${extFor(it.blob.type)}</span>
          </div>
          <audio controls src="${url}" style="width:100%;margin-top:8px"></audio>
          <div class="shapes" style="margin-top:8px;gap:8px">
            <button class="btn-ghost btn-sm" data-dl="${i}">下载原始</button>
            <button class="btn-ghost btn-sm" data-wav="${i}">导出 WAV</button>
            <button class="btn-ghost btn-sm" data-del="${i}">删除</button>
          </div></div>`;
      }).join('');
      $$('[data-dl]', box).forEach(b => b.addEventListener('click', () => {
        const i = +b.dataset.dl, it = items[i];
        const nm = ($('#vrn' + i) ? $('#vrn' + i).value : it.name) || it.name;
        window.downloadBlob(it.blob, nm + '.' + extFor(it.blob.type));
      }));
      $$('[data-wav]', box).forEach(b => b.addEventListener('click', () => {
        const i = +b.dataset.wav, it = items[i];
        if (!it.pcm || !it.pcm.length) { window.toast('这一条没有 PCM 缓冲（录制时页面被挂起）'); return; }
        const samples = it.pcm.reduce((a, x) => a + x.length, 0);
        const all = new Float32Array(samples);
        let o = 0;
        it.pcm.forEach(x => { all.set(x, o); o += x.length; });
        const sr = ctxA ? ctxA.sampleRate : 44100;
        const nm = ($('#vrn' + i) ? $('#vrn' + i).value : it.name) || it.name;
        window.downloadBlob(new Blob([encodeWAV([all], sr)], { type: 'audio/wav' }), nm + '.wav');
      }));
      $$('[data-del]', box).forEach(b => b.addEventListener('click', () => {
        items.splice(+b.dataset.del, 1); renderList();
      }));
    }
    const timer = setInterval(() => {
      if (recording && !paused) { elapsed = (performance.now() - t0) / 1000; updTime(); }
    }, 100);
    onClean(() => clearInterval(timer));
    $('#vrRec').addEventListener('click', () => { if (recording) { $('#vrRec').textContent = '开始录音'; stopRec(); } else { elapsed = 0; updTime(); $('#vrRec').textContent = '结束本次'; startRec(); } });
    $('#vrPause').addEventListener('click', () => {
      if (!rec) return;
      if (!recording) { window.toast('当前没有在录音'); return; }
      if (!paused) { try { rec.pause(); } catch (e) { } paused = true; $('#vrState').textContent = '已暂停'; }
      else { try { rec.resume(); } catch (e) { } paused = false; t0 = performance.now() - elapsed * 1000; $('#vrState').textContent = '录音中'; }
    });
    $('#vrStop').addEventListener('click', () => { if (recording) { $('#vrRec').textContent = '开始录音'; stopRec(); } else window.toast('当前没有在录音'); });
    bindRange('#vrGain', () => { });
    bindCtrl({ start: () => { elapsed = 0; updTime(); startRec(); }, pause: () => { if (recording && !paused) { try { rec.pause(); } catch (e) { } paused = true; } }, reset: () => { items = []; renderList(); } });
    ctlEl('#gStart').textContent = '开始录音';
    ctlEl('#gPause').textContent = '暂停 / 继续';
    ctlEl('#gReset').textContent = '清空列表';
    onClean(() => {
      if (recording) { try { rec.stop(); } catch (e) { } }
      if (stream) stream.getTracks().forEach(t => { try { t.stop(); } catch (e) { } });
      if (raf) cancelAnimationFrame(raf);
    });
    updTime(); renderList();
    C.ctx.fillStyle = '#0d0d0d'; C.ctx.fillRect(0, 0, C.W, C.H);
  }
  G['voice-recorder'] = voiceRecorderUI;

  /* ==========================================================================
     屏幕录制
     ========================================================================== */
  function screenRecorderUI(host) {
    const vmime = pickVideoMime();
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap" style="width:100%">
          <div class="scorebar"><span>计时 <b id="srTime">00:00</b></span><span>状态 <b id="srState">未开始</b></span><span>输出 <b id="srNote">${esc(vmime || '不支持')}</b></span></div>
          <div id="srWrap"></div>
          <div class="runnote">录制画面为本页 canvas 合成结果（屏幕 + 可选摄像头小窗），音频为麦克风与系统声音的混音。</div>
          <div class="warnbox" id="srErr" style="display:none"></div>
        </div>
      </div>
      ${paneBox('屏幕录制', 'getDisplayMedia 捕获屏幕 / 窗口 / 标签页，可选摄像头画中画与麦克风；MediaRecorder 本地封装，无时长限制、无水印。',
      `<div class="plabel">分辨率</div>${TUI.sel('srSize', [{ v: '720', t: '1280 × 720（省资源）' }, { v: '1080', t: '1920 × 1080' }], '720')}
        <div class="plabel">码率（Mbps）</div>${TUI.range('srBps', 1, 12, 4, 1)}
        <div class="plabel">选项</div>
        ${TUI.chk('srMic', '录入麦克风', true)}
        ${TUI.chk('srCam', '摄像头画中画', false)}
        ${TUI.chk('srSys', '录入系统 / 标签页声音', true)}
        <div class="shapes" style="margin-top:12px;gap:8px">
          <button class="btn-lime btn-sm" id="srRec">开始录制</button>
          <button class="btn-ghost btn-sm" id="srPause">暂停</button>
          <button class="btn-ghost btn-sm" id="srStop">停止并保存</button>
        </div>
        <div class="outbox" id="srOut">选择「整个屏幕」「窗口」或「标签页」由浏览器弹窗决定。</div>
        <div class="runnote">浏览器只提供 WebM（Chrome / Firefox / Edge）或 MP4（部分 Safari）。想要 MP4：先录成 WebM，再用本站「视频转换」把容器转成 MP4——本地完成，不上传。裁剪请用「视频裁剪」。</div>`)}
    </div>`;
    const C = mkCanvas($('#srWrap'), 640, 360);
    let disp = null, mic = null, cam = null, comp = null, compCtx = null, raf = null;
    let recApi = null, recording = false, paused = false, t0 = 0, elapsed = 0, lastBlob = null;
    function fail(m) {
      $('#srErr').style.display = 'block';
      $('#srErr').innerHTML = '<b>无法开始：</b>' + esc(m) + '<br>屏幕共享需要 https 或 localhost，并且必须由用户点击触发。';
      $('#srState').textContent = '失败';
    }
    function drawComposite() {
      const W = comp.width, H = comp.height;
      compCtx.fillStyle = '#000'; compCtx.fillRect(0, 0, W, H);
      try { if (disp && disp.videoWidth) compCtx.drawImage(disp, 0, 0, W, H); } catch (e) { }
      if (cam && cam.videoWidth) {
        const s = Math.round(H * 0.26);
        const x = W - s - 24, y = H - s - 24;
        compCtx.save();
        compCtx.beginPath(); compCtx.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2); compCtx.closePath();
        compCtx.clip();
        const ar = cam.videoWidth / cam.videoHeight;
        let dw = s, dh = s;
        if (ar > 1) dw = s * ar; else dh = s / ar;
        compCtx.drawImage(cam, x + (s - dw) / 2, y + (s - dh) / 2, dw, dh);
        compCtx.restore();
        compCtx.strokeStyle = '#d7f452'; compCtx.lineWidth = 3;
        compCtx.beginPath(); compCtx.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2); compCtx.stroke();
      }
      C.ctx.fillStyle = '#0d0d0d'; C.ctx.fillRect(0, 0, C.W, C.H);
      const k = Math.min(C.W / W, C.H / H);
      const dw = W * k, dh = H * k;
      C.ctx.drawImage(comp, (C.W - dw) / 2, (C.H - dh) / 2, dw, dh);
      if (!disp) {
        C.ctx.fillStyle = '#5c5c5c'; C.ctx.font = '14px Inter,sans-serif'; C.ctx.textAlign = 'center';
        C.ctx.fillText('预览：点击「开始录制」后在此显示屏幕与摄像头合成画面', C.W / 2, C.H / 2);
      }
      raf = requestAnimationFrame(drawComposite);
    }
    async function start() {
      if (recording) return;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) { fail('当前浏览器不支持 getDisplayMedia。'); return; }
      try {
        disp = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: $('#srSys').classList.contains('on') });
      } catch (e) { fail('已取消或拒绝屏幕共享。'); return; }
      try {
        if ($('#srMic').classList.contains('on')) mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch (e) { mic = null; window.toast('麦克风不可用，继续录制画面'); }
      try {
        if ($('#srCam').classList.contains('on')) cam = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 320 } });
      } catch (e) { cam = null; window.toast('摄像头不可用，跳过画中画'); }
      const target = +$('#srSize').value;
      comp = document.createElement('canvas');
      comp.width = target === '1080' ? 1920 : 1280;
      comp.height = target === '1080' ? 1080 : 720;
      compCtx = comp.getContext('2d');
      if (!raf) drawComposite();
      const videoStream = comp.captureStream ? comp.captureStream(30) : null;
      if (!videoStream) { fail('当前浏览器不支持 canvas.captureStream。'); return; }
      const c = ac();
      let audioTrack = null;
      if (c && (mic || disp.getAudioTracks().length)) {
        const dest = c.createMediaStreamDestination();
        if (mic) { const s = c.createMediaStreamSource(mic); s.connect(dest); }
        if (disp.getAudioTracks().length) { try { const s2 = c.createMediaStreamSource(disp); s2.connect(dest); } catch (e) { } }
        audioTrack = dest.stream.getAudioTracks()[0];
      }
      if (audioTrack) videoStream.addTrack(audioTrack);
      recApi = recorderFor(videoStream, vmime, (+$('#srBps').value) * 1000000);
      if (!recApi) { fail('MediaRecorder 初始化失败。'); return; }
      const track = disp.getVideoTracks()[0];
      if (track) track.addEventListener('ended', () => { if (recording) stop(); });
      recApi.rec.start(500);
      recording = true; paused = false; t0 = performance.now() - elapsed * 1000;
      $('#srState').textContent = '录制中';
      $('#srErr').style.display = 'none';
      $('#srOut').textContent = '录制中：可以最小化本页（不要关闭），录制在后台继续。';
    }
    async function stop() {
      if (!recording) { window.toast('当前没有在录制'); return; }
      recording = false;
      const api = recApi;
      try { if (api.rec.state !== 'inactive') api.rec.stop(); } catch (e) { }
      $('#srState').textContent = '正在封装…';
      const blob = await api.blob();
      lastBlob = blob;
      const ext = extFor(blob.type || vmime);
      $('#srOut').innerHTML = '录制完成：' + sizeStr(blob.size) + ' · ' + esc(blob.type || ext) +
        ' <button class="btn-ghost btn-sm" id="srDl" style="margin-left:8px">下载</button>';
      $('#srDl').addEventListener('click', () => window.downloadBlob(blob, 'screen-recording.' + ext));
      $('#srState').textContent = '已完成';
      cleanupStreams();
      elapsed = 0;
    }
    function cleanupStreams() {
      [disp, mic, cam].forEach(s => { if (s) s.getTracks().forEach(t => { try { t.stop(); } catch (e) { } }); });
      disp = mic = cam = null;
    }
    const timer = setInterval(() => {
      if (recording && !paused) { elapsed = (performance.now() - t0) / 1000; $('#srTime').textContent = fmtMS(elapsed); }
    }, 200);
    onClean(() => clearInterval(timer));
    $('#srRec').addEventListener('click', () => {
      if (recording) { stop(); return; }
      elapsed = 0; start();
    });
    $('#srPause').addEventListener('click', () => {
      if (!recording || !recApi) { window.toast('当前没有在录制'); return; }
      if (!paused) { try { recApi.rec.pause(); } catch (e) { } paused = true; $('#srState').textContent = '已暂停'; }
      else { try { recApi.rec.resume(); } catch (e) { } paused = false; t0 = performance.now() - elapsed * 1000; $('#srState').textContent = '录制中'; }
    });
    $('#srStop').addEventListener('click', stop);
    ['srMic', 'srCam', 'srSys'].forEach(id => bindChk('#' + id, () => { }));
    bindRange('#srBps', () => { });
    bindCtrl({ start: () => { elapsed = 0; start(); }, pause: () => { if (recording && recApi) { try { recApi.rec.pause(); } catch (e) { } paused = true; } }, reset: () => { if (recording) stop(); } });
    ctlEl('#gStart').textContent = '开始录制';
    ctlEl('#gPause').textContent = '暂停 / 继续';
    ctlEl('#gReset').textContent = '停止';
    onClean(() => { if (recording && recApi) { try { recApi.rec.stop(); } catch (e) { } } cleanupStreams(); if (raf) cancelAnimationFrame(raf); });
    $('#srTime').textContent = '00:00';
    C.ctx.fillStyle = '#0d0d0d'; C.ctx.fillRect(0, 0, C.W, C.H);
    C.ctx.fillStyle = '#5c5c5c'; C.ctx.font = '14px Inter,sans-serif'; C.ctx.textAlign = 'center';
    C.ctx.fillText('预览：点击「开始录制」后在此显示屏幕与摄像头合成画面', C.W / 2, C.H / 2);
  }
  G['screen-recorder'] = screenRecorderUI;

  /* ==========================================================================
     弹跳球视频生成器
     ========================================================================== */
  function bouncingBallVideoUI(host) {
    const SCENES = [{ v: 'ring', t: '扩展环（Ring escape）' }, { v: 'trail', t: '长拖尾' }, { v: 'split', t: '分裂小球' }, { v: 'notes', t: '音符标记' }];
    const RATIOS = [{ v: '9:16', t: '竖屏 9:16' }, { v: '1:1', t: '方形 1:1' }, { v: '16:9', t: '横屏 16:9' }];
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap" style="width:100%">
          <div class="scorebar"><span>时间 <b id="bbT">0.0 s</b></span><span>弹跳 <b id="bbB">0</b></span><span>音阶 <b id="bbN">—</b></span><span>随机种子 <b id="bbSeed">7</b></span></div>
          <div id="bbWrap"></div>
          <div class="runnote">点击画面可以听到落地音；模拟用固定步长推进，导出时按 60fps 实时录制。</div>
        </div>
      </div>
      ${paneBox('弹跳球视频生成器', '真实重力 + 恢复系数模拟；环 / 拖尾 / 分裂 / 音符四种场景。导出走 canvas.captureStream + MediaRecorder（含合成音频）。',
      `<div class="plabel">场景</div>${TUI.sel('bbScene', SCENES.map(s => ({ v: s.v, t: s.t })), 'ring')}
        <div class="plabel">画面比例</div>${TUI.sel('bbRatio', RATIOS.map(s => ({ v: s.v, t: s.t })), '9:16')}
        <div class="plabel">重力</div>${TUI.range('bbG', 200, 3000, 1400, 20)}
        <div class="plabel">弹性（恢复系数 ×100）</div>${TUI.range('bbRest', 50, 99, 88, 1)}
        <div class="plabel">水平漂移</div>${TUI.range('bbDrift', 0, 400, 120, 5)}
        <div class="plabel">导出时长（秒）</div>${TUI.range('bbDur', 5, 60, 20, 1)}
        <div class="plabel">小球数量</div>${TUI.range('bbBalls', 1, 6, 1, 1)}
        <div class="shapes" style="margin-top:12px;gap:8px">
          <button class="btn-ghost btn-sm" id="bbRand">随机种子</button>
          <button class="btn-lime btn-sm" id="bbExp">导出视频</button>
        </div>
        <div class="progress" id="bbProg"><i></i></div>
        <div class="outbox" id="bbOut">导出为实时录制：${(vmimeOut())}。若要 MP4，请用本站「视频转换」离线转容器。</div>`)}
    </div>`;

    function vmimeOut() { return pickVideoMime() || '当前浏览器不支持 MediaRecorder'; }
    let ratio = '9:16';
    let C = null;
    function sizeFor(r) {
      if (r === '1:1') return [480, 480];
      if (r === '16:9') return [800, 450];
      return [360, 640];
    }
    function makeCanvas() {
      const wrap = $('#bbWrap');
      wrap.innerHTML = '';
      const sz = sizeFor(ratio);
      C = mkCanvas(wrap, sz[0], sz[1]);
      C.cv.addEventListener('pointerdown', () => { unlockAudio(); bounceSound(ri(0, 10), 0.6); });
    }
    let balls = [], t = 0, bounces = 0, rings = [], trail = [], splits = [], notes = [], seed = 7, expDest = null, recording = false;
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed % 100000) / 100000; }
    const SCALE_M = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
    function makeBall(x, y, r) {
      return { x: x, y: y, r: r, vx: rf(-1, 1) * 0.2, vy: 0, step: 0 };
    }
    function reset() {
      if (!C) return;
      balls = []; rings = []; trail = []; splits = []; notes = []; bounces = 0; t = 0;
      seed = +(($('#bbSeed') && $('#bbSeed').textContent) || 7);
      const n = +$('#bbBalls').value;
      for (let i = 0; i < n; i++) balls.push(makeBall(C.W * (0.25 + 0.5 * (n === 1 ? 0.5 : i / (n - 1))), C.H * 0.18 - i * 10, 12 + i * 2));
      balls.forEach(b => { b.vy = 0; });
    }
    function bounceSound(idx, strength) {
      const c = ac(); if (!c) return;
      const m = 48 + SCALE_M[idx % SCALE_M.length] + (idx >= SCALE_M.length ? 12 : 0);
      const f = midiFreq(m);
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(f, c.currentTime);
      o.frequency.exponentialRampToValueAtTime(f * 0.98, c.currentTime + 0.25);
      const vol = clamp(0.06 + strength * 0.3, 0.05, 0.4);
      g.gain.setValueAtTime(0.0001, c.currentTime);
      g.gain.exponentialRampToValueAtTime(vol, c.currentTime + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.34);
      o.connect(g);
      g.connect(c.destination);
      if (expDest) { try { g.connect(expDest); } catch (e) { } }
      o.start(); o.stop(c.currentTime + 0.36);
      notes.push({ txt: noteName(m), life: 1 });
      if (notes.length > 6) notes.shift();
    }
    function step(dt) {
      const g = +$('#bbG').value;
      const rest = (+$('#bbRest').value) / 100;
      const drift = +$('#bbDrift').value;
      t += dt;
      balls.forEach((b, bi) => {
        b.vy += g * dt;
        b.x += b.vx * dt * 60 * (0.3 + drift / 400); b.y += b.vy * dt;
        if (b.x - b.r < 0) { b.x = b.r; b.vx = Math.abs(b.vx) * rest; }
        if (b.x + b.r > C.W) { b.x = C.W - b.r; b.vx = -Math.abs(b.vx) * rest; }
        if (b.y + b.r > C.H) {
          b.y = C.H - b.r;
          const impact = Math.min(1, Math.abs(b.vy) / 900);
          b.vy = -Math.abs(b.vy) * rest;
          if (Math.abs(b.vy) < 40) b.vy = -140 - 40 * rnd();
          b.step++;
          bounces++;
          rings.push({ x: b.x, y: b.y, r: b.r, life: 1, hue: (b.step * 37) % 360 });
          if (rnd() > 0.5) b.vx += rf(-0.25, 0.25);
          if (sc() === 'split' && impact > 0.35 && balls.length < 40) {
            for (let k = 0; k < 2; k++) splits.push({ x: b.x + rf(-6, 6), y: b.y - 6, vx: rf(-140, 140), vy: -Math.abs(b.vy) * rf(0.4, 0.8), r: Math.max(4, b.r * 0.55), life: 1 });
          }
          bounceSound(b.step + bi, impact);
        }
      });
      rings.forEach(r => { r.life -= dt * 0.9; r.r += dt * 260; });
      rings = rings.filter(r => r.life > 0);
      splits.forEach(s2 => { s2.vy += g * dt; s2.x += s2.vx * dt; s2.y += s2.vy * dt; s2.life -= dt * 0.5; });
      splits = splits.filter(s2 => s2.life > 0);
      notes.forEach(n => { n.life -= dt * 0.8; });
      notes = notes.filter(n => n.life > 0);
      if (sc() === 'trail') { balls.forEach(b => trail.push({ x: b.x, y: b.y, r: b.r })); while (trail.length > 260) trail.shift(); }
    }
    function sc() { return $('#bbScene').value; }
    function draw() {
      const view = $('#bbScene').value;
      C.ctx.fillStyle = view === 'trail' ? 'rgba(11,11,11,0.16)' : '#0b0b0b';
      C.ctx.fillRect(0, 0, C.W, C.H);
      C.ctx.strokeStyle = 'rgba(80,80,80,0.5)'; C.ctx.lineWidth = 2;
      C.ctx.beginPath(); C.ctx.moveTo(0, C.H - 1); C.ctx.lineTo(C.W, C.H - 1); C.ctx.stroke();
      if (view === 'trail' && trail.length > 1) {
        trail.forEach((p, i) => {
          C.ctx.globalAlpha = (i / trail.length) * 0.35;
          C.ctx.fillStyle = '#d7f452';
          C.ctx.beginPath(); C.ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); C.ctx.fill();
        });
        C.ctx.globalAlpha = 1;
      }
      if (view === 'ring') {
        rings.forEach(r => {
          C.ctx.strokeStyle = 'hsla(' + r.hue + ',85%,65%,' + r.life + ')';
          C.ctx.lineWidth = 3;
          C.ctx.beginPath(); C.ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); C.ctx.stroke();
        });
      }
      splits.forEach(s2 => {
        C.ctx.fillStyle = 'rgba(255,143,177,' + s2.life + ')';
        C.ctx.beginPath(); C.ctx.arc(s2.x, s2.y, s2.r, 0, Math.PI * 2); C.ctx.fill();
      });
      balls.forEach(b => {
        const grd = C.ctx.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.3, 1, b.x, b.y, b.r);
        grd.addColorStop(0, '#ffffff'); grd.addColorStop(1, '#d7f452');
        C.ctx.fillStyle = grd;
        C.ctx.beginPath(); C.ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); C.ctx.fill();
      });
      if (view === 'notes') {
        notes.forEach((n, i) => {
          C.ctx.fillStyle = 'rgba(215,244,82,' + n.life + ')';
          C.ctx.font = '700 15px Inter,sans-serif'; C.ctx.textAlign = 'left';
          C.ctx.fillText(n.txt, C.W * 0.6, 40 + i * 22);
        });
      }
      $('#bbT').textContent = t.toFixed(1) + ' s';
      $('#bbB').textContent = bounces;
      $('#bbN').textContent = notes.length ? notes[notes.length - 1].txt : '—';
      $('#bbSeed').textContent = seed;
    }
    let acc = 0;
    const loop = Loop(dt => {
      acc += dt;
      let guard = 0;
      while (acc >= 1 / 240 && guard++ < 40) { step(1 / 240); acc -= 1 / 240; }
      draw();
    });
    $('#bbScene').addEventListener('change', () => { trail = []; });
    $('#bbRatio').addEventListener('change', () => { ratio = $('#bbRatio').value; makeCanvas(); reset(); });
    $('#bbBalls').addEventListener('input', () => { });
    bindRange('#bbBalls', () => reset());
    bindRange('#bbG', () => { }); bindRange('#bbRest', () => { }); bindRange('#bbDrift', () => { }); bindRange('#bbDur', () => { });
    $('#bbRand').addEventListener('click', () => { seed = ri(1, 999999); $('#bbSeed').textContent = seed; reset(); });
    bindCtrl({ start: () => loop.start(), pause: () => loop.stop(), reset: reset });
    ctlEl('#gStart').textContent = '播放';
    ctlEl('#gPause').textContent = '暂停';
    ctlEl('#gReset').textContent = '重开';
    $('#bbExp').addEventListener('click', async () => {
      if (recording) { window.toast('正在导出中，请稍候'); return; }
      const c = ac();
      if (!c) { window.toast('无法创建 AudioContext'); return; }
      if (c.state === 'suspended') c.resume().catch(() => { });
      const vmime = pickVideoMime();
      if (typeof MediaRecorder === 'undefined' || !C.cv.captureStream) { window.toast('当前浏览器不支持 canvas 录制导出'); return; }
      expDest = c.createMediaStreamDestination();
      const vs = C.cv.captureStream(60);
      vs.addTrack(expDest.stream.getAudioTracks()[0]);
      const api = recorderFor(vs, vmime, 9000000);
      if (!api) { window.toast('MediaRecorder 初始化失败'); expDest = null; return; }
      recording = true;
      reset(); loop.start();
      api.rec.start(500);
      const dur = +$('#bbDur').value;
      $('#bbOut').textContent = '导出中：按 1× 实时录制 ' + dur + ' 秒…';
      let el = 0;
      await new Promise(res => {
        const iv = setInterval(() => {
          el += 0.2;
          TUI.prog($('#bbProg'), el / dur * 100);
          if (el >= dur) { clearInterval(iv); res(); }
        }, 200);
      });
      try { api.rec.stop(); } catch (e) { }
      const blob = await api.blob();
      recording = false; expDest = null;
      const ext = extFor(blob.type || vmime);
      window.downloadBlob(blob, 'bouncing-ball.' + ext);
      $('#bbOut').innerHTML = '导出完成：' + sizeStr(blob.size) + ' · ' + esc(blob.type || ext) + '（已开始下载）';
      TUI.prog($('#bbProg'), 100);
    });
    makeCanvas(); reset(); loop.start(); draw();
    onClean(() => { if (expDest) { try { expDest.disconnect(); } catch (e) { } expDest = null; } });
  }
  G['bouncing-ball-video-maker'] = bouncingBallVideoUI;

  /* ==========================================================================
     倒计时视频生成器
     ========================================================================== */
  const FONT57 = {
    '0': [0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E], '1': [0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E],
    '2': [0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F], '3': [0x1F, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0E],
    '4': [0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02], '5': [0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E],
    '6': [0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E], '7': [0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
    '8': [0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E], '9': [0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C],
    ':': [0x00, 0x04, 0x04, 0x00, 0x04, 0x04, 0x00], '.': [0x00, 0x00, 0x00, 0x00, 0x00, 0x0C, 0x0C]
  };
  function countdownVideoUI(host) {
    const STYLES = [{ v: 'ring', t: '圆环进度' }, { v: 'flip', t: '翻页数字' }, { v: 'bar', t: '分段条' }, { v: 'dots', t: '点阵数字' }, { v: 'minimal', t: '极简描边' }];
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap" style="width:100%">
          <div class="scorebar"><span>剩余 <b id="cvLeft">00:10</b></span><span>状态 <b id="cvState">就绪</b></span><span>样式 <b id="cvStyleOut">圆环进度</b></span></div>
          <div id="cvWrap"></div>
          <div class="runnote">倒计时用 AudioContext 音频时钟对齐，每秒一声滴答、归零时三声长鸣。</div>
        </div>
      </div>
      ${paneBox('倒计时视频生成器', '10 秒片头、计时器或到某个日期的倒计时，导出为带声音的视频文件（实时录制）。',
      `<div class="plabel">动画样式</div>${TUI.sel('cvStyle', STYLES.map(s => ({ v: s.v, t: s.t })), 'ring')}
        <div class="plabel">画面比例</div>${TUI.sel('cvRatio', [{ v: '9:16', t: '竖屏 9:16' }, { v: '1:1', t: '方形 1:1' }, { v: '16:9', t: '横屏 16:9' }], '9:16')}
        <div class="plabel">预设</div>${TUI.sel('cvPreset', [{ v: 'intro', t: '10 秒片头' }, { v: 'min5', t: '5 分钟计时' }, { v: 'hour1', t: '1 小时计时' }, { v: 'custom', t: '自定义（分:秒）' }], 'intro')}
        <div class="plabel">标签文字</div>${TUI.input('cvLabel', '倒计时', '例如：开始 / 休息 / 新年')}
        <div class="plabel">主色</div>${TUI.input('cvColor', '#d7f452', '', 'color')}
        <div class="plabel">时长（秒）</div>${TUI.range('cvSec', 5, 3600, 10, 1)}
        <div class="shapes" style="margin-top:12px;gap:8px">
          <button class="btn-lime btn-sm" id="cvExp">导出视频</button>
          <button class="btn-ghost btn-sm" id="cvShot">导出当前帧 PNG</button>
        </div>
        <div class="progress" id="cvProg"><i></i></div>
        <div class="outbox" id="cvOut">导出是 1× 实时录制：1 小时的倒计时会录 1 小时。短视频建议 ≤ 60 秒。</div>`)}
    </div>`;
    let ratio = '9:16';
    let C = null;
    let total = 10, left = 10, running = false, lastTick = -1, expDest = null, recording = false;
    function sizeFor(r) { return r === '1:1' ? [480, 480] : r === '16:9' ? [800, 450] : [360, 640]; }
    function makeCanvas() {
      const wrap = $('#cvWrap');
      wrap.innerHTML = '';
      const sz = sizeFor(ratio);
      C = mkCanvas(wrap, sz[0], sz[1]);
    }
    function setPreset() {
      const p = $('#cvPreset').value;
      const map = { intro: 10, min5: 300, hour1: 3600 };
      if (map[p] != null) { $('#cvSec').value = map[p]; $('#cvSecV').textContent = map[p]; }
      if (p === 'intro') $('#cvLabel').value = '倒计时';
      reset();
    }
    function reset() {
      total = +$('#cvSec').value; left = total; running = false; lastTick = -1;
      if (!C) return;
      draw(); $('#cvLeft').textContent = fmtHMSx(left); $('#cvState').textContent = '就绪';
    }
    function tick(beepStrong) {
      const c = ac(); if (!c) return;
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'square'; o.frequency.value = beepStrong ? 420 : 880;
      const vol = beepStrong ? 0.32 : 0.16;
      g.gain.setValueAtTime(0.0001, c.currentTime);
      g.gain.exponentialRampToValueAtTime(vol, c.currentTime + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + (beepStrong ? 0.9 : 0.09));
      o.connect(g); g.connect(c.destination);
      if (expDest) { try { g.connect(expDest); } catch (e) { } }
      o.start(); o.stop(c.currentTime + (beepStrong ? 0.95 : 0.12));
    }
    function label() { return $('#cvLabel').value || '倒计时'; }
    function accent() { return $('#cvColor').value || '#d7f452'; }
    function drawDots(txt, cx, cy, scale) {
      let w = 0;
      const chars = txt.split('');
      const gw = 4 * scale, gap = 2 * scale;
      chars.forEach(ch => { w += (ch === ':' || ch === '.' ? 2 : 5) * scale * 1.6 + gap; });
      let x = cx - w / 2;
      chars.forEach(ch => {
        const rows = FONT57[ch] || FONT57['0'];
        const wide = (ch === ':' || ch === '.');
        for (let r = 0; r < 7; r++) {
          for (let cbit = 0; cbit < (wide ? 2 : 5); cbit++) {
            if (rows[r] & (1 << (wide ? 1 : 4 - cbit))) {
              C.ctx.fillStyle = accent();
              C.ctx.fillRect(x + cbit * gw, cy - 3.5 * 7 * scale + r * gw, gw * 0.85, gw * 0.85);
            }
          }
        }
        x += (wide ? 2 : 5) * scale * 1.6 + gap;
      });
    }
    function draw() {
      const st = $('#cvStyle').value, col = accent();
      C.ctx.fillStyle = '#0b0b0b'; C.ctx.fillRect(0, 0, C.W, C.H);
      const txt = fmtHMSx(Math.ceil(left));
      const prog = total > 0 ? clamp(1 - left / total, 0, 1) : 0;
      C.ctx.textAlign = 'center';
      if (st === 'ring') {
        const cx = C.W / 2, cy = C.H * 0.46, R = Math.min(C.W, C.H) * 0.3;
        C.ctx.lineWidth = Math.max(8, R * 0.11);
        C.ctx.strokeStyle = '#242424';
        C.ctx.beginPath(); C.ctx.arc(cx, cy, R, 0, Math.PI * 2); C.ctx.stroke();
        C.ctx.strokeStyle = col; C.ctx.lineCap = 'round';
        C.ctx.beginPath(); C.ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2); C.ctx.stroke();
        C.ctx.fillStyle = '#f5f5f5'; C.ctx.font = '800 ' + Math.round(R * 0.52) + 'px Inter,sans-serif';
        C.ctx.fillText(txt, cx, cy + R * 0.18);
      } else if (st === 'flip') {
        const bw = C.W * 0.8, bh = C.H * 0.2, bx = (C.W - bw) / 2, by = C.H * 0.32;
        C.ctx.fillStyle = '#161616'; C.ctx.fillRect(bx, by, bw, bh);
        C.ctx.strokeStyle = '#2a2a2a'; C.ctx.strokeRect(bx, by, bw, bh);
        C.ctx.fillStyle = col;
        C.ctx.fillRect(bx, by, bw * prog, 5);
        C.ctx.fillStyle = '#f5f5f5'; C.ctx.font = '800 ' + Math.round(bh * 0.62) + 'px "SF Mono",Menlo,monospace';
        C.ctx.fillText(txt, C.W / 2, by + bh * 0.7);
      } else if (st === 'bar') {
        const seg = Math.max(10, Math.round(total / 10));
        const n = Math.min(60, seg);
        const bw = (C.W * 0.8) / n, by = C.H * 0.44;
        for (let i = 0; i < n; i++) {
          const on = i / n < prog;
          C.ctx.fillStyle = on ? col : '#242424';
          C.ctx.fillRect(C.W * 0.1 + i * bw + 1, by, Math.max(2, bw - 3), C.H * 0.06);
        }
        C.ctx.fillStyle = '#f5f5f5'; C.ctx.font = '800 ' + Math.round(C.W * 0.16) + 'px Inter,sans-serif';
        C.ctx.fillText(txt, C.W / 2, by - C.H * 0.05);
      } else if (st === 'dots') {
        drawDots(txt, C.W / 2, C.H * 0.5, Math.max(2, Math.round(C.W * 0.016)));
      } else {
        C.ctx.lineWidth = 2; C.ctx.strokeStyle = '#3a3a3a'; C.ctx.strokeRect(16, 16, C.W - 32, C.H - 32);
        C.ctx.fillStyle = '#f5f5f5'; C.ctx.font = '300 ' + Math.round(C.W * 0.18) + 'px Inter,sans-serif';
        C.ctx.fillText(txt, C.W / 2, C.H * 0.5);
        C.ctx.fillStyle = col;
        C.ctx.fillRect(16, C.H - 18, (C.W - 32) * prog, 4);
      }
      C.ctx.fillStyle = 'rgba(255,255,255,0.72)'; C.ctx.font = '600 ' + Math.round(C.W * 0.038) + 'px Inter,sans-serif';
      C.ctx.fillText(label(), C.W / 2, C.H * 0.86);
      $('#cvLeft').textContent = fmtHMSx(left);
    }
    let acc = 0;
    const loop = Loop(dt => {
      if (running) {
        acc += dt; left -= dt;
        const whole = Math.ceil(left);
        if (whole !== lastTick) {
          lastTick = whole;
          if (whole > 0) tick(whole <= 3);
          if (left <= 0) {
            left = 0; running = false;
            for (let i = 0; i < 3; i++) setTimeout(() => tick(true), i * 320);
            $('#cvState').textContent = '结束';
          }
        }
      }
      draw();
    });
    $('#cvStyle').addEventListener('change', () => { $('#cvStyleOut').textContent = STYLES.find(s => s.v === $('#cvStyle').value).t; });
    $('#cvRatio').addEventListener('change', () => { ratio = $('#cvRatio').value; makeCanvas(); reset(); });
    $('#cvPreset').addEventListener('change', setPreset);
    bindRange('#cvSec', () => reset());
    bindCtrl({ start: () => { if (left <= 0) reset(); running = true; $('#cvState').textContent = '倒计时中'; }, pause: () => { running = false; }, reset: reset });
    ctlEl('#gStart').textContent = '开始';
    ctlEl('#gPause').textContent = '暂停';
    ctlEl('#gReset').textContent = '重置';
    $('#cvShot').addEventListener('click', () => pngOf(C.cv, 'countdown-frame.png'));
    $('#cvExp').addEventListener('click', async () => {
      if (recording) { window.toast('正在导出中'); return; }
      const c = ac(); if (!c) { window.toast('无法创建 AudioContext'); return; }
      if (c.state === 'suspended') c.resume().catch(() => { });
      const vmime = pickVideoMime();
      if (typeof MediaRecorder === 'undefined' || !C.cv.captureStream) { window.toast('当前浏览器不支持 canvas 录制导出'); return; }
      const dur = total;
      if (dur > 90 && !window.confirm('导出是 1× 实时录制，' + fmtHMSx(dur) + ' 的倒计时需要约 ' + fmtHMSx(dur) + '。继续？')) return;
      expDest = c.createMediaStreamDestination();
      const vs = C.cv.captureStream(60);
      vs.addTrack(expDest.stream.getAudioTracks()[0]);
      const api = recorderFor(vs, vmime, 6000000);
      if (!api) { window.toast('MediaRecorder 初始化失败'); expDest = null; return; }
      recording = true;
      reset(); running = true; $('#cvState').textContent = '导出中';
      api.rec.start(500);
      $('#cvOut').textContent = '导出中：实时录制 ' + fmtHMSx(dur) + '…';
      let el = 0;
      await new Promise(res => {
        const iv = setInterval(() => {
          el += 0.25;
          TUI.prog($('#cvProg'), el / dur * 100);
          if (el >= dur + 1.2) { clearInterval(iv); res(); }
        }, 250);
      });
      try { api.rec.stop(); } catch (e) { }
      const blob = await api.blob();
      recording = false; expDest = null;
      const ext = extFor(blob.type || vmime);
      window.downloadBlob(blob, 'countdown.' + ext);
      $('#cvOut').innerHTML = '导出完成：' + sizeStr(blob.size) + ' · ' + esc(blob.type || ext) + '（已开始下载）';
      TUI.prog($('#cvProg'), 100);
      $('#cvState').textContent = '已完成';
    });
    makeCanvas(); setPreset(); loop.start(); draw();
    onClean(() => { if (expDest) { try { expDest.disconnect(); } catch (e) { } expDest = null; } });
  }
  G['countdown-video-maker'] = countdownVideoUI;

  /* ==========================================================================
     弹跳 Logo 屏保
     ========================================================================== */
  function bouncingLogoUI(host) {
    const COLORS = ['#d7f452', '#5fd0ff', '#ff8fb1', '#ffd166', '#9be564', '#c39bff', '#ff9f6b'];
    host.innerHTML = `<div class="tool-body wide">
      <div class="stage">
        <div class="gamewrap" style="width:100%">
          <div class="scorebar"><span>撞墙 <b id="blHits">0</b></span><span>撞角 <b id="blCorners">0</b></span><span>下一个角 <b id="blNext">—</b></span><span>当前色 <b id="blCol">—</b></span></div>
          <div id="blWrap"></div>
          <div class="runnote">撞角（两条边同时命中）会触发庆祝动画；「下一个角」由折返展开算出，精确到 0.01 秒。</div>
        </div>
      </div>
      ${paneBox('弹跳 Logo 屏保', '输入任意文字或上传一张图片作为 Logo；全屏、屏幕常亮（Wake Lock）、可导出片段。',
      `<div class="plabel">显示文字</div>${TUI.input('blText', '我的工作台', '留空则使用图片')}
        <div class="plabel">或者上传 Logo 图片</div>
        ${TUI.drop('<div class="ic">' + window.icon('image', 26) + '</div><b style="color:#e5e5e5">拖入 SVG / PNG / JPG</b>', 'image/*')}
        <div class="plabel">速度</div>${TUI.range('blSpeed', 40, 900, 240, 10)}
        <div class="plabel">拖尾</div>${TUI.range('blTrail', 0, 60, 18, 1)}
        <div class="plabel">Logo 宽度</div>${TUI.range('blScale', 12, 60, 26, 1)}
        <div class="plabel">导出时长（秒）</div>${TUI.range('blDur', 5, 60, 15, 1)}
        <div class="shapes" style="margin-top:12px;gap:8px">
          <button class="btn-ghost btn-sm" id="blFull">全屏</button>
          <button class="btn-ghost btn-sm" id="blWake">屏幕常亮</button>
          <button class="btn-lime btn-sm" id="blExp">导出片段</button>
        </div>
        <div class="progress" id="blProg"><i></i></div>
        <div class="outbox" id="blOut">导出为 canvas + 音频的实时录制，下载后可在剪辑软件里当过渡素材。</div>`)}
    </div>`;
    const C = mkCanvas($('#blWrap'), 640, 420);
    let x = 60, y = 60, vx = 240, vy = 170, hits = 0, corners = 0, trail = [], ci = 0;
    let logoImg = null, wake = null, expDest = null, recording = false, celebrate = 0;
    let bw = 168, bh = 56;
    function logoSize() {
      const s = +$('#blScale').value;
      bw = C.W * s / 100;
      bh = logoImg ? bw * (logoImg.height / logoImg.width) : bw * 0.33;
      bw = Math.max(28, Math.min(bw, C.W - 20));
      bh = Math.max(20, Math.min(bh, C.H - 20));
    }
    function cornerForecast() {
      const X = C.W - bw, Y = C.H - bh;
      if (X <= 0 || Y <= 0 || !vx || !vy) return -1;
      const horizon = 3600;
      const tx = [], ty = [];
      for (let k = 0; ; k++) { const t = (k * X - x) / vx; if (t > horizon) break; if (t > 0.02) tx.push(t); if (k > 20000) break; }
      for (let k = 0; ; k++) { const t = (k * Y - y) / vy; if (t > horizon) break; if (t > 0.02) ty.push(t); if (k > 20000) break; }
      tx.sort((a, b) => a - b); ty.sort((a, b) => a - b);
      let i = 0, j = 0, best = -1;
      while (i < tx.length && j < ty.length) {
        const d = tx[i] - ty[j];
        if (Math.abs(d) < 0.02) { const t = Math.max(tx[i], ty[j]); if (best < 0 || t < best) best = t; i++; j++; }
        else if (d < 0) i++; else j++;
      }
      return best;
    }
    function bang(strong) {
      const c = ac(); if (!c) return;
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle'; o.frequency.value = strong ? 660 : 440;
      g.gain.setValueAtTime(0.0001, c.currentTime);
      g.gain.exponentialRampToValueAtTime(strong ? 0.3 : 0.12, c.currentTime + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + (strong ? 0.5 : 0.1));
      o.connect(g); g.connect(c.destination);
      if (expDest) { try { g.connect(expDest); } catch (e) { } }
      o.start(); o.stop(c.currentTime + (strong ? 0.55 : 0.14));
    }
    function step(dt) {
      const sp = +$('#blSpeed').value;
      const L = Math.hypot(vx, vy) || 1;
      vx = vx / L * sp; vy = vy / L * sp;
      x += vx * dt; y += vy * dt;
      let hx = false, hy = false;
      if (x < 0) { x = 0; vx = Math.abs(vx); hx = true; }
      if (x + bw > C.W) { x = C.W - bw; vx = -Math.abs(vx); hx = true; }
      if (y < 0) { y = 0; vy = Math.abs(vy); hy = true; }
      if (y + bh > C.H) { y = C.H - bh; vy = -Math.abs(vy); hy = true; }
      if (hx || hy) {
        hits++; ci = (ci + 1) % COLORS.length;
        $('#blHits').textContent = hits; $('#blCol').textContent = COLORS[ci];
        if (hx && hy) { corners++; celebrate = 1; $('#blCorners').textContent = corners; bang(true); window.toast('撞角！第 ' + corners + ' 次'); }
        else bang(false);
      }
      if (celebrate > 0) celebrate = Math.max(0, celebrate - dt * 0.8);
      const tl = +$('#blTrail').value;
      trail.push([x, y, COLORS[ci]]);
      while (trail.length > Math.max(1, tl)) trail.shift();
      const nf = cornerForecast();
      $('#blNext').textContent = nf < 0 ? '—' : fmtHMSx(nf) + '.' + Math.floor((nf % 1) * 100);
    }
    function draw() {
      C.ctx.fillStyle = 'rgba(11,11,11,' + (trail.length > 1 ? 0.22 : 1) + ')';
      C.ctx.fillRect(0, 0, C.W, C.H);
      if (celebrate > 0) {
        C.ctx.fillStyle = 'rgba(215,244,82,' + (celebrate * 0.18) + ')';
        C.ctx.fillRect(0, 0, C.W, C.H);
      }
      if (trail.length > 1) {
        trail.forEach((t, i) => {
          C.ctx.globalAlpha = i / trail.length * 0.3;
          C.ctx.fillStyle = t[2];
          C.ctx.fillRect(t[0], t[1], bw, bh);
        });
        C.ctx.globalAlpha = 1;
      }
      if (logoImg) {
        C.ctx.drawImage(logoImg, x, y, bw, bh);
        C.ctx.strokeStyle = COLORS[ci]; C.ctx.lineWidth = 2; C.ctx.strokeRect(x, y, bw, bh);
      } else {
        const g = C.ctx.createLinearGradient(x, y, x + bw, y + bh);
        g.addColorStop(0, COLORS[ci]); g.addColorStop(1, '#ffffff');
        C.ctx.fillStyle = g;
        C.ctx.fillRect(x, y, bw, bh);
        C.ctx.fillStyle = '#0b0b0b';
        C.ctx.font = '800 ' + Math.round(Math.min(bh * 0.5, bw * 0.16)) + 'px Inter,sans-serif';
        C.ctx.textAlign = 'center'; C.ctx.textBaseline = 'middle';
        C.ctx.fillText(($('#blText').value || '我的工作台').slice(0, 16), x + bw / 2, y + bh / 2);
      }
    }
    const loop = Loop(dt => { step(Math.min(dt, 0.05)); draw(); });
    C.cv.addEventListener('pointerdown', () => { unlockAudio(); bang(false); });
    $('#blText').addEventListener('input', () => { logoImg = null; logoSize(); x = clamp(x, 0, Math.max(0, C.W - bw)); y = clamp(y, 0, Math.max(0, C.H - bh)); });
    TUI.bindDrop(host, 'image/*', false, files => {
      const f = files[0]; if (!f) return;
      const url = URL.createObjectURL(f);
      const im = new Image();
      im.onload = () => {
        logoImg = im; $('#blText').value = ''; logoSize();
        x = clamp(x, 0, Math.max(0, C.W - bw)); y = clamp(y, 0, Math.max(0, C.H - bh));
        window.toast('已载入 ' + f.name);
      };
      im.onerror = () => window.toast('图片无法读取');
      im.src = url;
      onClean(() => URL.revokeObjectURL(url));
    });
    bindRange('#blScale', () => logoSize());
    bindRange('#blSpeed', () => { }); bindRange('#blTrail', () => { }); bindRange('#blDur', () => { });
    $('#blFull').addEventListener('click', () => {
      if (C.cv.requestFullscreen) C.cv.requestFullscreen().catch(() => window.toast('浏览器拒绝了全屏请求'));
      else window.toast('当前浏览器不支持全屏 API');
    });
    $('#blWake').addEventListener('click', async () => {
      if (wake) { relWakeLock(wake); wake = null; $('#blWake').textContent = '屏幕常亮'; window.toast('已释放屏幕常亮'); return; }
      wake = await reqWakeLock();
      if (wake) { $('#blWake').textContent = '取消常亮'; window.toast('已请求屏幕常亮'); }
      else window.toast('当前浏览器不支持 Wake Lock 或请求被拒');
    });
    $('#blExp').addEventListener('click', async () => {
      if (recording) { window.toast('正在导出中'); return; }
      const c = ac(); if (!c) { window.toast('无法创建 AudioContext'); return; }
      if (c.state === 'suspended') c.resume().catch(() => { });
      const vmime = pickVideoMime();
      if (typeof MediaRecorder === 'undefined' || !C.cv.captureStream) { window.toast('当前浏览器不支持 canvas 录制导出'); return; }
      expDest = c.createMediaStreamDestination();
      const vs = C.cv.captureStream(60);
      vs.addTrack(expDest.stream.getAudioTracks()[0]);
      const api = recorderFor(vs, vmime, 8000000);
      if (!api) { window.toast('MediaRecorder 初始化失败'); expDest = null; return; }
      recording = true;
      api.rec.start(500);
      const dur = +$('#blDur').value;
      $('#blOut').textContent = '导出中：实时录制 ' + dur + ' 秒…';
      let el = 0;
      await new Promise(res => {
        const iv = setInterval(() => { el += 0.25; TUI.prog($('#blProg'), el / dur * 100); if (el >= dur) { clearInterval(iv); res(); } }, 250);
      });
      try { api.rec.stop(); } catch (e) { }
      const blob = await api.blob();
      recording = false; expDest = null;
      const ext = extFor(blob.type || vmime);
      window.downloadBlob(blob, 'bouncing-logo.' + ext);
      $('#blOut').innerHTML = '导出完成：' + sizeStr(blob.size) + ' · ' + esc(blob.type || ext) + '（已开始下载）';
      TUI.prog($('#blProg'), 100);
    });
    bindCtrl({ start: () => loop.start(), pause: () => loop.stop(), reset: () => { x = 60; y = 60; hits = 0; corners = 0; trail = []; $('#blHits').textContent = '0'; $('#blCorners').textContent = '0'; } });
    ctlEl('#gStart').textContent = '播放';
    ctlEl('#gPause').textContent = '暂停';
    ctlEl('#gReset').textContent = '重开';
    logoSize();
    loop.start(); draw();
    onClean(() => { relWakeLock(wake); wake = null; if (expDest) { try { expDest.disconnect(); } catch (e) { } expDest = null; } });
  }
  G['bouncing-logo-screensaver'] = bouncingLogoUI;

  /* ---------------- 弹珠台别名（同表不同 slug） ---------------- */
  G['online-pinball'] = G['pinball'];
  G['pinball-game'] = G['pinball'];

  /* ---------------- 正则回退路由 ---------------- */
  const ROUTES_FALLBACK = [
    ['pinball', 'pinball'],
    ['snake', 'snake-game'],
    ['2048', '2048'],
    ['mine-?sweeper', 'minesweeper'],
    ['sudoku', 'sudoku'],
    ['solitaire', 'solitaire'],
    ['word-?guess|five-letter|daily-word|wordle', 'word-guess-game'],
    ['bubble', 'bubble-popper'],
    ['fidget', 'fidget-spinner'],
    ['spin-the-wheel', 'spin-the-wheel'],
    ['pop-?it', 'pop-it'],
    ['block-puzzle', 'block-puzzle'],
    ['piano', 'online-piano'],
    ['guitar', 'online-guitar'],
    ['metronome', 'metronome'],
    ['tuner', 'tuner'],
    ['noise', 'white-noise'],
    ['voice-recorder', 'voice-recorder'],
    ['screen-recorder', 'screen-recorder'],
    ['countdown-video', 'countdown-video-maker'],
    ['bouncing-ball', 'bouncing-ball-video-maker'],
    ['bouncing-logo|bouncing-.*screensaver', 'bouncing-logo-screensaver'],
    ['falling-sand', 'falling-sand-game'],
    ['sand-(art|painting)|sand-simulator', 'sand-simulator'],
    ['cloth|rope', 'cloth-simulator'],
    ['smoke|fluid', 'smoke-simulator'],
    ['water', 'water-simulator'],
    ['gravity|orbit', 'gravity-orbit-simulator'],
    ['solar', 'solar-system-simulator'],
    ['three-?body', 'three-body-problem-simulator'],
    ['galton', 'galton-board'],
    ['plinko', 'plinko-simulator'],
    ['marble', 'marble-race-simulator'],
    ['domino|chain-reaction', 'domino-chain-reaction'],
    ['ragdoll', 'ragdoll-physics-game'],
    ['boid|flock', 'boids-simulator'],
    ['life|cellular-automaton', 'conways-game-of-life'],
    ['logic-circuit', 'logic-circuit-simulator'],
    ['lava-lamp', 'lava-lamp'],
    ['fireplace|campfire', 'fireplace-screensaver'],
    ['rain', 'rain-window'],
    ['snow-globe', 'snow-globe'],
    ['bounce|dvd|screensaver', 'corner-bounce-screensaver'],
    ['ball.*simulat|bouncing-ball|ball-physics', 'ball-physics-simulator'],
    ['dice', 'dice-roller'],
    ['coin', 'flip-a-coin'],
    ['random-name', 'random-name-race'],
    ['bar-chart-race', 'bar-chart-race-maker'],
    ['stopwatch', 'stopwatch'],
    ['pomodoro', 'pomodoro-timer'],
    ['timer|countdown', 'countdown-timer'],
    ['clock', 'world-clock'],
    ['typing', 'typing-test'],
    ['keyboard', 'keyboard-test'],
    ['mouse', 'mouse-test'],
    ['webcam', 'webcam-test'],
    ['mic', 'mic-test'],
    ['speaker', 'speaker-test'],
    ['screen-test|screen-size|responsive|mobile-view', 'screen-test'],
    ['emulator|assembler|simulator', 'dos-emulator']
  ].map(x => ({ re: new RegExp(x[0], 'i'), to: x[1] }));

  /*==SPLICE==*/

  /* ---------------- 正则回退路由 ---------------- */
  const ROUTES = ROUTES_FALLBACK;

  /* ---------------- 入口 ---------------- */
  E.mount = function (host, cfg, slug) {
    try {
      cfg = cfg || {};
      host = host || document.querySelector('[data-tool]');
      if (!host) return;
      let fn = G[slug];
      if (!fn) {
        for (let i = 0; i < ROUTES.length; i++) { if (ROUTES[i].re.test(slug)) { fn = G[ROUTES[i].to]; break; } }
      }
      if (!fn) { TUI.soon(host, '工具「' + slug + '」尚未接入本地 game 引擎。本页其余内容为真实内容，工具区稍后补充。'); return; }
      fn(host, cfg, slug);
    } catch (e) {
      try { TUI.soon(host, '本地引擎运行出错：' + (e && e.message ? e.message : e)); } catch (_) { }
    }
  };

  window.TOOL_ENGINES.game = E;
})();
