// 界刘表(群·界限突破):maxHealth 3,男。
// 自守与标版不同(标版防伤,界版弃牌惩罚),独立界版技能文件。
// 宗室与标版不同(标版仅手牌上限,界版新增防伤改摸牌),独立界版技能文件。
export const 界刘表 = {
  name: '界刘表',
  maxHealth: 3,
  gender: '男',
  faction: '群',
  skills: [
    { name: '界自守', path: '../skills/界自守' },
    { name: '界宗室', path: '../skills/界宗室' },
  ],
};
