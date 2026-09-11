/* ============================================================
 * 中科大教务课表自动获取脚本（v1.7.1）
 * 严格参照 MyUSTC 的成熟实现：
 *   - 页面加载后每 500ms 轮询，等课表页特征出现（.item 学期元素、
 *     #startDate 开学日期、URL 末段为打印视图 id）
 *   - 出现后同源 GET /for-std/course-table/semester/{semId}/print-data/{id}
 *     （credentials: 'include'，只读，无任何写操作）
 *   - 结果规整为统一课程记录，通过 window.Android.importCourse 主动推回
 *     原生（JavascriptInterface），同时写入 window.__aitodoLastResult 作备份
 *   - 页面不符合特征时持续等待（用户可慢慢导航），60 秒时上报一次诊断
 * 合规底线：不读 cookie/localStorage/表单值，不修改页面，不发写请求。
 * ============================================================ */
(function (global) {
  'use strict';

  /* ============ 工具 ============ */
  function str(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'number') return String(v);
    if (Array.isArray(v)) return v.map(str).filter(Boolean).join('、');
    if (typeof v === 'object') return str(v.nameZh || v.name || v.zh || v.title || v.value || '');
    return '';
  }
  function num(v) {
    var n = parseInt(v, 10);
    return (n >= 1 && n <= 30) ? n : null;
  }
  function parseWeekday(v) {
    if (v == null) return null;
    var s = String(v);
    var m = /(?:周|星期|礼拜)\s*([一二三四五六日天])/.exec(s);
    if (m) {
      var map = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };
      return map[m[1]];
    }
    var n = parseInt(s, 10);
    return (n >= 1 && n <= 7) ? n : null;
  }
  function parseWeeksText(s) {
    if (!s) return [];
    var seen = {}, m;
    var re = /(\d{1,2})\s*[-~—－到至]\s*(\d{1,2})/g;
    while ((m = re.exec(String(s)))) {
      for (var w = +m[1]; w <= +m[2] && w <= 30; w++) if (w >= 1) seen[w] = 1;
    }
    var singles = String(s).replace(re, ' ').match(/\d{1,2}/g) || [];
    singles.forEach(function (n) { if (n >= 1 && n <= 30) seen[n] = 1; });
    var out = Object.keys(seen).map(Number);
    var txt = String(s);
    if (/单|odd/i.test(txt)) out = out.filter(function (w) { return w % 2 === 1; });
    else if (/双|even/i.test(txt)) out = out.filter(function (w) { return w % 2 === 0; });
    return out.sort(function (a, b) { return a - b; });
  }

  function toDate(s) {
    var m = /^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/.exec(String(s || '').trim());
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d.getTime()) ? null : d;
  }

  /* 由起止日期推算教学周区间（需要注入的学期锚点 __aitodoUstcCfg.week1Sunday） */
  function weekNosBetween(dA, dB, cfg) {
    var w1 = toDate(cfg && cfg.week1Sunday);
    if (!w1 || !dA || !dB) return [];
    var total = (cfg && cfg.totalWeeks) || 20;
    var day0 = w1.getTime();
    function weekOf(d) { return Math.floor((d.getTime() - day0) / 86400000 / 7) + 1; }
    var a = weekOf(dA), b = weekOf(dB);
    if (a > b) { var t = a; a = b; b = t; }
    var out = [];
    for (var w = Math.max(1, a); w <= Math.min(total, b); w++) out.push(w);
    return out;
  }
  function pick(o, keys) {
    for (var i = 0; i < keys.length; i++) {
      if (o[keys[i]] != null && o[keys[i]] !== '') return o[keys[i]];
    }
    return null;
  }

  /* ============ 时间 → 节次换算（以接口给的真实时间优先，节次号仅兜底） ============ */
  /* 科大各节起始（当日分钟数）：1:7:50 2:8:40 3:9:45 4:10:35 5:11:25 6:14:00
   * 7:14:50 8:15:55 9:16:45 10:17:35 11:19:30 12:20:20 13:21:10 */
  var SLOT_MINUTES = [470, 520, 585, 635, 685, 840, 890, 955, 1005, 1055, 1170, 1220, 1270];

  function minutesOf(v) {
    if (v == null) return null;
    if (typeof v === 'number') {
      if (v >= 100 && v <= 2359 && (v % 100) < 60) return Math.floor(v / 100) * 60 + (v % 100); /* HHMM，如 800=8:00 */
      if (v >= 60 && v <= 1439) return v;                    /* 当日分钟数 */
      if (v >= 1440 && v <= 86399) return Math.round(v / 60); /* 秒 */
      return null;
    }
    var s = String(v).trim();
    var m = /^(\d{1,2})\s*[:：点]\s*(\d{1,2})?/.exec(s);
    if (m && +m[1] <= 23 && (!m[2] || +m[2] < 60)) return (+m[1]) * 60 + (m[2] ? +m[2] : 0);
    m = /^(\d{1,2})(\d{2})$/.exec(s);
    if (m && +m[1] <= 23 && +m[2] < 60) return (+m[1]) * 60 + (+m[2]);
    return null;
  }

  function timeToSlot(v) {
    if (v == null) return null;
    /* 整数恰好等于某节起始分钟数 → 直接命中该节（规避 HHMM/分钟歧义） */
    if (typeof v === 'number' && v % 1 === 0 && SLOT_MINUTES.indexOf(v) >= 0) {
      return SLOT_MINUTES.indexOf(v) + 1;
    }
    if (typeof v === 'number' && v >= 1 && v <= 13 && v % 1 === 0) {
      return v; /* 1..13 的整数更像节次号本身 */
    }
    var mins = minutesOf(v);
    if (mins == null) return null;
    var best = null, bestDiff = 1e9;
    for (var i = 0; i < SLOT_MINUTES.length; i++) {
      var diff = Math.abs(SLOT_MINUTES[i] - mins);
      if (diff < bestDiff) { bestDiff = diff; best = i + 1; }
    }
    return bestDiff <= 45 ? best : null;
  }

  /* ============ 记录规整 ============ */
  function normalizeRecord(r, cfg) {
    if (!r || typeof r !== 'object') return null;
    var name = str(pick(r, ['courseName', 'lessonName', 'nameZh', 'className', 'name']));
    var weekday = parseWeekday(pick(r, ['weekday', 'weekDay', 'dayOfWeek', 'day']));
    /* 节次：先按节次号字段取，再用接口给的真实上下课时间校正（时间优先） */
    var startSlot = num(pick(r, ['startSection', 'startNode', 'sectionStart', 'startJc', 'startUnit']));
    var endSlot = num(pick(r, ['endSection', 'endNode', 'sectionEnd', 'endJc', 'endUnit']));
    var sSlot = timeToSlot(pick(r, ['startTime', 'start', 'begin', 'beginTime', 'startAt', 'from']));
    var eSlot = timeToSlot(pick(r, ['endTime', 'end', 'finishTime', 'endAt', 'to']));
    if (sSlot) startSlot = sSlot;
    if (eSlot) endSlot = eSlot;
    if (!name || name.length < 2) return null;
    if (!weekday || !startSlot) return null;
    if (!endSlot || endSlot < startSlot) endSlot = startSlot;
    var teacher = str(pick(r, ['teacher', 'teacherName', 'teachers', 'teacherNames']));
    var location = str(pick(r, ['classroom', 'classRoom', 'room', 'place', 'roomName']));
    /* 周次：字段种类很多，逐一尝试；都没有再用起止日期推算 */
    var weeks = [];
    var weeksRaw = pick(r, ['weeks', 'weekList', 'weekNumbers', 'validWeeks', 'vaildWeeks',
                            'teachWeeks', 'weekText', 'weekRange', 'week', 'teachingWeeks']);
    if (Array.isArray(weeksRaw)) {
      weeks = weeksRaw.map(function (w) { return typeof w === 'object' ? num(w.weekNo || w.week || w.value) : num(w); })
        .filter(function (w) { return w; });
    } else if (weeksRaw != null) {
      weeks = parseWeeksText(String(weeksRaw));
    }
    if (!weeks.length) {
      var dA = toDate(str(pick(r, ['startDate', 'start', 'beginDate', 'firstDate'])));
      var dB = toDate(str(pick(r, ['endDate', 'end', 'finishDate', 'lastDate'])));
      weeks = weekNosBetween(dA, dB, cfg);
    }
    weeks = weeks.filter(function (w, i, a) { return a.indexOf(w) === i; })
      .sort(function (a, b) { return a - b; });
    var raw;
    try { raw = JSON.stringify(r).slice(0, 200); } catch (e) { raw = name; }
    return {
      name: name.slice(0, 60),
      teacher: teacher.slice(0, 40),
      location: location.slice(0, 40),
      weekday: weekday,
      startSlot: startSlot,
      endSlot: endSlot,
      weeks: weeks,
      raw: raw
    };
  }

  /* ============ MyUSTC 同款解析（逐字段对照其反编译代码） ============
   * 根路径：studentTableVm.activities[]
   * 每条 activity：
   *   weekday(1-7)、startUnit/endUnit（节次）、startDate/endDate（首末课次日期）
   *   名称：courseName → lessonName → lessonCode
   *   地点：room → roomCode → customPlace
   *   周次：weeksArray（整型数组）→ weeksStr（文本）→ 起止日期推算
   *   教师：teachers[]（字符串数组）→ teacherDeepVms[].person.nameZh
   * ============================================================ */
  function trimStr(v) {
    return v == null ? '' : String(v).replace(/^\s+|\s+$/g, '');
  }

  function parseTeachers(a) {
    var out = [];
    if (Array.isArray(a.teachers)) {
      a.teachers.forEach(function (t) {
        var s = trimStr(t);
        if (s) out.push(s);
      });
    }
    if (!out.length && Array.isArray(a.teacherDeepVms)) {
      a.teacherDeepVms.forEach(function (t) {
        var s = trimStr(t && t.person && t.person.nameZh);
        if (s) out.push(s);
      });
    }
    return out.join('、').slice(0, 40);
  }

  function parseActivities(data, cfg) {
    var vm = data && typeof data === 'object' ? data.studentTableVm : null;
    var arr = vm && Array.isArray(vm.activities) ? vm.activities : null;
    if (!arr) return null; /* 结构不符 → 调用方走通用兜底 */
    var out = [];
    arr.forEach(function (a) {
      if (!a || typeof a !== 'object') return;
      var weekday = parseInt(a.weekday, 10);
      if (!(weekday >= 1 && weekday <= 7)) return;
      var su = parseInt(a.startUnit, 10) || 0;
      var eu = parseInt(a.endUnit, 10) || 0;
      var name = trimStr(a.courseName) || trimStr(a.lessonName) || trimStr(a.lessonCode);
      if (!name) return;
      if (!(su >= 1)) return;            /* 无节次的自定义活动不进网格 */
      if (!(eu >= su)) eu = su;
      if (su > 13) return;
      if (eu > 13) eu = 13;
      var location = trimStr(a.room) || trimStr(a.roomCode) || trimStr(a.customPlace);
      var weeks = [];
      if (Array.isArray(a.weeksArray)) {
        weeks = a.weeksArray.map(function (w) { return parseInt(w, 10); })
          .filter(function (w) { return w >= 1 && w <= 30; });
      }
      if (!weeks.length && a.weeksStr != null && a.weeksStr !== '') {
        weeks = parseWeeksText(String(a.weeksStr));
      }
      if (!weeks.length) {
        weeks = weekNosBetween(toDate(a.startDate), toDate(a.endDate), cfg);
      }
      weeks = weeks.filter(function (w, i, arr2) { return arr2.indexOf(w) === i; })
        .sort(function (x, y) { return x - y; });
      var raw;
      try { raw = JSON.stringify(a).slice(0, 200); } catch (e) { raw = name; }
      out.push({
        name: name.slice(0, 60),
        teacher: parseTeachers(a),
        location: trimStr(location).slice(0, 40),
        weekday: weekday,
        startSlot: su,
        endSlot: eu,
        weeks: weeks,
        raw: raw
      });
    });
    return out;
  }

  /* 通用兜底（结构变化时仍尽力提取） */
  function collectCourses(node, depth, out, cfg) {
    if (depth > 8 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(function (x) { collectCourses(x, depth + 1, out, cfg); });
      return;
    }
    var looksCourse = (node.courseName || node.lessonName || node.nameZh) &&
      (node.weekday || node.weekDay || node.dayOfWeek);
    if (looksCourse) {
      var c = normalizeRecord(node, cfg);
      if (c) out.push(c);
    }
    if (out.length < 600) {
      var keys = Object.keys(node);
      for (var i = 0; i < keys.length; i++) collectCourses(node[keys[i]], depth + 1, out, cfg);
    }
  }

  function week1SundayFrom(startDateText) {
    var m = /^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/.exec(String(startDateText || '').trim());
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    if (isNaN(d.getTime())) return null;
    var iso = (d.getDay() + 6) % 7 + 1; /* 周一=1..周日=7 */
    d.setDate(d.getDate() - (iso % 7));
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /* ============ 结果推送（JavascriptInterface 优先，window 变量备份） ============ */
  function send(report) {
    var s;
    try { s = JSON.stringify(report); } catch (e) { return; }
    global.__aitodoLastResult = s;
    try {
      if (global.Android && global.Android.importCourse) global.Android.importCourse(s);
    } catch (e) {}
  }

  /* ============ 主流程 ============ */
  var running = false;

  function elementsReady() {
    var semesterElem = document.getElementsByClassName('item')[0];
    var startDateElem = document.getElementById('startDate');
    var segs = location.pathname.split('/').filter(Boolean);
    var id = segs.length ? segs[segs.length - 1] : null;
    return (semesterElem && semesterElem.dataset && semesterElem.dataset.value &&
            startDateElem && id && /\d/.test(String(id)))
      ? { semId: semesterElem.dataset.value, startDateText: (startDateElem.textContent || '').trim(), id: id }
      : null;
  }

  function attempt(ready) {
    var fetchTries = 0;
    var cfg = global.__aitodoUstcCfg || {};
    function go() {
      fetch('/for-std/course-table/semester/' + ready.semId + '/print-data/' + ready.id, {
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      }).then(function (r) {
        if (r.status !== 200) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (data) {
        var cfg2 = cfg;
        /* 第 1 优先：MyUSTC 同款精确解析（studentTableVm.activities） */
        var courses = parseActivities(data, cfg2);
        var usedFallback = false;
        if (courses === null) {
          /* 结构不符：走通用树遍历兜底 */
          usedFallback = true;
          var out = [];
          collectCourses(data, 0, out, cfg2);
          courses = [];
          var seen = {};
          out.forEach(function (c) {
            var k = [c.name, c.weekday, c.startSlot, c.endSlot, c.location, (c.weeks || []).join(',')].join('|');
            if (seen[k]) return;
            seen[k] = 1;
            courses.push(c);
          });
        }
        var weeksFound = courses.filter(function (c) { return c.weeks && c.weeks.length; }).length;
        var w1s = week1SundayFrom(ready.startDateText);
        send({
          ok: courses.length > 0,
          strategy: 'ustc-api',
          courses: courses,
          term: w1s ? { week1Sunday: w1s } : null,
          /* 教务接口原始 JSON：全校 20 周完整课表数据（仅课程信息，无任何凭据） */
          rawUstc: (function () { try { return JSON.stringify(data); } catch (e) { return null; } })(),
          error: courses.length ? null : '接口返回成功但未解析出课程',
          debug: {
            steps: [
              'USTC 接口直取: /for-std/course-table/semester/' + ready.semId + '/print-data/' + ready.id,
              '开学日期: ' + ready.startDateText + ' → 第1周周日 ' + (w1s || (cfg.week1Sunday ? '未识别（沿用校历 ' + cfg.week1Sunday + '）' : '未识别')),
              usedFallback
                ? '未找到 studentTableVm.activities，走了通用兜底解析'
                : '按 MyUSTC 同款结构解析 studentTableVm.activities',
              '解析出 ' + courses.length + ' 门课程记录，其中 ' + weeksFound + ' 条带周次信息'
            ],
            apiList: [],
            sample: (function () {
              try { return JSON.stringify(data).slice(0, 2500); } catch (e) { return null; }
            })()
          }
        });
      }).catch(function (e) {
        fetchTries++;
        if (fetchTries <= 4) { setTimeout(go, 2000); return; }
        send({
          ok: false, strategy: 'ustc-api', courses: [],
          error: '课表接口请求失败：' + (e && e.message ? e.message : e) + '（会话可能已过期，请重新登录）',
          debug: { steps: ['接口直取连续失败'], apiList: [] }
        });
      });
    }
    go();
  }

  global.__aitodoUstcReset = function () { running = false; };

  global.__aitodoUstcStart = function () {
    if (running) return;
    running = true;
    var tries = 0, diagSent = false;
    var timer = setInterval(function () {
      tries++;
      if (global.__aitodoLastResult) { clearInterval(timer); return; } /* 已有结果：停止 */
      if (tries > 240) { clearInterval(timer); return; } /* 最多等 2 分钟 */
      var ready = elementsReady();
      if (ready) {
        clearInterval(timer);
        attempt(ready);
      } else if (tries === 120 && !diagSent) {
        diagSent = true;
        send({
          ok: false, strategy: 'ustc-api', courses: [],
          error: '当前页面不是课表页（未检测到学期/开学日期元素）。请进入「我的课表」页面（地址含 course-table）后再抓取。',
          debug: {
            steps: ['url=' + location.href,
                    'hasItem=' + !!document.getElementsByClassName('item')[0],
                    'hasStartDate=' + !!document.getElementById('startDate')]
          }
        });
      }
    }, 500);
  };
})(window);
