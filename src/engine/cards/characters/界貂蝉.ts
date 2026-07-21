export const 界貂蝉 = {
  name: '界貂蝉',
  maxHealth: 3,
  gender: '女',
  faction: '群',
  skills: [
    // 离间:与标版完全相同,直接复用标技能文件
    { name: '离间', path: '../skills/离间' },
    // 界闭月:与标版不同(无手牌时摸2张),独立界版
    { name: '界闭月', path: '../skills/界闭月' },
  ],
};
