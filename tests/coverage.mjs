import { createGame } from '../src/engine/index.js';
import { loadData, makeRandomDecider } from './helpers.js';

const data = loadData();
const N = Number(process.argv[2] ?? 400);

const kindCounts = new Map();
const skillCounts = new Map();
const decisionCounts = new Map();
let dynamiteBooms = 0;
let eliminations = 0;
let judgeCalls = 0;
let taskActivations = 0;

// 距离修正是持续状态而非离散事件，引擎不会为它们发 skill 事件，由 mechanics.test.js 直接断言。
const PASSIVE_MECHANICS = new Set(['incoming_distance_plus_one', 'outgoing_distance_minus_one']);

for (let seed = 1; seed <= N; seed++) {
  const playerCount = 4 + (seed % 4);
  const randomDecide = makeRandomDecider();

  const game = createGame({
    ...data,
    playerCount,
    seed,
    names: Array.from({ length: playerCount }, (_, i) => `P${i + 1}`),
    decide(req) {
      decisionCounts.set(req.request.type, (decisionCounts.get(req.request.type) ?? 0) + 1);
      return randomDecide(req);
    },
    onEvent(event) {
      if (event.type === 'judge') judgeCalls++;
      if (event.type === 'eliminated') eliminations++;
      if (event.type === 'skill') skillCounts.set(event.mechanic, (skillCounts.get(event.mechanic) ?? 0) + 1);
      if (event.type === 'play' && event.card) {
        kindCounts.set(event.card.kind, (kindCounts.get(event.card.kind) ?? 0) + 1);
      }
    },
  });

  await game.run();

  if (game.state.log.some((l) => l.text.includes('AGI 宣言引爆'))) dynamiteBooms++;
  taskActivations += game.state.log.filter((l) => l.text.includes('【')).length;
}

const allKinds = [...new Set(data.deck.cards.map((c) => c.kind))].sort();
const allMechanics = data.characters.characters
  .map((c) => ({ mechanic: c.mechanic, label: `${c.name} / ${c.skill.name}` }))
  .sort((a, b) => a.label.localeCompare(b.label));

console.log(`\n=== ${N} 局覆盖统计（随机决策）===\n`);
console.log('牌型 play 事件:');
for (const k of allKinds) {
  const n = kindCounts.get(k) ?? 0;
  console.log(`  ${n === 0 ? '✗' : ' '} ${k}: ${n}`);
}
console.log('\n角色技能触发次数（引擎 skill 事件）:');
for (const { mechanic, label } of allMechanics) {
  const n = skillCounts.get(mechanic) ?? 0;
  const tag = PASSIVE_MECHANICS.has(mechanic) ? '被动' : n === 0 ? '✗' : ' ';
  console.log(`  ${tag} ${label}: ${n}`);
}
console.log('\n决策请求:', [...decisionCounts.entries()].map(([k, v]) => `${k}=${v}`).join(', '));
console.log(
  `判定 ${judgeCalls} 次 / 出局 ${eliminations} 次 / AGI 宣言引爆 ${dynamiteBooms} 局 / Task 发动 ${taskActivations} 次`
);

const neverFired = [
  ...allKinds.filter((k) => !(kindCounts.get(k) ?? 0)).map((k) => `牌型:${k}`),
  ...allMechanics
    .filter(({ mechanic }) => !PASSIVE_MECHANICS.has(mechanic) && !(skillCounts.get(mechanic) ?? 0))
    .map(({ label }) => `技能:${label}`),
];
console.log(neverFired.length ? `\n未覆盖: ${neverFired.join(', ')}` : '\n全部覆盖');
