const { formatDateTime } = require('./format');
const { careAmountLabel, recentWeights, weightLabel } = require('./weight-records');
const { quantityInGrams } = require('./quantity-picker');

const DAY = 86400000;
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const FIRST_DATE = '1900-01-01';
const LAST_DATE = '2100-12-31';

function dayNumber(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return NaN;
  const date = new Date(day + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day ? date.getTime() / DAY : NaN;
}

function dateKey(day) { return new Date(day * DAY).toISOString().slice(0, 10); }

function validatePlan(input) {
  const { start, interval, mode, amount } = input || {};
  if (!Number.isFinite(dayNumber(start)) || start < FIRST_DATE || start > LAST_DATE) return { error: '请选择开始日期' };
  if (!/^\d{1,3}$/.test(interval) || Number(interval) < 1 || Number(interval) > 365) return { error: '周期请输入 1 至 365 天的整数' };
  if (mode === 'grams' && quantityInGrams(amount, 'g') === null) return { error: '请输入大于 0 的克数，最多一位小数' };
  if (mode === 'ratio' && (quantityInGrams(amount, 'g') === null || Number(amount) > 100)) return { error: '请输入大于 0、最多 100% 的比例，最多一位小数' };
  if (!['none', 'grams', 'ratio'].includes(mode)) return { error: '请选择食量方式' };
  return { plan: { start, interval: String(Number(interval)), mode, amount: mode === 'none' ? '' : String(Number(amount)) } };
}

function storageKey(petId) {
  const namespace = getApp().globalData.mockMode ? 'demo' : 'live';
  return 'petscape_feeding_plan_v1:' + namespace + ':' + encodeURIComponent(petId);
}

function readPlan(petId) {
  const saved = wx.getStorageSync(storageKey(petId));
  if (saved == null || saved === '') return null;
  const { plan, error } = validatePlan(saved);
  if (error) throw new Error(error);
  return plan;
}

function savePlan(petId, plan) {
  const key = storageKey(petId);
  if (plan) wx.setStorageSync(key, plan);
  else wx.removeStorageSync(key);
}

function isScheduled(plan, date, today) {
  if (!plan || date < today) return false;
  const elapsed = dayNumber(date) - dayNumber(plan.start);
  return elapsed >= 0 && elapsed % Number(plan.interval) === 0;
}

function feedingHistory(logs, petId) {
  const days = new Map();
  for (const log of logs) {
    if (log.petId !== petId || log.kind !== '喂食' || !log.recordedAt) continue;
    const time = formatDateTime(log.recordedAt);
    if (!time) continue;
    const day = time.slice(0, 10);
    if (!days.has(day)) days.set(day, []);
    days.get(day).push({ id: log.id, time: time.slice(11), amount: careAmountLabel(log), note: log.note });
  }
  return days;
}

function calendarMonth(month, today, selected, plan, history) {
  const start = dayNumber(month + '-01');
  const first = new Date(start * DAY);
  const leading = (first.getUTCDay() + 6) % 7;
  const end = dayNumber(changeMonth(month, 1) + '-01');
  return Array.from({ length: Math.ceil((leading + end - start) / 7) * 7 }, (_, index) => {
    const day = start - leading + index;
    const date = dateKey(day);
    if (day < start || day >= end) return { date, blank: true };
    const recorded = history.has(date);
    const scheduled = isScheduled(plan, date, today);
    return { date, day: Number(date.slice(-2)), today: date === today, selected: date === selected, recorded, scheduled,
      label: date + (date === today ? ' 今天' : '') + (scheduled ? ' 计划喂食' : '') + (recorded ? ' 已记录喂食' : '') };
  });
}

function changeMonth(month, delta) {
  const date = new Date(dayNumber(month + '-01') * DAY);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 7);
}

function planPortion(plan, weight, historyError) {
  if (!plan || plan.mode === 'none') return { portion: '', basis: '' };
  if (plan.mode === 'grams') return { portion: plan.amount + ' g', basis: '固定克数' };
  if (!weight) return { portion: '', basis: historyError ? '体重记录读取失败' : '近期暂无可换算的体重记录' };
  return { portion: weightLabel(weight.grams * Number(plan.amount) / 100) + ' g',
    basis: `${weight.displayValue} g × ${plan.amount}% · 称重于 ${weight.time}` };
}

function latestWeight(logs, petId) {
  const weights = recentWeights(logs, petId);
  return weights[weights.length - 1] || null;
}

module.exports = { WEEKDAYS, FIRST_DATE, LAST_DATE, dayNumber, changeMonth, calendarMonth, validatePlan, readPlan, savePlan,
  isScheduled, feedingHistory, planPortion, latestWeight };
