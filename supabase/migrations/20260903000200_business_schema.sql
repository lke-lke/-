-- 筝一小助理作业管理平台：任务、交付物、回扫、结项、导入与审计模型

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('task_ledger', 'rescan_ledger')),
  original_filename text not null,
  storage_key text,
  status text not null default 'previewed' check (status in ('previewed', 'committed', 'failed')),
  total_rows integer not null default 0 check (total_rows >= 0),
  committed_rows integer not null default 0 check (committed_rows >= 0),
  skipped_rows integer not null default 0 check (skipped_rows >= 0),
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  committed_at timestamptz
);

create table public.task_relations (
  id uuid primary key default gen_random_uuid(),
  ownership text not null,
  main_task text not null default '临时任务',
  linked_task text not null,
  active boolean not null default true,
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ownership, main_task, linked_task)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  ownership text not null,
  main_task_snapshot text not null default '临时任务',
  linked_task_snapshot text not null default '临时任务',
  relation_id uuid references public.task_relations(id) on delete set null,
  task_group text not null default '临时任务',
  work_nature text not null default '首次交付',
  task_type text not null default '模型评测',
  assignee text not null default '',
  assignee_user_id uuid references public.app_users(id) on delete set null,
  participant_names text[] not null default '{}',
  team text not null default '',
  team_id uuid references public.teams(id) on delete set null,
  team_leader text not null default '',
  data_reporter text not null default '',
  reviewer text not null default '',
  data_volume integer not null default 0 check (data_volume >= 0),
  workforce integer not null default 0 check (workforce >= 0),
  created_at timestamptz not null default now(),
  deadline timestamptz,
  expected_deadline timestamptz,
  status text not null default '待完善' check (status in ('待完善', '待开始', '进行中', '数据完成', '待交付', '待验收', '已完成')),
  platform_task_id text,
  rule_doc_link text,
  difficulty smallint check (difficulty between 1 and 5),
  progress numeric(5,2) not null default 0 check (progress between 0 and 100),
  doc_completeness numeric(5,4) not null default 0 check (doc_completeness between 0 and 1),
  remark text,
  source_type text not null default 'manual' check (source_type in ('manual', 'excel', 'scheduler')),
  external_task_id text,
  source_dedupe_key text,
  source_updated_at timestamptz,
  imported_batch_id uuid references public.import_batches(id) on delete set null,
  settled_at timestamptz,
  settled_by uuid references public.app_users(id),
  created_by uuid references public.app_users(id),
  updated_at timestamptz not null default now()
);

create unique index tasks_external_source_unique_idx
  on public.tasks(source_type, external_task_id)
  where external_task_id is not null;
create unique index tasks_source_dedupe_unique_idx
  on public.tasks(source_type, source_dedupe_key)
  where source_dedupe_key is not null;
create index tasks_team_status_idx on public.tasks(team, status);
create index tasks_assignee_idx on public.tasks(assignee);
create index tasks_hierarchy_idx on public.tasks(ownership, main_task_snapshot, linked_task_snapshot);
create index tasks_deadline_idx on public.tasks(expected_deadline, deadline);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  doc_type text not null,
  name text not null,
  link text,
  storage_key text,
  uploader text not null,
  uploader_user_id uuid references public.app_users(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  status text not null default 'pending_review' check (status in ('pending_review', 'approved', 'rejected')),
  reviewed_by text,
  reviewed_by_user_id uuid references public.app_users(id) on delete set null,
  reviewed_at timestamptz,
  review_comment text,
  version integer not null default 1 check (version >= 1),
  replaced_document_id uuid references public.documents(id) on delete set null,
  root_document_id uuid references public.documents(id) on delete cascade,
  admin_review_status text not null default 'not_submitted' check (admin_review_status in ('not_submitted', 'pending', 'approved', 'rejected')),
  submitted_to_admin_at timestamptz,
  admin_reviewed_by text,
  admin_reviewed_by_user_id uuid references public.app_users(id) on delete set null,
  admin_reviewed_at timestamptz,
  admin_review_comment text,
  admin_revision_count integer not null default 0 check (admin_revision_count >= 0),
  review_route text not null default 'undecided' check (review_route in ('undecided', 'leader_only', 'leader_then_admin')),
  workflow_status text not null default 'pending_leader_review' check (workflow_status in ('pending_leader_review', 'member_revision_required', 'pending_admin_review', 'leader_revision_required', 'completed_by_leader', 'completed_by_admin')),
  leader_rejection_count integer not null default 0 check (leader_rejection_count >= 0),
  final_approval_level text check (final_approval_level in ('leader', 'admin')),
  completed_by text,
  completed_by_user_id uuid references public.app_users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index documents_root_version_unique_idx
  on public.documents(root_document_id, version)
  where root_document_id is not null;
create index documents_task_uploaded_idx on public.documents(task_id, uploaded_at desc);
create index documents_workflow_idx on public.documents(workflow_status, uploaded_at desc);
create index documents_root_idx on public.documents(root_document_id, version desc);

create table public.document_review_events (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  root_document_id uuid not null references public.documents(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  actor text not null,
  actor_user_id uuid references public.app_users(id) on delete set null,
  actor_role text not null check (actor_role in ('管理员', '组长', '组员')),
  action text not null check (action in ('member_submitted', 'leader_rejected', 'leader_completed', 'leader_submitted_admin', 'admin_rejected', 'admin_completed', 'leader_returned_member', 'leader_resubmitted_admin')),
  from_status text,
  to_status text not null,
  comment text,
  created_at timestamptz not null default now()
);
create index document_review_events_root_idx on public.document_review_events(root_document_id, created_at);

create table public.progress_snapshots (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  total integer not null check (total >= 0),
  completed integer not null check (completed >= 0 and completed <= total),
  percentage numeric(5,2) not null check (percentage between 0 and 100),
  source_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);
create index progress_snapshots_task_idx on public.progress_snapshots(task_id, synced_at desc);

create table public.rule_change_records (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  summary text not null,
  published_by uuid references public.app_users(id),
  published_at timestamptz not null default now(),
  requires_rescan boolean not null default false
);

create table public.rescan_records (
  id uuid primary key default gen_random_uuid(),
  original_task_id uuid not null references public.tasks(id) on delete cascade,
  original_task_name text not null,
  reason text not null,
  description text,
  rescan_volume integer not null default 0 check (rescan_volume >= 0),
  executors text[] not null default '{}',
  contact_assistant text not null default '',
  expected_done timestamptz,
  actual_done timestamptz,
  accepted boolean,
  initiated_by uuid references public.app_users(id),
  rule_change_id uuid references public.rule_change_records(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index rescan_records_task_idx on public.rescan_records(original_task_id, created_at desc);

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  alert_type text not null,
  level text not null,
  message text,
  triggered_at timestamptz not null default now(),
  acknowledged boolean not null default false,
  acknowledged_by text,
  acknowledged_by_user_id uuid references public.app_users(id),
  acknowledged_at timestamptz,
  acknowledge_reason text
);
create index alerts_open_idx on public.alerts(task_id, triggered_at desc) where acknowledged = false;

create table public.difficulty_revisions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  difficulty smallint not null check (difficulty between 1 and 5),
  phase text not null check (phase in ('initial', 'final')),
  reason text,
  confirmed_by text not null,
  confirmed_by_user_id uuid references public.app_users(id),
  confirmed_at timestamptz not null default now()
);
create index difficulty_revisions_task_idx on public.difficulty_revisions(task_id, confirmed_at);

create table public.task_management_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  event_type text not null check (event_type in ('training_completed', 'rule_change_published', 'rescan_initiated', 'rescan_closed', 'data_acceptance_completed', 'evaluation_report_approved')),
  actor_id uuid references public.app_users(id),
  evidence_link text,
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index task_management_events_task_idx on public.task_management_events(task_id, occurred_at desc);

create table public.task_contributions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  member text not null,
  member_user_id uuid references public.app_users(id) on delete set null,
  tag text not null,
  evidence_type text check (evidence_type in ('document', 'rescan', 'acceptance')),
  evidence_id uuid,
  note text,
  attached_by text not null,
  attached_by_user_id uuid references public.app_users(id) on delete set null,
  attached_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'removed')),
  confirmed_by text,
  confirmed_by_user_id uuid references public.app_users(id) on delete set null,
  confirmed_at timestamptz
);
create index task_contributions_task_idx on public.task_contributions(task_id, attached_at desc);
create index task_contributions_member_idx on public.task_contributions(member_user_id, attached_at desc);

create table public.task_settlements (
  task_id uuid primary key references public.tasks(id) on delete cascade,
  confirmed_by text not null,
  confirmed_by_user_id uuid references public.app_users(id),
  confirmed_at timestamptz not null default now(),
  final_difficulty smallint not null check (final_difficulty between 1 and 5),
  difficulty_reason text,
  summary text,
  workload_points numeric(12,2)
);

create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  source_sheet text not null,
  source_row integer not null check (source_row > 0),
  raw_data jsonb not null,
  normalized_data jsonb,
  status text not null default 'pending' check (status in ('pending', 'ready', 'skipped', 'error', 'needs_match', 'committed')),
  error_message text,
  created_at timestamptz not null default now(),
  unique (batch_id, source_sheet, source_row)
);
create index import_rows_batch_idx on public.import_rows(batch_id, status);

create table public.task_match_queue (
  id uuid primary key default gen_random_uuid(),
  import_row_id uuid not null references public.import_rows(id) on delete cascade,
  candidate_task_id uuid references public.tasks(id) on delete set null,
  match_score numeric(5,2) check (match_score between 0 and 100),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  confirmed_by uuid references public.app_users(id),
  confirmed_at timestamptz
);

create table public.task_field_changes (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  field text not null,
  before_value jsonb,
  after_value jsonb,
  changed_by text not null,
  changed_by_user_id uuid references public.app_users(id),
  changed_at timestamptz not null default now()
);
create index task_field_changes_task_idx on public.task_field_changes(task_id, changed_at desc);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.app_users(id),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  before_value jsonb,
  after_value jsonb,
  request_id text,
  created_at timestamptz not null default now()
);
create index audit_logs_entity_idx on public.audit_logs(entity_type, entity_id, created_at desc);

create trigger task_relations_set_updated_at before update on public.task_relations
for each row execute function public.set_updated_at();
create trigger tasks_set_updated_at before update on public.tasks
for each row execute function public.set_updated_at();
create trigger documents_set_updated_at before update on public.documents
for each row execute function public.set_updated_at();
create trigger rescan_records_set_updated_at before update on public.rescan_records
for each row execute function public.set_updated_at();

alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.documents;
alter publication supabase_realtime add table public.progress_snapshots;
