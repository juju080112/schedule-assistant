/* 解析结果清洗测试（Node，无网络）
   运行：node tools/todo-utils-test.js */
const assert = require('assert');
const U = require('../www/js/todo-utils.js');

let total = 0;
const failures = [];
function check(name, fn) {
  total++;
  try { fn(); console.log('✔ ' + name); }
  catch (e) { failures.push(name + ' — ' + e.message); console.log('✘ ' + name + '  → ' + e.message); }
}

check('同标题同日期合并，详情取并集', () => {
  const out = U.dedupeParsed([
    { title: '开会', detail: 'A', due: '2026-10-28 16:00', remind: false },
    { title: '开 会', detail: 'B', due: '2026-10-28 16:00', remind: true }
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].detail, 'A；B');
  assert.strictEqual(out[0].remind, true);
});

check('同标题不同日期不合并', () => {
  const out = U.dedupeParsed([
    { title: '开会', due: '2026-10-28 16:00' },
    { title: '开会', due: '2026-10-29 16:00' }
  ]);
  assert.strictEqual(out.length, 2);
});

check('无日期同标题合并', () => {
  const out = U.dedupeParsed([
    { title: '买牛奶' },
    { title: '买牛奶', detail: '两盒' }
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].detail, '两盒');
});

check('日期解析与过期判断', () => {
  const ts = U.parseDueTs('2026-10-28 16:00');
  assert(ts);
  assert.strictEqual(U.isPastDue({ due: '2026-10-27 16:00' }, ts), true);
  assert.strictEqual(U.isPastDue({ due: '2026-10-29 16:00' }, ts), false);
  assert.strictEqual(U.isPastDue({ due: null }, ts), false);
});

check('无标题项被丢弃', () => {
  const out = U.dedupeParsed([{ title: '' }, null, { title: '有效' }]);
  assert.strictEqual(out.length, 1);
});

console.log('\n=== 汇总 ===');
console.log('通过 ' + (total - failures.length) + '/' + total);
if (failures.length) {
  failures.forEach((f) => console.log(' - ' + f));
  process.exitCode = 1;
}
