const EMPTY_VALUES = new Set(['', '/', '-', '—', '无', 'null', 'undefined']);
const empty = value => value === undefined || value === null || EMPTY_VALUES.has(String(value).trim().toLowerCase());
const text = value => empty(value) ? '' : String(value).replace(/[\u00a0\u200b-\u200d\uFEFF]/g, ' ').trim();
const normalizeLookup = value => text(value).toLowerCase().replace(/[\s\-—_（）()【】\[\]·:：/\\]/g, '');

function parseNumber(value, field = '数据量级') {
  if (empty(value)) return {};
  const raw = text(value).replace(/,/g, '');
  const unit = /万/.test(raw) ? 10000 : /千/.test(raw) ? 1000 : 1;
  const parsed = Number(raw.replace(/[万千条人]/g, ''));
  if (!Number.isFinite(parsed) || parsed < 0) return { issue: { code: 'INVALID_NUMBER', field, level: 'error', message: `无法识别数值“${raw}”` } };
  return { value: Math.round(parsed * unit) };
}

function parseHours(value) {
  if (empty(value)) return {};
  const raw = text(value).replace(/,/g, '').replace(/[小时时hH]/g, '');
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return { issue: { code: 'INVALID_NUMBER', field: '支援时长', level: 'error', message: `无法识别时长“${text(value)}”` } };
  return { value: Math.round(parsed * 100) / 100 };
}

function parseDate(value, field) {
  if (empty(value)) return {};
  const parsed = typeof value === 'number'
    ? new Date(Date.UTC(1899, 11, 30) + value * 86400000)
    : new Date(text(value).replace(/[年/.]/g, '-').replace(/月/g, '-').replace(/日/g, ''));
  if (Number.isNaN(parsed.getTime())) return { issue: { code: 'INVALID_DATE', field, level: 'error', message: `无法识别日期“${text(value)}”` } };
  return { value: parsed.toISOString().slice(0, 10) };
}

function parseExternalId(value) {
  if (empty(value)) return {};
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || /e/i.test(String(value)))) return { issue: { code: 'UNSAFE_TASK_ID', field: '任务id', level: 'error', message: '任务 ID 已被 Excel 转为不安全的长数字/科学计数法，请将该列设为文本后重新上传' } };
  const result = text(value).replace(/\.0$/, '');
  // 台账用这些文字表示“没有平台任务 ID”。不能拿它们做去重键，
  // 否则多条线下任务会被合并为同一条任务。
  if (['线下表', 'oneday', '1d作业'].includes(result.toLowerCase())) return {};
  if (/e[+-]?\d+/i.test(result)) return { issue: { code: 'SCIENTIFIC_TASK_ID', field: '任务id', level: 'error', message: '任务 ID 不能使用科学计数法，请将该列设为文本' } };
  return { value: result };
}

function parseDifficulty(value) {
  if (empty(value)) return {};
  const parsed = Number(text(value).replace(/[星★☆级]/g, ''));
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) return { issue: { code: 'INVALID_DIFFICULTY', field: '下发难度', level: 'error', message: `难度星级必须是 1-5，当前为“${text(value)}”` } };
  return { value: parsed };
}

function parseAcceptance(value) {
  if (empty(value)) return {};
  const normalized = normalizeLookup(value);
  if (['是', '通过', '已通过', 'true', 'yes', '1'].includes(normalized)) return { value: true };
  if (['否', '不通过', '未通过', 'false', 'no', '0'].includes(normalized)) return { value: false };
  return { issue: { code: 'INVALID_ACCEPTANCE', field: '验收是否通过', level: 'warning', message: `无法识别验收结果“${text(value)}”` } };
}

function splitPeople(value) {
  if (empty(value)) return [];
  return [...new Set(text(value).split(/[、,，;；/\n&和]+/).map(name => name.trim()).filter(Boolean))];
}

module.exports = { empty, text, normalizeLookup, parseNumber, parseHours, parseDate, parseExternalId, parseDifficulty, parseAcceptance, splitPeople };
