// card-effects/index.ts — 统一入口，eager import 所有 CardEffect 注册文件。
//
// 与 atoms/index.ts 同模式：import 副作用触发 registerCardEffect。
// 此文件被 skills/index.ts eager import（游戏启动时技能加载即注册所有卡牌效果）。

import './杀';
import './桃';
import './酒';
import './无中生有';
import './决斗';
import './顺手牵羊';
import './过河拆桥';
