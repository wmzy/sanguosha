import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ArenaManifest } from '../../../arena/types';
import type { Card, GameView } from '../../../engine/types';
import { getCharacterImage } from '../../assets/imageAssets';
import { getCharacterMeta, LORD_SKILLS } from '../../../engine/data/character-meta';
import { allCharacters } from '../../../engine/data/characters';
import { PHASE_LABELS } from '../gameViewConstants';
import { CardFace } from '../CardFace';
import { CardBack } from '../CardBack';
import { resourceManager } from '../../resources';
import { TargetPointerSvg } from './TargetPointerSvg';
import { SlashBladeVfx } from './SlashBladeVfx';
import { SkillToast } from './SkillToast';
import { FlyingCardLayer } from './FlyingCardLayer';
import { IronChainOverlay, isPlayerChained } from './IronChainOverlay';
import { GrandSkillBanner, type GrandSkillItem } from './GrandSkillBanner';

type Player = GameView['players'][number];

export const arenaPositions: Record<number, number[][]> = {
  2: [
    [50, 82],
    [50, 17],
  ],
  3: [
    [50, 82],
    [24, 17],
    [76, 17],
  ],
  4: [
    [50, 82],
    [14, 48],
    [50, 17],
    [86, 48],
  ],
  5: [
    [50, 82],
    [14, 48],
    [29, 17],
    [71, 17],
    [86, 48],
  ],
  6: [
    [32, 82],
    [14, 48],
    [29, 17],
    [71, 17],
    [86, 48],
    [68, 82],
  ],
  7: [
    [32, 82],
    [13, 48],
    [21, 17],
    [50, 17],
    [79, 17],
    [87, 48],
    [68, 82],
  ],
  8: [
    [50, 82],
    [21, 82],
    [13, 48],
    [21, 17],
    [50, 17],
    [79, 17],
    [87, 48],
    [79, 82],
  ],
};

const positions = arenaPositions;

// 按全部武将的公开技能过滤系统技能，同时保留觉醒、化身等动态获得的技能。
export const characterSkills = new Set(
  allCharacters.flatMap((character) => character.skills.map((skill) => skill.name)),
);

function visibleSkills(player: Player) {
  return player.skills.filter(
    (skill) =>
      characterSkills.has(skill) && (player.identity === '主公' || !LORD_SKILLS.has(skill)),
  );
}

function identityOf(player: Player) {
  return player.identity === '主公' || !player.alive ? (player.identity ?? '暗') : '暗';
}

function detectSkillName(text: string): string | null {
  if (!text) return null;
  if (characterSkills.has(text)) return text;
  const bracketMatch = /【([^】]+)】/.exec(text);
  if (bracketMatch) {
    const name = bracketMatch[1];
    if (
      characterSkills.has(name) ||
      name.startsWith('界') ||
      name.startsWith('神') ||
      name.startsWith('谋')
    ) {
      return name;
    }
  }
  const parenMatch = /〔([^〕]+)〕/.exec(text);
  if (parenMatch && characterSkills.has(parenMatch[1])) {
    return parenMatch[1];
  }
  for (const skill of characterSkills) {
    if (
      text === skill ||
      text === `发动【${skill}】` ||
      text === `使用【${skill}】` ||
      text.startsWith(`发动【${skill}】`) ||
      text.startsWith(skill)
    ) {
      return skill;
    }
  }
  return null;
}

export const EQUIP_NAMES = [
  '八卦阵', '仁王盾', '藤甲', '白银狮子',
  '诸葛连弩', '青釭剑', '青龙偃月刀', '丈八蛇矛',
  '贯石斧', '雌雄双股剑', '寒冰剑', '麒麟弓',
  '朱雀羽扇', '古锭刀', '方天画戟',
  '绝影', '的卢', '爪黄飞电', '骅骝',
  '赤兔', '大宛', '紫骍',
];

export const EQUIP_SLOT_MAP: Record<string, '武器' | '防具' | '防御马' | '进攻马'> = {
  八卦阵: '防具',
  仁王盾: '防具',
  藤甲: '防具',
  白银狮子: '防具',
  诸葛连弩: '武器',
  青釭剑: '武器',
  青龙偃月刀: '武器',
  丈八蛇矛: '武器',
  贯石斧: '武器',
  雌雄双股剑: '武器',
  寒冰剑: '武器',
  麒麟弓: '武器',
  朱雀羽扇: '武器',
  古锭刀: '武器',
  方天画戟: '武器',
  绝影: '防御马',
  的卢: '防御马',
  爪黄飞电: '防御马',
  骅骝: '防御马',
  赤兔: '进攻马',
  大宛: '进攻马',
  紫骍: '进攻马',
};

export function formatEquipBadge(equipName: string, text: string): string {
  if (text.includes(`【${equipName}】判定生效`)) return `【${equipName}】判定生效`;
  if (text.includes(`【${equipName}】追杀`)) return `【${equipName}】追杀`;
  if (text.includes(`【${equipName}】追击`)) return `【${equipName}】追击`;
  if (text.includes(`【${equipName}】挡黑杀`)) return `【${equipName}】挡黑杀`;
  if (text.includes(`【${equipName}】免普伤`)) return `【${equipName}】免普伤`;
  if (text.includes(`【${equipName}】免除伤害`)) return `【${equipName}】免除伤害`;
  if (text.includes(`【${equipName}】回血`)) return `【${equipName}】回血`;
  if (text.includes(`【${equipName}】两张当杀`)) return `【${equipName}】两张当杀`;

  if (equipName === '八卦阵') {
    return '【八卦阵】判定生效';
  }
  if (equipName === '青龙偃月刀') {
    return text.includes('追杀') ? '【青龙偃月刀】追杀' : '【青龙偃月刀】追击';
  }
  if (equipName === '藤甲') {
    return text.includes('火') || text.includes('+1')
      ? '【藤甲】火焰增伤'
      : text.includes('免普伤')
        ? '【藤甲】免普伤'
        : '【藤甲】免除伤害';
  }
  if (equipName === '仁王盾') {
    return '【仁王盾】挡黑杀';
  }
  if (equipName === '丈八蛇矛') {
    return '【丈八蛇矛】两张当杀';
  }
  if (equipName === '白银狮子') {
    return text.includes('回') || text.includes('体力') ? '【白银狮子】回血' : '【白银狮子】减伤';
  }
  if (equipName === '诸葛连弩') {
    return '【诸葛连弩】连续出杀';
  }
  if (equipName === '贯石斧') {
    return '【贯石斧】强命中';
  }
  if (equipName === '寒冰剑') {
    return '【寒冰剑】防止伤害';
  }
  if (equipName === '青釭剑') {
    return '【青釭剑】无视防具';
  }
  return `【${equipName}】生效`;
}

export function detectEquipTrigger(
  logText: string,
  view: GameView,
  logPlayer: number,
): { playerIndex: number; slot: string; badge: string; equipName: string } | null {
  if (!logText) return null;

  let matchedEquip: string | null = null;
  for (const name of EQUIP_NAMES) {
    if (logText.includes(`【${name}】`) || logText.includes(name)) {
      matchedEquip = name;
      break;
    }
  }

  if (!matchedEquip) return null;

  const defaultSlot = EQUIP_SLOT_MAP[matchedEquip] ?? '防具';
  const badge = formatEquipBadge(matchedEquip, logText);

  // 1. Check if logPlayer owns this equipment
  if (logPlayer >= 0 && logPlayer < view.players.length) {
    const p = view.players[logPlayer];
    const equipId = p.equipment?.[defaultSlot];
    const card = equipId ? view.cardMap[equipId] : null;
    if (card?.name === matchedEquip || equipId === matchedEquip) {
      return { playerIndex: logPlayer, slot: defaultSlot, badge, equipName: matchedEquip };
    }
  }

  // 2. Search if another player currently has it equipped
  const owner = view.players.find((p) => {
    const eqId = p.equipment?.[defaultSlot];
    if (!eqId) return false;
    const card = view.cardMap[eqId];
    return card?.name === matchedEquip || eqId === matchedEquip;
  });

  if (owner) {
    return { playerIndex: owner.index, slot: defaultSlot, badge, equipName: matchedEquip };
  }

  // 3. Fallback: if logPlayer is valid, attribute to logPlayer
  if (logPlayer >= 0 && logPlayer < view.players.length) {
    return { playerIndex: logPlayer, slot: defaultSlot, badge, equipName: matchedEquip };
  }

  return null;
}

function extractTargeting(view: GameView): { source: number | null; targets: number[] } {
  // 判定阶段属于延时锦囊自身的结算，不绘制跨座次的攻击指向
  if (view.phase === '判定') {
    return { source: null, targets: [] };
  }

  // 1. 优先读取结算栈中的目标定义
  if (view.settlementStack?.length) {
    for (let i = view.settlementStack.length - 1; i >= 0; i--) {
      const frame = view.settlementStack[i];
      if (!frame) continue;
      // 排除延时锦囊在非出牌期的结算
      if (['乐不思蜀', '兵粮寸断', '闪电'].includes(frame.skillId) && view.phase !== '出牌') {
        continue;
      }
      const from = frame.from;
      // 阵亡玩家不能作为指向源
      if (typeof from === 'number' && (!view.players[from] || !view.players[from].alive)) {
        continue;
      }
      const rawTargets =
        frame.params?.resolvedTargets ??
        frame.params?.targets ??
        (typeof frame.params?.target === 'number' ? [frame.params.target] : undefined);
      if (Array.isArray(rawTargets) && rawTargets.length > 0 && typeof from === 'number') {
        // 目标必须是存活玩家
        const valid = rawTargets.filter(
          (t): t is number =>
            typeof t === 'number' && t >= 0 && t < view.players.length && Boolean(view.players[t]?.alive),
        );
        if (valid.length > 0) return { source: from, targets: valid };
      }
    }
  }

  // 2. 读取 pending atom 中的等待与指向关系
  if (view.pending?.atom) {
    const atom = view.pending.atom as Record<string, unknown>;
    const target = view.pending.target;
    const source =
      typeof atom.source === 'number'
        ? atom.source
        : typeof atom.player === 'number'
          ? atom.player
          : null;
    if (typeof source === 'number' && view.players[source]?.alive) {
      const rawTargets =
        (Array.isArray(atom.targets) ? (atom.targets as number[]) : null) ??
        (typeof target === 'number' ? [target] : []);
      const valid = rawTargets.filter(
        (t): t is number =>
          typeof t === 'number' && t >= 0 && t < view.players.length && Boolean(view.players[t]?.alive),
      );
      if (valid.length > 0) {
        return { source, targets: valid };
      }
    }
  }

  // 3. 从最近出牌日志提取指向目标
  if (view.zones?.processing && view.zones.processing.length > 0 && view.log?.length > 0) {
    const lastLog = view.log.at(-1);
    if (
      lastLog &&
      typeof lastLog.player === 'number' &&
      view.players[lastLog.player]?.alive &&
      (lastLog.text.includes(' → ') ||
        lastLog.text.includes('目标为') ||
        lastLog.text.includes('指定了'))
    ) {
      const targetPart = lastLog.text.includes(' → ')
        ? lastLog.text.split(' → ')[1]
        : lastLog.text.includes('目标为')
          ? lastLog.text.split('目标为')[1]
          : lastLog.text.split('指定了')[1];
      const targetNames = targetPart
        ? targetPart
            .split(/[、,，\s]+/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const targets: number[] = [];
      for (const name of targetNames) {
        const found = view.players.find(
          (p) => (p.name === name || `P${p.index}` === name || p.character === name) && p.alive,
        );
        if (found && !targets.includes(found.index)) {
          targets.push(found.index);
        }
      }
      if (targets.length > 0) {
        return { source: lastLog.player, targets };
      }
    }
  }

  return { source: null, targets: [] };
}

function CardTile({
  card,
  large = false,
  onInspect,
}: {
  card: Card;
  large?: boolean;
  onInspect?: () => void;
}) {
  return (
    <button
      type="button"
      className={`arena-card ${large ? 'arena-card-large' : ''}`}
      data-arena-card={card.id}
      title={`${card.name} ${card.suit}${card.rank}`}
      aria-label={`${card.name} ${card.suit}${card.rank}`}
      onClick={onInspect}
    >
      <CardFace
        name={card.name}
        suit={card.suit}
        rank={card.rank}
        damageType={card.damageType}
        size={large ? 'normal' : 'small'}
      />
    </button>
  );
}

function Seat({
  player,
  view,
  position,
  active,
  isTargetingSource,
  isTargetLocked,
  hasSlashHit,
  skillToast,
  triggeredEquips,
  onInspect,
}: {
  player: Player;
  view: GameView;
  position: number[];
  active: boolean;
  isTargetingSource: boolean;
  isTargetLocked: boolean;
  hasSlashHit: boolean;
  skillToast?: { skillName: string; characterName: string };
  triggeredEquips?: Map<string, string>;
  onInspect: () => void;
}) {
  const portrait = getCharacterImage(player.character);
  const faction = player.faction ?? getCharacterMeta(player.character)?.faction ?? '群';
  const hand = player.hand ?? [];
  const identity = identityOf(player);
  const isChained = Boolean(player.alive && isPlayerChained(player));
  const equipment = Object.entries(player.equipment).filter((entry): entry is [string, string] =>
    Boolean(entry[1]),
  );

  return (
    <article
      className={`arena-seat ${!player.alive ? 'is-dead' : ''} ${active && player.alive ? 'is-active' : ''} ${isTargetingSource && player.alive ? 'is-targeting-source' : ''} ${isTargetLocked && player.alive ? 'is-target-locked seat-target-pulse' : ''} ${isChained && player.alive ? 'is-seat-chained' : ''}`}
      style={{ left: `${position[0]}%`, top: `${position[1]}%` }}
      data-testid={`arena-player-${player.index}`}
    >
      {skillToast && (
        <SkillToast
          skillName={skillToast.skillName}
          characterName={skillToast.characterName}
        />
      )}
      <div className="arena-seat-topline">
        <span>
          〔{player.index + 1}〕{player.name}
        </span>
        <span>
          {active && player.alive
            ? (PHASE_LABELS[view.phase] ?? view.phase)
            : !player.alive
              ? '已阵亡'
              : '候战'}
        </span>
      </div>
      <div className="arena-seat-body">
        <button
          className={`arena-portrait faction-${faction} ${hasSlashHit ? 'is-hit' : ''} ${isChained ? 'is-chained' : ''}`}
          onClick={onInspect}
          aria-label={`查看${player.character}的手牌与状态`}
        >
          {portrait && (
            <img
              src={portrait}
              alt={player.character}
              onError={(event) => {
                event.currentTarget.style.visibility = 'hidden';
              }}
            />
          )}
          {hasSlashHit && <SlashBladeVfx />}
          <IronChainOverlay chained={isChained} />
          <span className="arena-faction">{faction}</span>
          <strong className="arena-general-name">{player.character || '未亮将'}</strong>
          <span
            className={`arena-identity identity-${identity}`}
            data-testid={`arena-identity-${player.index}`}
          >
            {identity}
          </span>
          {!player.alive && <span className="arena-dead-seal">阵亡</span>}
        </button>
        <div className="arena-seat-info">
          <div
            className="arena-hp"
            data-testid={`arena-health-${player.index}`}
            aria-label={`体力 ${player.health} / ${player.maxHealth}`}
          >
            <span>
              {Array.from({ length: Math.min(player.maxHealth, 10) }, (_, i) => (
                <i key={i} className={i < player.health ? 'filled' : ''} />
              ))}
            </span>
            <b>
              {player.health}
              <small>/{player.maxHealth}</small>
            </b>
          </div>
          <div className="arena-skills">
            {visibleSkills(player).map((skill) => (
              <span key={skill}>{skill}</span>
            ))}
          </div>
          <div className="arena-equip" data-testid={`arena-equip-${player.index}`}>
            {equipment.length ? (
              equipment.map(([slot, id]) => {
                const card = view.cardMap[id];
                const cardName = card?.name ?? id;
                const triggeredBadge = triggeredEquips?.get(slot);
                const isEquipTriggered = Boolean(triggeredBadge);
                return (
                  <div
                    key={slot}
                    className={`arena-equip-slot ${isEquipTriggered ? 'is-equip-triggered' : ''}`}
                    data-slot={slot}
                    data-testid={`arena-equip-slot-${slot}`}
                    title={`${slot}: ${cardName} ${card ? `${card.suit ?? ''}${card.rank ?? ''}` : ''}`}
                    onClick={onInspect}
                  >
                    {isEquipTriggered && (
                      <div
                        className="arena-equip-bubble"
                        data-testid="arena-equip-bubble"
                        data-slot={slot}
                      >
                        {triggeredBadge}
                      </div>
                    )}
                    <span className="arena-equip-tag">
                      {slot === '进攻马' ? '−1' : slot === '防御马' ? '+1' : slot.slice(0, 1)}
                    </span>
                    <div
                      className={`arena-equip-card ${isEquipTriggered ? 'is-equip-triggered' : ''}`}
                      data-testid={`arena-equip-card-${id}`}
                      aria-label={`${slot} ${cardName}`}
                    >
                      <CardFace
                        name={cardName}
                        suit={card?.suit}
                        rank={card?.rank}
                        damageType={card?.damageType}
                        size="small"
                      />
                    </div>
                    <span className="arena-equip-name">{cardName}</span>
                  </div>
                );
              })
            ) : (
              <span className="arena-empty-equip">装备未置</span>
            )}
          </div>
          <div className="arena-judges">
            {(player.pendingTricks ?? []).map((id) => (
              <span key={id}>判 · {view.cardMap[id]?.name ?? '延时锦囊'}</span>
            ))}
            {player.marks.map((mark) => (
              <span key={mark.id}>{mark.id}</span>
            ))}
          </div>
        </div>
      </div>
      <div className="arena-hand-label">
        <span>
          手牌 <b>{hand.length}</b>
        </span>
        <button onClick={onInspect}>展开 ↗</button>
      </div>
      <div
        className="arena-hand"
        data-testid={`arena-hand-${player.index}`}
        style={{ '--hand-count': Math.max(hand.length, 1) } as CSSProperties}
      >
        {hand.map((card) => (
          <CardTile key={card.id} card={card} onInspect={onInspect} />
        ))}
        {!hand.length && <span className="arena-no-hand">无手牌</span>}
      </div>
    </article>
  );
}

export function ArenaTable({
  view,
  manifest,
  assetsReady,
}: {
  view: GameView;
  manifest: ArenaManifest;
  assetsReady: boolean;
}) {
  const [inspectIndex, setInspectIndex] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inspected = view.players.find((player) => player.index === inspectIndex);

  // 安全调用 HTMLDialogElement 方法以兼容各种测试与运行环境
  useEffect(() => {
    if (inspectIndex !== null) {
      if (typeof dialogRef.current?.showModal === 'function') {
        dialogRef.current.showModal();
      }
    } else {
      if (typeof dialogRef.current?.close === 'function') {
        dialogRef.current.close();
      }
    }
  }, [inspectIndex]);

  // 1. 受击刀光动效状态管理
  const [slashHits, setSlashHits] = useState<Set<number>>(new Set());
  const prevHealthRef = useRef<Map<number, number>>(
    new Map(view.players.map((p) => [p.index, p.health])),
  );

  useEffect(() => {
    const damaged: number[] = [];
    for (const p of view.players) {
      const prev = prevHealthRef.current.get(p.index);
      if (prev !== undefined && p.health < prev) {
        damaged.push(p.index);
      }
      prevHealthRef.current.set(p.index, p.health);
    }

    if (damaged.length > 0) {
      setSlashHits((prev) => new Set([...prev, ...damaged]));
      const timer = window.setTimeout(() => {
        setSlashHits((prev) => {
          const next = new Set(prev);
          for (const idx of damaged) next.delete(idx);
          return next;
        });
      }, 850);
      return () => window.clearTimeout(timer);
    }
  }, [view.players]);

  // 3. 技能发动统一横幅状态管理 (SkillToast + GrandSkillBanner)
  const [skillToasts, setSkillToasts] = useState<
    Map<number, { skillName: string; characterName: string }>
  >(new Map());
  const [grandSkillQueue, setGrandSkillQueue] = useState<GrandSkillItem[]>([]);

  // 5. 装备牌触发流光提示状态管理 (Equip Trigger Feedback)
  const [triggeredEquips, setTriggeredEquips] = useState<
    Map<string, { badge: string; slot: string; playerIndex: number }>
  >(new Map());

  const prevLogLenRef = useRef<number>(view.log?.length ?? 0);

  useEffect(() => {
    const currentLogs = view.log ?? [];
    const prevLen = prevLogLenRef.current;
    prevLogLenRef.current = currentLogs.length;

    if (currentLogs.length > prevLen) {
      const newEntries = currentLogs.slice(prevLen);
      const newToasts = new Map<number, { skillName: string; characterName: string }>();
      const newGrandSkills: GrandSkillItem[] = [];
      const newEquipTriggers = new Map<string, { badge: string; slot: string; playerIndex: number }>();

      for (const entry of newEntries) {
        // 1. 装备牌触发检测
        const equipTrigger = detectEquipTrigger(entry.text, view, entry.player);
        if (equipTrigger) {
          const key = `${equipTrigger.playerIndex}-${equipTrigger.slot}`;
          newEquipTriggers.set(key, equipTrigger);
        }

        // 2. 武将技能发动检测
        const skillName = detectSkillName(entry.text);
        if (skillName && entry.player >= 0 && entry.player < view.players.length) {
          const p = view.players[entry.player];
          const charName =
            p?.character || p?.name || '武将';
          const faction = p?.faction ?? getCharacterMeta(p?.character)?.faction ?? '群';
          newToasts.set(entry.player, { skillName, characterName: charName });
          newGrandSkills.push({
            id: `grand-skill-${Date.now()}-${Math.random()}`,
            skillName,
            characterName: charName,
            faction,
          });
        }
      }

      if (newToasts.size > 0) {
        setSkillToasts((prev) => {
          const next = new Map(prev);
          for (const [pIdx, info] of newToasts.entries()) {
            next.set(pIdx, info);
          }
          return next;
        });

        window.setTimeout(() => {
          setSkillToasts((prev) => {
            const next = new Map(prev);
            for (const pIdx of newToasts.keys()) {
              next.delete(pIdx);
            }
            return next;
          });
        }, 1500);
      }

      if (newGrandSkills.length > 0) {
        setGrandSkillQueue((prev) => [...prev, ...newGrandSkills]);
      }

      if (newEquipTriggers.size > 0) {
        setTriggeredEquips((prev) => {
          const next = new Map(prev);
          for (const [k, v] of newEquipTriggers.entries()) {
            next.set(k, v);
          }
          return next;
        });

        window.setTimeout(() => {
          setTriggeredEquips((prev) => {
            const next = new Map(prev);
            for (const k of newEquipTriggers.keys()) {
              next.delete(k);
            }
            return next;
          });
        }, 1500);
      }
    }
  }, [view.log, view.players]);

  // 4. 计算当前目标指向关系
  const targeting = extractTargeting(view);
  const targetingSourcePos =
    targeting.source !== null
      ? (positions[view.players.length]?.[targeting.source] ?? [50, 50])
      : null;
  const targetingTargetPositions = targeting.targets
    .map((t) => positions[view.players.length]?.[t])
    .filter((p): p is number[] => Boolean(p)) as [number, number][];

  const isChainTargeting =
    view.settlementStack?.some(
      (f) =>
        f.skillId === '铁索连环' ||
        view.cardMap[f.params?.cardId as string]?.name === '铁索连环',
    ) ||
    view.zones?.processing?.some((id) => view.cardMap[id]?.name === '铁索连环') ||
    Boolean(view.log?.at(-1)?.text.includes('铁索连环'));

  const processing = (view.zones?.processing ?? []).map((id) => view.cardMap[id]).filter(Boolean);
  const current = view.players.find((player) => player.index === view.currentPlayerIndex);
  const done = manifest.status === 'completed';
  const winner = manifest.winner;
  const resultLabel =
    winner === '无人'
      ? '平局'
      : winner && /^\d+$/.test(winner)
        ? `${view.players.find((player) => player.index === Number(winner))?.character ?? `${Number(winner) + 1}号位`}获胜`
        : winner
          ? `${winner}胜利`
          : '对局结束';
  const backdrop = resourceManager.get('table/background');

  return (
    <section
      className="arena-table"
      data-testid="arena-board"
      data-assets-ready={assetsReady}
      style={{ '--arena-backdrop': backdrop ? `url("${backdrop}")` : 'none' } as CSSProperties}
    >
      <div className="arena-table-rim" aria-hidden="true" />
      <div className="arena-table-watermark" aria-hidden="true">
        三国杀<small>群雄逐鹿 · 各显神通</small>
      </div>

      {/* 战术虚线指向连线 */}
      {targetingSourcePos && targetingTargetPositions.length > 0 && (
        <TargetPointerSvg
          sourcePos={targetingSourcePos as [number, number]}
          targetPositions={targetingTargetPositions}
          variant={isChainTargeting ? 'chain' : 'default'}
        />
      )}

      {/* 全息飞牌动效系统（摸牌、出牌、响应、顺拆与弃牌） */}
      <FlyingCardLayer view={view} positions={positions} />

      {/* 电影级水墨黑金技能大特写横幅 (Task 3) */}
      <GrandSkillBanner
        queue={grandSkillQueue}
        onDismiss={(finished) => {
          setGrandSkillQueue((prev) => prev.filter((item) => item.id !== finished.id));
        }}
      />

      <div className="arena-round">
        <span>身份场</span>
        <b>第 {view.turn.round} 轮</b>
        <small>
          {view.players.filter((player) => player.alive).length} / {view.players.length} 人存活
        </small>
      </div>
      <div className="arena-center">
        <div className="arena-turn-banner">
          <span>
            {done
              ? '胜负已分'
              : manifest.status === 'interrupted'
                ? '对局中断'
                : (current?.character ?? '静候开局')}
          </span>
          <strong>{done ? resultLabel : (PHASE_LABELS[view.phase] ?? view.phase)}</strong>
        </div>
        <div className="arena-center-cards" data-testid="arena-processing">
          {processing.length ? (
            processing.map((card) => <CardTile key={card.id} card={card} large />)
          ) : (
            <span className="arena-center-empty">{done ? '本局已归档' : '等待出牌'}</span>
          )}
        </div>
        <div className="arena-piles">
          <div className="arena-deck">
            <CardBack />
          </div>
          <span>
            牌堆 <b>{view.zones?.deckCount ?? 0}</b>
          </span>
          <i />
          <span>
            弃牌 <b>{view.zones?.discardPileCount ?? 0}</b>
          </span>
        </div>
        {view.log?.at(-1) && <p className="arena-last-event">{view.log.at(-1)?.text}</p>}
      </div>
      {view.players.map((player, i) => {
        const playerEquipTriggers = new Map<string, string>();
        for (const [, val] of triggeredEquips.entries()) {
          if (val.playerIndex === player.index) {
            playerEquipTriggers.set(val.slot, val.badge);
          }
        }
        return (
          <Seat
            key={player.index}
            player={player}
            view={view}
            position={positions[view.players.length]?.[i] ?? [50, 50]}
            active={player.index === view.currentPlayerIndex && !done}
            isTargetingSource={targeting.source === player.index}
            isTargetLocked={targeting.targets.includes(player.index)}
            hasSlashHit={slashHits.has(player.index)}
            skillToast={skillToasts.get(player.index)}
            triggeredEquips={playerEquipTriggers}
            onInspect={() => setInspectIndex(player.index)}
          />
        );
      })}
      <dialog
        ref={dialogRef}
        className="arena-inspect"
        onCancel={() => setInspectIndex(null)}
        onClose={() => setInspectIndex(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setInspectIndex(null);
        }}
      >
        {inspected && (
          <>
            <header>
              <div>
                <small>
                  〔{inspected.index + 1}号位〕{inspected.name} · 观众手牌
                </small>
                <h2>
                  {inspected.character} <span>{identityOf(inspected)}</span>
                </h2>
              </div>
              <button aria-label="关闭手牌" onClick={() => setInspectIndex(null)}>
                ×
              </button>
            </header>
            <div className="arena-inspect-cards">
              {(inspected.hand ?? []).map((card) => (
                <CardTile key={card.id} card={card} large />
              ))}
              {!inspected.hand?.length && <p>当前无手牌</p>}
            </div>
            <p className="arena-inspect-note">
              体力 {inspected.health}/{inspected.maxHealth} · {visibleSkills(inspected).join(' / ')}
              <br />
              此处为观众视角，手牌不会共享给其他 AI。
            </p>
          </>
        )}
      </dialog>
    </section>
  );
}
