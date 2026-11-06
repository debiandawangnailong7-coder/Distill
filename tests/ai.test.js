import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/engine/index.js';
import { createAi, TableMemory } from '../src/ai/index.js';
import { mulberry32 } from '../src/engine/rng.js';
import { loadData } from './helpers.js';

const data = loadData();

/** 跑一局全 AI 对局，返回终局状态与逐条攻击记录（终局身份已公开，可回溯归因）。 */
async function playAiGame(seed, playerCount = 5) {
  const memories = Array.from({ length: playerCount }, () => new TableMemory(playerCount));
  const ais = memories.map((memory, i) =>
    createAi({ memory, roles: data.roles, playerCount, rand: mulberry32(seed * 100 + i) })
  );
  const roleOf = [];
  const attacks = [];
  const harms = [];
  const game = createGame({
    ...data,
    playerCount,
    seed,
    names: Array.from({ length: playerCount }, (_, i) => `P${i + 1}`),
    decide: ({ player, request, view }) => ais[player.index].decide({ player, request, view }),
    onEvent: (e) => {
      for (const m of memories) m.observe(e);
      if (e.type === 'gameStart') for (const p of e.state.players) roleOf[p.index] = p.role.id;
      if (e.type === 'attack') {
        const rec = {
          from: roleOf[e.sourceIndex],
          to: roleOf[e.targetIndex],
          // 测试可以读真实身份：用于判定独狼出手那一刻蒸馏者是否还没死光
          distillersAlive: e.state.players.filter((p) => p.alive && p.role.id === 'distiller').length,
        };
        attacks.push(rec);
        harms.push(rec);
      }
      // 群体牌走 damage 而非 attack 事件，必须一并纳入，否则守卫可被绕过。
      // 但「Benchmark 对决」的反伤要排除：被实验室拉进对决后赢下它是被迫自卫，不是主动决策。
      if (e.type === 'damage' && e.sourceIndex != null && e.cause !== 'Benchmark 对决') {
        harms.push({
          from: roleOf[e.sourceIndex],
          to: roleOf[e.targetIndex],
          distillersAlive: e.state.players.filter((p) => p.alive && p.role.id === 'distiller').length,
        });
      }
    },
  });
  await game.run();
  return { state: game.state, attacks, harms, roleOf };
}

test('授权被许可方永远不对前沿实验室造成伤害', async () => {
  let violations = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const { harms } = await playAiGame(seed);
    violations += harms.filter((h) => h.from === 'licensed_partner' && h.to === 'frontier_lab').length;
  }
  assert.equal(violations, 0, `副手伤害了警长 ${violations} 次`);
});

test('开源独狼在蒸馏者存活期间不攻击前沿实验室', async () => {
  // 实验室一死蒸馏者立刻获胜，独狼连翻盘窗口都没有，所以这是硬约束而非偏好。
  let violations = 0;
  let wolfAttacks = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const { attacks, harms } = await playAiGame(seed);
    for (const a of attacks) if (a.from === 'lone_wolf') wolfAttacks++;
    for (const h of harms) {
      if (h.from !== 'lone_wolf') continue;
      if (h.to === 'frontier_lab' && h.distillersAlive > 0) violations++;
    }
  }
  assert.ok(wolfAttacks > 0, '独狼应当确实发动过攻击，否则样本无意义');
  assert.equal(violations, 0, `蒸馏者未全灭时独狼攻击了实验室 ${violations} 次`);
});

test('未授权蒸馏者把主要火力集中在前沿实验室身上', async () => {
  let atLab = 0;
  let total = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const { attacks } = await playAiGame(seed);
    for (const a of attacks) {
      if (a.from !== 'distiller') continue;
      total++;
      if (a.to === 'frontier_lab') atLab++;
    }
  }
  assert.ok(total > 200, `蒸馏者攻击样本过少 (${total})`);
  assert.ok(atLab / total >= 0.7, `蒸馏者对实验室的火力占比仅 ${((atLab / total) * 100).toFixed(1)}%`);
});

test('蒸馏者极少误伤同伴', async () => {
  let friendly = 0;
  let total = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const { attacks } = await playAiGame(seed);
    for (const a of attacks) {
      if (a.from !== 'distiller') continue;
      total++;
      if (a.to === 'distiller') friendly++;
    }
  }
  assert.ok(friendly / total <= 0.05, `蒸馏者互殴占比 ${((friendly / total) * 100).toFixed(1)}%`);
});

test('启发式 AI 的三方胜率都落在可玩区间', async () => {
  const wins = { frontier_lab: 0, distiller: 0, lone_wolf: 0 };
  const N = 120;
  for (let seed = 1; seed <= N; seed++) {
    const { state } = await playAiGame(seed + 5000);
    assert.ok(state.gameOver, `seed ${seed} 未结束`);
    wins[state.winner.winner]++;
  }
  const rate = (k) => wins[k] / N;
  // 基线（300 局实测）：实验室阵营 45% / 蒸馏者 34% / 独狼 21%。
  // 区间放宽以吸收小样本波动，但仍能抓住早期版本的失衡（蒸馏者 71% / 独狼 1.3%）。
  assert.ok(rate('frontier_lab') > 0.25 && rate('frontier_lab') < 0.65, `实验室阵营 ${(rate('frontier_lab') * 100).toFixed(1)}%`);
  assert.ok(rate('distiller') > 0.18 && rate('distiller') < 0.55, `蒸馏者 ${(rate('distiller') * 100).toFixed(1)}%`);
  assert.ok(rate('lone_wolf') > 0.05 && rate('lone_wolf') < 0.35, `独狼 ${(rate('lone_wolf') * 100).toFixed(1)}%`);
  console.log(
    `    实验室阵营 ${(rate('frontier_lab') * 100).toFixed(1)}% / 蒸馏者 ${(rate('distiller') * 100).toFixed(1)}% / 独狼 ${(rate('lone_wolf') * 100).toFixed(1)}%`
  );
});
