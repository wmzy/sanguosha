// 界祝融(蜀·界限突破):巨象+烈刃。
// 巨象、烈刃技能逻辑与原版祝融完全一致(技能描述相同),直接复用原技能文件。
// 详见 docs/research/武将技能/蜀国/界祝融.md。
export const 界祝融 = {
  name: '界祝融',
  maxHealth: 4,
  gender: '女',
  faction: '蜀',
  skills: [
    { name: '巨象', path: '../skills/巨象' },
    { name: '烈刃', path: '../skills/烈刃' },
  ],
};
