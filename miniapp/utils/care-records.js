const { quantityInGrams } = require('./quantity-picker');

function careFields(kind, value, note, amount = '', unit = 'g') {
  value = value.trim();
  note = note.trim();
  if (kind === '生病' && !note) return { error: '请描述观察到的症状' };
  if (kind === '体重' || (kind === '喂食' && amount)) {
    const grams = quantityInGrams(amount, unit);
    if (grams === null) return { error: kind === '体重' ? '请选择本次体重' : '请选择有效喂食克数' };
    if (kind === '喂食' && value) note = note ? `食物：${value}\n${note}` : `食物：${value}`;
    value = `${grams}g`;
  }
  if (note.length > 2000) return { error: '请缩短食物说明或备注' };
  return { value: value || null, note: note || null };
}

module.exports = { careFields };
