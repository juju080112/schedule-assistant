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
- 卡片交互：左上角圆圈 = 标记完成，右上角 ✕ = 删除（有确认），点卡片看详情；详情页可一键复制标题和备注
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
- 活动截图会先看报名状态：出现「取消报名 / 已报名 / 报名成功」说明你已报名，生成「参加活动」提醒（用活动开始时间），不会误生成报名截止事项
- 提示词会注入**当前时间**，因此「明天」「周五」「下周三」都能换算成具体日期
- 保存前可逐条删除；同一条活动重复解析会**自动合并**成一条，详情取两次的并集
- 保存后可在详情里 **查看原文件**（保留当时粘贴的原文 / 上传的图片 / 文件文本）
- 长按文字时只有日程/结果/聊天/课表内容可选中，UI 按钮和标签不会被「全选」选中

### 📅 课程表（教务同步）
- 点课程表页**右上角「同步」** → 弹出教务窗口，**你在窗口里亲手完成统一身份认证** → 自动读取课表
- **排版对齐「我的科大」(MyUSTC)**：一周从**周日在最左**排到周六（与教务处教学日历一致，日期从左到右递增）；
  没有左侧时间轴，每张课卡自带**起始时间 / 课程名 / 教师 / 节次 / 地点 / 结束时间**，
  同一门课恒定一种马卡龙底色 + 同色系描边，可翻周、本周高亮、点课卡看完整信息
- **逐周正确**：按教务返回的周次数据展开（含单双周），不同周次的课不同
- **遵循官方校历**：调课日与放假日会标注在日期旁（如 `9/20 · 补周五课`、`9/25 · 休`），课程表、日程与提醒三者一致。
  调课日取「**当天教务排的课 ∪ 调课目标星期的课**」的并集（同门同节次去重）：
  教务系统自己会把补课排成当天的活动（对 MyUSTC 的静态分析证实它只画 `weekday + weeksArray`、
  全 App 无校历无调休表，10/10 正确是因为教务返回的那条活动本来就是周六且周次含第 6 周），
  所以两边都收才不会漏——只认调课星期会漏掉教务已挪走的课（2026-10-10 格子空白的真因），
  只认当天又会漏掉教务没挪走的那部分
- **每节课独立成条**：可单独完成、单独删除；课表临时调整后重新同步会**自动对账**（时间地点变化就地更新、取消的删除、新增的补建）
- **「全」视图**：周次条最右边的「全」→ 整学期课程清单（按星期分组，显示起止时间/节次/教师/地点/周次区间），再点回到周网格
- **自定义时间的活动不会漏**：教务把研讨课这类活动返回成「节次 0 + 起止时刻」（实测「“科学与社会”研讨课」= 周一 11:30–13:30、仅第 5 周）。
  解析器与 MyUSTC 同款降级链：先用 `startDate/endDate` 的时刻反推节次落位，卡片上显示**真实时刻**而不是编造的课表时间
- **提醒不再依赖每日重算**：网页层会把未来 **14 天**的精确排程计划（含调课日并集、自定义时间活动的真实时刻）推给原生，
  原生只按绝对时间排闹钟。每天 06:30 仍会后台静默同步课表；即使几天不打开 App，已排的提醒也不会断
  （若课表在 App 未打开时发生变化，提醒会在下次打开 App 后按新计划更新）

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
- **数据管理**：清空所有数据；**导出课表诊断文件**（把原始课表 JSON 与解析结果写到
  `Android/data/com.aitodo.app/files/`，排查「课表/日程对不上」用；只含课程信息，不含账号密码 Cookie）。
  自动化场景也可以直接用 adb 触发，不必进设置界面：
  `adb shell am start -a com.aitodo.app.EXPORT_DIAG -n com.aitodo.app/.MainActivity`

---

## AI 配置

v1.9.8 起不再绑定智谱，支持**多提供方 + 自定义**。协议支持：

- **OpenAI Chat Completions**：兼容绝大多数服务（OpenAI、智谱、DeepSeek、Kimi、Qwen、Gemini 兼容端点、SiliconFlow、OpenRouter、Ollama、LM Studio、自定义）
- **Anthropic Messages**：Claude 原生协议

### 内置提供方

| 提供方 | Base URL | 文本模型示例 | 图片模型示例 |
|---|---|---|---|
| 智谱 BigModel | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` / `glm-4-air` / `glm-4-plus` | `glm-4v-flash` / `glm-4v-plus` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` / `gpt-4o` / `gpt-4.1-mini` / `o4-mini` | `gpt-4o-mini` / `gpt-4o` |
| Anthropic Claude | `https://api.anthropic.com/v1`（Anthropic 协议） | `claude-sonnet-4-5` / `claude-haiku-4-5` / `claude-opus-4-1` | 同左 |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` / `gemini-2.5-pro` | 同左 |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-flash` / `deepseek-v4-pro` | `deepseek-flash`（支持图片） |
| Moonshot Kimi | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` / `kimi-latest` | `moonshot-v1-8k-vision-preview` |
| 阿里云百炼 Qwen | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` / `qwen-max` | `qwen-vl-plus` / `qwen-vl-max` |
| 火山方舟 Doubao | `https://ark.cn-beijing.volces.com/api/v3` | 模型名或推理接入点 ID | 按账号可用模型填写 |
| 硅基流动 SiliconFlow | `https://api.siliconflow.cn/v1` | `deepseek-ai/DeepSeek-V3` 等 | `Qwen/Qwen2-VL-72B-Instruct` 等 |
| OpenRouter | `https://openrouter.ai/api/v1` | `openai/gpt-4o-mini`、`anthropic/claude-sonnet-4.5` 等 | 按 OpenRouter 模型列表 |
| Ollama（本地） | 模拟器 `http://10.0.2.2:11434/v1`；真机填电脑局域网 IP | `llama3.2` / `qwen2.5` | `llava` |
| LM Studio（本地） | 模拟器 `http://10.0.2.2:1234/v1` | `local-model` | 按加载的模型 |
| 自定义 | 任意 OpenAI 兼容 / Anthropic Base URL | 任意模型 ID | 任意模型 ID |

> 预设只是常用建议；模型名可以直接键入。不同账号、不同地区的可用模型可能不同，以服务商控制台为准。

### 怎么配置

1. **设置 → AI 配置 → 模型提供方**，选一个预设或「自定义」
2. 填 **API Key**（本地服务可留空）
3. 填 **接口地址 Base URL**：一般到 `/v1` 或 `/v1beta` 一级；也可以直接粘贴完整的 `.../chat/completions` 或 `.../messages`
4. 填 **文本模型**（必填）和 **图片理解模型**（可留空，留空则只能解析文字）
5. 需要时展开 **高级：额外请求头**，填 JSON（OpenRouter 统计头、Azure 的 `api-key` 等）
6. 点 **保存设置**；点 **测试 API 连通性** 会发一条「请回复连接成功」

### 协议与兼容性

- **OpenAI 兼容**：`POST {Base URL}/chat/completions`，`Authorization: Bearer <key>`；支持 `image_url` 图片和 `tools` 工具调用
- **Anthropic**：`POST {Base URL}/messages`，`x-api-key` + `anthropic-version: 2023-06-01`；system 单独传，图片转 base64，支持 `tool_use` / `tool_result`
- o 系列 / gpt-5 模型不发送 `temperature`，避免 400
- **AI 助手**的工具调用需要模型支持 function calling；**图片解析**需要视觉模型
- 本地 HTTP 仅放行 `localhost` / `127.0.0.1` / `10.0.2.2`（模拟器）；真机访问电脑局域网 IP 需要 HTTPS，或自行修改 `network_security_config.xml`

### Key 与隐私

- **每个提供方的 Key 分开保存在本机** `localStorage` 的 `settings.ai.providers`，切换提供方不会丢；「清空所有数据」会一并删除
- 请求**直接发往你选择的提供方**，不经过本项目作者的任何服务器（本项目没有自建服务器）
- 文字、图片、文件抽取出的文本会随请求发给你选择的提供方；如果不想用 AI，可以只用课表与待办功能
- 旧版智谱配置（`settings.apiKey` / `textModel` / `visionModel`）会在首次打开时自动迁移到「智谱 BigModel」预设

## 隐私说明

- **没有自建服务器**，不收集、不上传任何遥测；日程、课表、对话历史、API Key 全部只存本机
- **教务同步为只读接入**：仅请求课表数据，**零写操作**；登录由用户在系统浏览器内核中亲手完成，应用**不读取、不存储**账号、密码、Cookie、Token；登录会话仅保留在本机内核内、仅供自动同步复用，可一键清除
- **AI 请求**只发往你在 AI 配置里选择的提供方，使用你自己的 Key；每个提供方的 Key 分开保存在本机
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
仓库自带不依赖浏览器与手机的测试台：

- `tools/course-logic-test.js`：在 Node 里桩化 DOM/插件后**直接加载真实的 `www/js/course.js`**，断言课表与校历算法（当前周与调课判定、节假日停课、补课日「教务把课挪到自然星期」的回归、单双周、课程时段、展开窗口、「全」视图、自定义时间活动、对账、后台同步结果采纳、14 天原生排程计划、已完成/已移除节次不排提醒、展开幂等等）共 **62 项**。
- `tools/ai-provider-test.js`：验证模型提供方预设、旧配置迁移、OpenAI / Anthropic 端点与请求头、图片与工具调用转换、响应解析、usage 解析、额外请求头覆盖等 **24 项**。
- `tools/todo-utils-test.js`：验证解析结果去重（同标题同日期）、过期判断、日期解析等 **5 项**。

```bash
node tools/course-logic-test.js
node tools/ai-provider-test.js
# 可选：APP_NOW=2026-10-12T09:00:00+08:00 指定模拟的「今天」（默认 2026-09-20 校庆调课日）
```

两个测试都已接入 CI（`.github/workflows/build-apk.yml`），且跑在 `cap sync` 之前——同步进原生工程的一定是通过自检的代码。

## 项目结构

```
├── www/                        # 前端（无框架：原生 HTML/CSS/JS）
│   ├── index.html              # 五个页面的结构 + 设置子页
│   ├── css/style.css           # 主题变量（浅色/深色）、布局
│   └── js/
│       ├── app.js              # 日程、解析、AI 助手、通知、常驻栏、主题、使用指南
│       ├── ai-providers.js     # 模型提供方预设、协议适配、工具调用/图片转换
│       ├── todo-utils.js       # 解析结果去重、过期判断、日期解析
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
│       ├── res/xml/network_security_config.xml  # 仅放行本机/模拟器回环 HTTP
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
课程日程按「当天 + 3 天」滚动展开，避免历史数据堆积；提醒由网页层生成的 **14 天精确计划**经原生闹钟执行，不依赖应用是否打开。若日程窗口内恰好全是假期，日程页顶部会显示「未来三天无课（假期/无排课）」，不是没生成。

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
- Activity screenshots are checked for registration status first: "cancel registration" / "registered" means you already signed up, so the app creates an attendance reminder at the event start instead of a registration deadline
- The prompt injects the **current time**, so "tomorrow", "Friday" and "next Wednesday" resolve to real dates
- Review and delete items before saving; re-parsing the same event **merges** it into one item
- Every item keeps its **original source** (pasted text / uploaded image / file text), viewable from the detail sheet

### 📅 Timetable (course sync)
- Tap **Sync** at the top-right of the Timetable page; log in **by hand** inside the opened window
- Rendered as a 13-period × 7-day weekly grid with week navigation, today highlight and per-block details
- **Correct per week**: expanded from the week data returned by the registrar (odd/even weeks included)
- **Follows the official academic calendar**: make-up and holiday days are labelled next to the date (e.g. `9/20 · 补周五课`, `9/25 · 休`), keeping the grid, schedule and reminders consistent
- **One independent event per session**: complete or delete them individually; after a timetable change a re-sync **reconciles** (updates moved sessions, removes cancelled ones, adds new ones)
- The web layer pushes a **14-day plan with absolute timestamps** (make-up days and custom-time activities included); native alarms only schedule those times, so reminders keep working even if the app is not opened for days. A daily 06:30 background sync still refreshes the timetable; plan changes take effect the next time the app opens

### 💬 AI assistant
- Manage the schedule in natural language; the model calls tools (list / add / update / complete / reopen / delete / clear completed / toggle today bar / stats)
- Chat history stays on-device (last 60 messages)

### ⚙️ Settings
- **Appearance**: light / dark / follow system
- **AI config**, **Timetable**, **Notifications**, **User guide** (permission self-check + per-brand background whitelisting), **Data management**

## AI configuration

Since v1.9.8 the app is not tied to Zhipu. It supports **multiple providers + custom endpoints**:

- **OpenAI Chat Completions** — works with OpenAI, Zhipu, DeepSeek, Kimi, Qwen, Gemini's OpenAI-compatible endpoint, SiliconFlow, OpenRouter, Ollama, LM Studio and custom services
- **Anthropic Messages** — native Claude protocol

Built-in presets include Zhipu BigModel, OpenAI, Anthropic Claude, Google Gemini, DeepSeek, Moonshot Kimi, Alibaba Qwen, Volcano Doubao, SiliconFlow, OpenRouter, Ollama, LM Studio and **Custom**. Preset model IDs are suggestions only; every model field is free text.

### Setup

1. **Settings → AI config → Provider**, pick a preset or Custom
2. Enter the **API key** (local services may leave it empty)
3. Enter the **Base URL** (usually up to `/v1` or `/v1beta`; a full `.../chat/completions` or `.../messages` also works)
4. Enter a **text model** (required) and a **vision model** (optional; leave empty for text-only)
5. Optionally open **Advanced: extra headers** and enter a JSON object (OpenRouter attribution, Azure `api-key`, etc.)
6. **Save**, then **Test connection** (sends "please reply connected")

### Protocols

- **OpenAI-compatible**: `POST {Base URL}/chat/completions`, `Authorization: Bearer <key>`, supports `image_url` and `tools`
- **Anthropic**: `POST {Base URL}/messages`, `x-api-key` + `anthropic-version: 2023-06-01`, system prompt is sent separately, images are converted to base64, and `tool_use` / `tool_result` are supported
- o-series / gpt-5 models do not receive `temperature`
- The AI assistant needs a model that supports function calling; image parsing needs a vision model
- Cleartext HTTP is allowed only for `localhost` / `127.0.0.1` / `10.0.2.2` (emulator); a LAN IP from a real phone needs HTTPS or a network-security-config change

### Keys and privacy

- **Each provider's key is stored separately on-device** in `localStorage` (`settings.ai.providers`); switching providers does not lose it, and "Clear all data" removes it
- Requests go **directly to the provider you select**; there is no server operated by this project
- Text, images and extracted file text are sent to that provider. If you prefer not to use AI, the timetable and todo features work without it
- An old Zhipu config (`settings.apiKey` / `textModel` / `visionModel`) is migrated to the Zhipu preset on first launch

## Privacy

- No backend, no telemetry; todos, timetable, chat history and per-provider API keys live on-device
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
The repo ships two Node test harnesses:

- `tools/course-logic-test.js` stubs the DOM/plugins and loads the **real** `www/js/course.js`, asserting 62 cases around the timetable and academic-calendar logic.
- `tools/ai-provider-test.js` verifies provider presets, legacy migration, OpenAI / Anthropic endpoints and headers, image and tool-call conversion, response parsing and custom headers (22 cases).

```bash
node tools/course-logic-test.js
node tools/ai-provider-test.js
node tools/todo-utils-test.js
```

Both run in CI before `cap sync`.

## Adapting to another university

The course sync currently targets the USTC registrar system (`jw.ustc.edu.cn`). Two places matter: `android/app/src/main/assets/course-ustc.js` (the injected fetch/parse script) and `www/js/course.js` (the period start times `SLOT_START` and the week-number rule `weekNoOf` — note that some schools start a week on Sunday, others on Monday).

## License

[MIT](LICENSE)
