# 音效资源目录

本目录(已迁移至 `public/packs/base/sound/`)存放游戏音效文件。

## 目录结构

```
public/packs/base/sound/
  flip.mp3              ← 通用卡牌操作拟声(摸牌/弃牌/判定…)
  shuffle.mp3           ← 重洗
  card_place.mp3        ← 整理牌堆
  heal.mp3              ← 回复体力
  lose_health.mp3       ← 失去体力
  death.mp3             ← 角色死亡
  equip.mp3             ← 装备
  unequip.mp3           ← 卸下装备
  chain.mp3             ← 铁索连环/加标记/去标记
  turn_start.mp3        ← 回合开始
  turn_end.mp3          ← 回合结束
  phase_start.mp3       ← 阶段开始
  phase_end.mp3         ← 阶段结束
  card/                 ← 牌名语音(使用/打出时按牌名播报)
    杀.mp3  闪.mp3  桃.mp3  酒.mp3
    无中生有.mp3  过河拆桥.mp3  顺手牵羊.mp3
    无懈可击.mp3  乐不思蜀.mp3  闪电.mp3  兵粮寸断
    决斗.mp3  南蛮入侵.mp3  万箭齐发.mp3
    桃园结义.mp3  五谷丰登.mp3  借刀杀人.mp3
    铁索连环.mp3  火攻.mp3  知己知彼.mp3
```
标准牌堆所有基本牌+锦囊牌(共 20 张)均有语音。

## 设计原则

- **使用/打出时**(使用/打出牌):按牌名播报语音(`sound/card/{牌名}`)
- **底层操作**(摸牌/弃牌/获得…):统一用 `flip` 短促拟声
- **目标/技能添加/移除/询问**:无音效(UI 视觉反馈即可)
- 无对应语音文件的牌(如桃/南蛮入侵)→ audioEngine 静默跳过,后续可补音频

## 添加新牌名语音

1. 将音频文件放入 `public/packs/base/sound/card/{牌名}.mp3`（可用 QSanguosha `audio/card/male|female/{en}.ogg` 经 ffmpeg 转 mp3）
2. 在 `public/packs/base/manifest.json` 的 resources 数组中添加:
   ```json
   { "id": "sound/card/{牌名}", "type": "audio" }
   ```
3. 使用时 atom 会自动按牌名播放,无需改代码

## 添加新通用音效

1. 将音频文件放入 `public/packs/base/sound/{标识符}.mp3`
2. 在 manifest.json 中声明 `sound/{标识符}`
3. 在对应 atom 的 `effect.sound` 中引用标识符

## 格式建议

- **推荐 mp3**:浏览器兼容性最佳
- **采样率**:22050Hz 或 44100Hz
- **时长**:通用拟声 ≤ 1s;牌名语音 ≤ 2s;回合/死亡等氛围音可稍长
- **声道**:单声道

## 缺失时的行为

文件未放入时,`audioEngine` 会:
1. 首次请求该标识符时 `fetch` 对应 URL
2. 收到 404 后缓存"missing"状态
3. 后续不再重试(避免重复请求)
4. 控制台**不输出**任何 error/warn(静默跳过)

因此即使没有任何音频文件,游戏也能正常运行,只是没有声音。
