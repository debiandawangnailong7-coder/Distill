import { createGame } from '../src/engine/index.js';
import { createAi, TableMemory } from '../src/ai/index.js';
import { mulberry32 } from '../src/engine/rng.js';
import { loadData, makeRandomDecider } from './helpers.js';

const data = loadData();
const PLAYER_COUNT = Number(process.argv[2] ?? 5);
const N = Number(process.argv[3] ?? 300);
const MODE = process.argv[4] ?? 'heuristic'; // heuristic | random | mixed

const ROLE_LABEL = {
  frontier_lab: '前沿实验室',
  licensed_partner: '授权被许可方',
  distiller: '未授权蒸馏者',
  lone_wolf: '开源独狼',
};

const wins = {};
const survived = {};
const appearances = {};
let totalTurns = 0;
let friendlyFire = 0;
let friendlyFireGames = 0;
let attacksTotal = 0;

for (let seed = 1; seed <= N; seed++) {
  const memories = Array.from({ length: PLAYER_COUNT }, () => new TableMemory(PLAYER_COUNT));
  const ais = memories.map((memory, i) =>
    createAi({ memory, roles: data.roles, playerCount: PLAYER_COUNT, rand: mulberry32(seed * 100 + i) })
  );
  const randomDecide = makeRandomDecider(mulberry32(seed * 7919));

  const game = createGame({
    ...data,
    playerCount: PLAYER_COUNT,
    seed,
    names: Array.from({ length: PLAYER_COUNT }, (_, i) => `P${i + 1}`),
    decide: ({ player, request, view }) => {
      const useRandom = MODE === 'random' || (MODE === 'mixed' && player.index === 0);
      return useRandom ? randomDecide({ player, request, view }) : ais[player.index].decide({ player, request, view });
    },
    onEvent: (e) => {
      for (const m of memories) m.observe(e);
      if (e.type === 'attack') attacksTotal++;
    },
  });

  await game.run();
  const s = game.state;
  totalTurns += s.turnNumber;

  for (const p of s.players) {
    const r = p.role.id;
    appearances[r] = (appearances[r] ?? 0) + 1;
    if (p.alive) survived[r] = (survived[r] ?? 0) + 1;
  }
  if (s.winner) {
    const w = s.winner.winner;
    wins[w] = (wins[w] ?? 0) + 1;
  }

  // 蒸馏者互相开火统计（终局身份已全部公开）
  const distillers = s.players.filter((p) => p.role.id === 'distiller');
  let ff = 0;
  for (const a of distillers) {
    for (const b of distillers) {
      if (a.index !== b.index) ff += Math.max(0, memories[a.index].hostility(a.index, b.index));
    }
  }
  if (ff > 0) friendlyFireGames++;
  friendlyFire += ff;
}

const pct = (n, d) => ((n / d) * 100).toFixed(1) + '%';

console.log(`\n=== ${MODE} AI，${PLAYER_COUNT} 人局 × ${N} 局 ===\n`);
console.log('阵营胜率（按局数）:');
for (const [role, label] of Object.entries(ROLE_LABEL)) {
  const w = wins[role] ?? 0;
  console.log(`  ${label.padEnd(9, ' ')} ${String(w).padStart(4)} / ${N}  ${pct(w, N)}`);
}
console.log('\n各身份存活到终局的比例:');
for (const [role, label] of Object.entries(ROLE_LABEL)) {
  const a = appearances[role] ?? 0;
  if (!a) continue;
  console.log(`  ${label.padEnd(9, ' ')} ${pct(survived[role] ?? 0, a)}`);
}
console.log(`\n平均回合数: ${(totalTurns / N).toFixed(1)}`);
console.log(`平均每局攻击次数: ${(attacksTotal / N).toFixed(1)}`);
console.log(`蒸馏者互殴: ${friendlyFireGames}/${N} 局出现，累计 ${friendlyFire} 次敌意权重`);
