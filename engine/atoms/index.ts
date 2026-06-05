import * as damage from './damage';
import * as draw from './draw';
import * as heal from './heal';
import * as discard from './discard';
import * as discardRandom from './discardRandom';
import * as moveCard from './moveCard';
import * as equip from './equip';
import * as varModule from './var';
import * as phase from './phase';
import * as tag from './tag';
import * as pending from './pending';
import * as judge from './judge';
import * as pendingTrick from './pendingTrick';
import * as kill from './kill';
import * as gainCard from './gainCard';
import * as ctxVar from './ctxVar';
import * as turn from './turn';
import * as rearrangeDeck from './rearrangeDeck';
import * as maxHealth from './maxHealth';
import * as skill from './skill';
import * as reshuffle from './reshuffle';
import * as giveCard from './giveCard';
import * as takeCard from './takeCard';
const modules = [
  damage,
  draw,
  heal,
  discard,
  discardRandom,
  moveCard,
  equip,
  varModule,
  phase,
  tag,
  pending,
  judge,
  pendingTrick,
  kill,
  gainCard,
  ctxVar,
  turn,
  rearrangeDeck,
  maxHealth,
  skill,
  reshuffle,
  giveCard,
  takeCard,
];

export function registerAllAtoms(): void {
  for (const m of modules) m.register();
}

// 保持向后兼容：模块加载时即注册（旧的 `@engine/atoms/index` 副作用行为）
registerAllAtoms();
