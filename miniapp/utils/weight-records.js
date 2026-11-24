const { formatDateTime } = require('./format');

// Older records are free text; use only measurements with an explicit unit.
function weightInGrams(value, unit) {
  if (typeof value !== 'string' || !/^(?:\d+(?:\.\d{1,3})?|\.\d{1,3})$/.test(value.trim())) return null;
  const grams = Math.round(Number(value.trim()) * (unit === 'kg' ? 1000 : 1) * 1000) / 1000;
  return Number.isFinite(grams) && grams > 0 && grams <= 1000000 ? grams : null;
}

function recentWeights(logs, petId, kind = '体重') {
  return logs.flatMap((log) => {
    if (log.petId !== petId || log.kind !== kind || typeof log.value !== 'string') return [];
    const match = /^\s*((?:\d+(?:\.\d{1,3})?|\.\d{1,3}))\s*(kg|g|千克|公斤|克)\s*$/i.exec(log.value);
    const timestamp = log.recordedAt ? Date.parse(log.recordedAt) : NaN;
    if (!match || !Number.isFinite(timestamp)) return [];
    const grams = weightInGrams(match[1], /^(kg|千克|公斤)$/i.test(match[2]) ? 'kg' : 'g');
    return grams === null ? [] : [{ id: log.id, grams, displayValue: String(grams), recordedAt: log.recordedAt,
      date: formatDateTime(log.recordedAt).slice(5, 10), time: formatDateTime(log.recordedAt) }];
  }).sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt) || String(a.id).localeCompare(String(b.id))).slice(-7);
}

function weightChange(records) {
  if (records.length < 2) return '';
  const change = Math.round((records[records.length - 1].grams - records[records.length - 2].grams) * 1000) / 1000;
  return (change > 0 ? '+' : '') + change + ' g';
}

module.exports = { weightInGrams, recentWeights, weightChange };
