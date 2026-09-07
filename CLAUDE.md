# 筝一小助理作业管理平台：内网接手说明

> 本文件是 coding agent 的快速入口。业务唯一规格见 `docs/PRD.md`，技术契约见 `docs/ARCHITECTURE.md`，执行状态见 `docs/TASKS.md`。

## 当前目标

把任务台账和业务借调/回扫台账转成可审计的线上任务事实，贯通管理员、组长、组员三个正式角色及可停用的联调超级管理员。任务从导入、人员/层级匹配、字段完善、执行、交付物双路线审核、返修、客观工作标签、结项到看板均使用同一数据库契约。

## 业务基线

- 组织仅有 B/C/D 三组；成员与组长冷启名单在 migration `20260904000200`，`阿部`、`成研`均匹配 C 组的`成妍`。
- 任务层级是“任务归属 → 主任务 → 任务分组 → 任务名称”；无固定层级时必须显式选择“临时任务”，未匹配不得自动猜为临时任务。
- 内部状态仅为：`待完善 → 待开始 → 进行中 → 待确认 → 已完成`。返修是交付物/待办状态，不新增任务主状态。
- 交付物由组长动态选择 `leader_only` 或 `leader_then_admin`；进入管理员路线后不可降级。
- 工作量不允许主观比例或手填分数。最终难度映射为 1/2/3/5/8 点，再按组长已确认的客观工作标签数量占比分配。
- 回扫记录归属于原任务；未完成或未验收回扫阻止结项，支持工时纳入过程事实统计。
- 实际截止时间只在组长结项时确认；预计截止时间是任务完善阶段的预估字段。

## 技术与运行

- React 18、TypeScript、Ant Design 5、webpack 5、HashRouter；前端端口 3015。
- 数据模式由 `APP_DATA_MODE` 控制：`mock` 用于 UI 快速预览，`supabase` 用于真实本地/1d 链路。不要改源码常量切模式。
- 本地 Supabase 使用匿名无密码会话；正式 1d 环境关闭匿名登录并绑定钉钉身份。
- 所有数据库变更只允许新增到 `supabase/migrations/`。`database/schema.sql` 是历史参考，禁止执行。
- 私有文件只保存对象键和元数据；已审核、被标签引用或已结项文件不可物理删除，只能新增版本并留痕。

```bash
npm install
npm run dev                 # mock UI: http://localhost:3015

# Docker/兼容容器运行时已启动后
npm run db:start
npm run db:reset
npm run db:lint
npx supabase test db
npm run dev:supabase        # 本地真实链路

npm run test:parsing
npx tsc --noEmit
npm run build
```

本地 Supabase API URL 与 anon key 写入不提交 Git 的 `.env.local`。完整步骤见 `supabase/README.md`。

## 关键代码

- `src/pages/LedgerImport`：Excel 预览、冲突解决、提交、失败行重试。
- `src/services/ledgerImportService.ts` 与 `src/utils/ledgerParsing.js`：Canonical DTO 和稳定解析。
- `src/pages/TaskDetail`：任务完善、状态推进、文档、回扫、数据验收、客观标签和结项。
- `src/pages/ManagementLedger`：组长/管理员审核中心与数据库待办。
- `src/pages/PersonalWork`、`src/services/settlementService.ts`：日/周/月人员工作量与客观标签明细；正式模式以 `member_work_summary` RPC 为唯一汇总口径，旧 `/workload` 地址会跳转到该页面。
- `src/pages/Overview`、`TaskTimeline`、`Kanban`：统一时间口径、状态汇总与四列流转。
- `server/apiContracts.js`、`server/adapters/README.md`：1d/调度接入契约。
- `supabase/migrations/`：数据库、RPC、RLS、Storage、冷启组织和关系基线的唯一执行源。

## 导入与权限原则

- Excel 与未来 scheduler 必须复用相同的 preview/resolve/commit/retry 契约；原始行、标准化行和解析决定分别留档。
- `对应验收同学`用于解析业务侧组长和助理、确定参与关系及小组；多人跨组或未知人员进入人工队列，不静默建错任务。
- 正式业务 DTO 不写入“对应任务组长（站点）”“数据报告同学”；“规则文档”仅作为来源资料保留，不覆盖审核交付物。
- 组长维护本组成员、别名和长期任务关系；管理员可全局管理；组员仅维护本人参与任务的交付物和未确认工作标签。
- 前端隐藏按钮不构成权限，RLS 与受控 RPC 才是最终边界。

## 尚需在有容器环境完成的验收

当前开发机没有可用 Docker API，无法执行空库 `db reset`、DB lint、pgTAP 与三角色真实端到端。代码、迁移和前端构建可静态检查，但内网上线前必须按 `docs/TASKS.md` 的 QA-001/QA-002 补齐真实数据库证据。不要因为前端 mock 可用而跳过此步骤。

## 1d 接入

按 migration 时间顺序部署到 1d 的 Supabase 兼容数据库；身份适配层把钉钉账号绑定到 `app_users.auth_user_id`。外部调度系统只可更新外部任务映射和允许同步的任务事实，不能覆盖文档审核、人工锁、贡献或结项。联调超级管理员可通过 `set_role_definition_active('super_admin', false)`在正式上线后停用，历史审计保留。
