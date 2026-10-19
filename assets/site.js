/* ==========================================================================
   嘉Jaykou工具台 · 免费工具 — 全站共享脚本
   职责：通用交互（导航/FAQ/cookie/toast）、目录页渲染、工具引擎按需加载
   每个工具页通过 window.__TOOL__ = {slug, engine, cfg} 声明自己要挂载的引擎
   ========================================================================== */
(function () {
  'use strict';

  /* ---------- 资源根路径（由本脚本自身 URL 推导，页面处于哪一层都不受影响） ---------- */
  const ASSET_BASE = (function () {
    try {
      const s = document.currentScript;
      if (s && s.src) return s.src.replace(/assets\/site\.js(?:[?#].*)?$/, '');
    } catch (e) {}
    return './';
  })();

  /* ---------- helpers ---------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  window.$ = window.$ || $;
  window.$$ = window.$$ || $$;

  window.fmtSize = function (b) {
    if (b == null) return '—';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
    if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
    return (b / 1073741824).toFixed(2) + ' GB';
  };
  window.fmtT = function (t, isNum) {
    t = Math.max(0, t || 0);
    const m = Math.floor(t / 60), s = t - m * 60;
    const ss = isNum ? s.toFixed(1).padStart(4, '0') : (s < 10 ? '0' : '') + s.toFixed(1);
    return m + ':' + ss;
  };
  window.toast = function (msg) {
    let t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600);
  };
  window.downloadBlob = function (blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  };
  window.copyText = function (txt) {
    navigator.clipboard.writeText(txt).then(() => window.toast('已复制'), () => window.toast('复制失败'));
  };
  // 通用拖拽/粘贴投喂
  window.bindFileInput = function (zone, input, accept, cb) {
    if (!zone || !input) return;
    input.accept = accept || input.accept || '';
    zone.addEventListener('click', e => { if (!e.target.closest('button')) input.click(); });
    input.addEventListener('change', () => { if (input.files[0]) cb(input.files[0]); });
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('over');
      const f = e.dataTransfer.files[0]; if (f) cb(f);
    });
  };
  // 图标
  window.icon = function (name, size) {
    const s = size || 18;
    const paths = {
      video: '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="M10 9.5l5 2.5-5 2.5z" fill="currentColor" stroke="none"/>',
      image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>',
      audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
      text: '<path d="M4 7V4h16v3M9 4v16M15 4v16M7 20h4M13 20h4"/>',
      pdf: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/>',
      calc: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 10h2M12 10h2M16 10h.01M8 14h2M12 14h2M16 14h.01M8 18h6"/>',
      gen: '<path d="M12 2l2.5 5.5L20 9l-4 4 1 6-5-2.8L7 19l1-6-4-4 5.5-.5z"/>',
      code: '<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>',
      game: '<rect x="2" y="7" width="20" height="10" rx="4"/><path d="M7 10v4M5 12h4M16 11h.01M18 13h.01"/>',
      cube: '<path d="M12 2l8 4.5v9L12 20l-8-4.5v-9z"/><path d="M12 11L4 6.5M12 11l8-4.5M12 11v9"/>',
      ai: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/><circle cx="12" cy="12" r="3.2"/>',
      doc: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h4"/>'
    };
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.gen}</svg>`;
  };

  /* ---------- FAQ ---------- */
  document.addEventListener('click', e => {
    const q = e.target.closest('.faq-q');
    if (q) {
      const it = q.parentElement, was = it.classList.contains('open');
      const scope = it.closest('.faq') || document;
      $$('.faq-item', scope).forEach(x => x.classList.remove('open'));
      if (!was) it.classList.add('open');
    }
    const del = e.target.closest('[data-cookie]');
    if (del) del.closest('.cookie')?.remove();
  });

  /* ---------- 导航搜索：跳目录页并带查询 ---------- */
  const navSearch = $('#navSearch');
  if (navSearch) {
    navSearch.addEventListener('keydown', e => {
      if (e.key === 'Enter' && navSearch.value.trim()) {
        location.href = 'index.html?q=' + encodeURIComponent(navSearch.value.trim());
      }
    });
  }

  /* ---------- 目录页渲染 ---------- */
  function renderDirectory() {
    const grid = $('#dirGrid');
    if (!grid || !window.__TOOLS__) return;
    const all = window.__TOOLS__;
    const cats = window.__CATS__ || {};
    const catBar = $('#dirCats');
    const inp = $('#dirSearch');
    const countEl = $('#dirCount');
    let curCat = 'all', q = '';

    const list = Object.keys(cats).filter(k => k !== 'all').map(k => ({ key: k, label: cats[k], n: all.filter(t => t.c === k).length }));

    function paint() {
      const items = all.filter(t => (curCat === 'all' || t.c === curCat) && (!q || t.t.toLowerCase().includes(q) || t.s.toLowerCase().includes(q) || (t.d || '').toLowerCase().includes(q)));
      grid.innerHTML = items.length ? items.map(t => `
        <a class="tcard" href="free-tools/${t.s}.html">
          <span class="ic">${window.icon(catIcon(t.c))}</span>
          <span><b>${t.t}</b><span>${(t.d || '').slice(0, 78)}</span></span>
        </a>`).join('') : '<div class="emptystate">没有找到匹配的工具。</div>';
      if (countEl) countEl.textContent = items.length;
    }
    function catIcon(c) {
      return { video: 'video', audio: 'audio', image: 'image', pdf: 'pdf', doc: 'doc', text: 'text', calc: 'calc', gen: 'gen', dev: 'code', game: 'game', '3d': 'cube', ai: 'ai' }[c] || 'gen';
    }
    if (catBar) {
      catBar.innerHTML = `<button class="dircat on" data-c="all">全部 ${all.length}</button>` +
        list.map(c => `<button class="dircat" data-c="${c.key}">${c.label} ${c.n}</button>`).join('');
      catBar.addEventListener('click', e => {
        const b = e.target.closest('.dircat'); if (!b) return;
        $$('.dircat', catBar).forEach(x => x.classList.remove('on')); b.classList.add('on');
        curCat = b.dataset.c; paint();
      });
    }
    if (inp) {
      const params = new URLSearchParams(location.search);
      const pre = params.get('q');
      if (pre) { inp.value = pre; q = pre.toLowerCase(); }
      inp.addEventListener('input', () => { q = inp.value.trim().toLowerCase(); paint(); });
    }
    // 若有预置搜索：直接在搜索框附近聚焦
    const stats = $('#dirStats');
    if (stats) stats.innerHTML = `<span><b style="color:#4f46e5">${all.length}</b> 个免费工具</span><span>无需注册</span><span>浏览器内运行</span><span>无水印</span>`;
    paint();
  }

  /* ==========================================================================
     TUI — 各引擎共用的工具界面构件（stage/pane 骨架、表单控件、结果区、拖拽区）
     所有新引擎都通过 window.TUI 复用，保证 490 个页面视觉完全一致
     ========================================================================== */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const q = (s, r) => (r || document).querySelector(s);

  window.TUI = {
    esc,
    /* 左 stage / 右 pane 标准外壳 */
    shell(host, wide) {
      host.innerHTML = `<div class="tool-body${wide ? ' wide' : ''}"><div class="stage" id="tStage"></div><div class="pane" id="tPane"></div></div>`;
      return { stage: q('#tStage', host), pane: q('#tPane', host) };
    },
    /* 只有 stage 的单栏外壳 */
    single(host) {
      host.innerHTML = `<div class="tool-body single"><div class="stage" id="tStage"></div></div>`;
      return q('#tStage', host);
    },
    /* 面板标题 */
    head(title, desc) { return `<div class="ptitle">${esc(title)}</div>${desc ? `<div class="pdesc">${desc}</div>` : ''}`; },
    /* 表单控件 */
    field(label, input) { return `<div class="plabel">${esc(label)}</div>${input}`; },
    input(id, val, ph, type) { return `<input type="${type || 'text'}" id="${id}" value="${esc(val || '')}" placeholder="${esc(ph || '')}">`; },
    area(id, val, ph, rows) { return `<textarea id="${id}" rows="${rows || 8}" placeholder="${esc(ph || '')}">${esc(val || '')}</textarea>`; },
    sel(id, options, val) {
      return `<select id="${id}">${options.map(o => {
        const v = o.v !== undefined ? o.v : o; const t = o.t !== undefined ? o.t : o;
        return `<option value="${esc(v)}"${String(v) === String(val) ? ' selected' : ''}>${esc(t)}</option>`;
      }).join('')}</select>`;
    },
    range(id, min, max, val, step) { return `<div class="sliderrow"><input type="range" id="${id}" min="${min}" max="${max}" step="${step || 1}" value="${val}"><span class="val" id="${id}V">${val}</span></div>`; },
    chk(id, label, on) { return `<div class="chk${on ? ' on' : ''}" id="${id}"><span class="box">${window.icon('gen', 11)}</span>${esc(label)}</div>`; },
    card(id, title, desc, on) { return `<div class="optcard${on ? ' on' : ''}" id="${id}"><b>${esc(title)}</b><span>${esc(desc || '')}</span></div>`; },
    pill(val, label, on) { return `<button class="shape${on ? ' on' : ''}" data-v="${esc(val)}">${esc(label || val)}</button>`; },
    /* 结果信息卡 */
    result(rows, extra) {
      return `<div class="resultbox">${rows.map(r => `<div class="row"><span>${esc(r[0])}</span><b>${r[1]}</b></div>`).join('')}</div>${extra || ''}`;
    },
    /* 拖拽 / 点击上传区 */
    drop(inner, accept, multiple) {
      return `<div class="drop" id="tDrop">${inner}<p class="fmts" style="margin-top:14px">或点击选择文件</p>
        <input type="file" id="tFile" accept="${esc(accept || '')}" ${multiple ? 'multiple' : ''} style="display:none"></div>`;
    },
    /* 绑定拖拽区；返回 promise 化的 picker */
    bindDrop(scope, accept, multiple, onFiles) {
      const dz = q('#tDrop', scope), fi = q('#tFile', scope);
      if (!dz) return;
      const fire = list => { const arr = [...list].filter(Boolean); if (arr.length) onFiles(arr); };
      dz.addEventListener('click', e => { if (!e.target.closest('button')) fi.click(); });
      fi.addEventListener('change', () => fire(fi.files));
      dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('over'));
      dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); fire(e.dataTransfer.files); });
    },
    /* 复制按钮组 */
    copyRow(label, getter) {
      return `<div class="shapes" style="margin-top:14px"><button class="btn-ghost btn-sm" id="tCopy">复制${esc(label)}</button><button class="btn-ghost btn-sm" id="tDown">下载</button></div>`;
    },
    /* 让 progress 条动起来 */
    prog(el, pct) { if (el) { el.style.display = 'block'; q('i', el).style.width = Math.max(0, Math.min(100, pct)) + '%'; } },
    /* 读取文件为 dataURL / ArrayBuffer / text */
    readDataURL: f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); }),
    readBuf: f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsArrayBuffer(f); }),
    readText: f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(f); }),
    say(host, msg, icon) {
      host.innerHTML = `<div class="tool-body single"><div class="stage"><div class="soon">${window.icon(icon || 'gen')} <span>${esc(msg)}</span></div></div></div>`;
    },
    /* 通用「还没接线」占位 */
    soon(host, why) {
      host.innerHTML = `<div class="tool-body single"><div class="stage"><div class="soon">${window.icon('ai')} <span>${esc(why || '这个工具在下一批本地引擎计划中。本页的介绍、FAQ 和链接都是真实可用的。')}</span></div></div></div>`;
    }
  };

  /* ---------- 工具引擎挂载 ---------- */
  function loadEngine(name) {
    return new Promise((res, rej) => {
      const key = 'engine-' + name;
      if (window.TOOL_ENGINES && window.TOOL_ENGINES[name]) return res(window.TOOL_ENGINES[name]);
      if (window.__engLoading && window.__engLoading[key]) { window.__engLoading[key].push(res); return; }
      window.__engLoading = window.__engLoading || {}; window.__engLoading[key] = [res];
      const s = document.createElement('script');
      s.src = ASSET_BASE + 'assets/impl/engine-' + name + '.js';
      s.onload = () => {
        const mod = (window.TOOL_ENGINES || {})[name];
        (window.__engLoading[key] || []).forEach(f => f(mod));
        window.__engLoading[key] = [];
      };
      s.onerror = () => { rej(new Error('engine load failed: ' + name)); };
      document.head.appendChild(s);
    });
  }

  /* ---------- 积分模块加载 ---------- */
  function loadCredits() {
    if (window.JK) return Promise.resolve(window.JK);
    return new Promise(res => {
      const s = document.createElement('script');
      s.src = ASSET_BASE + 'assets/credits.js';
      s.onload = () => res(window.JK);
      s.onerror = () => res(null);
      document.head.appendChild(s);
    });
  }

  async function mountTool() {
    const host = $('[data-tool]');
    if (!host || !window.__TOOL__) return;
    const cfg = window.__TOOL__;
    try {
      const mod = await loadEngine(cfg.engine);
      if (mod && mod.mount) mod.mount(host, cfg.cfg || {}, cfg.slug);
      else throw new Error('engine has no mount');

      // 引擎未移植（渲染成占位说明）时退还本次积分
      if (window.JK) {
        setTimeout(() => {
          const txt = (host.innerText || '');
          if (/移植中|即将上线|下一批/.test(txt)) { window.JK.fail(); window.JK.render(); }
        }, 700);
      }
    } catch (err) {
      console.error(err);
      if (window.JK) window.JK.fail();
      host.innerHTML = `<div class="soon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
        <span>该工具正在移植中，页面介绍与链接已就绪，本地引擎即将上线。</span></div>`;
    }
  }

  /* 原站遗留的 /sign-in 死链 -> 改为打开登录弹窗 */
  function hijackSignIn() {
    $$('a[href*="/sign-in"]').forEach(a => {
      if (a.dataset.jkBound) return;
      a.dataset.jkBound = '1';
      a.setAttribute('href', 'javascript:void(0)');
      a.addEventListener('click', e => {
        e.preventDefault();
        if (window.JK) window.JK.openLogin();
      });
    });
  }

  /* 紫雾玻璃主题：背景漂浮光斑层 */
  function mountDeco() {
    if (document.querySelector('.jk-deco')) return;
    const d = document.createElement('div');
    d.className = 'jk-deco';
    d.setAttribute('aria-hidden', 'true');
    d.innerHTML = '<i></i><i></i><i></i>';
    document.body.insertBefore(d, document.body.firstChild);
  }

  async function boot() {
    mountDeco();
    renderDirectory();
    await loadCredits();
    if (window.JK) {
      window.JK.render();
      window.JK.onChange(() => window.JK.render());
      const host = $('[data-tool]');
      if (host && window.__TOOL__ && window.__TOOL__.slug) {
        // 先装拦截，再挂引擎，确保首次点击就能计费
        window.JK.guard(host, window.__TOOL__.slug, window.__TOOL__.engine);
      }
      hijackSignIn();
    }
    mountTool();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
