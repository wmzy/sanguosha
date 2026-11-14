// 座位区样式:弧形排列 + 中央区域行(处理区/弃牌堆) + 武将座位卡全套 + 动画状态。
// 武将座位卡样式已从 PlayerSeatView.tsx 迁入本文件(组件只留逻辑);既有共享消费方条目:
//   - 座位环布局(SeatArcLayout)+ 牌堆/弃牌堆行(ZoneInfoBar)
//   - 大卡(自己)可点选/被选为目标态(GameView 底栏 PlayerCardLarge 外层复用)
//   - 处理区标签(ZoneInfoBar)+ 动画状态类(GameView/PlayerCardLarge/GameHeader)
//   - 体力漂浮数字基座+变体(座位卡/大卡共用,渲染层见 utils/HpFloatNumber)

import { css } from '@linaria/core';

// ─── Seating — arc layout ───
// 占满 battleField,座位环绕中央,中央留出处理区位置
export const seatingArea = css`
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
`;
// 弧形排列容器:其他玩家沿上半部分弧线分布。
// 画布宽流式伸缩(1280~2240),超宽屏时座位环限宽居中,避免弧线过度拉伸走形
// (座位定位为容器百分比,限宽即限弧);中央装饰/操作坞仍按整个战场区铺开。
export const seatArcContainer = css`
  position: relative;
  width: 100%;
  max-width: 1760px;
  margin: 0 auto;
  height: 100%;
  overflow: visible;
`;
// 弧形中每个座位槽位:用 absolute 精确定位
export const seatArcSlot = css`
  position: absolute;
  left: var(--seat-left, 0);
  top: var(--seat-top, 0);
  transform: translateX(-50%);
  /* 宽度 = 武将卡高度 × 15/19,与大卡/座位卡同尺寸;内部 CountdownBar 与卡对齐 */
  width: calc(var(--hero-card-h) * 15 / 19);
  display: flex;
  flex-direction: column;
  gap: 3px;
  z-index: 2;
`;
export const metaText = css`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: #cbbd93;
  background: linear-gradient(rgba(34, 28, 16, 0.85), rgba(22, 18, 10, 0.85));
  border: 1px solid rgba(200, 164, 78, 0.32);
  border-radius: 999px;
  padding: 4px 14px;
  letter-spacing: 0.5px;
  box-shadow:
    inset 0 1px 0 rgba(255, 235, 180, 0.07),
    0 2px 10px rgba(0, 0, 0, 0.45);
`;
/** 牌堆/弃牌堆图标:小卡背 */
export const zoneIcon = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 26px;
  font-size: 15px;
  line-height: 1;
  color: #d8c48a;
  background: linear-gradient(160deg, #3a2f52, #241d38);
  border: 1px solid rgba(200, 164, 78, 0.5);
  border-radius: 3px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
`;
/** 区块计数数字 */
export const zoneCount = css`
  color: #f0dfae;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
`;

// ─── 大卡(自己)目标选择态:GameView 底栏 PlayerCardLarge 外层复用 ───
// (可选自己为目标:铁索连环含自己;座位卡同款交互样式见下方 seatCardTargetable/seatCardTargetPulse)
export const seatCardClickable = css`
  cursor: pointer;
  &:hover {
    outline: 2px solid #e74c3c;
  }
`;
export const seatCardTargeted = css`
  outline: 3px solid #e74c3c;
  box-shadow: 0 0 12px rgba(231, 76, 60, 0.4);
`;

// 处理区:游戏中央的一排小卡
export const processingRow = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 6px auto;
  padding: 6px 12px;
  background: rgba(231, 126, 34, 0.14);
  border: 1px dashed #e67e22;
  border-radius: 8px;
  max-width: 480px;
  font-size: 12px;
  justify-content: center;
  box-shadow: 0 2px 12px rgba(230, 126, 34, 0.2);
`;
export const processingLabel = css`
  color: #e67e22;
  font-weight: bold;
`;
export const processingTag = css`
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--suit-color, #ccc);
  color: var(--suit-color, #ccc);
  background: rgba(230, 126, 34, 0.08);
  font-weight: bold;
`;
// 处理区牌上的使用者名(小号白字,前面带·分隔)
export const processingOwner = css`
  color: #f1c40f;
  font-size: 10px;
  margin-right: 4px;
  font-weight: normal;
`;
export const processingCardName = css`
  margin-right: 2px;
`;
export const processingSuit = css`
  font-size: 10px;
  opacity: 0.85;
`;
// 弃牌堆:小卡背图标 + 计数(与牌堆药丸同语言,红色系区分)
export const discardPileRow = css`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-top: 2px;
  font-size: 12px;
  color: #c9a49b;
  background: linear-gradient(rgba(34, 20, 16, 0.85), rgba(24, 14, 10, 0.85));
  border: 1px solid rgba(231, 76, 60, 0.35);
  border-radius: 999px;
  padding: 3px 12px;
  letter-spacing: 0.5px;
  box-shadow:
    inset 0 1px 0 rgba(255, 200, 180, 0.05),
    0 2px 10px rgba(0, 0, 0, 0.45);
`;
export const discardPileIcon = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 26px;
  font-size: 13px;
  line-height: 1;
  color: #e8a08f;
  background: linear-gradient(160deg, #4a2622, #301815);
  border: 1px solid rgba(231, 76, 60, 0.5);
  border-radius: 3px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
`;
export const discardPileCount = css`
  color: #f2c4b8;
  font-weight: bold;
  font-variant-numeric: tabular-nums;
`;

// ─── 动画状态样式 ───
export const hpFlash = css`
  animation: damageFlash 0.6s ease-out both;
`;
export const seatShaking = css`
  animation: damageShake 0.5s ease-out both;
`;
export const seatDamageOverlay = css`
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 8px;
    pointer-events: none;
    animation: damageOverlay 0.6s ease-out both;
  }
  position: relative;
`;
export const hpHealFlash = css`
  animation: healFlash 0.6s ease-out both;
`;
/* ── 体力变化漂浮数字(座位卡/大卡共用,渲染层见 utils/HpFloatNumber) ──
 * 伤害「-N」红 / 回血「+N」绿,上浮渐隐 1s(与 useAnimationState 清除时序对齐)。
 * 基座管定位/动画;尺寸与纵向位置按卡型分变体(座位卡小号 26px/38%,大卡大号 34px/32%),
 * 光晕强度经 --hp-float-glow 变量注入(缺省 8px=大卡,座位卡变体压到 6px)。 */
export const hpFloatNumberBase = css`
  position: absolute;
  left: 50%;
  z-index: 6;
  font-weight: 700;
  pointer-events: none;
  animation: hpFloatUp 1s ease-out both;
`;
/* 大卡变体(视角玩家 PlayerCardLarge) */
export const hpFloatNumberLarge = css`
  top: 32%;
  font-size: 34px;
  --hp-float-glow: 8px;
`;
/* 座位卡变体(弧形座位 PlayerSeatView):font-family 跟随座位卡排版 */
export const hpFloatNumberSeat = css`
  top: 38%;
  font-size: 26px;
  font-family: inherit;
  --hp-float-glow: 6px;
`;
export const hpFloatDamage = css`
  color: #ff4d4f;
  text-shadow:
    0 0 var(--hp-float-glow, 8px) rgba(255, 34, 34, 0.7),
    0 1px 3px rgba(0, 0, 0, 0.9);
`;
export const hpFloatHeal = css`
  color: #52c41a;
  text-shadow:
    0 0 var(--hp-float-glow, 8px) rgba(82, 196, 26, 0.7),
    0 1px 3px rgba(0, 0, 0, 0.9);
`;
export const seatHealOverlay = css`
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 8px;
    pointer-events: none;
    animation: healOverlay 0.6s ease-out both;
  }
  position: relative;
`;
export const phaseAnimating = css`
  animation: phaseIn 0.35s ease-out both;
`;
export const turnGlowing = css`
  animation: newTurnGlow 0.8s ease-out both;
`;

// ─── 武将座位卡(PlayerSeatView 消费;自 PlayerSeatView.tsx 原样迁入) ───
// 与 GameView 消费的大卡目标选择态(seatCardClickable/seatCardTargeted)同名冲突的
// 条目已改名:seatCardTargetable / seatCardTargetPulse / seatCardDamageOverlay /
// seatCardHealOverlay(大卡版 overlay 圆角 8px,座位卡版 6px 跟随卡圆角)。
// hpFlash/seatShaking/hpHealFlash/turnGlowing 与上方动画类完全一致,直接复用。

// 座位根:名牌(上) + 武将卡本体(中) + 小标签行(下) 的纵向组合
export const seatRoot = css`
  position: relative;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;
// 卡上方名牌:横向暗条,宽=卡宽。左:身份小方章 + 座号 + 玩家名,右:徽章组
export const seatNamePlate = css`
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  box-sizing: border-box;
  min-height: 22px;
  padding: 2px 6px;
  background: linear-gradient(rgba(26, 21, 14, 0.95), rgba(15, 12, 8, 0.92));
  border: 1px solid #3a3226;
  border-radius: 4px;
  transition:
    border-color 0.25s,
    box-shadow 0.25s;
`;
// 当前回合:名牌同步高亮(金边微光,与卡本体金绿辉光呼应)
export const seatNamePlateActive = css`
  border-color: #b28e4a;
  box-shadow: 0 0 8px rgba(255, 205, 92, 0.22);
`;
// 身份小方章 base:主公金/忠臣蓝/反贼红/内奸紫;未揭示时暗章「暗」
// (身份→样式映射的共享逻辑见 utils/characterVisuals 的 identityStampClass)
export const seatIdentityStamp = css`
  flex-shrink: 0;
  min-width: 22px;
  text-align: center;
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: bold;
  line-height: 1.5;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.5);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
`;
export const seatIdentityLord = css`
  background: #d4a017;
  color: #3a2400;
`;
export const seatIdentityLoyalist = css`
  background: #3f6fb5;
  color: #fff;
`;
export const seatIdentityRebel = css`
  background: #b03a30;
  color: #fff;
`;
export const seatIdentityRenegade = css`
  background: #8e5aa8;
  color: #fff;
`;
export const seatIdentityHidden = css`
  background: #4a463d;
  color: #b9b2a0;
`;
// 座号小徽章
export const seatIndexBadge = css`
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.55);
  border-radius: 3px;
  padding: 1px 4px;
  font-size: 9px;
  font-weight: normal;
  line-height: 1.5;
`;
// 玩家名:白字粗体,超出省略
export const seatName = css`
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: bold;
  color: rgba(255, 255, 255, 0.92);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
`;
// 名牌右侧徽章组
export const seatBadgeGroup = css`
  display: flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
`;
export const youBadge = css`
  background: rgba(52, 152, 219, 0.92);
  border-radius: 3px;
  padding: 1px 4px;
  font-size: 9px;
  color: #fff;
  font-weight: bold;
  line-height: 1.5;
`;
export const turnBadge = css`
  background: #d4a017;
  border-radius: 3px;
  padding: 1px 4px;
  font-size: 9px;
  color: #241a04;
  font-weight: bold;
  line-height: 1.5;
`;
// 连环徽章:铁灰底 + 铁链图标,标示横置(铁索连环)状态
export const chainBadge = css`
  display: inline-flex;
  align-items: center;
  background: linear-gradient(135deg, #6b8294, #9bb3c4);
  border: 1px solid #b9cdd9;
  border-radius: 3px;
  padding: 1px 4px;
  font-size: 10px;
  color: #fff;
  font-weight: bold;
  line-height: 1.5;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
`;
// 离线角标:灰底,标示该玩家 SSE 已断开(重连宽限期内)
export const offlineBadge = css`
  background: #7a7a7a;
  border: 1px solid #9a9a9a;
  border-radius: 3px;
  padding: 1px 4px;
  font-size: 9px;
  color: #fff;
  font-weight: bold;
  line-height: 1.5;
`;
// 卡本体包裹层:relative 锚点(体力珠列/漂浮数字挂载点)
export const seatCardWrap = css`
  position: relative;
  width: 100%;
  flex: 0 0 auto;
`;
// 卡本体:竖版立绘卡。细金铜描边(1px #8a7448)+ 外圈 1px 深色,圆角 6px;
// 高度统一 --hero-card-h,宽度撑满 seatArcSlot(= 卡高 × 15/19,与立绘 750×950 同比例)
export const seatCard = css`
  position: relative;
  box-sizing: border-box;
  height: var(--hero-card-h);
  width: 100%;
  border: 1px solid #8a7448;
  border-radius: 6px;
  overflow: hidden;
  background: #14110c;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.6),
    0 6px 18px rgba(0, 0, 0, 0.45);
  transition:
    box-shadow 0.25s,
    border-color 0.25s,
    opacity 0.25s;
`;
// 当前回合:金绿双层辉光边框 + 金色描边呼吸(与名牌高亮联动)。
// activeSeatPulse 关键帧只动 outline-color(几何不变),叠加在静态 box-shadow 上;
// 视角玩家自己的座位不进弧形座位环(SeatArcLayout 只渲染 slice(1)),seatCardPerspective
// 蓝色 outline 不会与这里的金色 outline 同卡共存。若座位同时被选为目标,
// seatCardTargetPulse 的 animation 声明在文件更靠后,优先于此处的呼吸动画。
export const seatCardActive = css`
  border-color: #d4a048;
  outline: 2px solid rgba(255, 215, 0, 0.95);
  outline-offset: 2px;
  animation: activeSeatPulse 2s ease-in-out infinite;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.6),
    0 0 16px rgba(255, 205, 92, 0.45),
    0 0 32px rgba(110, 190, 100, 0.22),
    inset 0 0 12px rgba(255, 210, 100, 0.1);
`;
// 视角玩家:蓝色环(outline 与 box-shadow 辉光正交,可叠加)
export const seatCardPerspective = css`
  outline: 2px solid rgba(52, 152, 219, 0.7);
  outline-offset: 1px;
`;
// 死亡:立绘 grayscale(见 seatCharImgDead)+ 卡面「亡」印章,整体轻降不透明度
export const seatCardDead = css`
  opacity: 0.72;
`;
// 可点选目标:hover 红边提示(大卡同款交互见上方 seatCardClickable)
export const seatCardTargetable = css`
  cursor: pointer;
  &:hover {
    border-color: #e05545;
    box-shadow:
      0 0 0 1px rgba(0, 0, 0, 0.6),
      0 0 14px rgba(231, 76, 60, 0.45);
  }
`;
// 横置(铁索连环):铁灰冷色调边框 + 铁链光泽脉冲(立绘同步降饱和,见 seatCharImgChained)
export const seatCardChained = css`
  border-color: #8aa6b8;
  animation: chainPulse 1.8s ease-in-out infinite;
`;
// 被选为目标:红色脉冲边框(定义最靠后,目标态优先于回合金边/铁索冷光;
// 大卡同款交互见上方 seatCardTargeted)
export const seatCardTargetPulse = css`
  border-color: #e05545;
  animation: seatTargetPulse 1.2s ease-in-out infinite;
`;
// 武将立绘:绝对定位填满卡面;无素材/404 时回退势力色背景。
// ::after 暗化蒙版:立绘缺失时避免高饱和势力色平铺刺眼(官方立绘本身带暗调),
// 有立绘时蒙版同时压暗图底,保证左缘竖带/角标文字可读。
export const seatCharImgWrap = css`
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  background: var(--faction-color, rgba(0, 0, 0, 0.5));

  &::after {
    content: '';
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse 120% 90% at 50% 30%, transparent 40%, rgba(8, 6, 3, 0.5) 100%),
      linear-gradient(rgba(10, 8, 5, 0.34), rgba(10, 8, 5, 0.18));
  }
`;
// 无立绘素材的武将(回退势力色平铺):整层降饱和压亮,呈暗调势力色牌而非高饱和色块
export const seatCharImgWrapEmpty = css`
  filter: saturate(0.5) brightness(0.62);
`;
export const seatCharImg = css`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;
`;
export const seatCharImgDead = css`
  filter: grayscale(1) brightness(0.7);
`;
// 横置(铁索):立绘铁灰冷色调(降饱和压亮),与边框 chainPulse 呼应
export const seatCharImgChained = css`
  filter: saturate(0.45) brightness(0.92);
`;
// 选目标阶段距离角标:卡内左下角小暗章「距 N」,与手牌数角标(右下)对称
export const seatDistanceBadge = css`
  position: absolute;
  left: 3px;
  bottom: 3px;
  z-index: 2;
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: bold;
  color: #bcd0f5;
  background: rgba(20, 22, 34, 0.78);
  border: 1px solid rgba(150, 170, 220, 0.35);
  pointer-events: none;
`;
// 卡内左缘竖带:自上而下渐变暗带(rgba(0,0,0,.62)→透明),宽约 26px
export const seatSideBand = css`
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  z-index: 2;
  width: 26px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 7px 0 9px;
  background: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0.62) 0%,
    rgba(0, 0, 0, 0.42) 60%,
    rgba(0, 0, 0, 0.08) 100%
  );
`;
// 势力印章:18px 方块,势力色底 + 金字(魏/蜀/吴/群)
export const seatFactionStamp = css`
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  border: 1px solid rgba(240, 215, 138, 0.4);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.15),
    0 1px 3px rgba(0, 0, 0, 0.5);
  font-size: 10px;
  font-weight: bold;
  color: #f0d78a;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.7);
`;
// 竖排武将名:vertical-rl + upright,金白粗体带深色描边
export const seatCharName = css`
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  writing-mode: vertical-rl;
  text-orientation: upright;
  font-weight: bold;
  font-size: 13px;
  letter-spacing: 3px;
  color: #f3e6c2;
  text-shadow:
    1px 0 2px rgba(0, 0, 0, 0.9),
    -1px 0 2px rgba(0, 0, 0, 0.9),
    0 1px 2px rgba(0, 0, 0, 0.9),
    0 -1px 2px rgba(0, 0, 0, 0.9);
`;
// 竖带底部体力数字(当前体力):红色粗体;伤害/回复红/绿闪烁挂在此处
export const seatHpNumber = css`
  flex-shrink: 0;
  display: inline-block;
  line-height: 1;
  font-size: 16px;
  font-weight: 900;
  color: #ff5f52;
  text-shadow:
    0 1px 2px rgba(0, 0, 0, 0.85),
    0 0 6px rgba(255, 60, 40, 0.45);
`;
// 手牌数角标:卡内右下角小暗章「🂠 N」
export const seatHandBadge = css`
  position: absolute;
  right: 4px;
  bottom: 4px;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid rgba(138, 116, 72, 0.5);
  color: #e8c47a;
  font-size: 10px;
  font-weight: bold;
  line-height: 1.4;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
`;
// 死亡印章:旋转红字方印盖在卡面(立绘同时 grayscale)
// 有身份时两行「身份/阵亡」(对齐官方「反贼/阵亡」印),无身份时单字「亡」
export const seatDeadStamp = css`
  position: absolute;
  top: 42%;
  left: 50%;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  transform: translate(-50%, -50%) rotate(-10deg);
  padding: 4px 8px;
  border: 3px solid rgba(200, 40, 34, 0.85);
  border-radius: 6px;
  background: rgba(20, 6, 4, 0.38);
  color: rgba(226, 56, 48, 0.94);
  font-size: 21px;
  font-weight: 900;
  line-height: 1.15;
  letter-spacing: 3px;
  text-indent: 3px; /* 抵消 letter-spacing 造成的偏移 */
  text-shadow: 0 0 10px rgba(180, 30, 24, 0.6);
  pointer-events: none;

  & > i {
    font-style: normal;
    white-space: nowrap;
  }
`;
// 右缘体力珠列:垂直排列,骑在卡右边框上(right: -5px = 半珠宽);z-index 与大卡珠列分层。
// 珠体 span、分色与尺寸缩放统一由共享组件 HpBeadColumn 渲染(满珠/空珠样式为大卡共用的
// gameViewStyles playerCardHpBeadFull/playerCardHpBeadEmpty,分色经 --bead-* 变量注入)。
export const seatHpBeadCol = css`
  position: absolute;
  right: -5px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 4;
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
`;
// 卡下小标签行容器
export const seatLabelCol = css`
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
`;
// 装备行:暗条 chip + 图标 + 牌名 + 花色点数(如 ⚔贯石斧5♦)
export const equipRow = css`
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  & > span {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    max-width: 100%;
    overflow: hidden;
    font-size: 10px;
    color: #ecd9a8;
    background: rgba(12, 10, 7, 0.72);
    border: 1px solid rgba(138, 116, 72, 0.4);
    border-radius: 3px;
    padding: 1px 6px;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  }
`;
// 判定行(延时锦囊):紫边 chip
export const judgeRow = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
  font-size: 10px;
`;
export const judgeRowLabel = css`
  color: #c9a2ff;
  font-weight: bold;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
`;
export const judgeTag = css`
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid #8e6cc8;
  color: var(--suit-color, #ccc);
  background: rgba(24, 16, 34, 0.78);
  font-weight: bold;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.65);
`;
// 技能 chips:暗底金字小圆角
export const skillRow = css`
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
`;
export const skillTag = css`
  display: inline-block;
  background: rgba(10, 8, 6, 0.68);
  border: 1px solid rgba(138, 116, 72, 0.42);
  border-radius: 3px;
  padding: 1px 6px;
  font-size: 10px;
  color: #e8c47a;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
`;
// 原始标记行(链式标记已由卡面表达,其余以小灰字展示)
export const markRow = css`
  font-size: 10px;
  color: #777;
  padding: 0 2px;
`;
export const markTag = css`
  margin-right: 6px;
`;
// 选目标时不可选的座位置灰(距离外/不满足槽位条件),与可选座位形成视觉对比
export const seatCardUntargetable = css`
  opacity: 0.4;
  filter: grayscale(0.8);
  cursor: not-allowed;
`;
// 断线座位置灰(与死亡置灰区分:断线保持立绘可见,仅降透明度)
export const seatCardDisconnected = css`
  opacity: 0.6;
`;
// 座位卡伤害蒙层(挂 seatCardWrap):圆角 6px 跟随座位卡;大卡版见上方 seatDamageOverlay(8px)
export const seatCardDamageOverlay = css`
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 6px;
    pointer-events: none;
    animation: damageOverlay 0.6s ease-out both;
  }
  position: relative;
`;
// 座位卡回血蒙层(挂 seatCardWrap):圆角 6px 跟随座位卡;大卡版见上方 seatHealOverlay(8px)
export const seatCardHealOverlay = css`
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 6px;
    pointer-events: none;
    animation: healOverlay 0.6s ease-out both;
  }
  position: relative;
`;
