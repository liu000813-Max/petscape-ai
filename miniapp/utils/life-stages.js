const STAGES = [
  { value: 'juvenile', name: '幼年' },
  { value: 'subadult', name: '亚成体' },
  { value: 'adult', name: '成体' },
  { value: 'senior', name: '老年' },
  { value: 'unknown', name: '待确认' },
];

const REFERENCES = [
  {
    category: 'gecko', speciesName: '豹纹守宫',
    aliases: ['豹纹守宫', 'leopard gecko', 'eublepharis macularius'],
    sourceLabel: 'PetMD（DVM）', sourceUrl: 'https://www.petmd.com/reptile/how-long-do-leopard-geckos-live',
    ranges: { juvenile: '0–7 个月', subadult: '7–12 个月', adult: '12 个月以上' },
    note: '来源将 0–2 个月列为 hatchling、2–7 个月列为 juvenile；这里合并为幼年。来源没有给出可靠的老年起点。',
  },
  {
    category: 'snake', speciesName: '玉米蛇',
    aliases: ['玉米蛇', 'corn snake', 'pantherophis guttatus'],
    sourceLabel: 'RVC Exotics Service', sourceUrl: 'https://www.rvc.ac.uk/Media/Default/small-animal/documents/Corn-snake-care%20-%20UPDATED.pdf',
    note: '现有来源提供生长和寿命信息，但没有连续、可复用的四阶段年龄边界；各阶段年月待核实。',
  },
  {
    category: 'parrot', speciesName: '虎皮鹦鹉',
    aliases: ['虎皮鹦鹉', 'budgerigar', 'budgie', 'melopsittacus undulatus'],
    note: '现有发育与老龄资料采用不同定义，不能拼成统一的四阶段年月标准；各阶段年月待核实。',
  },
  {
    category: 'parrot', speciesName: '玄凤鹦鹉',
    aliases: ['玄凤鹦鹉', 'cockatiel', 'nymphicus hollandicus'],
    note: '现有发育与老龄资料采用不同定义，不能拼成统一的四阶段年月标准；各阶段年月待核实。',
  },
];

function getLifeStageReference(speciesCode, breed = '', customSpeciesName = '') {
  const normalize = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const identity = normalize(speciesCode === 'other' ? customSpeciesName : breed);
  const reference = REFERENCES.find((item) => (item.category === speciesCode || speciesCode === 'other') && item.aliases.includes(identity));
  const speciesName = speciesCode === 'rat' ? '花枝鼠' : reference ? reference.speciesName
    : speciesCode === 'other' && identity ? String(customSpeciesName).trim() : '具体物种待确认';
  const ranges = reference?.ranges || null;
  const note = reference?.note || (speciesName === '具体物种待确认'
    ? '请在品种或补充说明中填写具体物种。当前分类不能共用一套年龄标准。'
    : speciesCode === 'rat'
      ? '现有资料可确认花枝鼠的性成熟与寿命范围，但不足以划出四个连续阶段。各阶段年月待核实。'
      : `尚未核实“${speciesName}”的具体物种与四阶段年月范围，可先手动选择阶段。`);
  return { speciesName, ageStatus: ranges ? 'reference' : 'pending', ranges, sourceLabel: reference?.sourceLabel || '', sourceUrl: reference?.sourceUrl || '', note };
}

function getLifeStageOptions(reference = {}) {
  return STAGES.map((stage) => ({ ...stage,
    label: stage.value === 'unknown' ? stage.name : `${stage.name}（${reference.ranges?.[stage.value] || '年月待核实'}）`,
  }));
}

const LIFE_STAGE_OPTIONS = getLifeStageOptions();

function lifeStageLabel(value) {
  const stage = STAGES.find((item) => item.value === value);
  return stage ? stage.name : '待确认';
}

module.exports = { LIFE_STAGE_OPTIONS, getLifeStageOptions, getLifeStageReference, lifeStageLabel };
