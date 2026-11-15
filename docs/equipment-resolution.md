# 装备结算与事件编排手册

> 本文是运行时的权威参考：每件装备挂在**哪个时点**、结算入口在哪、与其他结算如何交叉、重叠时谁生效。
> 规则数值与设计意图见 `DESIGN.md` §6；改动结算顺序前先读本文与对应源码，改完跑 `npm test` + `npm run coverage`。
> 术语沿用 BANG!/三国杀对照：武器区≈射程、±1 马≈距离槽、防具/宝物≈产品槽（一次一张）。

## 0. 总原则

1. **槽位唯一**：每名玩家的 `equipment` 是四槽表 `weapon / distance_in / distance_out / product`（`rules.js` 的 `EQUIPMENT_SLOTS`）。同槽替换时旧装备**进弃牌堆**，不销毁、不叠放。
2. **效果三分类**：
   - **静态修正**：不触发事件，随规则函数惰性求值（射程、距离修正、手牌上限、不限指控）。
   - **触发类**：玩家主动发动，走 `decide(play_action)` 里的 `task` 行动，按**能力 id** 记账（`player.taskUses`），每回合每种一次。
   - **替代类**：在某个响应窗口把一种结算替换成判定，**只结算一次**。
3. **替代类不叠加、修正类可叠加**：RLHF 对齐与 Constitutional AI 共用同一个判定选项（只判定一次）；距离/手牌修正则「装备 + 角色技能」逐项累加（同三国杀「马术与 ±1 马叠加」）。
4. **挂牌不是装备**：`监管问询`（`player.jail`）与 `AGI 宣言`（`player.dynamite`）是持续牌，走玩家身上的独立字段与**判定阶段**，不占 `equipment` 槽位。UI 应将两者分区展示。

## 1. 时点总表（回合主轴）

| 时点 | 触发的装备/挂牌结算 | 引擎入口 |
|---|---|---|
| 回合开始 | 清空 `attacksThisTurn` 与 `taskUses` | `runTurn`（`game.js`） |
| 判定阶段 | `AGI 宣言`：翻判定，♠2–9 引爆（失去 3 点算力，本回合结束）；未引爆传给下一名 | `judgmentPhase` |
| 判定阶段 | `监管问询`：翻判定，命中花色则**跳过摸牌与出牌阶段** | `judgmentPhase` |
| 摸牌阶段 | 无装备挂钩（角色技能在此改数量/来源） | `drawPhase` |
| 出牌阶段 | 六种产品主动技（除 Chat 外）逐次发动；装备牌打出进入槽位 | `playPhase` → `effects.playCard` |
| 出牌阶段·指控结算 | 端侧小模型（不限次数）、射程由武器决定 | `rules.attacksLeft/rangeOf` |
| 防御响应 | RLHF 对齐（替代判定）、Grok-2 使对方需 2 张声明 | `combat.offerDefense` |
| 弃牌阶段 | Chat 产品：手牌上限 = 算力 + 2 | `rules.handLimit` |
| 回合结束 | （无装备；豆包「3 = 1+1」是技能） | `runTurn` 末尾 |

## 2. 判定（judge）体系

判定用途 id（下发给 AI 与 UI）：`dynamite`（AGI 宣言）/ `jail`（账号封禁）/ `alignment`（对齐判定）/ `gamble`（榜单刷分）。
`game.judge(player, purpose)` 翻开牌堆顶，发 `judge` 事件后进弃牌堆。判定牌花色即结果；Mixtral/Gemma 等角色技能在 `judge` 内部改写取牌方式，装备不参与。

## 3. 逐装备结算卡片

### 静态修正类（无事件、惰性求值）

| 装备 | 求值点 | 实现 |
|---|---|---|
| Code Agent / 推理集群 / 多模态基座 / 全栈云平台 | 任何射程校验时 | `rules.rangeOf`（读 `weapon.params.range`） |
| 端侧小模型 | 指控次数校验时 | `rules.unlimitedAttacks`（`weapon.params.unlimitedAttacks`） |
| 长上下文 1M（`distance_in`） | 每次算距离时 | `rules.effectiveDistance`：`to.distance_in` +1 |
| 专有分发渠道（`distance_out`） | 每次算距离时 | `rules.effectiveDistance`：`from.distance_out` −1 |
| Chat 产品 | 弃牌阶段与 UI 提示 | `rules.handLimit`：`product.params.handLimitBonus` |

> 距离修正与角色技能（Llama「许可护城河」+1、Gemini「超长上下文」−1）**叠加**。

### 触发类（产品槽主动技，每回合每种一次）

发动入口：`legalActions` 提供 `kind:'task'` 行动 → `effects.activateTask`，先 `taskUses[能力id] += 1` 再结算，**先记账后结算**（结算中途不会二次发动）。

| 产品 | 能力 id | 结算要点 |
|---|---|---|
| Code 产品 | `code` | 弃 1 张 → 视为指控：`attacksThisTurn++`、走完整 `resolveAttack`（会触发濒死/救援），仍受射程与指控次数限制 |
| 办公套件 | `office` | 弃 2 张 → 回 1 算力（`heal`，触发 heal 事件） |
| TTS | `tts` | 指定玩家随机公开一张手牌（`reveal` 事件）；是指控则归发动者，否则退回原主（Qwen 的手牌归零补牌在 `afterHandChange` 触发） |
| STT | `stt` | 看牌堆顶 2 张，`ordered` 选择后放回（**第一张先被摸到**，与 Kimi「放回」语义一致以 `ordered` 表达） |
| 图生图 ITI | `iti` | **先**取走弃牌堆顶、**再**弃手牌（顺序不能反，否则刚弃的牌立刻回到手里） |

### 替代类

| 效果 | 窗口 | 裁定 |
|---|---|---|
| RLHF 对齐（装备） | `offerDefense` 防御响应 | 与角色技能 Constitutional AI **共用一个「进行对齐判定」选项**，判定 ♥ 生效；只判定一次，无成功率叠加 |
| Constitutional AI（Claude 技能） | 同上 | 同上（与装备互斥为同一选项，不是两个选项） |

### 装备的进入、替换与离开

- **进入**：出牌阶段打出装备牌 → `effects.playCard` 按 `kind:'weapon/distance/product'` 落槽，发 `equip` 事件。产品槽被占时 `legalActions` 不提供该行动；直接调用结算（如测试）则按同槽替换处理。
- **同槽替换一律进弃牌堆**：任何把装备落进已占用槽位的路径——打出装备、挖角研究员偷取（`effects.js` steal 分支）、Sora「数据回收」接管死者装备（`eliminate` 的 loot）——被顶掉的旧装备都必须 `toDiscard`，不允许静默消失。
- **被夺/被弃**：`挖角研究员`（steal）与 `律师函 C&D`（force_discard）把「手牌或任一槽位装备」作为选项下发（`slot:<槽名>`）；AI 按 `weapon > distance_out > distance_in > product` 的偏好抢夺。
- **出局**：装备留在出局者身上直至被 Sora「数据回收」接管或击杀惩罚清空（`EQUIPMENT_SLOTS` 全槽置 null）。
- **实验室误杀惩罚**：弃全部手牌 + 全部四槽装备（`combat.js` 的 killer 结算）。

## 4. 一次指控的完整事件流（装备挂点标注）

```
play(指控)                     # 攻击者打出；端侧小模型在此前由 attacksLeft 放行
 → attack(source, target)      # Grok-2 在此把 needed 置 2
 → select(defense_response)    # 目标的响应窗口：声明牌 / RLHF·Constitutional 判定 / 放弃
 → judge(alignment)?           # 若走判定替代；♥ 生效
 → damage                      # 未被抵消时；伤害来源记入 relation
 → dying → select(rescue)      # 融资到账自救 / 他人救援
 → eliminated → loot?          # Sora 在此接管手牌与四槽装备
```

UI 消费事件时注意：`select` 请求里已带 `sourceIndex / needed / remaining`（见 `docs/ui-audit.md` §3-R）。

## 5. 改装备相关代码时的检查清单

1. `rules.js`：槽位常量、`productCard` / `taskUsesLeft` / 修正函数。
2. `cardTypes.json`：`kind` 与 `slot` 必须一致落在四槽词表内（产品类均为 `product`）→ `npm run build:deck`。
3. `effects.js`：落槽分支与 `activateTask` 各 case；**先记账后结算**。
4. `game.js`：`legalActions`（产品槽被占不发行动）、`JUDGE_LABELS`（新判定用途要同时给 AI 加 `judgeScore` 分支）。
5. `heuristic.js`：`BASE_VALUE.kind`、`TASK_VALUE.typeId`、`chooseSteal` 偏好序。
6. UI 最小适配：`intent.js` 的 `SLOT_LABEL`、`input.js` 不可用提示的 kind case。
7. 测试：`mechanics.test.js` 的槽位/Task 用例、`coverage.mjs` 的 kind 统计（从 cardTypes 取，勿再从 deck.json 取）。
