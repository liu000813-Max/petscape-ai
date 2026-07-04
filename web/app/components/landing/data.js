export const ease = [0.16, 1, 0.3, 1];

export const species = [
  { id: 'rat', name: '花枝鼠', en: 'Fancy Rat', image: '/assets/species-rat.png', traits: ['爱社交', '爱啃咬', '热爱钻洞'], likes: ['隧道', '窝', '层板', '觅食区'], risks: ['尖角', '小零件', '尾巴卡缝', '难清洁沟槽'], material: 'PETG / 圆角安全处理', habitat: '层板、隧道、觅食房间', modules: ['cheese-lounge-bed', 'banana-bed', 'banana-layer-pad', 'hanging-climb-baskets', 'cheese-play-mat', 'vine-foraging-tray'] },
  { id: 'gecko', name: '守宫', en: 'Gecko', image: '/assets/species-gecko.png', traits: ['夜行', '需要躲避', '喜稳定温湿度'], likes: ['湿躲', '岩洞', '低晒台', '稳定温湿度'], risks: ['过热表面', '湿度波动', '尖锐边缘', '躲避不足'], material: '耐热 PETG / 防潮结构', habitat: '湿躲、岩洞、喂食台、低晒台', modules: ['starry-hideout', 'star-bridge-hide', 'mushroom-climb-tree', 'sunny-climb-station', 'spiral-star-perch'] },
  { id: 'snake', name: '蛇', en: 'Snake', image: '/assets/species-snake.png', traits: ['爱隐蔽', '贴地移动', '需要安全边界'], likes: ['洞穴', '贴地通道', '稳定水盆', '安全边界'], risks: ['逃逸缝隙', '尖角', '过窄通道', '水盆倾倒'], material: '耐热 PETG / 无尖角缝隙', habitat: '洞穴、贴地通道、稳定水盆、攀爬枝架', modules: ['star-bridge-hide', 'starry-hideout', 'spiral-star-perch', 'cheese-play-mat'] },
  { id: 'parrot', name: '鹦鹉', en: 'Parrot', image: '/assets/species-parrot.png', traits: ['爱攀爬', '爱啃咬', '需要互动'], likes: ['站杆', '攀爬平台', '觅食盒', '玩具挂点'], risks: ['易碎小件', '尖锐边缘', '卡脚缝隙', '不稳挂点'], material: 'PETG / 加厚防啃结构', habitat: '站杆、觅食盒、攀爬平台、玩具挂点', modules: ['hanging-z-ladder', 'sunny-climb-station', 'hanging-climb-baskets', 'vine-foraging-tray'] },
  { id: 'spider', name: '蜘蛛', en: 'Tarantula', image: '/assets/species-spider.png', traits: ['喜躲避', '怕震动', '需要低干扰'], likes: ['洞穴躲避', '低干扰地形', '固定水盆', '观察窗口'], risks: ['震动', '反光惊扰', '跌落高度', '湿度失衡'], material: '防潮 PETG / 低反光表面', habitat: '洞穴躲避、地形坡度、水盆固定、观察窗口', modules: ['mushroom-climb-tree', 'starry-hideout', 'star-bridge-hide', 'spiral-star-perch'] }
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
  { id: 'spiral-star-perch', title: '星旋攀爬立柱', price: '¥39', species: '鹦鹉 / 守宫 / 蜘蛛', material: 'PETG', weight: '110g', image: '/assets/pet-products/spiral-star-perch.png', shape: 'rock', description: '螺旋星形立柱偏艺术款，可作为场景里的视觉焦点。' },
  { id: 'pink-teapot-large-hideout', title: '大粉茶壶躲屋', price: '¥169+', species: '场景包专属', material: 'PETG / 彩色纹理', weight: '模型确认中', image: '/assets/pet-products/pink-teapot-large-hideout.png', shape: 'hide', scenePackOnly: true, description: '大号粉色茶壶外形躲屋，作为云朵茶壶乐园的低位主视觉模块。' },
  { id: 'pink-teapot-small-hideout', title: '小粉茶壶躲屋', price: '¥129+', species: '场景包专属', material: 'PETG / 彩色纹理', weight: '模型确认中', image: '/assets/pet-products/pink-teapot-small-hideout.png', shape: 'hide', scenePackOnly: true, description: '小号粉色茶壶躲屋，用于左侧中层藏身点，和大茶壶形成比例层次。' },
  { id: 'cloud-moss-teapot-platform', title: '云朵苔藓茶壶托盘', price: '¥139+', species: '场景包专属', material: 'PETG / 苔藓纹理', weight: '模型确认中', image: '/assets/pet-products/cloud-moss-teapot-platform.png', shape: 'deck', scenePackOnly: true, description: '灰白云朵托起苔藓和茶壶，是上层停留与视觉锚点。' },
  { id: 's-cloud-star-ramp', title: 'S 形云朵星星坡道', price: '¥119+', species: '场景包专属', material: 'PETG / 彩色纹理', weight: '模型确认中', image: '/assets/pet-products/s-cloud-star-ramp.png', shape: 'deck', scenePackOnly: true, description: 'S 形云朵坡道带粉色星星装饰，连接中部活动路线。' },
  { id: 'cloud-star-bowl-upper', title: '上层云朵星星吊篮', price: '¥89+', species: '场景包专属', material: 'PETG / 软垫纹理', weight: '模型确认中', image: '/assets/pet-products/cloud-star-bowl-upper.png', shape: 'hide', scenePackOnly: true, description: '上层云朵吊篮，保留较立体的云朵姿态和粉星装饰。' },
  { id: 'cloud-star-bowl-lower', title: '中层云朵星星吊篮', price: '¥89+', species: '场景包专属', material: 'PETG / 软垫纹理', weight: '模型确认中', image: '/assets/pet-products/cloud-star-bowl-lower.png', shape: 'hide', scenePackOnly: true, description: '中层云朵吊篮，姿态更低更扁，和上层吊篮形成错落。' },
  { id: 'wood-dna-moss-ladder', title: '木色 DNA 苔藓梯', price: '¥119+', species: '场景包专属', material: 'PETG / 木纹色', weight: '模型确认中', image: '/assets/pet-products/wood-dna-moss-ladder.png', shape: 'deck', scenePackOnly: true, description: '木色 DNA 梯带苔藓底座，放在右侧作为垂直攀爬路线。' }
];

export const wearableItems = [
  { id: 'knit-hat', title: '迷你针织帽', price: '¥39', fit: '花枝鼠 / 鹦鹉' },
  { id: 'chef-scarf', title: '小厨师围巾', price: '¥29', fit: '花枝鼠' },
  { id: 'name-charm', title: '名字小吊牌', price: '¥19', fit: '全物种' },
  { id: 'mini-cape', title: '迷你斗篷', price: '¥49', fit: '花枝鼠 / 毛绒预览' }
];

export const workflowCards = [
  { title: '物种入口', label: '浏览', image: '/assets/workflow/species-pixel-avatars.svg', front: '大众宠物档案卡进入后，展示对应物种的专属白底配件。', back: '用户先从熟悉的物种进入，再看到真正适合该动物的模块。' },
  { title: '宠物档案', label: '创建', image: '/assets/workflow/pet-profile-card.svg', front: '为爱宠命名，选择物种，并调节体型。', back: '档案会成为生成、预览、计价和复购的核心锚点。' },
  { title: '3D 形象', label: '预览', image: '/assets/workflow/workflow-3d-avatar.png', front: '上传宠物图片，生成可旋转的角色式 3D 预览。', back: '体验应像游戏角色查看器，而不是静态表单。' },
  { title: '爱宠装扮', label: '穿戴', image: '/assets/workflow/workflow-wearables.png', front: '添加小帽子、围巾、吊牌等付费装饰。', back: '每个穿戴物都有价格、适配规则和预览中的位置反馈。' },
  { title: '标品社区', label: '商店', image: '/assets/pet-products/banana-bed.png', front: '纯白底打印模块作为标准 SKU 展示和售卖。', back: '每个模块都有价格、材料、重量、适配物种和加入场景动作。' },
  { title: '场景包', label: '整装', image: '/assets/workflow/workflow-scene-pack.png', front: '多个模块组合成完整主题宠物空间。', back: '前端卖整体效果，后端用标准化可打印部件履约。' },
  { title: '3D 打印', label: '生产', image: '/assets/workflow/workflow-3d-print.png', front: '材料、重量、打印时间和后处理共同驱动报价。', back: '同一套选择可以进入生产订单和发货流程。' },
  { title: '实物交付', label: '落地', image: '/assets/workflow/workflow-delivery.png', front: '从免费效果图到定金、模型确认、打印和发货。', back: '这是 AI Agent 把数字想象交付到现实的关键链路。' }
];

export const flowSteps = ['免费生成图', '选择宠物', '创建形象', '添加装扮', '添加模块', '确认模型', '3D 打印', '发货'];

export const flowStepAssets = {
  免费生成图: '/assets/order-flow/free-render.jpg',
  选择宠物: '/assets/order-flow/choose-pet-profile-stack.svg',
  创建形象: '/assets/order-flow/create-avatar-user.png',
  添加装扮: '/assets/order-flow/add-wearables-user.png',
  添加模块: '/assets/order-flow/add-modules.jpg',
  确认模型: '/assets/order-flow/confirm-model.jpg',
  '3D 打印': '/assets/order-flow/print-3d-user.png',
  发货: '/assets/order-flow/shipping.jpg',
};

export const scenePacks = [
  {
    title: '森林奶酪屋',
    tag: '花枝鼠首发套装',
    copy: '洞穴窝、觅食通道、攀爬平台和食盆固定座组成完整环境。',
    price: '¥399+',
    image: '/assets/scene-cheese-house.png',
    moduleIds: ['cheese-lounge-bed', 'banana-bed', 'hanging-climb-baskets', 'cheese-play-mat'],
    layoutStatus: 'ready',
    layout: [
      { instanceId: 'pack-forest-cheese-lounge-bed', moduleId: 'cheese-lounge-bed', position: { x: -135, y: 0, z: -75 }, rotationY: 0.08, scale: 0.92, collisionSize: { x: 274.148, y: 100, z: 194.543 }, assetKind: 'glb' },
      { instanceId: 'pack-forest-banana-bed', moduleId: 'banana-bed', position: { x: 165, y: 0, z: -115 }, rotationY: -0.45, scale: 0.9, collisionSize: { x: 234.107, y: 100, z: 94.742 }, assetKind: 'glb' },
      { instanceId: 'pack-forest-hanging-climb-baskets', moduleId: 'hanging-climb-baskets', position: { x: 185, y: 0, z: 92 }, rotationY: 0.35, scale: 1, collisionSize: { x: 82.924, y: 120, z: 57.215 }, assetKind: 'glb' },
      { instanceId: 'pack-forest-cheese-play-mat', moduleId: 'cheese-play-mat', position: { x: -150, y: 0, z: 118 }, rotationY: -0.28, scale: 0.95, collisionSize: { x: 162.435, y: 60, z: 162.434 }, assetKind: 'glb' },
    ],
  },
	  {
	    title: '云朵茶壶乐园',
	    tag: '彩色 3D 场景包',
	    copy: '两个粉色茶壶、苔藓云朵托盘、S 形星星坡道、上下云朵吊篮和木色 DNA 梯组成完整乐园。',
	    price: '¥853+',
	    image: '/assets/scene-pink-teapot-pack.png',
	    moduleIds: ['pink-teapot-large-hideout', 'pink-teapot-small-hideout', 'cloud-moss-teapot-platform', 's-cloud-star-ramp', 'cloud-star-bowl-upper', 'cloud-star-bowl-lower', 'wood-dna-moss-ladder'],
	    layoutStatus: 'ready',
	    layout: [
	      { instanceId: 'pack-cloud-teapot-large', moduleId: 'pink-teapot-large-hideout', position: { x: -205, y: 0, z: -66 }, rotationX: 0.02, rotationY: -0.28, rotationZ: -0.04, scale: 1, collisionSize: { x: 170, y: 170, z: 145 }, assetKind: 'glb' },
	      { instanceId: 'pack-cloud-teapot-small', moduleId: 'pink-teapot-small-hideout', position: { x: -164, y: 132, z: 102 }, rotationX: -0.05, rotationY: -0.42, rotationZ: 0.03, scale: 1, collisionSize: { x: 116, y: 118, z: 98 }, assetKind: 'glb' },
	      { instanceId: 'pack-cloud-moss-teapot-platform', moduleId: 'cloud-moss-teapot-platform', position: { x: -38, y: 246, z: -126 }, rotationX: -0.06, rotationY: 0.12, rotationZ: -0.04, scale: 1, collisionSize: { x: 178, y: 86, z: 102 }, assetKind: 'glb' },
	      { instanceId: 'pack-s-cloud-star-ramp', moduleId: 's-cloud-star-ramp', position: { x: 54, y: 0, z: 38 }, rotationX: 0.03, rotationY: 0.44, rotationZ: 0.08, scale: 1, collisionSize: { x: 178, y: 156, z: 122 }, assetKind: 'glb' },
	      { instanceId: 'pack-cloud-star-bowl-upper', moduleId: 'cloud-star-bowl-upper', position: { x: 136, y: 234, z: -106 }, rotationX: -0.08, rotationY: -0.3, rotationZ: 0.08, scale: 1, collisionSize: { x: 132, y: 84, z: 96 }, assetKind: 'glb' },
	      { instanceId: 'pack-cloud-star-bowl-lower', moduleId: 'cloud-star-bowl-lower', position: { x: 168, y: 128, z: 114 }, rotationX: -0.05, rotationY: 0.26, rotationZ: -0.05, scale: 1, collisionSize: { x: 146, y: 72, z: 96 }, assetKind: 'glb' },
	      { instanceId: 'pack-wood-dna-moss-ladder', moduleId: 'wood-dna-moss-ladder', position: { x: 260, y: 0, z: -10 }, rotationX: -0.02, rotationY: -0.18, rotationZ: 0.05, scale: 1, collisionSize: { x: 80, y: 220, z: 86 }, assetKind: 'glb' },
	    ],
	  },
  { title: '都市基地', tag: '适合分享传播', copy: '工业风模块和可清洗平台，把普通笼箱变成主题空间。', price: '¥459+', image: '/assets/scene-urban-base.png', moduleIds: ['sunny-climb-station', 'hanging-z-ladder', 'cheese-storage-tower'], layoutStatus: 'in-development' },
  { title: '雨林树屋', tag: '扩展物种方案', copy: '为守宫、蜘蛛和树栖宠物准备的湿润垂直攀爬方案。', price: '¥369+', image: '/assets/scene-rainforest-treehouse.png', moduleIds: ['mushroom-climb-tree', 'star-bridge-hide', 'starry-hideout', 'spiral-star-perch'], layoutStatus: 'in-development' }
];

export const materialRows = [['PETG', '防潮、耐用、易清洁', '¥0.42 / g'], ['PLA+', '适合干燥装饰件', '¥0.28 / g'], ['后处理', '圆角打磨、清洁涂层、低气味处理', '¥49+']];

export const safetyMaterials = [
  { name: 'PETG', level: '推荐主材', safety: '高', durability: '中', heat: '中', pets: '猫、兔子、豚鼠', scene: '初期主材料 / 常接触模块' },
  { name: 'TPU', level: '柔性保护', safety: '高', durability: '高', heat: '中', pets: '狗、猫', scene: '软垫、边缘保护、缓冲件' },
  { name: '尼龙 PA', level: '高强结构', safety: '高', durability: '高', heat: '高', pets: '中大型犬', scene: '承重结构、高强度连接件' },
  { name: 'PLA', level: '原型验证', safety: '较高', durability: '低', heat: '低', pets: '猫、小型犬、仓鼠', scene: '原型验证 / 轻度使用' },
  { name: 'ABS', level: '谨慎使用', safety: '一般', durability: '高', heat: '高', pets: '不建议直接接触', scene: '有气味，不适合宠物主体' },
  { name: '树脂', level: '不推荐', safety: '低', durability: '低', heat: '低', pets: '不建议', scene: '固化不充分可能有风险' }
];
