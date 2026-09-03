-- 筝一小助理管理看板 - 数据库建表SQL
-- 在 OneDay Cloud 开通后执行

-- 任务主表
CREATE TABLE public.tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  ownership TEXT NOT NULL,
  task_group TEXT NOT NULL,
  work_nature TEXT NOT NULL,
  task_type TEXT NOT NULL,
  assignee TEXT NOT NULL,
  team TEXT NOT NULL,
  team_leader TEXT NOT NULL,
  data_reporter TEXT,
  reviewer TEXT,
  data_volume INTEGER DEFAULT 0,
  workforce INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  deadline TIMESTAMPTZ,
  expected_deadline TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT '待开始',
  platform_task_id TEXT,
  rule_doc_link TEXT,
  difficulty INTEGER CHECK (difficulty >= 1 AND difficulty <= 5),
  progress NUMERIC(3,2) DEFAULT 0,
  doc_completeness NUMERIC(3,2) DEFAULT 0,
  remark TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 升级既有环境时执行：允许台账任务先入库，再由组长完善时间字段。
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS expected_deadline TIMESTAMPTZ;
ALTER TABLE public.tasks ALTER COLUMN deadline DROP NOT NULL;

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "所有人可读" ON public.tasks FOR SELECT USING (true);
CREATE POLICY "认证用户可写" ON public.tasks FOR INSERT WITH CHECK (true);
CREATE POLICY "认证用户可改" ON public.tasks FOR UPDATE USING (true);

-- 文档交付物表
CREATE TABLE public.documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  name TEXT NOT NULL,
  link TEXT,
  uploader TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "所有人可读" ON public.documents FOR SELECT USING (true);
CREATE POLICY "认证用户可写" ON public.documents FOR INSERT WITH CHECK (true);

-- 标注进度快照表
CREATE TABLE public.progress_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE,
  total INTEGER NOT NULL,
  completed INTEGER NOT NULL,
  percentage NUMERIC(5,2) NOT NULL,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.progress_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "所有人可读" ON public.progress_snapshots FOR SELECT USING (true);
CREATE POLICY "系统可写" ON public.progress_snapshots FOR INSERT WITH CHECK (true);

-- 回扫记录表
CREATE TABLE public.rescan_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  original_task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE,
  original_task_name TEXT NOT NULL,
  reason TEXT NOT NULL,
  description TEXT,
  rescan_volume INTEGER NOT NULL,
  executors TEXT[] DEFAULT '{}',
  contact_assistant TEXT NOT NULL,
  expected_done TIMESTAMPTZ,
  actual_done TIMESTAMPTZ,
  accepted BOOLEAN,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.rescan_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "所有人可读" ON public.rescan_records FOR SELECT USING (true);
CREATE POLICY "认证用户可写" ON public.rescan_records FOR INSERT WITH CHECK (true);
CREATE POLICY "认证用户可改" ON public.rescan_records FOR UPDATE USING (true);

-- 预警记录表
CREATE TABLE public.alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT,
  triggered_at TIMESTAMPTZ DEFAULT NOW(),
  acknowledged BOOLEAN DEFAULT false,
  acknowledged_by TEXT,
  acknowledge_reason TEXT
);

ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "所有人可读" ON public.alerts FOR SELECT USING (true);
CREATE POLICY "系统可写" ON public.alerts FOR INSERT WITH CHECK (true);
CREATE POLICY "认证用户可改" ON public.alerts FOR UPDATE USING (true);

-- 自动更新 updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 开启 Realtime（可选）
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.progress_snapshots;

-- ============================================================
-- 独立平台正式流程扩展（在原表建好后继续执行）
-- 账号密码登录交给 OneDay Cloud Auth；本表只存业务身份与权限。
-- ============================================================

CREATE TABLE public.app_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  auth_user_id UUID UNIQUE NOT NULL,
  employee_id TEXT UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.user_roles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.app_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('assistant', 'leader', 'manager', 'admin')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, role)
);

CREATE TABLE public.team_memberships (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.app_users(id) ON DELETE CASCADE,
  team TEXT NOT NULL,
  is_leader BOOLEAN NOT NULL DEFAULT false,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  UNIQUE(user_id, team, effective_from)
);

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual', 'excel', 'scheduler')),
  ADD COLUMN IF NOT EXISTS external_task_id TEXT,
  ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS imported_batch_id UUID,
  ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS settled_by UUID REFERENCES public.app_users(id);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_external_source_unique ON public.tasks(source_type, external_task_id) WHERE external_task_id IS NOT NULL;

CREATE TABLE public.difficulty_revisions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE,
  difficulty INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
  phase TEXT NOT NULL CHECK (phase IN ('initial', 'final')),
  reason TEXT,
  confirmed_by UUID REFERENCES public.app_users(id),
  confirmed_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS uploader_user_id UUID REFERENCES public.app_users(id),
  ADD COLUMN IF NOT EXISTS storage_key TEXT,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS replaced_document_id UUID REFERENCES public.documents(id);

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_comment TEXT;

-- 二级审核链路：组长提交管理员审核，驳回后回流至组长待处理返修。
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS admin_review_status TEXT NOT NULL DEFAULT 'not_submitted' CHECK (admin_review_status IN ('not_submitted', 'pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS submitted_to_admin_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_reviewed_by TEXT,
  ADD COLUMN IF NOT EXISTS admin_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_review_comment TEXT,
  ADD COLUMN IF NOT EXISTS admin_revision_count INTEGER NOT NULL DEFAULT 0;

-- 动态双路线审核：组长首次验收决定是否进入管理员二级审核；一旦进入不可降级。
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS review_route TEXT NOT NULL DEFAULT 'undecided' CHECK (review_route IN ('undecided', 'leader_only', 'leader_then_admin')),
  ADD COLUMN IF NOT EXISTS workflow_status TEXT NOT NULL DEFAULT 'pending_leader_review' CHECK (workflow_status IN ('pending_leader_review', 'member_revision_required', 'pending_admin_review', 'leader_revision_required', 'completed_by_leader', 'completed_by_admin')),
  ADD COLUMN IF NOT EXISTS leader_rejection_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_approval_level TEXT CHECK (final_approval_level IN ('leader', 'admin')),
  ADD COLUMN IF NOT EXISTS completed_by TEXT,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS root_document_id UUID REFERENCES public.documents(id);

CREATE TABLE IF NOT EXISTS public.document_review_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
  root_document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('管理员', '组长', '组员')),
  action TEXT NOT NULL CHECK (action IN ('member_submitted', 'leader_rejected', 'leader_completed', 'leader_submitted_admin', 'admin_rejected', 'admin_completed', 'leader_returned_member', 'leader_resubmitted_admin')),
  from_status TEXT,
  to_status TEXT NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS document_review_events_root_idx ON public.document_review_events(root_document_id, created_at);
ALTER TABLE public.document_review_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "交付物审核事件所有人可读" ON public.document_review_events FOR SELECT USING (true);
CREATE POLICY "认证用户可写交付物审核事件" ON public.document_review_events FOR INSERT WITH CHECK (true);

CREATE TABLE public.document_reviews (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  comment TEXT,
  reviewed_by UUID REFERENCES public.app_users(id),
  reviewed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.rule_change_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE,
  document_id UUID REFERENCES public.documents(id),
  summary TEXT NOT NULL,
  published_by UUID REFERENCES public.app_users(id),
  published_at TIMESTAMPTZ DEFAULT NOW(),
  requires_rescan BOOLEAN NOT NULL DEFAULT false
);

ALTER TABLE public.rescan_records
  ADD COLUMN IF NOT EXISTS initiated_by UUID REFERENCES public.app_users(id),
  ADD COLUMN IF NOT EXISTS rule_change_id UUID REFERENCES public.rule_change_records(id),
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'accepted', 'rejected'));

CREATE TABLE public.task_management_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('training_completed', 'rule_change_published', 'rescan_initiated', 'rescan_closed', 'data_acceptance_completed', 'evaluation_report_approved')),
  actor_id UUID REFERENCES public.app_users(id),
  evidence_link TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.task_contributions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE,
  member TEXT NOT NULL,
  tag TEXT NOT NULL,
  evidence_type TEXT CHECK (evidence_type IN ('document', 'rescan', 'acceptance')),
  evidence_id TEXT,
  note TEXT,
  attached_by TEXT NOT NULL,
  attached_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.task_settlements (
  task_id UUID PRIMARY KEY REFERENCES public.tasks(id) ON DELETE CASCADE,
  confirmed_by TEXT NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  final_difficulty INTEGER NOT NULL CHECK (final_difficulty BETWEEN 1 AND 5),
  difficulty_reason TEXT,
  summary TEXT
);

CREATE TABLE public.import_batches (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type IN ('task_ledger', 'rescan_ledger')),
  original_filename TEXT NOT NULL,
  storage_key TEXT,
  status TEXT NOT NULL DEFAULT 'previewed' CHECK (status IN ('previewed', 'committed', 'failed')),
  total_rows INTEGER NOT NULL DEFAULT 0,
  committed_rows INTEGER NOT NULL DEFAULT 0,
  skipped_rows INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  committed_at TIMESTAMPTZ
);

CREATE TABLE public.import_rows (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id UUID REFERENCES public.import_batches(id) ON DELETE CASCADE,
  source_sheet TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  raw_data JSONB NOT NULL,
  normalized_data JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'skipped', 'error', 'needs_match', 'committed')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(batch_id, source_sheet, source_row)
);

CREATE TABLE public.task_match_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  import_row_id UUID REFERENCES public.import_rows(id) ON DELETE CASCADE,
  candidate_task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  match_score NUMERIC(5,2),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
  confirmed_by UUID REFERENCES public.app_users(id),
  confirmed_at TIMESTAMPTZ
);

CREATE TABLE public.audit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_id UUID REFERENCES public.app_users(id),
  entity_type TEXT NOT NULL,
  entity_id UUID,
  action TEXT NOT NULL,
  before_value JSONB,
  after_value JSONB,
  request_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON public.audit_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS task_events_task_idx ON public.task_management_events(task_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS task_contributions_task_idx ON public.task_contributions(task_id, attached_at DESC);
CREATE INDEX IF NOT EXISTS import_rows_batch_idx ON public.import_rows(batch_id, status);

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.difficulty_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rule_change_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_management_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_contributions ENABLE ROW LEVEL SECURITY;

-- P0：任务关系库、字段变更与成员贡献确认（可在既有扩展 SQL 后执行）
CREATE TABLE IF NOT EXISTS public.task_relations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ownership TEXT NOT NULL,
  main_task TEXT NOT NULL DEFAULT '-',
  linked_task TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(ownership, main_task, linked_task)
);

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS relation_id UUID REFERENCES public.task_relations(id);
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS main_task_snapshot TEXT;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS linked_task_snapshot TEXT;

ALTER TABLE public.task_contributions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'removed'));
ALTER TABLE public.task_contributions ADD COLUMN IF NOT EXISTS confirmed_by TEXT;
ALTER TABLE public.task_contributions ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.task_field_changes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  before_value JSONB,
  after_value JSONB,
  changed_by TEXT NOT NULL,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS task_relations_tree_idx ON public.task_relations(ownership, main_task, linked_task) WHERE active = true;
CREATE INDEX IF NOT EXISTS task_field_changes_task_idx ON public.task_field_changes(task_id, changed_at DESC);
ALTER TABLE public.task_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_match_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 1d 部署时由后端认证中间件按 app_users / user_roles / team_memberships 做最终授权。
-- 不要将前端传入的角色、小组、上传人或验收人作为授权依据。
