const SPECIES_OPTIONS = [
  { value: 'rat', label: '花枝鼠', emoji: '🐀', image: '/assets/species-rat.png' },
  { value: 'gecko', label: '守宫', emoji: '🦎', image: '/assets/species-gecko.png' },
  { value: 'snake', label: '蛇类', emoji: '🐍', image: '/assets/species-snake.png' },
  { value: 'parrot', label: '鹦鹉', emoji: '🦜', image: '/assets/species-parrot.png' },
  { value: 'spider', label: '蜘蛛', emoji: '🕷️', image: '/assets/species-spider.png' },
  { value: 'other', label: '其他异宠', emoji: '🐾', image: '' },
];

const SPECIES_BY_VALUE = SPECIES_OPTIONS.reduce((result, item) => {
  result[item.value] = item;
  return result;
}, {});

function getSpeciesMeta(value) {
  return SPECIES_BY_VALUE[value] || SPECIES_BY_VALUE.other;
}

module.exports = { SPECIES_OPTIONS, getSpeciesMeta };
