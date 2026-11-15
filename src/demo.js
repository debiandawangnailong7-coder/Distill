/**
 * Demo 编排入口：负责一切「这是单机演示」的事实——
 * URL 参数解析（seat/seed/players/autoplay/mode/reduce/auto）、错误上报、
 * AI 创建与座位注入、建局与 run()。src/ui 下的客户端模块不 import 引擎与 AI，
 * 只消费本文件喂给它们的协议（decide / onEvent / getView）。
 *
 * 参数：
 *   ?seat=3      本地座位（0 基，默认 0），其余座位由 AI 托管
 *   ?players=5   人数 4–7
 *   ?seed=123    固定随机种子
 *   ?autoplay=1  AI 连本地座位一起托管（整局回归用）
 *   ?auto=1      跳过开场介绍直接开局
 *   ?mode=beginner|standard|expert  提示强度
 *   ?reduce=1    减少动效（动画瞬时完成）
 */
import { createGame } from './engine/index.js';
import { createAi, TableMemory } from './ai/index.js';
import { mulberry32 } from './engine/rng.js';
import { bootDistillClient } from './ui/app.js';

const PARAMS = new URLSearchParams(location.search);

const rawPlayers = Number(PARAMS.get('players') ?? 5);
const PLAYER_COUNT = Number.isFinite(rawPlayers) ? Math.min(7, Math.max(4, rawPlayers)) : 5;
const rawSeat = Number(PARAMS.get('seat') ?? 0);
const SEAT = Number.isFinite(rawSeat) ? Math.min(PLAYER_COUNT - 1, Math.max(0, Math.floor(rawSeat))) : 0;
const seedParam = PARAMS.get('seed');
const SEED = seedParam != null && seedParam !== '' && Number.isFinite(Number(seedParam))
  ? Number(seedParam)
  : Math.floor(Math.random() * 1e9);
const AUTOPLAY = PARAMS.get('autoplay') === '1';
const NAMES = ['你', 'dario', 'sam A.', 'tibo', '梁文峰', 'Qwen 用户', 'Kimi 用户'];

// 自动化回归出口：整局跑完后由外部脚本读取断言「无未捕获错误」。
window.__distillErrors = [];
window.addEventListener('error', (e) => window.__distillErrors.push(String(e.error?.stack ?? e.message)));
window.addEventListener('unhandledrejection', (e) => window.__distillErrors.push(String(e.reason?.stack ?? e.reason)));

let game = null;
let ais = [];

const client = await bootDistillClient({
  seat: SEAT,
  autopilot: AUTOPLAY,
  mode: PARAMS.get('mode') || undefined,
  reduce: PARAMS.get('reduce') === '1',
  autoStart: PARAMS.get('auto') === '1',
  getView: () => game.view(game.state.players[SEAT]),
  externalDecide: (ctx) => ais[ctx.player.index].decide(ctx),
  startGame: ({ decide, onEvent, data }) => {
    const memories = Array.from({ length: PLAYER_COUNT }, () => new TableMemory(PLAYER_COUNT));
    ais = memories.map((memory, i) =>
      createAi({ memory, roles: data.roles, playerCount: PLAYER_COUNT, rand: mulberry32(SEED + i) })
    );
    game = createGame({
      ...data,
      playerCount: PLAYER_COUNT,
      seed: SEED,
      names: NAMES,
      decide,
      onEvent,
    });
    window.__distill = { get game() { return game; }, get client() { return client; } };
    console.info(`[DISTILL] seed=${SEED} players=${PLAYER_COUNT} seat=${SEAT}`);
    return game.run();
  },
});
