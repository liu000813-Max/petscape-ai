const { weightInGrams } = require('./weight-records');

const digits = Array.from({ length: 10 }, (_, i) => String(i));
const decimalDigits = digits.map(digit => '.' + digit);
const units = Array.from({ length: 1000 }, (_, i) => String(i).padStart(3, '0'));
const wholeKilograms = Array.from({ length: 1001 }, (_, i) => String(i));
const thousands = Array.from({ length: 1001 }, (_, i) => i
  ? String(i).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ',' : '');

const ranges = {
  g: [thousands, units, decimalDigits],
  kg: [wholeKilograms, decimalDigits],
};

function quantityInGrams(value, unit) {
  if (typeof value !== 'string' || !/^(?:\d+(?:\.\d)?|\.\d)$/.test(value)) return null;
  return weightInGrams(value, unit);
}

function quantityIndexes(value, unit = 'g') {
  const amount = quantityInGrams(value, unit) === null ? '0' : value;
  const [whole, fraction = 0] = amount.split('.').map(Number);
  return unit === 'kg' ? [whole, fraction]
    : [Math.floor(whole / 1000), whole % 1000, fraction];
}

function wheelQuantity(indexes, unit) {
  const range = ranges[unit];
  if (!range || !Array.isArray(indexes) || indexes.length !== range.length
    || indexes.some((index, column) => !Number.isInteger(index) || index < 0 || index >= range[column].length)) return null;
  const whole = unit === 'kg' ? indexes[0] : indexes[0] * 1000 + indexes[1];
  const amount = String(whole + indexes[indexes.length - 1] / 10);
  return amount === '0' || quantityInGrams(amount, unit) !== null ? amount : null;
}

function convertQuantity(value, from, to) {
  if (!value) return '';
  const grams = quantityInGrams(value, from);
  if (grams === null) return null;
  const converted = String(to === 'kg' ? grams / 1000 : grams);
  return quantityInGrams(converted, to) === grams ? converted : null;
}

module.exports = { ranges, quantityIndexes, wheelQuantity, convertQuantity, quantityInGrams };
