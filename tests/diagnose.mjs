import { createGame } from '../src/engine/index.js';
import { createAi, TableMemory } from '../src/ai/index.js';
import { mulberry32 } from '../src/engine/rng.js';
import { loadData, makeRandomDecider } from './helpers.js';

const data = loadData();
const PC = 5;
const N = Number(process.argv[2] ?? 200);
const MODE = process.argv[3] ?? 'heuristic';

const ROLE_LABEL = {
  frontier_lab: '实验室',
  licensed_partner: '被许可方',
  distiller: '蒸馏者',
  lone_wolf: '独狼',
};

function blank() {
  return { games: 0, win: 0, attacks: 0, damageDealt: 0, damageTaken: 0, dodges: 0,
           heals: 0, equips: 0, turnsAlive: 0, diedToDistiller: 0, targetsHit: {} };
}
const hist = {};
const labDamageFrom = {};
const labAttackedBy = {};
const stats = Object.fromEntries(Object.keys(ROLE_LABEL).map((r) => [r, blank()]));

for (let seed = 1; seed <= N; seed++) {
  const memories = Array.from({ length: PC }, () => new TableMemory(PC));
  const ais = memories.map((memory, i) =>
    createAi({ memory, roles: data.roles, playerCount: PC, rand: mulberry32(seed * 100 + i) })
  );
  const randomDecide = makeRandomDecider(mulberry32(seed * 7919));

  const roleOf = [];
  const game = createGame({
    ...data,
    playerCount: PC,
    seed,
    names: Array.from({ length: PC }, (_, i) => `P${i + 1}`),
    decide: ({ player, request, view }) => {
      const out =
        MODE === 'random'
          ? randomDecide({ player, request, view })
          : ais[player.index].decide({ player, request, view });
      if (request.type === 'select' && request.purpose === 'defense_response' && out.ids[0] !== 'pass') {
        stats[player.role.id].dodges++;
      }
      return out;
    },
    onEvent: (e) => {
      for (const m of memories) m.observe(e);
      if (e.type === 'gameStart') {
        for (const p of e.state.players) roleOf[p.index] = p.role.id;
      }
      if (e.type === 'attack') stats[roleOf[e.sourceIndex]].attacks++;
      if (e.type === 'damage') {
        if (e.sourceIndex != null) stats[roleOf[e.sourceIndex]].damageDealt += e.amount;
        stats[roleOf[e.targetIndex]].damageTaken += e.amount;
        if (roleOf[e.targetIndex] === 'frontier_lab') {
          const src = e.sourceIndex == null ? '(无来源/炸药)' : ROLE_LABEL[roleOf[e.sourceIndex]];
          labDamageFrom[src] = (labDamageFrom[src] ?? 0) + e.amount;
        }
      }
      if (e.type === 'attack') {
        if (roleOf[e.targetIndex] === 'frontier_lab') {
          const src = ROLE_LABEL[roleOf[e.sourceIndex]];
          labAttackedBy[src] = (labAttackedBy[src] ?? 0) + 1;
        }
      }
      if (e.type === 'heal') stats[roleOf[e.playerIndex]].heals += e.amount;
      if (e.type === 'equip') stats[roleOf[e.playerIndex]].equips++;
    },
  });

  await game.run();
  const s = game.state;
  const w = s.winner.winner;
  hist[w] = (hist[w] ?? 0) + 1;
  for (const p of s.players) {
    stats[p.role.id].games++;
    const won =
      w === 'lone_wolf'
        ? p.role.id === 'lone_wolf' && p.alive
        : w === 'distiller'
          ? p.role.id === 'distiller'
          : p.role.id === 'frontier_lab' || p.role.id === 'licensed_partner';
    if (won) stats[p.role.id].win++;
  }
}

console.log(`winner histogram: ${JSON.stringify(hist)}`);
console.log(`\n=== ${MODE} × ${N} 局 — 按身份统计 ===\n`);
console.log(
  ['身份', '局数', '胜', '胜率', '发起攻击', '造成伤害', '承受伤害', '主动闪避', '回血', '上装备']
    .join('\t')
);
for (const [role, label] of Object.entries(ROLE_LABEL)) {
  const st = stats[role];
  const g = st.games || 1;
  console.log(
    [
      label,
      st.games,
      st.win,
      ((st.win / g) * 100).toFixed(1) + '%',
      (st.attacks / g).toFixed(1),
      (st.damageDealt / g).toFixed(1),
      (st.damageTaken / g).toFixed(1),
      (st.dodges / g).toFixed(1),
      (st.heals / g).toFixed(1),
      (st.equips / g).toFixed(1),
    ].join('\t')
  );
}
