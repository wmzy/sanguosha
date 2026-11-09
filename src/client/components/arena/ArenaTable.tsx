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

type Player = GameView['players'][number];
const positions: Record<number, number[][]> = {
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
// 按全部武将的公开技能过滤系统技能，同时保留觉醒、化身等动态获得的技能。
const characterSkills = new Set(
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
  onInspect,
}: {
  player: Player;
  view: GameView;
  position: number[];
  active: boolean;
  onInspect: () => void;
}) {
  const portrait = getCharacterImage(player.character);
  const faction = player.faction ?? getCharacterMeta(player.character)?.faction ?? '群';
  const hand = player.hand ?? [];
  const identity = identityOf(player);
  const equipment = Object.entries(player.equipment).filter((entry): entry is [string, string] =>
    Boolean(entry[1]),
  );
  return (
    <article
      className={`arena-seat ${!player.alive ? 'is-dead' : ''} ${active && player.alive ? 'is-active' : ''}`}
      style={{ left: `${position[0]}%`, top: `${position[1]}%` }}
      data-testid={`arena-player-${player.index}`}
    >
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
          className={`arena-portrait faction-${faction}`}
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
          <div className="arena-equip">
            {equipment.length ? (
              equipment.map(([slot, id]) => (
                <div key={slot} title={slot}>
                  <span>
                    {slot === '进攻马' ? '−1' : slot === '防御马' ? '+1' : slot.slice(0, 1)}
                  </span>
                  {view.cardMap[id]?.name ?? '装备'}
                </div>
              ))
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
  useEffect(() => {
    if (inspectIndex !== null) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [inspectIndex]);
  const processing = (view.zones?.processing ?? []).map((id) => view.cardMap[id]).filter(Boolean);
  const current = view.players.find((player) => player.index === view.currentPlayerIndex);
  const done = manifest.status === 'completed';
  // 终局落盘前 winner 可能仍为零基座次，归档后则是阵营名称。
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
        {view.log.at(-1) && <p className="arena-last-event">{view.log.at(-1)?.text}</p>}
      </div>
      {view.players.map((player, i) => (
        <Seat
          key={player.index}
          player={player}
          view={view}
          position={positions[view.players.length]?.[i] ?? [50, 50]}
          active={player.index === view.currentPlayerIndex && !done}
          onInspect={() => setInspectIndex(player.index)}
        />
      ))}
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
