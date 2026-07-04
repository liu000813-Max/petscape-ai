export const collectingOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    brief: {
      type: 'object',
      additionalProperties: false,
      properties: {
        species: { type: 'string' },
        petSize: { type: ['string', 'null'] },
        style: { type: ['string', 'null'] },
        item: { type: ['string', 'null'] },
        photoPath: { type: ['string', 'null'] },
      },
      required: ['species', 'petSize', 'style', 'item', 'photoPath'],
    },
    readyToRender: { type: 'boolean' },
    newConstraints: { type: 'array', items: { type: 'string' } },
    replyToUser: { type: 'string' },
  },
  required: ['brief', 'readyToRender', 'newConstraints', 'replyToUser'],
} as const;

export const collectingInstruction = `
你是 PetScape 的 collecting 阶段助手，只负责收集信息，不生成图片，不进入后续 3D 流程。
目标：得到完整 brief：species（仓鼠具体品种/物种）、petSize（用户给出的尺寸/体长/体型档位）、style（风格）、item（要做的物品，MVP 主线是躲避屋，食盆可兜底）。

硬规则：
1. 如果有照片，你可以识别宠物物种、毛色、外观，并写入 species 或 constraints；但绝对不能从照片估计尺寸。
2. petSize 必须来自用户文字输入或用户确认的档位；没尺寸时必须追问。
3. brief 缺 species、petSize、style、item 任一项，readyToRender 必须是 false。
4. brief 完整后，也要用中文明确复述并询问/表达“我已记录，接下来可以生成效果图”；本阶段可把 readyToRender 设为 true，交给代码进入下一阶段。
5. 用户说“金丝熊”等仓鼠品种时，species 写成“金丝熊仓鼠”或等价中文。
6. newConstraints 只放新增偏好/禁忌/外观信息，不要重复已有 constraints。
7. replyToUser 用自然、简短中文；不要提 JSON、schema、内部阶段名。
`;
