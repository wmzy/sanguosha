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
import { css, cx } from '@linaria/core';
import { FACTION_BG, IDENTITY_COLORS } from './gameViewConstants';
import { CountdownBar } from './CountdownBar';
import { getSkillDescription } from '../../engine/skills/lifecycle';
import { useSkillDescReady } from '../hooks/useSkillDescReady';
import { SkillTag } from './SkillTooltip';
import { getCharacterImage } from '../assets/imageAssets';
import { displaySkillName } from '../utils/skillDisplay';

export interface CharSelectOverlayCandidate {
  name: string;
  skills: string[];
  /** 武将基础身份(去版本前缀)。同一武将的标/界/SP 版本共享 baseId,
   *  选将时归为一组。缺失时回退到 name(单版本武将)。 */
  baseId?: string;
}

export interface CharacterMeta {
  faction: string;
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
  // 势力筛选:仅影响候选展示,不参与提交逻辑;'全部' 表示不过滤。
  const [factionFilter, setFactionFilter] = useState('全部');
  // 名称搜索关键字:仅做名称子串匹配(不做拼音转换,避免引入拼音表依赖)。
  const [searchText, setSearchText] = useState('');
  // pending/target 变化时清空选中态与锁定态(新选将窗口开启);
  // 筛选/搜索态一并重置,避免上一轮的过滤条件遮住新一轮候选。
  useEffect(() => {
    setSelectedCharName(null);
    setSubmittedChar(null);
    setHoveredGroupBaseId(null);
    setFactionFilter('全部');
    setSearchText('');
  }, [isSelfSelecting, charSelectTarget]);

  const viewerColor = viewerIdentity ? IDENTITY_COLORS[viewerIdentity] || '#888' : null;

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
  // 避免硬编码遗漏冷门势力。势力缺失时回退 '群',与卡片渲染的回退口径一致。
  const factionOptions = (() => {
    const base = ['全部', '魏', '蜀', '吴', '群'];
    const extra = new Set<string>();
    for (const ch of candidates) {
      const f = getCharacterMeta(ch.name)?.faction ?? '群';
      if (!base.includes(f)) extra.add(f);
    }
    return [...base, ...extra];
  })();

  // 筛选 + 搜索叠加(AND),仅作用于展示:
  // - 势力按组首版本的 meta 判定(同组多版本的势力视为一致);
  // - 搜索匹配组内任一版本名或 baseId(如「甄姬」可命中「界甄姬」组)。
  const visibleGroups = groups.filter((versions) => {
    const faction = getCharacterMeta(versions[0].name)?.faction ?? '群';
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

  /** 渲染单张候选卡(单版本 / 多版本组展开态共用):
   *  竖版立绘填满 + 左上势力印章 + 右上体力点 + 左缘竖排名 + 底部技能 chips。 */
  const renderCard = (
    ch: CharSelectOverlayCandidate,
    isSelected: boolean,
    isLockedOut: boolean,
    isSubmittedPick: boolean,
    onClick: () => void,
  ) => {
    const meta = getCharacterMeta(ch.name);
    const faction = meta?.faction ?? '群';
    const maxHealth = meta?.maxHealth ?? 4;
    const charImg = getCharacterImage(ch.name);
    return (
      <div
        key={ch.name}
        className={cx(
          candidateCard,
          (isSelected || isSubmittedPick) && candidateCardSelected,
          isLockedOut && candidateCardLockedOut,
          submittedChar !== null && candidateCardFrozen,
        )}
        style={{ '--faction-color': FACTION_BG[faction] || '#333' } as React.CSSProperties}
        onClick={onClick}
        data-char-card
      >
        {charImg && (
          <img
            className={candidatePortraitImg}
            src={charImg}
            alt=""
            loading="lazy"
            decoding="async"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        )}
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
      </div>
    );
  };

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
                      {versions.map((ch) =>
                        renderCard(
                          ch,
                          selectedCharName === ch.name,
                          submittedChar !== null && submittedChar !== ch.name,
                          submittedChar === ch.name,
                          () => {
                            if (submittedChar !== null) return;
                            setSelectedCharName(ch.name);
                          },
                        ),
                      )}
                    </div>
                  );
                }

                if (isMulti) {
                  // 多版本组折叠态:显示基础名 + 版本徽章,hover 展开
                  const isSelected = versions.some((v) => selectedCharName === v.name);
                  const isSubmittedPick =
                    submittedChar !== null && versions.some((v) => v.name === submittedChar);
                  const meta = getCharacterMeta(versions[0].name);
                  const faction = meta?.faction ?? '群';
                  const charImg = getCharacterImage(versions[0].name);
                  return (
                    <div
                      key={baseId}
                      data-multi-group={baseId}
                      className={cx(
                        candidateCard,
                        (isSelected || isSubmittedPick) && candidateCardSelected,
                        submittedChar !== null && !isSubmittedPick && candidateCardLockedOut,
                        submittedChar !== null && candidateCardFrozen,
                      )}
                      style={
                        { '--faction-color': FACTION_BG[faction] || '#333' } as React.CSSProperties
                      }
                      onMouseEnter={() => {
                        if (submittedChar === null) setHoveredGroupBaseId(baseId);
                      }}
                    >
                      {charImg && (
                        <img
                          className={candidatePortraitImg}
                          src={charImg}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      )}
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
                    </div>
                  );
                }

                // 单版本:正常候选卡
                const ch = versions[0];
                return renderCard(
                  ch,
                  selectedCharName === ch.name,
                  submittedChar !== null && submittedChar !== ch.name,
                  submittedChar === ch.name,
                  () => {
                    if (submittedChar !== null) return;
                    setSelectedCharName(ch.name);
                  },
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

// ─── Styles ───
const overlayRoot = css`
  position: fixed;
  inset: 0;
  z-index: 10100;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 16px;
  /* 暗幕 + 暗角(vignette) */
  background:
    radial-gradient(120% 90% at 50% 42%, rgba(24, 17, 10, 0) 38%, rgba(0, 0, 0, 0.6) 100%),
    rgba(10, 7, 4, 0.94);
`;

const overlaySlotWrap = css`
  position: absolute;
  top: 12px;
  right: 16px;
  z-index: 10000;
`;

/* 金边双线面板:暗皮革底 + 双线边框 + 四角金色 L 角饰(多层 linear-gradient 角件,
   同 battleFieldDecor 的 background 叠层手法;角件画在面板自身 background 上,
   不随内部滚动移位)。画布设计高 900px → max-height 88% ≈ 790px(禁用 vh)。 */
const panel = css`
  position: relative;
  box-sizing: border-box;
  width: 92%;
  max-width: 1150px;
  max-height: 790px;
  /* 面板为 flex 列:标题/身份/筛选/按钮固定,仅候选网格区内部滚动 */
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 16px 24px 14px;
  border: 1px solid #7a6335;
  border-radius: 10px;
  box-shadow:
    inset 0 0 0 3px rgba(0, 0, 0, 0.55),
    inset 0 0 0 4px #5a4a30,
    0 18px 60px rgba(0, 0, 0, 0.6);
  background:
    linear-gradient(#c4a254, #c4a254) left 9px top 9px / 16px 2px no-repeat,
    linear-gradient(#c4a254, #c4a254) left 9px top 9px / 2px 16px no-repeat,
    linear-gradient(#c4a254, #c4a254) right 9px top 9px / 16px 2px no-repeat,
    linear-gradient(#c4a254, #c4a254) right 9px top 9px / 2px 16px no-repeat,
    linear-gradient(#c4a254, #c4a254) left 9px bottom 9px / 16px 2px no-repeat,
    linear-gradient(#c4a254, #c4a254) left 9px bottom 9px / 2px 16px no-repeat,
    linear-gradient(#c4a254, #c4a254) right 9px bottom 9px / 16px 2px no-repeat,
    linear-gradient(#c4a254, #c4a254) right 9px bottom 9px / 2px 16px no-repeat,
    linear-gradient(#1a150f, #120d08);
`;

/* 候选网格滚动容器:占据面板剩余高度,网格超高时仅此区滚动 */
const gridScroll = css`
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
`;

/* 金书风标题:两侧装饰渐变线,近文字端一枚亮色小方钻(—◆— 意向) */
const selectTitle = css`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  font-size: 22px;
  font-weight: bold;
  color: #e8c47a;
  margin-bottom: 6px;
  letter-spacing: 6px;
  flex-shrink: 0;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.6);

  &::before,
  &::after {
    content: '';
    flex: 1 1 110px;
    max-width: 220px;
    height: 7px;
    background:
      linear-gradient(#e8c47a, #e8c47a) right center / 5px 5px no-repeat,
      linear-gradient(90deg, transparent, #8a7448) left center / calc(100% - 9px) 2px no-repeat;
  }

  &::after {
    transform: scaleX(-1);
  }
`;

const subHint = css`
  font-size: 13px;
  color: #9a8c72;
  letter-spacing: 2px;
  margin-bottom: 6px;
  text-align: center;
`;

const countdownWrap = css`
  width: 340px;
  max-width: 100%;
  margin: 0 auto 10px;
  flex-shrink: 0;
`;

const selfInfoRow = css`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin: 6px 0 8px;
  flex-shrink: 0;
`;

/* 身份印章:身份色底 + 金边,竖排两行(标签 + 值) */
const identityBadge = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 6px 20px;
  border-radius: 4px;
  background: var(--viewer-color);
  border: 1px solid rgba(232, 196, 122, 0.8);
  color: #fff;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
  min-width: 92px;
  box-sizing: border-box;
`;

/* 座次印章:暗铜底 + 铜边 */
const seatBadge = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 6px 20px;
  border-radius: 4px;
  background: linear-gradient(#3a352c, #2a251d);
  border: 1px solid #6a5a3e;
  color: #e8d9a8;
  min-width: 92px;
  box-sizing: border-box;
`;

const badgeLabel = css`
  font-size: 11px;
  opacity: 0.8;
  letter-spacing: 3px;
`;

const badgeValue = css`
  font-size: 18px;
  font-weight: bold;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
`;

/* ── 筛选工具行(势力 chips + 搜索框):方角暗铜 chips,选中金底 ── */
const filterToolbar = css`
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin-bottom: 10px;
  width: 100%;
  flex-shrink: 0;
`;

const factionChips = css`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`;

const factionChip = css`
  padding: 4px 14px;
  font-size: 13px;
  letter-spacing: 2px;
  color: #cfc4a8;
  background: linear-gradient(#3a352c, #2a251d);
  border: 1px solid #5a4a30;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    color: #e8c47a;
    border-color: #8a7448;
  }
`;

const factionChipActive = css`
  color: #241d15;
  font-weight: bold;
  background: linear-gradient(#e8c47a, #c4a254);
  border-color: #e8c47a;

  &:hover {
    color: #241d15;
    border-color: #e8c47a;
  }
`;

const searchInput = css`
  box-sizing: border-box;
  width: 160px;
  padding: 5px 12px;
  font-size: 13px;
  color: #f0e8d0;
  background: rgba(0, 0, 0, 0.45);
  border: 1px solid #5a4a30;
  border-radius: 4px;
  outline: none;
  transition: border-color 0.15s;

  &::placeholder {
    color: rgba(232, 196, 122, 0.4);
  }

  &:focus {
    border-color: #c4a254;
  }
`;

const noMatchHint = css`
  margin-top: 24px;
  font-size: 15px;
  color: #8a7448;
  letter-spacing: 2px;
  text-align: center;
`;

/* 候选网格:固定 5 列,行高 300px,间距 14px(面板自身滚动,网格不限高) */
const candidateGrid = css`
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  grid-auto-rows: 230px;
  gap: 12px;
  width: 100%;
`;

const candidateGroupExpanded = css`
  display: flex;
  gap: 8px;
  align-items: stretch;
  width: 100%;
  height: 100%;

  & > * {
    flex: 1 1 0;
    min-width: 0;
  }
`;

const candidateCard = css`
  position: relative;
  box-sizing: border-box;
  background: linear-gradient(#241d15, #171209);
  border: 1px solid #4a3d2a;
  border-radius: 6px;
  padding: 0;
  display: block;
  cursor: pointer;
  /* 不设 overflow:hidden:选中态 ▼ 箭头需要露出卡片下缘(立绘圆角自裁) */
  transform: translateY(0);
  transition: transform 0.25s cubic-bezier(0.23, 1, 0.32, 1), border-color 0.25s, box-shadow 0.25s;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);

  &:hover {
    transform: translateY(-6px);
    border-color: #c4a254;
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.55);
  }
`;

// 候选武将立绘:绝对定位填满卡片,object-fit cover
const candidatePortraitImg = css`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;
  border-radius: 5px;
  z-index: 0;
`;

// 左上势力印章:势力色底 + 1px 金边 + 金字
const factionSeal = css`
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 2;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: bold;
  color: #e8c47a;
  background: var(--faction-color);
  border: 1px solid rgba(232, 196, 122, 0.85);
  border-radius: 3px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
`;

// 右上体力点:小圆点一排,红 #c0392b,数量 = maxHealth(多点时自动换行)
const hpDots = css`
  position: absolute;
  top: 13px;
  right: 8px;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 3px;
  max-width: 48px;
`;

const hpDot = css`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #c0392b;
  box-shadow:
    0 0 3px rgba(192, 57, 43, 0.8),
    inset 0 -1px 1px rgba(0, 0, 0, 0.4);
`;

// 左缘竖排武将名:白字粗体 + 深描边,背后自上而下渐变黑条
const candidateName = css`
  position: absolute;
  top: 38px;
  left: 0;
  z-index: 2;
  writing-mode: vertical-rl;
  text-orientation: upright;
  font-size: 16px;
  font-weight: bold;
  color: #fff;
  letter-spacing: 5px;
  padding: 12px 5px 8px 4px;
  background: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0.75),
    rgba(0, 0, 0, 0.35) 65%,
    transparent
  );
  text-shadow:
    0 0 3px #000,
    0 1px 2px #000;
  max-height: calc(100% - 44px);
  overflow: hidden;
`;

// 底部技能 chips 层:渐变蒙版上排布暗底金字小 chip
const candidateMeta = css`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 22px 6px 8px;
  background: linear-gradient(
    to top,
    rgba(0, 0, 0, 0.85),
    rgba(0, 0, 0, 0.45) 55%,
    transparent
  );
`;

// 技能 chip:10px 暗底金字小圆角(SkillTag 承担 hover 描述)
const skillChip = css`
  font-size: 10px;
  line-height: 1;
  color: #e8c47a;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid rgba(138, 116, 72, 0.6);
  border-radius: 3px;
  padding: 3px 6px;
  white-space: nowrap;
`;

/* 选中态:2px 金框 + 外发光 + 卡正下方金色 ▼ 箭头(CSS border 三角) */
const candidateCardSelected = css`
  border: 2px solid #ffd700;
  box-shadow:
    0 0 18px rgba(255, 215, 0, 0.45),
    0 6px 20px rgba(0, 0, 0, 0.5);

  &::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    margin-top: 4px;
    border: 7px solid transparent;
    border-top-color: #ffd700;
    border-bottom-width: 0;
    filter: drop-shadow(0 0 4px rgba(255, 215, 0, 0.5));
  }

  &:hover {
    transform: translateY(-8px);
    box-shadow:
      0 0 18px rgba(255, 215, 0, 0.45),
      0 6px 20px rgba(0, 0, 0, 0.5);
  }
`;

/* 已提交锁定:其他卡灰化降透明,已选卡保持金框 + ▼ */
const candidateCardLockedOut = css`
  opacity: 0.35;
  filter: grayscale(0.8);
  cursor: default;
`;

const candidateCardFrozen = css`
  /* 已提交锁定:直接禁指针事件,悬浮上浮/金边变化全部停掉
     (点击防护仍由 submittedChar 守卫兜底,jsdom 测试不模拟 pointer-events) */
  pointer-events: none;
`;

/* 折叠多版本组右上角版本徽章 */
const variantBadge = css`
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  display: flex;
  gap: 4px;
`;

const variantTag = css`
  padding: 1px 6px;
  font-size: 11px;
  font-weight: bold;
  color: #e8d9a8;
  background: rgba(0, 0, 0, 0.6);
  border-radius: 4px;
  border: 1px solid #5a4a30;
`;

const variantTagActive = css`
  color: #241d15;
  background: #c4a254;
  border-color: #c4a254;
`;

/* 确认按钮:红漆大按钮;未选 = 暗铜禁用;已提交保持红底(文案变「✅ 已选择 X」) */
const confirmBtn = css`
  display: block;
  margin: 12px auto 4px;
  padding: 10px 56px;
  font-size: 17px;
  font-weight: bold;
  letter-spacing: 6px;
  border-radius: 6px;
  border: 1px solid #d4a048;
  flex-shrink: 0;
  transition: all 0.2s;
`;

const confirmBtnIdle = css`
  color: #8a8070;
  background: linear-gradient(#3a352c, #2a251d);
  border-color: #4a4436;
  cursor: not-allowed;
  box-shadow: none;
`;

const confirmBtnReady = css`
  color: #f5e6c8;
  background: linear-gradient(#a03028, #7a2018);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.15),
    0 4px 14px rgba(160, 48, 40, 0.35);
  cursor: pointer;

  &:hover {
    filter: brightness(1.1);
  }
`;

const confirmBtnSubmitted = css`
  color: #f5e6c8;
  background: linear-gradient(#a03028, #7a2018);
  opacity: 0.85;
  cursor: not-allowed;
`;

const waitingHint = css`
  margin: 56px auto;
  font-size: 18px;
  color: #b9a77f;
  letter-spacing: 4px;
  text-align: center;
`;
