/**
 * 时间线：把一局游戏表达为「状态 i —合法行动→ 状态 i+1」的确定性链条。
 *
 * 三种用法（save 对象为纯 JSON，可直接落盘）：
 *   1. 录制：record(config) 产生 { game, transcript, checkpoints }，跑完 game.run() 后
 *      用 saveGame() 打包。转录 = 每次 decide() 返回值的有序列表；检查点 = 每个
 *      turnStart 时的（状态 + RNG 位点 + 已消耗决策数）。
 *   2. 回放：replay(save, onEvent, { fromTurn }) 从检查点（或开局）按转录重放，
 *      事件流与原局完全一致——历史状态由此直接播放。
 *   3. 续玩：resume(save, { fromTurn, decide }) 先按转录走到转录尽头，
 *      之后交给新的 decide 继续真人/AI 对局——任意中间状态都可以接着玩。
 *
 * 确定性来源：引擎全部随机走 mulberry32(seed)（快照保存其内部位点），
 * 决策全部经 decide() 单一出口；因此（seed + 决策转录）唯一确定一局。
 * 注意：卡牌/角色/身份等静态表不入 save，按版本随代码走。
 */
import { createGame } from './game.js';

/** 瘦卡：剥掉水合字段，回到 deck.json 的独立事实（uid/typeId/suit/rank/flavor）。 */
export function thinCard(card) {
  if (!card) return card;
  const out = { uid: card.uid, typeId: card.typeId, suit: card.suit, rank: card.rank };
  if (card.flavor !== undefined) out.flavor = card.flavor;
  return out;
}

/** 状态快照的纯数据版：深拷贝 + 卡牌全部转瘦卡（水合字段由 reviveState 按注册表现场重建）。 */
export function thinState(state) {
  const s = structuredClone(state);
  const strip = (c) => {
    if (!c) return c;
    delete c.name;
    delete c.category;
    delete c.kind;
    delete c.slot;
    delete c.task;
    delete c.target;
    delete c.effect;
    delete c.params;
    return c;
  };
  s.drawPile.forEach(strip);
  s.discardPile.forEach(strip);
  for (const p of s.players) {
    p.hand.forEach(strip);
    for (const slot of Object.keys(p.equipment ?? {})) strip(p.equipment[slot]);
    strip(p.jail);
    strip(p.dynamite);
  }
  return s;
}

/** 快照：状态 + RNG 位点。必须在对局停顿（决策边界/回合边界）时调用。 */
export function snapshot(game) {
  return { rngState: game.rand.getState(), state: thinState(game.state) };
}

/**
 * 录制一局：包一层 onDecision（决策转录）与 onEvent（每 turnStart 打一个检查点）。
 * 返回 { game, transcript, checkpoints }；调用方 await game.run() 后用 saveGame() 打包。
 * config.decide 即实际玩家（人类/AI/脚本）；config.onEvent 会被透传。
 */
export function record(config) {
  const transcript = [];
  const checkpoints = [];
  const game = createGame({
    ...config,
    onDecision: ({ player, request, choice }) => {
      transcript.push({ p: player.index, t: request.type, q: request.purpose ?? null, c: choice });
    },
    onEvent: (event) => {
      if (event.type === 'turnStart') {
        checkpoints.push({ turn: event.turnNumber, decisions: transcript.length, ...snapshot(game) });
      }
      config.onEvent?.(event);
    },
  });
  return { game, transcript, checkpoints };
}

/** 打包存档（纯 JSON；静态数据表不入档）。 */
export function saveGame({ game, transcript, checkpoints }) {
  const s = game.state;
  return {
    version: 1,
    seed: s.seed,
    playerCount: s.playerCount,
    names: game.names,
    transcript,
    checkpoints,
  };
}

/**
 * 从存档恢复。
 * @param {object} save    saveGame() 的产物（不含静态数据表）
 * @param {object} opts    data：静态数据表 { cardTypes, characters, roles }（恢复路径仍需注册表水合卡牌）；
 *                         fromTurn：从哪个回合的检查点起（默认最后一个检查点）；
 *                         decide：转录耗尽后的继续决策（不传则转录耗尽即抛错，纯回放）；
 *                         onEvent：事件订阅（回放 UI 用）
 * @returns {Game} 已恢复、可直接 await run() 的对局
 */
export function resume(save, { data, fromTurn = Infinity, decide: liveDecide = null, onEvent = null, onDecision = null } = {}) {
  if (!data) throw new Error('resume 需要静态数据表 data（cardTypes/characters/roles）');
  const cps = (save.checkpoints ?? []).filter((c) => c.turn <= fromTurn);
  const cp = cps[cps.length - 1] ?? null;
  let idx = cp ? cp.decisions : 0;
  const game = createGame({
    ...data,
    seed: save.seed,
    playerCount: save.playerCount,
    names: save.names,
    snapshot: cp ? { rngState: cp.rngState, state: structuredClone(cp.state) } : undefined,
    onEvent: onEvent ?? undefined,
    onDecision: onDecision ?? undefined,
    decide: ({ player, request }) => {
      const entry = save.transcript[idx];
      if (!entry) {
        if (!liveDecide) throw new Error(`转录已耗尽（第 ${idx} 个决策，${request.type}）`);
        return liveDecide({ player, request });
      }
      idx++;
      if (entry.p !== player.index || entry.t !== request.type || (entry.q ?? null) !== (request.purpose ?? null)) {
        throw new Error(
          `转录错位：存档第 ${idx - 1} 条为 ${entry.t}/${entry.q ?? '-'}（P${entry.p}），实际请求 ${request.type}/${request.purpose ?? '-'}（P${player.index}）`
        );
      }
      return entry.c;
    },
  });
  return game;
}

/** 纯回放：从 fromTurn 的检查点按转录播完整局，事件流与原局一致。 */
export function replay(save, data, onEvent, { fromTurn = 1 } = {}) {
  return resume(save, { data, fromTurn, onEvent }).run();
}
