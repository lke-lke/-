# 1d 适配器实现点

本目录刻意不包含公司内网 SDK、密钥或真实数据库连接。部署到 1d 后，将以下三类适配器接入即可，路由与前端契约无需改变。

接口清单由 `server/apiContracts.js` 暴露，数据库可执行契约只认 `supabase/migrations/`。`database/schema.sql` 仅是历史参考，禁止在 1d 中直接执行它代替 migration。

## authProvider

- 本地 Supabase：使用自动匿名会话，不显示密码登录；仅供本机流程联调；
- 1d 正式运行：关闭匿名登录，由宿主阿里钉 / OneDay Auth 会话提供真实身份；
- `getCurrentUser(request)` 必须返回 OneDay 用户 ID、工号、姓名；
- 后端据此查询 `app_users`、`user_roles` 和 `team_memberships`；
- 不允许前端提交角色、小组或上传人来获得权限。

## repository

- 以 `supabase/migrations/` 为唯一数据库事实源，使用 1d 后端安全环境中的 Supabase/OneDay Cloud 数据库客户端；
- 实现任务、文档、回扫、导入、审计的读写；
- 每次写入均以认证用户 ID 创建 `audit_logs`；
- `/api/v1/integration/*` 仅接受服务账号或签名请求。
- Excel 和调度数据必须先转换为 Canonical Task Import V2，再依次调用 preview、可选 resolve、commit/retry；禁止另写一条直接插入 `tasks` 的旁路。
- 任务主状态只有 `待完善 → 待开始 → 进行中 → 待确认 → 已完成`；回扫和返修属于过程事实，不创建额外任务主状态。
- `任务下发时间`写 `dispatched_at`，系统建单时间由数据库写 `created_at`；实际截止时间只允许结项 RPC 写入。
- 台账“规则文档”写入 `rule_doc_link` 作为任务已有资料入口，但不能据此生成文档审核通过、交付物齐套或结项事实。

## storageProvider

- 由 `/documents/upload-intents` 返回预签名上传地址或 1d 存储对象键；
- 文件直传对象存储，API 只保存元数据；
- 完成上传后调用 `register_document_version` RPC，以当前认证用户自动写入上传人；
- 组员只能提交本人交付物和返修版本；组长只能审核本组交付物并决定首次审核路线；管理员只能审核已由组长提交管理员路线的交付物。
- `review_route=leader_then_admin` 一旦写入不得改回 `leader_only`。所有状态迁移必须同时写入 `document_review_events`，并分别累加组长与管理员驳回次数。
- 已完成审核、已被贡献/规则变更引用或所属任务已结项的对象不可物理删除；只能保留版本并通过新版本修订。

## 未来智能调度系统

将其实现为 `schedulerAdapter`。所有请求必须携带 `X-Request-Id`、`Idempotency-Key` 和来源版本；以 `external_task_id` 优先去重，无 ID 时使用规范化任务名、下发时间和关系 ID 的稳定去重键。外部系统仅能更新未被人工锁定的任务基础字段和进度，不能覆盖本平台文档、审核、贡献、回扫、结项与审计记录。

## DingTalk 通知（P1 预留）

- 实现 `notificationAdapter.sendDingTalkReminder()`：只接收后端生成的接收人、任务 ID、提醒类型与跳转链接；不要接受前端传来的 access token 或 webhook。
- 触发时点：新导入任务待补全、任务进行过半、截止前 2 天、已逾期、文档被驳回、待组长确认标签。
- 前端当前以“管理交互表”的页面提醒展示同一套事实；接入后由定时任务或事件队列调用 `POST /api/v1/notifications/dingtalk`。
