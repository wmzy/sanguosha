// 陆抗(吴·风林火山 hero/414):
//   谦节(锁定技)— 防连环;不能成为延时锦囊牌和拼点的目标
//   决堰(主动技)  — 出牌阶段限一次,废除一个装备栏并于本回合获得对应效果
//   破势(觉醒技)  — 准备阶段,装备栏均被废除或体力值为1时觉醒
export const 陆抗 = {
  name: '陆抗',
  maxHealth: 4,
  gender: '男',
  faction: '吴',
  skills: [
    { name: '谦节', path: '../../skills/谦节' },
    { name: '决堰', path: '../../skills/决堰' },
    { name: '破势', path: '../../skills/破势' },
  ],
};
