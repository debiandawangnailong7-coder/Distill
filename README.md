# DISTILL!

一场关于模型权重的身份牌局：戏仿 BANG!，把「大模型蒸馏」争议映射为身份、手牌与装备。
纯静态浏览器游戏——无框架、无 bundler、无运行时依赖，浏览器直接加载 ES module。
全仓库的注释、测试名、UI 文案与文档均使用中文。

- 领域规则（身份、回合、卡牌、装备、数值与平衡实测）：`DESIGN.md`
- 美术素材规范与来源声明：`ASSETS.md`
- 面向 Claude Code 的仓库导览：`CLAUDE.md`

## 快速开始

```bash
npm run serve        # http://localhost:5173 （Node ≥ 20.11）
npm test             # node:test 全量测试
npm run build:dist   # 生成可部署的 dist/
```

调试入口：`?auto=1&seed=23574&players=5&seat=3` 直接以 3 号位视角开局；`&autoplay=1&reduce=1` 让 AI 托管整局（动画瞬时，回归用）。
静态 UI 预览：`/src/ui/preview.html?mode=targeting|actions|modal|inspect|gameover|intro`。

## 结构

```
data/      设计面（cardTypes / characters / roles）+ 生成物 deck.json（瘦卡：uid/花色/点数/flavor）
src/
  engine/  游戏引擎：game.js（编排）· combat.js（战斗与生死）· effects.js（卡牌与产品结算）· rules.js（纯规则）· rng.js
  ai/      启发式 AI：行为账本（TableMemory）+ 评分决策（heuristic.js），只消费公开事件流
  demo.js  单机入口：URL 参数、AI 建局、错误上报；把 decide/getView 注入通用客户端
  ui/      表现层：app.js（通用客户端）· project.js（view → 座位投影）· focus.js（焦点弹窗仲裁）
           render.js（keyed DOM 牌桌）· screens.js（开场页/结算页）· input.js（指针/键盘）
           motion.js（动效队列）· hints.js（三档提示）· intent.js（纯函数意图层）· assets.js（manifest 索引）
scripts/   build-deck（牌堆生成）· make-asset-manifest（素材清单）· build-dist（部署打包）· serve · white-to-alpha（白底转透明）
tests/     node:test 全量测试 + coverage / bench-ai / diagnose 平衡统计工具
assets/    立绘与徽记，经 manifest.json 索引；characters/（Q 版）· portraits/（普通立绘，开场页用）· generic/
```

数据不重复保存：`deck.json` 只存每张牌的独立事实，牌型定义单点保存在 `cardTypes.json`，
引擎建局时按 `typeId` 水合；角色技能单点保存在 `skills[]`，主技能即首项。

## 路线图

- [x] 开场介绍页：普通立绘角色墙（缺图走奶蛙占位）+ 身份一览，低文字量
- [x] 对局文案精简（提示行、行动面板、个人信息）
- [ ] Guided game：一场脚本化的教学对局——固定 seed 与身份，由 coach 系统驱动每一步，
      在真实对局里依次演示「出牌 / 响应 / 濒死救援 / 判定 / 装备」五类教学节点；
      复用 `hints.js` 的 coach mark 与 `motion.js` 的可等待队列，预计以 `?guided=1` 进入
- [ ] 牌型专属图标（当前走 kind_* 通用徽记）

---

本作为同人戏仿，未使用任何公司官方 logo 或吉祥物原图。
