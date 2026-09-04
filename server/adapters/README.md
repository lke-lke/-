# 1d 适配器实现点

本目录刻意不包含公司内网 SDK、密钥或真实数据库连接。部署到 1d 后，将以下三类适配器接入即可，路由与前端契约无需改变。

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

## storageProvider

- 由 `/documents/upload-intents` 返回预签名上传地址或 1d 存储对象键；
- 文件直传对象存储，API 只保存元数据；
- 完成上传后调用 `register_document_version` RPC，以当前认证用户自动写入上传人；
- 组员只能提交本人交付物和返修版本；组长只能审核本组交付物并决定首次审核路线；管理员只能审核已由组长提交管理员路线的交付物。
- `review_route=leader_then_admin` 一旦写入不得改回 `leader_only`。所有状态迁移必须同时写入 `document_review_events`，并分别累加组长与管理员驳回次数。

## 未来智能调度系统

将其实现为 `schedulerAdapter`。所有写入必须以 `external_task_id` 加 `Idempotency-Key` 去重；外部系统仅能更新任务基础字段和进度，不能覆盖本平台文档、验收、回扫与审计记录。

## DingTalk 通知（P1 预留）

- 实现 `notificationAdapter.sendDingTalkReminder()`：只接收后端生成的接收人、任务 ID、提醒类型与跳转链接；不要接受前端传来的 access token 或 webhook。
- 触发时点：新导入任务待补全、任务进行过半、截止前 2 天、已逾期、文档被驳回、待组长确认标签。
- 前端当前以“管理交互表”的页面提醒展示同一套事实；接入后由定时任务或事件队列调用 `POST /api/v1/notifications/dingtalk`。
