# 筝一小助理作业管理平台：台账全链路技术架构

> 文档状态：待技术评审  
> 规格版本：V1.0  
> 更新日期：2026-09-05  
> 产品口径：`docs/PRD.md`  
> 执行清单：`docs/TASKS.md`

## 1. 架构目标

本架构将 Excel 台账和未来 1d/智能调度输入统一收敛为一条标准任务入库管道，并把组织识别、任务关系、参与人、待办、审核、结项和看板建立在数据库事实之上。前端只负责上传、预览、人工确认和展示，不在浏览器中充当最终业务判定器。

核心原则：

1. Supabase migration 是数据库契约的唯一可执行来源。
2. 同一业务事实只有一个语义键和一份权威状态。
3. 外部输入先原样留存，再标准化和解析，最后通过受控 RPC 入库。
4. 写操作必须使用真实身份和 RLS/RPC 权限，不信任前端提交的角色、姓名和小组。
5. Excel 与未来 1d 调度输入复用标准化 DTO 和入库 RPC。
6. 历史快照不可被关系库、组织或名称变更回写。

## 2. 本轮改造前的差异（历史基线）

以下是规格冻结时识别、现已由本轮迁移和服务替换的旧行为；保留本节用于说明改造原因：

- `ledgerImportService` 在浏览器内完成主要判断，并要求为整批任务人工指定同一小组和负责人。
- 导入固定写入 `main_task='临时任务'`，没有用任务关系库解析主任务。
- “对应验收同学”只写入文本 reviewer，不创建规范化任务参与人。
- “对应任务组长（站点）”“数据报告同学”“规则文档”仍进入正式任务字段。
- 业务下发时间与系统 `created_at` 混用。
- 数据量不可解析时被转换为 0，无法区分真实 0 和格式错误。
- 导入 RPC 只区分 ready/error，不能表达待完善、冲突、已更新和跳过。
- 任务内部状态曾包含旧七状态，并通过前端标签互换“待交付/待验收”。
- 看板主要从任务当前表直接聚合，无法准确回答历史时间点状态。

## 3. 逻辑组件

```text
Excel / 1d Scheduler
        │
        ▼
Source Adapter ──► Raw Batch + Raw Rows
        │
        ▼
Normalizer ──► Canonical Task Import DTO
        │
        ├──► Person Resolver ──► User / Alias / Historical Team
        ├──► Relation Resolver ──► Ownership / Main Task / Task Group
        └──► Existing Task Resolver ──► Create / Update / Conflict / Skip
        │
        ▼
Preview + Manual Resolution
        │
        ▼
Transactional Import RPC
        ├──► Tasks + Field Sources/Locks
        ├──► Task Participants + Team Snapshot
        ├──► Task Events + Todos
        └──► Audit + Import Result
        │
        ▼
Role Views / Reviews / Settlement / Reporting Views
```

## 4. 规范化 DTO

### 4.1 CanonicalTaskImportRow

```ts
interface CanonicalTaskImportRow {
  rowKey: string;
  sourceSheet: string;
  sourceRow: number;
  sourceSystem: 'excel' | 'scheduler';
  externalTaskId?: string;
  taskName: string;
  ownershipRaw?: string;
  taskGroupRaw?: string;
  workNature?: string;
  dataVolume?: number;
  dataVolumeRaw?: string;
  workforce?: number;
  workforceRaw?: string;
  dispatchedAt?: string;
  expectedDeadline?: string;
  reviewerNamesRaw?: string;
  sourceDocumentLink?: string;
  sourceUpdatedAt?: string;
  sourceVersion?: string;
  rawPayload: Record<string, unknown>;
}
```

以下输入不得出现在 canonical 业务字段中：站点任务组长、数据报告同学。它们只存在于 `rawPayload`。台账规则文档进入 `sourceDocumentLink`，落库为非审核型 `rule_doc_link`，不能替代平台交付物。

### 4.2 ResolvedTaskImportRow

```ts
interface ResolvedTaskImportRow extends CanonicalTaskImportRow {
  dedupeKey: string;
  relationId?: string;
  ownership?: string;
  mainTask?: string;
  taskGroup?: string;
  relationResolution: 'exact' | 'alias' | 'unique_inferred' | 'explicit_temporary' | 'unmatched' | 'ambiguous';
  teamId?: string;
  teamName?: string;
  teamLeaderUserId?: string;
  participantUserIds: string[];
  primaryAssigneeUserId?: string;
  personResolution: 'resolved' | 'needs_assignee' | 'unmatched' | 'ambiguous' | 'cross_team';
  action: 'create' | 'update' | 'skip' | 'conflict';
  status: 'ready' | 'needs_completion' | 'conflict' | 'error';
  issues: ImportIssue[];
  existingTaskId?: string;
}
```

前端展示 DTO；服务器/RPC 会再次验证所有关键 ID 和状态，不能信任浏览器解析结果。

## 5. 数据库变更设计

### 5.1 迁移策略

- 不修改已存在的 `20260903*`、`20260904*` migration。
- 所有修改从新的时间戳 migration 开始。
- 新结构先兼容旧列，完成数据回填和读路径切换后，再用独立 migration 停止旧列约束或物理删除。
- 每个 migration 必须可在空库顺序执行；共享环境只前进，不依赖手工控制台改表。

### 5.2 新表：person_aliases

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 主键 |
| alias_normalized | text unique | 标准化后别名，唯一 |
| alias_display | text | 原始展示别名 |
| user_id | uuid FK app_users | 标准人员 |
| active | boolean | 是否参与新匹配 |
| valid_from / valid_to | date | 有效期 |
| created_by / updated_by | uuid | 操作者 |
| created_at / updated_at | timestamptz | 时间 |

冷启插入 `阿部 → 成妍`、`成研 → 成妍`。禁止一个有效别名同时指向多名用户。

### 5.3 新表：task_relation_aliases

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 主键 |
| ownership_normalized | text | 归属作用域 |
| alias_normalized | text | 分组别名 |
| relation_id | uuid FK task_relations | 指向标准关系 |
| active | boolean | 是否有效 |
| created_by / created_at / updated_at | - | 留痕 |

唯一约束为同一归属下一个有效别名只能指向一个关系。

### 5.4 扩展 import_batches

新增或调整：

- `source_system`：excel/scheduler。
- `source_hash`：原始文件或请求体校验值。
- `status`：previewing/previewed/committing/succeeded/partial/failed。
- `ready_rows`、`needs_completion_rows`、`conflict_rows`、`error_rows`、`created_rows`、`updated_rows`、`skipped_rows`。
- `request_id`、`idempotency_key`、`source_version`。
- `error_summary`、`metadata`。

`source_system + idempotency_key` 在非空时唯一。

### 5.5 扩展 import_rows

新增或调整：

- `row_key`：批次内稳定键。
- `raw_data`：完整原始行。
- `normalized_data`：Canonical DTO。
- `resolved_data`：人员/关系/已有任务解析结果。
- `status`：ready/needs_completion/conflict/error/created/updated/skipped。
- `action`：create/update/skip/conflict。
- `issues`：结构化错误数组。
- `task_id`：成功后关联任务。
- `resolved_by`、`resolved_at`：人工处理人和时间。
- `retry_of_row_id`：重试链路。

唯一约束：`batch_id + row_key`。

### 5.6 扩展 tasks

保留现有任务主表，新增：

- `dispatched_at timestamptz`：业务下发时间。
- `completed_at timestamptz`：任务结项时间。
- `reopened_at timestamptz`、`reopen_reason text`。
- `mapping_status`：resolved/needs_completion/conflict。
- `team_snapshot`、`team_leader_snapshot`：历史展示快照；现有 `team`、`team_leader` 在兼容期映射到该语义。
- `source_payload`：最近一次标准输入摘要，不保存交付物事实。

状态 check 调整为：待完善、待开始、进行中、待确认、已完成。历史值通过数据迁移映射。

现有 `data_reporter` 和自由文本 `reviewer` 停止作为权威业务事实；第一阶段不物理删除，避免破坏已执行环境和旧构建。`rule_doc_link` 保留为台账已有资料入口，但与平台上传、版本、审核和齐套交付物严格隔离。验收参与关系从 `task_participants` 读取，姓名字段仅作历史展示快照。

### 5.7 新表：task_field_provenance

| 字段 | 说明 |
|---|---|
| task_id + field_name | 联合主键 |
| source_type | excel/scheduler/manual |
| source_ref | batch/row/外部事件 |
| source_value | 最近来源值 |
| locked_by_manual | 是否人工锁 |
| locked_by / locked_at | 人工确认留痕 |
| updated_at | 最近更新 |

允许外部来源更新的字段只在该表判定。文档、审核、贡献、结项字段不进入可更新白名单。

### 5.8 扩展 task_participants

新增：

- `source_type`：import/manual。
- `source_ref`：import row 或人工操作。
- `team_id_snapshot`、`team_name_snapshot`。
- `responsibility` 继续使用主负责人/协作人。
- 同一任务只能有一个当前有效主负责人，使用部分唯一索引保证。

参与关系按 `user_id` 写入；`participant_names` 只保留展示快照，在兼容期由触发器/RPC同步。

### 5.9 新表：task_events

统一任务生命周期事件，至少包括：

- imported、fields_completed、assignee_changed、started、progress_synced、data_completed、entered_confirmation、settled、reopened。

字段包括 task_id、event_type、from_status、to_status、actor_id、source_type、source_ref、payload、occurred_at、created_at。该表用于状态历史、时间点快照和审计对账。

### 5.10 新表：todos

| 字段 | 说明 |
|---|---|
| id | 主键 |
| todo_type | 固定事件类型 |
| assignee_user_id / assignee_role / team_id | 接收目标 |
| task_id / document_id / import_row_id | 业务关联 |
| status | open/completed/cancelled |
| title / detail / due_at | 展示字段 |
| dedupe_key | 防重复待办 |
| created_at / completed_at | 时间 |

由数据库函数或受控服务在业务事件发生时生成；前端不自行拼接权威待办。

### 5.11 现有审核表

`documents` 和 `document_review_events` 延续现有双路线设计，但需补充：

- review route 的不可降级约束放在数据库触发器/RPC中。
- 驳回意见在驳回动作时必填。
- 版本注册、组长审核、管理员审核和返修处置只能走 RPC。
- 文档对象键、校验值和 MIME/大小写入元数据。
- 被审核/引用文档禁止物理删除。

## 6. 解析与解析器函数

### 6.1 normalize_person_name(text)

- Unicode/全半角标准化、trim、移除姓名内部非语义空格。
- 不做模糊拼音匹配，不使用编辑距离自动猜测。

### 6.2 resolve_people(names, effective_date)

返回每个输入姓名的 exact/alias/unmatched/ambiguous 结果、user_id、当时有效 team_id 和角色。冷启前没有历史组织记录时，允许回退到当前有效小组，但必须返回 `team_resolution=current_fallback` 供预览提示；不得伪装成历史精确匹配。解析必须批量执行，避免逐行 N+1 查询。

### 6.3 resolve_task_relation(ownership, task_group)

返回 exact/alias/unique_inferred/explicit_temporary/unmatched/ambiguous。只查询 active 关系和别名；历史任务使用已有快照，不重新解析。

### 6.4 parse_numeric_value(raw, unit_kind)

返回 `{value, normalizedUnit, valid, reason}`。无法解析时 value 为 null，禁止默认为 0。

### 6.5 parse_business_date(raw, timezone)

统一返回带时区时间或结构化错误。只在明确无时间时使用当天 00:00:00 Asia/Shanghai，并记录精度为 date。

## 7. RPC 与接口契约

### 7.1 preview_task_import

输入：文件解析后的原始行、文件元数据、source system。  
输出：batch、每行 normalized/resolved 数据、issues、create/update/skip/conflict 判断。

职责：

- 创建 preview 批次和行级审计。
- 服务端再次解析人员、关系和已有任务。
- 不创建/更新正式任务。
- 同一文件 hash 可创建新预览，但要提示历史批次；同一 idempotency key 返回原批次。

### 7.2 resolve_import_row

输入：import_row_id、人工选择的 user/relation/team/assignee 和是否锁定字段。  
权限：管理员可处理全部；组长只能处理明确属于本组的行。  
输出：重新计算后的行状态。

人工处理不得直接创建全局别名或关系；这些使用独立管理 RPC。

### 7.3 commit_task_import

输入：batch_id、可选 row_ids。  
输出：行级结果和批次汇总。

行为：

1. `FOR UPDATE` 锁定批次和目标行。
2. 再次验证解析、权限、幂等键和已有任务版本。
3. 对每行在子事务块中 create/update/skip。
4. 写任务、字段来源、参与人、任务事件、待办和审计。
5. 更新 import row 和 batch 汇总。

提交成功后：字段完整任务为待开始；缺少可补充管理字段但小组已确定的任务为待完善；无法确定小组的行保留导入草稿，不创建正式任务。

### 7.4 retry_import_rows

输入：失败/冲突行及修正值。生成新行并通过 `retry_of_row_id` 关联，原始行不可覆盖。

### 7.5 task workflow RPC

- `complete_task_fields(task_id, ...)`
- `assign_task_participants(task_id, ...)`
- `transition_task(task_id, target_status, reason)`
- `settle_task_v2(task_id, final_difficulty, difficulty_reason, summary, actual_deadline)`：数据库校验交付物、回扫和贡献门禁；工作量只由最终难度映射生成，调用方不能传主观分数。
- `reopen_task(task_id, reason)`

手工创建使用 `create_manual_task(...)`，内部复用人员、关系、字段来源和状态校验；创建时不接受实际截止时间，成功后产生与导入任务一致的 task event、参与关系和待办。

RPC 校验合法前置状态并同时写 task_events、todos、field provenance 和 audit_logs。

### 7.6 标准外部接口

- `POST /api/v1/imports/task-ledger/preview`
- `POST /api/v1/imports/:batchId/rows/:rowId/resolve`
- `POST /api/v1/imports/:batchId/commit`
- `POST /api/v1/imports/:batchId/retry`
- `GET /api/v1/imports/:batchId`
- `GET /api/v1/imports/:batchId/errors.csv`
- `POST /api/v1/integration/tasks/preview`
- `POST /api/v1/integration/tasks/upsert`

Excel 和 integration 接口最终都转换成 CanonicalTaskImportRow。外部接口要求 `X-Request-Id`、`Idempotency-Key`、来源版本和服务身份。

## 8. 状态与消费者闭环

### 8.1 状态映射迁移

| 旧状态 | 新状态 |
|---|---|
| 待完善 | 待完善 |
| 待开始 | 待开始 |
| 进行中 | 进行中 |
| 数据完成 | 待确认 |
| 待交付 | 待确认 |
| 待验收 | 待确认 |
| 已完成 | 已完成 |

迁移前生成数量对账，迁移后保证总任务数不变。

### 8.2 状态消费者

每个状态变更必须同步影响：

- 管理员任务全景和流转看板。
- 组长本组任务和审核中心。
- 组员我的任务和待办。
- 各组作业总览、人员作业明细和时间筛选。
- 预警、通知、结项资格判断。

禁止只改 `tasks.status` 而不产生事件；所有状态改变走 RPC。

## 9. 查询与看板

### 9.1 数据视图

建议新增/替换：

- `task_current_state_view`：任务当前事实、主负责人和参与人。
- `task_state_at(timestamp)`：按 task_events 计算时间点状态，优先实现为 SQL 函数。
- `team_task_status_summary(start, end)`：区间结束状态快照。
- `completed_workload_summary(start, end)`：按 settled/completed 时间统计。
- `member_work_summary(start, end, grain)`：日/周/月人员贡献；任务难度点按已确认客观标签数量占比分配。
- `import_batch_summary`：导入处理结果。
- `review_queue`：组长/管理员审核和返修队列。

所有查询接受小组、负责人、任务层级和时间区间；列表分页，汇总与明细使用相同过滤定义。

### 9.2 时间语义

- 系统审计字段统一 timestamptz，数据库存 UTC，接口和 UI 按 Asia/Shanghai 展示。
- 业务日期若无具体时间，保存精度元数据。
- 时间筛选使用半开区间 `[start, end)`，避免跨日重复统计。

## 10. RLS 与权限

- 管理员/超级管理员读取全部业务数据。
- 组长读取本组任务、参与人、文档、待办和导入行；只能修改本组任务。
- 组员只读取本人是当前/历史参与人的任务和相关业务记录；只能登记本人交付物与未确认标签。
- 原始导入数据包含敏感组织信息，只允许管理员和具备该批次权限的组长读取。
- `security definer` RPC 必须固定 search_path、显式校验 actor、撤销 public execute 后再授予 authenticated/service role。
- service role 仅在可信服务器使用，禁止写入浏览器和仓库。
- 超级管理员停用由 role definition 配置完成，历史事件中的角色文本不改写。

## 11. 文件存储

- 私有 bucket；对象键建议 `{environment}/{task_id}/{root_document_id}/{version}/{uuid}`。
- 上传意图限制文件类型、大小、task_id 和有效期。
- 完成登记时校验对象存在、大小和校验值。
- 下载通过短期签名 URL；数据库不持久化签名 URL。
- 逻辑作废保留对象与审计；物理清理由独立保留策略作业处理。

## 12. 容错、并发与安全更新

- 批次提交使用 advisory lock 或行锁避免双击重复提交。
- 更新已有任务采用 `updated_at`/版本乐观并发控制；预览后任务发生变化则转 conflict。
- 行级异常捕获稳定错误码，批次状态可 partial。
- 导入服务记录 request_id，前后端日志可关联。
- 关系、人员或任务在预览后被停用时，提交必须重新验证并拒绝过期解析。
- 手工锁字段发生外部差异时保留 source value，待人工显式采纳或忽略。

## 13. 性能边界

- 浏览器只解析文件结构和上传；5,000 行以内可预览，复杂匹配由后端批量处理。
- 人员和关系解析使用临时表/JSON recordset 批量 join。
- 为 external_task_id、dedupe_key、import row status、todo assignee/status、task events(task_id, occurred_at)、person alias、relation alias 建索引。
- 看板聚合禁止逐任务查询；使用视图/RPC一次返回。

## 14. 本地与 1d 环境

### 14.1 本地

- Supabase CLI 固定仓库版本启动。
- 允许匿名演示会话，不显示密码登录。
- 演示身份和业务身份明确标记 `is_local_demo`，正式环境拒绝。
- 本地文件可使用 Supabase Storage 模拟完整流程。

### 14.2 1d

- 关闭匿名登录。
- authProvider 将钉钉/OneDay 身份绑定到 app_users。
- 使用同一 migration 顺序、RLS、RPC 和存储契约。
- schedulerAdapter 只调用 integration API，不直写业务表。

## 15. 迁移阶段

### Phase A：扩展而不切换

新增别名、字段来源、任务事件、待办、导入扩展字段和解析 RPC；回填别名与任务历史，不改变现有前端读路径。

### Phase B：双读校验

新导入写入新结构，旧页面继续可读；生成新旧任务数量、状态和看板汇总对账。此阶段不是长期双写方案。

### Phase C：切换业务读写

前端切换到新 RPC/视图，停止写入废弃字段和旧状态；更新 API 契约。

### Phase D：兼容收口

在共享环境稳定后，用独立 migration 收紧旧列/旧状态约束，删除不再使用的触发器或视图。是否物理删除废弃列需单独审批。

## 16. 验证门槛

### 16.1 数据库

- `supabase db reset`
- `supabase db lint --local --level warning`
- SQL/RPC 测试覆盖权限、幂等、状态机、部分成功、人工锁和历史快照。
- 迁移前后行数与状态对账。

### 16.2 前端

- TypeScript/webpack production build。
- 任务台账预览、筛选、人工处理、提交和错误下载。
- 管理员、组长、组员、超级管理员各视角回归。
- 不同页面汇总和明细对同一筛选条件结果一致。

### 16.3 端到端

一份固定测试台账覆盖所有验收矩阵，完成导入到结项；第二次重复导入验证无重复；修改台账字段验证人工锁冲突；模拟管理员多轮驳回验证完整事件链。

## 17. 回退策略

- migration 只前进；结构回退通过新增补偿 migration。
- 读路径切换使用环境级 feature flag，出现问题可暂时回旧视图，但新写入不得丢失。
- 导入批次不可删除；错误任务使用逻辑作废或受控纠错事件，不通过物理删除伪造回退。
- 上线前记录数据库备份、migration 版本、构建版本和接口版本。

## 18. 开放技术决策

以下不是业务阻塞项，可在实现前技术评审中定稿：

- 大批次解析由 Postgres RPC 还是 1d 服务端 Job 承担；本地 5,000 行以内优先 RPC，生产可切 Job。
- 历史状态事件的回填时间精度；无证据时只记录 migration 时间并标记 `inferred=true`。
- 旧 `data_reporter` 列何时物理删除；默认本轮只停用读写。`rule_doc_link` 继续保留为非审核型来源资料入口。
- 看板状态快照函数是否后续物化；本轮先以正确性优先。
