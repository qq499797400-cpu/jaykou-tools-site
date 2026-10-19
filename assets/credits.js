/* ==========================================================================
   credits.js — 积分制使用额度系统（纯前端本地实现）
   账户与账本存 localStorage；卡密由站长的私有校验服务校验（本文件不含密钥）。
   对外暴露 window.JK
   ========================================================================== */
(function () {
  'use strict';
  if (window.__JK_LOADED__) return;
  window.__JK_LOADED__ = 1;

  /* ---------------- 常量 ---------------- */
  var SIGNUP_BONUS = 20;              // 注册赠送
  var DAILY_BONUS = 3;                // 每日登录领取
  var GUEST_DAILY = 3;                // 未登录每日免费次数
  var GUEST_MAX_COST = 2;             // 未登录可用的最高档位（3 分及以上需登录）
  var WINDOW_MS = 30 * 60 * 1000;     // 同一工具 30 分钟内不重复扣费
  var REDEEM_API = '';           // 站长的卡密校验服务地址，留空 = 关闭在线充值

  // 面额档位：码 -> 积分 / 建议零售价
  var PLANS = [
    { code: '01', credits: 10,   price: '¥9' },
    { code: '02', credits: 50,   price: '¥39' },
    { code: '03', credits: 100,  price: '¥69' },
    { code: '04', credits: 300,  price: '¥169' },
    { code: '05', credits: 1000, price: '¥499' }
  ];

  /* ---------------- 存储（localStorage 不可用时降级内存） ---------------- */
  var mem = {};
  var store = {
    get: function (k) {
      try { var v = localStorage.getItem(k); return v === null ? mem[k] : v; }
      catch (e) { return mem[k]; }
    },
    set: function (k, v) {
      mem[k] = v;
      try { localStorage.setItem(k, v); } catch (e) {}
    },
    del: function (k) {
      delete mem[k];
      try { localStorage.removeItem(k); } catch (e) {}
    }
  };

  var K_ACC = 'jk_v1_account';
  var K_LOG = 'jk_v1_log';
  var K_USED = 'jk_v1_used_codes';
  var K_WIN = 'jk_v1_windows';

  function jget(k, def) {
    try { var s = store.get(k); return s ? JSON.parse(s) : def; }
    catch (e) { return def; }
  }
  function jset(k, v) { store.set(k, JSON.stringify(v)); }

  /* ---------------- 工具分类 -> 价格档位 ---------------- */
  var KIND_RULES = [
    ['meter',  /(lufs|loudness|normalize-audio|audio-level|db-meter|bpm|metronome|tuner)/],
    ['code',   /(assembler|compiler|emulator|interpreter|playground|code-runner|python|javascript|typescript|chip8|chip-8|risc|arduino|pico|dos-|terminal|online-ide)/],
    ['timer',  /(stopwatch|timer|pomodoro|countdown|world-clock|clock)/],
    ['game',   /(-game$|^game-|^2048$|snake|sudoku|chess|solitaire|puzzle|simulat|pinball|arcade|typing|flappy|tetris|minesweeper|wordle|word-guess|hangman|word-search|racing|soccer|basketball|dice|coin|spinner|plinko|galton|marble|domino|lava-lamp|fireplace|screensaver|pacman|pong|breakout|tic-tac|connect-four|memory-game|reversi|mahjong)/],
    ['compress', /(compress|minif|optimiz|shrink|reduce-size)/],
    ['convert', /(-to-|-into-|converter|convert|transform|transcode|change-|switch|vectoriz)/],
    ['calc',   /(calculator|-calc$|solver|estimator|how-many|percentage|bmi|tdee|calorie|loan|mortgage|salary|gpa)/],
    ['cut',    /(crop|trim|cut|clip|snip|cutter)/],
    ['merge',  /(merge|join|combine|concat|merger)/],
    ['split',  /(split|separate|extract)/],
    ['rotate', /(rotate|flip|mirror|reverse-video)/],
    ['record', /(recorder|record|photo-booth|capture|screenshot|webcam|mic-test|mic-check)/],
    ['resize', /(resize|scale|enlarge|upscal|increase-(image-)?resolution)/],
    ['speed',  /(slow-down|speed|revers|loop-video|boomerang)/],
    ['add',    /(watermark|censor|blur-face|add-text|add-subtitle|add-music|caption)/],
    ['remove', /(remove|erase|delete|strip|unlock|decrypt|vocal|noise|redact|anonymiz|black-out)/],
    ['layout', /(n-up|imposition|impose|bates|numbering|booklet|print-then-cut|poster)/],
    ['doc',    /(invoice|receipt|resume|cv-|cover-letter|business-card|estimate|proforma|quotation|letterhead|bank-statement|gantt|mind-map|certificate|ticket|badge|invitation|presentation|slides|report|-template|template)/],
    ['gen',    /(generator|maker|builder|creator|random|font|palette|pattern|quote)/],
    ['ai',     /(^ai-|-ai-|ai$|enhance|coloriz|restore|unblur|face-|cartoon|anime|depth-map|blur-|chroma|green-screen|interpolat|slow-motion|frame-|fps|beautif|retouch|sketch|swap|styliz|photo-to|beaut|smooth|skin|background|segment|voice-changer)/],
    ['style',  /(dither|pixelat|halftone|engrav|ascii-art|dot-matrix|cross-stitch|perler|knitting|quilt|diamond-painting)/],
    ['collage', /(collage|mosaic|grid-maker|photo-strip)/],
    ['color',  /(color-picker|colour-picker|color-mixer|image-color|eyedropper)/],
    ['extract', /(ocr|extract-text|image-to-text|recogni)/],
    ['ref',    /(periodic-table|reference|cheat-sheet|dictionary|unit-circle|glossary)/],
    ['view',   /(viewer|reader|explorer|preview|inspect|parquet|sqlite|open-)/],
    ['check',  /(test|checker|check|detector|detect|analyz|scan|monitor|validator|validate|lint|diff|compare|preflight|flight)/],
    ['text',   /(formatter|beautif|prettif|format|sort|shuffle|case|encoder|decoder|encode|decode|hash|checksum|encrypt|parse|string|token|translat|counter|count)/],
    ['edit',   /(editor|annotate|sign-|fill|draw|whiteboard|paint|sync|subtitle-)/]
  ];

  function kindOf(slug, engine) {
    if (engine === 'game') return 'game';
    var s = String(slug || '');
    for (var i = 0; i < KIND_RULES.length; i++) {
      if (KIND_RULES[i][1].test(s)) return KIND_RULES[i][0];
    }
    if (engine === 'calc') return 'calc';
    if (engine === 'viewer3d') return 'view';
    return 'generic';
  }

  // 档位：0 免费 / 1 轻量 / 2 标准 / 4 重量（音视频）/ 5 AI
  var KIND_PRICE = {
    game: 0, timer: 0, meter: 0, prompt: 0,
    text: 1, calc: 1, color: 1, ref: 1, view: 1, code: 1, generic: 1,
    convert: 2, compress: 2, cut: 2, resize: 2, rotate: 2, remove: 2,
    add: 2, merge: 2, split: 2, style: 2, collage: 2, layout: 2,
    record: 2, edit: 2, doc: 2, check: 2, extract: 2, gen: 2
  };

  function priceOf(slug, engine) {
    if (engine === 'ai' || /(^ai-|-ai-|ai$)/.test(String(slug || ''))) return 5;
    if (engine === 'av') return 4;
    var k = kindOf(slug, engine);
    return Object.prototype.hasOwnProperty.call(KIND_PRICE, k) ? KIND_PRICE[k] : 1;
  }

  function tierName(n) {
    return n === 0 ? '免费' : n === 1 ? '轻量' : n === 2 ? '标准' : n === 4 ? '重量' : 'AI';
  }

  /* ---------------- 账户 ---------------- */
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  function defaultAcc() {
    return { phone: '', credits: 0, createdAt: Date.now(), lastClaim: '', guestDate: '', guestUsed: 0 };
  }

  function acc() {
    var a = jget(K_ACC, null);
    if (!a || typeof a !== 'object') a = defaultAcc();
    var d = defaultAcc();
    for (var k in d) if (!(k in a)) a[k] = d[k];
    return a;
  }
  function saveAcc(a) { jset(K_ACC, a); onAccountChange(); }

  var listeners = [];
  function onAccountChange() { for (var i = 0; i < listeners.length; i++) { try { listeners[i](); } catch (e) {} } }

  function isLogin() { return !!acc().phone; }

  function phoneMask(p) { return (p || '').replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2'); }

  /* 验证码：本地模拟（无短信通道），生成后直接返回给界面展示 */
  var codeCache = {};
  function sendCode(phone) {
    if (!/^1[3-9]\d{9}$/.test(phone)) return { ok: false, msg: '请输入正确的 11 位手机号' };
    var c = String(Math.floor(100000 + Math.random() * 900000));
    codeCache[phone] = { code: c, ts: Date.now() };
    return { ok: true, code: c, msg: '演示模式：验证码为 ' + c };
  }

  function login(phone, code) {
    var rec = codeCache[phone];
    if (!rec) return { ok: false, msg: '请先获取验证码' };
    if (Date.now() - rec.ts > 10 * 60 * 1000) return { ok: false, msg: '验证码已过期，请重新获取' };
    if (rec.code !== String(code).trim()) return { ok: false, msg: '验证码不正确' };
    var a = acc();
    var first = !a.phone;
    a.phone = phone;
    if (first) { a.credits += SIGNUP_BONUS; a.createdAt = Date.now(); }
    var claim = claimDaily(a);
    saveAcc(a);
    delete codeCache[phone];
    return { ok: true, first: first, bonus: first ? SIGNUP_BONUS : 0, daily: claim.ok ? claim.got : 0, msg: first ? ('注册成功，已赠送 ' + SIGNUP_BONUS + ' 积分') : '登录成功' };
  }

  function logout() {
    var a = acc();
    a.phone = '';
    saveAcc(a);
    return { ok: true, msg: '已退出登录' };
  }

  function claimDaily(a) {
    a = a || acc();
    var t = today();
    if (a.lastClaim === t) return { ok: false, msg: '今天已经领取过了，明天再来' };
    a.lastClaim = t;
    a.credits += DAILY_BONUS;
    return { ok: true, got: DAILY_BONUS, msg: '已领取 ' + DAILY_BONUS + ' 积分' };
  }

  function claimDailyAndSave() {
    var a = acc();
    var r = claimDaily(a);
    if (r.ok) saveAcc(a);
    return r;
  }

  /* ---------------- 卡密：由站长的私有校验服务完成 ----------------
     本文件是公开版，不含任何密钥与摘要算法。
     开启在线充值：把下面的 REDEEM_API 填成你自己的校验服务地址即可，
     其余逻辑无需改动；留空时在线充值关闭，用户改用桌面版工具台充值。
     ------------------------------------------------------------ */

  function apiBase() {
    try {
      var w = String(window.JK_REDEEM_API || '');
      return String(REDEEM_API || w).replace(/\/+$/, '');
    } catch (e) { return String(REDEEM_API || ''); }
  }

  function normCode(raw) {
    return String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  }

  // 到账：同一张卡本地只允许用一次
  function creditOnce(code, credits) {
    var used = jget(K_USED, []);
    if (used.indexOf(code) >= 0) return { ok: false, msg: '该卡密已被使用过' };
    used.push(code);
    jset(K_USED, used);
    var a = acc();
    a.credits += credits;
    saveAcc(a);
    log('recharge', '卡密充值 +' + credits);
    return { ok: true, credits: credits, msg: '充值成功，到账 ' + credits + ' 积分' };
  }

  // 校验并充值（异步）
  function redeem(raw) {
    var code = normCode(raw);
    if (!/^JK-[0-9A-Z]{12}-[0-9A-Z]{8}$/.test(code)) {
      return Promise.resolve({ ok: false, msg: '卡密格式不正确' });
    }
    if (!isLogin()) {
      return Promise.resolve({ ok: false, needLogin: true, msg: '请先登录后再充值' });
    }
    var api = apiBase();
    if (!api) {
      return Promise.resolve({ ok: false, msg: '在线充值未开启，请联系站长获取桌面版工具台。' });
    }
    var a0 = acc();
    return fetch(api + '/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code, user: a0.id || a0.name || '' })
    }).then(function (res) {
      return res.json()['catch'](function () { return { ok: false, msg: '校验服务返回异常' }; });
    }).then(function (v) {
      if (!v || !v.ok) return { ok: false, msg: (v && v.msg) || '卡密无效' };
      return creditOnce(code, v.credits);
    })['catch'](function () {
      return { ok: false, msg: '网络异常，请稍后重试' };
    });
  }
  /* ---------------- 使用记录 ---------------- */
  function log(action, detail) {
    try {
      var l = jget(K_LOG, []);
      l.unshift({ ts: Date.now(), action: action, detail: detail });
      if (l.length > 200) l = l.slice(0, 200);
      jset(K_LOG, l);
    } catch (e) {}
  }
  function getLog() { return jget(K_LOG, []); }

  /* ---------------- 会话窗口（30 分钟内不重复扣费） ---------------- */
  function win() {
    var w = jget(K_WIN, {});
    var now = Date.now(), changed = false;
    for (var k in w) { if (now - w[k] > WINDOW_MS) { delete w[k]; changed = true; } }
    if (changed) jset(K_WIN, w);
    return w;
  }
  function inWindow(key) { var w = win(); return w[key] && (Date.now() - w[key] <= WINDOW_MS); }
  function markWindow(key) {
    var w = win();
    w[key] = Date.now();
    // 限制条目数量
    var keys = Object.keys(w);
    if (keys.length > 60) { for (var i = 0; i < keys.length - 60; i++) delete w[keys[i]]; }
    jset(K_WIN, w);
  }
  function clearWindow(key) { var w = win(); delete w[key]; jset(K_WIN, w); }

  /* ---------------- 额度检查与扣费 ---------------- */
  function resetGuestIfNewDay(a) {
    var t = today();
    if (a.guestDate !== t) { a.guestDate = t; a.guestUsed = 0; }
  }

  // 查询：{ ok, reason, cost, left, hint }
  // 说明：30 分钟会话窗口只对登录用户生效，游客按次计数
  function canUse(slug, engine) {
    var cost = priceOf(slug, engine);
    var a = acc();
    var logged = isLogin();
    if (cost === 0) return { ok: true, cost: 0, left: a.credits, hint: '本工具完全免费' };
    if (logged && inWindow('w:' + slug)) return { ok: true, cost: 0, left: a.credits, hint: '本次会话已计费，30 分钟内可反复使用' };
    if (!logged) {
      resetGuestIfNewDay(a);
      if (cost > GUEST_MAX_COST) return { ok: false, cost: cost, needLogin: true, reason: 'heavy', hint: '该工具需要使用积分，请先登录' };
      if (a.guestUsed >= GUEST_DAILY) return { ok: false, cost: cost, needLogin: true, reason: 'guest', hint: '今日免费次数已用完，登录后继续' };
      return { ok: true, cost: cost, left: 0, guest: GUEST_DAILY - a.guestUsed, hint: '游客今日还可免费使用 ' + (GUEST_DAILY - a.guestUsed) + ' 次' };
    }
    if (a.credits < cost) {
      return { ok: false, cost: cost, left: a.credits, reason: 'nobalance', hint: '积分不足（需要 ' + cost + '，剩余 ' + a.credits + '）' };
    }
    return { ok: true, cost: cost, left: a.credits, hint: '本次消耗 ' + cost + ' 积分，剩余 ' + a.credits };
  }

  // 扣费：成功返回 ticket（用于失败时退款），并登记为待确认
  function spend(slug, engine) {
    var cost = priceOf(slug, engine);
    if (cost === 0) { log('use', slug + ' (免费)'); pending = null; return { ok: true, cost: 0, ticket: null }; }
    if (isLogin() && inWindow('w:' + slug)) { log('use', slug + ' (会话内)'); pending = null; return { ok: true, cost: 0, ticket: null }; }

    var a = acc();
    if (!isLogin()) {
      resetGuestIfNewDay(a);
      if (cost > GUEST_MAX_COST || a.guestUsed >= GUEST_DAILY) {
        return { ok: false, cost: cost, reason: 'guest', needLogin: true };
      }
      a.guestUsed += 1;
      saveAcc(a);
      pending = 'g:' + slug + ':' + Date.now();
      log('use', slug + ' (游客免费)');
      return { ok: true, cost: 0, ticket: pending };
    }
    if (a.credits < cost) return { ok: false, cost: cost, reason: 'nobalance', left: a.credits };
    a.credits -= cost;
    saveAcc(a);
    markWindow('w:' + slug);
    pending = 'u:' + slug + ':' + Date.now();
    log('use', slug + ' (-' + cost + ')');
    return { ok: true, cost: cost, ticket: pending };
  }

  // 退款（工具执行失败时调用）
  function refund(ticket) {
    if (!ticket) return;
    var a = acc();
    if (ticket.indexOf('u:') === 0) {
      var slug = ticket.split(':')[1];
      var cost = priceOf(slug, (window.__TOOL__ || {}).engine);
      a.credits += cost;
      saveAcc(a);
      clearWindow('w:' + slug);
      log('refund', slug + ' (+' + cost + ')');
    } else if (ticket.indexOf('g:') === 0) {
      var s = ticket.split(':')[1];
      if (a.guestUsed > 0) a.guestUsed -= 1;
      saveAcc(a);
      clearWindow('w:' + s);
      log('refund', s + ' (游客)');
    }
  }

  /* ---------------- 样式 ---------------- */
  var CSS = [
    // 悬浮条对齐顶部公告条右侧（公告条高 36px，内容居中，右侧空白充足）
    '.jk-bar{position:fixed;top:5px;right:14px;z-index:9998;display:flex;align-items:center;gap:6px;font-family:inherit}',
    '.jk-pill{display:flex;align-items:center;gap:6px;padding:4px 12px;border-radius:999px;background:rgba(255,255,255,.78);',
    '  backdrop-filter:blur(18px) saturate(180%);-webkit-backdrop-filter:blur(18px) saturate(180%);border:1px solid rgba(255,255,255,.95);',
    '  color:#241a45;font-size:12.5px;cursor:pointer;box-shadow:0 8px 22px -10px rgba(90,60,180,.5);transition:all .18s;white-space:nowrap}',
    '.jk-pill:hover{border-color:#a78bfa;transform:translateY(-1px)}',
    '.jk-dot{width:6px;height:6px;border-radius:50%;background:#7c5cff;box-shadow:0 0 8px rgba(124,92,255,.9);flex:none}',
    '.jk-dot.off{background:#b9aecf;box-shadow:none}',
    '.jk-num{color:#6a46e8;font-weight:700;font-variant-numeric:tabular-nums}',
    '.jk-btn{padding:4px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.95);background:rgba(255,255,255,.78);',
    '  backdrop-filter:blur(18px) saturate(180%);-webkit-backdrop-filter:blur(18px) saturate(180%);color:#241a45;font-size:12.5px;cursor:pointer;',
    '  font-family:inherit;white-space:nowrap;box-shadow:0 8px 22px -10px rgba(90,60,180,.5);transition:all .18s}',
    '.jk-btn:hover{border-color:#a78bfa;color:#6a46e8}',
    '.jk-mask{position:fixed;inset:0;z-index:10000;background:rgba(52,32,110,.30);backdrop-filter:blur(10px);',
    '  -webkit-backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:20px;font-family:inherit}',
    '.jk-modal{width:100%;max-width:420px;background:rgba(255,255,255,.86);border:1px solid rgba(255,255,255,.95);border-radius:24px;',
    '  backdrop-filter:blur(30px) saturate(180%);-webkit-backdrop-filter:blur(30px) saturate(180%);padding:26px;',
    '  box-shadow:0 30px 80px -24px rgba(70,40,150,.55),inset 0 1px 0 #fff;max-height:88vh;overflow:auto}',
    '.jk-h{font-size:18px;font-weight:700;color:#241a45;margin:0 0 6px}',
    '.jk-s{font-size:13px;color:#564a7d;line-height:1.6;margin:0 0 18px}',
    '.jk-lb{display:block;font-size:12px;color:#564a7d;margin:0 0 7px}',
    '.jk-in{width:100%;padding:11px 13px;border-radius:11px;border:1px solid rgba(124,92,255,.22);background:rgba(255,255,255,.85);',
    '  color:#241a45;font-size:14px;outline:none;font-family:inherit;box-sizing:border-box}',
    '.jk-in:focus{border-color:rgba(124,92,255,.6);box-shadow:0 0 0 3px rgba(124,92,255,.14)}',
    '.jk-row{display:flex;gap:9px}',
    '.jk-row .jk-in{flex:1}',
    '.jk-code{padding:11px 15px;border-radius:11px;border:1px solid rgba(124,92,255,.35);background:rgba(124,92,255,.10);',
    '  color:#6a46e8;font-size:13.5px;cursor:pointer;white-space:nowrap;flex:none;font-family:inherit;font-weight:600}',
    '.jk-code:disabled{opacity:.45;cursor:not-allowed}',
    '.jk-sub{width:100%;margin-top:17px;padding:12px;border-radius:12px;border:0;background:linear-gradient(135deg,#8b6dff,#6a46e8);color:#fff;',
    '  font-size:14.5px;font-weight:700;cursor:pointer;font-family:inherit;box-shadow:0 12px 26px -12px rgba(124,92,255,.85)}',
    '.jk-sub:hover{filter:brightness(1.07)}',
    '.jk-sub:disabled{background:#ded8ee;color:#9c93b5;box-shadow:none;cursor:not-allowed}',
    '.jk-msg{margin-top:12px;font-size:13px;min-height:19px;line-height:1.5}',
    '.jk-msg.err{color:#dc2626}.jk-msg.ok{color:#059669}.jk-msg.info{color:#6a46e8}',
    '.jk-plans{display:grid;grid-template-columns:repeat(2,1fr);gap:9px;margin:0 0 4px}',
    '.jk-plan{padding:13px;border-radius:13px;border:1px solid rgba(255,255,255,.9);background:rgba(255,255,255,.62);cursor:pointer;',
    '  text-align:center;transition:all .18s}',
    '.jk-plan:hover{border-color:#a78bfa;background:rgba(255,255,255,.85)}',
    '.jk-plan.on{border-color:#7c5cff;background:rgba(124,92,255,.14);box-shadow:0 0 0 3px rgba(124,92,255,.14)}',
    '.jk-pn{font-size:19px;font-weight:800;color:#6a46e8;line-height:1.2}',
    '.jk-pp{font-size:12px;color:#7a6ea0;margin-top:3px}',
    '.jk-gift{font-size:11px;color:#059669;margin-top:2px}',
    '.jk-note{font-size:11.5px;color:#8577a8;line-height:1.6;margin-top:14px;padding-top:13px;border-top:1px solid rgba(124,92,255,.14)}',
    '.jk-x{float:right;width:27px;height:27px;border-radius:8px;border:1px solid rgba(124,92,255,.18);background:rgba(255,255,255,.6);',
    '  color:#7a6ea0;cursor:pointer;font-size:15px;line-height:1;font-family:inherit}',
    '.jk-x:hover{color:#241a45;border-color:rgba(124,92,255,.45)}',
    '.jk-cost{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px;color:#564a7d;',
    '  padding:9px 13px;border-radius:11px;background:rgba(255,255,255,.58);border:1px solid rgba(255,255,255,.85);margin:0 0 13px}',
    '.jk-cost b{color:#6a46e8;font-weight:700}',
    '.jk-log{margin-top:13px;max-height:190px;overflow:auto;font-size:12px;color:#564a7d}',
    '.jk-log div{padding:5px 0;border-bottom:1px solid rgba(124,92,255,.10)}',
    '@media (max-width:640px){.jk-bar{top:9px;right:9px}.jk-pill,.jk-btn{padding:6px 10px;font-size:12px}}'
].join('\n');

  /* ---------------- UI ---------------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function ensureStyle() {
    if (document.getElementById('jk-style')) return;
    var s = document.createElement('style');
    s.id = 'jk-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function closeModal() {
    var m = document.getElementById('jk-modal-root');
    if (m) m.remove();
  }

  function modal(title, sub, html) {
    closeModal();
    var root = document.createElement('div');
    root.id = 'jk-modal-root';
    root.className = 'jk-mask';
    root.innerHTML = '<div class="jk-modal">' +
      '<button class="jk-x" data-jkx aria-label="关闭">✕</button>' +
      '<h3 class="jk-h">' + esc(title) + '</h3>' +
      '<p class="jk-s">' + sub + '</p>' + html + '</div>';
    root.addEventListener('click', function (e) {
      if (e.target === root || (e.target.getAttribute && e.target.getAttribute('data-jkx') !== null)) closeModal();
    });
    document.body.appendChild(root);
    return root;
  }

  function toast(msg, kind) {
    var el = document.createElement('div');
    el.className = 'jk-msg ' + (kind || 'info');
    el.textContent = msg;
    return el;
  }

  function currentTool() {
    return window.__TOOL__ || { slug: '', engine: '' };
  }

  /* ---- 顶栏积分条 ---- */
  function renderBar() {
    ensureStyle();
    var old = document.getElementById('jk-bar');
    if (old) old.remove();
    var a = acc();
    var t = currentTool();
    var cost = t.slug ? priceOf(t.slug, t.engine) : 0;

    var bar = document.createElement('div');
    bar.className = 'jk-bar';
    bar.id = 'jk-bar';

    var label;
    if (isLogin()) {
      label = '<span class="jk-dot"></span>' + esc(phoneMask(a.phone)) +
        ' · <span class="jk-num">' + a.credits + '</span> 积分';
    } else {
      resetGuestIfNewDay(a);
      var left = Math.max(0, GUEST_DAILY - a.guestUsed);
      label = '<span class="jk-dot off"></span>未登录 · 今日免费 <span class="jk-num">' + left + '</span> 次';
    }

    bar.innerHTML =
      '<div class="jk-pill" data-jk="panel">' + label + '</div>' +
      '<button class="jk-btn" data-jk="recharge">充值</button>' +
      (isLogin() ? '<button class="jk-btn" data-jk="logout">退出</button>'
                 : '<button class="jk-btn" data-jk="login">登录</button>');

    bar.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-jk]') : null;
      if (!el) return;
      var act = el.getAttribute('data-jk');
      if (act === 'login') openLogin();
      else if (act === 'recharge') openRecharge();
      else if (act === 'logout') { logout(); toastBar('已退出登录'); }
      else if (act === 'panel') openAccount();
    });

    document.body.appendChild(bar);

    // 隐藏顶栏里原站遗留的占位「登录」按钮 —— 积分条已提供更完整的入口，避免出现两个「登录」
    var legacy = document.querySelectorAll('header a, nav a');
    for (var i = 0; i < legacy.length; i++) {
      var a = legacy[i];
      if (/^登录$/.test((a.textContent || '').trim())) a.style.display = 'none';
    }

    // 工具区上方的消耗提示
    if (t.slug) {
      var host = document.querySelector('[data-tool]');
      if (host && !document.getElementById('jk-cost')) {
        var tip = document.createElement('div');
        tip.id = 'jk-cost';
        tip.className = 'jk-cost';
        var times = cost > 0 ? Math.floor(a.credits / cost) : Infinity;
        tip.innerHTML = cost === 0
          ? '<span>本工具 <b>完全免费</b>，不限次数使用</span>'
          : '<span>本次消耗 <b>' + cost + '</b> 积分（' + tierName(cost) + '档）</span>' +
            '<span class="jk-sep">·</span><span>' + (isLogin()
              ? ('余额 <b>' + a.credits + '</b>，约可用 <b>' + (times === Infinity ? '∞' : times) + '</b> 次')
              : ('登录后可查看余额，注册即送 <b>' + SIGNUP_BONUS + '</b> 积分')) + '</span>' +
            '<span class="jk-sep">·</span><span>30 分钟内反复使用只计一次</span>';
        host.parentNode.insertBefore(tip, host);
      }
    }
  }

  function toastBar(msg) {
    var bar = document.getElementById('jk-bar');
    if (bar) { bar.remove(); }
    renderBar();
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;top:60px;right:14px;z-index:9999;padding:9px 15px;border-radius:10px;' +
      'background:rgba(124,92,255,.14);border:1px solid rgba(124,92,255,.4);color:#7c5cff;font-size:13px;' +
      'backdrop-filter:blur(10px)';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2200);
  }

  /* ---- 登录弹窗 ---- */
  function openLogin(afterMsg) {
    var html =
      '<label class="jk-lb">手机号</label>' +
      '<input class="jk-in" id="jkPhone" type="tel" inputmode="numeric" maxlength="11" placeholder="请输入 11 位手机号" autocomplete="tel">' +
      '<div style="height:13px"></div>' +
      '<label class="jk-lb">验证码</label>' +
      '<div class="jk-row">' +
      '  <input class="jk-in" id="jkCode" type="text" inputmode="numeric" maxlength="6" placeholder="6 位验证码">' +
      '  <button class="jk-code" id="jkSend">获取验证码</button>' +
      '</div>' +
      '<button class="jk-sub" id="jkGo">登录 / 注册</button>' +
      '<div class="jk-msg" id="jkMsg">' + esc(afterMsg || '') + '</div>' +
      '<div class="jk-note">' +
      '  新用户登录即送 <b style="color:#7c5cff">' + SIGNUP_BONUS + '</b> 积分，每天首次登录再领 <b style="color:#7c5cff">' + DAILY_BONUS + '</b> 积分。<br>' +
      '  当前为本地演示模式：验证码不会真的发送到手机，会直接显示在按钮旁。接入短信服务后即可真实发送。' +
      '</div>';

    var root = modal('登录 / 注册', '用手机号登录，开始使用全部 490 个工具。', html);
    var msg = root.querySelector('#jkMsg');
    var sendBtn = root.querySelector('#jkSend');
    var phoneEl = root.querySelector('#jkPhone');
    var codeEl = root.querySelector('#jkCode');
    var tick = null;

    function setMsg(t, k) { msg.className = 'jk-msg ' + (k || 'info'); msg.textContent = t; }

    sendBtn.addEventListener('click', function () {
      var p = phoneEl.value.trim();
      var r = sendCode(p);
      if (!r.ok) { setMsg(r.msg, 'err'); return; }
      setMsg(r.msg, 'ok');
      codeEl.value = r.code;
      var left = 60;
      sendBtn.disabled = true;
      sendBtn.textContent = left + 's 后重发';
      tick = setInterval(function () {
        left -= 1;
        if (left <= 0) { clearInterval(tick); sendBtn.disabled = false; sendBtn.textContent = '重新获取'; }
        else sendBtn.textContent = left + 's 后重发';
      }, 1000);
    });

    root.querySelector('#jkGo').addEventListener('click', function () {
      var p = phoneEl.value.trim();
      var c = codeEl.value.trim();
      if (!p) { setMsg('请输入手机号', 'err'); return; }
      if (!c) { setMsg('请输入验证码', 'err'); return; }
      var r = login(p, c);
      if (!r.ok) { setMsg(r.msg, 'err'); return; }
      if (tick) clearInterval(tick);
      closeModal();
      toastBar(r.msg + (r.daily ? '，' + r.daily + ' 积分已到账' : ''));
    });

    setTimeout(function () { try { phoneEl.focus(); } catch (e) {} }, 60);
  }

  /* ---- 账户详情 ---- */
  function openAccount() {
    var a = acc();
    if (!isLogin()) { openLogin(); return; }
    var l = getLog().slice(0, 12);
    var logHtml = l.length
      ? l.map(function (x) {
          var d = new Date(x.ts);
          var t = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
          return '<div>' + t + ' · ' + esc(x.detail) + '</div>';
        }).join('')
      : '<div>暂无使用记录</div>';

    var times = [];
    [1, 2, 4, 5].forEach(function (c) {
      times.push(tierName(c) + '档 ' + Math.floor(a.credits / c) + ' 次');
    });

    var html =
      '<div style="padding:15px;border-radius:13px;background:rgba(124,92,255,.07);border:1px solid rgba(124,92,255,.2);margin-bottom:15px">' +
      '  <div style="font-size:12px;color:#a1a1aa">当前余额</div>' +
      '  <div style="font-size:32px;font-weight:800;color:#7c5cff;line-height:1.25">' + a.credits + ' <span style="font-size:14px;color:#a1a1aa">积分</span></div>' +
      '  <div style="font-size:12px;color:#71717a;margin-top:3px">' + esc(phoneMask(a.phone)) + ' · 约可 ' + times.join(' / ') + '</div>' +
      '</div>' +
      '<button class="jk-sub" id="jkClaim"' + (a.lastClaim === today() ? ' disabled' : '') + '>' +
      (a.lastClaim === today() ? '今日已领取，明天再来' : '领取每日 ' + DAILY_BONUS + ' 积分') + '</button>' +
      '<div style="height:19px"></div>' +
      '<div class="jk-lb">最近使用</div>' +
      '<div class="jk-log">' + logHtml + '</div>' +
      '<div class="jk-note">积分保存在本机浏览器，更换设备或清理浏览器数据会丢失。接入云端账本后可跨设备同步。</div>';

    var root = modal('我的账户', '查看余额、领取每日积分与使用记录。', html);
    var c = root.querySelector('#jkClaim');
    if (c && !c.disabled) {
      c.addEventListener('click', function () {
        var r = claimDailyAndSave();
        closeModal();
        toastBar(r.msg);
      });
    }
  }

  /* ---- 充值弹窗 ---- */
  var selPlan = 1; // 默认 50 分
  function openRecharge() {
    var plansHtml = PLANS.map(function (p, i) {
      var gift = p.credits === 300 ? '<div class="jk-gift">最划算</div>' : '';
      return '<div class="jk-plan' + (i === selPlan ? ' on' : '') + '" data-p="' + i + '">' +
        '<div class="jk-pn">' + p.credits + '</div>' +
        '<div class="jk-pp">' + p.price + '</div>' + gift + '</div>';
    }).join('');

    var html =
      '<div class="jk-lb">选择套餐</div>' +
      '<div class="jk-plans">' + plansHtml + '</div>' +
      '<div style="height:15px"></div>' +
      '<label class="jk-lb">卡密</label>' +
      '<input class="jk-in" id="jkRedeem" type="text" placeholder="输入卡密，例如 JK-01XXXXXXXXXX-XXXXXXXX" autocomplete="off">' +
      '<button class="jk-sub" id="jkRedeemGo">立即充值</button>' +
      '<div class="jk-msg" id="jkMsg"></div>' +
      '<div class="jk-note">' +
      '<b style="color:#f4f2ec">如何购买：</b>联系站长付款后获取卡密，在本页输入即可到账。<br>' +
      '<b style="color:#f4f2ec">计费规则：</b>轻量工具 1 分/次，标准 2 分/次，音视频 4 分/次，AI 类 5 分/次；' +
      '同一工具 30 分钟内反复使用只计一次。游戏、计时器、仪表类工具永久免费。' +
      '</div>';

    var root = modal('充值积分', '选择套餐 → 向站长付款获取卡密 → 输入卡密到账。', html);
    var msg = root.querySelector('#jkMsg');
    var input = root.querySelector('#jkRedeem');

    root.querySelectorAll('.jk-plan').forEach(function (el) {
      el.addEventListener('click', function () {
        selPlan = parseInt(el.getAttribute('data-p'), 10);
        root.querySelectorAll('.jk-plan').forEach(function (x) { x.classList.remove('on'); });
        el.classList.add('on');
      });
    });

    root.querySelector('#jkRedeemGo').addEventListener('click', function () {
      var btn = this;
      var v = input.value.trim();
      if (!v) { msg.className = 'jk-msg err'; msg.textContent = '请输入卡密'; return; }
      msg.className = 'jk-msg info'; msg.textContent = '校验中…';
      btn.disabled = true;
      redeem(v).then(function (r) {
        btn.disabled = false;
        if (r.needLogin) { closeModal(); setTimeout(openLogin, 120); return; }
        msg.className = 'jk-msg ' + (r.ok ? 'ok' : 'err');
        msg.textContent = r.msg;
        if (r.ok) {
          input.value = '';
          setTimeout(function () { closeModal(); toastBar(r.msg); }, 900);
        }
      });
    });

    setTimeout(function () { try { input.focus(); } catch (e) {} }, 60);
  }

  /* ---------------- 执行拦截：惰性扣费 + 失败退款 ---------------- */
  var pending = null;

  function badge(host) {
    // 在工具区顶部插一条「本次已计费 / 剩余」提示
    var old = document.getElementById('jk-badge');
    if (old) old.remove();
    var el = document.createElement('div');
    el.id = 'jk-badge';
    el.className = 'jk-cost';
    var a = acc();
    var t = currentTool();
    var cost = priceOf(t.slug, t.engine);
    el.innerHTML = '<span>✓ 本次会话已计费（' + (cost ? cost : 0) + ' 积分）</span>' +
      '<span class="jk-sep">·</span><span>30 分钟内可反复使用</span>' +
      (isLogin() ? '<span class="jk-sep">·</span><span>余额 <b>' + a.credits + '</b></span>' : '');
    host.parentNode.insertBefore(el, host);
  }

  // 判断按钮是否为主执行按钮
  var RUN_WORDS = /(开始|转换|生成|压缩|运行|执行|处理|合并|拆分|裁剪|下载|导出|应用|添加|去除|修复|优化|加密|解密|计算|播放|检测|识别|扫描|提取|预览|提交|确定|确认|go|run|start|convert|generate|apply|process|download|export)/i;
  function isRunBtn(btn) {
    var cls = btn.className || '';
    if (/btn-lime/.test(cls)) return true;
    if (/btn-play/.test(cls)) return true;
    var txt = (btn.innerText || btn.textContent || '').trim();
    if (txt && RUN_WORDS.test(txt)) return true;
    return false;
  }

  function guardTool(host, slug, engine) {
    if (!host) return;
    var key = 'w:' + slug;
    var cost = priceOf(slug, engine);

    function tryCharge(realtime) {
      if (inWindow(key)) return true;
      var chk = canUse(slug, engine);
      if (chk.ok) {
        var r = spend(slug, engine);
        if (r.ok) {
          pending = r.ticket;
          badge(host);
          return true;
        }
      }
      // 需要登录 / 余额不足
      var msg = chk.hint || (chk.reason === 'nobalance'
        ? '积分不足，本次需要 ' + cost + ' 积分'
        : '该工具需要使用积分，请先登录');
      if (!isLogin()) openLogin(msg);
      else openRecharge();
      return false;
    }

    // 1) 主执行按钮点击：捕获阶段拦截
    host.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('button') : null;
      if (!btn || !host.contains(btn)) return;
      if (!isRunBtn(btn)) return;
      if (!tryCharge()) {
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);

    // 2) 实时类工具（无执行按钮）：首次输入后计费
    var t = null;
    host.addEventListener('input', function () {
      if (inWindow(key)) return;
      clearTimeout(t);
      t = setTimeout(function () { tryCharge(true); }, 900);
    }, true);
    host.addEventListener('change', function () {
      if (inWindow(key)) return;
      tryCharge(true);
    }, true);
  }

  /* ---------------- 对外 API ---------------- */
  var JK = {
    acc: acc,
    isLogin: isLogin,
    login: login,
    logout: logout,
    sendCode: sendCode,
    claimDaily: claimDailyAndSave,
    redeem: redeem,
    priceOf: priceOf,
    kindOf: kindOf,
    tierName: tierName,
    canUse: canUse,
    spend: spend,
    refund: refund,
    getLog: getLog,
    onChange: function (fn) { listeners.push(fn); },
    /* 引擎执行失败时调用，退还本次积分 */
    fail: function () { refund(pending); pending = null; },
    /* 引擎执行成功时调用，确认扣费 */
    done: function () { pending = null; },
    /* 页面入口 */
    render: renderBar,
    guard: guardTool,
    openLogin: openLogin,
    openRecharge: openRecharge,
    openAccount: openAccount,
    CONST: { SIGNUP_BONUS: SIGNUP_BONUS, DAILY_BONUS: DAILY_BONUS, GUEST_DAILY: GUEST_DAILY, WINDOW_MS: WINDOW_MS }
  };

  window.JK = JK;
})();
