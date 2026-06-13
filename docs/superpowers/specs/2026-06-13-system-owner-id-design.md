# System Owner ID 约定设计

> 用保留字面量 `'系统'` 作为 system skill 的 ownerId,替换当前借玩家名 `'主公'` 的占位写法,为后续所有 system skill(开局、游戏结束、模式切换、debug 重开等)统一命名空间。

**日期**: 2026-06-13
**状态**: 设计完成,待用户 review
**前置依赖**:
- `src/engine/skills/开局.ts` 当前实现
- `src/engine/create-engine.ts` bootstrap() 流程
- `src/engine/skill.ts` 注册表(`actionKey` / `instanceKey` / `registerActionEntry` / `findActionEntry` / `unregisterActionEntry` / `registerBeforeHook` / `registerAfterHook` / `setSkillInstanceUnload` / `unloadSkillInstance` / `clearAllSkillInstances`)

---

## 1. 目标与边界

### 1.1 目标

- 把 system skill 的 owner 在代码上明确化,不再借用 `'主公'` 这类**未来真实玩家可能持有的名字**
- 为后续 system skill 铺路:加新 system skill 时按同一约定走,ownerId 一律写 `'系统'`
- 一次到位——客户端无法以 `'系统'` 身份发起操作(由 WS 绑定的 ownerId 注入保证,详见 §4)

### 1.2 范围

**改**
- `src/engine/skills/开局.ts` —— `'主公'` 字面量全部替换为 `'系统'`,并提为局部 `SYSTEM_OWNER` 常量
- `src/engine/create-engine.ts` bootstrap() —— dispatch message 的 `ownerId` 改为 `'系统'`

**不改**
- 任何类型签名(`ActionEntry.ownerId: string`、`ClientMessage.ownerId: string`、`AtomHookEntry.ownerId: string` 等)
- 任何注册接口的参数列表(`registerActionEntry` / `registerBeforeHook` 等保持只接受 `string`)
- `findActionEntry` / `unregisterActionEntry` / `unloadSkillInstance` 等查找/清理逻辑(完全沿用)
- `actionKey` / `instanceKey` 的拼 key 格式(沿用 `${skillId}:${ownerId}:${actionType}`)
- `dispatch` 函数体(不增加任何校验,见 §4)
- 任何玩家 skill 文件(只动开局这个唯一的 system skill)

---

## 2. 设计

### 2.1 约定

- 字符串字面量 `'系统'` 是 **system ownerId 保留字**
- 该字面量只允许出现在 system skill 文件内部和 engine 的 bootstrap 路径
- Client wire 协议里 `ClientMessage.ownerId` 永远是真实玩家名(由 server 端 WS handler 注入绑定玩家名),不会等于 `'系统'`
- 类型系统**不**强制该约束(沿用 `ownerId: string`)——靠 grep 守卫 + 文档约束

### 2.2 关键代码改动

#### 2.2.1 `src/engine/skills/开局.ts`

文件顶部增加常量 + 注释说明:

```ts
/**
 * system 命名空间占位 ownerId。
 * 客户端永远不发这个值(WS handler 注入的 ownerId 是绑定玩家名),
 * engine 内部 dispatch 只在 bootstrap 路径用到它。
 */
const SYSTEM_OWNER = '系统';
```

四处替换 `'主公'` → `SYSTEM_OWNER`:

| 位置 | 当前 | 改后 |
|---|---|---|
| `createSkill('开局', ...)` 第二参 | `'主公'` | `SYSTEM_OWNER` |
| `entry.ownerId` | `'主公'` | `SYSTEM_OWNER` |
| `unregisterActionEntry('开局', ..., 'start')` 第二参 | `'主公'` | `SYSTEM_OWNER` |

#### 2.2.2 `src/engine/create-engine.ts` bootstrap()

```ts
const result = await dispatch(state, {
  skillId: '开局',
  actionType: 'start',
  ownerId: '系统',            // ← 原 '主公', 改保留字
  params: { ...gameConfig } as Record<string, Json>,
  baseSeq: 0,
});
```

`bootstrap` 上方加一行注释说明 `ownerId: '系统'` 来自 engine 内部而非 wire。

### 2.3 不加 server-side 校验

`dispatch()` 不增加 `if (message.ownerId === '系统') return { error }` 之类的检查。

**理由**:WS 协议下,每条 `ClientMessage` 由 server 端 WS handler 注入绑定玩家名后才进 `dispatch`,客户端篡改 `message.ownerId` 不会生效。攻击面不存在,防御性检查是死代码。

### 2.4 加新 system skill 的模板

任何后续 system skill 按同样约定:

```ts
// 1. ActionEntry
registerActionEntry({
  skillId: 'gameOver',
  ownerId: '系统',           // ← 保留字
  actionType: 'check',
  validate: (...) => null,
  execute: async (...) => { ... },
});

// 2. Hooks(若需要)
registerBeforeHook('gameOver', '系统', '击杀', async (ctx) => { ... });

// 3. Skill instance unload
setSkillInstanceUnload('gameOver', '系统', () => { ... });

// 4. 触发(只能来自 engine 内部,如 bootstrap / 其他 system skill 的 execute)
await dispatch(state, {
  skillId: 'gameOver',
  actionType: 'check',
  ownerId: '系统',           // ← 保留字
  ...
});
```

---

## 3. 验证

### 3.1 现有测试

下列测试应**继续通过**——行为无变化:

- `tests/integration/create-game.test.ts`
- `tests/integration/restore-from-log.test.ts`
- `tests/integration/server-gameplay.test.ts`
- `tests/integration/new-engine-hujia.test.ts`
- `tests/integration/new-engine-kill.test.ts`
- `tests/integration/new-engine-rende.test.ts`
- `tests/integration/new-engine-fire-timeout.test.ts`
- `tests/engine.test.ts`
- `tests/persistence.test.ts`
- `tests/state.test.ts`
- `tests/e2e-regression.test.ts`
- `tests/skill-tests/*.test.ts`(用到的)

### 3.2 手动验证

```bash
# 1. 跑全部测试,确保开局流程没破
pnpm test

# 2. typecheck(无类型签名变化,纯字面量替换,应无错)
pnpm typecheck

# 3. grep 守卫:除开局 + bootstrap 外,不应出现 '系统' 作为 ownerId 字面量
rg -n "ownerId: ['\"]系统['\"]" src/ | grep -v 'src/engine/skills/开局.ts' | grep -v 'src/engine/create-engine.ts'
# 期望:空输出

# 4. 旧 '主公' 字面量在 engine 代码内应不再出现(只可能在 _legacy/ 或技能文案里)
rg -n "['\"]主公['\"]" src/engine/ --type ts | grep -v '_legacy' | grep -v 'skills/激将' | grep -v '主公技'
# 期望:空输出
```

### 3.3 风险点确认

- ❓ 玩家名是否会取到 `'系统'`?——不会,`create()` 里 stubPlayers 命名是 `player-${i}`,bootstrap 后才被角色名/真实名替换
- ❓ `actionKey('开局', '系统', 'start')` 会不会和某个真玩家 actionKey 撞?——不会,玩家名格式 `player-N`,和 `'系统'` 不可能相同

---

## 4. 安全性

- 客户端无法以 `'系统'` 身份发起操作——WS handler 在每条消息到达 `dispatch` 前会注入绑定玩家名作为 `message.ownerId`,客户端篡改字段被覆盖
- server 不需要任何额外校验(详见 §2.3)
- 唯一风险点:engine 内部代码误用 `'系统'` 触发本不该 system 触发的 action——这属于代码 bug,靠 §3.2 的 grep 守卫和 code review 防住
