# 日程助手 · Schedule Assistant

[![Build APK](https://github.com/juju080112/schedule-assistant/actions/workflows/build-apk.yml/badge.svg)](https://github.com/juju080112/schedule-assistant/actions/workflows/build-apk.yml)

> 一个**本地优先**的 Android 日程应用：AI 把一段通知 / 一张截图 / 一个文件变成日程，并把大学教务系统的课表同步成一条条独立日程，准点提醒。
>
> A **local-first** Android schedule app: AI turns a notice, a screenshot or a document into calendar items, and syncs your university timetable into individual, independently-manageable events with on-time reminders.

[中文说明](#中文说明) · [English](#english)

---

# 中文说明

## 这是什么

日程助手把「看到一条通知 → 记下来 → 到点提醒我」这条链路自动化：

1. **解析**：把群通知、会议纪要、通知单截图、PDF/Word 直接丢进来，AI 输出结构化日程；
2. **课表**：从教务系统只读同步整学期课表，按周次展开成**每一节课一条独立日程**；
3. **提醒**：准点 + 提前 1 小时，通知栏与锁屏常驻「今日日程」；
4. **闭环**：完成、删除、清理都在本机完成，没有服务器，没有账号体系。

> 本项目为**个人开源项目，与任何高校官方无关**，未获得也未暗示任何学校的背书，仓库内不含任何学校标识素材。请勿使用校名、校徽等标识性素材二次分发。

## 功能

### ⏰ 日程
- 待办与课程合并成一条时间线：按天分组、天内按时间排序
- 卡片交互：左上角圆圈 = 标记完成，右上角 ✕ = 删除，点卡片看详情
- 「已完成」区常显（按时间排序），支持**一键清理**（连同附件原文一起删）
- 提醒时机：**开始时准点提醒 + 开始前 1 小时预提醒**
- **常驻日程栏**：通知栏与锁屏常驻显示当天日程，上课期间显示「正在上课 · 08:00-09:35 高等数学 @二教101」

### ✨ 智能解析
| 输入 | 处理方式 |
|---|---|
| 文字 | 直接交给文本模型，可粘贴聊天记录、会议纪要、邮件正文 |
| 图片 | 本机压缩后交给视觉模型（通知截图、白板、纸质通知单） |
| 文件 | PDF 用 pdf.js、Word(docx) 用 mammoth 在**本机**抽取文本；另支持 txt / md / csv / json |

- 三类输入可混用；输出严格 JSON（`title` / `detail` / `due` / `remind`）
- 提示词会注入**当前时间**，因此「明天」「周五」「下周三」都能换算成具体日期
- 保存前可逐条删除；同一条活动重复解析会**自动合并**成一条，详情取两次的并集
- 保存后可在详情里 **查看原文件**（保留当时粘贴的原文 / 上传的图片 / 文件文本）

### 📅 课程表（教务同步）
- 点课程表页**右上角「同步」** → 弹出教务窗口，**你在窗口里亲手完成统一身份认证** → 自动读取课表
- 渲染成 13 节 × 7 天的周课表网格，可翻周、本周高亮、点课程块看时间/地点/教师/日期
- **逐周正确**：按教务返回的周次数据展开（含单双周），不同周次的课不同
- **遵循官方校历**：调课日与放假日会标注在日期旁（如 `9/20 · 补周五课`、`9/25 · 休`），课程表、日程与提醒三者一致
- **每节课独立成条**：可单独完成、单独删除；课表临时调整后重新同步会**自动对账**（时间地点变化就地更新、取消的删除、新增的补建）
- 每天定时后台静默同步一次并滚动续排未来 3 天的提醒

### 💬 AI 助手
- 一句话增删改查日程：「明天下午 3 点提醒我交作业」「把高数作业标记完成」
- AI 通过工具调用直接操作数据（查询 / 新增 / 修改 / 完成 / 恢复 / 删除 / 清空已完成 / 开关常驻栏 / 统计）
- 对话历史仅存本机（保留最近 60 条），右上角可开新对话

### ⚙️ 设置
- **外观**：浅色 / 深色 / 跟随系统
- **AI 配置**：API Key、文本模型、图片理解模型、连通性测试（见下节）
- **课表同步**：隐私说明、已同步课表预览、开关、清除本地课表数据
- **通知与提醒**：常驻今日日程栏开关
- **使用指南**：权限自检（通知 / 精确闹钟 / 电池白名单，一键跳系统设置）+ 各品牌后台放行步骤
- **数据管理**：清空所有数据

---

## AI 配置

本项目使用 **智谱 AI（Zhipu / 智谱开放平台，bigmodel.cn）** 的开放接口，接口地址写在 `www/js/app.js`：

```js
const GLM_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
```

请求采用 OpenAI 兼容格式，`temperature = 0.3`。可选模型在 `www/index.html` 的下拉框里：

| 用途 | 模型 | 说明 |
|---|---|---|
| **文本**（解析文字/文件、AI 助手多轮对话与工具调用） | `glm-4-flash` | **默认，免费**，日常解析足够 |
| | `glm-4-air` | 更快更强，付费 |
| | `glm-4-plus` | 旗舰，付费 |
| **图片理解**（截图、白板、通知单） | `glm-4v-flash` | **默认，免费** |
| | `glm-4v-plus` | 旗舰，付费 |

默认值：`textModel = glm-4-flash`、`visionModel = glm-4v-flash`（两者都有免费额度）。

### 怎么配置

1. 打开 [open.bigmodel.cn](https://open.bigmodel.cn) → 注册 → 控制台 → **API Keys** → 新建一个 Key（新用户有免费额度）
2. App 内进入 **设置 → AI 配置**
3. 填入 **API Key**，选择文本模型与图片理解模型，点 **保存设置**
4. 可点 **测试 API 连通性** 验证（会发一条「请回复连接成功」）

没有配置 Key 时，解析页与 AI 助手会提示先去设置里填写。

### Key 存在哪里、请求怎么走

- **只存在本机**：`localStorage` 的 `settings.apiKey`，与待办数据放在一起，随「清空所有数据」一起删除
- **直连模型服务商**：请求从你的手机直接发往 `open.bigmodel.cn`，**不经过本项目作者的任何服务器**（本项目没有自建服务器）
- **费用与配额**：走你自己的智谱账号，免费档模型（`glm-4-flash` / `glm-4v-flash`）日常使用足够
- **解析用到的内容**：文字内容、图片、文件抽取出的文本会随请求发给智谱；如果你对此有顾虑，可只用课表功能（课表同步不涉及智谱）

### 想换模型 / 换服务商

- 换取更贵的智谱模型：直接在下拉框里选（或在 `www/index.html` 里增删 `<option>`）
- 换别的服务商：改 `GLM_URL` 与请求格式即可，代码里只有 `callGLM()` / `callGLMRaw()` 两处发请求；注意图片理解需要该服务商支持 OpenAI 兼容的 `image_url` 格式

---

## 隐私说明

- **没有自建服务器**，不收集、不上传任何遥测；日程、课表、对话历史、API Key 全部只存本机
- **教务同步为只读接入**：仅请求课表数据，**零写操作**；登录由用户在系统浏览器内核中亲手完成，应用**不读取、不存储**账号、密码、Cookie、Token；登录会话仅保留在本机内核内、仅供自动同步复用，可一键清除
- **AI 请求**只发往模型服务商（默认智谱），使用用户自己的 Key
- 提供「一键清理已完成」与「清空所有数据」

## 下载与安装

- 到 [Releases](https://github.com/juju080112/schedule-assistant/releases) 下载最新 APK
- 系统要求：**Android 6.0 (API 23) 及以上**
- 首次安装需允许「安装未知来源应用」
- **国产 ROM 请务必按「设置 → 使用指南」放行后台**（自启动、允许后台运行、锁定后台卡片），否则提醒与自动同步可能被系统清掉

## 自行构建

### 环境
- Node.js 18+、JDK 17、Android SDK（compileSdk 35，需 build-tools）
- 无需 Android Studio，命令行即可出包

```bash
npm install                 # 安装依赖
npx cap sync android        # 把 www/ 同步到原生工程（改了 www 必跑）
cd android && ./gradlew assembleRelease    # Windows: gradlew.bat assembleRelease
```

产物：`android/app/build/outputs/apk/release/app-release.apk`

### 签名
仓库**不含**签名密钥。未配置签名时 release 包会自动回落到 debug 签名（仍可安装）。要出正式签名包：

```bash
cp android/keystore.properties.example android/keystore.properties
# 填入你的 keystore 路径与口令（该文件已被 .gitignore 忽略）
```

### 自动构建
仓库内置 GitHub Actions 工作流 [`.github/workflows/build-apk.yml`](.github/workflows/build-apk.yml)：每次 push 到 `main`、或手动触发时自动构建 APK 作为构建产物（Artifacts）上传；推送 `v*` 标签时会**创建 Release**（未配置签名 Secrets 时 Release 只带说明、不附 APK，安装包从 Actions 的 `apk` 产物下载；配置了签名 Secrets 才把 APK 附到 Release）。

签名密钥**不在仓库**，CI 通过 4 个仓库 Secrets 取回（`KEYSTORE_BASE64`、`KEYSTORE_PASSWORD`、`KEY_ALIAS`、`KEY_PASSWORD`，2026-09-24 已配置）→ 推送 `v*` 标签时 CI 构建**正式签名**的 APK 并自动附加到 Release。未配置这些 Secrets 时，产物退化为 debug 签名、只上传为 Artifact（Release 仍会创建，只是不附 APK）。

### 逻辑自检（无需手机）
仓库自带一个不依赖浏览器与手机的测试台：它在 Node 里桩化 DOM/插件后**直接加载真实的 `www/js/course.js`**，断言课表与校历算法（当前周与调课判定、节假日停课、单双周、课程时段、展开窗口、对账不误关、后台同步结果采纳、展开幂等、完成状态保持、删除后不复活、空课表健壮性等 43 项）。

```bash
node tools/course-logic-test.js
# 可选：APP_NOW=2026-10-12T09:00:00+08:00 指定模拟的「今天」（默认 2026-09-20 校庆调课日）
```

该测试台已在 CI（`.github/workflows/build-apk.yml`）里作为独立步骤运行，且跑在 `cap sync` 之前——同步进原生工程的一定是通过自检的代码。

## 项目结构

```
├── www/                        # 前端（无框架：原生 HTML/CSS/JS）
│   ├── index.html              # 五个页面的结构 + 设置子页
│   ├── css/style.css           # 主题变量（浅色/深色）、布局
│   └── js/
│       ├── app.js              # 日程、解析、AI 助手、通知、常驻栏、主题、使用指南
│       └── course.js           # 课表：同步流程、周课表网格、课程日程对账
├── android/                    # Capacitor 原生工程
│   └── app/src/main/
│       ├── java/com/aitodo/app/
│       │   ├── MainActivity.java          # 注册插件
│       │   ├── CourseLoginActivity.java   # 教务登录窗口（只读抓取）
│       │   ├── TimetableSyncService.java  # 每日后台同步（无头 WebView）
│       │   ├── CourseAutoSync.java        # 课程提醒排程（精确闹钟 + 降级）
│       │   ├── CourseAlarmReceiver.java   # 提醒触发
│       │   ├── BootReceiver.java          # 开机续排
│       │   ├── BarService.java            # 常驻通知栏前台服务
│       │   ├── CoursePlugin.java          # 课表同步桥
│       │   ├── SystemPlugin.java          # 权限自检与跳转系统设置
│       │   └── BarPlugin.java             # 常驻栏 / 主题桥
│       └── assets/
│           ├── course-ustc.js             # 注入教务页的抓取脚本（官方接口直取）
│           └── course-extract.js          # 通用 DOM 解析兜底
└── .github/workflows/build-apk.yml
```

## 适配其他学校

教务同步目前只适配**中国科学技术大学新版教务系统**（`jw.ustc.edu.cn`）的数据结构。要适配其他学校，主要改两处：

1. `android/app/src/main/assets/course-ustc.js`：抓取脚本（改成目标学校课表页的接口或 DOM 解析），输出格式为
   ```json
   { "ok": true, "courses": [{ "name": "", "teacher": "", "location": "", "weekday": 1, "startSlot": 1, "endSlot": 2, "weeks": [1,2,3] }], "term": { "week1Sunday": "YYYY-MM-DD" } }
   ```
2. `www/js/course.js` 里的作息表 `SLOT_START`（每小节的开始时间）与周次换算规则（`weekNoOf`，注意不同学校「一周从周日还是周一开始」不同）

## 常见问题

**提醒不准点 / 后台同步不跑？**
Android 12+ 需要「闹钟与提醒」权限，国产 ROM 还需要自启动 + 后台运行白名单。到 **设置 → 使用指南** 按提示逐项打开。

**课表同步失败？**
先确认能在弹出的窗口里正常登录并进入课表页；登录过期时重新同步一次即可。抓取走的是教务官方接口，失败时会回退为页面解析。

**为什么日程里的课表只显示未来几天？**
课程日程按「当天 + 3 天」滚动展开（与提醒窗口一致），避免历史数据堆积；提醒本身由原生侧负责，不依赖应用是否打开。若窗口内恰好全是假期，日程页顶部会显示「未来三天无课（假期/无排课）」，不是没生成。

**课程日程突然不再生成？**（v1.8.20 已修）
三个历史原因：① 每日 06:30 后台同步只更新课表与提醒，课程日程条目要等网页层展开；② 网页层每次启动先 push 后 pull，会把原生较新的同步时间戳覆盖掉，导致后台结果被判为「不新」而丢弃；③ 对账时把「暂时不在窗口内」的节次写进永久关闭名单，之后即使课表恢复也不再生成。
现在：后台同步成功即标记「待展开」并唤起存活的网页层立即展开；同步时间戳单独记账且只增不减；自动对账只移除不关闭，永久关闭只来自用户显式删除/清理。

**耗电吗？**
课程提醒依赖 `AlarmManager` 精确闹钟（不常驻），常驻日程栏由前台服务维持。想要更省电可在设置里关闭「并入常驻日程栏」。

## 许可

[MIT](LICENSE)

---

# English

## What it is

Schedule Assistant automates the path from "I saw a notice" to "it reminded me on time":

1. **Parse** — drop in a group-chat notice, meeting minutes, a screenshot or a PDF/Word file; AI returns structured calendar items.
2. **Timetable** — read-only sync of your university course table, expanded into **one independent event per class session**.
3. **Remind** — on-time plus a 1-hour-ahead pre-alert, with a persistent "today" notification on the lock screen.
4. **Local-only** — complete/delete/cleanup all happen on-device. No server, no account.

> This is a **personal open-source project, not affiliated with any university**. It contains no school logos or branding and implies no endorsement. Please do not redistribute it using institutional marks.

## Features

### ⏰ Schedule
- Todos and classes merged into one timeline, grouped by day and sorted by time
- Card actions: circle at top-left = complete, ✕ at top-right = delete, tap for details
- Always-visible "Completed" section (time-ordered) with **one-tap cleanup** (including stored attachments)
- Reminders: **on time, plus 1 hour before**
- **Persistent today bar** in the notification shade / lock screen, e.g. `In class · 08:00-09:35 Calculus @Room 101`

### ✨ AI parsing
| Input | Handling |
|---|---|
| Text | Sent to the text model (chat logs, meeting notes, emails) |
| Image | Compressed on-device, then sent to the vision model |
| File | PDF via pdf.js and Word (docx) via mammoth are extracted **on-device**; also txt / md / csv / json |

- The three input types can be combined; output is strict JSON (`title` / `detail` / `due` / `remind`)
- The prompt injects the **current time**, so "tomorrow", "Friday" and "next Wednesday" resolve to real dates
- Review and delete items before saving; re-parsing the same event **merges** it into one item
- Every item keeps its **original source** (pasted text / uploaded image / file text), viewable from the detail sheet

### 📅 Timetable (course sync)
- Tap **Sync** at the top-right of the Timetable page; log in **by hand** inside the opened window
- Rendered as a 13-period × 7-day weekly grid with week navigation, today highlight and per-block details
- **Correct per week**: expanded from the week data returned by the registrar (odd/even weeks included)
- **Follows the official academic calendar**: make-up and holiday days are labelled next to the date (e.g. `9/20 · 补周五课`, `9/25 · 休`), keeping the grid, schedule and reminders consistent
- **One independent event per session**: complete or delete them individually; after a timetable change a re-sync **reconciles** (updates moved sessions, removes cancelled ones, adds new ones)
- A daily background sync keeps the next 3 days of reminders rolling

### 💬 AI assistant
- Manage the schedule in natural language; the model calls tools (list / add / update / complete / reopen / delete / clear completed / toggle today bar / stats)
- Chat history stays on-device (last 60 messages)

### ⚙️ Settings
- **Appearance**: light / dark / follow system
- **AI config**, **Timetable**, **Notifications**, **User guide** (permission self-check + per-brand background whitelisting), **Data management**

## AI configuration

This project talks to **Zhipu AI (bigmodel.cn)** using its OpenAI-compatible endpoint:

```js
const GLM_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
```

| Purpose | Model | Note |
|---|---|---|
| Text (parsing, assistant + tool calling) | `glm-4-flash` | default, free tier |
| | `glm-4-air` / `glm-4-plus` | faster/stronger, paid |
| Vision (screenshots, whiteboards) | `glm-4v-flash` | default, free tier |
| | `glm-4v-plus` | flagship, paid |

Setup: create an API key at [open.bigmodel.cn](https://open.bigmodel.cn) → in the app go to **Settings → AI config** → paste the key, choose models, save. A **Test connection** button is provided.

- The key is stored **locally only** (`localStorage`) and is deleted by "Clear all data"
- Requests go **directly from your device to bigmodel.cn**; there is no server operated by this project
- Usage is billed to your own Zhipu account; the `-flash` models are free of charge
- Text, images and extracted file text are sent to Zhipu for parsing. If you prefer not to, you can use the timetable features only

## Privacy

- No backend, no telemetry; todos, timetable, chat history and API key live on-device
- **Course sync is read-only**: GET requests only, zero writes; you log in yourself in the system WebView and the app never reads or stores credentials, cookies or tokens; the session stays in the local WebView and can be cleared with one tap
- **One-tap cleanup** for completed items, plus "Clear all data"

## Download & build

- Grab the latest APK from [Releases](https://github.com/juju080112/schedule-assistant/releases) — requires **Android 6.0 (API 23)+**
- On Chinese OEM ROMs, please whitelist the app for background running via **Settings → User guide**, otherwise reminders may be killed

```bash
npm install
npx cap sync android
cd android && ./gradlew assembleRelease   # Windows: gradlew.bat assembleRelease
```

Output: `android/app/build/outputs/apk/release/app-release.apk`. The repo ships **no signing key**; without one the release build falls back to debug signing. Copy `android/keystore.properties.example` to `android/keystore.properties` to use your own.

A GitHub Actions workflow ([`.github/workflows/build-apk.yml`](.github/workflows/build-apk.yml)) builds the APK on every push to `main` and attaches it to a Release when a `v*` tag is pushed (if no signing secrets are configured, the artifact is named `-debug-signed` and is **not** attached to the Release).

### Logic self-test (no device needed)
The repo ships a test harness that stubs the DOM/plugins in Node and loads the **real** `www/js/course.js`, asserting 31 cases around the timetable and academic-calendar logic (current week and make-up-class detection, holiday suspension, odd/even weeks, lesson times, idempotent expansion, completion persistence, no resurrection after deletion, empty-timetable robustness):

```bash
node tools/course-logic-test.js
```

## Adapting to another university

The course sync currently targets the USTC registrar system (`jw.ustc.edu.cn`). Two places matter: `android/app/src/main/assets/course-ustc.js` (the injected fetch/parse script) and `www/js/course.js` (the period start times `SLOT_START` and the week-number rule `weekNoOf` — note that some schools start a week on Sunday, others on Monday).

## License

[MIT](LICENSE)
