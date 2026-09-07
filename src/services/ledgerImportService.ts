import * as XLSX from 'xlsx';
import { Team, TEAM_LEADERS, TEAM_MEMBERS } from '@/constants';
import { Task, TaskRelation } from '@/types';
import { ensureOnedayClient } from '@/onedaycloud';
import { USE_MOCK } from './db';
import { getTaskRelations } from './taskRelationService';
import { empty, normalizeLookup, parseAcceptance, parseDate, parseDifficulty, parseExternalId, parseHours, parseNumber, splitPeople, text } from '@/utils/ledgerParsing';

export type LedgerKind = 'task' | 'rescan';
export type ImportRowStatus = 'ready' | 'needs_completion' | 'conflict' | 'error';

export interface ImportIssue {
  code: string;
  field: string;
  level: 'warning' | 'error';
  message: string;
  candidates?: string[];
}

export interface CanonicalTaskRow {
  name: string;
  externalTaskId?: string;
  ownership?: string;
  taskGroup?: string;
  workNature?: string;
  dataVolume?: number;
  workforce?: number;
  dispatchedAt?: string;
  expectedDeadline?: string;
  difficulty?: number;
  sourceDocumentLink?: string;
  acceptancePeople: string[];
}

export interface TaskRowResolution {
  relation?: TaskRelation;
  relationMatch: 'exact' | 'unique_inferred' | 'explicit_temporary' | 'unmatched' | 'ambiguous';
  team?: Team;
  participants: string[];
  primaryAssignee?: string;
  matchedPeople: Array<{ source: string; canonical: string; team: Team; isLeader: boolean; match: 'exact' | 'alias' }>;
  unknownPeople: string[];
}

export interface ImportedRow {
  key: string;
  databaseId?: string;
  sourceSheet: string;
  sourceRow: number;
  name: string;
  externalId?: string;
  date?: string;
  volume?: number;
  detail: string;
  warnings: string[];
  issues: ImportIssue[];
  status: ImportRowStatus;
  canonical?: CanonicalTaskRow;
  resolution?: TaskRowResolution;
  action?: 'create' | 'update' | 'skip';
  matchedTaskId?: string;
  payload: Record<string, unknown>;
}

export interface LedgerPreview {
  batchId?: string;
  kind: LedgerKind;
  sourceName: string;
  total: number;
  ready: number;
  review: number;
  summary: Record<ImportRowStatus, number>;
  fieldMapping: Array<{ source: string; target: string }>;
  rows: ImportedRow[];
}

function rowsForSheet(book: XLSX.WorkBook, name: string): unknown[][] {
  return XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: '', raw: true }) as unknown[][];
}

function locateHeader(rows: unknown[][], required: string): number {
  const max = Math.min(rows.length, 12);
  for (let index = 0; index < max; index += 1) {
    if (rows[index].some(cell => text(cell).replace(/\s/g, '') === required)) return index;
  }
  return -1;
}

function headerIndex(headers: unknown[]) {
  return new Map(headers.map((header, index) => [text(header).replace(/[\s\n]/g, ''), index]));
}

function sourceValue(row: unknown[], headers: Map<string, number>, ...names: string[]) {
  for (const name of names) {
    const index = headers.get(name.replace(/[\s\n]/g, ''));
    if (index !== undefined && !empty(row[index])) return row[index];
  }
  return undefined;
}

function rawObject(headers: unknown[], row: unknown[]): Record<string, unknown> {
  return headers.reduce<Record<string, unknown>>((result, header, index) => {
    const key = text(header) || `未命名列${index + 1}`;
    result[key] = row[index];
    return result;
  }, {});
}

const PERSON_ALIASES: Record<string, string> = { 阿部: '成妍', 成研: '成妍' };

function resolvePeople(names: string[]): Omit<TaskRowResolution, 'relation' | 'relationMatch'> {
  const matchedPeople: TaskRowResolution['matchedPeople'] = [];
  const unknownPeople: string[] = [];
  names.forEach(source => {
    const alias = PERSON_ALIASES[source];
    const canonical = alias || source;
    const team = (Object.values(Team) as Team[]).find(item => TEAM_MEMBERS[item].includes(canonical));
    if (!team) unknownPeople.push(source);
    else matchedPeople.push({ source, canonical, team, isLeader: TEAM_LEADERS[team] === canonical, match: alias ? 'alias' : 'exact' });
  });
  const teams = [...new Set(matchedPeople.map(item => item.team))];
  const team = teams.length === 1 ? teams[0] : undefined;
  const participants = [...new Set(matchedPeople.map(item => item.canonical))];
  const ordinary = matchedPeople.filter(item => !item.isLeader);
  return { team, participants, primaryAssignee: ordinary.length === 1 ? ordinary[0].canonical : undefined, matchedPeople, unknownPeople };
}

function resolveRelation(ownership: string, taskGroup: string, relations: TaskRelation[]): Pick<TaskRowResolution, 'relation' | 'relationMatch'> {
  const ownershipKey = normalizeLookup(ownership);
  const groupKey = normalizeLookup(taskGroup);
  if (!groupKey) return { relationMatch: 'unmatched' };
  const exact = relations.filter(item => normalizeLookup(item.ownership) === ownershipKey && normalizeLookup(item.linkedTask) === groupKey);
  if (exact.length === 1) return { relation: exact[0], relationMatch: exact[0].mainTask === '临时任务' ? 'explicit_temporary' : 'exact' };
  if (exact.length > 1) return { relationMatch: 'ambiguous' };
  // 台账已明确任务归属时以台账为准，不能因为其他归属下存在同名分组
  // 就静默改写任务归属。只有归属为空时才允许按唯一分组反推。
  if (ownershipKey) return { relationMatch: 'unmatched' };
  const byGroup = relations.filter(item => normalizeLookup(item.linkedTask) === groupKey);
  if (byGroup.length === 1) return { relation: byGroup[0], relationMatch: 'unique_inferred' };
  return { relationMatch: byGroup.length > 1 ? 'ambiguous' : 'unmatched' };
}

function statusFor(issues: ImportIssue[]): ImportRowStatus {
  if (issues.some(issue => issue.level === 'error' && ['INVALID_NUMBER', 'INVALID_DATE', 'UNSAFE_TASK_ID', 'SCIENTIFIC_TASK_ID', 'MISSING_NAME'].includes(issue.code))) return 'error';
  if (issues.some(issue => issue.level === 'error')) return 'conflict';
  return issues.length ? 'needs_completion' : 'ready';
}

function withSummary(kind: LedgerKind, sourceName: string, rows: ImportedRow[], fieldMapping: LedgerPreview['fieldMapping']): LedgerPreview {
  const summary: Record<ImportRowStatus, number> = { ready: 0, needs_completion: 0, conflict: 0, error: 0 };
  rows.forEach(row => { summary[row.status] += 1; });
  return { kind, sourceName, total: rows.length, ready: summary.ready, review: rows.length - summary.ready, summary, fieldMapping, rows };
}

export async function previewLedger(file: File): Promise<LedgerPreview> {
  const bytes = await file.arrayBuffer();
  const book = XLSX.read(bytes, { type: 'array', cellDates: false });
  const taskSheet = book.SheetNames.find(name => name === '任务包留存-各任务包负责人')
    || book.SheetNames.find(name => locateHeader(rowsForSheet(book, name), '任务名称') >= 0);
  if (taskSheet) {
    const relations = await getTaskRelations();
    const local = previewTasks(book, taskSheet, file.name, relations);
    return USE_MOCK ? local : persistTaskPreview(local, relations, await sha256(bytes));
  }
  if (book.SheetNames.some(name => /借调/.test(name))) {
    const local = previewRescans(book, file.name);
    return USE_MOCK ? local : persistRescanPreview(local, await sha256(bytes));
  }
  throw new Error('未识别的台账格式：未找到含“任务名称”的任务表或业务借调表。');
}

async function persistRescanPreview(preview: LedgerPreview, sourceHash: string): Promise<LedgerPreview> {
  const client = ensureOnedayClient(); if (!client) throw new Error('Supabase 尚未配置');
  const rows = preview.rows.map(row => ({ row_key: row.key, source_sheet: row.sourceSheet, source_row: row.sourceRow, raw_data: row.payload,
    normalized_data: { taskName: row.name, externalTaskId: row.externalId, date: row.date, volume: row.volume,
      executor: row.payload.executor, contactAssistant: row.payload.contactAssistant,
      accepted: typeof row.payload.accepted === 'boolean' ? row.payload.accepted : null,
      supportHours: row.payload.supportHours, sourceResult: row.payload.sourceResult,
      acceptanceDetail: row.payload.acceptanceDetail, detail: row.detail } }));
  const { data: batchData, error } = await client.supabase.rpc('preview_rescan_ledger_import_v2', {
    p_filename: preview.sourceName, p_rows: rows, p_source_hash: sourceHash,
    p_idempotency_key: `${sourceHash}:${new Date().toISOString().slice(0, 16)}`,
  });
  if (error) throw error;
  const batch = Array.isArray(batchData) ? batchData[0] : batchData;
  const { data: storedRows, error: rowsError } = await client.supabase.from('import_rows').select('*').eq('batch_id', batch.id).order('source_row');
  if (rowsError) throw rowsError;
  const localByKey = new Map(preview.rows.map(row => [row.key, row]));
  const merged = (storedRows || []).map((stored: any) => {
    const local = localByKey.get(stored.row_key)!;
    return { ...local, databaseId: stored.id, status: stored.status as ImportRowStatus, issues: stored.issues || [],
      warnings: (stored.issues || []).map((issue: ImportIssue) => issue.message), matchedTaskId: stored.resolved_data?.task_id,
      detail: stored.resolved_data?.task_name ? `${local.detail} · 已关联 ${stored.resolved_data.task_name}` : local.detail };
  });
  return { ...withSummary('rescan', preview.sourceName, merged, preview.fieldMapping), batchId: batch.id };
}

export async function resolveRescanPreviewRow(row: ImportedRow, task: Task): Promise<ImportedRow> {
  if (USE_MOCK) return { ...row, matchedTaskId: task.id, status: 'ready', issues: [], warnings: [], detail: `${row.detail} · 已关联 ${task.name}` };
  if (!row.databaseId) throw new Error('该行尚未生成服务端预览记录');
  const client = ensureOnedayClient(); if (!client) throw new Error('Supabase 尚未配置');
  const { data, error } = await client.supabase.rpc('resolve_rescan_import_row_v2', { p_import_row_id: row.databaseId, p_task_id: task.id });
  if (error) throw error;
  const stored: any = Array.isArray(data) ? data[0] : data;
  return { ...row, matchedTaskId: task.id, status: stored.status, issues: stored.issues || [], warnings: [], detail: `${row.detail.split(' · 已关联')[0]} · 已关联 ${task.name}` };
}

export async function commitRescanLedgerImport(preview: LedgerPreview, selectedRowKeys?: string[]) {
  if (USE_MOCK || !preview.batchId) return null;
  const client = ensureOnedayClient(); if (!client) throw new Error('Supabase 尚未配置');
  const keys = selectedRowKeys ? new Set(selectedRowKeys) : undefined;
  const rowIds = preview.rows.filter(row => row.databaseId && (!keys || keys.has(row.key))).map(row => row.databaseId!);
  const { data, error } = await client.supabase.rpc('commit_rescan_import_batch_v2', { p_batch_id: preview.batchId, p_row_ids: rowIds });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, '0')).join('');
}

function requestRows(preview: LedgerPreview) {
  return preview.rows.map(row => ({
    row_key: row.key, source_sheet: row.sourceSheet, source_row: row.sourceRow,
    raw_data: row.payload, normalized_data: row.canonical,
  }));
}

function serverResolution(value: any, relations: TaskRelation[]): TaskRowResolution {
  const matched = (value?.matched_people || []).map((person: any) => ({
    source: person.source, canonical: person.canonical, team: person.team as Team,
    isLeader: Boolean(person.is_leader), match: person.match === 'alias' ? 'alias' as const : 'exact' as const,
  }));
  return {
    relation: relations.find(relation => relation.id === value?.relation_id),
    relationMatch: value?.relation_match || 'unmatched', team: value?.team as Team | undefined,
    participants: value?.participants || [], primaryAssignee: value?.primary_assignee || undefined,
    matchedPeople: matched, unknownPeople: [],
  };
}

async function persistTaskPreview(preview: LedgerPreview, relations: TaskRelation[], sourceHash: string): Promise<LedgerPreview> {
  const client = ensureOnedayClient();
  if (!client) throw new Error('Supabase 尚未配置');
  const idempotencyKey = `${sourceHash}:${new Date().toISOString().slice(0, 16)}`;
  const { data: batchData, error: batchError } = await client.supabase.rpc('preview_task_ledger_import_v2', {
    p_filename: preview.sourceName, p_rows: requestRows(preview), p_source_hash: sourceHash,
    p_source_version: 'task-ledger-v2', p_request_id: crypto.randomUUID(), p_idempotency_key: idempotencyKey,
  });
  if (batchError) throw batchError;
  const batch = Array.isArray(batchData) ? batchData[0] : batchData;
  const { data: storedRows, error: rowsError } = await client.supabase.from('import_rows').select('*').eq('batch_id', batch.id).order('source_row');
  if (rowsError) throw rowsError;
  const localByKey = new Map(preview.rows.map(row => [row.key, row]));
  const rows = (storedRows || []).map((stored: any) => {
    const local = localByKey.get(stored.row_key)!;
    const resolution = serverResolution(stored.resolved_data, relations);
    return {
      ...local, databaseId: stored.id, status: stored.status as ImportRowStatus,
      issues: stored.issues || [], warnings: (stored.issues || []).map((issue: ImportIssue) => issue.message),
      resolution, action: stored.action || stored.resolved_data?.action,
      detail: `${resolution.relation?.ownership || '未识别归属'} · ${resolution.relation?.mainTask || '未识别主任务'} · ${resolution.relation?.linkedTask || local.canonical?.taskGroup || '未识别分组'}`,
    };
  });
  return { ...withSummary('task', preview.sourceName, rows, preview.fieldMapping), batchId: batch.id };
}

export async function resolvePreviewRow(
  preview: LedgerPreview,
  row: ImportedRow,
  relation: TaskRelation,
  participants: string[],
  primaryAssignee?: string,
): Promise<ImportedRow> {
  if (USE_MOCK) {
    const people = resolvePeople(participants);
    const retained = row.issues.filter(issue => !['RELATION_UNMATCHED', 'RELATION_AMBIGUOUS', 'PERSON_UNMATCHED', 'CROSS_TEAM_PEOPLE', 'TEAM_REQUIRED', 'PRIMARY_ASSIGNEE_REQUIRED', 'PRIMARY_NOT_PARTICIPANT'].includes(issue.code));
    if (!primaryAssignee) retained.push({ code: 'PRIMARY_ASSIGNEE_REQUIRED', field: '主负责人', level: 'warning', message: '需组长确认主负责人' });
    const resolution: TaskRowResolution = { ...people, relation, relationMatch: 'exact', participants, primaryAssignee };
    return { ...row, resolution, issues: retained, warnings: retained.map(issue => issue.message), status: statusFor(retained), detail: `${relation.ownership} · ${relation.mainTask} · ${relation.linkedTask}` };
  }
  if (!row.databaseId) throw new Error('该行尚未生成服务端预览记录');
  const client = ensureOnedayClient(); if (!client) throw new Error('Supabase 尚未配置');
  const { data, error } = await client.supabase.rpc('resolve_import_row_v2', {
    p_import_row_id: row.databaseId, p_relation_id: relation.id,
    p_participant_names: participants, p_primary_assignee: primaryAssignee || null,
  });
  if (error) throw error;
  const stored: any = Array.isArray(data) ? data[0] : data;
  const relations = await getTaskRelations();
  const resolution = serverResolution(stored.resolved_data, relations);
  return { ...row, status: stored.status, issues: stored.issues || [], warnings: (stored.issues || []).map((issue: ImportIssue) => issue.message), resolution, action: stored.action, detail: `${resolution.relation?.ownership} · ${resolution.relation?.mainTask} · ${resolution.relation?.linkedTask}` };
}

function previewTasks(book: XLSX.WorkBook, sheet: string, sourceName: string, relations: TaskRelation[]): LedgerPreview {
  const rows = rowsForSheet(book, sheet);
  const headerRow = locateHeader(rows, '任务名称');
  if (headerRow < 0) throw new Error('任务台账缺少“任务名称”表头');
  const headerCells = rows[headerRow] || [];
  const headers = headerIndex(headerCells);
  const carry: Record<string, unknown> = {};
  const carryFields = ['任务归属', '任务分组', '作业性质'];
  const imported: ImportedRow[] = [];

  rows.slice(headerRow + 1).forEach((row, offset) => {
    carryFields.forEach(field => {
      const current = sourceValue(row, headers, field);
      if (!empty(current)) carry[field] = current;
    });
    const name = text(sourceValue(row, headers, '任务名称'));
    const rowMarker = text(sourceValue(row, headers, '日期'));
    // 真实台账的示例标记位于“日期”列，不在“任务名称”列。
    if (!name || name === '示例' || normalizeLookup(rowMarker) === '示例') return;
    const issues: ImportIssue[] = [];
    const external = parseExternalId(sourceValue(row, headers, '任务id', '任务ID'));
    const volume = parseNumber(sourceValue(row, headers, '数据量级'));
    const workforce = parseNumber(sourceValue(row, headers, '作业人力'));
    const dispatched = parseDate(sourceValue(row, headers, '任务下发时间'), '任务下发时间');
    const expected = parseDate(sourceValue(row, headers, '预期交付时间', '预计交付时间'), '预期交付时间');
    const difficulty = parseDifficulty(sourceValue(row, headers, '难度星级', '任务难度', '下发难度'));
    const sourceDocumentLink = text(sourceValue(row, headers, '规则文档', '规则文档链接', '来源文档链接'));
    [external.issue, volume.issue, workforce.issue, dispatched.issue, expected.issue, difficulty.issue].forEach(issue => { if (issue) issues.push(issue); });

    const ownership = text(sourceValue(row, headers, '任务归属') ?? carry['任务归属']);
    const taskGroup = text(sourceValue(row, headers, '任务分组', '任务') ?? carry['任务分组']);
    const workNature = text(sourceValue(row, headers, '作业性质') ?? carry['作业性质']);
    const acceptancePeople = splitPeople(sourceValue(row, headers, '对应验收同学'));
    const people = resolvePeople(acceptancePeople);
    const relation = resolveRelation(ownership, taskGroup, relations);
    const resolution: TaskRowResolution = { ...people, ...relation };

    if (!external.value) issues.push({ code: 'MISSING_EXTERNAL_ID', field: '任务id', level: 'warning', message: '缺少任务 ID，将按任务名称、下发日期和任务分组生成去重键' });
    if (!ownership) issues.push({ code: 'MISSING_OWNERSHIP', field: '任务归属', level: 'error', message: '任务归属为空，无法匹配挂链' });
    if (!taskGroup) issues.push({ code: 'MISSING_TASK_GROUP', field: '任务分组', level: 'error', message: '任务分组为空，无法匹配挂链' });
    if (relation.relationMatch === 'unmatched') issues.push({ code: 'RELATION_UNMATCHED', field: '任务分组', level: 'error', message: '未匹配到任务关系；不会自动归入临时任务' });
    if (relation.relationMatch === 'ambiguous') issues.push({ code: 'RELATION_AMBIGUOUS', field: '任务分组', level: 'error', message: '任务分组存在多个候选，请人工选择' });
    if (relation.relationMatch === 'unique_inferred') issues.push({ code: 'OWNERSHIP_INFERRED', field: '任务归属', level: 'warning', message: `已根据唯一任务分组推断为“${relation.relation?.ownership}”` });
    if (!acceptancePeople.length) issues.push({ code: 'MISSING_ACCEPTANCE_PEOPLE', field: '对应验收同学', level: 'error', message: '缺少对应验收同学，无法识别小组' });
    if (people.unknownPeople.length) issues.push({ code: 'PERSON_UNMATCHED', field: '对应验收同学', level: 'error', message: `未识别人员：${people.unknownPeople.join('、')}` });
    const matchedTeams = [...new Set(people.matchedPeople.map(item => item.team))];
    if (matchedTeams.length > 1) issues.push({ code: 'CROSS_TEAM_PEOPLE', field: '对应验收同学', level: 'error', message: `验收同学跨组：${matchedTeams.join('、')}` });
    if (!people.primaryAssignee) issues.push({ code: 'PRIMARY_ASSIGNEE_REQUIRED', field: '主负责人', level: 'warning', message: people.participants.length > 1 ? '存在多位参与人，需组长确认主负责人' : '未识别到唯一普通组员，需组长指定主负责人' });
    if (!expected.value) issues.push({ code: 'EXPECTED_DEADLINE_REQUIRED', field: '预计截止时间', level: 'warning', message: '需组长补充预计截止时间' });
    if (!difficulty.value) issues.push({ code: 'DIFFICULTY_REQUIRED', field: '下发难度', level: 'warning', message: '需组长填写下发难度' });

    const canonical: CanonicalTaskRow = {
      name, externalTaskId: external.value,
      ownership: relation.relation?.ownership || ownership || undefined,
      taskGroup: relation.relation?.linkedTask || taskGroup || undefined,
      workNature: workNature || undefined,
      dataVolume: volume.value, workforce: workforce.value,
      dispatchedAt: dispatched.value, expectedDeadline: expected.value, difficulty: difficulty.value,
      sourceDocumentLink: sourceDocumentLink || undefined,
      acceptancePeople,
    };
    const status = statusFor(issues);
    imported.push({
      key: `${sheet}:${headerRow + offset + 2}`, sourceSheet: sheet, sourceRow: headerRow + offset + 2,
      name, externalId: external.value, date: dispatched.value, volume: volume.value,
      detail: `${canonical.ownership || '未识别归属'} · ${resolution.relation?.mainTask || '未识别主任务'} · ${canonical.taskGroup || '未识别分组'}`,
      warnings: issues.map(issue => issue.message), issues, status, canonical, resolution,
      payload: rawObject(headerCells, row),
    });
  });

  return withSummary('task', sourceName, imported, [
    { source: '任务名称', target: '任务名称' }, { source: '任务id', target: '平台任务 ID / 外部去重键' },
    { source: '任务归属 + 任务分组', target: '任务归属 → 主任务 → 任务分组（自动挂链）' },
    { source: '作业性质 / 数据量级 / 作业人力', target: '作业与工作量事实' },
    { source: '任务下发时间', target: '业务下发时间（不覆盖系统创建时间）' },
    { source: '预期交付时间', target: '预计截止时间' },
    { source: '对应验收同学', target: '参与人、所属小组、候选主负责人' },
    { source: '规则文档', target: '任务已有资料 / 来源文档链接（不作为已验收交付物）' },
    { source: '对应任务组长（站点）/ 数据报告同学', target: '仅保留在原始导入记录，不写正式任务字段' },
  ]);
}

function previewRescans(book: XLSX.WorkBook, sourceName: string): LedgerPreview {
  const imported: ImportedRow[] = [];
  book.SheetNames.filter(name => /借调/.test(name)).forEach(sheet => {
    const rows = rowsForSheet(book, sheet);
    const headerRow = locateHeader(rows, '姓名');
    if (headerRow < 0) return;
    const headerCells = rows[headerRow];
    const headers = headerIndex(headerCells);
    rows.slice(headerRow + 1).forEach((row, offset) => {
      const name = text(sourceValue(row, headers, '任务类型/任务名称（如数据处理写清楚类型，验收写清楚任务名称）', '任务类型 / 任务名称（如数据处理写清楚类型，验收写清楚任务名称）'));
      if (!name) return;
      const dateResult = parseDate(sourceValue(row, headers, '日期'), '日期');
      const volumeResult = parseNumber(sourceValue(row, headers, '协助量级'));
      const contactAssistant = text(sourceValue(row, headers, '对接业务助理'));
      const acceptedResult = parseAcceptance(sourceValue(row, headers, '验收是否通过'));
      const supportHours = parseHours(sourceValue(row, headers, '支援时长（h）', '支援时长(h)'));
      const issues: ImportIssue[] = [
        { code: 'RESCAN_TASK_MATCH_REQUIRED', field: '关联任务', level: 'warning', message: '借调表无原任务 ID，需按任务名称、人员和日期候选匹配' },
      ];
      if (!contactAssistant) issues.push({ code: 'CONTACT_REQUIRED', field: '对接业务助理', level: 'error', message: '缺少对接业务助理' });
      if (dateResult.issue) issues.push(dateResult.issue);
      if (volumeResult.issue) issues.push(volumeResult.issue);
      if (supportHours.issue) issues.push(supportHours.issue);
      if (acceptedResult.issue) issues.push(acceptedResult.issue);
      imported.push({
        key: `${sheet}:${headerRow + offset + 2}`, sourceSheet: sheet, sourceRow: headerRow + offset + 2,
        name, date: dateResult.value, volume: volumeResult.value,
        detail: `${text(sourceValue(row, headers, '姓名'))} · ${text(sourceValue(row, headers, '找case', '支援事项'))}${acceptedResult.value !== undefined ? ` · 验收${acceptedResult.value ? '通过' : '未通过'}` : ''}`,
        warnings: issues.map(issue => issue.message), issues, status: statusFor(issues), payload: {
          ...rawObject(headerCells, row), executor: text(sourceValue(row, headers, '姓名')), contactAssistant,
          accepted: acceptedResult.value, supportHours: supportHours.value,
          sourceResult: text(sourceValue(row, headers, '产出结果')),
          acceptanceDetail: text(sourceValue(row, headers, '验收具体数据')),
        },
      });
    });
  });
  return withSummary('rescan', sourceName, imported, [
    { source: '日期 / 月份 Sheet', target: '回扫登记日期' }, { source: '姓名 / 工号', target: '执行人' },
    { source: '对接业务助理', target: '对接助理' }, { source: '协助量级', target: '回扫数据量' },
    { source: '任务类型 / 任务名称', target: '关联任务（候选匹配）' }, { source: '验收字段', target: '验收状态' },
  ]);
}

export async function commitTaskLedgerImport(preview: LedgerPreview, selectedRowKeys?: string[]) {
  if (USE_MOCK) return null;
  if (preview.kind !== 'task') throw new Error('该提交接口只接受任务台账');
  const client = ensureOnedayClient();
  if (!client) throw new Error('Supabase 尚未配置');
  const selected = selectedRowKeys ? new Set(selectedRowKeys) : undefined;
  const rows = preview.rows.filter(row => !selected || selected.has(row.key)).map(row => ({
    row_key: row.key,
    source_sheet: row.sourceSheet,
    source_row: row.sourceRow,
    raw_data: row.payload,
    normalized_data: row.canonical,
    resolved_data: row.resolution ? {
      relation_id: row.resolution.relation?.id,
      relation_match: row.resolution.relationMatch,
      team: row.resolution.team,
      participants: row.resolution.participants,
      primary_assignee: row.resolution.primaryAssignee,
      matched_people: row.resolution.matchedPeople,
    } : {},
    issues: row.issues,
    status: row.status,
  }));
  const { data, error } = await client.supabase.rpc('commit_task_ledger_import_v2', {
    p_filename: preview.sourceName, p_rows: rows, p_storage_key: null,
    p_idempotency_key: `${preview.sourceName}:${preview.total}:${rows.map(row => row.row_key).join('|')}`,
    p_batch_id: preview.batchId || null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function retryTaskImportRows(preview: LedgerPreview): Promise<LedgerPreview> {
  if (USE_MOCK || !preview.batchId) return preview;
  const client = ensureOnedayClient(); if (!client) throw new Error('Supabase 尚未配置');
  const failed = preview.rows.filter(row => row.databaseId && ['conflict', 'error'].includes(row.status));
  if (!failed.length) return preview;
  const { data: batchData, error } = await client.supabase.rpc('retry_task_import_rows_v2', {
    p_batch_id: preview.batchId, p_row_ids: failed.map(row => row.databaseId!), p_corrections: {}, p_request_id: crypto.randomUUID(),
  });
  if (error) throw error;
  const batch: any = Array.isArray(batchData) ? batchData[0] : batchData;
  const { data: storedRows, error: rowsError } = await client.supabase.from('import_rows').select('*').eq('batch_id', batch.id).order('source_row');
  if (rowsError) throw rowsError;
  const originalByDatabaseId = new Map(preview.rows.map(row => [row.databaseId, row]));
  const relations = await getTaskRelations();
  const rows = (storedRows || []).map((stored: any) => {
    const original = originalByDatabaseId.get(stored.retry_of_row_id);
    const resolution = serverResolution(stored.resolved_data, relations);
    return { ...original, key: stored.row_key, databaseId: stored.id, canonical: stored.normalized_data,
      payload: stored.raw_data, status: stored.status as ImportRowStatus, issues: stored.issues || [],
      warnings: (stored.issues || []).map((issue: ImportIssue) => issue.message), resolution, action: stored.action,
      detail: `${resolution.relation?.ownership || '未识别归属'} · ${resolution.relation?.mainTask || '未识别主任务'} · ${resolution.relation?.linkedTask || stored.normalized_data?.taskGroup || '未识别分组'}` } as ImportedRow;
  });
  return { ...withSummary('task', preview.sourceName, rows, preview.fieldMapping), batchId: batch.id };
}
