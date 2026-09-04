# CLAUDE.md — 筝一侧小助理管理看板

> 本文件供接手开发的 coding agent 阅读。读完即可上手继续开发。

## 1. 项目背景

筝一团队承担算法需求承接、数据集构建、数据收集下发、评测规则制定、模型评测与报告交付等工作。团队规模扩大后存在**任务分配不均、过程不透明、部分任务拖延难识别**的问题，且任务数据目前散落在多个钉钉表格中，靠人工维护、易丢失、难统计。

老板已确认核心链路无问题，要求**把任务下发台账和回扫台账一并做成可视化线上登记系统**，让管理者实时掌握各小组、各成员的任务负荷、进度、延期与积压。

**核心原则**：以自动留痕为主、人工输入极少。小助理每个任务只需做两件事——上传交付文档、打 1–5 星难度分。其余数据自动采集。

## 2. 关键业务概念

### 2.1 小助理工作内容边界

| 工作内容 | 产出物 | 看板是否跟踪 |
|---------|--------|-------------|
| 承接算法需求 | ——（任务起点） | 自动 |
| 撰写规则文档 | 规则文档/SOP | 小助理上传 |
| 撰写数据收集需求文档 | 需求文档 | 小助理上传 |
| 数据分析 | 体现在评测报告中 | 自动 |
| 撰写评测报告 | 评测报告 | 小助理上传 |
| 组长带教 | ——（管理行为） | 暂不纳入 |

### 2.2 小组与成员（真实分组，硬编码在 `src/constants/index.ts` 的 `TEAM_MEMBERS`）

| 小组 | 成员 | 组长 |
|------|------|------|
| 业务助理B组 | 李杨、程晔、陈婧、廖嘉裕、叶子涵 | 李杨 |
| 业务助理C组 | 王星宇、郑倩君、成妍、刘美彤、牛佳欣、徐金云 | 王星宇 |
| 业务助理D组 | 钱杭琪、齐曼夷、桂丽丹、高翔 | 钱杭琪 |

### 2.3 四步核心链路（设计基线，勿偏离）

1. **任务获取**：从任务台账抓取（或与智能调度联动）→ 创建任务，含起始点、组别、组长、主负责人
2. **过程跟踪**：交付侧上传文档 + 标注平台接口同步进度并可视化
3. **交付归档**：交付侧流程结束后，小助理上传规则/评测报告等归纳性文档并为任务打难度星级
4. **兜底（回扫）**：规则变更等导致数据回扫，通过回扫台账抓取变更，更新原任务进度和交付时间

### 2.4 原始数据来源（两张钉钉台账，后续要迁移进系统）

| 台账 | 用途 | 关键字段 |
|------|------|---------|
| 任务包留存台账 `alidocs.../AR4GpnMqJzKpOoklFkPpQ9NN8Ke0xjE3` | 任务下发来源 | 日期、任务归属、任务分组、作业性质、任务名称、任务ID、数据量级、作业人力、下发时间、对应任务组长、数据报告同学、对应验收同学 |
| 借调台账 `alidocs.../YQBnd5ExVEjea40qCbgprjKlJyeZqMmz` | 回扫/变更兜底 | 日期、姓名、对接业务助理、协助量级、任务类型/名称、产出结果、是否验收、验收是否通过 |

> 任务归属主要两类：`AI试穿-模型评测`、`Lookie-横向评测`。任务分组见 `TASK_GROUPS`。

## 3. 系统设计（六大模块）

| 模块 | 定位 | 实现状态 |
|------|------|---------|
| 任务下发登记 | 表单替代钉钉任务台账，统一入口 | ✅ TaskRegister 页面 |
| 标注进度跟踪 | 对接内部标注平台 API 自动同步 | ⚠️ 接口未拿到，进度走 Mock |
| 回扫/变更登记 | 表单替代借调台账 | ✅ RescanLog 页面 |
| 文档管理 | 上传入口+自动判定齐套度 | ✅ TaskDetail 内含上传弹窗 + 齐套度逻辑 |
| 可视化看板 | 总览/流转/负荷/详情/台账 | ✅ 6 个页面 |
| 异常预警 | 逾期/停滞/文档缺失等规则 | ⚠️ 规则在 utils，触发推送未接 |

### 管理总览页（重点，用户最新调整）

总览页按 B/C/D 三组分组展示，每组显示周度/月度/季度工作量，字段精简：下发任务数 / 已完成 / 数据量。底部一张汇总表。详见 `src/pages/Overview/index.tsx` 和 `src/services/statsService.ts` 的 `getTeamWorkloads()`。

### 任务状态流转

```
待开始 → 进行中 → 数据完成 → 待交付 → 待验收 → 已完成
        （异常关注为附加标签，不改主状态）
```
流转逻辑见 `src/utils/status.ts` 的 `computeNextStatus()`：进度=0→待开始；>0→进行中；=100%→数据完成；文档齐套=100%→待验收；验收通过→已完成。

### 难度星级换算（`DIFFICULTY_POINTS`）

| 星级 | 1 | 2 | 3 | 4 | 5 |
|------|---|---|---|---|---|
| 点数 | 1 | 2 | 3 | 5 | 8 |

### 文档类型与任务类型映射（`REQUIRED_DOCS`）

数据集构建→[需求,数据导出]；数据收集标注→[规则,数据导出,质检]；评测规则制定→[规则]；模型评测→[规则,评测报告]；全流程评测→[需求,规则,评测报告]；专项分析→[分析报告]。

## 4. 技术栈与平台约束（1d 平台，必须遵守）

- **平台**：阿里 1d 平台（OneDay）。仓库：`code.alibaba-inc.com/OneDayAI-RPIVBGR/1BdWjPpO`，分支 `onedaybot-dev`
- **前端**：React 18 + TypeScript + Ant Design 5 + ECharts
- **构建**：webpack 5 + webpack-dev-server **4.x**（**禁用 Vite**，WebContainer 不兼容 rollup wasm）
- **路由**：**必须 HashRouter**（禁用 BrowserRouter，刷新会 404）
- **端口**：webpack-dev-server 固定 3015，Express 3020，云函数 9000
- **数据库 SDK**：必须用 `@ali/oneday-frontend-sdk`（**禁用直接用 @supabase/supabase-js**）。SDK 经 `window.oneday` 注入，webpack externals 用 `var` 前缀格式（**禁用 commonjs**，发布后 iframe 无 require）
- **包管理**：代码里写好 package.json，在 1d 平台用 `anpm install`（不是 npm/pnpm）
- **产物**：`bundle.html` 必须输出到项目根目录
- **1d 网关 HMR 兼容**：webpack devServer 必须配 `client.webSocketURL: 'auto://0.0.0.0:0/ws'` + `allowedHosts: 'all'`，否则预览空白

> 平台规范详见 `~/.claude/skills/1d-platform-dev/`（webcontainer.md、oneday-cloud.md）。当前项目仓库保留了 1d 脚手架必需文件：`.npmrc`、`.assets_mapping`、`.gitignore`，**勿删**。

## 5. 代码结构

```
├── index.html                  # 根目录（1d 要求，含 oneday polyfill）
├── webpack.config.js           # port:3015, HashRouter兼容, externals var前缀, webSocketURL
├── package.json                # 依赖（antd/echarts/dayjs/react-router，无 @ali/sdk 走externals）
├── tsconfig.json / .babelrc
├── database/schema.sql         # 建表SQL（开通OneDay Cloud后执行）
├── server/index.js             # Express:3020，对外API预留（供大系统调用）
└── src/
    ├── index.tsx / App.tsx     # 入口 + HashRouter 路由
    ├── onedaycloud/             # SDK 初始化（带容错+2s延迟重试）
    ├── constants/index.ts       # 全部枚举：状态/类型/小组/成员/难度点/必需文档/任务分组
    ├── types/index.ts           # TypeScript 类型
    ├── mock/                    # Mock 数据（任务/成员/文档/回扫）
    ├── services/
    │   ├── db.ts               # ⭐ USE_MOCK 开关——切真实数据库改这里
    │   ├── taskService.ts       # 任务 CRUD（Mock/真实分支）
    │   ├── documentService.ts   # 文档 CRUD + 齐套度计算
    │   ├── rescanService.ts     # 回扫 CRUD
    │   └── statsService.ts      # 小组周/月/季度工作量统计 + 总览指标
    ├── utils/                   # status.ts(状态流转) + metrics.ts(指标计算)
    ├── components/              # Layout/TaskCard/StatusTag/DifficultyStars
    └── pages/                   # Overview/Kanban/Workload/TaskRegister/TaskDetail/RescanLog
```

## 6. 数据层架构（最重要的设计）

**Mock 与真实数据源一键切换**。所有 service 函数内部判断 `USE_MOCK`：
- `true`（当前）：读写 `src/mock/` 内存数据，页面零外部依赖即可跑
- `false`（开通云服务后）：调用 `oneday.supabase.from('表').select/insert/update`

**切换点只有一个**：`src/services/db.ts` 的 `USE_MOCK = true` 改为 `false`。页面代码无需改动。

## 7. 当前进度

### ✅ 已完成
- 项目骨架（webpack/babel/ts/路由/Layout）
- 全部 6 个页面 UI（含 Mock 数据可交互）
- 数据层（Mock + Service + SDK 预留）
- 建表 SQL（tasks/documents/progress_snapshots/rescan_records/alerts，含 RLS）
- 管理总览改为按 A/B/C/D 四组 × 周/月/季度展示
- Express 对外 API 预留（/api/tasks、/api/members/workload 等）
- 代码已推送到 onedaybot-dev 分支

### ⚠️ 未完成 / 待接入
1. **OneDay Cloud 未开通**：当前 `USE_MOCK=true`。需在 1d 平台「项目设置→数据库→开启 OneDay Cloud」，执行 `database/schema.sql`，然后把 `db.ts` 的 `USE_MOCK` 改 false
2. **标注平台接口未对接**：需拿到内部自研标注平台 API 文档，写定时云函数每 2h 同步进度写入 `progress_snapshots` 表（同步逻辑骨架见原计划，未落地为代码）
3. **预警推送未实现**：预警规则在 `utils`，但钉钉工作通知推送未接
4. **历史数据迁移**：从两张钉钉台账导入未做
5. **与智能调度系统嵌入**：页面路由已独立可访问（#/overview 等），对外 API 已预留，待与大系统确认嵌入方式（iframe / API）

## 8. 本地运行

```bash
anpm install          # 1d 平台用 anpm；本地可用 npm
npm run dev           # = webpack serve，访问 http://localhost:3015
# 公网预览（云沙箱）：用 port-mapping skill 取 3015 的公网 URL
```

## 9. 部署到 1d 平台

1. 在 1d 平台创建/导入项目，拉取 onedaybot-dev 分支代码
2. `anpm install`
3. `npm run dev` 预览验证
4. 项目设置 → 数据库 → 开启 OneDay Cloud
5. 执行 `database/schema.sql` 建表
6. `src/services/db.ts` 改 `USE_MOCK = false`
7. 发布

## 10. 接手开发的注意事项

- **改小组/成员**：只改 `src/constants/index.ts` 的 `TEAM_MEMBERS` / `TEAM_LEADERS`，mock 成员数据由 `src/mock/members.ts` 自动派生，勿手写
- **改任务类型/必需文档**：改 `REQUIRED_DOCS` 和 `TaskType` 枚举
- **Mock 数据要覆盖各状态**：改 `src/mock/tasks.ts`，确保每种 TaskStatus、每种预警都有样本，否则总览/看板空
- **总览时间口径**：`getTeamWorkloads` 用 `dayjs('2026-08-02')` 作 TODAY 写死，接手后改成 `dayjs()` 动态
- **新增页面**：在 `src/App.tsx` 加 Route + `src/components/Layout/index.tsx` 加菜单项
- **不要**引入 Vite / BrowserRouter / @supabase/supabase-js 直接调用 / 删除 .npmrc+.assets_mapping

## 11. 相关文档

- 简化版 PRD：`小助理管理看板_简化版PRD.md`（项目根目录，本次未上传仓库，本地保留）
- 全链路设计钉钉文档：https://alidocs.dingtalk.com/i/nodes/o14dA3GK8gKv96jLUnvORbDn89ekBD76
- 原始需求 PRD（钉钉）：https://alidocs.dingtalk.com/i/nodes/YMyQA2dXW7lQwnevsZZbgxKjVzlwrZgb
- 1d 平台开发规范：`~/.claude/skills/1d-platform-dev/`
