const { weightInGrams } = require('./weight-records');

const digits = Array.from({ length: 10 }, (_, i) => String(i));
const decimalDigits = digits.map(digit => '.' + digit);
const units = Array.from({ length: 1000 }, (_, i) => String(i).padStart(3, '0'));
const wholeKilograms = Array.from({ length: 1001 }, (_, i) => String(i));
const thousands = Array.from({ length: 1001 }, (_, i) => i
  ? String(i).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ',' : '');

const ranges = {
  g: [thousands, units, decimalDigits, digits, digits],
  kg: [wholeKilograms, decimalDigits, digits, digits],
};

function quantityIndexes(value, unit = 'g') {
  const amount = typeof value === 'string' && /^(?:\d+(?:\.\d{1,3})?|\.\d{1,3})$/.test(value) ? value : '0';
  const [whole, fraction = ''] = amount.split('.');
  const decimal = fraction.padEnd(3, '0').split('').map(Number);
  return unit === 'kg' ? [Number(whole), ...decimal]
    : [Math.floor(Number(whole) / 1000), Number(whole) % 1000, ...decimal];
}

function wheelQuantity(indexes, unit) {
  const range = ranges[unit];
  if (!range || !Array.isArray(indexes) || indexes.length !== range.length
    || indexes.some((index, column) => !Number.isInteger(index) || index < 0 || index >= range[column].length)) return null;
  if (unit === 'kg') {
    const [whole, tenths, hundredths, thousandths] = indexes;
    const fraction = (tenths * 100 + hundredths * 10 + thousandths) / 1000;
    return whole > 1000 || (whole === 1000 && fraction) ? null : String(whole + fraction);
  }
  const [thousands, units, tenths, hundredths, thousandths] = indexes;
  const fraction = (tenths * 100 + hundredths * 10 + thousandths) / 1000;
  if (thousands > 1000 || (thousands === 1000 && (Number(units) || fraction))) return null;
  return String(thousands * 1000 + Number(units) + fraction);
}

function convertQuantity(value, from, to) {
  if (!value) return '';
  const grams = weightInGrams(value, from);
  if (grams === null) return null;
  const converted = String(to === 'kg' ? grams / 1000 : grams);
  return weightInGrams(converted, to) === grams ? converted : null;
}

module.exports = { ranges, quantityIndexes, wheelQuantity, convertQuantity };
