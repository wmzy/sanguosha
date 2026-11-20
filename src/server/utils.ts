// server/utils.ts
import { register } from './resourceRegistry';

let playerCounter = 0;

register(
  '玩家计数',
  {
    get value() {
      return playerCounter;
    },
  },
  () => {
    playerCounter = 0;
  },
);

export function generatePlayerId(): string {
  playerCounter++;
  return `player_${playerCounter}_${Date.now()}`;
}

/** base36 字母表(0-9a-z):快照后缀/历史条目 id 共用。 */
const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

/** 随机后缀:从 alphabet 均匀取 length 个字符(缺省 base36)。
 *  next 注入随机源(房间码用种子化 rng;缺省 Math.random)。 */
export function randomSuffix(
  length: number,
  alphabet: string = BASE36,
  next: (maxExclusive: number) => number = (max) => Math.floor(Math.random() * max),
): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += alphabet[next(alphabet.length)];
  }
  return result;
}

/** YYYYMMDDTHHMMSS 本地时间紧凑格式(data/snapshots、data/ai-feedback 命名风格)。 */
export function compactTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}
