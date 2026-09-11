/* ============================================================
 * 中科大教务课表提取脚本（v1.7.0）
 *
 * 运行位置：教务系统课表页所在的 WebView 上下文
 * 行为约束（合规底线）：
 *   ① 只读取「渲染后的 DOM」与「页面自身已发起过的请求列表」；
 *   ② 不读取 cookie / localStorage / sessionStorage / 表单 input.value；
 *   ③ 不修改页面结构、不注入事件、不代替用户提交任何操作；
 *   ④ 策略 A 复用的接口，是页面自己已经请求过的同源地址，
 *      且只发 GET，不发任何写入类请求。
 *
 * 三套策略按优先级自动降级：
 *   A. 接口直取：从 performance 资源时序里发现页面已调用的 XHR/fetch 地址，
 *      逐个只读 GET，在返回的 JSON 里定位课程数组（最稳，DOM 改版不受影响）
 *   B. 属性网格：按 data-weekday / data-slot / data-week 等属性直接查询
 *   C. 表格遍历：选单元格最多的 table，建网格模型（含 rowspan/colspan），
 *      按表头推断「列→星期」「行→节次」，再逐格解析
 *   兜底：导出结构骨架（skeleton），供离线诊断解析规则
 * ============================================================ */
(function (global) {
  'use strict';

  /* ============ 常量 ============ */
  var CN_NUM = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };
  var EN_DAY = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };
  var MAX_WEEK = 30;
  var MAX_SLOT = 14;

  /* 地点特征：教学楼/馆/室等字样，或纯字母数字编号 */
  var PLACE_RE = /(楼|馆|教室|室|区|场|厅|中心|实验|机房|语音|多媒体|体育|操场|球场|游泳|食堂|报告)/;
  /* 排除被误判为教师的词 */
  var NOT_TEACHER_RE = /^(第|周|星期|礼拜|节|上午|下午|晚上|中午|单周|双周|全天|节次|时间|地点|教师|课程|备注|周一|周二|合计)/;

  /* 策略 B 候选属性名 */
  var DAY_ATTRS = ['data-weekday', 'data-day', 'data-xq', 'data-week-day', 'data-weekday-id', 'data-col', 'data-dayofweek'];
  var SLOT_ATTRS = ['data-slot', 'data-jie', 'data-jc', 'data-section', 'data-node', 'data-row', 'data-lesson', 'data-index'];
  var WEEK_ATTRS = ['data-week', 'data-zc', 'data-weeks', 'data-week-no', 'data-weekid'];

  /* ============ 报告对象 ============ */
  function makeReport() {
    return {
      ok: false,
      strategy: null,
      courses: [],
      term: null,
      debug: {
        url: location.href,
        title: document.title,
        steps: [],
        apiList: [],
        skeleton: null
      }
    };
  }

  /* ============ 文本工具 ============ */
  function txt(el) {
    if (!el) return '';
    return String(el.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /* 按视觉行切分：<br> 与块级结束标签视为换行，比纯 textContent 更能还原卡片内结构 */
  function lines(el) {
    if (!el) return [];
    var html = String(el.innerHTML || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(div|p|li|tr|td|th|span|h[1-6]|section|article)>/gi, '\n');
    var tmp = document.createElement('div');
    tmp.innerHTML = html.replace(/<[^>]+>/g, '\n');
    var raw = String(tmp.textContent || '').replace(/\u00a0/g, ' ');
    var out = [];
    raw.split('\n').forEach(function (s) {
      s = s.replace(/[ \t]+/g, ' ').trim();
      if (s) out.push(s);
    });
    return out;
  }

  /* ============ 字段解析 ============ */
  function parseWeekday(s) {
    if (s == null) return null;
    s = String(s);
    var m = /(?:周|星期|礼拜)\s*([一二三四五六日天])/.exec(s);
    if (m) return CN_NUM[m[1]];
    m = /([A-Za-z]{3})/.exec(s);
    if (m) {
      var k = m[1].toLowerCase();
      if (EN_DAY[k]) return EN_DAY[k];
    }
    m = /(?:周|星期|礼拜|day|weekday)\D{0,3}([1-7])/.exec(s);
    if (m) return +m[1];
    if (/^[1-7]$/.test(s.trim())) return +s.trim();
    return null;
  }

  /* 解析节次。返回 {start,end}。调用前应先剔除周次片段，避免 "1-16周" 被误读为节次 */
  function parseSlot(s) {
    if (s == null) return null;
    s = String(s);
    var m = /(\d{1,2})\s*[-~—－到至]\s*(\d{1,2})/.exec(s);
    if (m) {
      var a = +m[1], b = +m[2];
      if (a > b) { var t = a; a = b; b = t; }
      if (a >= 1 && a <= MAX_SLOT) return { start: a, end: Math.min(b, MAX_SLOT) };
    }
    var nums = s.match(/\d{1,2}/g);
    if (!nums || !nums.length) return null;
    var ns = nums.map(Number).filter(function (n) { return n >= 1 && n <= MAX_SLOT; });
    if (!ns.length) return null;
    return { start: Math.min.apply(null, ns), end: Math.max.apply(null, ns) };
  }

  /* 解析周次。支持 "1-16周"、"1-16周(单)"、"2,4,6周"、"第1-8周,第10周" */
  function parseWeeks(s) {
    if (!s) return [];
    s = String(s);
    var odd = /单/.test(s) && !/双/.test(s);
    var even = /双/.test(s) && !/单/.test(s);
    var seen = {};
    var rangeRe = /(\d{1,2})\s*[-~—－到至]\s*(\d{1,2})/g;
    var m;
    while ((m = rangeRe.exec(s))) {
      var a = +m[1], b = +m[2];
      if (a > b) { var t = a; a = b; b = t; }
      for (var w = a; w <= b && w <= MAX_WEEK; w++) if (w >= 1) seen[w] = 1;
    }
    /* 区间已消费的片段挖掉，剩余孤立数字按单周处理 */
    var rest = s.replace(rangeRe, ' ');
    var singles = rest.match(/\d{1,2}/g) || [];
    singles.forEach(function (n) {
      n = +n;
      if (n >= 1 && n <= MAX_WEEK) seen[n] = 1;
    });
    var arr = Object.keys(seen).map(Number).sort(function (x, y) { return x - y; });
    if (odd) arr = arr.filter(function (w) { return w % 2 === 1; });
    if (even) arr = arr.filter(function (w) { return w % 2 === 0; });
    return arr;
  }

  function looksPlace(s) {
    if (!s) return false;
    if (PLACE_RE.test(s)) return true;
    /* 纯编号型地点，如 "3-101"、"A205" */
    return /^[A-Za-z]{0,3}[\-#]?\d{2,4}[A-Za-z]?$/.test(s.trim());
  }

  function looksTeacher(s) {
    if (!s) return false;
    s = s.trim();
    if (NOT_TEACHER_RE.test(s)) return false;
    /* 中文姓名 2~4 字，允许 "张三、李四" 多教师 */
    if (/^[\u4e00-\u9fa5]{2,4}([、,，\/][\u4e00-\u9fa5]{2,4})*$/.test(s)) return true;
    return false;
  }

  /* 把一个课程文本块拆成标准字段。ls 为按行切好的数组 */
  function buildCourse(ls, fallback) {
    var name = '', teacher = '', place = '', weeksText = '', slotText = '';
    var rest = [];
    ls.forEach(function (s) {
      if (!s) return;
      if (/周/.test(s) && /\d/.test(s) && !name) { weeksText += ' ' + s; return; }
      if (/周/.test(s) && /\d/.test(s)) { weeksText += ' ' + s; return; }
      if (/(节|学时)/.test(s) && /\d/.test(s)) { slotText += ' ' + s; return; }
      rest.push(s);
    });
    /* 剩余行里挑地点与教师，第一个非地点非教师的作为课程名 */
    var named = false;
    rest.forEach(function (s) {
      if (!place && looksPlace(s) && s.length <= 30) { place = s; return; }
      if (!teacher && looksTeacher(s) && s.length <= 24) { teacher = s; return; }
      if (!named) { name = s; named = true; return; }
      /* 多余信息并入教师或地点（常见为「课程名(班号)」的第二段或第二教师） */
      if (!teacher && looksTeacher(s)) teacher = s;
      else if (!place && looksPlace(s)) place = s;
      else name += ' ' + s;
    });
    if (!name && fallback && fallback.name) name = fallback.name;

    var slotSrc = slotText || (fallback && fallback.slotText) || '';
    var slot = parseSlot(slotSrc.replace(/周/g, ''));
    if (!slot && fallback && fallback.slot) slot = fallback.slot;

    var wd = null;
    if (fallback && fallback.weekday) wd = fallback.weekday;

    var weeks = parseWeeks(weeksText);
    if (!weeks.length && fallback && fallback.weeks && fallback.weeks.length) weeks = fallback.weeks.slice();

    return {
      name: name.trim(),
      teacher: teacher.trim(),
      location: place.trim(),
      weekday: wd,
      startSlot: slot ? slot.start : null,
      endSlot: slot ? slot.end : null,
      weeks: weeks,
      raw: ls.join(' | ').slice(0, 400)
    };
  }

  function validCourse(c) {
    return !!(c && c.name && c.name.length >= 2 && c.weekday && c.startSlot);
  }

  /* ============ 策略 A：接口直取 ============ */
  function listCandidateApis() {
    var out = [];
    try {
      var res = performance.getEntriesByType('resource') || [];
      res.forEach(function (r) {
        var it = String(r.initiatorType || '').toLowerCase();
        if (it === 'xmlhttprequest' || it === 'fetch') out.push(r.name);
      });
    } catch (e) {}
    /* 去重 + 过滤静态资源 + 仅保留同源（跨源 GET 会被 CORS 拦，且不应外发） */
    var seen = {}, list = [];
    out.forEach(function (u) {
      if (seen[u]) return;
      seen[u] = 1;
      if (/\.(js|css|png|jpe?g|gif|svg|webp|woff2?|ttf|ico|map)(\?|#|$)/i.test(u)) return;
      try {
        var abs = new URL(u, location.href);
        if (abs.origin !== location.origin) return;
      } catch (e) { return; }
      list.push(u);
    });
    return list;
  }

  /* 给一个对象数组打分，判断它像不像课程表 */
  function scoreCourseArray(arr) {
    if (!Array.isArray(arr) || arr.length < 1) return 0;
    var keys = {};
    arr.slice(0, 8).forEach(function (o) {
      if (o && typeof o === 'object' && !Array.isArray(o)) {
        Object.keys(o).forEach(function (k) { keys[k] = 1; });
      }
    });
    var ks = Object.keys(keys);
    if (!ks.length) return 0;
    var score = 0;
    if (ks.some(function (k) { return /course|kcmc|kcmc|kc|lesson|class|name|课/i.test(k); })) score += 3;
    if (ks.some(function (k) { return /week|day|xq|xingqi|星期|周/i.test(k); })) score += 2;
    if (ks.some(function (k) { return /jie|jc|node|section|slot|节/i.test(k); })) score += 2;
    if (ks.some(function (k) { return /teacher|js|skjs|xm|name.*t|教师|老师/i.test(k); })) score += 1;
    if (ks.some(function (k) { return /place|room|addr|cd|dd|jsmc|教室|地点/i.test(k); })) score += 1;
    /* 元素里出现中文星期字样也加分（值层面特征） */
    try {
      var probe = JSON.stringify(arr.slice(0, 3));
      if (/周[一二三四五六日]|星期[一二三四五六日]/.test(probe)) score += 2;
    } catch (e) {}
    return score;
  }

  function walkArrays(node, depth, cb) {
    if (depth > 6 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      cb(node);
      node.slice(0, 60).forEach(function (x) { walkArrays(x, depth + 1, cb); });
      return;
    }
    var ks = Object.keys(node);
    for (var i = 0; i < ks.length && i < 80; i++) walkArrays(node[ks[i]], depth + 1, cb);
  }

  /* 按正则优先级从对象里取值 */
  function pick(obj, patterns) {
    var ks = Object.keys(obj);
    for (var i = 0; i < patterns.length; i++) {
      for (var j = 0; j < ks.length; j++) {
        if (patterns[i].test(ks[j]) && obj[ks[j]] != null && obj[ks[j]] !== '') return obj[ks[j]];
      }
    }
    return undefined;
  }

  function mapJsonCourse(o) {
    if (!o || typeof o !== 'object') return null;
    var name = pick(o, [/kcmc/i, /courseName/i, /course_name/i, /^kc$/i, /lessonName/i, /className/i, /课程/, /^name$/i, /course/i]);
    if (name == null) return null;
    var dayRaw = pick(o, [/weekday/i, /weekDay/i, /xq$/i, /^xq\d*$/i, /dayOfWeek/i, /星期/, /^day$/i, /week.*day/i]);
    var slotRaw = pick(o, [/^jc$/i, /jieci/i, /section/i, /^node$/i, /slot/i, /lesson.*no/i, /节/, /classTime/i, /^sj$/i]);
    var weekRaw = pick(o, [/^zc$/i, /weeks?$/i, /weekNo/i, /weekRange/i, /周/, /^zs$/i, /^ze$/i]);
    var teacher = pick(o, [/teacher/i, /^js$/i, /skjs/i, /教师/, /instr/i]);
    var place = pick(o, [/^cd$/i, /classroom/i, /room/i, /place/i, /location/i, /教室/, /地点/, /^dd$/i, /jsmc/i]);

    var wd = null;
    if (typeof dayRaw === 'number' && dayRaw >= 1 && dayRaw <= 7) wd = dayRaw;
    else if (dayRaw != null) wd = parseWeekday(String(dayRaw));

    var slot = null;
    if (slotRaw != null) slot = parseSlot(String(slotRaw));
    /* 有的系统拆成 startJc/endJc */
    if (!slot) {
      var zs = pick(o, [/start.*jc/i, /^zjc$/i, /begin.*section/i, /第.*节/i]);
      var ze = pick(o, [/end.*jc/i, /^ejc$/i, /stop.*section/i]);
      if (zs != null) {
        var a = parseInt(String(zs).match(/\d+/) || [0], 10);
        var b = ze != null ? parseInt(String(ze).match(/\d+/) || [0], 10) : a;
        if (a >= 1) slot = { start: a, end: Math.max(a, b || a) };
      }
    }

    var weeks = [];
    if (weekRaw != null) weeks = parseWeeks(String(weekRaw));
    if (!weeks.length) {
      var wz = pick(o, [/start.*week/i, /^zzc$/i, /weekBegin/i, /beginWeek/i]);
      var we = pick(o, [/end.*week/i, /^jzc$/i, /weekEnd/i]);
      if (wz != null) {
        var wa = parseInt(String(wz).match(/\d+/) || [0], 10);
        var wb = we != null ? parseInt(String(we).match(/\d+/) || [0], 10) : wa;
        for (var w = wa; w <= (wb || wa) && w <= MAX_WEEK; w++) if (w >= 1) weeks.push(w);
      }
    }

    return {
      name: String(name).trim(),
      teacher: teacher == null ? '' : String(teacher).trim(),
      location: place == null ? '' : String(place).trim(),
      weekday: wd,
      startSlot: slot ? slot.start : null,
      endSlot: slot ? slot.end : null,
      weeks: weeks,
      raw: JSON.stringify(o).slice(0, 400)
    };
  }

  /* 只读 GET 一个同源地址，尝试当作 JSON 解析并定位课程数组 */
  function probeApi(url, onHit, onMiss) {
    var done = false;
    var timer = setTimeout(function () { if (!done) { done = true; onMiss('超时'); } }, 8000);
    fetch(url, { method: 'GET', credentials: 'include', headers: { 'Accept': 'application/json' } })
      .then(function (r) {
        var ct = String(r.headers.get('content-type') || '');
        return r.text().then(function (body) { return { status: r.status, ct: ct, body: body }; });
      })
      .then(function (res) {
        if (done) return;
        if (res.status !== 200) { done = true; clearTimeout(timer); onMiss('HTTP ' + res.status); return; }
        var data;
        try { data = JSON.parse(res.body); }
        catch (e) {
          /* 有的接口返回 JSONP 或被包了一层，尝试剥壳 */
          var m = /^\s*[\w$.]+\(([\s\S]*)\)\s*;?\s*$/.exec(res.body);
          if (m) { try { data = JSON.parse(m[1]); } catch (e2) {} }
          if (!data) { done = true; clearTimeout(timer); onMiss('非 JSON'); return; }
        }
        var best = null, bestScore = 0;
        walkArrays(data, 0, function (arr) {
          var s = scoreCourseArray(arr);
          if (s > bestScore) { bestScore = s; best = arr; }
        });
        if (best && bestScore >= 5) {
          var mapped = [];
          best.forEach(function (o) {
            var c = mapJsonCourse(o);
            if (validCourse(c)) mapped.push(c);
          });
          if (mapped.length) {
            done = true; clearTimeout(timer);
            onHit(mapped, url, bestScore);
            return;
          }
        }
        done = true; clearTimeout(timer);
        onMiss('未定位课程数组（最高分 ' + bestScore + '）');
      })
      .catch(function (e) {
        if (done) return;
        done = true; clearTimeout(timer);
        onMiss('请求失败：' + (e && e.message ? e.message : e));
      });
  }

  function runStrategyA(report, cb) {
    var apis = listCandidateApis();
    report.debug.apiList = apis.slice(0, 40);
    if (!apis.length) { cb(null, '未发现页面发起的 XHR/fetch 请求'); return; }
    /* 优先探测 URL 里带课表语义词的接口 */
    var ranked = apis.slice().sort(function (a, b) {
      var score = function (u) {
        var s = 0;
        if (/schedule|timetable|kcb|course.*table|xsjb|jxb|kb/i.test(u)) s += 10;
        if (/query|get|list|find|search/i.test(u)) s += 3;
        return s;
      };
      return score(b) - score(a);
    });
    var i = 0;
    var limit = Math.min(ranked.length, 12); /* 限流，最多探测 12 个 */
    var tries = [];
    function next() {
      if (i >= limit) {
        cb(null, '探测 ' + limit + ' 个接口均未命中：' + tries.slice(0, 6).join('；'));
        return;
      }
      var url = ranked[i++];
      probeApi(url, function (mapped, hitUrl, sc) {
        report.strategy = 'api';
        report.debug.steps.push('策略A命中：' + hitUrl + '（评分 ' + sc + '，' + mapped.length + ' 门）');
        cb(mapped, null);
      }, function (why) {
        tries.push(shortUrl(url) + '→' + why);
        next();
      });
    }
    next();
  }

  function shortUrl(u) {
    try { var p = new URL(u, location.href); return p.pathname.split('/').pop() || p.pathname; }
    catch (e) { return String(u).slice(-24); }
  }

  /* ============ 策略 B：属性网格 ============ */
  function runStrategyB(report) {
    var sel = DAY_ATTRS.concat(SLOT_ATTRS).map(function (a) { return '[' + a + ']'; }).join(',');
    var nodes;
    try { nodes = document.querySelectorAll(sel); } catch (e) { return null; }
    if (!nodes || nodes.length < 3) return null;

    var courses = [];
    var attrOf = function (el, attrs) {
      for (var i = 0; i < attrs.length; i++) {
        var v = el.getAttribute && el.getAttribute(attrs[i]);
        if (v != null && v !== '') return v;
      }
      /* 父元素也可能挂属性 */
      var p = el.parentElement;
      for (var d = 0; d < 2 && p; d++) {
        for (var j = 0; j < attrs.length; j++) {
          var pv = p.getAttribute && p.getAttribute(attrs[j]);
          if (pv != null && pv !== '') return pv;
        }
        p = p.parentElement;
      }
      return null;
    };

    Array.prototype.forEach.call(nodes, function (el) {
      var ls = lines(el);
      if (!ls.length) { var t = txt(el); if (t) ls = [t]; }
      if (!ls.length) return;
      var dayRaw = attrOf(el, DAY_ATTRS);
      var slotRaw = attrOf(el, SLOT_ATTRS);
      var weekRaw = attrOf(el, WEEK_ATTRS);
      if (dayRaw == null && slotRaw == null) return;

      var wd = parseWeekday(String(dayRaw == null ? '' : dayRaw));
      var slot = parseSlot(String(slotRaw == null ? '' : slotRaw).replace(/[^\d\-~—到至,，]/g, ''));
      var weeks = weekRaw != null ? parseWeeks(String(weekRaw)) : [];

      var c = buildCourse(ls, { weekday: wd, slot: slot, weeks: weeks });
      if (!c.weekday) c.weekday = wd;
      if (!c.startSlot && slot) { c.startSlot = slot.start; c.endSlot = slot.end; }
      if (!c.weeks.length && weeks.length) c.weeks = weeks;
      if (validCourse(c)) courses.push(c);
    });

    if (courses.length < 1) return null;
    report.strategy = 'attr';
    report.debug.steps.push('策略B命中：属性网格，' + courses.length + ' 门');
    return dedupe(courses);
  }

  /* ============ 策略 C：表格遍历 ============ */
  function pickScheduleTable() {
    var tables = document.querySelectorAll('table');
    var best = null, bestScore = 0;
    Array.prototype.forEach.call(tables, function (tb) {
      var cells = tb.querySelectorAll('td,th').length;
      var rows = tb.rows ? tb.rows.length : 0;
      if (cells < 20 || rows < 3) return;
      var t = txt(tb);
      var s = cells;
      /* 表内含星期与节次特征词才认为是课表 */
      if (/(周[一二三四五六日]|星期[一二三四五六日])/.test(t)) s += 200;
      if (/(第?\s*\d{1,2}\s*节|节次|上午|下午|晚上)/.test(t)) s += 150;
      if (/(\d{1,2}\s*[-~—]\s*\d{1,2}\s*周|周次)/.test(t)) s += 100;
      if (s > bestScore) { bestScore = s; best = tb; }
    });
    return best;
  }

  /* 建网格模型，正确处理 rowspan / colspan */
  function buildGrid(table) {
    var grid = [], occupied = {};
    var rows = table.rows;
    for (var r = 0; r < rows.length; r++) {
      grid[r] = grid[r] || [];
      var c = 0;
      var cells = rows[r].cells;
      for (var i = 0; i < cells.length; i++) {
        while (occupied[r + ',' + c]) c++;
        var cell = cells[i];
        var rs = cell.rowSpan || 1, cs = cell.colSpan || 1;
        var node = { r: r, c: c, rs: rs, cs: cs, el: cell, span: false };
        for (var dr = 0; dr < rs; dr++) {
          for (var dc = 0; dc < cs; dc++) {
            occupied[(r + dr) + ',' + (c + dc)] = true;
            grid[r + dr] = grid[r + dr] || [];
            grid[r + dr][c + dc] = (dr === 0 && dc === 0) ? node : { span: true, owner: node, r: r + dr, c: c + dc };
          }
        }
        c += cs;
      }
    }
    return grid;
  }

  function runStrategyC(report) {
    var table = pickScheduleTable();
    if (!table) { report.debug.steps.push('策略C：未找到疑似课表的表格'); return null; }
    var grid = buildGrid(table);
    var nRows = grid.length;
    var nCols = 0;
    grid.forEach(function (row) { if (row && row.length > nCols) nCols = row.length; });
    report.debug.steps.push('策略C：表格 ' + nRows + ' 行 × ' + nCols + ' 列');
    if (!nRows || !nCols) return null;

    /* 推断「列 → 星期」：扫描前 4 行 */
    var colDay = {};
    for (var r = 0; r < Math.min(4, nRows); r++) {
      for (var c = 0; c < nCols; c++) {
        var cell = grid[r] && grid[r][c];
        if (!cell || cell.span) continue;
        var d = parseWeekday(txt(cell.el));
        if (d && colDay[c] == null) colDay[c] = d;
      }
    }
    /* colspan 跨列的星期表头，展开覆盖其跨度 */
    for (var r2 = 0; r2 < Math.min(4, nRows); r2++) {
      for (var c2 = 0; c2 < nCols; c2++) {
        var cl = grid[r2] && grid[r2][c2];
        if (!cl || cl.span || !(cl.cs > 1)) continue;
        var dd = parseWeekday(txt(cl.el));
        if (!dd) continue;
        /* 跨列表头下若各子列已有更精确的值则不覆盖 */
        for (var k = 0; k < cl.cs; k++) if (colDay[c2 + k] == null) colDay[c2 + k] = dd;
      }
    }

    /* 推断「行 → 节次」：扫描前 2 列 */
    var rowSlot = {};
    for (var r3 = 0; r3 < nRows; r3++) {
      for (var c3 = 0; c3 < Math.min(2, nCols); c3++) {
        var lc = grid[r3] && grid[r3][c3];
        if (!lc || lc.span) continue;
        var t = txt(lc.el);
        if (!t) continue;
        /* 跳过星期表头行 */
        if (parseWeekday(t) && !/\d/.test(t)) continue;
        var s = parseSlot(t.replace(/周/g, ''));
        if (s && rowSlot[r3] == null) rowSlot[r3] = s;
      }
    }

    var dayCols = Object.keys(colDay).length;
    var slotRows = Object.keys(rowSlot).length;
    report.debug.steps.push('策略C：识别到 ' + dayCols + ' 个星期列、' + slotRows + ' 个节次行');
    if (dayCols < 2) { report.debug.steps.push('策略C：星期列不足，放弃'); return null; }

    /* 数据区起始行 = 最后一个含星期表头的行 + 1 */
    var headerRow = 0;
    for (var r4 = 0; r4 < Math.min(4, nRows); r4++) {
      var hit = 0;
      for (var c4 = 0; c4 < nCols; c4++) {
        var hc = grid[r4] && grid[r4][c4];
        if (hc && !hc.span && parseWeekday(txt(hc.el))) hit++;
      }
      if (hit >= 2) headerRow = r4;
    }

    var courses = [];
    for (var r5 = 0; r5 < nRows; r5++) {
      for (var c5 = 0; c5 < nCols; c5++) {
        var cell2 = grid[r5] && grid[r5][c5];
        if (!cell2 || cell2.span) continue;
        var wd = colDay[c5];
        var slot = rowSlot[r5];
        /* 表头行本身不作为课程 */
        if (r5 <= headerRow && wd) continue;
        var ls = lines(cell2.el);
        if (!ls.length) continue;
        var joined = ls.join(' ');
        /* 纯节次/时间标签列跳过 */
        if (!wd && !slot) continue;
        if (parseWeekday(joined) && !slot) continue;

        /* 一格可能塞多门课：按空行或明显的课程名边界拆分 */
        var chunks = splitMultiCourses(ls);
        chunks.forEach(function (chunk) {
          var c = buildCourse(chunk, {
            weekday: wd,
            slot: slot,
            slotText: slot ? '' : ''
          });
          if (!c.weekday && wd) c.weekday = wd;
          if (!c.startSlot && slot) { c.startSlot = slot.start; c.endSlot = slot.end; }
          if (validCourse(c)) courses.push(c);
        });
      }
    }

    if (!courses.length) {
      report.debug.steps.push('策略C：遍历完成但未解析出有效课程');
      return null;
    }
    report.strategy = 'table';
    report.debug.steps.push('策略C命中：表格遍历，' + courses.length + ' 门');
    return dedupe(courses);
  }

  /* 一个单元格里可能有多门课。以「不含周/节字样且长度>=2 的中文行」作为新课程起点 */
  function splitMultiCourses(ls) {
    if (ls.length <= 1) return [ls];
    var chunks = [], cur = [];
    ls.forEach(function (s) {
      var isMeta = /(周|节|学时|上午|下午|晚上)/.test(s) || looksPlace(s) || looksTeacher(s);
      if (!isMeta && cur.length && /^[\u4e00-\u9fa5A-Za-z0-9()（）]{2,}$/.test(s) && curHasName(cur)) {
        chunks.push(cur);
        cur = [s];
      } else {
        cur.push(s);
      }
    });
    if (cur.length) chunks.push(cur);
    return chunks.length ? chunks : [ls];
  }

  function curHasName(cur) {
    return cur.some(function (s) { return !(looksPlace(s) || looksTeacher(s) || /(周|节)/.test(s)); });
  }

  function dedupe(list) {
    var seen = {}, out = [];
    list.forEach(function (c) {
      var k = [c.name, c.weekday, c.startSlot, c.endSlot, c.location].join('|');
      if (seen[k]) return;
      seen[k] = 1;
      out.push(c);
    });
    return out;
  }

  /* ============ 学期识别（页面标题/正文里的学期字样） ============ */
  function detectTerm(report) {
    var src = (document.title || '') + ' ' + txt(document.body).slice(0, 4000);
    var m = /(20\d{2})\s*[-—~年]?\s*(20\d{2})?\s*[学年]*\s*(第?[一二三1-3])?\s*(春|夏|秋|冬)?\s*季?\s*学期/.exec(src);
    if (m) {
      var y = m[1], y2 = m[2], n = m[3], season = m[4];
      var CN = { '一': 1, '二': 2, '三': 3, '1': 1, '2': 2, '3': 3 };
      var termNo = n ? (CN[n.replace('第', '')] || null) : null;
      var label = y + '-' + (y2 || (parseInt(y, 10) + 1)) + '学年' + (termNo ? '第' + termNo + '学期' : '') + (season ? season + '季学期' : '');
      return { label: label.replace(/学年第(\d)学期/, '学年第$1学期'), year: +y, season: season || null, termNo: termNo };
    }
    /* 退化：只找季节 + 学年 */
    var m2 = /(20\d{2})\s*[-—~]\s*(20\d{2})/.exec(src);
    var m3 = /(春|夏|秋|冬)\s*季?\s*学期/.exec(src);
    if (m2 || m3) {
      return {
        label: (m2 ? m2[1] + '-' + m2[2] + '学年' : '') + (m3 ? m3[1] + '季学期' : ''),
        year: m2 ? +m2[1] : null, season: m3 ? m3[1] : null, termNo: null
      };
    }
    return null;
  }

  /* ============ 结构骨架（兜底诊断用） ============ */
  function buildSkeleton() {
    var sk = { tables: [], dataAttrs: {}, keywords: {}, xhr: [], outline: [] };

    var tables = document.querySelectorAll('table');
    Array.prototype.forEach.call(tables, function (tb, i) {
      if (i >= 6) return;
      var sample = [];
      var cells = tb.querySelectorAll('td,th');
      Array.prototype.forEach.call(cells, function (c, j) {
        if (j >= 12) return;
        var t = txt(c);
        if (t) sample.push(t.slice(0, 40));
      });
      sk.tables.push({
        idx: i,
        id: tb.id || null,
        cls: (tb.className || '').toString().slice(0, 80),
        rows: tb.rows ? tb.rows.length : 0,
        cells: cells.length,
        sample: sample
      });
    });

    /* 统计页面里出现过的 data-* 属性名 */
    var all = document.querySelectorAll('*');
    var count = 0;
    Array.prototype.forEach.call(all, function (el) {
      if (count++ > 6000) return;
      if (!el.attributes) return;
      Array.prototype.forEach.call(el.attributes, function (a) {
        if (/^data-/i.test(a.name)) {
          var key = a.name.toLowerCase();
          if (!sk.dataAttrs[key]) sk.dataAttrs[key] = { n: 0, sample: String(a.value).slice(0, 30) };
          sk.dataAttrs[key].n++;
        }
      });
    });

    var body = txt(document.body);
    ['课表', '课程', '节次', '周次', '星期一', '周一', '教室', '教师', '学分', '单周', '双周'].forEach(function (k) {
      var re = new RegExp(k, 'g');
      var m = body.match(re);
      sk.keywords[k] = m ? m.length : 0;
    });

    sk.xhr = listCandidateApis().slice(0, 40);

    /* 主体结构树（限深度 4，限节点 120） */
    var budget = 120;
    function walk(el, depth) {
      if (budget-- <= 0 || depth > 4 || !el) return;
      var tag = el.tagName ? el.tagName.toLowerCase() : '';
      if (!tag || tag === 'script' || tag === 'style' || tag === 'link') return;
      var cls = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      var id = el.id ? '#' + el.id : '';
      sk.outline.push('  '.repeat(depth) + tag + id + cls);
      Array.prototype.forEach.call(el.children, function (ch) { walk(ch, depth + 1); });
    }
    walk(document.body, 0);

    return sk;
  }

  /* ============ 主入口 ============ */
  /* extract(cb, opts) —— cb 收到 JSON 字符串。
   * opts.skeleton=true 时无论成败都附带结构骨架；否则仅在解析失败时附带。 */
  function extract(cb, opts) {
    var report = makeReport();
    var finished = false;
    var forceSkeleton = !!(opts && opts.skeleton);

    function finish() {
      if (finished) return;
      finished = true;
      if (forceSkeleton || !report.ok) {
        try { report.debug.skeleton = buildSkeleton(); } catch (e) { report.debug.skeleton = { error: String(e) }; }
      }
      try { cb(JSON.stringify(report)); } catch (e) { cb('{"ok":false,"error":"序列化失败"}'); }
    }

    /* 页面基本可用性检查 */
    var bodyText = txt(document.body);
    if (!bodyText || bodyText.length < 30) {
      report.debug.steps.push('页面正文过短，可能尚未渲染完成或未登录');
      finish();
      return;
    }
    if (/统一身份认证|请输入.*(学工号|密码)|登录.*账号/.test(bodyText.slice(0, 600)) && !/课表|课程/.test(bodyText)) {
      report.debug.steps.push('当前仍停留在登录页，请先完成登录并打开课表页');
      finish();
      return;
    }

    report.term = detectTerm(report);
    if (report.term) report.debug.steps.push('识别学期：' + report.term.label);

    /* 策略 B：属性网格（同步、代价低，先试） */
    var b = null;
    try { b = runStrategyB(report); } catch (e) { report.debug.steps.push('策略B异常：' + e.message); }
    if (b && b.length) { report.ok = true; report.courses = b; finish(); return; }

    /* 策略 C：表格遍历（同步） */
    var c = null;
    try { c = runStrategyC(report); } catch (e) { report.debug.steps.push('策略C异常：' + e.message); }
    if (c && c.length) { report.ok = true; report.courses = c; finish(); return; }

    /* 策略 A：接口直取（异步，兜在同步策略之后，因为需要网络往返） */
    try {
      runStrategyA(report, function (mapped, why) {
        if (mapped && mapped.length) {
          report.ok = true;
          report.courses = dedupe(mapped);
          report.debug.steps.push('策略A：最终 ' + report.courses.length + ' 门');
        } else {
          report.debug.steps.push('策略A失败：' + why);
          report.debug.steps.push('三套策略均未命中，已导出结构骨架供诊断');
        }
        finish();
      });
    } catch (e) {
      report.debug.steps.push('策略A异常：' + e.message);
      finish();
    }
  }

  global.__aitodoExtract = extract;
})(window);
