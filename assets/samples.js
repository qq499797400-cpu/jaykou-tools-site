/* ==========================================================================
   samples.js — 让「用样张试试」的示例卡片真正能用
   背景：这些卡片是从原站克隆来的静态 DOM，React 的事件处理器没跟过来，
         点了没有任何反应（全站 161 页 / 1073 张卡）。
   做法（等引擎就绪后再判断，因为工具真正的文件框是引擎运行时建的）：
     · 页面里有「收图片」的文件框 —— 点卡片 → 取卡内图片 → 注入文件框 →
       触发引擎载入，等于用户真的选了一张图。
     · 只有视频 / 音频 / PDF 文件框 —— 卡片只有一张封面图，没有真实源文件，
       接不上就是死按钮，直接把整块示例区隐藏，别骗人。
   ========================================================================== */
(function () {
  'use strict';

  var CARD = '[class*=sampleCard],[class*=galleryCard]';
  var busy = false;

  function fileInputs() {
    return Array.prototype.slice.call(document.querySelectorAll('input[type=file]'));
  }

  function hideSamples() {
    var cards = document.querySelectorAll(CARD);
    if (!cards.length) return;
    var grid = cards[0].closest('[class*=sampleGrid],[class*=gallery],[class*=promo]') || cards[0];
    var host = grid;
    for (var up = grid; up && up !== document.body; up = up.parentElement) {
      host = up;
      if (up.tagName === 'SECTION') break;
    }
    /* 上层容器里没有真正的工具控件才整块隐藏，避免误伤页面主体 */
    if (host && !host.querySelector('input[type=file],canvas')) host.style.display = 'none';
    else grid.style.display = 'none';
  }

  async function loadSample(card) {
    if (busy) return;
    var img = card.querySelector('img[src]');
    var targets = fileInputs().filter(function (i) {
      var a = String(i.getAttribute('accept') || '');
      return !a || /image/.test(a);
    });
    if (!img || !targets.length) return;

    busy = true;
    card.style.opacity = '.55';
    try {
      var url = img.currentSrc || img.src;
      var res = await fetch(url);
      var blob = await res.blob();
      if (!blob.size) throw new Error('empty');

      var ext = (url.split('?')[0].split('.').pop() || 'png').toLowerCase();
      if (!/^(png|jpe?g|webp|gif|bmp|avif|ico)$/.test(ext)) ext = 'png';
      var label = card.getAttribute('aria-label') || card.textContent.trim().slice(0, 24) || 'sample';
      var name = label.replace(/[^\w\u4e00-\u9fa5]+/g, '_').slice(0, 40) + '.' + ext;
      var file = new File([blob], name, { type: blob.type || ('image/' + (ext === 'jpg' ? 'jpeg' : ext)) });

      /* 引擎的文件框是运行时建的，一并派发，命中的那个会响应 */
      targets.forEach(function (inp) {
        try {
          var dt = new DataTransfer();
          dt.items.add(file);
          inp.files = dt.files;
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (e) { /* 某个框不支持就算了，别中断 */ }
      });

      setTimeout(function () {
        var zone = targets[targets.length - 1].closest('section,form,div') || targets[targets.length - 1];
        try { zone.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { /* noop */ }
      }, 150);
    } catch (e) {
      card.style.opacity = '.35';
      card.title = '这张样张暂时无法载入，请直接上传自己的图片';
    } finally {
      busy = false;
      if (card.style.opacity === '.55') card.style.opacity = '';
    }
  }

  function boot() {
    if (!document.querySelectorAll(CARD).length) return;

    var imgInputs = fileInputs().filter(function (i) {
      var a = String(i.getAttribute('accept') || '');
      return !a || /image/.test(a);
    });

    if (!imgInputs.length) { hideSamples(); return; }

    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest(CARD) : null;
      if (!el) return;
      e.preventDefault();
      loadSample(el);
    });
  }

  /* 引擎是异步挂载的，等它把真正的 input 建好再判断 */
  function ready() { setTimeout(boot, 700); }
  if (document.readyState === 'complete') ready();
  else window.addEventListener('load', ready);
})();
