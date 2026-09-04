# Supabase 本地数据库与 1d 迁移说明

## 约束

- `supabase/migrations/` 是数据库结构、RPC、RLS、Storage 和基础业务配置的唯一可执行来源。
- 禁止只在 Supabase Studio/1d SQL 控制台修改数据库而不补 migration。
- `supabase/seed.sql` 已禁用；迁移不包含测试任务、测试人员或测试交付物。
- `database/schema.sql` 仅是旧版历史参考，不再执行。
- 浏览器只能使用 anon/publishable key，禁止把 `service_role` key 写入 `.env`、源码或构建产物。

## 本机首次启动

Supabase 本地栈需要 Docker API 兼容的容器运行时。先安装并启动 Docker Desktop、OrbStack、Rancher Desktop 或 Podman Desktop，再执行：

```bash
npm install
npm run db:start
npm run db:reset
npx supabase status
```

从 `npx supabase status` 输出复制本地 API URL 和 anon key，创建不提交 Git 的 `.env.local`：

```dotenv
APP_DATA_MODE=supabase
APP_SUPABASE_URL=http://127.0.0.1:54321
APP_SUPABASE_ANON_KEY=粘贴本地_anon_key
```

启动前端：

```bash
npm run dev:supabase
```

前端地址为 `http://localhost:3015`，Supabase Studio 为 `http://localhost:54323`。本地模式采用无感匿名会话，不显示密码登录页；超级管理员、管理员、组长、组员仍通过页面顶部选择。切换结果写入匿名用户的 `local_demo_role`，仅供本地流程联调。超级管理员可切换为三种角色的只读预览视角，实际操作身份始终保留为超级管理员。

## 日常变更流程

```bash
npx supabase migration new 简短英文名称
# 只编辑新生成的 supabase/migrations/<timestamp>_*.sql
npm run db:reset
npm run db:lint
npx supabase test db
npm run db:types
npm run build
```

已经进入共享环境的 migration 不回改，后续修正必须新增 migration。`db:reset` 会清空并重建本地数据库，只能用于本机开发库。

## 当前迁移内容

| migration | 内容 |
|---|---|
| `20260903000100` | 用户、三角色、小组、成员关系、Auth 自动建档、通用函数 |
| `20260903000200` | 任务、关系、交付物、审核事件、进度、回扫、贡献、结项、导入、审计 |
| `20260903000300` | 文档版本/双路线审核/返修、任务关系、贡献确认、结项 RPC |
| `20260903000400` | RLS、API 权限、私有文件桶与 Storage 策略 |
| `20260903000500` | AI 试穿 66 项、lookie 10 项任务挂链基线 |
| `20260903000600` | Excel 批次事务导入、1d/调度系统连接与同步记录 |
| `20260903000700` | 首位管理员、成员分组与停用 RPC |
| `20260903000800` | 最新交付物、审核队列、任务层级和实时进度视图 |
| `20260903000900` | 本地无密码匿名会话与演示角色切换 |
| `20260903001000` | 多人任务关系与写入人自动补全 |
| `20260903001100` | 客观工作标签的本人提交/管理确认 RPC |
| `20260903001200` | 无密码成员名册、组长维护 RPC 与后续 1d 账号绑定位置 |
| `20260904000100` | 可配置超级管理员、三角色只读预览支持、角色停用 RPC 与超级管理员审计字段 |
| `20260904000200` | 筝一 B/C/D 正式小组与 15 人冷启名册；旧 A 组停用但保留历史数据 |

## 1d 部署

1. 在 1d 测试项目按时间顺序执行全部 migration，或由其 Supabase 兼容迁移工具接管该目录。
2. 正式配置必须关闭 anonymous sign-in；`local_demo_role` 不会对普通登录用户生效。
3. 1d/钉钉身份写入 `auth.users` 后，触发器会创建 `app_users` 和默认 `member` 角色；管理员再分配 `admin`/`leader` 和小组。
4. 第一个管理员只能由可信后端或 SQL 管理员使用 `service_role` 调用 `bootstrap_first_admin(auth_user_id)`。
5. 外部调度数据通过 `integration_connections`、`external_sync_runs`、`external_task_mappings` 留痕；不得覆盖本平台的文档、人工审核、回扫和结项事实。

## 超级管理员的上线后处置

- 开发/联调阶段可给可信运维账号分配 `super_admin`，用于跨组排障、全量数据核验和角色视角检查。
- 正式上线后，如果不再需要该入口，由可信运维账号执行 `select public.set_role_definition_active('super_admin', false);`。该操作写入 `audit_logs`，只停用角色能力，不删除任何业务数据。
- 如需彻底收口，再由受控数据库变更移除 `user_roles` 中的 `super_admin` 分配；不要删除既有 migration 或审计记录。

## CLI 版本说明

本仓库把 Supabase CLI 固定为 `2.20.12`，因为当前开发机是 macOS 12 Intel，最新 `2.116.0` 二进制依赖更新版系统 ICU，无法在该机器启动。内网开发机可在验证 `db reset` 和全部测试通过后，通过独立 migration 升级 CLI；不要只修改 lockfile 后直接部署。
