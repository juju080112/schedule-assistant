/* ============================================================
 * 中科大教务课表同步（v1.7.0）
 *
 * 依赖 app.js 中的：store / toast / LN / escapeHtml / fmtHM /
 *                   getTodos / renderSchedule / refreshTodayBar
 * 本文件在 app.js 之后加载，仅在这些函数体内引用它们（调用时已就绪）。
 *
 * 数据边界（合规）：
 *   只存解析后的课表信息（课程名/教师/地点/星期/节次/周次）与校历配置。
 *   绝不存储密码、Cookie、Token、Session、原始 HTML。
 * ============================================================ */
(function (global) {
  'use strict';

  /* ============ 官方校历（2026 年秋季学期，来源：教务处教学日历） ============ */
  /* 教学周按「周日为一周之首」编排：秋1 = 8/30(日)~9/5(六)，首个上课日 8/31(一) */
  var DEFAULT_TERM = {
    label: '2026-2027学年 秋季学期',
    week1Sunday: '2026-08-30',   // 第 1 教学周的周日（周次计算锚点）
    totalWeeks: 20,              // 共 20 教学周，2027-01-15 结束
    /* 调课：该日期按指定星期的课表上课（值=星期 1~7）
       来源：教务处《2026年秋季学期教学日历》+《关于2026年中秋节、国庆节放假的通知》
       https://www.teach.ustc.edu.cn/calendar/20135.html
       https://www.ustc.edu.cn/info/1364/25670.htm */
    overrides: {
      '2026-09-20': 5,           // 校庆；通知原文「9月20日上星期五的课」
      '2026-10-10': 2            // 通知原文「10月10日上星期二的课」
    },
    /* 放假：该日期全天无课。来源：教务处教学日历 +《关于2026年中秋节、国庆节放假的通知》
       （周末也一并列出：正常无课，但若有周日/周六课程则同样停上） */
    holidays: [
      '2026-09-25', '2026-09-26', '2026-09-27',                                  // 中秋节 3 天
      '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
      '2026-10-05', '2026-10-06', '2026-10-07',                                  // 国庆节 7 天
      '2027-01-01', '2027-01-02', '2027-01-03'                                   // 元旦 3 天
    ]
  };

  /* 官方上课时间表：第 N 节起始 [时, 分]，索引 0 对应第 1 节 */
  var SLOT_START = [
    [7, 50], [8, 40], [9, 45], [10, 35], [11, 25],          // 1-5 上午
    [14, 0], [14, 50], [15, 55], [16, 45], [17, 35],        // 6-10 下午
    [19, 30], [20, 20], [21, 10]                            // 11-13 晚上
  ];
  var SLOT_MINUTES = 45; // 每小节 45 分钟，用于推算下课时间

  /* 课程提醒的 ID 区间（2e9 以上为课程专用）由原生 CourseAutoSync 分配，
   * 待办用 id(0~1e9) 与 id+1e9(1e9~2e9)，常驻栏用 999998/999999，互不冲突。 */

  /* 课程提醒窗口：当天 + 往后 3 天（每日自动同步会滚动续排） */
  var NOTIFY_HORIZON_DAYS = 4;

  /* ============ 存储键 ============ */
  var K_LIST = 'courseList';
  var K_TERM = 'courseTerm';
  var K_SYNC = 'courseSyncAt';
  var K_SET = 'courseSettings';
  var K_URL = 'courseLastUrl';   // 上次成功抓取的课表页地址（供每日自动同步复用会话）
  var K_RAW = 'courseUstcRaw';   // 教务课表接口的原始 JSON（全校 20 周完整数据，仅课程信息）
  var K_DEBUG = 'courseDebug';   // 上次抓取诊断（持久化，重启后仍可查看）
  var K_DONE = 'courseDoneMap';  // 已完成课程节次 {name|date|slot:1}，原生排程同步跳过
  var K_HIDE = 'courseHideMap';  // 已从日程移除的课程节次（仅当天，不动课表数据）
  var K_CLOSED = 'courseClosedMap'; // v1.8.12：永久关闭的节次（已清理/已删除），不再生成日程且跳过提醒
  var K_EPOCH = 'courseDataEpoch';
  var EPOCH_NOW = 'v1.7.4';      // 升级到此版本时清一次旧同步记录

  function getSettings() {
    /* v1.7.9：课表恒定启用，不再提供关闭入口 */
    return Object.assign(
      { enabled: true, showInSchedule: true, showInBar: true },
      store.get(K_SET, {}),
      { enabled: true }
    );
  }
  function saveSettings(s) { store.set(K_SET, s); }

  /* v1.8.15：内置校历（调课/放假）必须能覆盖到已安装的设备。
     早期版本存下的 K_TERM 里没有 overrides/holidays，若原样返回就会漏掉调课与放假，
     导致「课表上有课、日程里没有」。这里把内置规则合并进已存校历，同时保留
     同步来的 week1Sunday / totalWeeks / label（它们以教务页面校准值为准）。 */
  function getTerm() {
    var base = JSON.parse(JSON.stringify(DEFAULT_TERM));
    var t = store.get(K_TERM, null);
    if (!t || !t.week1Sunday) return base;
    var merged = Object.assign({}, base, t);
    /* 调课规则以「内置官方校历」为准（值来自教务处教学日历与放假通知），已存校历只作补充 */
    merged.overrides = Object.assign({}, t.overrides || {}, base.overrides);
    var hol = (base.holidays || []).slice();
    (t.holidays || []).forEach(function (k) { if (hol.indexOf(k) < 0) hol.push(k); });
    merged.holidays = hol;
    return merged;
  }
  function saveTerm(t) { store.set(K_TERM, t); }

  function getList() { return store.get(K_LIST, []); }
  function saveList(list) { store.set(K_LIST, list); }

  function getSyncAt() { return store.get(K_SYNC, 0); }
  function setSyncAt(ts) { store.set(K_SYNC, ts); }

  /* ============ 日期工具 ============ */
  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }
  function dateKey(d) {
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function parseKey(key) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  function daysBetween(a, b) {
    return Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
  }
  /* 周一=1 … 周日=7 */
  function isoWeekday(d) {
    return (d.getDay() + 6) % 7 + 1;
  }

  /* ============ 校历换算 ============ */
  function weekNoOf(dateObj, term) {
    var anchor = parseKey(term.week1Sunday);
    if (!anchor) return 0;
    return Math.floor(daysBetween(anchor, dateObj) / 7) + 1;
  }

  /* 某日期实际生效的星期：调课优先，否则按自然星期 */
  function effectiveWeekday(dateObj, term) {
    var key = dateKey(dateObj);
    if (term.overrides && term.overrides[key]) return term.overrides[key];
    return isoWeekday(dateObj);
  }

  function isHoliday(dateObj, term) {
    return !!(term.holidays && term.holidays.indexOf(dateKey(dateObj)) >= 0);
  }

  function slotStartTs(dateObj, slot) {
    var t = SLOT_START[slot - 1];
    if (!t) return null;
    return new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(), t[0], t[1], 0, 0).getTime();
  }
  /* 下课时间 = 末节开始 + 一节时长（v1.8.4 修正）
     科大作息：每小节 45 分钟，小节间休息 5 分钟、大节之间休息 20 分钟。
     例：1-2 节 7:50–9:25（不是 9:45）；8-10 节 15:55–18:20（不是 19:30）。
     旧实现取「下一节的开始时间」当结束时间，跨大节时会把 20 分钟休息算进去，故错误。 */
  function slotEndTs(dateObj, slot) {
    var start = slotStartTs(dateObj, slot);
    if (start == null) return null;
    return start + SLOT_MINUTES * 60000;
  }

  /* 判断某课程在某日期是否上课，返回 occurrence 或 null */
  /* ============ 课程节次状态（v1.8.12：每节课实体化为独立日程） ============
   * 课程本身是「每周模板」，但每节课会被展开成一条独立的日程记录（存进 todos），
   * 因此可以单独完成、单独删除、单独清理，不会因为清理标记而"复活"。
   * K_CLOSED 记录永久关闭的节次（已清理 / 已删除），既不再生成日程，也让原生跳过提醒。 */
  function getClosedMap() { return store.get(K_CLOSED, {}); }
  function closeSessionKeys(keys) {
    var m = getClosedMap();
    (keys || []).forEach(function (k) { if (k) m[k] = 1; });
    try { store.set(K_CLOSED, m); } catch (e) {}
  }
  /* 与原生 CourseAutoSync 的闹钟 key 完全一致：name|yyyy-MM-dd|startSlot */
  function occKeyOf(occ) {
    return (occ.course && occ.course.name || '') + '|' + dateKey(new Date(occ.date)) + '|' + occ.startSlot;
  }
  /* 需要原生跳过提醒的节次：永久关闭的 + 当前已标记完成的独立日程 */
  function skipKeys() {
    var out = [];
    var closed = getClosedMap();
    for (var k in closed) if (closed[k]) out.push(k);
    try {
      var todos = store.get('todos', []);
      todos.forEach(function (t) { if (t && t.courseKey && t.done) out.push(t.courseKey); });
    } catch (e) {}
    return out;
  }
  /* 清理过期的关闭记录，避免无限增长（保留最近 30 天与未来日期） */
  function pruneClosed() {
    var m = getClosedMap();
    var limit = dateKey(new Date(Date.now() - 30 * 86400000));
    var changed = false;
    for (var k in m) {
      var parts = String(k).split('|');
      var d = parts.length > 1 ? parts[1] : '';
      if (d && d < limit) { delete m[k]; changed = true; }
    }
    if (changed) { try { store.set(K_CLOSED, m); } catch (e) {} }
  }

  /* ============ 采纳原生后台同步的结果（v1.8.14） ============ */
  /* 每天 06:30 的后台同步写的是原生状态，网页层取回来对比时间戳，
     比网页层新就采纳，从而让「课表临时调整」也能自动反映到日程里。 */
  function pullNativeState() {
    var p = coursePlugin();
    if (!p || !p.getState) return Promise.resolve(false);
    return p.getState().then(function (res) {
      if (!res || !res.state) return false;
      var ns = Number(res.syncedAt || 0);
      if (!ns || ns <= getSyncAt()) return false;
      var st;
      try { st = JSON.parse(res.state); } catch (e) { return false; }
      var courses = (st.courses || []).map(normalizeCourse).filter(function (c) {
        return c.name && c.weekday && c.startSlot;
      });
      if (!courses.length) return false;
      saveList(courses);
      setSyncAt(ns);
      if (st.term && st.term.week1Sunday) {
        var t = getTerm();
        if (st.term.week1Sunday) t.week1Sunday = st.term.week1Sunday;
        if (st.term.totalWeeks) t.totalWeeks = st.term.totalWeeks;
        if (st.term.label) t.label = st.term.label;
        saveTerm(t);
      }
      return true;
    }).catch(function () { return false; });
  }

  /* ============ 课程日程对账（v1.8.14） ============
   * 目标窗口：当天 + 往后 3 天（与提醒窗口一致）
   * 1) 同一节课（key 相同）→ 就地更新时间/地点/教师（课表改了也能更新）
   * 2) 课表里已不存在的节次 → 未完成且在窗口内的自动删除，并永久关闭（不再重新生成）
   * 3) 窗口内新增的节次 → 自动补建为独立日程
   * 已完成的节次视为历史，不会被自动删除。 */
  function expectedSessions() {
    var list = getList();
    var term = getTerm();
    var map = {};
    if (!list.length) return map;
    var base = startOfDay(new Date());
    for (var i = 0; i < NOTIFY_HORIZON_DAYS; i++) {
      var d = new Date(base + i * 86400000);
      if (isHoliday(d, term)) continue;
      var wn = weekNoOf(d, term);
      if (wn < 1 || wn > (term.totalWeeks || 20)) continue;
      var wd = effectiveWeekday(d, term);
      for (var j = 0; j < list.length; j++) {
        var c = list[j];
        if (!c || c.weekday !== wd || !c.startSlot) continue;
        if (c.weeks && c.weeks.length && c.weeks.indexOf(wn) < 0) continue;
        var key = c.name + '|' + dateKey(d) + '|' + c.startSlot;
        var endSlot = (c.endSlot && c.endSlot >= c.startSlot) ? c.endSlot : c.startSlot;
        var st = slotStartTs(d, c.startSlot);
        var en = slotEndTs(d, endSlot);
        map[key] = {
          key: key,
          title: '📚 ' + c.name,
          detail: '第' + c.startSlot + (endSlot !== c.startSlot ? '-' + endSlot : '') + '节 ' +
            (st != null ? fmtHM(st) + '-' + fmtHM(en) : '') +
            (c.location ? ' · ' + c.location : '') +
            (c.teacher ? ' · ' + c.teacher : '') + ' · 第' + wn + '周',
          due: st,
          endTs: en,
          weekNo: wn
        };
      }
    }
    return map;
  }

  function syncSessions() {
    if (!getList().length) return false;
    pruneClosed();
    var exp = expectedSessions();
    var todos;
    try { todos = store.get('todos', []); } catch (e) { return false; }
    var closed = getClosedMap();
    var todayStart = startOfDay(new Date());
    var changed = false;
    var kept = [];
    todos.forEach(function (t) {
      if (!t || !t.courseKey) { kept.push(t); return; }
      var e = exp[t.courseKey];
      if (e) {
        /* 1) 同一节课：课表若改了时间/地点/教师，就地更新（保留完成状态与原始来源） */
        if (t.due !== e.due || t.endTs !== e.endTs || t.detail !== e.detail ||
            t.title !== e.title || t.weekNo !== e.weekNo) {
          t.due = e.due; t.endTs = e.endTs; t.detail = e.detail;
          t.title = e.title; t.weekNo = e.weekNo;
          /* 时间变了且原来是待办提醒，则重排（课程提醒由原生负责，这里只保证展示一致） */
          changed = true;
        }
        kept.push(t);
        return;
      }
      /* 2) 课表里已不存在：未完成且在窗口内 → 自动删除并永久关闭 */
      if (!t.done && t.due && t.due >= todayStart) {
        closed[t.courseKey] = 1;
        changed = true;
        return;
      }
      kept.push(t);
    });
    /* 3) 补齐窗口内缺失的节次 */
    var have = {};
    kept.forEach(function (t) { if (t && t.courseKey) have[t.courseKey] = 1; });
    var seq = 0;
    Object.keys(exp).forEach(function (k) {
      if (have[k] || closed[k]) return;
      var e = exp[k];
      kept.push({
        id: Date.now() + (seq++),
        title: e.title,
        detail: e.detail,
        done: false,
        createdAt: Date.now(),
        due: e.due,
        endTs: e.endTs,
        remind: false,      /* 提醒由原生课程闹钟负责，避免重复通知 */
        notifyId: null,
        courseKey: k,
        weekNo: e.weekNo
      });
      changed = true;
    });
    if (changed) {
      try { store.set('todos', kept); } catch (e) {}
      try { store.set(K_CLOSED, closed); } catch (e) {}
      try { scheduleCourseNotifications(); } catch (e) {}
    }
    return changed;
  }

  /* 兼容旧调用名 */
  function rollSessions() { return syncSessions(); }
  /* 删除超过 7 天仍未完成的历史课程日程，避免堆积 */
  function dropStaleSessions() {
    var todos;
    try { todos = store.get('todos', []); } catch (e) { return false; }
    var limit = startOfDay(new Date()) - 7 * 86400000;
    var kept = todos.filter(function (t) { return !(t && t.courseKey && !t.done && t.due && t.due < limit); });
    if (kept.length === todos.length) return false;
    try { store.set('todos', kept); } catch (e) {}
    return true;
  }

  /* v1.8.18：原 occurrenceOn / occurrencesBetween / todayOccurrences 已废弃删除——
     课程改为「实体化独立日程」后，日程与常驻栏都直接读 todos，
     课表网格与 AI 接口分别用 renderCourseTable / getWeekPlan，无需再动态展开 occurrence。 */

  /* ============ 解析报告归一化 ============ */
  function normalizeCourse(c, idx) {
    var weeks = Array.isArray(c.weeks) ? c.weeks.map(Number).filter(function (w) { return w >= 1 && w <= 30; }) : [];
    weeks = weeks.filter(function (w, i) { return weeks.indexOf(w) === i; }).sort(function (a, b) { return a - b; });
    var wd = parseInt(c.weekday, 10);
    if (!(wd >= 1 && wd <= 7)) wd = null;
    var ss = parseInt(c.startSlot, 10);
    var es = parseInt(c.endSlot, 10);
    if (!(ss >= 1 && ss <= 14)) ss = null;
    if (!(es >= ss)) es = ss;
    return {
      name: String(c.name || '').trim().slice(0, 60),
      teacher: String(c.teacher || '').trim().slice(0, 40),
      location: String(c.location || '').trim().slice(0, 40),
      weekday: wd,
      startSlot: ss,
      endSlot: es,
      weeks: weeks,
      raw: String(c.raw || '').slice(0, 300)
    };
  }

  function parseReport(rawJson) {
    var report;
    try { report = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson; }
    catch (e) { return { ok: false, error: '结果不是合法 JSON：' + e.message, courses: [], debug: null }; }
    if (!report) return { ok: false, error: '空结果', courses: [], debug: null };
    var courses = (report.courses || []).map(normalizeCourse).filter(function (c) {
      return c.name && c.weekday && c.startSlot;
    });
    return {
      ok: !!report.ok && courses.length > 0,
      strategy: report.strategy || null,
      term: report.term || null,
      courses: courses,
      error: report.ok ? (courses.length ? null : '解析到页面但未提取出有效课程') : (report.error || '抓取未成功'),
      debug: report.debug || null,
      rawCount: (report.courses || []).length
    };
  }

  /* ============ 提醒排程：交给原生（v1.7.0） ============ */
  /* 推送「课表 + 校历 + 作息表 + 设置」给原生 CourseAutoSync：
   * 原生按「当天 + 往后 3 天」换算出每节课，用系统闹钟各排
   * 「准点 + 提前 1 小时」两条提醒（与其他日程完全一致），
   * 即使 App 完全不在后台也能准点触发。每次调用都是全量重排（幂等）。 */
  function pushStateToNative() {
    var p = coursePlugin();
    if (!p || !p.syncAlarms) return;
    var s = getSettings();
    var state = {
      syncedAt: getSyncAt(),
      lastGoodUrl: store.get(K_URL, ''),
      settings: { enabled: s.enabled, showInSchedule: s.showInSchedule, showInBar: s.showInBar },
      term: getTerm(),
      slotStart: SLOT_START,
      courses: getList(),
      skip: skipKeys() /* 已完成/已移除的节次，原生排程时跳过 */
    };
    try { p.syncAlarms({ state: JSON.stringify(state) }).catch(function () {}); } catch (e) {}
  }

  /* 兼容既有调用点：同步成功 / 设置变更 / 启动续排 / 清除数据后的统一入口 */
  function scheduleCourseNotifications() { pushStateToNative(); }
  function cancelAllCourseNotifications() { pushStateToNative(); }

  function refreshTodayBarSafe() {
    try { if (typeof refreshTodayBar === 'function') refreshTodayBar(); } catch (e) {}
  }

  /* ============ 同步流程 ============ */
  /* 处理抓取报告：解析 → 落库 → 排程 → 状态展示（v1.7.1 从 sync() 抽出复用） */
  function processReport(raw, grabUrl, onDone) {
    var parsed = parseReport(raw);
    if (!parsed.ok) {
      var why = parsed.error || '未知原因';
      setSyncStatus('抓取未成功：' + why, 'error');
      toast('同步失败：' + why);
      lastDebug = parsed.debug;
      lastParsedCourses = [];
      if (onDone) onDone(false, parsed);
      return;
    }
    /* 成功：落库（只存课表信息，不存任何凭据） */
    lastParsedCourses = parsed.courses || [];
    lastDebug = parsed.debug;
    try { store.set(K_DEBUG, parsed.debug || null); } catch (e) {}
    saveList(parsed.courses);
    setSyncAt(Date.now());
    try { store.set(K_URL, grabUrl || ''); } catch (e) {}
    if (parsed.term && parsed.term.label) {
      var t = getTerm();
      t.label = parsed.term.label;
      saveTerm(t);
    }
    /* v1.7.1：官方接口直取时用教务页面的开学日期校准「第1周周日」锚点 */
    var calibNote = '';
    if (parsed.term && parsed.term.week1Sunday && /^\d{4}-\d{2}-\d{2}$/.test(parsed.term.week1Sunday)) {
      var t2 = getTerm();
      if (t2.week1Sunday !== parsed.term.week1Sunday) {
        t2.week1Sunday = parsed.term.week1Sunday;
        saveTerm(t2);
        calibNote = '，已按教务页面校准学期起始日为 ' + t2.week1Sunday;
      }
    }
    lastDebug = parsed.debug;
    scheduleCourseNotifications();
    /* 持久化教务接口原始 JSON（全校 20 周完整课表数据，供逐周还原与排查） */
    try {
      var pRaw = coursePlugin();
      if (pRaw && pRaw.getCourseRaw) {
        pRaw.getCourseRaw().then(function (rr) {
          if (rr && rr.raw) {
            try {
              var full = JSON.parse(rr.raw);
              if (full && full.rawUstc) store.set(K_RAW, full.rawUstc);
            } catch (e) {}
          }
        }).catch(function () {});
      }
    } catch (e) {}
    var strategyName = { 'ustc-api': '官方接口直取', api: '接口直取', attr: '属性网格', table: '表格解析' }[parsed.strategy] || parsed.strategy;
    setSyncStatus('✔ 同步成功：' + parsed.courses.length + ' 门课程（来源：' + strategyName + '）', 'ok');
    toast('课表已同步：' + parsed.courses.length + ' 门课程');
    try { if (typeof renderSchedule === 'function') renderSchedule(); } catch (e) {}
    try { renderCourseTable(true); } catch (e) {}
    refreshTodayBarSafe();
    if (onDone) onDone(true, parsed);
  }

  function coursePlugin() {
    try {
      if (window.__cap && window.__cap.CourseSync) return window.__cap.CourseSync;
      if (window.Capacitor && window.Capacitor.registerPlugin) return window.Capacitor.registerPlugin('CourseSync');
    } catch (e) {}
    return null;
  }

  var syncing = false;
  function sync(onDone) {
    if (syncing) { toast('正在同步中，请稍候'); return; }
    var plugin = coursePlugin();
    if (!plugin || !plugin.openLogin) {
      toast('当前环境不支持课表同步（需在 App 内运行）');
      if (onDone) onDone(false);
      return;
    }
    syncing = true;
    setSyncStatus('正在打开教务登录窗口，请亲手登录并进入课表页…', 'busy');
    /* 看门狗（v1.7.1）：结果回传链路异常时保证界面不永久挂起。
     * 10 分钟足够完成登录+抓取；若误触发，关闭窗口后重试即可。 */
    var wd = setTimeout(function () {
      syncing = false;
      setSyncStatus('长时间未收到同步结果（回传链路异常）。请重试一次。', 'error');
      toast('同步超时，请重试');
      if (onDone) onDone(false);
    }, 600000);
    plugin.openLogin({ url: '' }).then(function (res) {
      /* v1.7.1：窗口内自动抓取完成即返回；url 传空让原生用「课表直达页」入口 */
      clearTimeout(wd);
      var grabUrl = res && res.url ? String(res.url) : '';
      var raw = res && res.raw ? res.raw : '';
      var finishWith = function (rawText) {
        syncing = false;
        if (!rawText) {
          setSyncStatus('已取消或未获取到结果。', 'error');
          if (onDone) onDone(false);
          return;
        }
        processReport(rawText, grabUrl, onDone);
      };
      if (raw) { finishWith(raw); return; }
      /* Intent 通道异常时从本地文件兜底读取 */
      try {
        if (plugin.getCourseRaw) {
          plugin.getCourseRaw().then(function (r2) {
            finishWith(r2 && r2.raw ? r2.raw : '');
          }).catch(function () { finishWith(''); });
          return;
        }
      } catch (e) {}
      finishWith('');
    }).catch(function (e) {
      clearTimeout(wd);
      syncing = false;
      setSyncStatus('同步出错：' + (e && e.message ? e.message : e), 'error');
      if (onDone) onDone(false);
    });
  }

  var lastDebug = null;
  var lastParsedCourses = [];

  /* ============ 状态提示（设置子页内） ============ */
  function setSyncStatus(msg, kind) {
    var el = document.getElementById('courseStatus');
    if (!el) return;
    el.className = 'status' + (kind === 'error' ? ' error' : kind === 'ok' ? ' ok' : '');
    el.textContent = msg;
  }

  /* ============ 课程卡片（并入日程页） ============ */
  var WD_LABEL = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  /* v1.8.12：课程卡片不再由课表模板动态渲染——每节课都是 todos 里的独立日程记录，
     统一用日程页的通用卡片展示（可单独完成/删除/清理）。此处仅保留课程详情弹层。 */

  /* 课程详情：由 showCourseBlockDetail（课表页点课程块）提供。
     日程页里的课程条目已是普通待办，走通用详情面板，故不再需要 openCourseDetail。 */
  function closeCourseDetail() {
    var mask = document.getElementById('courseMask');
    if (mask) mask.hidden = true;
  }

  /* ============ 日程页头部统计与同步入口 ============ */
  function renderScheduleHeader() {
    var list = getList();
    var s = getSettings();
    var countEl = document.getElementById('courseCount');
    if (countEl) countEl.textContent = s.enabled ? list.length : 0;
    var syncAt = getSyncAt();
    var tipEl = document.getElementById('courseSyncTip');
    if (tipEl) {
      if (!s.enabled) tipEl.textContent = '课表同步已关闭';
      else if (!list.length) tipEl.textContent = '尚未同步课表';
      else {
        var days = Math.floor((Date.now() - syncAt) / 86400000);
        tipEl.textContent = '已同步 ' + list.length + ' 门 · ' + (days <= 0 ? '今天' : days + ' 天前') + (days >= 7 ? '（建议刷新）' : '');
      }
    }
  }

  /* ============ 设置子页 UI ============ */
  function loadSettingsUI() {
    var s = getSettings();
    var term = getTerm();
    var set = function (id, v) { var el = document.getElementById(id); if (el) el.value = v; };
    var chk = function (id, v) { var el = document.getElementById(id); if (el) el.checked = !!v; };
    chk('setCourseInSchedule', s.showInSchedule);
    chk('setCourseInBar', s.showInBar);
    /* v1.7.9：每天自动同步恒定开启（不可关闭），每次进设置页顺带校正一次原生开关 */
    var p = coursePlugin();
    if (p && p.setAuto) { try { p.setAuto({ enabled: true }).catch(function () {}); } catch (e) {} }
    var listEl = document.getElementById('courseListPreview');
    if (listEl) {
      var list = getList();
      if (!list.length) {
        listEl.innerHTML = '<p class="hint">尚未同步。点课程表页右上角「同步」，在弹出的窗口里亲手登录教务系统即可自动抓取。</p>';
      } else {
        var byDay = [[], [], [], [], [], [], []];
        list.forEach(function (c) { if (c.weekday >= 1 && c.weekday <= 7) byDay[c.weekday - 1].push(c); });
        var html = '';
        for (var i = 0; i < 7; i++) {
          if (!byDay[i].length) continue;
          html += '<div class="course-day-head">' + WD_LABEL[i + 1] + '</div>';
          byDay[i].sort(function (a, b) { return a.startSlot - b.startSlot; }).forEach(function (c) {
            html += '<div class="course-line"><b>' + escapeHtml(c.name) + '</b>' +
              '<span>第' + c.startSlot + (c.endSlot !== c.startSlot ? '-' + c.endSlot : '') + '节' +
              (c.location ? ' · ' + escapeHtml(c.location) : '') +
              (c.weeks && c.weeks.length && c.weeks.length < 15 ? ' · ' + c.weeks.join(',') + '周' : '') + '</span></div>';
          });
        }
        listEl.innerHTML = html || '<p class="hint">已同步但无按星期归类的课程。</p>';
      }
    }
    renderScheduleHeader();
    var syncAt = getSyncAt();
    var lastEl = document.getElementById('courseLastSync');
    if (lastEl) lastEl.textContent = syncAt ? ('上次同步：' + fmtDate(syncAt)) : '尚未同步';
  }

  /* ============ 事件绑定 ============ */
  function bind() {
    var btnSync = document.getElementById('btnCourseSync');
    if (btnSync) btnSync.onclick = function () { sync(); };

    var btnSync2 = document.getElementById('btnCourseSyncTop');
    if (btnSync2) btnSync2.onclick = function () { sync(function (ok) { if (ok) try { renderSchedule(); } catch (e) {} }); };

    var btnClear = document.getElementById('btnCourseClear');
    if (btnClear) btnClear.onclick = function () {
      if (!confirm('确定清除本地课表数据吗？将同时清除已保存的教务登录状态（账号密码本就未保存）。不影响待办与设置。')) return;
      saveList([]);
      setSyncAt(0);
      try { localStorage.removeItem(K_URL); } catch (e) {}
      lastDebug = null;
      scheduleCourseNotifications(); /* 空课表 → 原生取消全部课程提醒 */
      var p = coursePlugin();
      if (p && p.clearLogin) { try { p.clearLogin().catch(function () {}); } catch (e) {} }
      loadSettingsUI();
      try { renderSchedule(); } catch (e) {}
      refreshTodayBarSafe();
      setSyncStatus('已清除本地课表数据与登录状态。', 'ok');
      toast('课表数据已清除');
    };

    /* 设置项变更 */
    var onChange = function (id, fn) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', fn);
    };
    onChange('setCourseInSchedule', function (e) {
      var s = getSettings(); s.showInSchedule = e.target.checked; saveSettings(s);
      scheduleCourseNotifications();
      try { renderSchedule(); } catch (err) {}
    });
    onChange('setCourseInBar', function (e) {
      var s = getSettings(); s.showInBar = e.target.checked; saveSettings(s);
      refreshTodayBarSafe();
    });

    /* 课程详情弹层关闭 */
    var cm = document.getElementById('courseMask');
    if (cm) {
      var cc = document.getElementById('courseClose');
      if (cc) cc.onclick = closeCourseDetail;
      cm.addEventListener('click', function (e) { if (e.target === cm) closeCourseDetail(); });
    }
  }

  /* ============ 初始化 ============ */
  function init() {
    /* v1.7.4：按用户要求清空此前同步的课表记录（重新同步后按逐周数据还原） */
    try {
      if (store.get(K_EPOCH, '') !== EPOCH_NOW) {
        [K_LIST, K_SYNC, K_RAW, K_DONE, K_HIDE].forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
        store.set(K_EPOCH, EPOCH_NOW);
      }
    } catch (e) {}
    /* v1.8.12：把旧版的「已完成/已移除」节次标记迁移为永久关闭，
       避免升级后这些课又被当成未完成的日程生成出来 */
    try {
      var legacyDone = store.get(K_DONE, {}), legacyHide = store.get(K_HIDE, {});
      var legacyKeys = [];
      for (var a in legacyDone) if (legacyDone[a]) legacyKeys.push(a);
      for (var b in legacyHide) if (legacyHide[b]) legacyKeys.push(b);
      if (legacyKeys.length) {
        closeSessionKeys(legacyKeys);
        localStorage.removeItem(K_DONE);
        localStorage.removeItem(K_HIDE);
      }
    } catch (e) {}
    bind();
    loadSettingsUI();
    /* v1.8.12：把课表展开成独立日程 + 清理过期历史 */
    try { dropStaleSessions(); rollSessions(); } catch (e) {}
    /* 首次或数据变更后续排提醒 */
    if (getSettings().enabled && getList().length) {
      scheduleCourseNotifications();
    }
    /* v1.8.14：启动时先取回原生（后台 06:30 同步）的结果，再对账课程日程 */
    try {
      pullNativeState().then(function () {
        try { dropStaleSessions(); syncSessions(); } catch (e) {}
        try { if (typeof renderSchedule === 'function') renderSchedule(); } catch (e) {}
        try { renderCourseTable(true); } catch (e) {}
      });
    } catch (e) {
      try { dropStaleSessions(); syncSessions(); } catch (e2) {}
    }
    /* app.js 的启动流程早于本文件，这里补渲染一次课程区 */
    try { if (typeof renderSchedule === 'function') renderSchedule(); } catch (e) {}
  }

  /* ============ 周课表网格（v1.7.3，MyUSTC 式） ============ */
  var ctWeekOffset = 0;      /* 相对当前教学周的偏移 */
  var CT_ROW_H = 46;         /* 每小节行高 px */
  var ctBound = false;
  var CT_COLORS = ['#4C7DF0', '#00B386', '#F0806B', '#9A6BF0', '#E6A23C', '#31A9CE', '#D2699C', '#6B9F3C'];

  function ctPad2(n) { return n < 10 ? '0' + n : '' + n; }
  function ctParseDate(s) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(s || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function ctColorOf(name) {
    var h = 0;
    for (var i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return CT_COLORS[h % CT_COLORS.length];
  }
  function ctCurrentWeekNo() {
    var t = getTerm();
    var w1 = ctParseDate(t.week1Sunday);
    if (!w1) return 1;
    /* v1.8.3：与教务一致——教学周以「周日」起算（周日属下一周一~周六那一周），
       因此直接用「今天 − 第1周周日」除以 7，不能再换算成周一再算 */
    var now = new Date();
    var d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.floor((d0 - w1) / 604800000) + 1;
  }

  /* 某课程在第 N 周的上课日期（v1.8.10）
     与教务一致按周日起算：本周周日 + (weekday，周日为 0) 天
     例：周五的课，第 2 周 = 9/11，第 3 周 = 9/18 */
  function sessionDate(course, weekNo) {
    var t = getTerm();
    var w1 = ctParseDate(t.week1Sunday);
    if (!w1 || !course || !course.weekday) return null;
    var off = (course.weekday === 7 ? 0 : course.weekday);
    return new Date(w1.getFullYear(), w1.getMonth(), w1.getDate() + (weekNo - 1) * 7 + off);
  }
  function fmtYMD(d) {
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function showCourseBlockDetail(c, weekNo, dayKeyStr) {
    var mask = document.getElementById('courseMask');
    if (!mask || !c) return;
    var title = document.getElementById('cdTitle');
    var body = document.getElementById('cdBody');
    if (title) title.textContent = c.name || '课程详情';
    var ts = SLOT_START[c.startSlot - 1] || [0, 0];
    var te = SLOT_START[c.endSlot - 1] || ts;
    var endMin = te[0] * 60 + te[1] + 45;
    var weeksTxt = (c.weeks && c.weeks.length) ? (c.weeks[0] + '-' + c.weeks[c.weeks.length - 1] + ' 周') : '全部周';
    var wchar = ['', '一', '二', '三', '四', '五', '六', '日'];
    var term = getTerm();
    /* 格子里那一列的实际日期（可能是调课日），没有则退回按课程常规星期推算 */
    var dayDate = dayKeyStr ? ctParseDate(dayKeyStr) : sessionDate(c, weekNo);
    var mark = '';
    if (dayDate) {
      if (isHoliday(dayDate, term)) mark = '放假停课';
      else {
        var eff = effectiveWeekday(dayDate, term);
        if (eff !== isoWeekday(dayDate)) mark = '补周' + wchar[eff] + '课（调课）';
      }
    }
    if (body) {
      body.innerHTML = '<pre class="diag-pre">' + escapeHtml(
        '课程：' + (c.name || '') + '\n' +
        '日期：' + (dayDate ? fmtYMD(dayDate) + '（周' + wchar[isoWeekday(dayDate)] + '·第 ' + weekNo + ' 周' + (mark ? '·' + mark : '') + '）' : '—') + '\n' +
        '常规星期：周' + wchar[c.weekday] + '\n' +
        '节次：第 ' + c.startSlot + ' - ' + c.endSlot + ' 节\n' +
        '时间：' + ts[0] + ':' + ctPad2(ts[1]) + ' - ' + Math.floor(endMin / 60) + ':' + ctPad2(endMin % 60) + '\n' +
        '地点：' + (c.location || '—') + '\n' +
        '教师：' + (c.teacher || '—') + '\n' +
        '周次：' + weeksTxt + '（当前查看第 ' + weekNo + ' 周）') + '</pre>';
    }
    mask.hidden = false;
  }

  function renderCourseTable(reset) {
    if (reset) ctWeekOffset = 0;
    var grid = document.getElementById('ctGrid');
    if (!grid) return;

    /* 周次切换按钮（只绑一次） */
    if (!ctBound) {
      ctBound = true;
      var on = function (id, fn) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('click', function () { ctWeekOffset += fn(); renderCourseTable(); });
      };
      on('ctPrev', function () { return -1; });
      on('ctNext', function () { return 1; });
      var nowBtn = document.getElementById('ctNow');
      if (nowBtn) nowBtn.addEventListener('click', function () { renderCourseTable(true); });
      var syncBtn = document.getElementById('btnCtSync');
      if (syncBtn) syncBtn.addEventListener('click', function () { sync(); });
    }

    var term = getTerm();
    var list = getList();
    var tip = document.getElementById('ctEmptyTip');
    if (tip) tip.hidden = list.length > 0;
    var termLabel = document.getElementById('ctTermLabel');
    if (termLabel) termLabel.textContent = term.label || '—';

    var total = term.totalWeeks || 20;
    var cur = Math.min(Math.max(ctCurrentWeekNo(), 1), total);
    var view = Math.min(Math.max(cur + ctWeekOffset, 1), total);
    var lab = document.getElementById('ctWeekLabel');
    if (lab) lab.textContent = '第 ' + view + ' 周' + (view === cur ? ' · 本周' : '');

    var w1 = ctParseDate(term.week1Sunday) || new Date();
    /* v1.8.3：教务课表的一周是「周日 → 周六」，表格按周一…周日排列，
       其中「周日」列显示的是本周的周日（即周一的前一天），不是下个周日。
       例：第 4 周为 周日 09-20、周一 09-21 … 周六 09-26。 */
    var weekSun = new Date(w1.getFullYear(), w1.getMonth(), w1.getDate() + (view - 1) * 7);
    var mon = new Date(weekSun.getFullYear(), weekSun.getMonth(), weekSun.getDate() + 1);
    var now = new Date();
    var todayKey = now.getFullYear() + '-' + now.getMonth() + '-' + now.getDate();

    var dowNames = ['一', '二', '三', '四', '五', '六', '日'];
    var weekChar = ['', '一', '二', '三', '四', '五', '六', '日'];
    var html = '<div class="ct-timecol"><div class="ct-corner">' + (mon.getMonth() + 1) + '月</div>';
    for (var s = 1; s <= 13; s++) {
      var st = SLOT_START[s - 1];
      html += '<div class="ct-slot">' + s + '<small>' + st[0] + ':' + ctPad2(st[1]) + '</small></div>';
    }
    html += '</div><div class="ct-days">';
    for (var d = 1; d <= 7; d++) {
      /* 周一~周六 = 本周周日 + d 天；周日 = 本周周日当天 */
      var dayDate = new Date(weekSun.getFullYear(), weekSun.getMonth(), weekSun.getDate() + (d === 7 ? 0 : d));
      var dayKey = dateKey(dayDate);
      /* v1.8.15：课程表也要遵循官方调课与放假，才能和日程/提醒一致
         例：2026-09-20（周日）校庆补周五课；2026-09-25（周五）中秋放假 */
      var off = isHoliday(dayDate, term);
      var eff = effectiveWeekday(dayDate, term);
      var natural = isoWeekday(dayDate);
      var mark = '', markCls = '';
      if (off) { mark = '休'; markCls = 'ct-off'; }
      else if (eff !== natural) { mark = '补周' + weekChar[eff] + '课'; markCls = 'ct-mark'; }
      var isToday = (dayDate.getFullYear() + '-' + dayDate.getMonth() + '-' + dayDate.getDate()) === todayKey;
      html += '<div class="ct-day' + (isToday ? ' ct-today' : '') + (off ? ' ct-holiday' : '') + '">'
        + '<div class="ct-dayhead">' + dowNames[d - 1]
        + '<small>' + (dayDate.getMonth() + 1) + '/' + dayDate.getDate()
        + (mark ? '<span class="' + markCls + '"> · ' + mark + '</span>' : '')
        + '</small></div>'
        + '<div class="ct-daybody">';
      if (!off) {
        list.forEach(function (c, idx) {
          if (!c || c.weekday !== eff) return;   /* 按「调课后的实际星期」排课 */
          if (c.weeks && c.weeks.length && c.weeks.indexOf(view) < 0) return;
          var top = (c.startSlot - 1) * CT_ROW_H;
          var h = (c.endSlot - c.startSlot + 1) * CT_ROW_H - 3;
          html += '<div class="ct-block" style="top:' + top + 'px;height:' + h + 'px;background:' + ctColorOf(c.name) + '" data-idx="' + idx + '" data-day="' + dayKey + '">'
            + '<span class="ct-bname">' + escapeHtml(c.name) + '</span>'
            + (c.location ? '<span class="ct-broom">@' + escapeHtml(c.location) + '</span>' : '')
            + '</div>';
        });
      }
      html += '</div></div>';
    }
    html += '</div>';
    grid.innerHTML = html;

    var blocks = grid.querySelectorAll('.ct-block');
    Array.prototype.forEach.call(blocks, function (el) {
      el.addEventListener('click', function () {
        showCourseBlockDetail(list[+el.getAttribute('data-idx')], view, el.getAttribute('data-day'));
      });
    });
  }

  /* ============ 对外数据接口（v1.8.16：供 AI 助手读取课表等全部数据） ============ */
  function slotTimeText(ss, es) {
    var a = SLOT_START[ss - 1];
    if (!a) return '';
    var b = SLOT_START[es - 1] || a;
    var endMin = b[0] * 60 + b[1] + SLOT_MINUTES;
    return ctPad2(a[0]) + ':' + ctPad2(a[1]) + '-' + ctPad2(Math.floor(endMin / 60)) + ':' + ctPad2(endMin % 60);
  }
  function courseBrief(c) {
    return {
      name: c.name, teacher: c.teacher, location: c.location,
      weekday: c.weekday, weekdayText: WD_LABEL[c.weekday],
      startSlot: c.startSlot, endSlot: c.endSlot,
      time: slotTimeText(c.startSlot, c.endSlot),
      weeks: (c.weeks && c.weeks.length) ? c.weeks : '每周',
      weeksText: (c.weeks && c.weeks.length) ? (c.weeks[0] + '-' + c.weeks[c.weeks.length - 1] + ' 周') : '全周'
    };
  }
  /* 某天的实际安排：调课后的星期、是否放假、当天课程 */
  function dayPlan(dateObj, weekNo) {
    var term = getTerm();
    var off = isHoliday(dateObj, term);
    var eff = effectiveWeekday(dateObj, term);
    var nat = isoWeekday(dateObj);
    var weekChar = ['', '一', '二', '三', '四', '五', '六', '日'];
    var courses = getList().filter(function (c) {
      if (!c || c.weekday !== eff) return false;
      if (c.weeks && c.weeks.length && c.weeks.indexOf(weekNo) < 0) return false;
      return true;
    }).map(courseBrief);
    return {
      date: dateKey(dateObj),
      naturalWeekdayText: '周' + weekChar[nat],
      effectiveWeekdayText: '周' + weekChar[eff],
      holiday: off,
      mark: off ? '放假停课' : (eff !== nat ? '补周' + weekChar[eff] + '课（调课）' : ''),
      markShort: off ? '休' : (eff !== nat ? '补周' + weekChar[eff] + '课' : ''),
      courses: off ? [] : courses
    };
  }
  function getTermInfo() {
    var t = getTerm();
    var now = new Date();
    var weekChar = ['', '一', '二', '三', '四', '五', '六', '日'];
    return {
      label: t.label || '2026-2027学年 秋季学期',
      week1Sunday: t.week1Sunday,
      totalWeeks: t.totalWeeks || 20,
      currentWeek: Math.min(Math.max(ctCurrentWeekNo(), 1), t.totalWeeks || 20),
      today: dateKey(now),
      todayNaturalWeekday: '周' + weekChar[isoWeekday(now)],
      todayEffectiveWeekday: '周' + weekChar[effectiveWeekday(now, t)],
      todayIsHoliday: isHoliday(now, t),
      todayIsAdjusted: effectiveWeekday(now, t) !== isoWeekday(now),
      overrides: t.overrides || {},
      holidays: t.holidays || []
    };
  }
  function getWeekPlan(weekNo) {
    var term = getTerm();
    var total = term.totalWeeks || 20;
    var wk = Math.min(Math.max(parseInt(weekNo, 10) || ctCurrentWeekNo(), 1), total);
    var w1 = ctParseDate(term.week1Sunday);
    if (!w1) return { ok: false, error: '校历缺少第 1 周周日' };
    /* 与课表网格一致：列为 周一…周日，其中「周日」= 本周周日（周一的前一天） */
    var weekSun = new Date(w1.getFullYear(), w1.getMonth(), w1.getDate() + (wk - 1) * 7);
    var days = [];
    for (var d = 1; d <= 7; d++) {
      var dayDate = new Date(weekSun.getFullYear(), weekSun.getMonth(), weekSun.getDate() + (d === 7 ? 0 : d));
      days.push(dayPlan(dayDate, wk));
    }
    return { ok: true, week: wk, isCurrentWeek: wk === Math.min(Math.max(ctCurrentWeekNo(), 1), total), days: days };
  }
  /* 已展开成日程的课程节次（可由 AI 读取/操作，它们是 todos 里的独立条目） */
  function getCourseSessions(days) {
    var n = Math.min(Math.max(parseInt(days, 10) || 4, 1), 30);
    var base = startOfDay(new Date());
    var end = base + n * 86400000;
    var out = [];
    try {
      store.get('todos', []).forEach(function (t) {
        if (!t || !t.courseKey || !t.due) return;
        if (t.due < base || t.due >= end) return;
        out.push({
          id: t.id, title: t.title, detail: t.detail,
          date: dateKey(new Date(t.due)),
          time: fmtHM(t.due) + '-' + fmtHM(t.endTs || (t.due + SLOT_MINUTES * 60000)),
          weekNo: t.weekNo, done: !!t.done, courseKey: t.courseKey
        });
      });
    } catch (e) {}
    out.sort(function (a, b) { return (a.date + a.time) < (b.date + b.time) ? -1 : 1; });
    return { ok: true, from: dateKey(new Date(base)), days: n, count: out.length, sessions: out };
  }
  function getSyncStatus() {
    var at = getSyncAt();
    return {
      hasTimetable: getList().length > 0,
      courseCount: getList().length,
      lastSyncAt: at ? new Date(at).toISOString() : null,
      lastSyncText: at ? fmtDate(at) : '尚未同步',
      lastSyncUrl: store.get(K_URL, '') || null,
      settings: getSettings()
    };
  }

  /* ============ 对外接口（供 app.js 调用） ============ */
  global.CourseSync = {
    init: init,
    sync: sync,
    getSettings: getSettings,
    getList: getList,
    /* v1.8.16：AI 助手用的全量数据接口 */
    getTermInfo: getTermInfo,
    getTimetable: function () { return getList().map(courseBrief); },
    getWeekPlan: getWeekPlan,
    getCourseSessions: getCourseSessions,
    getSyncStatus: getSyncStatus,
    rollSessions: rollSessions,              /* v1.8.12：把课表展开成独立日程（含 v1.8.14 对账） */
    syncSessions: syncSessions,              /* v1.8.14：课表变动后对账（更新/删除/补建） */
    pullNativeState: pullNativeState,        /* v1.8.14：采纳原生后台同步结果 */
    dropStaleSessions: dropStaleSessions,
    closeSessionKeys: closeSessionKeys,      /* 清理/删除后永久关闭这些节次 */
    sessionKeyOf: function (t) { return (t && t.courseKey) || null; },
    closeCourseDetail: closeCourseDetail,
    cancelAllCourseNotifications: cancelAllCourseNotifications,
    scheduleCourseNotifications: scheduleCourseNotifications,
    renderScheduleHeader: renderScheduleHeader,
    loadSettingsUI: loadSettingsUI,
    renderCourseTable: renderCourseTable,
    /* 清空所有数据时调用（设置页「清空所有数据」） */
    purge: function () {
      cancelAllCourseNotifications(); /* 空课表 → 原生取消全部课程提醒 */
      [K_LIST, K_TERM, K_SYNC, K_SET, K_URL, K_RAW, K_DEBUG, K_DONE, K_HIDE, K_CLOSED].forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
      var p = coursePlugin();
      if (p && p.clearLogin) { try { p.clearLogin().catch(function () {}); } catch (e) {} }
    }
  };

  /* 自启动：本文件以 defer 加载，DOM 与 app.js 均已就绪 */
  try { init(); } catch (e) { console.error('课表模块初始化失败', e); }
})(window);
