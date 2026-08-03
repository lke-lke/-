import * as XLSX from 'xlsx';

export type LedgerKind = 'task' | 'rescan';

export interface ImportedRow {
  key: string;
  sourceSheet: string;
  sourceRow: number;
  name: string;
  externalId?: string;
  date?: string;
  volume?: number;
  detail: string;
  warnings: string[];
  payload: Record<string, unknown>;
}

export interface LedgerPreview {
  kind: LedgerKind;
  sourceName: string;
  total: number;
  ready: number;
  review: number;
  fieldMapping: Array<{ source: string; target: string }>;
  rows: ImportedRow[];
}

const empty = (value: unknown) => value === undefined || value === null || value === '' || value === '/' || value === '-';
const text = (value: unknown) => empty(value) ? '' : String(value).trim();
const number = (value: unknown) => Number(text(value).replace(/,/g, '')) || 0;

function date(value: unknown): string | undefined {
  if (empty(value)) return undefined;
  if (typeof value === 'number') {
    return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10);
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

function rowsForSheet(book: XLSX.WorkBook, name: string): unknown[][] {
  return XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: '', raw: true }) as unknown[][];
}

function headerIndex(headers: unknown[]) {
  return new Map(headers.map((header, index) => [text(header).replace(/\n/g, ''), index]));
}

const value = (row: unknown[], headers: Map<string, number>, name: string) => row[headers.get(name) ?? -1];

export async function previewLedger(file: File): Promise<LedgerPreview> {
  const book = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
  if (book.SheetNames.includes('任务包留存-各任务包负责人')) return previewTasks(book, file.name);
  if (book.SheetNames.some(name => /借调/.test(name))) return previewRescans(book, file.name);
  throw new Error('未识别的台账格式：请上传任务留存或业务借调明细文件。');
}

function previewTasks(book: XLSX.WorkBook, sourceName: string): LedgerPreview {
  const sheet = '任务包留存-各任务包负责人';
  const rows = rowsForSheet(book, sheet);
  const headers = headerIndex(rows[0] || []);
  const imported = rows.slice(2).flatMap((row, index) => {
    const name = text(value(row, headers, '任务名称'));
    if (!name || name === '示例') return [];
    const rawExternalId = text(value(row, headers, '任务id'));
    const externalId = /^\d{10,}$/.test(rawExternalId) ? rawExternalId : '';
    const warnings: string[] = [];
    if (!externalId) warnings.push('缺少有效任务 ID，需按任务名称和下发日期去重');
    warnings.push('台账未提供系统负责人/小组，导入确认时需人工归属');
    return [{
      key: `${sheet}-${index + 3}`,
      sourceSheet: sheet,
      sourceRow: index + 3,
      name,
      externalId: externalId || undefined,
      date: date(value(row, headers, '任务下发时间')),
      volume: number(value(row, headers, '数据量级')),
      detail: `${text(value(row, headers, '任务归属'))} · ${text(value(row, headers, '任务分组'))} · ${text(value(row, headers, '作业性质'))}`,
      warnings,
      payload: {
        ownership: text(value(row, headers, '任务归属')), taskGroup: text(value(row, headers, '任务分组')),
        workNature: text(value(row, headers, '作业性质')), deadline: date(value(row, headers, '预期交付时间')),
        teamLeader: text(value(row, headers, '对应任务组长（站点）')), dataReporter: text(value(row, headers, '数据报告同学')),
        reviewer: text(value(row, headers, '对应验收同学')), ruleDoc: text(value(row, headers, '规则文档')),
      },
    }];
  });
  return {
    kind: 'task', sourceName, total: imported.length, ready: imported.filter(row => row.warnings.length === 1).length,
    review: imported.filter(row => row.warnings.length > 1).length, rows: imported,
    fieldMapping: [
      { source: '任务名称', target: '任务名称' }, { source: '任务id', target: '外部任务 ID' },
      { source: '任务归属 / 任务分组 / 作业性质', target: '任务分类' }, { source: '数据量级 / 作业人力', target: '工作量' },
      { source: '任务下发时间 / 预期交付时间', target: '开始与截止时间' }, { source: '组长 / 报告 / 验收同学', target: '协作信息' },
    ],
  };
}

function previewRescans(book: XLSX.WorkBook, sourceName: string): LedgerPreview {
  const imported: ImportedRow[] = [];
  book.SheetNames.filter(name => /借调/.test(name)).forEach(sheet => {
    const rows = rowsForSheet(book, sheet);
    const headers = headerIndex(rows[1] || []);
    rows.slice(2).forEach((row, index) => {
      const name = text(value(row, headers, '任务类型 / 任务名称（如数据处理写清楚类型，验收写清楚任务名称）'));
      if (!name) return;
      const accepted = text(value(row, headers, '验收是否通过'));
      const warnings = ['借调表无原任务 ID，需按任务名称关联任务台账'];
      if (!text(value(row, headers, '对接业务助理'))) warnings.push('缺少对接业务助理');
      imported.push({
        key: `${sheet}-${index + 3}`, sourceSheet: sheet, sourceRow: index + 3, name,
        date: date(value(row, headers, '日期')), volume: number(value(row, headers, '协助量级')),
        detail: `${text(value(row, headers, '姓名'))} · ${text(value(row, headers, '找case'))}${accepted ? ` · 验收${accepted}` : ''}`,
        warnings,
        payload: { executor: text(value(row, headers, '姓名')), contactAssistant: text(value(row, headers, '对接业务助理')), accepted },
      });
    });
  });
  return {
    kind: 'rescan', sourceName, total: imported.length, ready: 0, review: imported.length, rows: imported,
    fieldMapping: [
      { source: '日期 / 月份 Sheet', target: '回扫登记日期' }, { source: '姓名 / 工号', target: '执行人' },
      { source: '对接业务助理', target: '对接助理' }, { source: '协助量级', target: '回扫数据量' },
      { source: '任务类型 / 任务名称', target: '关联任务（待匹配）' }, { source: '验收字段', target: '验收状态' },
    ],
  };
}
