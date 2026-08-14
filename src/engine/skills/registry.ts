// src/engine/skills/registry.ts — 技能模块声明聚合(单一事实来源)。
//
// 取代旧 skills/index.ts 的 312 条手写 loader 表:每个技能由它的归属方就近声明,
// 本文件在运行时聚合出 skillId → moduleSpec 映射,loaders.ts 按 spec 动态加载。
// 漂移由 tests/engine/contract.test.ts 的 meta-tests 兜底(声明文件存在/双射/
// 模块形状/skills 目录反向覆盖)。
//
// 声明来源(四类,详见下方各常量):
//   1. 武将技  data/characters/*.ts 的 skills: [{ name, path? }]
//   2. 装备技  data/card-defs/equipment.ts 的 装备牌列表(卡名即 skillId)+ 马匹例外表
//   3. 系统技  SYSTEM_SKILL_SPECS(与 atoms/选将.ts DEFAULT_SKILLS 的一致性由 meta-test 保证)
//   4. 衍生技  DERIVED_SKILL_SPECS(运行时由其他技能通过 添加技能 atom 动态授予)
//
// moduleSpec 语法(相对 src/engine/,无扩展名):
//   'skills/龙胆'            → skills/龙胆.ts 模块本身(default 形态:模块即 SkillModule)
//   'skills/cards/use-card'  → 子目录模块
//   'skills/马匹技能#赤兔'    → skills/马匹技能.ts 的命名导出 赤兔(多技能共享一个模块)
//
// 依赖方向:registry 只依赖 data/ 与 types/,不依赖 core/atoms/skills 内其他模块,
// 保证不引入新的模块环(现有 core/index → skills/lifecycle → skills/registry → data 链单向)。

import { allCharacters } from '../data/characters/index';
import { 装备牌列表, EQUIPMENT_SKILL_MODULE_SPECS } from '../data/card-defs/equipment';

/** 武将技能声明的字段形态(data/characters/*.ts 的 skills 数组元素) */
interface CharacterSkillRef {
  name: string;
  path?: string;
}

interface CharacterSource {
  name: string;
  skills: CharacterSkillRef[];
}

/** 系统技能:不属于任何武将/装备,每局由 bootstrap/开局流程注册。
 *  与 atoms/选将.ts 的 DEFAULT_SKILLS 保持一致(该表按卡名/技能 id 实例化);
 *  一致性由 contract.test.ts 的 meta-test 断言,此处不 import atoms 以避免模块环。 */
const SYSTEM_SKILL_SPECS: Readonly<Record<string, string>> = {
  回合管理: 'skills/回合管理',
  装备通用: 'skills/装备通用',
  使用牌: 'skills/cards/use-card',
  打出牌: 'skills/cards/play-card',
  // 铁索连环的重铸 action 与部分逻辑无法纳入 CardEffect 注册表,以独立技能实例存在
  // (详见 atoms/选将.ts DEFAULT_SKILLS 内注释)。
  铁索连环: 'skills/铁索连环',
  // 开局 由 core/index.ts bootstrap 按 id 实例化(skillId='开局', owner=SYSTEM_OWNER)
  开局: 'skills/开局',
  // 护甲:OL 护甲系统(界矢北等技能的通用护甲机制)
  护甲: 'skills/护甲',
};

/** 衍生技:不写在任何武将的静态 skills 里,由其他技能运行时通过 添加技能 atom 授予。 */
const DERIVED_SKILL_SPECS: Readonly<Record<string, string>> = {
  // 界潜心(界徐庶)觉醒后永久获得
  界荐言: 'skills/界荐言',
  // 勤学(界吕蒙)觉醒后获得
  攻心: 'skills/攻心',
};

/** path 缺省规则:技能名即模块文件名(skills/<name>.ts)。 */
function defaultSpec(skillId: string): string {
  return `skills/${skillId}`;
}

/** spec 归一化为引擎根相对路径(如 'skills/龙胆')。
 *  武将文件里的 path 相对武将文件本身(保持 IDE 可跳转的语义);
 *  data/characters/*.ts 深度固定,前导 '../../' 直达引擎根,
 *  故剥掉前导 '../' 序列即得引擎根相对 spec。
 *  path 深度写错由 meta-test 的磁盘存在性校验兜底。 */
function normalizeSpec(spec: string): string {
  return spec.replace(/^(?:\.\.\/)+/, '');
}

/**
 * 聚合全部技能声明,构建 skillId → moduleSpec 映射。
 * 纯函数,每次调用重建(166 武将遍历为微秒级,不值得引入模块级缓存状态)。
 * 同一 id 被多处声明且 spec 一致时幂等(如 标左慈/界左慈 共享 '化身');
 * spec 冲突视为数据错误,立即抛出。
 */
export function buildSkillModuleSpecs(): ReadonlyMap<string, string> {
  const specs = new Map<string, string>();

  const add = (id: string, rawSpec: string, source: string) => {
    const spec = normalizeSpec(rawSpec);
    const existing = specs.get(id);
    if (existing !== undefined && existing !== spec) {
      throw new Error(
        `技能 "${id}" 声明冲突: ${source} 声明 ${spec},但已有 ${existing}`,
      );
    }
    specs.set(id, spec);
  };

  for (const ch of allCharacters as CharacterSource[]) {
    for (const ref of ch.skills) {
      add(ref.name, ref.path ?? defaultSpec(ref.name), `武将 ${ch.name}`);
    }
  }

  for (const card of 装备牌列表) {
    add(card.name, EQUIPMENT_SKILL_MODULE_SPECS[card.name] ?? defaultSpec(card.name), `装备 ${card.name}`);
  }

  for (const [id, spec] of Object.entries(SYSTEM_SKILL_SPECS)) add(id, spec, '系统技能');
  for (const [id, spec] of Object.entries(DERIVED_SKILL_SPECS)) add(id, spec, '衍生技');

  return specs;
}

/** 查询技能 id 的模块 spec;未声明返回 undefined。 */
export function getSkillModuleSpec(id: string): string | undefined {
  return buildSkillModuleSpecs().get(id);
}

/** 技能 id 是否有声明(取代旧 `id in skillLoaders` 检查)。 */
export function hasSkillModule(id: string): boolean {
  return buildSkillModuleSpecs().has(id);
}
