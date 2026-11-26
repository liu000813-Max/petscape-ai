const { formatDateTime } = require('./format');

// Older records are free text; use only measurements with an explicit unit.
function weightInGrams(value, unit) {
  if (typeof value !== 'string' || !/^(?:\d+(?:\.\d{1,3})?|\.\d{1,3})$/.test(value.trim())) return null;
  const grams = Math.round(Number(value.trim()) * (unit === 'kg' ? 1000 : 1) * 1000) / 1000;
  return Number.isFinite(grams) && grams > 0 && grams <= 1000000 ? grams : null;
}

function recordedGrams(value) {
  const match = /^\s*((?:\d+(?:\.\d{1,3})?|\.\d{1,3}))\s*(kg|g|千克|公斤|克)\s*$/i.exec(value);
  return match ? weightInGrams(match[1], /^(kg|千克|公斤)$/i.test(match[2]) ? 'kg' : 'g') : null;
}

function weightLabel(grams) {
  const rounded = Math.round(grams * 10) / 10;
  return rounded === 0 && grams > 0 ? '＜0.1' : String(rounded);
}

function careAmountLabel({ kind, value }) {
  if ((kind !== '体重' && kind !== '喂食') || typeof value !== 'string') return value;
  const grams = recordedGrams(value);
  return grams === null ? value : weightLabel(grams) + ' g';
}

function recentWeights(logs, petId, kind = '体重') {
  return logs.flatMap((log) => {
    if (log.petId !== petId || log.kind !== kind || typeof log.value !== 'string') return [];
    const timestamp = log.recordedAt ? Date.parse(log.recordedAt) : NaN;
    if (!Number.isFinite(timestamp)) return [];
    const grams = recordedGrams(log.value);
    return grams === null ? [] : [{ id: log.id, grams, displayValue: weightLabel(grams), recordedAt: log.recordedAt,
      date: formatDateTime(log.recordedAt).slice(5, 10), time: formatDateTime(log.recordedAt) }];
  }).sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt) || String(a.id).localeCompare(String(b.id))).slice(-7);
}

function weightChange(records) {
  if (records.length < 2) return '';
  const change = Math.round((records[records.length - 1].grams - records[records.length - 2].grams) * 1000) / 1000;
  const rounded = Math.round(Math.abs(change) * 10) / 10;
  return (rounded ? (change > 0 ? '+' : '−') : '') + rounded + ' g';
}

function timePositions(records, left, right) {
  if (!records.length) return [];
  const start = Date.parse(records[0].recordedAt);
  const span = Date.parse(records[records.length - 1].recordedAt) - start;
  return records.map(record => span > 0
    ? left + (right - left) * ((Date.parse(record.recordedAt) - start) / span)
    : (left + right) / 2);
}

function chartDates(records) {
  if (!records.length) return { first: '', middle: '', last: '' };
  const first = records[0];
  const last = records[records.length - 1];
  const firstDay = first.time.slice(0, 10);
  const lastDay = last.time.slice(0, 10);
  if (firstDay === lastDay) return { first: '', middle: last.date, last: '' };
  const spansYears = firstDay.slice(0, 4) !== lastDay.slice(0, 4);
  return { first: spansYears ? firstDay : first.date, middle: '', last: spansYears ? lastDay : last.date };
}

module.exports = { weightInGrams, recordedGrams, recentWeights, weightChange, weightLabel, careAmountLabel, timePositions, chartDates };
