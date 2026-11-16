const STAGES = [
  { value: 'juvenile', name: '幼年' },
  { value: 'subadult', name: '亚成体' },
  { value: 'adult', name: '成体' },
  { value: 'senior', name: '老年' },
  { value: 'unknown', name: '待确认' },
];

// Published maturity or lifespan observations do not establish four life-stage
// intervals. Only verified stage intervals may replace these explicit unknowns.
const LIFE_STAGE_OPTIONS = STAGES.map((stage) => ({ ...stage,
  label: stage.value === 'unknown' ? stage.name : `${stage.name}（年月待核实）`,
}));

const REFERENCES = [
  { category: 'gecko', speciesName: '豹纹守宫', aliases: ['豹纹守宫', 'leopard gecko', 'eublepharis macularius'] },
  { category: 'snake', speciesName: '玉米蛇', aliases: ['玉米蛇', 'corn snake', 'pantherophis guttatus'] },
  { category: 'parrot', speciesName: '虎皮鹦鹉', aliases: ['虎皮鹦鹉', 'budgerigar', 'budgie', 'melopsittacus undulatus'] },
  { category: 'parrot', speciesName: '玄凤鹦鹉', aliases: ['玄凤鹦鹉', 'cockatiel', 'nymphicus hollandicus'] },
];

function getLifeStageReference(speciesCode, breed = '', customSpeciesName = '') {
  const normalize = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const identity = normalize(speciesCode === 'other' ? customSpeciesName : breed);
  const reference = REFERENCES.find((item) => (item.category === speciesCode || speciesCode === 'other') && item.aliases.includes(identity));
  const speciesName = speciesCode === 'rat' ? '花枝鼠' : reference ? reference.speciesName
    : speciesCode === 'other' && identity ? String(customSpeciesName).trim() : '具体物种待确认';
  return { speciesName, ageStatus: 'pending', note: speciesName === '具体物种待确认'
    ? '请在品种或补充说明中填写具体物种。当前分类不能共用一套年龄标准。'
    : speciesCode === 'other' && !reference ? `尚未核实“${speciesName}”的具体物种与年月范围，可先手动选择阶段。`
    : `${speciesName}的四阶段年月范围待核实，可先手动选择阶段。` };
}

function lifeStageLabel(value) {
  const stage = STAGES.find((item) => item.value === value);
  return stage ? stage.name : '待确认';
}

module.exports = { LIFE_STAGE_OPTIONS, getLifeStageReference, lifeStageLabel };
