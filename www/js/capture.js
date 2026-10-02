/* 日程助手 v1.9.0 —— 消息采集（QQ 通知，仅存本机）
   这一版只做「采下来、看得见、能核对」：不判断重要性、不调用 AI、不生成日程。
   数据存在原生侧 SharedPreferences，网页层通过 Capture 插件只读，
   原生不会写 WebView 的 localStorage（v1.8.20 的教训）。 */
(function () {
  'use strict';

  var LIST_LIMIT = 120;
  var _busy = false;
  var _timer = null;
  var _cache = [];

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmt(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return (p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()));
  }

  function plugin() {
    try {
      if (window.__cap && window.__cap.Capture) return window.__cap.Capture;
      if (window.Capacitor && typeof window.Capacitor.registerPlugin === 'function') {
        return window.Capacitor.registerPlugin('Capture');
      }
    } catch (e) {}
    return null;
  }

  function paneOpen() {
    var sub = $('settingsSub');
    var pane = document.querySelector('.sub-pane[data-sub="capture"]');
    return !!(sub && pane && !sub.hidden && !pane.hidden);
  }

  function setText(id, cls, msg) {
    var el = $(id);
    if (!el) return;
    el.className = 'status' + (cls ? ' ' + cls : '');
    el.textContent = msg;
  }

  /* 一条通知的「正文」：QQ 在不同机型上会把内容放在 text / bigText / textLines 里，取第一个非空 */
  function bodyOf(it) {
    var cands = [it.text, it.big, it.lines];
    for (var i = 0; i < cands.length; i++) {
      var v = cands[i];
      if (v && String(v).trim()) return String(v).trim();
    }
    return '';
  }

  function titleOf(it) {
    var t = (it.title || '').trim();
    if (t) return t;
    var s = (it.sub || '').trim();
    return s || (it.app || it.pkg || '通知');
  }

  function render(items) {
    var box = $('capList');
    if (!box) return;
    if (!items.length) {
      box.innerHTML = '<div class="cap-empty">还没有采到内容。授权后让 QQ 在后台来一条消息试试，'
        + '或点「重扫通知栏」把当前通知栏里的消息捞回来。</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var body = bodyOf(it);
      html += '<div class="cap-item" data-i="' + i + '">'
        + '<div class="cap-head"><span class="cap-title">' + esc(titleOf(it)) + '</span>'
        + '<span class="cap-time">' + esc(fmt(it.time)) + '</span></div>'
        + '<div class="cap-body">' + (body ? esc(body) : '<i>（这条通知里没有正文，多半是图片/文件/语音，或 QQ 把内容放在了你看不到的字段里）</i>') + '</div>'
        + '<div class="cap-ops">'
        + '<button class="cap-op" data-op="copy" type="button">复制</button>'
        + (it.fields ? '<button class="cap-op" data-op="more" type="button">看原始字段</button>' : '')
        + '<span class="cap-src">' + esc(it.app || it.pkg || '') + (it.from === 'bar' ? ' · 回捞' : '') + '</span>'
        + '</div>'
        + (it.fields ? '<pre class="cap-fields" hidden>' + esc(it.fields) + '</pre>' : '')
        + '</div>';
    }
    box.innerHTML = html;
    box.querySelectorAll('.cap-item').forEach(function (row) {
      var it = items[Number(row.dataset.i)];
      row.querySelectorAll('.cap-op').forEach(function (b) {
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          if (b.dataset.op === 'more') {
            var pre = row.querySelector('.cap-fields');
            if (pre) pre.hidden = !pre.hidden;
            return;
          }
          var txt = titleOf(it) + '\n' + bodyOf(it) + '\n（' + fmt(it.time) + ' ' + (it.app || it.pkg || '') + '）';
          copyText(txt, b);
        });
      });
    });
  }

  function copyText(txt, btn) {
    var done = function (ok) {
      if (typeof toast === 'function') toast(ok ? '已复制，可粘到「解析」页或「AI 助手」' : '复制失败，长按可手动选取');
      if (btn) { btn.textContent = ok ? '已复制' : '复制失败'; setTimeout(function () { btn.textContent = '复制'; }, 1600); }
    };
    try {
      var ta = document.createElement('textarea');
      ta.value = txt;
      ta.setAttribute('readonly', 'readonly');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, txt.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      if (ok) { done(true); return; }
    } catch (e) {}
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { done(true); }, function () { done(false); });
        return;
      }
    } catch (e) {}
    done(false);
  }

  function refresh() {
    var p = plugin();
    if (!p || !p.status) {
      setText('capStatus', 'error', '采集功能只在 App 里可用（浏览器预览里没有）。');
      return Promise.resolve();
    }
    if (_busy) return Promise.resolve();
    _busy = true;
    return Promise.all([
      p.status().catch(function () { return null; }),
      p.getItems({ limit: LIST_LIMIT }).catch(function () { return null; })
    ]).then(function (res) {
      _busy = false;
      var st = res[0] || {};
      var box = $('capEnabled');
      if (box) box.checked = st.enabled !== false;
      var grant = $('capGrant');
      if (grant) grant.hidden = !!st.granted;
      if (!st.granted) {
        setText('capStatus', 'error', '还没授权「通知使用权」，现在一条都收不到。点下面按钮去系统里把本应用打开。');
        render([]);
        return;
      }
      if (!st.connected) {
        setText('capStatus', 'error', '已授权，但系统还没把监听连上（刚授权完常见）。回到 App 或重启一次即可。');
      } else {
        setText('capStatus', 'ok', '监听已连接 · 本机已存 ' + (st.count || 0) + ' 条（只留最近 7 天、最多 150 条）。');
      }
      var items = [];
      try { items = JSON.parse((res[1] && res[1].items) || '[]'); } catch (e) { items = []; }
      _cache = items;
      render(items);
    }).catch(function () { _busy = false; });
  }

  /* 原生发来「有新东西」的信号：只在采集页开着时刷新，避免白白解析数据 */
  function onNativeWake() {
    if (!paneOpen()) return;
    clearTimeout(_timer);
    _timer = setTimeout(refresh, 600);
  }

  /* 清空（「清空所有数据」也会调这里，把原生那份一起清掉） */
  function purge() {
    var p = plugin();
    if (p && p.clear) { try { return p.clear(); } catch (e) {} }
    return Promise.resolve();
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && paneOpen()) refresh();
  });

  window.AiTodoCapture = {
    open: function () { refresh(); },
    refresh: refresh,
    onNativeWake: onNativeWake,
    purge: purge,
    count: function () { return _cache.length; }
  };

  /* ---- 绑定 ---- */
  function bind() {
    var sw = $('capEnabled');
    if (sw) {
      sw.addEventListener('change', function () {
        var p = plugin();
        if (!p || !p.setEnabled) return;
        p.setEnabled({ on: !!sw.checked }).then(function () {
          if (typeof toast === 'function') toast(sw.checked ? '已开始采集' : '已停止采集（已采到的仍保留）');
          refresh();
        }).catch(function () { sw.checked = !sw.checked; });
      });
    }
    var g = $('capGrant');
    if (g) g.addEventListener('click', function () {
      var p = plugin();
      if (!p || !p.openPermission) { if (typeof toast === 'function') toast('请在系统设置 → 通知使用权里手动开启'); return; }
      p.openPermission().catch(function (e) { if (typeof toast === 'function') toast('打不开系统页面：' + (e && e.message ? e.message : e)); });
    });
    var rs = $('capRescan');
    if (rs) rs.addEventListener('click', function () {
      var p = plugin();
      if (!p || !p.rescan) return;
      p.rescan({}).then(function (r) {
        if (typeof toast === 'function') {
          toast(!r || r.connected === false ? '监听还没连上，先完成授权'
            : (r.added > 0 ? '从通知栏补回 ' + r.added + ' 条' : '通知栏里没有新的 QQ 通知（已被清掉或当时没弹）'));
        }
        refresh();
      }).catch(function () {});
    });
    var rl = $('capReload');
    if (rl) rl.addEventListener('click', refresh);
    var cl = $('capClear');
    if (cl) cl.addEventListener('click', function () {
      if (!confirm('清空本机已采集的通知内容？此操作不可恢复。')) return;
      purge().then(function () { if (typeof toast === 'function') toast('已清空'); refresh(); });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
