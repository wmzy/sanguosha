// src/client/components/CharSelectOverlay.tsx
// 选将遮罩:开局每位玩家轮流从候选武将中选 1 位(主公先选,之后逆时针)。
// - 自身选将:展示候选卡 + 可点选 + 确认按钮;
// - 他人选将:仅显示「等待 P<n> 选将」;
// - 主公选将且非自身:显示「主公正在选将,请等待」(主公身份已公开)。
//
// 视觉对齐官方 OL 客户端:全屏暗幕 + 居中金边双线面板(四角金色 L 角饰),
// 竖版武将卡网格(左上势力印章/右上体力点/左缘竖排名/底部技能 chips)。
// 注意:遮罩位于游戏画布(transform scale)内,样式一律用 px,禁止 vw/vh。
//
// 选将保密:非自身选将时,不暴露 seat 玩家名字(避免情报泄漏)。
// 选将逻辑:玩家点选后,内部维护 selectedCharIdx,点「确认」才向引擎发 respond action。

import { useState, useEffect, type ReactNode } from 'react';
import { cx } from '@linaria/core';
import type { Faction } from '../../engine/types';
import { FACTION_BG, IDENTITY_COLORS } from './gameViewConstants';
import {
  badgeLabel,
  badgeValue,
  candidateCard,
  candidateCardFrozen,
  candidateCardLockedOut,
  candidateCardSelected,
  candidateGrid,
  candidateGroupExpanded,
  candidateMeta,
  candidateName,
  candidatePortraitImg,
  confirmBtn,
  confirmBtnIdle,
  confirmBtnReady,
  confirmBtnSubmitted,
  countdownWrap,
  factionChip,
  factionChipActive,
  factionChips,
  factionSeal,
  filterToolbar,
  gridScroll,
  hpDot,
  hpDots,
  identityBadge,
  noMatchHint,
  overlayRoot,
  overlaySlotWrap,
  panel,
  searchInput,
  seatBadge,
  selectTitle,
  selfInfoRow,
  skillChip,
  subHint,
  variantBadge,
  variantTag,
  variantTagActive,
  waitingHint,
} from './gameViewStyles/charSelect';
import { CountdownBar } from './CountdownBar';
import { getSkillDescription } from '../../engine/skills/lifecycle';
import { useSkillDescReady } from '../hooks/useSkillDescReady';
import { SkillTag } from './SkillTooltip';
import { getCharacterImage } from '../assets/imageAssets';
import { displaySkillName } from '../utils/skillDisplay';
import { DEFAULT_FACTION_COLOR, fallbackFaction, hideImgOnError } from '../utils/characterVisuals';

export interface CharSelectOverlayCandidate {
  name: string;
  skills: string[];
  /** 武将基础身份(去版本前缀)。同一武将的标/界/SP 版本共享 baseId,
   *  选将时归为一组。缺失时回退到 name(单版本武将)。 */
  baseId?: string;
}

export interface CharacterMeta {
  faction: Faction;
  maxHealth: number;
}

interface CharSelectOverlayProps {
  /** 引擎生成的候选武将(已排除已选武将) */
  candidates: CharSelectOverlayCandidate[];
  /** 当前选将的座次下标 */
  charSelectTarget: number;
  /** 是否自己正在选将 */
  isSelfSelecting: boolean;
  /** 当前选将的玩家是否主公 */
  isLord: boolean;
  /** 当前视角下标(viewer) */
  viewer: number;
  /** viewer 的身份(用于身份牌配色);可空表示尚未分配 */
  viewerIdentity?: string;
  /** 选将截止时间戳(由引擎 pending.deadline 传入);为 null 不显示倒计时 */
  deadline: number | null;
  /** 选将总时长(由引擎 pending.totalMs 传入,默认 30s) */
  totalMs: number;
  /** 点确认后回调,通知父组件发送选将 respond action */
  onSelect: (characterName: string) => void;
  /** 从 engine character-meta 获取武将的势力/体力上限;
   *  通过 prop 注入而非直接 import,便于解耦与单元测试。
   *  找不到时回退 faction='群'、maxHealth=4。 */
  getCharacterMeta: (name: string) => CharacterMeta | undefined;
  /** 右上角插槽:上层渲染视角控制等 debug UI。 */
  overlaySlot?: ReactNode;
}

/** useCharSelectFilter 的返回状态:筛选控件值 + 分组过滤后的可见候选组 */
interface CharSelectFilterState {
  /** 势力 chips 选项:主五项 + 候选中实际出现的其他势力动态补充 */
  factionOptions: string[];
  factionFilter: string;
  setFactionFilter: (f: string) => void;
  searchText: string;
  setSearchText: (t: string) => void;
  /** 按 baseId 分组并应用势力/搜索过滤后的候选组 */
  visibleGroups: CharSelectOverlayCandidate[][];
}

/** 选将候选的分组 + 势力/名称筛选状态。
 *  - 按 baseId 分组:同一武将的标/界/SP 版本归为一组;
 *  - 势力 chips 选项:固定主五项 + 候选中实际出现的其他势力(如 '神')动态补充,
 *    避免硬编码遗漏冷门势力。势力缺失时回退 '群',与卡片渲染的回退口径一致;
 *  - 筛选 + 搜索叠加(AND),仅作用于展示:
 *    · 势力按组首版本的 meta 判定(同组多版本的势力视为一致);
 *    · 搜索匹配组内任一版本名或 baseId(如「甄姬」可命中「界甄姬」组);
 *  - pending/target 变化时重置过滤条件,避免上一轮的条件遮住新一轮候选。 */
function useCharSelectFilter(
  candidates: CharSelectOverlayCandidate[],
  getCharacterMeta: (name: string) => CharacterMeta | undefined,
  isSelfSelecting: boolean,
  charSelectTarget: number,
): CharSelectFilterState {
  const [factionFilter, setFactionFilter] = useState('全部');
  // 名称搜索关键字:仅做名称子串匹配(不做拼音转换,避免引入拼音表依赖)。
  const [searchText, setSearchText] = useState('');
  useEffect(() => {
    setFactionFilter('全部');
    setSearchText('');
  }, [isSelfSelecting, charSelectTarget]);

  // 按 baseId 分组候选武将:同一武将的标/界/SP 版本归为一组
  const groups: CharSelectOverlayCandidate[][] = (() => {
    const map = new Map<string, CharSelectOverlayCandidate[]>();
    for (const ch of candidates) {
      const bid = ch.baseId ?? ch.name;
      let arr = map.get(bid);
      if (!arr) {
        arr = [];
        map.set(bid, arr);
      }
      arr.push(ch);
    }
    return [...map.values()];
  })();

  // 势力 chips 选项:固定主五项 + 候选中实际出现的其他势力(如 '神')动态补充,
  // 避免硬编码遗漏冷门势力。势力缺失时回退 '群'(fallbackFaction),
  // 与卡片渲染的回退口径一致。
  const factionOptions = (() => {
    const base = ['全部', '魏', '蜀', '吴', '群'];
    const extra = new Set<string>();
    for (const ch of candidates) {
      const f = fallbackFaction(getCharacterMeta(ch.name)?.faction);
      if (!base.includes(f)) extra.add(f);
    }
    return [...base, ...extra];
  })();

  const visibleGroups = groups.filter((versions) => {
    const faction = fallbackFaction(getCharacterMeta(versions[0].name)?.faction);
    if (factionFilter !== '全部' && faction !== factionFilter) return false;
    const kw = searchText.trim();
    if (
      kw &&
      !(versions[0].baseId ?? '').includes(kw) &&
      !versions.some((v) => v.name.includes(kw))
    ) {
      return false;
    }
    return true;
  });

  return { factionOptions, factionFilter, setFactionFilter, searchText, setSearchText, visibleGroups };
}

/** 单张候选卡(单版本 / 多版本组展开态共用)的 props */
interface CharCandidateCardProps {
  ch: CharSelectOverlayCandidate;
  getCharacterMeta: (name: string) => CharacterMeta | undefined;
  isSelected: boolean;
  /** 已提交后其余卡灰化降透明 */
  isLockedOut: boolean;
  /** 该卡即已提交的选将(保持金框 + ▼) */
  isSubmittedPick: boolean;
  /** 已提交锁定态(禁止再选) */
  isFrozen: boolean;
  onClick: () => void;
}

/** 候选卡外壳 props:选中/灰化/冻结态、势力色、立绘与交互统一由外壳承担;
 *  卡面内容(势力印章/体力点/竖排名/技能 chips/版本徽章)由 children 注入。 */
interface CandidateCardShellProps {
  /** 势力(决定卡底势力色;调用方先用 fallbackFaction 回退) */
  faction: string;
  /** 立绘 URL;null 不渲染 <img>(保留势力色底) */
  charImg: string | null;
  /** 选中/已提交拾取 → 金框 + ▼ */
  isSelected: boolean;
  /** 已提交后其余卡灰化降透明 */
  isLockedOut: boolean;
  /** 已提交锁定态(禁止再选) */
  isFrozen: boolean;
  /** 单版本/展开卡点选(已提交守卫由调用方负责) */
  onClick?: () => void;
  /** 折叠组 hover 展开(仅未提交时由调用方触发) */
  onMouseEnter?: () => void;
  /** 渲染 data-char-card(可点选候选卡的 e2e/测试选择器) */
  markCandidate?: boolean;
  /** 折叠多版本组 baseId,渲染 data-multi-group=<baseId>(e2e/测试选择器) */
  multiGroupBaseId?: string;
  children: ReactNode;
}

/** 候选卡外壳:选中/灰化/冻结态 + 势力色底 + 立绘(加载失败走
 *  characterVisuals.hideImgOnError 隐藏,保留势力色底回退)。单版本/多版本组
 *  展开卡(CharCandidateCard)与折叠多版本组(下方渲染分支)共用。 */
function CandidateCardShell({
  faction,
  charImg,
  isSelected,
  isLockedOut,
  isFrozen,
  onClick,
  onMouseEnter,
  markCandidate,
  multiGroupBaseId,
  children,
}: CandidateCardShellProps) {
  return (
    <div
      className={cx(
        candidateCard,
        isSelected && candidateCardSelected,
        isLockedOut && candidateCardLockedOut,
        isFrozen && candidateCardFrozen,
      )}
      style={
        { '--faction-color': FACTION_BG[faction] ?? DEFAULT_FACTION_COLOR } as React.CSSProperties
      }
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      data-char-card={markCandidate ? true : undefined}
      data-multi-group={multiGroupBaseId}
    >
      {charImg && (
        <img
          className={candidatePortraitImg}
          src={charImg}
          alt=""
          loading="lazy"
          decoding="async"
          onError={hideImgOnError}
        />
      )}
      {children}
    </div>
  );
}

/** 单张候选武将卡(单版本 / 多版本组展开态共用):
 *  竖版立绘填满 + 左上势力印章 + 右上体力点 + 左缘竖排名 + 底部技能 chips;
 *  卡壳(状态样式/势力色/立绘)由 CandidateCardShell 承担。 */
function CharCandidateCard({
  ch,
  getCharacterMeta,
  isSelected,
  isLockedOut,
  isSubmittedPick,
  isFrozen,
  onClick,
}: CharCandidateCardProps) {
  const meta = getCharacterMeta(ch.name);
  const faction = fallbackFaction(meta?.faction);
  const maxHealth = meta?.maxHealth ?? 4;
  const charImg = getCharacterImage(ch.name);
  return (
    <CandidateCardShell
      faction={faction}
      charImg={charImg}
      isSelected={isSelected || isSubmittedPick}
      isLockedOut={isLockedOut}
      isFrozen={isFrozen}
      onClick={onClick}
      markCandidate
    >
      {/* 左上势力印章:势力色底 + 金边金字 */}
      <div className={factionSeal}>{faction}</div>
      {/* 右上体力点:数量 = 体力上限 */}
      <div className={hpDots}>
        {Array.from({ length: maxHealth }, (_, j) => (
          <div key={j} className={hpDot} />
        ))}
      </div>
      {/* 左缘竖排武将名:黑条渐变衬底 + 描边白字 */}
      <div className={candidateName}>{ch.name}</div>
      {/* 底部技能 chips(hover 出描述,SkillTag 承担) */}
      <div className={candidateMeta}>
        {ch.skills.map((s) => (
          <SkillTag
            key={s}
            name={displaySkillName(s)}
            description={getSkillDescription(s)}
            className={skillChip}
          >
            {displaySkillName(s)}
          </SkillTag>
        ))}
      </div>
    </CandidateCardShell>
  );
}

/**
 * 选将遮罩。
 * - 自维护 `selectedCharIdx`(候选高亮态),pending/target 变化时重置;
 * - 势力色 / 体力上限通过 `getCharacterMeta` prop 注入,不依赖硬编码 CHAR_POOL。
 */
export function CharSelectOverlay({
  candidates,
  charSelectTarget,
  isSelfSelecting,
  isLord,
  viewer,
  viewerIdentity,
  deadline,
  totalMs,
  onSelect,
  getCharacterMeta,
  overlaySlot,
}: CharSelectOverlayProps) {
  useSkillDescReady(); // 技能模块加载后重渲染,确保候选武将技能描述 title 命中
  const [selectedCharName, setSelectedCharName] = useState<string | null>(null);
  // 已提交锁定态:点「确认选择」后记录选中的武将名,锁定候选区与按钮,
  // 直到引擎广播新 view(选将 slot resolve → pending 切换 → 本组件卸载或重置)。
  // 此前遮罩仍在渲染,必须禁止重复点击其他武将 + 再次提交。
  const [submittedChar, setSubmittedChar] = useState<string | null>(null);
  // 多版本组 hover 展开态:记录当前 hover 的组 baseId,null 表示无展开。
  const [hoveredGroupBaseId, setHoveredGroupBaseId] = useState<string | null>(null);
  // 候选分组 + 势力/名称筛选(仅影响展示,不参与提交逻辑)
  const {
    factionOptions,
    factionFilter,
    setFactionFilter,
    searchText,
    setSearchText,
    visibleGroups,
  } = useCharSelectFilter(candidates, getCharacterMeta, isSelfSelecting, charSelectTarget);
  // pending/target 变化时清空选中态与锁定态(新选将窗口开启;
  // 筛选/搜索态由 useCharSelectFilter 按同一依赖自行重置)。
  useEffect(() => {
    setSelectedCharName(null);
    setSubmittedChar(null);
    setHoveredGroupBaseId(null);
  }, [isSelfSelecting, charSelectTarget]);

  const viewerColor = viewerIdentity ? IDENTITY_COLORS[viewerIdentity] || '#888' : null;

  return (
    <div className={overlayRoot} data-char-select-overlay>
      {/* ── 右上角插槽(debug 视角控制等,由上层注入) ── */}
      {overlaySlot && <div className={overlaySlotWrap}>{overlaySlot}</div>}
      {/* 金边双线面板:标题/筛选/网格/按钮都在面板内,面板自身滚动 */}
      <div className={panel}>
        {/* 标题:主公选将 / P<n> 选将中(两侧装饰线) */}
        <div className={selectTitle}>{isLord ? '主公选将' : `P${charSelectTarget} 选将中`}</div>
        {isLord && <div className={subHint}>主公已亮明身份</div>}
        {isSelfSelecting && !isLord && (
          <div className={subHint}>你正在选将(他人不可见你的选择)</div>
        )}
        {!isLord && !isSelfSelecting && <div className={subHint}>选将保密</div>}


        {/* 自身信息区:身份印章 + 座次印章(横排) */}
        <div className={selfInfoRow}>
          {viewerColor && viewerIdentity && (
            <div
              className={identityBadge}
              style={{ '--viewer-color': viewerColor } as React.CSSProperties}
            >
              <div className={badgeLabel}>你的身份</div>
              <div className={badgeValue}>{viewerIdentity}</div>
            </div>
          )}
          <div className={seatBadge}>
            <div className={badgeLabel}>你的座次</div>
            <div className={badgeValue}>P{viewer}</div>
          </div>
        </div>

        {/* 倒计时进度条 */}
        <div className={countdownWrap}>
          <CountdownBar deadline={deadline} totalMs={totalMs} />
        </div>

        {isSelfSelecting ? (
          <>
            {/* 筛选工具行:势力 chips + 名称搜索。仅自身选将时展示(他人选将无候选列表)。
                注意 input 不设 autoFocus:避免抢焦点破坏确认按钮的 Enter 语义。 */}
            <div className={filterToolbar}>
              <div className={factionChips}>
                {factionOptions.map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={cx(factionChip, factionFilter === f && factionChipActive)}
                    onClick={() => setFactionFilter(f)}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <input
                className={searchInput}
                type="text"
                value={searchText}
                placeholder="搜索武将…"
                onChange={(e) => setSearchText(e.target.value)}
              />
            </div>

            {/* 候选网格:固定 5 列,多版本组 hover 原地水平展开。
                网格区内部滚动,标题/筛选/确认按钮固定可见(面板不再整页滚动)。 */}
            <div className={gridScroll}>
              <div className={candidateGrid}>
              {visibleGroups.map((versions) => {
                const baseId = versions[0].baseId ?? versions[0].name;
                const isMulti = versions.length > 1;
                const isExpanded = isMulti && hoveredGroupBaseId === baseId;

                if (isMulti && isExpanded) {
                  // 多版本组展开态:水平排列各版本候选卡
                  return (
                    <div
                      key={baseId}
                      className={candidateGroupExpanded}
                      onMouseLeave={() => setHoveredGroupBaseId(null)}
                    >
                      {versions.map((ch) => (
                        <CharCandidateCard
                          key={ch.name}
                          ch={ch}
                          getCharacterMeta={getCharacterMeta}
                          isSelected={selectedCharName === ch.name}
                          isLockedOut={submittedChar !== null && submittedChar !== ch.name}
                          isSubmittedPick={submittedChar === ch.name}
                          isFrozen={submittedChar !== null}
                          onClick={() => {
                            if (submittedChar !== null) return;
                            setSelectedCharName(ch.name);
                          }}
                        />
                      ))}
                    </div>
                  );
                }

                if (isMulti) {
                  // 多版本组折叠态:显示基础名 + 版本徽章,hover 展开
                  const isSelected = versions.some((v) => selectedCharName === v.name);
                  const isSubmittedPick =
                    submittedChar !== null && versions.some((v) => v.name === submittedChar);
                  const meta = getCharacterMeta(versions[0].name);
                  const faction = fallbackFaction(meta?.faction);
                  const charImg = getCharacterImage(versions[0].name);
                  return (
                    <CandidateCardShell
                      key={baseId}
                      faction={faction}
                      charImg={charImg}
                      isSelected={isSelected || isSubmittedPick}
                      isLockedOut={submittedChar !== null && !isSubmittedPick}
                      isFrozen={submittedChar !== null}
                      multiGroupBaseId={baseId}
                      onMouseEnter={() => {
                        if (submittedChar === null) setHoveredGroupBaseId(baseId);
                      }}
                    >
                      {/* 右上版本徽章:标/界小标签(折叠态无体力点,不冲突) */}
                      <div className={variantBadge}>
                        {versions.map((v) => (
                          <span
                            key={v.name}
                            className={cx(
                              variantTag,
                              v.name === selectedCharName && variantTagActive,
                            )}
                          >
                            {v.name.startsWith('界') ? '界' : '标'}
                          </span>
                        ))}
                      </div>
                      <div className={factionSeal}>{faction}</div>
                      <div className={candidateName}>{baseId}</div>
                      <div className={candidateMeta}>
                        <span className={skillChip}>hover 展开选版本</span>
                      </div>
                    </CandidateCardShell>
                  );
                }

                // 单版本:正常候选卡
                const ch = versions[0];
                return (
                  <CharCandidateCard
                    key={ch.name}
                    ch={ch}
                    getCharacterMeta={getCharacterMeta}
                    isSelected={selectedCharName === ch.name}
                    isLockedOut={submittedChar !== null && submittedChar !== ch.name}
                    isSubmittedPick={submittedChar === ch.name}
                    isFrozen={submittedChar !== null}
                    onClick={() => {
                      if (submittedChar !== null) return;
                      setSelectedCharName(ch.name);
                    }}
                  />
                );
              })}
              </div>
            </div>

            {/* 筛选/搜索无命中时给出明确提示,而非留白 */}
            {visibleGroups.length === 0 && (
              <div className={noMatchHint}>无匹配武将</div>
            )}

            {/* 确认按钮:提交后锁定为「已选择 XXX」,禁止重复提交 */}
            <button
              className={cx(
                confirmBtn,
                submittedChar !== null
                  ? confirmBtnSubmitted
                  : selectedCharName !== null
                    ? confirmBtnReady
                    : confirmBtnIdle,
              )}
              disabled={submittedChar !== null || selectedCharName === null}
              onClick={() => {
                if (submittedChar !== null) return;
                if (selectedCharName) {
                  setSubmittedChar(selectedCharName); // 锁定,禁止重选
                  setSelectedCharName(null);
                  onSelect(selectedCharName);
                }
              }}
            >
              {submittedChar !== null ? `✅ 已选择 ${submittedChar}` : '确认选择'}
            </button>
          </>
        ) : isLord ? (
          <div className={waitingHint}>主公正在选将，请等待...</div>
        ) : (
          <div className={waitingHint}>等待 P{charSelectTarget} 选将...</div>
        )}
      </div>
    </div>
  );
}

