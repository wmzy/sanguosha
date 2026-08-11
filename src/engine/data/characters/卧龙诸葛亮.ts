// 卧龙诸葛亮与卧龙诸葛为同一武将(hero/37)的两种命名,
// 技能完全相同,复用已有八阵/火计/看破技能文件。
export const 卧龙诸葛亮 = {
  name: '卧龙诸葛亮',
  maxHealth: 3,
  gender: '男',
  faction: '蜀',
  skills: [
    { name: '八阵', path: '../skills/八阵' },
    { name: '火计', path: '../skills/火计' },
    { name: '看破', path: '../skills/看破' },
  ],
};
