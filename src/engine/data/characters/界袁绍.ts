// 界袁绍(群·界限突破,OL hero/450 官方逐字):
//   界乱击(转化技)— 两张同花色手牌当万箭齐发;使用万箭齐发可少选一个目标
//   界血裔(主公技)— 游戏开始获 X 裔标记(X=群势力角色数×2);出牌阶段开始时可移 1 裔摸 1 牌;每裔手牌上限+1
export const 界袁绍 = {
  name: '界袁绍',
  maxHealth: 4,
  gender: '男',
  faction: '群',
  // 界袁绍拥有主公技「界血裔」,是常备主公。标版袁绍无主公技(baseId='袁绍' 不在
  // LORD_CANDIDATES),此处显式声明 isLord 让选将主公候选池与 isLord() 判定正确识别。
  isLord: true,
  skills: [
    { name: '界乱击', path: '../skills/界乱击' },
    { name: '界血裔', path: '../skills/界血裔' },
  ],
};
