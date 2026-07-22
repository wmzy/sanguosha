export const 界董卓 = {
  name: '界董卓',
  maxHealth: 8,
  gender: '男',
  faction: '群',
  skills: [
    // 界酒池:与标版不同(新增"无次数限制"+"酒杀造成伤害后崩坏失效"),独立界版
    { name: '界酒池', path: '../skills/界酒池' },
    // 肉林:与标版完全相同,直接复用标技能文件
    { name: '肉林', path: '../skills/肉林' },
    // 界崩坏:描述同标版,但需读取 turn.vars['崩坏/disabled'](由界酒池写入),独立界版
    { name: '界崩坏', path: '../skills/界崩坏' },
    // 界暴虐:与标版不同(限定1点伤害+获得判定牌),独立界版
    { name: '界暴虐', path: '../skills/界暴虐' },
  ],
};
