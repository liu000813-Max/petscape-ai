const SPECIES_OPTIONS = [
  { value: 'rat', label: '花枝鼠', emoji: '🐀' },
  { value: 'gecko', label: '守宫', emoji: '🦎' },
  { value: 'snake', label: '蛇类', emoji: '🐍' },
  { value: 'parrot', label: '鹦鹉', emoji: '🦜' },
  { value: 'spider', label: '蜘蛛', emoji: '🕷️' },
  { value: 'other', label: '其他异宠', emoji: '🐾' },
];

const SPECIES_BY_VALUE = SPECIES_OPTIONS.reduce((result, item) => {
  result[item.value] = item;
  return result;
}, {});

function getSpeciesMeta(value) {
  return SPECIES_BY_VALUE[value] || SPECIES_BY_VALUE.other;
}

module.exports = { SPECIES_OPTIONS, getSpeciesMeta };
