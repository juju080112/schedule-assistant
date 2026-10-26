/* 解析结果清洗（v1.9.11）：同标题+同日期去重、过期判断、日期解析。
   纯逻辑，浏览器挂 window.TodoUtils，Node 可测。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TodoUtils = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function parseDueTs(s) {
    if (s == null || s === '') return null;
    if (typeof s === 'number') return isNaN(s) ? null : s;
    var m = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})[T\s]+(\d{1,2}):(\d{2})/.exec(String(s));
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    return isNaN(d.getTime()) ? null : d.getTime();
  }

  function normTitle(s) {
    return String(s || '').replace(/[\s，。；、,.!！?？:：\-—()（）]/g, '').toLowerCase();
  }

  function dedupeParsed(list) {
    var out = [];
    var map = {};
    (list || []).forEach(function (t) {
      if (!t || !t.title) return;
      var key = normTitle(t.title) + '|' + (t.due ? String(t.due).slice(0, 10) : '');
      var e = map[key];
      if (!e) {
        map[key] = t;
        out.push(t);
        return;
      }
      if (t.detail && t.detail !== e.detail) {
        e.detail = [e.detail, t.detail].filter(Boolean).join('；');
      }
      if (t.remind) e.remind = true;
      if (t.due && (!e.due || String(t.due) < String(e.due))) e.due = t.due;
    });
    return out;
  }

  function isPastDue(t, now) {
    var ts = parseDueTs(t && t.due);
    return ts != null && ts < (now == null ? Date.now() : now);
  }

  return { parseDueTs: parseDueTs, normTitle: normTitle, dedupeParsed: dedupeParsed, isPastDue: isPastDue };
});
