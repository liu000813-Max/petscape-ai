export const ease = [0.16, 1, 0.3, 1];

export const species = [
  { id: 'rat', name: '花枝鼠', en: 'Fancy Rat', image: '/assets/species-rat.png', traits: ['爱社交', '爱啃咬', '热爱钻洞'], material: 'PETG / 圆角安全处理', habitat: '层板、隧道、觅食房间', modules: ['cheese-lounge-bed', 'banana-bed', 'banana-layer-pad', 'hanging-climb-baskets', 'cheese-play-mat', 'vine-foraging-tray'] },
  { id: 'gecko', name: '守宫', en: 'Gecko', image: '/assets/species-gecko.png', traits: ['夜行', '需要躲避', '喜稳定温湿度'], material: '耐热 PETG / 防潮结构', habitat: '湿躲、岩洞、喂食台、低晒台', modules: ['starry-hideout', 'star-bridge-hide', 'mushroom-climb-tree', 'sunny-climb-station', 'spiral-star-perch'] },
  { id: 'snake', name: '蛇', en: 'Snake', image: '/assets/species-snake.png', traits: ['爱隐蔽', '贴地移动', '需要安全边界'], material: '耐热 PETG / 无尖角缝隙', habitat: '洞穴、贴地通道、稳定水盆、攀爬枝架', modules: ['star-bridge-hide', 'starry-hideout', 'spiral-star-perch', 'cheese-play-mat'] },
  { id: 'parrot', name: '鹦鹉', en: 'Parrot', image: '/assets/species-parrot.png', traits: ['爱攀爬', '爱啃咬', '需要互动'], material: 'PETG / 加厚防啃结构', habitat: '站杆、觅食盒、攀爬平台、玩具挂点', modules: ['hanging-z-ladder', 'sunny-climb-station', 'hanging-climb-baskets', 'vine-foraging-tray'] },
  { id: 'spider', name: '蜘蛛', en: 'Tarantula', image: '/assets/species-spider.png', traits: ['喜躲避', '怕震动', '需要低干扰'], material: '防潮 PETG / 低反光表面', habitat: '洞穴躲避、地形坡度、水盆固定、观察窗口', modules: ['mushroom-climb-tree', 'starry-hideout', 'star-bridge-hide', 'spiral-star-perch'] }
];

export const modules = [
  { id: 'cheese-lounge-bed', title: '奶酪软垫小床', price: '¥89', species: '花枝鼠', material: 'PETG', weight: '180g', image: '/assets/pet-products/cheese-lounge-bed.png', shape: 'cheese', description: '低矮奶酪围栏搭配软垫窝位，适合睡觉、躲藏和拍照展示。' },
  { id: 'banana-bed', title: '香蕉软垫小床', price: '¥89', species: '花枝鼠', material: 'PETG / 软垫', weight: '170g', image: '/assets/pet-products/banana-bed.png', shape: 'hide', description: '香蕉造型开放小床，带软垫和靠背，适合做睡窝和主题拍照位。' },
  { id: 'banana-layer-pad', title: '夹层香蕉垫', price: '¥59', species: '花枝鼠', material: 'PETG / 软垫', weight: '150g', image: '/assets/pet-products/banana-layer-pad.png', shape: 'hide', description: '三层香蕉夹心垫，圆形包裹感更强，适合做温暖睡窝和主题软装。' },
  { id: 'hanging-climb-baskets', title: '悬挂藤篮阶梯', price: '¥59', species: '花枝鼠 / 鹦鹉', material: 'PETG / 藤编纹理', weight: '130g', image: '/assets/pet-products/hanging-climb-baskets.png', shape: 'deck', description: '三层悬挂篮和弹簧梯组合，增加垂直攀爬和短暂停留空间。' },
  { id: 'cheese-play-mat', title: '奶酪洞洞层板', price: '¥59', species: '花枝鼠 / 蛇', material: 'PETG', weight: '140g', image: '/assets/pet-products/cheese-play-mat.png', shape: 'tunnel', description: '扁平奶酪层板带多孔结构，可作为通道顶板或觅食平台。' },
  { id: 'vine-foraging-tray', title: '藤蔓觅食托盘', price: '¥39', species: '花枝鼠 / 鹦鹉', material: 'PETG', weight: '90g', image: '/assets/pet-products/vine-foraging-tray.png', shape: 'plate', description: '枝蔓形盘面适合撒放零食或小玩具，带一点自然风装饰感。' },
  { id: 'cheese-storage-tower', title: '奶酪收纳高柜', price: '¥89', species: '花枝鼠', material: 'PETG', weight: '210g', image: '/assets/pet-products/cheese-storage-tower.png', shape: 'hide', description: '带抽屉和时钟装饰的奶酪小柜，可作为主题场景里的展示件。' },
  { id: 'sunny-climb-station', title: '多巴胺攀爬站', price: '¥59', species: '鹦鹉 / 守宫', material: 'PETG', weight: '160g', image: '/assets/pet-products/sunny-climb-station.png', shape: 'deck', description: '亮黄色多层平台适合跳跃、晒背和站立，风格更活泼。' },
  { id: 'hanging-z-ladder', title: 'Z 字吊桥梯', price: '¥39', species: '鹦鹉 / 小宠', material: 'PETG / 木纹色', weight: '80g', image: '/assets/pet-products/hanging-z-ladder.png', shape: 'deck', description: '轻量吊挂梯连接上下层空间，适合做笼箱里的移动路线。' },
  { id: 'starry-hideout', title: '星月魔法躲屋', price: '¥89', species: '守宫 / 蛇 / 蜘蛛', material: 'PETG', weight: '190g', image: '/assets/pet-products/starry-hideout.png', shape: 'hide', description: '黑色星月主题躲避屋，偏艺术摆件感，适合主题景观。' },
  { id: 'star-bridge-hide', title: '星桥拱门躲屋', price: '¥59', species: '守宫 / 蛇 / 蜘蛛', material: 'PETG', weight: '150g', image: '/assets/pet-products/star-bridge-hide.png', shape: 'hide', description: '镂空拱桥带星星装饰，能做躲避、穿行和拍摄背景。' },
  { id: 'mushroom-climb-tree', title: '蘑菇攀爬树', price: '¥59', species: '守宫 / 蜘蛛', material: 'PETG', weight: '150g', image: '/assets/pet-products/mushroom-climb-tree.png', shape: 'rock', description: '柔和蘑菇群造型，适合雨林或童话主题的攀爬点。' },
  { id: 'spiral-star-perch', title: '星旋攀爬立柱', price: '¥39', species: '鹦鹉 / 守宫 / 蜘蛛', material: 'PETG', weight: '110g', image: '/assets/pet-products/spiral-star-perch.png', shape: 'rock', description: '螺旋星形立柱偏艺术款，可作为场景里的视觉焦点。' }
];

export const wearableItems = [
  { id: 'knit-hat', title: '迷你针织帽', price: '¥39', fit: '花枝鼠 / 鹦鹉' },
  { id: 'chef-scarf', title: '小厨师围巾', price: '¥29', fit: '花枝鼠' },
  { id: 'name-charm', title: '名字小吊牌', price: '¥19', fit: '全物种' },
  { id: 'mini-cape', title: '迷你斗篷', price: '¥49', fit: '花枝鼠 / 毛绒预览' }
];

export const workflowCards = [
  ['物种入口', '浏览', '大众宠物档案卡进入后，展示对应物种的专属白底配件。', '用户先从熟悉的物种进入，再看到真正适合该动物的模块。'],
  ['宠物档案', '创建', '为爱宠命名，选择物种，并调节体型。', '档案会成为生成、预览、计价和复购的核心锚点。'],
  ['3D 形象', '预览', '上传宠物图片，生成可旋转的角色式 3D 预览。', '体验应像游戏角色查看器，而不是静态表单。'],
  ['爱宠装扮', '穿戴', '添加小帽子、围巾、吊牌等付费装饰。', '每个穿戴物都有价格、适配规则和预览中的位置反馈。'],
  ['标品社区', '商店', '纯白底打印模块作为标准 SKU 展示和售卖。', '每个模块都有价格、材料、重量、适配物种和加入场景动作。'],
  ['场景包', '整装', '多个模块组合成完整主题宠物空间。', '前端卖整体效果，后端用标准化可打印部件履约。'],
  ['3D 打印', '生产', '材料、重量、打印时间和后处理共同驱动报价。', '同一套选择可以进入生产订单和发货流程。'],
  ['实物交付', '落地', '从免费效果图到定金、模型确认、打印和发货。', '这是 AI Agent 把数字想象交付到现实的关键链路。']
];

export const flowSteps = ['免费生成图', '选择宠物', '创建形象', '添加装扮', '添加模块', '确认模型', '3D 打印', '发货'];

export const scenePacks = [
  // moduleIds：批次3（F42）追加，按主题语义从 modules（13 模块）里配 3-4 个真实存在的模块 id，
  // 供 ScenePackSection「加入预览」批量并入 selectedIds 用。不改动上面已有的 title/tag/copy/price/image 字段。
  { title: '森林奶酪屋', tag: '花枝鼠首发套装', copy: '洞穴窝、觅食通道、攀爬平台和食盆固定座组成完整环境。', price: '¥399+', image: '/assets/scene-cheese-house.jpg', moduleIds: ['cheese-lounge-bed', 'banana-bed', 'hanging-climb-baskets', 'cheese-play-mat'] },
  { title: '都市基地', tag: '适合分享传播', copy: '工业风模块和可清洗平台，把普通笼箱变成主题空间。', price: '¥459+', image: '/assets/scene-urban-base.jpg', moduleIds: ['sunny-climb-station', 'hanging-z-ladder', 'cheese-storage-tower'] },
  { title: '雨林树屋', tag: '扩展物种方案', copy: '为守宫、蜘蛛和树栖宠物准备的湿润垂直攀爬方案。', price: '¥369+', image: '/assets/scene-rainforest-treehouse.jpg', moduleIds: ['mushroom-climb-tree', 'star-bridge-hide', 'starry-hideout', 'spiral-star-perch'] }
];

export const materialRows = [['PETG', '防潮、耐用、易清洁', '¥0.42 / g'], ['PLA+', '适合干燥装饰件', '¥0.28 / g'], ['后处理', '圆角打磨、清洁涂层、低气味处理', '¥49+']];
