const STAGES = [
  { value: 'juvenile', name: '幼年' },
  { value: 'subadult', name: '亚成体' },
  { value: 'adult', name: '成体' },
  { value: 'senior', name: '老年' },
  { value: 'unknown', name: '待确认' },
];

const REFERENCES = [
  {
    category: 'rat', speciesName: '花枝鼠',
    aliases: ['花枝鼠', '宠物大鼠', 'fancy rat', 'rattus norvegicus', 'rattus norvegicus domestica'],
    sourceLabel: 'Molesey Vets · 老年养护参考',
    sourceUrl: 'https://www.partridgepractices.co.uk/molesey-vets/my-pet/rat/',
    ranges: { senior: '超过 1 年 6 个月' },
    note: '该兽医医院以超过 18 个月（1 年 6 个月）作为宠物大鼠的老年养护参考，个体衰老速度不同。此处不是疾病诊断；幼年、亚成体和成体年月仍待核实。',
  },
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
    sourceLabel: 'The Maryland Zoo（2024）', sourceUrl: 'https://www.marylandzoo.org/wp-content/uploads/2024/06/Corn-Snake-Species-Profile_June-2024.pdf',
    note: '动物园资料提供性成熟和寿命信息，但没有定义四阶段年龄边界；性成熟年龄不等于成体阶段标准，各阶段年月待核实。',
  },
  {
    category: 'parrot', speciesName: '虎皮鹦鹉',
    aliases: ['虎皮鹦鹉', 'budgerigar', 'budgie', 'melopsittacus undulatus'],
    sourceLabel: 'AAV 鸟类兽医协会（2022）· 表 1',
    sourceUrl: 'https://cdn.ymaws.com/www.aav.org/resource/collection/AE20E93E-0F61-4C20-AB88-E237BD795B43/AAV-care-for-senior-parrots.pdf',
    ranges: { senior: '超过 6 年' },
    note: 'AAV 将超过 6 年列为老年养护参考；个体衰老受遗传、营养和活动等影响，不代表疾病诊断。来源未定义其他三个阶段的年月，继续待核实。',
  },
  {
    category: 'parrot', speciesName: '玄凤鹦鹉',
    aliases: ['玄凤鹦鹉', 'cockatiel', 'nymphicus hollandicus'],
    sourceLabel: 'AAV 鸟类兽医协会（2022）· 表 1',
    sourceUrl: 'https://cdn.ymaws.com/www.aav.org/resource/collection/AE20E93E-0F61-4C20-AB88-E237BD795B43/AAV-care-for-senior-parrots.pdf',
    ranges: { senior: '超过 12 年' },
    note: 'AAV 将超过 12 年列为老年养护参考；个体衰老受遗传、营养和活动等影响，不代表疾病诊断。来源未定义其他三个阶段的年月，继续待核实。',
  },
  {
    category: 'parrot', speciesName: '桃脸牡丹鹦鹉',
    aliases: ['桃脸牡丹鹦鹉', '桃脸情侶鸚鵡', '桃脸爱情鸟', '桃面情侣鹦鹉', 'rosy-faced lovebird', 'rosy faced lovebird', 'agapornis roseicollis'],
    sourceLabel: 'AAV 鸟类兽医协会（2022）· 表 1',
    sourceUrl: 'https://cdn.ymaws.com/www.aav.org/resource/collection/AE20E93E-0F61-4C20-AB88-E237BD795B43/AAV-care-for-senior-parrots.pdf',
    ranges: { senior: '超过 10 年' },
    note: 'AAV 将超过 10 年列为桃脸牡丹鹦鹉的老年养护参考；该年龄不定义幼年、亚成体或成体边界，也不作为疾病诊断。',
  },
  {
    category: 'parrot', speciesName: '非洲灰鹦鹉',
    aliases: ['非洲灰鹦鹉', 'african grey parrot', 'african grey', 'psittacus erithacus'],
    sourceLabel: 'AAV 鸟类兽医协会（2022）· 表 1',
    sourceUrl: 'https://cdn.ymaws.com/www.aav.org/resource/collection/AE20E93E-0F61-4C20-AB88-E237BD795B43/AAV-care-for-senior-parrots.pdf',
    ranges: { senior: '超过 15 年' },
    note: 'AAV 将超过 15 年列为非洲灰鹦鹉的老年养护参考；该年龄不定义幼年、亚成体或成体边界，也不作为疾病诊断。',
  },
  {
    category: 'parrot', speciesName: '粉红凤头鹦鹉（Galah）',
    aliases: ['粉红凤头鹦鹉', '美冠鹦鹉', 'galah', 'eolophus roseicapilla', 'eolophus roseicapillus'],
    sourceLabel: 'AAV 鸟类兽医协会（2022）· 表 1',
    sourceUrl: 'https://cdn.ymaws.com/www.aav.org/resource/collection/AE20E93E-0F61-4C20-AB88-E237BD795B43/AAV-care-for-senior-parrots.pdf',
    ranges: { senior: '超过 18 年' },
    note: 'AAV 将超过 18 年列为 Galah 的老年养护参考；该年龄不定义幼年、亚成体或成体边界，也不作为疾病诊断。',
  },
  {
    category: 'parrot', speciesName: '白凤头鹦鹉',
    aliases: ['白凤头鹦鹉', '白凤头', 'white cockatoo', 'umbrella cockatoo', 'cacatua alba'],
    sourceLabel: 'AAV 鸟类兽医协会（2022）· 表 1',
    sourceUrl: 'https://cdn.ymaws.com/www.aav.org/resource/collection/AE20E93E-0F61-4C20-AB88-E237BD795B43/AAV-care-for-senior-parrots.pdf',
    ranges: { senior: '超过 20 年' },
    note: 'AAV 将超过 20 年列为白凤头鹦鹉的老年养护参考；该年龄不定义幼年、亚成体或成体边界，也不作为疾病诊断。',
  },
  {
    category: 'parrot', speciesName: '蓝顶亚马逊鹦鹉',
    aliases: ['蓝顶亚马逊鹦鹉', '蓝顶鹦哥', '蓝额亚马逊鹦鹉', '青绿顶亚马逊鹦鹉', 'blue-fronted amazon', 'blue fronted amazon', 'amazona aestiva'],
    sourceLabel: 'AAV 鸟类兽医协会（2022）· 表 1',
    sourceUrl: 'https://cdn.ymaws.com/www.aav.org/resource/collection/AE20E93E-0F61-4C20-AB88-E237BD795B43/AAV-care-for-senior-parrots.pdf',
    ranges: { senior: '超过 25 年' },
    note: 'AAV 将超过 25 年列为蓝顶亚马逊鹦鹉的老年养护参考；该年龄不定义幼年、亚成体或成体边界，也不作为疾病诊断。',
  },
  {
    category: 'parrot', speciesName: '琉璃金刚鹦鹉（蓝黄金刚鹦鹉）',
    aliases: ['琉璃金刚鹦鹉', '蓝黄金刚鹦鹉', '黄蓝金刚鹦鹉', 'blue and gold macaw', 'blue-and-gold macaw', 'blue and yellow macaw', 'ara ararauna'],
    sourceLabel: 'AAV 鸟类兽医协会（2022）· 表 1',
    sourceUrl: 'https://cdn.ymaws.com/www.aav.org/resource/collection/AE20E93E-0F61-4C20-AB88-E237BD795B43/AAV-care-for-senior-parrots.pdf',
    ranges: { senior: '超过 30 年' },
    note: 'AAV 将超过 30 年列为琉璃金刚鹦鹉的老年养护参考；该年龄不定义幼年、亚成体或成体边界，也不作为疾病诊断。',
  },
];

function getLifeStageReference(speciesCode, breed = '', customSpeciesName = '') {
  const normalize = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const identity = normalize(speciesCode === 'other' ? customSpeciesName : breed);
  const reference = REFERENCES.find((item) => (item.category === speciesCode || speciesCode === 'other')
    && (speciesCode === 'rat' || item.aliases.includes(identity)));
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
