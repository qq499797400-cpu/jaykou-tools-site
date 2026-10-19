/* ==========================================================================
   engine-todo.js — 通用工具外壳
   用于还没接入本地引擎的工具页：保留原站说明与结构，给出清晰的状态说明
   ========================================================================== */
(function () {
  'use strict';
  const E = {};
  window.TOOL_ENGINES = window.TOOL_ENGINES || {};

  E.mount = function (host, cfg, slug) {
    host.innerHTML = `
      <div class="tool-body single">
        <div class="stage" style="align-items:center;justify-content:center;text-align:center;padding:54px 22px">
          <div class="drop" style="border-style:solid;border-color:#2a2a2a;background:#141414;cursor:default;max-width:640px">
            <div class="ic" style="border-radius:14px">${window.icon('ai', 28)}</div>
            <h3>This one is queued next</h3>
            <p style="max-width:460px">The page, copy, FAQ and help content are already in place. Its local engine has not been wired up yet, so nothing is broken — the tool area simply shows this notice until the engine ships.</p>
            <div class="shapes" style="justify-content:center;margin-top:6px">
              <a class="shape" href="../index.html?c=video">Video tools that work now</a>
              <a class="shape" href="../index.html?c=image">Image tools that work now</a>
              <a class="shape" href="../index.html?c=text">Text tools that work now</a>
            </div>
            <div class="note" style="margin-top:22px">Everything else on this page — how it works, the FAQ, related tools — is the real content from the original page.</div>
          </div>
        </div>
      </div>`;
  };
  window.TOOL_ENGINES.todo = E;
})();
