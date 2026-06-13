// src/engine/skills/index.ts
// 技能模块懒加载表：通过 import() 按需加载，不再需要 registerSkillModule 注册
import type { SkillModule } from '../skill';

export const skillLoaders: Record<string, () => Promise<SkillModule>> = {
  // 基础
  '开局': () => import('./开局').then(m => m.default),
  '杀': () => import('./杀').then(m => m.default),
  '闪': () => import('./闪').then(m => m.default),
  '桃': () => import('./桃').then(m => m.default),
  '酒': () => import('./酒').then(m => m.default),
  '仁德': () => import('./仁德').then(m => m.default),
  '激将': () => import('./激将').then(m => m.default),
  '护甲': () => import('./护甲').then(m => m.default),
  '制衡': () => import('./制衡').then(m => m.default),
  '武圣': () => import('./武圣').then(m => m.default),
  '遗计': () => import('./遗计').then(m => m.default),
  '回合管理': () => import('./回合管理').then(m => m.default),
  '八卦阵': () => import('./八卦阵').then(m => m.default),
  '流离': () => import('./流离').then(m => m.default),
  '南蛮入侵': () => import('./南蛮入侵').then(m => m.default),
  '万箭齐发': () => import('./万箭齐发').then(m => m.default),
  '决斗': () => import('./决斗').then(m => m.default),
  '反馈': () => import('./反馈').then(m => m.default),
  // 武器
  '诸葛连弩': () => import('./诸葛连弩').then(m => m.default),
  '青釭剑': () => import('./青釭剑').then(m => m.default),
  '青龙偃月刀': () => import('./青龙偃月刀').then(m => m.default),
  '雌雄双股剑': () => import('./雌雄双股剑').then(m => m.default),
  '贯石斧': () => import('./贯石斧').then(m => m.default),
  '丈八蛇矛': () => import('./丈八蛇矛').then(m => m.default),
  '方天画戟': () => import('./方天画戟').then(m => m.default),
  '寒冰剑': () => import('./寒冰剑').then(m => m.default),
  // 防具/延时锦囊
  '仁王盾': () => import('./仁王盾').then(m => m.default),
  '藤甲': () => import('./藤甲').then(m => m.default),
  '白银狮子': () => import('./白银狮子').then(m => m.default),
  '乐不思蜀': () => import('./乐不思蜀').then(m => m.default),
  // 即时锦囊
  '过河拆桥': () => import('./过河拆桥').then(m => m.default),
  '顺手牵羊': () => import('./顺手牵羊').then(m => m.default),
  '无中生有': () => import('./无中生有').then(m => m.default),
  '桃园结义': () => import('./桃园结义').then(m => m.default),
  '借刀杀人': () => import('./借刀杀人').then(m => m.default),
  '无懈可击': () => import('./无懈可击').then(m => m.default),
  // 通用
  '装备通用': () => import('./装备通用').then(m => m.default),
};
