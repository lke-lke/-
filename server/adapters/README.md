# 1d 适配器实现点

本目录刻意不包含公司内网 SDK、密钥或真实数据库连接。部署到 1d 后，将以下三类适配器接入即可，路由与前端契约无需改变。

## authProvider

- 独立运行：使用 OneDay Cloud Auth 的账号密码会话；
- `getCurrentUser(request)` 必须返回 OneDay 用户 ID、工号、姓名；
- 后端据此查询 `app_users`、`user_roles` 和 `team_memberships`；
- 不允许前端提交角色、小组或上传人来获得权限。

## repository

- 使用 1d 后端安全环境中的 OneDay Cloud 数据库客户端；
- 实现任务、文档、回扫、导入、审计的读写；
- 每次写入均以认证用户 ID 创建 `audit_logs`；
- `/api/v1/integration/*` 仅接受服务账号或签名请求。

## storageProvider

- 由 `/documents/upload-intents` 返回预签名上传地址或 1d 存储对象键；
- 文件直传对象存储，API 只保存元数据；
- 完成上传后调用 `POST /documents`，以当前认证用户自动写入上传人；
- 文档验收只能由该任务所属小组组长或管理员执行。

## 未来智能调度系统

将其实现为 `schedulerAdapter`。所有写入必须以 `external_task_id` 加 `Idempotency-Key` 去重；外部系统仅能更新任务基础字段和进度，不能覆盖本平台文档、验收、回扫与审计记录。
