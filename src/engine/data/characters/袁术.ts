// 袁术(群·风林火山,OL hero/100):
//   庸肆(锁定技)— 摸牌阶段多摸X张;弃牌阶段开始时弃置X张(X为全场势力数)
//   伪帝(锁定技)— 视为拥有主公的主公技
// 非常备主公(自身无主公技),4 体力上限。
export const 袁术 = {
  name: '袁术',
  maxHealth: 4,
  gender: '男',
  faction: '群',
  skills: [
    { name: '庸肆', path: '../skills/庸肆' },
    { name: '伪帝', path: '../skills/伪帝' },
  ],
};
