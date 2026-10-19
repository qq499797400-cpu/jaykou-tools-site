/* ==========================================================================
   vision.js — 视觉层动效引擎
   纯原生、零依赖、离线可用。只做「增强」：脚本没跑起来时页面依然是完整可用的。
   ========================================================================== */
(function () {
  'use strict';

  var reduce = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var coarse = window.matchMedia &&
    window.matchMedia('(hover: none)').matches;
  var fine = !coarse && window.matchMedia &&
    window.matchMedia('(pointer: fine)').matches;

  /* ---------- 工具 ---------- */
  function raf(fn) {
    var queued = false;
    return function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () {
        queued = false;
        fn();
      });
    };
  }

  /* ---------- 1. 文本拆分：逐字 / 逐词 ---------- */
  function splitText(el, byWord) {
    if (el.dataset.vSplit === '1') return;
    var text = (el.textContent || '').trim();
    if (!text) return;

    // 中英文混排：英文单词整体不拆，其余按字拆
    var parts = byWord
      ? text.split(/(\s+)/)
      : text.match(/[A-Za-z0-9'’.\-]+|\s+|[\s\S]/g) || [text];

    var frag = document.createDocumentFragment();
    var i = 0;
    parts.forEach(function (p) {
      if (/^\s+$/.test(p)) {
        frag.appendChild(document.createTextNode(' '));
        return;
      }
      var span = document.createElement('span');
      span.className = byWord ? 'v-word' : 'v-char';
      span.style.setProperty('--v-i', String(i++));
      span.textContent = p;
      frag.appendChild(span);
    });

    el.textContent = '';
    el.appendChild(frag);
    el.dataset.vSplit = '1';
  }

  function prepareSplits() {
    var nodes = document.querySelectorAll('.v-split, .v-split-w');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      splitText(el, el.classList.contains('v-split-w'));
    }
  }

  /* ---------- 2. 入场观察 ---------- */
  var io = null;
  function observeReveals() {
    var targets = document.querySelectorAll(
      '.v-reveal, .v-split, .v-split-w'
    );
    if (!targets.length) return;

    if (reduce || !('IntersectionObserver' in window)) {
      for (var k = 0; k < targets.length; k++) targets[k].classList.add('is-in');
      return;
    }

    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });

    for (var i = 0; i < targets.length; i++) io.observe(targets[i]);
  }

  /* ---------- 3. 滚动视差 ---------- */
  function initParallax() {
    var items = document.querySelectorAll('[data-v-parallax]');
    if (!items.length || reduce) return;

    var update = raf(function () {
      var vh = window.innerHeight;
      for (var i = 0; i < items.length; i++) {
        var el = items[i];
        var speed = parseFloat(el.getAttribute('data-v-parallax')) || 0.12;
        var r = el.getBoundingClientRect();
        if (r.bottom < -200 || r.top > vh + 200) continue;
        var center = r.top + r.height / 2 - vh / 2;
        el.style.transform = 'translate3d(0,' + (-center * speed).toFixed(2) + 'px,0)';
      }
    });

    window.addEventListener('scroll', update, { passive: true });
    update();
  }

  /* ---------- 4. 卡片 3D 倾斜 ---------- */
  function initTilt() {
    if (reduce || coarse) return;
    var cards = document.querySelectorAll('.v-tilt');
    var MAX = 6;

    for (var i = 0; i < cards.length; i++) {
      (function (card) {
        var rect = null;
        card.addEventListener('pointerenter', function () {
          rect = card.getBoundingClientRect();
        });
        card.addEventListener('pointermove', function (e) {
          if (!rect) rect = card.getBoundingClientRect();
          var px = (e.clientX - rect.left) / rect.width;
          var py = (e.clientY - rect.top) / rect.height;
          card.style.setProperty('--v-ry', ((px - 0.5) * 2 * MAX).toFixed(2) + 'deg');
          card.style.setProperty('--v-rx', ((0.5 - py) * 2 * MAX).toFixed(2) + 'deg');
          card.style.setProperty('--v-lift', '-3px');
        });
        card.addEventListener('pointerleave', function () {
          rect = null;
          card.style.setProperty('--v-rx', '0deg');
          card.style.setProperty('--v-ry', '0deg');
          card.style.setProperty('--v-lift', '0px');
        });
      })(cards[i]);
    }
  }

  /* ---------- 5. 光标光晕 ---------- */
  function initCursor() {
    if (reduce || !fine) return;
    var dot = document.querySelector('.v-cursor');
    if (!dot) return;

    var tx = window.innerWidth / 2, ty = window.innerHeight / 2;
    var cx = tx, cy = ty;

    window.addEventListener('pointermove', function (e) {
      tx = e.clientX;
      ty = e.clientY;
      dot.classList.add('is-on');
    }, { passive: true });

    (function loop() {
      cx += (tx - cx) * 0.14;
      cy += (ty - cy) * 0.14;
      dot.style.transform = 'translate3d(' + cx.toFixed(1) + 'px,' + cy.toFixed(1) + 'px,0)';
      requestAnimationFrame(loop);
    })();
  }

  /* ---------- 6. 首屏光晕跟随 ---------- */
  function initHeroGlow() {
    var host = document.querySelector('[data-v-glow]');
    if (!host || reduce || coarse) return;

    host.addEventListener('pointermove', function (e) {
      var r = host.getBoundingClientRect();
      var mx = ((e.clientX - r.left) / r.width) * 100;
      var my = ((e.clientY - r.top) / r.height) * 100;
      host.style.setProperty('--v-mx', mx.toFixed(2) + '%');
      host.style.setProperty('--v-my', my.toFixed(2) + '%');
    }, { passive: true });
  }

  /* ---------- 7. 数字滚动 ---------- */
  function initCounters() {
    var nodes = document.querySelectorAll('[data-v-count]');
    if (!nodes.length) return;

    function run(el) {
      var target = parseFloat(el.getAttribute('data-v-count')) || 0;
      if (reduce) { el.textContent = String(target); return; }
      var dur = 1100;
      var t0 = performance.now();
      (function tick(now) {
        var p = Math.min(1, (now - t0) / dur);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = String(Math.round(target * eased));
        if (p < 1) requestAnimationFrame(tick);
      })(t0);
    }

    if (!('IntersectionObserver' in window)) {
      for (var i = 0; i < nodes.length; i++) run(nodes[i]);
      return;
    }
    var o = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        run(e.target);
        o.unobserve(e.target);
      });
    }, { threshold: 0.4 });
    for (var j = 0; j < nodes.length; j++) o.observe(nodes[j]);
  }

  /* ---------- 8. 分类锚点：滚动时高亮当前分区 ---------- */
  function initSectionSpy() {
    var links = document.querySelectorAll('[data-v-spy]');
    if (!links.length || !('IntersectionObserver' in window)) return;

    var map = {};
    for (var i = 0; i < links.length; i++) {
      var id = links[i].getAttribute('data-v-spy');
      if (id) map[id] = links[i];
    }

    var o = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        var link = map[e.target.id];
        if (!link) return;
        if (e.isIntersecting) {
          for (var k in map) map[k].removeAttribute('data-v-active');
          link.setAttribute('data-v-active', '');
        }
      });
    }, { rootMargin: '-20% 0px -70% 0px' });

    for (var id in map) {
      var sec = document.getElementById(id);
      if (sec) o.observe(sec);
    }
  }

  /* ---------- 启动 ---------- */
  function boot() {
    prepareSplits();
    observeReveals();
    initParallax();
    initTilt();
    initCursor();
    initHeroGlow();
    initCounters();
    initSectionSpy();
    document.documentElement.setAttribute('data-vision', '1');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
