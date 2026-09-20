/* 日程助手 - 核心逻辑 */
'use strict';

const $ = (id) => document.getElementById(id);

/* 屏幕错误提示：任何脚本错误直接显示在界面上，便于排查 */
window.addEventListener('error', function (e) {
  try {
    var t = document.getElementById('toast');
    if (t) {
      t.textContent = '脚本错误：' + (e.message || '未知错误');
      t.hidden = false;
      clearTimeout(t._timer);
      t._timer = setTimeout(function () { t.hidden = true; }, 8000);
    }
  } catch (x) {}
});

/* ============ 主题模式（v1.8.0：浅色 / 深色 / 跟随系统） ============ */
const THEME_KEY = 'themeMode';
function getThemeMode() {
  const m = store.get(THEME_KEY, 'system');
  return (m === 'light' || m === 'dark') ? m : 'system';
}
function systemPrefersDark() {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); } catch (e) { return false; }
}
function applyTheme(mode) {
  const dark = mode === 'dark' || (mode === 'system' && systemPrefersDark());
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  /* 原生：状态栏/导航栏底色与图标明暗、WebView 底色同步 */
  try {
    const bp = barServicePlugin();
    if (bp && bp.setTheme) bp.setTheme({ dark: dark }).catch(() => {});
  } catch (e) {}
  /* 同步常驻栏卡片配色 */
  try { if (typeof refreshTodayBar === 'function') refreshTodayBar(); } catch (e) {}
  updateThemeUI(mode);
}
function updateThemeUI(mode) {
  const seg = document.getElementById('themeSeg');
  if (!seg) return;
  seg.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
}
function setThemeMode(mode) {
  if (mode !== 'light' && mode !== 'dark' && mode !== 'system') mode = 'system';
  store.set(THEME_KEY, mode);
  applyTheme(mode);
}
(function bindThemeSeg() {
  const seg = document.getElementById('themeSeg');
  if (seg) {
    seg.querySelectorAll('.seg-btn').forEach((b) => {
      b.addEventListener('click', () => setThemeMode(b.dataset.mode));
    });
  }
  /* 系统主题变化：跟随系统时实时切换 */
  try {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq && mq.addEventListener) mq.addEventListener('change', () => { if (getThemeMode() === 'system') applyTheme('system'); });
    else if (mq && mq.addListener) mq.addListener(() => { if (getThemeMode() === 'system') applyTheme('system'); });
  } catch (e) {}
})();

/* 通知插件延迟加载：优先用正式打包的插件（window.__cap），兼容桥接层 registerPlugin */
var _lnPlugin = null;
function LN() {
  if (_lnPlugin) return _lnPlugin;
  try {
    if (window.__cap && window.__cap.LocalNotifications) {
      _lnPlugin = window.__cap.LocalNotifications;
      return _lnPlugin;
    }
    if (window.Capacitor && typeof window.Capacitor.registerPlugin === 'function') {
      _lnPlugin = window.Capacitor.registerPlugin('LocalNotifications');
    }
  } catch (e) {}
  return _lnPlugin;
}

/* ============ 存储 ============ */
const store = {
  get(key, def) {
    try { const v = localStorage.getItem(key); return v === null ? def : JSON.parse(v); }
    catch (e) { return def; }
  },
  set(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
};

function getSettings() {
  return Object.assign(
    { apiKey: '', textModel: 'glm-4-flash', visionModel: 'glm-4v-flash', todayBarEnabled: true },
    store.get('settings', {})
  );
}
function getTodos() { return store.get('todos', []); }
/* v1.8.8：记录完成时间，用于「完成满 1 天后自动清理原始来源」 */
function setDone(t, done) {
  t.done = !!done;
  t.doneAt = t.done ? Date.now() : null;
}
/* 清理：已完成超过 24 小时的日程，其原始来源（文字/图片/文件）自动删除，避免越占越多。
   未完成则一直保留；误点完成后 24 小时内取消完成，来源仍在。 */
function purgeOldSources() {
  const list = getTodos();
  const DAY = 86400000;
  const now = Date.now();
  let changed = false;
  list.forEach((t) => {
    if (!t || !t.done || !t.srcs || !t.srcs.length) return;
    if (!t.doneAt) { t.doneAt = now; changed = true; return; } /* 旧数据补记完成时间 */
    if (now - t.doneAt > DAY) { delete t.srcs; changed = true; }
  });
  if (changed) { try { store.set('todos', list); } catch (e) {} }
}
function saveTodos(list) {
  try { store.set('todos', list); }
  catch (e) { toast('本地存储空间不足，原始来源可能未完整保存'); }
  refreshTodayBar();
}

/* ============ 工具 ============ */
function toast(msg, ms = 2200) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, ms);
}
function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function parseDue(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ]+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], m[4] !== undefined ? +m[4] : 9, m[5] !== undefined ? +m[5] : 0);
  return isNaN(d.getTime()) ? null : d.getTime();
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ============ 标签页切换 ============ */
/* ============ 标签页切换（v1.6.0：标签切换不进历史栈，返回键由 App 插件接管） ============ */
function showPage(id) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.page === id));
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === id));
  /* v1.7.9：切页回到顶部 */
  try { window.scrollTo(0, 0); } catch (e) {}
  if (id === 'page-schedule') renderSchedule();
  if (id === 'page-coursetable' && window.CourseSync && window.CourseSync.renderCourseTable) window.CourseSync.renderCourseTable();
  if (id === 'page-settings') loadSettingsUI();
  if (id === 'page-chat') renderChat();
}
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => showPage(tab.dataset.page));
});

/* ============ 附件处理 ============ */
let attachments = []; // {type:'image'|'text', name, dataUrl?, text?}

function renderAttachments() {
  const box = $('attachList');
  box.innerHTML = '';
  attachments.forEach((a, i) => {
    const div = document.createElement('div');
    div.className = 'attach-item';
    const label = a.type === 'image' ? `图片：${a.name}` : `文件：${a.name}`;
    div.innerHTML = `<div class="left">${a.type === 'image' ? `<img src="${a.dataUrl}">` : '📄 '}<span class="name">${escapeHtml(label)}</span></div>`;
    const rm = document.createElement('button');
    rm.className = 'rm'; rm.textContent = '✕';
    rm.onclick = () => { attachments.splice(i, 1); renderAttachments(); };
    div.appendChild(rm);
    box.appendChild(div);
  });
}

async function compressImage(file) {
  const dataUrl = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result); r.onerror = rej;
    r.readAsDataURL(file);
  });
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1280;
      let { width: w, height: h } = img;
      if (Math.max(w, h) > MAX) {
        const k = MAX / Math.max(w, h);
        w = Math.round(w * k); h = Math.round(h * k);
      }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      res(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => res(dataUrl);
    img.src = dataUrl;
  });
}

async function extractFileText(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) {
    const buf = await file.arrayBuffer();
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const parts = [];
    const maxPages = Math.min(pdf.numPages, 30);
    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      parts.push(tc.items.map((it) => it.str).join(' '));
    }
    return parts.join('\n');
  }
  if (name.endsWith('.docx')) {
    const buf = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buf });
    return result.value;
  }
  // txt / md / csv / json
  return await file.text();
}

$('btnPickImage').onclick = () => $('fileImage').click();
$('btnPickFile').onclick = () => $('fileDoc').click();

$('fileImage').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    toast('正在处理图片…');
    const dataUrl = await compressImage(file);
    attachments.push({ type: 'image', name: file.name, dataUrl });
    renderAttachments();
  } catch (err) { toast('图片处理失败：' + err.message); }
  e.target.value = '';
});

$('fileDoc').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    toast('正在提取文件内容…');
    let text = await extractFileText(file);
    if (!text || !text.trim()) { toast('未能从该文件提取到文字'); e.target.value = ''; return; }
    if (text.length > 12000) text = text.slice(0, 12000) + '\n…(内容过长已截断)';
    attachments.push({ type: 'text', name: file.name, text });
    renderAttachments();
  } catch (err) { toast('文件解析失败：' + err.message); }
  e.target.value = '';
});

/* ============ GLM API 调用 ============ */
const GLM_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

async function callGLM(model, messages) {
  const settings = getSettings();
  if (!settings.apiKey) throw new Error('尚未配置 API Key，请先到「设置」页填写');
  const resp = await fetch(GLM_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + settings.apiKey
    },
    body: JSON.stringify({ model, messages, temperature: 0.3 })
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = (data && data.error && data.error.message) || `HTTP ${resp.status}`;
    throw new Error(msg);
  }
  return data.choices[0].message.content;
}

const SYSTEM_PROMPT = `你是一个待办事项与日程提取助手。用户会给你一段文字（可能来自聊天记录、会议纪要、邮件、文件内容或图片识别结果）。
请从中提取所有待办事项和日程安排，只输出一个 JSON 对象，不要输出任何其他文字或 markdown 代码块标记。格式：
{"todos":[{"title":"简短的待办标题","detail":"补充说明，可为空字符串","due":"截止时间 YYYY-MM-DD HH:mm 或 null","remind":true或false}]}
规则：
1. title 用简洁的中文祈使句，不超过30字
2. 有明确时间的事项填 due（24小时制）；只有日期没有具体时间时，默认填当天 09:00
3. "当前时间"由用户提供，相对时间（明天/周五/下周）据此换算成具体日期
4. remind：有明确时间、值得到点提醒的事项为 true；纯任务清单类为 false
5. 没有截止时间的待办 due 填 null，remind 填 false
6. 如果内容中没有任何待办或日程，返回 {"todos":[]}`;

function buildUserContent(text) {
  const now = new Date();
  const week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
  const head = `当前时间：${fmtDate(now.getTime())} 星期${week}\n\n`;
  return head + text;
}

let lastParsed = null;

$('btnParse').onclick = async () => {
  const text = $('inputText').value.trim();
  const hasImage = attachments.some((a) => a.type === 'image');
  const fileTexts = attachments.filter((a) => a.type === 'text').map((a) => `【文件：${a.name}】\n${a.text}`).join('\n\n');
  if (!text && !hasImage && !fileTexts) { toast('请先输入文字，或添加图片/文件'); return; }

  const settings = getSettings();
  if (!settings.apiKey) { toast('请先到「设置」页填写 API Key'); return; }

  const btn = $('btnParse');
  btn.disabled = true;
  const status = $('parseStatus');
  status.className = 'status';
  status.innerHTML = '<span class="spinner"></span>AI 正在解析，请稍候…';
  $('parseResult').hidden = true;

  try {
    let raw;
    if (hasImage) {
      // 视觉模型：图片 + 文字
      const content = [];
      for (const a of attachments.filter((x) => x.type === 'image')) {
        content.push({ type: 'image_url', image_url: { url: a.dataUrl } });
      }
      const userText = buildUserContent(
        (text ? `用户输入：${text}\n` : '') +
        (fileTexts ? fileTexts + '\n' : '') +
        '以上是图片内容，请识别图片中的文字信息（如会议白板、聊天截图、通知单等），结合用户输入提取待办和日程。'
      );
      content.push({ type: 'text', text: userText });
      raw = await callGLM(settings.visionModel, [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content }
      ]);
    } else {
      const userText = buildUserContent(
        (text ? text : '') + (fileTexts ? '\n\n' + fileTexts : '')
      );
      raw = await callGLM(settings.textModel, [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userText }
      ]);
    }

    const parsed = parseModelJson(raw);
    lastParsed = parsed;
    renderParseResult(parsed);
    status.textContent = '';
  } catch (err) {
    status.className = 'status error';
    status.textContent = '解析失败：' + err.message;
  } finally {
    btn.disabled = false;
  }
};

function parseModelJson(raw) {
  let s = String(raw).trim();
  s = s.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  const obj = JSON.parse(s);
  if (!Array.isArray(obj.todos)) throw new Error('AI 返回格式异常');
  return obj.todos.filter((t) => t && t.title);
}

function renderParseResult(todos) {
  const box = $('resultTodos');
  box.innerHTML = '';
  if (!todos.length) {
    box.innerHTML = '<div class="result-item">未从中识别出待办或日程事项，换种方式描述试试？</div>';
    $('parseResult').hidden = false;
    return;
  }
  todos.forEach((t, idx) => {
    const div = document.createElement('div');
    div.className = 'result-item';
    const due = parseDue(t.due);
    const isSched = due && t.remind;
    div.innerHTML = `
      <span class="tag ${isSched ? 'sched' : ''}">${isSched ? '日程' : '待安排'}</span>
      <span>${escapeHtml(t.title)}${t.detail ? `<span class="due">${escapeHtml(t.detail)}</span>` : ''}${due ? `<span class="due">⏰ ${fmtDate(due)}</span>` : ''}</span>
      <button class="rm-item" title="移除这条">✕</button>`;
    div.querySelector('.rm-item').onclick = () => {
      lastParsed.splice(idx, 1);
      renderParseResult(lastParsed);
    };
    box.appendChild(div);
  });
  $('parseResult').hidden = false;
}

$('btnDiscardResult').onclick = () => {
  lastParsed = null;
  $('parseResult').hidden = true;
};

/* ============ 重复事项识别与合并（v1.7.5） ============ */
/* 标题归一化：忽略大小写、空白与中英文标点，用于判断两次通知是否同一活动 */
function normTitle(s) {
  try {
    return String(s || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  } catch (e) {
    return String(s || '').toLowerCase().replace(/[\s,.;:!?"'“”‘’()（）【】\[\]{}<>《》、，。；：！？·\-—_～~]/g, '');
  }
}
/* 把新识别到的事项并入已有事项：详情取两次的并集（按行去重），时间以新通知为准 */
async function mergeTodoInto(existing, incoming) {
  const lines = [];
  const push = (s) => {
    String(s || '').split(/\n+/).forEach((x) => {
      x = x.trim();
      if (x && lines.indexOf(x) < 0) lines.push(x);
    });
  };
  push(existing.detail);
  push(incoming.detail);
  existing.detail = lines.join('\n');
  if (incoming.remind && incoming.due) {
    await cancelNotification(existing);
    existing.due = incoming.due;
    existing.remind = true;
    existing.notifyId = await scheduleNotification(existing);
  } else if (!existing.due && incoming.due) {
    existing.due = incoming.due;
    existing.remind = false;
    existing.notifyId = null;
  }
  existing.done = false; // 收到新通知说明事项仍然有效
  existing.doneAt = null; /* v1.8.8：恢复未完成 → 原始来源不再倒计时清理 */
  /* v1.8.7：原始来源一起合并（同一活动两次通知的原文件都保留） */
  if (incoming.srcs && incoming.srcs.length) existing.srcs = mergeSrcs(existing.srcs, incoming.srcs);
  return existing;
}

/* ============ 原始来源（v1.8.7） ============ */
/* 收集本次解析用到的原始输入：粘贴的文字、上传的图片、文件抽取出的文本 */
function collectParseSources() {
  const out = [];
  try {
    const txt = ($('inputText') && $('inputText').value || '').trim();
    if (txt) out.push({ kind: 'text', name: '粘贴的文字', text: txt.slice(0, 20000) });
    const imgs = attachments.filter((a) => a.type === 'image');
    imgs.slice(0, 4).forEach((a) => {
      const d = String(a.dataUrl || '');
      if (d && d.length <= 700000) out.push({ kind: 'image', name: a.name || '图片', dataUrl: d });
      else out.push({ kind: 'image', name: a.name || '图片', tooLarge: true });
    });
    attachments.filter((a) => a.type === 'text').slice(0, 4).forEach((a) => {
      out.push({ kind: 'file', name: a.name || '文件', text: String(a.text || '').slice(0, 20000) });
    });
  } catch (e) {}
  return out;
}
/* 合并两组来源，按 类型+名称+内容摘要 去重 */
function mergeSrcs(a, b) {
  const list = Array.isArray(a) ? a.slice() : [];
  (b || []).forEach((s) => {
    const key = (x) => [x.kind, x.name, String(x.text || x.dataUrl || '').slice(0, 120)].join('|');
    if (!list.some((x) => key(x) === key(s))) list.push(s);
  });
  return list.slice(-8); /* 最多留 8 份，避免占满本地存储 */
}

$('btnSaveResult').onclick = async () => {
  if (!lastParsed || !lastParsed.length) { toast('没有可保存的事项'); return; }
  const srcs = collectParseSources();
  const todos = getTodos();
  let schedCount = 0;
  let mergedCount = 0;
  for (const t of lastParsed) {
    const due = parseDue(t.due);
    const incoming = {
      title: String(t.title),
      detail: String(t.detail || ''),
      due: due || null,
      remind: !!(due && t.remind),
      srcs: srcs
    };
    const nt = normTitle(incoming.title);
    const dup = nt ? (todos.find((x) => !x.done && normTitle(x.title) === nt)
      || todos.find((x) => normTitle(x.title) === nt)) : null;
    if (dup) {
      /* 同一活动：合并为一条，详情=两次结合，时间以新通知为准 */
      await mergeTodoInto(dup, incoming);
      if (dup.remind) schedCount++;
      mergedCount++;
    } else {
      const item = {
        id: Date.now() + Math.floor(Math.random() * 10000),
        title: incoming.title,
        detail: incoming.detail,
        done: false,
        createdAt: Date.now(),
        due: incoming.remind ? incoming.due : null,
        remind: incoming.remind,
        notifyId: null,
        srcs: srcs.length ? srcs : undefined /* v1.8.7：保留原始输入，详情页可查看 */
      };
      if (item.remind) {
        item.notifyId = await scheduleNotification(item);
        schedCount++;
      }
      todos.unshift(item);
    }
  }
  saveTodos(todos);
  toast(mergedCount
    ? `已保存，自动合并重复 ${mergedCount} 项${schedCount ? `（含 ${schedCount} 个提醒）` : ''}`
    : `已保存 ${lastParsed.length} 项${schedCount ? `（含 ${schedCount} 个提醒）` : ''}`);
  showPage('page-schedule');
  lastParsed = null;
  $('parseResult').hidden = true;
  $('inputText').value = '';
  attachments = [];
  renderAttachments();
};

/* ============ 本地通知 ============ */
async function ensureNotifyPermission() {
  if (!LN()) return false;
  try {
    let perm = await LN().checkPermissions();
    if (perm.display === 'prompt' || perm.display === 'prompt-with-rationale') {
      perm = await LN().requestPermissions();
    }
    return perm.display === 'granted';
  } catch (e) { return false; }
}

async function scheduleNotification(item) {
  if (!LN()) return null;
  if (!item.due || item.due <= Date.now()) return null; // 已过期不提醒
  const granted = await ensureNotifyPermission();
  if (!granted) { toast('未获得通知权限，将无法收到提醒'); return null; }
  const id = Math.abs(item.id % 1000000000);
  const ids = [];
  const now = Date.now();
  try {
    // 准点提醒
    await LN().schedule({
      notifications: [{
        id,
        title: '日程提醒',
        body: item.title,
        channelId: 'reminders-v2',
        schedule: { at: new Date(item.due), allowWhileIdle: true }
      }]
    });
    ids.push(id);
    // 提前 1 小时预提醒
    const pre = item.due - 3600000;
    if (pre > now) {
      const id2 = id + 1000000000;
      await LN().schedule({
        notifications: [{
          id: id2,
          title: '日程预提醒',
          body: `1 小时后开始：${item.title}`,
          channelId: 'reminders-v2',
          schedule: { at: new Date(pre), allowWhileIdle: true }
        }]
      });
      ids.push(id2);
    }
    return ids;
  } catch (e) { console.error(e); return ids.length ? ids : null; }
}

async function cancelNotification(item) {
  if (!LN()) return;
  const ids = Array.isArray(item.notifyId) ? item.notifyId : (item.notifyId ? [item.notifyId] : []);
  if (!ids.length) return;
  try { await LN().cancel({ notifications: ids.map((i) => ({ id: i })) }); } catch (e) {}
}

/* ============ 今日日程常驻通知栏 ============ */
const TODAY_BAR_ID = 999999;

function fmtHM(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function ensureChannels() {
  if (!LN() || !LN().createChannel) return;
  // v1.3.0：更换通道 ID 以应用新的锁屏可见性设置（Android 通道创建后设置不可变），并清理旧通道
  // v1.3.3：today-bar 渠道升为提醒类（importance 4）——实测 OriginOS 锁屏只显示提醒类通知，
  // 静默类（importance<=3）不上锁屏；首发会响一声，后续重发由 onlyAlertOnce 静默。
  try { await LN().deleteChannel({ id: 'reminders' }); } catch (e) {}
  try { await LN().deleteChannel({ id: 'today-bar' }); } catch (e) {}
  try { await LN().deleteChannel({ id: 'today-bar-v2' }); } catch (e) {}
  try { await LN().deleteChannel({ id: 'today-bar-v3' }); } catch (e) {}
  try {
    await LN().createChannel({
      id: 'reminders-v2', name: '日程提醒', description: '日程准点与提前1小时提醒',
      importance: 5, visibility: 1
    });
  } catch (e) {}
  try {
    await LN().createChannel({
      id: 'today-bar-v4', name: '今日日程栏', description: '通知栏与锁屏常驻显示当天日程，点击不消失',
      importance: 4, visibility: 1
    });
  } catch (e) {}
}

/* v1.4.0：原生常驻栏服务（前台服务持有通知，熄屏瞬间自动刷新 → 锁屏显示） */
function barServicePlugin() {
  try {
    if (window.Capacitor && typeof window.Capacitor.registerPlugin === 'function') {
      return window.Capacitor.registerPlugin('BarService');
    }
  } catch (e) {}
  return null;
}

async function updateTodayBar() {
  if (!getSettings().todayBarEnabled) {
    const bpOff = barServicePlugin();
    try { if (bpOff) await bpOff.stop(); } catch (e) {}
    if (LN()) { try { await LN().cancel({ notifications: [{ id: TODAY_BAR_ID }] }); } catch (e) {} }
    return;
  }
  try {
    const d = new Date();
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const end = start + 86400000;

    /* v1.8.12：课程已是独立日程（带 due/endTs），常驻栏与待办统一处理 */
    const entries = [];
    getTodos()
      .filter((t) => !t.done && t.due && t.due >= start && t.due < end)
      .forEach((t) => entries.push({
        ts: t.due,
        label: t.title,
        kind: t.courseKey ? 'course' : 'todo',
        endTs: t.endTs || null
      }));
    entries.sort((a, b) => a.ts - b.ts);

    if (!entries.length) {
      const bpEmpty = barServicePlugin();
      try { if (bpEmpty) await bpEmpty.stop(); } catch (e) {}
      if (LN()) { try { await LN().cancel({ notifications: [{ id: TODAY_BAR_ID }] }); } catch (e) {} }
      return;
    }
    const now = Date.now();
    /* 进行中：已开始且未结束的课程优先展示 */
    const ongoing = entries.find((e) => e.kind === 'course' && e.endTs && e.ts <= now && e.endTs > now);
    const next = ongoing || entries.find((e) => (e.endTs || e.ts) > now);
    let title;
    if (ongoing) {
      title = `正在上课 · ${fmtHM(ongoing.ts)}-${fmtHM(ongoing.endTs)} ${ongoing.label}`;
    } else if (next) {
      title = `今日日程 · 下一项 ${fmtHM(next.ts)} ${next.label}`;
    } else {
      title = `今日日程（${entries.length} 项，今天已全部结束）`;
    }
    const body = entries.map((e) => `${fmtHM(e.ts)}  ${e.label}`).join('\n');
    const bp = barServicePlugin();
    if (bp && bp.update) {
      await bp.update({ title, body });
      return;
    }
    // 兜底：无原生服务环境（如浏览器预览）走旧插件通知
    if (!LN()) return;
    await LN().schedule({
      notifications: [{
        id: TODAY_BAR_ID,
        title,
        body,
        channelId: 'today-bar-v4',
        ongoing: true,
        autoCancel: false,
        schedule: { at: new Date(Date.now() + 1200), allowWhileIdle: true }
      }]
    });
  } catch (e) { console.error(e); }
}

let _barTimer = null;
function refreshTodayBar() {
  clearTimeout(_barTimer);
  _barTimer = setTimeout(updateTodayBar, 400);
}

/* ============ 日程（v1.2.0 合并待办视图） ============ */
/* v1.8.11：已完成区固定展开显示，不再需要展开/收起状态 */

function fmtDayKey(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function dayLabel(ts) {
  const key = fmtDayKey(ts);
  const d = new Date();
  if (key === fmtDayKey(d.getTime())) return '今天';
  if (key === fmtDayKey(d.getTime() + 86400000)) return '明天';
  const dt = new Date(ts);
  const week = ['日', '一', '二', '三', '四', '五', '六'][dt.getDay()];
  return `${dt.getMonth() + 1}月${dt.getDate()}日 周${week}`;
}

function scheduleCard(t, all) {
  const div = document.createElement('div');
  div.className = 'card-item' + (t.done ? ' done' : '');
  const overdue = t.due && !t.done && t.due < Date.now();
  /* v1.8.12：课程日程的提醒由原生课程闹钟负责，这里同样显示"已设通知" */
  const notifyTxt = t.notifyId ? ' · 已设通知' : (t.courseKey ? ' · 已设通知' : ' · 未设通知');
  div.innerHTML = `
      <button class="chk ${t.done ? 'checked' : ''}">${t.done ? '✓' : ''}</button>
      <div class="body">
        <div class="title">${escapeHtml(t.title)}</div>
        ${t.detail ? `<div class="meta">${escapeHtml(t.detail)}</div>` : ''}
        ${t.due ? `<div class="meta" style="color:${overdue ? 'var(--danger)' : 'var(--primary)'}">⏰ ${fmtDate(t.due)}${overdue ? '（已过时）' : ''}${t.done ? '' : notifyTxt}</div>` : ''}
      </div>
      <button class="del">✕</button>`;
  div.querySelector('.chk').onclick = async () => {
    setDone(t, !t.done);
    if (t.done) await cancelNotification(t);
    /* 课程日程：完成状态变化 → 让原生重排提醒（完成的节次会被跳过） */
    if (t.courseKey) { try { window.CourseSync.scheduleCourseNotifications(); } catch (e) {} }
    saveTodos(all); renderSchedule();
  };
  div.querySelector('.del').onclick = async () => {
    await cancelNotification(t);
    /* v1.8.12：删除课程日程 → 永久关闭该节次，不再重新生成、也不再提醒 */
    if (t.courseKey) {
      try {
        window.CourseSync.closeSessionKeys([t.courseKey]);
        window.CourseSync.scheduleCourseNotifications();
      } catch (e) {}
    }
    saveTodos(all.filter((x) => x.id !== t.id));
    renderSchedule();
  };
  div.classList.add('clickable');
  div.addEventListener('click', (e) => {
    if (e.target.closest('.chk') || e.target.closest('.del')) return;
    openDetail(t.id);
  });
  return div;
}

/* v1.8.11：已完成区常显，无需展开动作 */
window.__aitodoExpandDone = () => {};

function renderSchedule() {
  /* v1.8.12：课程已实体化为独立日程（条目带 courseKey）。
     先补展开「当天+3 天」的新课节、清理过期历史，再读取完整列表。 */
  try {
    if (window.CourseSync) {
      window.CourseSync.dropStaleSessions();
      window.CourseSync.rollSessions();
    }
  } catch (e) {}
  const all = getTodos();
  const nowD = new Date();
  const todayStart = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate()).getTime();
  /* 未完成但已过期的课程节次不再展示（历史课不占时间线） */
  const active = all.filter((t) => !t.done && !(t.courseKey && t.due && t.due < todayStart));
  const withDue = active.filter((t) => t.due).sort((a, b) => a.due - b.due);
  const unsched = active.filter((t) => !t.due).sort((a, b) => b.createdAt - a.createdAt);
  const done = all.filter((t) => t.done).sort((a, b) => b.createdAt - a.createdAt);

  try {
    if (window.CourseSync && window.CourseSync.renderScheduleHeader) window.CourseSync.renderScheduleHeader();
    const csBlock = $('courseScheduleBlock');
    /* v1.7.1 起课程并入统一时间线，独立课表区停用 */
    if (csBlock) csBlock.hidden = true;
  } catch (e) { console.error('课表头渲染失败', e); }

  const emptyEl = $('scheduleEmpty');
  if (emptyEl) emptyEl.hidden = all.length > 0;
  const cntEl = $('schCount');
  if (cntEl) cntEl.textContent = all.length;
  const d = new Date();
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const todayEl = $('schTodayCount');
  if (todayEl) todayEl.textContent = withDue.filter((t) => t.due >= dayStart && t.due < dayStart + 86400000).length;

  /* 时间线：所有有时间的条目（待办 + 课程日程）按天分组、天内按时间排序 */
  const dayTs = {};
  const ordered = [];
  const addDay = (ts) => {
    const k = fmtDayKey(ts);
    if (!(k in dayTs)) { dayTs[k] = ts; ordered.push(k); }
    else if (ts < dayTs[k]) dayTs[k] = ts;
  };
  withDue.forEach((t) => addDay(t.due));
  ordered.sort((a, b) => dayTs[a] - dayTs[b]);

  const box = $('scheduleList');
  box.innerHTML = '';
  ordered.forEach((k) => {
    const dayItems = withDue.filter((t) => fmtDayKey(t.due) === k);
    const h = document.createElement('div');
    h.className = 'date-head';
    /* 当天有课程日程时，标题带上教学周次（条目里已记录 weekNo） */
    const wk = dayItems.find((t) => t.courseKey && t.weekNo);
    h.textContent = dayLabel(dayTs[k]) + (wk ? `（第${wk.weekNo}周）` : '');
    box.appendChild(h);
    dayItems.slice().sort((a, b) => a.due - b.due).forEach((t) => box.appendChild(scheduleCard(t, all)));
  });

  $('unschedBlock').hidden = !unsched.length;
  const ub = $('unschedList');
  ub.innerHTML = '';
  unsched.forEach((t) => ub.appendChild(scheduleCard(t, all)));

  /* 已完成区：全部已完成条目（待办 + 课程日程）按时间先后排列（v1.8.9）
     有时间的按时间升序排在前，没有时间的排在后面、按创建时间升序 */
  const doneItems = done.map((t) => ({ hasTime: !!t.due, sortTs: t.due || t.createdAt, todo: t }));
  doneItems.sort((a, b) => {
    if (a.hasTime !== b.hasTime) return a.hasTime ? -1 : 1;
    return a.sortTs - b.sortTs;
  });
  $('doneCount').textContent = doneItems.length;
  $('doneBlock').hidden = !doneItems.length;
  const db = $('doneList');
  db.innerHTML = '';
  doneItems.forEach((it) => db.appendChild(scheduleCard(it.todo, all)));
}

/* v1.8.11：一键清理已完成的日程；v1.8.12：课程节次清理后永久关闭，不再重新生成 */
$('btnClearDone').onclick = async () => {
  const todos = getTodos();
  const doneTodos = todos.filter((t) => t.done);
  if (!doneTodos.length) { toast('还没有已完成的日程'); return; }
  if (!confirm('确定清理全部已完成的日程吗？\n（含已保存的原始来源，清理后不可恢复）')) return;
  const courseKeys = doneTodos.filter((t) => t.courseKey).map((t) => t.courseKey);
  for (const t of doneTodos) await cancelNotification(t);
  saveTodos(todos.filter((t) => !t.done));
  if (courseKeys.length) {
    try {
      window.CourseSync.closeSessionKeys(courseKeys);      /* 永久关闭，避免又被生成成未完成 */
      window.CourseSync.scheduleCourseNotifications();     /* 同步取消这些节次的提醒 */
    } catch (e) {}
  }
  renderSchedule();
  toast('已清理已完成的日程');
};

/* v1.8.6：日程页的手动添加入口已移除（统一走「解析」页或 AI 助手） */

/* ============ 日程页下拉刷新（v1.8.19） ============
   在页面顶部下拉即刷新：取回后台同步的课表 → 对账课程日程 → 清理过期原文件 → 重绘。
   只在「滚动到顶部 + 单指下拉」时生效，不影响正常滚动。 */
(function initPullToRefresh() {
  const page = $('page-schedule');
  const bar = $('ptrBar');
  const label = $('ptrText');
  if (!page || !bar || !label) return;
  const THRESHOLD = 64;   /* 触发阈值（阻尼后位移，px） */
  const MAX = 110;        /* 最大下拉位移 */
  let startY = 0, dist = 0, pulling = false, busy = false;

  const paint = (d) => {
    bar.style.transform = `translate(-50%, calc(-180% + ${d}px))`;
    if (d > 4) bar.classList.add('show'); else bar.classList.remove('show');
  };
  const reset = () => {
    dist = 0; pulling = false;
    bar.classList.remove('show', 'ready', 'loading');
    bar.style.transform = '';
  };
  const refresh = async () => {
    if (busy) return;
    busy = true;
    bar.classList.add('show', 'ready', 'loading');
    bar.style.transform = 'translate(-50%, 0)';
    label.textContent = '刷新中…';
    try {
      /* 1) 取回每日后台同步的课表（若有更新则采纳） */
      if (window.CourseSync && window.CourseSync.pullNativeState) {
        try { await window.CourseSync.pullNativeState(); } catch (e) {}
      }
      /* 2) 对账课程日程：新增/更新/删除 */
      if (window.CourseSync && window.CourseSync.rollSessions) {
        try { window.CourseSync.rollSessions(); } catch (e) {}
      }
      /* 3) 常规整理：清理过期原文件、重绘时间线、刷新常驻栏 */
      purgeOldSources();
      renderSchedule();
      refreshTodayBar();
      if (typeof loadSettingsUI === 'function') loadSettingsUI();
    } catch (e) { console.error('下拉刷新失败', e); }
    label.textContent = '已刷新';
    setTimeout(() => { busy = false; reset(); }, 500);
  };

  page.addEventListener('touchstart', (e) => {
    if (busy || e.touches.length !== 1) return;
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    if (y > 0) return;                 /* 只在顶部生效 */
    startY = e.touches[0].clientY;
    dist = 0;
    pulling = true;
  }, { passive: true });

  page.addEventListener('touchmove', (e) => {
    if (!pulling || busy) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0) { dist = 0; paint(0); return; }
    dist = Math.min(dy * 0.5, MAX);    /* 阻尼系数 0.5 */
    paint(dist);
    const ready = dist >= THRESHOLD;
    bar.classList.toggle('ready', ready);
    label.textContent = ready ? '松手刷新' : '下拉刷新';
    if (dist > 6 && e.cancelable) e.preventDefault();   /* 抑制顶部橡皮筋 */
  }, { passive: false });

  const finish = () => {
    if (!pulling) return;
    const reached = dist >= THRESHOLD;
    pulling = false;
    if (reached) refresh(); else reset();
  };
  page.addEventListener('touchend', finish, { passive: true });
  page.addEventListener('touchcancel', finish, { passive: true });
})();

/* ============ 设置 ============ */
function loadSettingsUI() {
  const s = getSettings();
  $('setApiKey').value = s.apiKey;
  $('setTextModel').value = s.textModel;
  $('setVisionModel').value = s.visionModel;
  $('setTodayBar').checked = s.todayBarEnabled !== false;
}

$('btnSaveSettings').onclick = () => {
  store.set('settings', {
    apiKey: $('setApiKey').value.trim(),
    textModel: $('setTextModel').value,
    visionModel: $('setVisionModel').value,
    todayBarEnabled: $('setTodayBar').checked
  });
  toast('设置已保存');
};

$('setTodayBar').addEventListener('change', (e) => {
  const s = getSettings();
  s.todayBarEnabled = e.target.checked;
  store.set('settings', s);
  refreshTodayBar();
  toast(e.target.checked ? '常驻日程栏已开启' : '常驻日程栏已关闭');
});

/* ============ 使用指南（v1.8.1）：权限自检 + 品牌后台放行引导 ============ */
function sysPlugin() {
  try {
    if (window.__cap && window.__cap.SystemInfo) return window.__cap.SystemInfo;
    if (window.Capacitor && typeof window.Capacitor.registerPlugin === 'function') {
      return window.Capacitor.registerPlugin('SystemInfo');
    }
  } catch (e) {}
  return null;
}

/* 各品牌后台保活路径（平铺列出，不做机型识别） */
const BRAND_STEPS = [
  { key: 'vivo', name: 'vivo / iQOO（OriginOS）', steps: ['设置 → 应用与权限 → 权限管理 → 自启动 → 允许本应用', '设置 → 电池 → 后台耗电管理 → 本应用 → 允许后台运行', '最近任务界面下拉本应用卡片，锁定后台', '设置 → 通知与状态栏 → 锁屏通知 → 显示所有通知内容'] },
  { key: 'xiaomi', name: '小米 / 红米（HyperOS / MIUI）', steps: ['设置 → 应用设置 → 应用管理 → 本应用 → 自启动 → 允许', '设置 → 应用管理 → 本应用 → 省电策略 → 无限制', '最近任务界面长按本应用卡片 → 加锁', '设置 → 通知与控制中心 → 锁屏通知 → 显示'] },
  { key: 'oppo', name: 'OPPO / 一加 / realme（ColorOS）', steps: ['设置 → 应用 → 应用管理 → 本应用 → 允许自启动', '设置 → 电池 → 更多设置 → 睡眠待机优化 → 关闭', '设置 → 应用 → 本应用 → 耗电管理 → 允许后台运行', '最近任务界面锁定本应用'] },
  { key: 'huawei', name: '华为 / 荣耀（HarmonyOS / EMUI / MagicOS）', steps: ['设置 → 应用 → 应用启动管理 → 本应用 → 改为「手动管理」并全部允许', '设置 → 电池 → 关闭对本应用的休眠限制，并将本应用设为「不受限制」', '设置 → 通知 → 本应用 → 允许通知、锁屏通知显示', '荣耀：设置 → 电池 → 应用耗电管理 → 允许后台活动'] },
  { key: 'samsung', name: '三星（One UI）', steps: ['设置 → 电池和设备维护 → 电池 → 后台使用限制 → 从不休眠的应用 → 添加本应用', '设置 → 应用 → 本应用 → 电池 → 不受限制', '设置 → 通知 → 本应用 → 允许通知', '关闭「使未使用的应用进入休眠」对本应用的限制'] },
  { key: 'other', name: '其他品牌 / 原生 Android', steps: ['设置 → 应用 → 本应用 → 电池 → 不受限制（不优化）', '设置 → 应用 → 本应用 → 允许自启动 / 允许后台活动', '设置 → 通知 → 本应用 → 允许通知', '最近任务界面锁定本应用，避免被一键清理'] }
];

function renderGuideBrand() {
  const box = document.getElementById('guideBrandBox');
  if (!box) return;
  box.innerHTML = BRAND_STEPS.map((b) =>
    '<div class="brand-box">' +
      '<button class="brand-head" type="button">' +
      '<span class="brand-name">' + escapeHtml(b.name) + '</span>' +
      '<span class="chev">›</span></button>' +
      '<ol class="guide-list brand-steps" hidden>' +
      b.steps.map((s) => '<li>' + escapeHtml(s) + '</li>').join('') +
      '</ol></div>').join('');
  box.querySelectorAll('.brand-head').forEach((h) => {
    h.addEventListener('click', () => {
      const ol = h.parentElement.querySelector('.brand-steps');
      if (ol) ol.hidden = !ol.hidden;
    });
  });
}

async function refreshGuide() {
  const box = document.getElementById('guideStatus');
  if (!box) return;
  const p = sysPlugin();
  if (!p || !p.status) {
    box.innerHTML = '<div class="guide-row"><span>权限自检</span><b>仅 App 内可用</b></div>';
    renderGuideBrand();
    return;
  }
  let st = {};
  try { st = await p.status(); } catch (e) {}
  renderGuideBrand();
  const rows = [
    {
      label: '通知权限',
      ok: !!(st && st.notifications),
      desc: '没有通知权限就收不到任何提醒',
      act: '去开启通知',
      fn: () => p.openNotificationSettings && p.openNotificationSettings()
    },
    {
      label: '精确闹钟（闹钟与提醒）',
      ok: !!(st && st.exactAlarm),
      desc: '未开启时提醒可能晚几分钟到十几分钟',
      act: '去开启精确闹钟',
      fn: () => p.requestExactAlarm && p.requestExactAlarm(),
      hide: st && st.sdk < 31
    },
    {
      label: '后台不被省电限制',
      ok: !!(st && st.batteryUnrestricted),
      desc: '未加入白名单时，后台同步与常驻栏可能被系统清掉',
      act: '去加入白名单',
      fn: () => p.requestIgnoreBattery && p.requestIgnoreBattery()
    }
  ].filter((r) => !r.hide);

  box.innerHTML = rows.map((r, i) =>
    '<div class="guide-row' + (r.ok ? ' ok' : '') + '">' +
      '<div class="guide-row-main">' +
        '<span class="guide-label">' + escapeHtml(r.label) + '</span>' +
        '<span class="guide-state">' + (r.ok ? '已开启' : '未开启') + '</span>' +
      '</div>' +
      '<div class="guide-desc">' + escapeHtml(r.desc) + '</div>' +
      (r.ok ? '' : '<button class="btn-ghost guide-btn" data-i="' + i + '" type="button">' + escapeHtml(r.act) + '</button>') +
    '</div>').join('');

  box.querySelectorAll('.guide-btn').forEach((b) => {
    b.addEventListener('click', async () => {
      const r = rows[Number(b.dataset.i)];
      if (!r || !r.fn) return;
      try { await r.fn(); } catch (e) {}
      /* 回到 App 后刷新状态，并让课程闹钟按新权限重排一次 */
      setTimeout(() => {
        refreshGuide();
        try { if (window.CourseSync) window.CourseSync.scheduleCourseNotifications(); } catch (e) {}
      }, 1200);
    });
  });
}

/* 回到前台时刷新指南状态（用户刚去系统设置里改过） */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  const sub = $('settingsSub');
  const pane = document.querySelector('.sub-pane[data-sub="guide"]');
  if (sub && pane && !sub.hidden && !pane.hidden) refreshGuide();
});

/* 设置页：主菜单 → 全屏子页（v1.6.0） */
const SUB_TITLES = { ai: 'AI 配置', course: '课表同步', notify: '通知与提醒', guide: '使用指南', data: '数据管理' };
function openSettingsSub(key) {
  document.querySelectorAll('.sub-pane').forEach((p) => { p.hidden = p.dataset.sub !== key; });
  $('subTitle').textContent = SUB_TITLES[key] || '设置';
  $('settingsSub').hidden = false;
  // v1.7.0：打开课表子页时刷新其状态与预览
  if (key === 'course' && window.CourseSync) {
    try { window.CourseSync.loadSettingsUI(); } catch (e) {}
  }
  // v1.8.1：打开使用指南时做一次权限自检
  if (key === 'guide') refreshGuide();
}
function closeSettingsSub() {
  $('settingsSub').hidden = true;
}
document.querySelectorAll('.set-link').forEach((b) => {
  b.addEventListener('click', () => openSettingsSub(b.dataset.sub));
});
/* v1.7.9：子页不再提供右上角关闭按钮，点弹层空白处或系统返回键退出 */
$('settingsSub').addEventListener('click', (e) => { if (e.target === $('settingsSub')) closeSettingsSub(); });

$('btnTestApi').onclick = async () => {
  const key = $('setApiKey').value.trim();
  const status = $('settingsStatus');
  if (!key) { status.className = 'status error'; status.textContent = '请先填写 API Key'; return; }
  status.className = 'status';
  status.innerHTML = '<span class="spinner"></span>正在测试…';
  try {
    store.set('settings', Object.assign(getSettings(), {
      apiKey: key, textModel: $('setTextModel').value, visionModel: $('setVisionModel').value
    }));
    const out = await callGLM($('setTextModel').value, [
      { role: 'user', content: '请回复"连接成功"四个字' }
    ]);
    status.className = 'status ok';
    status.textContent = '✔ 连接成功：' + out.slice(0, 50);
  } catch (err) {
    status.className = 'status error';
    status.textContent = '✘ 连接失败：' + err.message;
  }
};

$('btnClearData').onclick = async () => {
  if (!confirm('确定清空所有待办、日程和设置吗？此操作不可恢复。')) return;
  const todos = getTodos();
  for (const t of todos) await cancelNotification(t);
  // v1.7.0：课表数据与课程提醒一并清除
  try { if (window.CourseSync) window.CourseSync.purge(); } catch (e) {}
  localStorage.clear();
  loadSettingsUI();
  renderSchedule();
  try { if (window.CourseSync) window.CourseSync.loadSettingsUI(); } catch (e) {}
  toast('已清空');
};

/* ============ v1.5.0 AI 助手对话（工具调用直改日程数据） ============ */
function chatHistory() { return store.get('chatHistory', []); }
function setChatHistory(list) { store.set('chatHistory', list.slice(-60)); }

function todoBrief(t) {
  return { id: t.id, title: t.title, detail: t.detail || '', due: t.due ? fmtDate(t.due) : null, remind: !!t.remind, done: !!t.done };
}
function findByTitle(list, title) {
  if (!title) return null;
  const q = String(title).trim().toLowerCase();
  if (!q) return null;
  return list.find((x) => x.title.toLowerCase() === q)
    || list.find((x) => x.title.toLowerCase().includes(q))
    || null;
}

const CHAT_TOOLS = [
  { type: 'function', function: { name: 'list_todos', description: '列出用户的日程/待办事项', parameters: { type: 'object', properties: { filter: { type: 'string', enum: ['all', 'today', 'upcoming', 'unscheduled', 'done'], description: '筛选范围：全部/今天/未来有时间的/待安排(无时间)/已完成' } }, required: ['filter'] } } },
  { type: 'function', function: { name: 'add_todo', description: '添加一条日程或待办事项', parameters: { type: 'object', properties: { title: { type: 'string', description: '简短标题' }, detail: { type: 'string', description: '备注，可为空' }, due: { type: 'string', description: '时间 YYYY-MM-DD HH:mm，没有则不传' }, remind: { type: 'boolean', description: '是否到点提醒，有明确时间建议 true' } }, required: ['title'] } } },
  { type: 'function', function: { name: 'update_todo', description: '修改已有事项（按 id 或标题模糊匹配）', parameters: { type: 'object', properties: { id: { type: 'number', description: '事项 id，未知可不传' }, title: { type: 'string', description: '用于模糊匹配的现有标题' }, new_title: { type: 'string', description: '新标题，不改不传' }, detail: { type: 'string', description: '新备注' }, due: { type: 'string', description: '新时间 YYYY-MM-DD HH:mm，取消时间传空串' }, remind: { type: 'boolean' } }, required: [] } } },
  { type: 'function', function: { name: 'complete_todo', description: '把事项标记为完成', parameters: { type: 'object', properties: { id: { type: 'number' }, title: { type: 'string', description: '模糊匹配用' } }, required: [] } } },
  { type: 'function', function: { name: 'reopen_todo', description: '把已完成事项恢复为未完成', parameters: { type: 'object', properties: { id: { type: 'number' }, title: { type: 'string' } }, required: [] } } },
  { type: 'function', function: { name: 'delete_todo', description: '删除事项', parameters: { type: 'object', properties: { id: { type: 'number' }, title: { type: 'string' } }, required: [] } } },
  { type: 'function', function: { name: 'clear_completed', description: '清空所有已完成事项', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'set_today_bar', description: '开启或关闭通知栏/锁屏的常驻今日日程栏', parameters: { type: 'object', properties: { enabled: { type: 'boolean' } }, required: ['enabled'] } } },
  { type: 'function', function: { name: 'get_stats', description: '获取事项数量统计', parameters: { type: 'object', properties: {} } } },
  /* v1.8.16：开放课表等全部数据读取权限 */
  { type: 'function', function: { name: 'get_timetable', description: '读取已同步的整学期课程表（每周固定课表：课程名、教师、地点、星期、节次、上课时间、周次）', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_week_plan', description: '读取某一教学周的完整安排（每天的实际星期、是否放假/调课、当天课程）。不传 weekNo 则为当前周', parameters: { type: 'object', properties: { weekNo: { type: 'number', description: '教学周序号，如 4' } }, required: [] } } },
  { type: 'function', function: { name: 'get_course_sessions', description: '读取已展开成日程的课程节次（含具体日期、时间、是否已完成），默认未来 4 天', parameters: { type: 'object', properties: { days: { type: 'number', description: '往前看几天，1~30，默认 4' } }, required: [] } } },
  { type: 'function', function: { name: 'get_term_info', description: '读取校历信息：学期名、第1周周日、总周数、当前第几周、今天实际星期、是否调课/放假、调课与放假日期表', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_app_status', description: '读取课表同步状态：课表数量、上次同步时间、上次抓取地址、课表开关设置', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_settings_info', description: '读取当前设置（AI 模型、常驻栏开关等；出于安全不返回 API Key）', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_todo_detail', description: '读取单条事项的完整内容（备注、时间、创建时间、是否有原始来源）', parameters: { type: 'object', properties: { id: { type: 'number' }, title: { type: 'string', description: '模糊匹配用' } }, required: [] } } },
  { type: 'function', function: { name: 'search_schedule', description: '在全部日程与课程表中按关键词搜索（课程名/教师/地点/备注）', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'complete_course_session', description: '把某一天的某节课标记为已完成（按日期+课程名精确定位，避免同名课程改错）', parameters: { type: 'object', properties: { date: { type: 'string', description: '日期 YYYY-MM-DD' }, courseName: { type: 'string', description: '课程名，可用关键词（如「心理学」）' } }, required: ['date', 'courseName'] } } },
  { type: 'function', function: { name: 'delete_course_session', description: '删除某一天的某节课（按日期+课程名精确定位；删除后不再重新生成也不会提醒）', parameters: { type: 'object', properties: { date: { type: 'string', description: '日期 YYYY-MM-DD' }, courseName: { type: 'string', description: '课程名或关键词' } }, required: ['date', 'courseName'] } } }
];

const CHAT_TOOL_LABELS = {
  list_todos: '查看日程', add_todo: '添加事项', update_todo: '修改事项',
  complete_todo: '标记完成', reopen_todo: '恢复未完成', delete_todo: '删除事项',
  clear_completed: '清空已完成', set_today_bar: '设置常驻栏', get_stats: '统计',
  get_timetable: '读取课表', get_week_plan: '读取周计划', get_course_sessions: '读取课程日程',
  get_term_info: '读取校历', get_app_status: '读取同步状态', get_settings_info: '读取设置',
  get_todo_detail: '读取事项详情', search_schedule: '搜索日程',
  complete_course_session: '完成某节课', delete_course_session: '删除某节课'
};

const CHAT_ACTIONS = {
  async list_todos({ filter = 'all' }) {
    const all = getTodos();
    const d = new Date();
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    let list;
    if (filter === 'today') list = all.filter((t) => !t.done && t.due && t.due >= dayStart && t.due < dayStart + 86400000);
    else if (filter === 'upcoming') list = all.filter((t) => !t.done && t.due && t.due >= Date.now()).sort((a, b) => a.due - b.due);
    else if (filter === 'unscheduled') list = all.filter((t) => !t.done && !t.due);
    else if (filter === 'done') list = all.filter((t) => t.done);
    else list = all;
    return JSON.stringify({ count: list.length, todos: list.slice(0, 50).map(todoBrief) });
  },
  async add_todo({ title, detail, due, remind }) {
    const dueTs = due ? parseDue(due) : null;
    if (due && !dueTs) return JSON.stringify({ ok: false, error: '时间格式应为 YYYY-MM-DD HH:mm' });
    const wantRemind = remind === undefined ? !!dueTs : !!remind;
    const todos = getTodos();
    /* v1.7.5：同一活动重复添加 → 合并（详情=并集，时间以新通知为准） */
    const nt = normTitle(String(title || ''));
    const dup = nt ? (todos.find((x) => !x.done && normTitle(x.title) === nt)
      || todos.find((x) => normTitle(x.title) === nt)) : null;
    if (dup) {
      await mergeTodoInto(dup, { title: String(title), detail: String(detail || ''), due: dueTs, remind: !!(dueTs && wantRemind) });
      saveTodos(todos);
      renderSchedule();
      return JSON.stringify({ ok: true, merged: true, id: dup.id, title: dup.title, due: dup.due ? fmtDate(dup.due) : null, remind: dup.remind });
    }
    const item = {
      id: Date.now() + Math.floor(Math.random() * 10000),
      title: String(title), detail: String(detail || ''), done: false,
      createdAt: Date.now(), due: dueTs, remind: !!(dueTs && wantRemind), notifyId: null
    };
    if (item.remind) item.notifyId = await scheduleNotification(item);
    todos.unshift(item);
    saveTodos(todos);
    renderSchedule();
    return JSON.stringify({ ok: true, id: item.id, title: item.title, due: item.due ? fmtDate(item.due) : null, remind: item.remind });
  },
  async update_todo({ id, title, new_title, detail, due, remind }) {
    const todos = getTodos();
    const t = id != null ? todos.find((x) => x.id === id) : findByTitle(todos, title);
    if (!t) return JSON.stringify({ ok: false, error: '未找到该事项，可先 list_todos 确认' });
    const dueTs = due !== undefined ? (due ? parseDue(due) : null) : undefined;
    if (due && !dueTs) return JSON.stringify({ ok: false, error: '时间格式应为 YYYY-MM-DD HH:mm' });
    const dueChanged = dueTs !== undefined && dueTs !== t.due;
    if (dueChanged || remind !== undefined) await cancelNotification(t);
    if (new_title) t.title = String(new_title);
    if (detail !== undefined) t.detail = String(detail || '');
    if (dueTs !== undefined) t.due = dueTs;
    if (remind !== undefined) t.remind = !!remind;
    else if (dueChanged && !t.due) t.remind = false;
    t.notifyId = (t.remind && t.due && t.due > Date.now()) ? await scheduleNotification(t) : null;
    saveTodos(todos);
    renderSchedule();
    return JSON.stringify({ ok: true, todo: todoBrief(t) });
  },
  async complete_todo({ id, title }) {
    const todos = getTodos();
    const t = id != null ? todos.find((x) => x.id === id) : findByTitle(todos.filter((x) => !x.done), title);
    if (!t) return JSON.stringify({ ok: false, error: '未找到该事项' });
    setDone(t, true);
    await cancelNotification(t);
    saveTodos(todos);
    renderSchedule();
    return JSON.stringify({ ok: true, title: t.title });
  },
  async reopen_todo({ id, title }) {
    const todos = getTodos();
    const t = id != null ? todos.find((x) => x.id === id) : findByTitle(todos.filter((x) => x.done), title);
    if (!t) return JSON.stringify({ ok: false, error: '未找到该已完成事项' });
    setDone(t, false);
    if (t.remind && t.due && t.due > Date.now()) t.notifyId = await scheduleNotification(t);
    saveTodos(todos);
    renderSchedule();
    return JSON.stringify({ ok: true, title: t.title });
  },
  async delete_todo({ id, title }) {
    const todos = getTodos();
    const t = id != null ? todos.find((x) => x.id === id) : findByTitle(todos, title);
    if (!t) return JSON.stringify({ ok: false, error: '未找到该事项' });
    await cancelNotification(t);
    saveTodos(todos.filter((x) => x.id !== t.id));
    renderSchedule();
    return JSON.stringify({ ok: true, deleted: t.title });
  },
  async clear_completed() {
    const todos = getTodos();
    const done = todos.filter((t) => t.done);
    for (const t of done) await cancelNotification(t);
    saveTodos(todos.filter((t) => !t.done));
    renderSchedule();
    return JSON.stringify({ ok: true, removed: done.length });
  },
  async set_today_bar({ enabled }) {
    const s = getSettings();
    s.todayBarEnabled = !!enabled;
    store.set('settings', s);
    const el = $('setTodayBar');
    if (el) el.checked = s.todayBarEnabled;
    refreshTodayBar();
    return JSON.stringify({ ok: true, enabled: s.todayBarEnabled });
  },
  async get_stats() {
    const all = getTodos();
    const d = new Date();
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const active = all.filter((t) => !t.done);
    return JSON.stringify({
      ok: true, total: all.length, active: active.length, done: all.length - active.length,
      today: active.filter((t) => t.due && t.due >= dayStart && t.due < dayStart + 86400000).length,
      overdue: active.filter((t) => t.due && t.due < Date.now()).length,
      unscheduled: active.filter((t) => !t.due).length
    });
  },

  /* ===== v1.8.16：课表与全量数据读取 ===== */
  async get_timetable() {
    const cs = window.CourseSync;
    if (!cs || !cs.getTimetable) return JSON.stringify({ ok: false, error: '课表模块未就绪' });
    const list = cs.getTimetable();
    return JSON.stringify({
      ok: true, count: list.length,
      term: cs.getTermInfo ? cs.getTermInfo() : null,
      courses: list,
      note: list.length ? undefined : '尚未同步课表：请到「课程表」页点右上角「同步」并在窗口内登录教务系统'
    });
  },
  async get_week_plan({ weekNo }) {
    const cs = window.CourseSync;
    if (!cs || !cs.getWeekPlan) return JSON.stringify({ ok: false, error: '课表模块未就绪' });
    return JSON.stringify(cs.getWeekPlan(weekNo));
  },
  async get_course_sessions({ days }) {
    const cs = window.CourseSync;
    if (!cs || !cs.getCourseSessions) return JSON.stringify({ ok: false, error: '课表模块未就绪' });
    return JSON.stringify(cs.getCourseSessions(days));
  },
  async get_term_info() {
    const cs = window.CourseSync;
    if (!cs || !cs.getTermInfo) return JSON.stringify({ ok: false, error: '课表模块未就绪' });
    return JSON.stringify({ ok: true, term: cs.getTermInfo() });
  },
  async get_app_status() {
    const cs = window.CourseSync;
    return JSON.stringify({
      ok: true,
      course: (cs && cs.getSyncStatus) ? cs.getSyncStatus() : null,
      todayBar: !!(getSettings().todayBarEnabled),
      todoCount: getTodos().length
    });
  },
  async get_settings_info() {
    const s = getSettings();
    return JSON.stringify({
      ok: true,
      textModel: s.textModel, visionModel: s.visionModel,
      hasApiKey: !!s.apiKey, todayBarEnabled: s.todayBarEnabled !== false,
      note: '出于安全，API Key 不返回'
    });
  },
  async get_todo_detail({ id, title }) {
    const todos = getTodos();
    const t = id != null ? todos.find((x) => x.id === id) : findByTitle(todos, title);
    if (!t) return JSON.stringify({ ok: false, error: '未找到该事项' });
    return JSON.stringify({
      ok: true,
      todo: {
        id: t.id, title: t.title, detail: t.detail || '', done: !!t.done,
        due: t.due ? fmtDate(t.due) : null, dueTs: t.due || null,
        createdAt: fmtDate(t.createdAt),
        remind: !!t.remind, notifyId: t.notifyId || null,
        isCourseSession: !!t.courseKey, courseKey: t.courseKey || null,
        hasSources: !!(t.srcs && t.srcs.length),
        sourceKinds: (t.srcs || []).map((s) => s.kind + ':' + (s.name || ''))
      }
    });
  },
  async search_schedule({ query }) {
    const q = String(query || '').toLowerCase();
    if (!q) return JSON.stringify({ ok: false, error: '请提供关键词' });
    const todos = getTodos().filter((t) =>
      (t.title || '').toLowerCase().includes(q) || (t.detail || '').toLowerCase().includes(q));
    const cs = window.CourseSync;
    const courses = (cs && cs.getTimetable ? cs.getTimetable() : []).filter((c) =>
      [c.name, c.teacher, c.location].some((v) => String(v || '').toLowerCase().includes(q)));
    return JSON.stringify({
      ok: true,
      todos: todos.map(todoBrief),
      courses: courses,
      note: courses.length ? '课程条目即为课表；其每日节次可在日程中查看或调 get_course_sessions' : undefined
    });
  },

  /* ===== v1.8.17：按「日期 + 课程名」精确操作某节课 ===== */
  async complete_course_session({ date, courseName }) {
    return await courseSessionAction(date, courseName, async (t) => {
      setDone(t, true);
      saveTodos(getTodos());
      renderSchedule();
      return { ok: true, action: 'completed', title: t.title, date: String(date), detail: t.detail };
    });
  },
  async delete_course_session({ date, courseName }) {
    return await courseSessionAction(date, courseName, async (t) => {
      const todos = getTodos().filter((x) => x.id !== t.id);
      saveTodos(todos);
      try {
        if (window.CourseSync && window.CourseSync.closeSessionKeys) window.CourseSync.closeSessionKeys([t.courseKey]);
        if (window.CourseSync && window.CourseSync.scheduleCourseNotifications) window.CourseSync.scheduleCourseNotifications();
      } catch (e) {}
      renderSchedule();
      return { ok: true, action: 'deleted', title: t.title, date: String(date) };
    });
  }
};

/* 课程日程精确定位：先按日期+课程名匹配，找不到再按日期匹配唯一候选 */
async function courseSessionAction(date, courseName, fn) {
  const wantDate = String(date || '').trim();
  const q = String(courseName || '').trim().toLowerCase();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(wantDate)) return JSON.stringify({ ok: false, error: '日期格式应为 YYYY-MM-DD' });
  const todos = getTodos();
  const keyOf = (t) => String(t.courseKey || '');   // 形如 课程名|YYYY-MM-DD|节次
  const sessions = todos.filter((t) => t.courseKey && keyOf(t).split('|')[1] === wantDate);
  if (!sessions.length) return JSON.stringify({ ok: false, error: `该日期（${wantDate}）没有课程日程，可用 get_course_sessions 查看` });
  let target = q ? sessions.find((t) => keyOf(t).split('|')[0].toLowerCase().includes(q)) : null;
  if (!target && q && sessions.length === 1) target = sessions[0];
  if (!target && !q && sessions.length === 1) target = sessions[0];
  if (!target) {
    return JSON.stringify({
      ok: false,
      error: `未唯一确定要操作的那节课，请指定课程名`,
      candidates: sessions.map((t) => ({ title: t.title, detail: t.detail, id: t.id }))
    });
  }
  return JSON.stringify(await fn(target));
}

function chatSystemPrompt() {
  const week = '日一二三四五六'[new Date().getDay()];
  /* v1.8.16：把课表/校历上下文直接给模型，并明确它拥有全部读取权限 */
  let ctx = '';
  try {
    const cs = window.CourseSync;
    if (cs && cs.getTermInfo && cs.getSyncStatus) {
      const t = cs.getTermInfo();
      const st = cs.getSyncStatus();
      ctx = `\n课表状态：已同步课程 ${st.courseCount} 门（${st.lastSyncText}）；当前为第 ${t.currentWeek} 教学周；` +
        `今天 ${t.today} 自然星期是${t.todayNaturalWeekday}，实际按${t.todayEffectiveWeekday}的课表上课` +
        (t.todayIsHoliday ? '（今天放假）' : (t.todayIsAdjusted ? '（调课）' : '')) +
        (st.courseCount ? '' : '；尚未同步课表，若用户问课表请提示他到「课程表」页点右上角「同步」');
    }
  } catch (e) {}
  return `你是「日程助手」App 内置的日程助手。你对本 App 的数据拥有完整读写权限：
- 事项：查询、添加、修改、完成、恢复、删除、清空已完成（list_todos / add_todo / update_todo / complete_todo / reopen_todo / delete_todo / clear_completed）
- 课表：读取整学期课表（get_timetable）、某个教学周的逐日安排（get_week_plan）、已展开的课程日程（get_course_sessions）、校历与调课放假（get_term_info）
- 其他：同步状态（get_app_status）、设置（get_settings_info，不含 API Key）、事项详情（get_todo_detail）、关键词搜索（search_schedule）
当前时间：${fmtDate(Date.now())} 星期${week}。${ctx}
规则：
1. 涉及数据的问题必须先调用工具查证再回答，**禁止**回答"我看不到课表/没有权限"——你有全部权限，若工具返回空数据，请说明原因（如未同步课表）而不是说没有权限。
2. 涉及日程操作必须调用工具执行，不要只口头答应；相对时间（明天/周五/下周三）按当前时间换算为 YYYY-MM-DD HH:mm。
3. 有明确时间的添加/修改默认 remind=true；纯任务（如"买牛奶"）不传 due。
4. 修改/完成/删除前如果不确定是哪一条，先 list_todos 或 search_schedule 确认 id，避免误改。
5. 课程表按「周次 + 星期」展开，注意调课与放假：例如某周日补周五的课、节假日停课，get_week_plan 会给出每天的实际星期与标记。
6. 要操作「某天的某节课」时，用 complete_course_session / delete_course_session 并给出日期与课程名（同名课程每周都有多条日程，按标题操作容易改错）。
6. 回复用简洁中文，执行完工具后用一句话向用户确认结果；课表类问题可用列表或简单表格回答。`;
}

async function callGLMRaw(model, messages, useTools) {
  const settings = getSettings();
  if (!settings.apiKey) throw new Error('尚未配置 API Key，请先到「设置」页填写');
  const body = { model, messages, temperature: 0.3 };
  if (useTools) { body.tools = CHAT_TOOLS; body.tool_choice = 'auto'; }
  const resp = await fetch(GLM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + settings.apiKey },
    body: JSON.stringify(body)
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = (data && data.error && data.error.message) || `HTTP ${resp.status}`;
    throw new Error(msg);
  }
  return data;
}

function renderChat() {
  const box = $('chatList');
  if (!box) return;
  const h = chatHistory();
  box.innerHTML = '';
  if (!h.length) {
    const tip = document.createElement('div');
    tip.className = 'msg ai';
    tip.textContent = '你好！我是内置日程助手，可以直接帮你添加、修改、完成、删除日程。试试：\n· 明天下午3点提醒我交作业\n· 这周六有什么安排？\n· 把买牛奶改成周五晚上\n· 清空所有已完成事项';
    box.appendChild(tip);
    return;
  }
  for (const m of h) {
    if (m.role === 'user') {
      box.appendChild(mkMsg('user', m.content));
    } else if (m.role === 'assistant') {
      if (Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          box.appendChild(mkMsg('action', '🔧 ' + (CHAT_TOOL_LABELS[tc.function.name] || tc.function.name)));
        }
      }
      if (m.content) {
        const bubble = mkMsg(m.content.startsWith('⚠️') ? 'ai error' : 'ai', m.content);
        box.appendChild(bubble);
      }
    } else if (m.role === 'tool') {
      try {
        const r = JSON.parse(m.content);
        if (r && r.ok === false) box.appendChild(mkMsg('action result-fail', '✘ ' + (r.error || '失败')));
        else box.appendChild(mkMsg('action result-ok', '✔ 已执行'));
      } catch (e) { /* 忽略无法解析的工具结果 */ }
    }
  }
  box.scrollTop = box.scrollHeight;
}
function mkMsg(cls, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + cls;
  div.textContent = text;
  return div;
}

let chatBusy = false;
async function chatSend() {
  const input = $('chatInput');
  const text = input.value.trim();
  if (!text || chatBusy) return;
  const s = getSettings();
  if (!s.apiKey) { toast('请先到「设置」页填写 API Key'); showPage('page-settings'); return; }
  input.value = '';
  const h0 = chatHistory();
  h0.push({ role: 'user', content: text });
  setChatHistory(h0);
  renderChat();
  chatBusy = true;
  $('btnChatSend').disabled = true;
  try {
    for (let round = 0; round < 6; round++) {
      const msgs = [{ role: 'system', content: chatSystemPrompt() }, ...sanitizeChatHistory(chatHistory())];
      const resp = await callGLMRaw(s.textModel, msgs, true);
      const msg = resp.choices[0].message;
      const h = chatHistory();
      h.push(msg);
      setChatHistory(h);
      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
        renderChat();
        for (const tc of msg.tool_calls) {
          let result;
          const fn = CHAT_ACTIONS[tc.function.name];
          if (!fn) result = JSON.stringify({ ok: false, error: '未知操作' });
          else {
            try { result = await fn(JSON.parse(tc.function.arguments || '{}')); }
            catch (e) { result = JSON.stringify({ ok: false, error: e.message }); }
          }
          const h2 = chatHistory();
          h2.push({ role: 'tool', tool_call_id: tc.id, content: result });
          setChatHistory(h2);
          renderChat();
        }
        continue;
      }
      break;
    }
  } catch (err) {
    const h = chatHistory();
    const last = h[h.length - 1];
    if (last && last.role === 'assistant' && Array.isArray(last.tool_calls)) {
      for (const tc of last.tool_calls) h.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ ok: false, error: err.message }) });
    }
    h.push({ role: 'assistant', content: '⚠️ 请求失败：' + err.message });
    setChatHistory(h);
  } finally {
    chatBusy = false;
    $('btnChatSend').disabled = false;
    renderChat();
  }
}

/* 历史清洗：防止截断产生孤立 tool 消息（会导致 API 400） */
function sanitizeChatHistory(list) {
  const out = [];
  for (const m of list) {
    if (m.role === 'tool') {
      const prev = out[out.length - 1];
      if (prev && prev.role === 'assistant' && Array.isArray(prev.tool_calls) && prev.tool_calls.some((tc) => tc.id === m.tool_call_id)) out.push(m);
      continue;
    }
    out.push(m);
  }
  return out;
}

$('btnChatSend').onclick = chatSend;
$('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') chatSend(); });
$('btnChatClear').onclick = () => {
  store.set('chatHistory', []);
  renderChat();
  toast('已开始新对话');
};

/* ============ 详情面板 ============ */
let detailId = null;

function tsToLocalInput(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function localInputToTs(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{4})-(\d{1,2})-(\d{1,2})T(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function openDetail(id) {
  const t = getTodos().find((x) => x.id === id);
  if (!t) return;
  if (!$('detailMask').hidden && detailId === id) return;
  detailId = id;
  $('dTitle').value = t.title;
  $('dDetail').value = t.detail || '';
  $('dDue').value = tsToLocalInput(t.due);
  $('dCreated').textContent = fmtDate(t.createdAt);
  $('dToggleDone').textContent = t.done ? '标记为未完成' : '标记完成';
  /* v1.8.7：有原始来源（粘贴的文字 / 图片 / 文件）时显示查看入口 */
  const sg = $('dSrcGroup');
  if (sg) sg.hidden = !(Array.isArray(t.srcs) && t.srcs.length);
  $('detailMask').hidden = false;
}
function closeDetail() {
  $('detailMask').hidden = true;
  detailId = null;
}

/* ============ 原始来源查看（v1.8.7） ============ */
function openSourceViewer() {
  if (detailId == null) return;
  const t = getTodos().find((x) => x.id === detailId);
  const srcs = t && Array.isArray(t.srcs) ? t.srcs : [];
  const body = $('srcBody');
  if (!body) return;
  if (!srcs.length) { toast('这一项没有保存原始来源'); return; }
  body.innerHTML = srcs.map((s) => {
    const title = s.kind === 'image' ? '🖼️ ' + escapeHtml(s.name || '图片')
      : s.kind === 'file' ? '📄 ' + escapeHtml(s.name || '文件')
      : '📝 ' + escapeHtml(s.name || '粘贴的文字');
    let content = '';
    if (s.kind === 'image') {
      content = s.tooLarge
        ? '<p class="src-note">原图过大，未随日程保存（仅保留 AI 解析结果）。</p>'
        : '<img class="src-img" src="' + s.dataUrl + '" alt="原图">';
    } else {
      const txt = String(s.text || '');
      content = '<pre class="src-text">' + escapeHtml(txt.slice(0, 20000)) +
        (txt.length > 20000 ? '\n…（内容过长，仅显示前 20000 字）' : '') + '</pre>';
    }
    return '<div class="src-item"><div class="src-title">' + title + '</div>' + content + '</div>';
  }).join('');
  $('srcMask').hidden = false;
}
function closeSourceViewer() { $('srcMask').hidden = true; }

$('dSrcView').onclick = openSourceViewer;
$('srcClose').onclick = closeSourceViewer;
$('srcMask').addEventListener('click', (e) => { if (e.target === $('srcMask')) closeSourceViewer(); });

$('detailClose').onclick = closeDetail;
$('detailMask').addEventListener('click', (e) => { if (e.target === $('detailMask')) closeDetail(); });

$('dSave').onclick = async () => {
  if (detailId == null) return;
  const todos = getTodos();
  const t = todos.find((x) => x.id === detailId);
  if (!t) return closeDetail();
  const title = $('dTitle').value.trim();
  if (!title) { toast('标题不能为空'); return; }
  const newDue = localInputToTs($('dDue').value);
  t.title = title;
  t.detail = $('dDetail').value.trim();
  if (newDue !== t.due) {
    await cancelNotification(t);
    t.due = newDue;
    t.remind = !!newDue;
    t.notifyId = newDue ? await scheduleNotification(t) : null;
  }
  saveTodos(todos);
  closeDetail();
  renderSchedule();
  toast('已保存');
};

$('dToggleDone').onclick = async () => {
  if (detailId == null) return;
  const todos = getTodos();
  const t = todos.find((x) => x.id === detailId);
  if (!t) return closeDetail();
  setDone(t, !t.done);
  if (t.done) await cancelNotification(t);
  saveTodos(todos);
  closeDetail();
  renderSchedule();
};

$('dDelete').onclick = async () => {
  if (detailId == null) return;
  if (!confirm('确定删除这一项吗？')) return;
  const todos = getTodos();
  const t = todos.find((x) => x.id === detailId);
  if (t) await cancelNotification(t);
  saveTodos(todos.filter((x) => x.id !== detailId));
  closeDetail();
  renderSchedule();
  toast('已删除');
};

/* ============ 启动 ============ */
(async function init() {
  applyTheme(getThemeMode());
  purgeOldSources(); /* v1.8.8：完成满 1 天的日程，原始来源自动清理 */
  loadSettingsUI();
  renderSchedule();
  await ensureNotifyPermission();
  await ensureChannels();
  updateTodayBar();
  // v1.3.0：点按常驻通知后自动恢复，保证通知不消失
  try {
    const ln = LN() || (window.Capacitor && window.Capacitor.registerPlugin ? window.Capacitor.registerPlugin('LocalNotifications') : null);
    if (ln && ln.addListener) {
      ln.addListener('localNotificationActionPerformed', (ev) => {
        const nid = ev && ev.notification && ev.notification.id;
        if (nid == TODAY_BAR_ID) updateTodayBar();
      });
    }
  } catch (e) {}
  // v1.5.4：硬件返回键接管（详情页→关闭；设置子页→回设置主页；其余标签页→退到后台）
  try {
    const AppP = window.Capacitor && window.Capacitor.registerPlugin ? window.Capacitor.registerPlugin('App') : null;
    if (AppP && AppP.addListener) {
      AppP.addListener('backButton', () => {
        // v1.7.0：课程详情弹层优先关闭
        const cm = $('courseMask');
        if (cm && !cm.hidden) {
          try { window.CourseSync.closeCourseDetail(); } catch (e) { cm.hidden = true; }
          return;
        }
        if (!$('srcMask').hidden) { closeSourceViewer(); return; }
        if (!$('detailMask').hidden) { closeDetail(); return; }
        if (!$('settingsSub').hidden) { closeSettingsSub(); return; }
        try {
          if (typeof AppP.moveTaskToBack === 'function') AppP.moveTaskToBack();
          else if (typeof AppP.minimizeApp === 'function') AppP.minimizeApp();
          else if (typeof AppP.exitApp === 'function') AppP.exitApp();
        } catch (e) {}
      });
    }
  } catch (e) {}
  // 回到前台时刷新常驻通知（被系统清理后自动恢复）
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      purgeOldSources(); /* v1.8.8：每次回到前台检查一次来源清理 */
      refreshTodayBar();
      /* v1.8.14：回到前台先取回后台同步结果，再对账课程日程（课表临时调整也能生效） */
      try {
        if (window.CourseSync && window.CourseSync.pullNativeState) {
          window.CourseSync.pullNativeState().then(function () {
            try { window.CourseSync.rollSessions(); } catch (e) {}
            try { renderSchedule(); } catch (e) {}
            try { refreshTodayBar(); } catch (e) {}
          });
        } else if (window.CourseSync && window.CourseSync.rollSessions) {
          window.CourseSync.rollSessions();
        }
      } catch (e) {}
      /* v1.7.0：滚动续排课程提醒（窗口=当天+3天，由每日自动同步滚动续排；打开 App 也会补排） */
      try {
        if (window.CourseSync && window.CourseSync.getSettings().enabled && window.CourseSync.getList().length) {
          window.CourseSync.scheduleCourseNotifications();
        }
      } catch (e) {}
    }
  });
  /* v1.8.13：跨零点自动补新一天的课程日程。
     课程日程按「当天 + 3 天」滚动展开，若 App 长时间挂在后台/前台跨过零点，
     这里检测到日期变化就立刻补足，保证任何时候都有未来三天的课程日程。 */
  let lastRollDay = fmtDayKey(Date.now());
  setInterval(() => {
    const today = fmtDayKey(Date.now());
    if (today === lastRollDay) return;
    lastRollDay = today;
    try { if (window.CourseSync && window.CourseSync.rollSessions) window.CourseSync.rollSessions(); } catch (e) {}
    try { renderSchedule(); } catch (e) {}
    try { refreshTodayBar(); } catch (e) {}
    try {
      if (window.CourseSync && window.CourseSync.getList().length) window.CourseSync.scheduleCourseNotifications();
    } catch (e) {}
  }, 60000);
  if (!getSettings().apiKey) {
    setTimeout(() => toast('首次使用：请到「设置」页填写智谱 API Key', 3500), 600);
  }
})();
