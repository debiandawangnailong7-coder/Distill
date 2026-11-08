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
npm run build:art              # scripts/build-art.mjs → assets/characters/*.svg + 通用占位 SVG
npm run assets:manifest        # 扫描 assets/ 与 data/，重写 assets/manifest.json（优先 SVG）
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

`data/cardTypes.json` 是设计面；`data/deck.json` 是生成物，携带每张牌的具体花色点数与内联牌型字段（`name/kind/slot/params/...`）。**不要手改 `deck.json`**：改 `cardTypes.json` 后重跑 `npm run build:deck`。构建脚本会校验 flavors 数量，并断言「AGI 宣言」引爆率落在 12%–20%，越界直接中止写入。

### 引擎（src/engine）

- `new Game({ deck, cardTypes, characters, roles, playerCount, seed, decide, onEvent, names })`，然后 `await game.run()` 打完一整局。人数限 4–7。
- 引擎不实现任何玩家，所有决策都经 `await decide({ player, request, view, rules })` 回调：
  - `request.type === 'play_action'`：返回 `request.actions` 中的一个行动对象（`play_card` / `task` / `character_ability` / `end_turn`）。
  - `request.type === 'select'`：返回 `{ ids: [...] }`，按 `request.purpose` 区分防御响应、濒死救援、弃牌、判定选牌、抢牌等。
- `view(player)` 是 AI 唯一的信息来源，未公开身份为 `null`。AI 只通过 `TableMemory` 消费引擎广播的 `relation` 事件推断敌我，**绝不能读取 `game.state` 里的隐藏身份**。新增敌对/友好效果时调用 `noteRelation(from, to, weight)`，否则 AI 感知不到。
- 事件流（`onEvent`）：`gameStart / turnStart / play / attack / damage / judge / draw / heal / dying / rescue / eliminated / loot / equip / reveal / relation / skill / log / gameOver / end`，事件附带 `state`。UI 动画与测试断言都依赖这些事件。
- `rules.js` 是纯函数规则层（距离、射程、手牌上限、攻击次数、Task 次数、胜负判定）；`game.js` 负责流程与结算。`checkWinner` 中独狼「唯一存活」优先于「实验室已死」。
- 回合顺序：判定 → 摸牌 → 出牌 → 弃牌。`attacksThisTurn` 与 `taskUses` 在 `runTurn` 每回合重置。
- 角色可以有多个机制：`character.mechanic` 是主机制，`character.mechanics` 是完整数组（目前只有豆包 Seed 使用双技能）；`hasMechanic` 同时检查两者。
- 豆包 Seed 的「国民应用」由 `runTurnWithFollowUps` 编排：每名其他角色的正常回合结束后，插入一个 `skipJudgment: true` 的额外回合；额外回合不递归。它的「3 = 1+1」在 `runTurn` 末尾通过 `dealDamage` 结算，因此会正常触发濒死、救援和受伤事件。
- 卡牌是自描述的：`typeOf(card)` 直接返回卡牌自身的 `kind/params`，所以 `rules.js` 无需查询牌型注册表。
- 7 人局在 `buildDrawPile` 中额外洗入 4 张指控 + 4 张声明。

### AI（src/ai）

- `createAi({ memory, roles, playerCount, rand })` 返回 `{ decide }`；每个 AI 持有独立的 `TableMemory`。
- `heuristic.js`：`buildContext` 组装公开信息与行为账本 → `scoreAction` 给合法行动打分（0 分基准 = 结束回合）→ `chooseSelection` 按 `purpose` 处理各类响应。
- 两条硬约束由 `tests/ai.test.js` 守护：授权被许可方绝不伤害实验室；蒸馏者存活期间独狼不攻击实验室。改评分函数时不要破坏。

### UI（src/ui）

- `app.js`：启动、引擎接线、人类决策 Promise、事件 → 动画队列、开场/结算/设置。人类为 0 号座位，默认 5 人。
- `render.js`：keyed DOM。座位按 `player.index`、手牌按 `card.uid`、舞台按 item id 复用节点，**禁止全量重建**；卡面/座位/牌堆/行动条/弹窗/响应托盘都在这里。
- `input.js`：指针状态机。拖手牌到座位、拖到中央直接使用、点击选牌 + 点座位、键盘 1–9/方向键/Enter/Esc、Tab 切换「当作指控 / 正常使用」。
- `motion.js`：可等待、可快进、可降级的动画队列；`decide()` 前 `await drain()`，保证先看完上一拍。`shared/style.css` 管视觉，`#app.responding` 在防御响应时隐藏手牌并放大桌面。
- `hints.js`：三档提示（新手/标准/专家），新手 coach mark 首次出现，`localStorage` 记忆。`intent.js` 是纯函数意图层（可单测），`assets.js` 处理 manifest/URL。
- 调试入口：`?auto=1&seed=23574&players=5&fast=1` 直接开局；`&autoplay=1` 让 AI 托管人类跑完整局（用于回归）。静态视觉预览：`/src/ui/preview.html?mode=targeting|actions|modal|gameover|intro`。
- 素材经 `assets/manifest.json` 索引：`status === 'ready'` 用专属图，否则用 `fallback` 通用徽记；manifest 缺失或加载失败时退回纯文字 UI。路径必须用 `new URL(path, document.baseURI)`，CSS 自定义属性里的相对 URL 基准不可靠。

### 素材与构建

- `npm run build:art` 用 `scripts/build-art.mjs` 生成矢量角色：DeepSeek / Claude / GPT / Kimi 为人形 Q 版，豆包 Seed 为围巾团子，`char_default` 为通用黄色占位。人形角色共用 `chibi()` 底模，支持 `headTilt` / `eyes` / `mouthStyle` / `arms` / `sparkles`；新增角色时在 `CHARACTERS` 注册表加一个 `render` 函数。
- `npm run assets:manifest` 扫描 `assets/characters/<id>.{svg,png}`、`assets/cards/<id>.{svg,png}` 与 `assets/generic/`，结合 `data/` 三张表重写清单；**同名 SVG 优先于 PNG**。通用库是兜底而非占位：新增角色或牌型**不需要补图**，放专属 SVG 后自动变为 `ready`。
- `npm run build:dist` 只复制 `scripts/build-dist.mjs` 里的 `PUBLIC` 白名单 + `assets/` 到 `dist/`。**新增浏览器运行时文件（js/css/json）必须加入 `PUBLIC`**，否则线上 404。
- `dist/`、`vibe_images/`、`*.qoder.site` 已 gitignore；部署目标为 Qoder Sites。

## 改动时的连带点

- **调整已有卡牌数值/文案**：只改 `data/cardTypes.json` → `npm run build:deck` → `npm test`。
- **新增牌型**：`data/cardTypes.json` 加条目后，通常还要动 `legalActions`（何时可打出）、`playCard`（结算分支）、`rules.js`（若影响距离/上限）、`heuristic.js` 的 `BASE_VALUE`/`scoreAction`（AI 估值）、`src/ui/intent.js` 的 `kindClass`/`SLOT_LABEL`（图标与标签）和 `src/ui/render.js` 的卡面渲染，并在 `tests/mechanics.test.js` 补用例。
- **新增角色机制**：`data/characters.json` 的 `mechanic` 字符串 → 在 `rules.js`/`game.js` 对应位置实现 → 用 `noteSkill(player, mechanic)` 上报实际触发（`tests/coverage.mjs` 据此统计覆盖率）→ 补测试。
- **平衡断言不是绊脚石**：牌堆攻防密度（指控 24%–34%、声明 18%–28%）、AGI 宣言引爆率（构建期 12%–20%）、AI 三方胜率区间都写成了测试。它们对应 `DESIGN.md` §10 记录的真实回退事故（调参时蒸馏者胜率曾达 71%、独狼仅 1.3%），调整数值前先读那一节，不要为了让测试变绿而直接放宽区间。
- **测试夹具**：`tests/mechanics.test.js` 的 `fixture()/setup()/card()` 直接改 `game.state` 与角色，配合 `noopDecide` 或脚本化 decider 精确触发单条规则。完整对局冒烟与批量校验用 `tests/helpers.js` 的 `makeRandomDecider`。

## 约定

- 没有 lint/格式化配置，也没有 CI；提交前跑 `npm test`。
- 代码标识符用英文，注释、测试名、日志与 UI 文案用中文。
