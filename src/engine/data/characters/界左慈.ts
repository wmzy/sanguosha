export const 界左慈 = {
  name: '界左慈',
  maxHealth: 3,
  gender: '男',
  faction: '群',
  skills: [
    // 官方技能名为"化身"(非"界化身");标版与界版共用 skillId '化身',
    // 化身.ts 内部按 player.character==='界左慈' 分派界版行为(3张牌/三选一行动)。
    { name: '化身', path: '../skills/化身' },
    { name: '新生', path: '../skills/新生' },
  ],
};
