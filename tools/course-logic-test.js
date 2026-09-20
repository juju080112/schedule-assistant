/* 逻辑测试台：在 Node 里加载真实的 www/js/course.js（桩化 DOM/插件），验证课表与校历算法
   运行：node tools/course-logic-test.js   （可用 APP_DIR 环境变量指定工程目录） */
const fs = require('fs');
const path = require('path');

const APP = process.env.APP_DIR || path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(APP, 'www/js/course.js'), 'utf8');

/* ---- 最小环境桩 ---- */
const mem = {};
const localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; }
};
/* app.js 提供的全局 store（JSON 包装） */
global.store = {
  get(key, def) {
    const raw = localStorage.getItem(key);
    if (raw == null) return def;
    try { return JSON.parse(raw); } catch (e) { return def; }
  },
  set(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
};
const noop = () => {};
const fakeEl = () => ({
  textContent: '', innerHTML: '', hidden: false, value: '',
  addEventListener: noop, removeEventListener: noop,
  querySelector: () => null, querySelectorAll: () => [],
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  setAttribute: noop, getAttribute: () => null, appendChild: noop, closest: () => null,
  style: {}, dataset: {}
});
global.window = global;
global.localStorage = localStorage;
global.document = {
  getElementById: fakeEl, querySelector: () => null, querySelectorAll: () => [],
  createElement: fakeEl, addEventListener: noop, hidden: false
};
global.escapeHtml = (s) => String(s == null ? '' : s);
global.toast = noop;
global.renderSchedule = noop;
global.refreshTodayBar = noop;
global.fmtDate = (ts) => {
  const d = new Date(ts), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
global.fmtHM = (ts) => {
  const d = new Date(ts), p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
};
global.console = console;

/* 用沙箱执行真实代码 */
const vm = require('vm');
vm.runInThisContext(code, { filename: 'course.js' });
const CS = global.CourseSync;
if (!CS) { console.log('✘ CourseSync 未导出'); process.exit(1); }

/* ---- 准备一份测试课表 ----
   周五课：大学生心理学 8-10 节（1-20 周）
   周日课：周日实验 1-2 节（1-20 周）—— 用来验证调课/假期
   周三课：单周课 3-4 节（1,3,5,7 周） */
const timetable = [
  { name: '大学生心理学', teacher: '张老师', location: '1102', weekday: 5, startSlot: 8, endSlot: 10, weeks: Array.from({ length: 20 }, (_, i) => i + 1), raw: '' },
  { name: '周日实验', teacher: '李老师', location: '实验楼', weekday: 7, startSlot: 1, endSlot: 2, weeks: Array.from({ length: 20 }, (_, i) => i + 1), raw: '' },
  { name: '单周课', teacher: '王老师', location: '305', weekday: 3, startSlot: 3, endSlot: 4, weeks: [1, 3, 5, 7], raw: '' }
];
mem['courseList'] = JSON.stringify(timetable);
mem['courseSyncAt'] = String(Date.now());

const results = [];
const check = (name, cond, detail) => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? '✔' : '✘'} ${name}${detail ? '  → ' + detail : ''}`);
};

/* ===== 1. 校历信息 ===== */
const ti = CS.getTermInfo();
check('当前教学周 = 4', ti.currentWeek === 4, `实际 ${ti.currentWeek}`);
check('今天(9/20)按周五课表上课', ti.todayEffectiveWeekday === '周五', `实际 ${ti.todayEffectiveWeekday}`);
check('今天被识别为调课日', ti.todayIsAdjusted === true, `isAdjusted=${ti.todayIsAdjusted}`);
check('9/25(中秋) 在放假日历中', (ti.holidays || []).includes('2026-09-25'));
check('9/20 调课规则存在', (ti.overrides || {})['2026-09-20'] === 5);

/* ===== 2. 第 4 周逐日安排 ===== */
const wp = CS.getWeekPlan(4);
const byDate = {};
(wp.days || []).forEach((d) => { byDate[d.date] = d; });
const d0920 = byDate['2026-09-20'];
const d0925 = byDate['2026-09-25'];
check('第4周计划返回 7 天', (wp.days || []).length === 7);
check('9/20 标记为调课', d0920 && /调课/.test(d0920.mark || ''), d0920 ? d0920.mark : '缺失');
check('9/20 显示的是周五课（大学生心理学）',
  d0920 && d0920.courses.some((c) => c.name === '大学生心理学'),
  d0920 ? d0920.courses.map((c) => c.name).join(',') : '缺失');
check('9/20 不显示周日课（周日实验）',
  d0920 && !d0920.courses.some((c) => c.name === '周日实验'),
  d0920 ? d0920.courses.map((c) => c.name).join(',') : '缺失');
check('9/25 中秋放假且无课', d0925 && d0925.holiday === true && d0925.courses.length === 0,
  d0925 ? `holiday=${d0925.holiday} courses=${d0925.courses.length}` : '缺失');
check('9/24(周四) 正常无课', byDate['2026-09-24'] && byDate['2026-09-24'].courses.length === 0);

/* ===== 3. 展开成课程日程（今天起 4 天）===== */
CS.rollSessions();
const sess = CS.getCourseSessions(4);
const todaySess = (sess.sessions || []).filter((s) => s.date === '2026-09-20');
check('今天生成了课程日程', todaySess.length > 0, `数量 ${todaySess.length}`);
check('今天的日程是周五课（大学生心理学）',
  todaySess.some((s) => s.title.includes('大学生心理学')),
  todaySess.map((s) => s.title).join(' | '));
check('今天的日程不含周日课', !todaySess.some((s) => s.title.includes('周日实验')),
  todaySess.map((s) => s.title).join(' | '));
check('大学生心理学时间 15:55-18:20',
  todaySess.some((s) => s.title.includes('大学生心理学') && s.time === '15:55-18:20'),
  todaySess.filter((s) => s.title.includes('大学生心理学')).map((s) => s.time).join(','));

/* ===== 4. 周日课应在正常周日出现（9/13 第3周），且假期(9/27、10/4)不排 ===== */
const plan3 = CS.getWeekPlan(3);
const p3sun = plan3.days.find((d) => d.date === '2026-09-13');
check('第3周周日(9/13) 有周日实验',
  p3sun && p3sun.courses.some((c) => c.name === '周日实验'),
  p3sun ? p3sun.courses.map((c) => c.name).join(',') : '缺失');
const plan5 = CS.getWeekPlan(5);
const p5sun = plan5.days.find((d) => d.date === '2026-09-27');
check('9/27 在中秋假期内且无课', p5sun && p5sun.holiday && p5sun.courses.length === 0,
  p5sun ? `holiday=${p5sun.holiday} courses=${p5sun.courses.length}` : '缺失');
const plan6 = CS.getWeekPlan(6);
const p6sun = plan6.days.find((d) => d.date === '2026-10-04');
check('10/4 在国庆假期内且无课', p6sun && p6sun.holiday && p6sun.courses.length === 0,
  p6sun ? `holiday=${p6sun.holiday} courses=${p6sun.courses.length}` : '缺失');
/* 10/10(周六) 属于第 6 周（周日 10/4 ~ 周六 10/10），补周二课 */
const p6sat = plan6.days.find((d) => d.date === '2026-10-10');
check('10/10 补周二课（标记正确）', p6sat && /补周二课/.test(p6sat.mark || ''),
  p6sat ? `mark=${p6sat.mark} courses=${p6sat.courses.map((c) => c.name).join(',') || '无'}` : '缺失');
const plan7 = CS.getWeekPlan(7);
const p7sun = plan7.days.find((d) => d.date === '2026-10-11');
check('10/11 周日恢复正常上课', p7sun && !p7sun.holiday && p7sun.courses.some((c) => c.name === '周日实验'),
  p7sun ? `holiday=${p7sun.holiday} courses=${p7sun.courses.map((c) => c.name).join(',')}` : '缺失');
const p4mon = CS.getWeekPlan(4).days.find((d) => d.date === '2026-09-21');
check('9/21(周一) 正常日无调课标记', p4mon && !p4mon.mark && !p4mon.holiday, p4mon ? `mark=${p4mon.mark || '(空)'}` : '缺失');

/* ===== 5. 单双周 ===== */
const plan1 = CS.getWeekPlan(1);
const w1wed = plan1.days.find((d) => d.date === '2026-09-02');
const plan2 = CS.getWeekPlan(2);
const w2wed = plan2.days.find((d) => d.date === '2026-09-09');
check('第1周周三有「单周课」', w1wed && w1wed.courses.some((c) => c.name === '单周课'));
check('第2周周三无「单周课」', w2wed && !w2wed.courses.some((c) => c.name === '单周课'));

/* ===== 6. 幂等 / 完成 / 关闭 流程（对应之前报过的「复活」类问题）===== */
const countBefore = CS.getCourseSessions(4).count;
CS.rollSessions(); CS.rollSessions();
check('重复展开不会产生重复日程', CS.getCourseSessions(4).count === countBefore,
  `${countBefore} → ${CS.getCourseSessions(4).count}`);

/* 把今天那条课程日程标记完成 → 再次展开后必须仍是已完成，不能被重建为未完成 */
const todos = JSON.parse(mem['todos']);
const todayItem = todos.find((t) => t.courseKey && t.date === undefined && String(t.courseKey).includes('2026-09-20'));
const target = todayItem || todos.find((t) => t.courseKey && String(t.courseKey).includes('2026-09-20'));
check('找得到今天的课程日程条目', !!target, target ? target.title : '未找到');
if (target) {
  target.done = true; target.doneAt = Date.now();
  localStorage.setItem('todos', JSON.stringify(todos));
  CS.rollSessions();
  const after = CS.getCourseSessions(4).sessions.find((s) => s.courseKey === target.courseKey);
  check('完成状态在重新展开后保持', after && after.done === true, after ? `done=${after.done}` : '条目丢失');
}
/* 删除（永久关闭）后不得再生成 */
if (target) {
  CS.closeSessionKeys([target.courseKey]);
  const kept = JSON.parse(mem['todos']).filter((t) => t.courseKey !== target.courseKey);
  localStorage.setItem('todos', JSON.stringify(kept));
  CS.rollSessions();
  const back = CS.getCourseSessions(4).sessions.find((s) => s.courseKey === target.courseKey);
  check('关闭后不再重新生成（不复活）', !back, back ? '又出现了' : '未复活');
}

/* ===== 7. 课表为空时的健壮性 ===== */
localStorage.setItem('courseList', JSON.stringify([]));
CS.rollSessions();
check('空课表不报错且不生成日程', CS.getCourseSessions(4).count === 0);
check('空课表时 get_week_plan 仍返回结构', (CS.getWeekPlan(3).days || []).length === 7);

/* ===== 8. courseKey 格式契约（AI 工具 courseSessionAction 依赖 name|date|slot）===== */
localStorage.setItem('courseList', JSON.stringify(timetable));
localStorage.removeItem('courseClosedMap');   /* 清掉前面测试造成的关闭记录，恢复可展开状态 */
localStorage.setItem('todos', JSON.stringify([]));
CS.rollSessions();
const sess2 = CS.getCourseSessions(4).sessions;
const keysOk = sess2.length > 0 && sess2.every((s) => {
  const parts = String(s.courseKey).split('|');
  return parts.length === 3 && /^\d{4}-\d{2}-\d{2}$/.test(parts[1]) && /^\d+$/.test(parts[2]) && parts[0].length > 0;
});
check('courseKey 格式为 课程名|YYYY-MM-DD|节次', keysOk, sess2.map((s) => s.courseKey).join(' ; '));
const todayKeys = sess2.filter((s) => s.date === '2026-09-20').map((s) => s.courseKey);
check('今天的 courseKey 日期段为 2026-09-20', todayKeys.every((k) => k.split('|')[1] === '2026-09-20'), todayKeys.join(' ; '));

console.log('\n=== 汇总 ===');
const failed = results.filter((r) => !r.pass);
console.log(`通过 ${results.length - failed.length}/${results.length}`);
if (failed.length) { console.log('失败项:'); failed.forEach((f) => console.log(' - ' + f.name + '  ' + (f.detail || ''))); process.exitCode = 1; }
