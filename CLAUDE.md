# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

DISTILL! 是纯静态的浏览器卡牌游戏：戏仿 BANG!，把「大模型蒸馏」争议映射为身份、手牌与装备。无框架、无 bundler、无运行时依赖，浏览器直接加载 ES module。全仓库的注释、测试名、UI 文案与文档均使用中文，新增内容请保持一致。

领域规则（身份、回合、卡牌、装备、数值与平衡实测）见 `DESIGN.md`；美术素材规范见 `ASSETS.md`。改规则或加卡牌前先读对应章节。

## 常用命令

```bash
npm run serve                  # 本地静态服务器 http://localhost:5173
npm test                       # node:test 全量测试（tests/*.test.js）
node --test tests/mechanics.test.js                                   # 单个测试文件
node --test --test-name-pattern "AGI 宣言" tests/mechanics.test.js    # 单个用例
npm run coverage               # 随机决策跑 300 局，统计每种牌型/角色机制是否触发
npm run build:deck             # data/cardTypes.json → data/deck.json（改牌面数据后必跑）
npm run assets:manifest        # 扫描 assets/ 与 data/，重写 assets/manifest.json
npm run build:dist             # 生成可部署的 dist/

node tests/bench-ai.mjs 5 300 heuristic   # AI 自对弈平衡基准：人数 局数 模式(heuristic|random|mixed)
node tests/diagnose.mjs 200 heuristic     # 按身份统计胜率/攻击/伤害/闪避/回血
```

脚本使用 `import.meta.dirname`，需要 Node ≥ 20.11。

## 架构

### 数据流

```
data/cardTypes.json ──npm run build:deck──> data/deck.json ─┐
data/characters.json                                        ├─> Game (src/engine)
data/roles.json ────────────────────────────────────────────┘
                                                                  │ decide() / onEvent()
                                                    ┌─────────────┴─────────────┐
                                             src/ai/heuristic.js          src/ui/app.js
                                             （AI 对手）                   （人类玩家 + DOM）
```

`data/cardTypes.json` 是设计面；`data/deck.json` 是生成物，只存每张牌的独立事实（`uid/typeId/suit/rank/flavor`），**牌型定义不重复保存**：引擎建局时按 `typeId` 从注册表水合（`Game.hydrateCard`），运行时卡牌对象依旧自描述。**不要手改 `deck.json`**：改 `cardTypes.json` 后重跑 `npm run build:deck`。构建脚本会校验 flavors 数量，并断言「AGI 宣言」引爆率落在 12%–20%，越界直接中止写入。角色数据以 `characters.json` 的 `skills[]` 为唯一来源（首项 = 主技能），不要回填顶层 `skill/mechanic/effect` 冗余字段；读取用 `rules.primarySkill` / `rules.hasMechanic`。

### 引擎（src/engine）

- `new Game({ deck, cardTypes, characters, roles, playerCount, seed, decide, onEvent, names })`，然后 `await game.run()` 打完一整局。人数限 4–7。
- 引擎不实现任何玩家，所有决策都经 `await decide({ player, request, view, rules })` 回调：
  - `request.type === 'play_action'`：返回 `request.actions` 中的一个行动对象（`play_card` / `task` / `character_ability` / `end_turn`）。
  - `request.type === 'select'`：返回 `{ ids: [...] }`，按 `request.purpose` 区分防御响应、濒死救援、弃牌、判定选牌、抢牌等。
- `view(player)` 是 AI 唯一的信息来源，未公开身份为 `null`。AI 只通过 `TableMemory` 消费引擎广播的 `relation` 事件推断敌我，**绝不能读取 `game.state` 里的隐藏身份**。新增敌对/友好效果时调用 `noteRelation(from, to, weight)`，否则 AI 感知不到。
- 事件流（`onEvent`）：`gameStart / turnStart / play / attack / damage / judge / draw / heal / dying / rescue / eliminated / loot / equip / reveal / relation / skill / log / gameOver / end`，事件附带 `state`。UI 动画与测试断言都依赖这些事件。
- `rules.js` 是纯函数规则层（距离、射程、手牌上限、攻击次数、Task 次数、胜负判定）。装备为四槽：`weapon / distance_in / distance_out / product`，产品槽一次一张（RLHF 对齐与六种 Task 产品共用，装新品即替换旧品；替代类效果与同名技能只结算一次，修正类可叠加）。`game.js` 只做对局编排（回合循环、阶段推进、合法行动、决策分发），战斗/生死结算在 `combat.js`、卡牌与主动产品结算在 `effects.js`——两者以 `(game, ...)` 自由函数实现，`Game` 类单行委托保持 API 稳定。`checkWinner` 中独狼「唯一存活」优先于「实验室已死」。
- 回合顺序：判定 → 摸牌 → 出牌 → 弃牌。`attacksThisTurn` 与 `taskUses` 在 `runTurn` 每回合重置。
- 角色可以有多个机制：`character.mechanic` 是主机制，`character.mechanics` 是完整数组（目前只有豆包 Seed 使用双技能）；`hasMechanic` 同时检查两者。
- 豆包 Seed 的「国民应用」由 `runTurnWithFollowUps` 编排：每名其他角色的正常回合结束后，插入一个 `skipJudgment: true` 的额外回合；额外回合不递归。它的「3 = 1+1」在 `runTurn` 末尾通过 `dealDamage` 结算，因此会正常触发濒死、救援和受伤事件。
- 卡牌在运行时自描述：建局时已按注册表水合，`typeOf(card)` 直接返回卡牌自身的 `kind/params`，所以 `rules.js` 无需查询牌型注册表；但 `deck.json` 文件本身是瘦卡，别假设文件里有牌型字段。
- 7 人局在 `buildDrawPile` 中额外洗入 4 张指控 + 4 张声明。
- 时间线（`timeline.js`）：一局 = 「状态 i —合法行动→ 状态 i+1」的确定性链条，seed + 决策转录唯一确定一局。`record/saveGame/resume/replay` 提供纯 JSON 存档（卡牌存瘦卡、静态表不入档）、从任意回合检查点续玩（转录耗尽后交给新 decide）与整局回放。恢复局的首个回合跳过回合前导（`atTurnStart`），`log()` 剔除 undefined 附加字段保证日志可 JSON 往返；测试见 `tests/timeline.test.js`。

### AI（src/ai）

- `createAi({ memory, roles, playerCount, rand })` 返回 `{ decide }`；每个 AI 持有独立的 `TableMemory`。
- `heuristic.js`：`buildContext` 组装公开信息与行为账本 → `scoreAction` 给合法行动打分（0 分基准 = 结束回合）→ `chooseSelection` 按 `purpose` 处理各类响应。
- 两条硬约束由 `tests/ai.test.js` 守护：授权被许可方绝不伤害实验室；蒸馏者存活期间独狼不攻击实验室。改评分函数时不要破坏。

### UI（src/ui）

- `app.js`：通用客户端（`bootDistillClient`）。不持有引擎、不 import AI/引擎，只消费协议三件套：`decide(ctx)`（本地座位走人机交互，其余交给入口注入的外部决策者）、`onEvent(e)`（事件流，驱动动画与公共元数据跟踪）、`view(seat)`（`getView` 注入，渲染唯一信息来源）。本家私有信息取 `view.you`，他人只有 `handCount` 与 revealed 后的身份。事件 → 动画见下方 motion。
- `src/demo.js`（入口层，不属于 src/ui）：单机 demo 编排入口——解析 `?seat/seed/players/autoplay/auto/mode/reduce` 参数、错误上报（`window.__distillErrors`）、创建 AI 与 Game 并把 decide/getView 注进客户端。默认 seat=0，其余座位 AI 托管；`?autoplay=1` 连本地座位一起托管（整局回归）。
- `project.js`：协议投影层（纯函数，可单测）。把 view 快照 + 事件流跟踪的公共元数据（当前回合/终局）整理成座位模型：算力图标三态（满/损/空，数量=maxCompute）、装备四槽→三显示位（武器/道具/马，distance_in/out 合并为「马」+1/-1）、立绘轴（满血 normal、残血 Q 版、缺图奶蛙兜底）、座位环以本家为正下方。
- `focus.js`：单一焦点弹窗仲裁（纯状态机，可单测）。交互窗（引擎 select 请求，强制）优先级高于检视窗（点座位卡的技能+装备说明）；交互窗可收起为待处理徽标，收起期间检视窗可占用弹窗；倒计时区域占位恒为「99天」。不再支持快进。
- `render.js`：keyed DOM。座位按 `player.index`、手牌按 `card.uid`、舞台按 item id 复用节点，**禁止全量重建**；卡面/座位卡（三国杀式：左下手牌数+算力图标、中立绘、装备区、位次编号、右上身份徽记「未公开」占位）/牌堆/行动条/焦点弹窗都在这里。
- `input.js`：指针状态机。拖手牌到座位、拖到中央直接使用、点击选牌 + 点座位、键盘 1–9/方向键/Enter/Esc、Tab 切换「当作指控 / 正常使用」。点空闲座位=检视弹窗；出牌阶段且已瞄准=点击提交攻击。
- `motion.js`：可等待、可降级（reduceMotion 时全部瞬时）的动画队列；`decide()` 前 `await drain()`，同一时刻至多一条主动画。固定句式动画：攻击=卡牌从来源飞向目标+光束、声明响应=斜插入场与攻击牌并排、摸牌=牌堆脉冲+牌背飞入座位、装备=飞入装备槽落槽、判定=从牌堆翻出翻转入场、伤害/回复/出局=浮字+震屏。
- `hints.js`：三档提示（新手/标准/专家），新手 coach mark 首次出现，`localStorage` 记忆。`intent.js` 是纯函数意图层（可单测），`assets.js` 处理 manifest/URL。
- 调试入口：`?auto=1&seed=23574&players=5&seat=3` 直接以 3 号位视角开局；`&autoplay=1&reduce=1` AI 托管整局（动画瞬时，回归用）。静态视觉预览：`/src/ui/preview.html?mode=targeting|actions|modal|inspect|gameover|intro`。
- 素材经 `assets/manifest.json` 索引：`status === 'ready'` 用专属图，否则用 `fallback` 通用徽记；manifest 缺失或加载失败时退回纯文字 UI。路径必须用 `new URL(path, document.baseURI)`，CSS 自定义属性里的相对 URL 基准不可靠。

### 素材与构建

- 角色立绘是位图：`assets/characters/<id>.png` 统一取自「角色立绘.zip」的 Q 版立绘（座位头像）；`assets/portraits/<id>.png` 是普通立绘，专供开场介绍页的角色墙，缺图走奶蛙占位；其余原稿存档于 `art/portraits/`，不进游戏构建。豆包 Seed 为自制形象，无专属立绘的角色用 `assets/generic/char_default.png`（自制奶蛙）兜底。旧生成式矢量管线（`scripts/build-art.mjs`）已移除，不要再生成 SVG 角色图。
- `npm run assets:manifest` 扫描 `assets/characters/<id>.{svg,png}`、`assets/cards/<id>.{svg,png}` 与 `assets/generic/`，结合 `data/` 三张表重写清单；**同名 SVG 优先于 PNG**（当前立绘全部为 PNG）。通用库是兜底而非占位：新增角色或牌型**不需要补图**，放专属图后自动变为 `ready`。
- `npm run build:dist` 只复制 `scripts/build-dist.mjs` 里的 `PUBLIC` 白名单 + `assets/` 到 `dist/`。**新增浏览器运行时文件（js/css/json）必须加入 `PUBLIC`**，否则线上 404。
- `dist/`、`vibe_images/`、`*.qoder.site` 已 gitignore；部署目标为 Qoder Sites。

## 改动时的连带点

- **调整已有卡牌数值/文案**：只改 `data/cardTypes.json` → `npm run build:deck` → `npm test`。
- **新增牌型**：`data/cardTypes.json` 加条目后，通常还要动 `legalActions`（何时可打出）、`effects.js` 的 `playCard`（结算分支）、`rules.js`（若影响距离/上限）、`heuristic.js` 的 `BASE_VALUE`/`scoreAction`（AI 估值）、`src/ui/intent.js` 的 `kindClass`/`SLOT_LABEL`（图标与标签）和 `src/ui/render.js` 的卡面渲染，并在 `tests/mechanics.test.js` 补用例。
- **新增角色机制**：`data/characters.json` 的 `mechanic` 字符串 → 在 `rules.js`/`game.js` 对应位置实现 → 用 `noteSkill(player, mechanic)` 上报实际触发（`tests/coverage.mjs` 据此统计覆盖率）→ 补测试。
- **平衡断言不是绊脚石**：牌堆攻防密度（指控 24%–34%、声明 18%–28%）、AGI 宣言引爆率（构建期 12%–20%）、AI 三方胜率区间都写成了测试。它们对应 `DESIGN.md` §10 记录的真实回退事故（调参时蒸馏者胜率曾达 71%、独狼仅 1.3%），调整数值前先读那一节，不要为了让测试变绿而直接放宽区间。
- **测试夹具**：`tests/mechanics.test.js` 的 `fixture()/setup()/card()` 直接改 `game.state` 与角色，配合 `noopDecide` 或脚本化 decider 精确触发单条规则。完整对局冒烟与批量校验用 `tests/helpers.js` 的 `makeRandomDecider`。

## 约定

- 没有 lint/格式化配置，也没有 CI；提交前跑 `npm test`。
- 代码标识符用英文，注释、测试名、日志与 UI 文案用中文。
