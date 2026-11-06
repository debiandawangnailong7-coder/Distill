import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, rules } from '../src/engine/index.js';
import { loadData, makeRandomDecider } from './helpers.js';

const data = loadData();

function playGame(seed, playerCount = 5) {
  const game = createGame({
    ...data,
    playerCount,
    seed,
    decide: makeRandomDecider(),
    names: Array.from({ length: playerCount }, (_, i) => `P${i + 1}`),
  });
  return game.run().then((state) => ({ game, state }));
}

test('牌堆规模与 roles.json 声明一致，且每张牌都能查到牌型定义', () => {
  assert.equal(data.deck.cards.length, data.roles.rules.standardDeckSize);
  assert.equal(data.deck.totalCards, data.deck.cards.length);
  for (const c of data.deck.cards) {
    assert.ok(
      data.cardTypes.cardTypes.some((t) => t.id === c.typeId),
      `${c.uid} 的 typeId ${c.typeId} 在 cardTypes.json 中不存在`
    );
    assert.ok(c.kind && c.name, `${c.uid} 缺少内联的牌型字段`);
  }
});

test('牌堆攻防密度接近 BANG! 原版，避免攻击无法被回应', () => {
  const total = data.deck.cards.length;
  const count = (kind) => data.deck.cards.filter((c) => c.kind === kind).length;
  const attackRate = count('attack') / total;
  const defenseRate = count('defense') / total;
  // BANG! 原版为 Bang 48% / Missed 23%。本作牌型更多所以密度更低，
  // 但防御牌低于 18% 时蒸馏者（唯一知道该打谁的一方）会碾压实验室阵营。
  assert.ok(attackRate >= 0.24 && attackRate <= 0.34, `指控密度 ${(attackRate * 100).toFixed(1)}% 越界`);
  assert.ok(defenseRate >= 0.18 && defenseRate <= 0.28, `声明密度 ${(defenseRate * 100).toFixed(1)}% 越界`);
});

test('身份配比符合 4-7 人配置表', () => {
  for (const n of [4, 5, 6, 7]) {
    const game = createGame({ ...data, playerCount: n, seed: n, decide: makeRandomDecider() });
    const counts = {};
    for (const p of game.state.players) counts[p.role.id] = (counts[p.role.id] ?? 0) + 1;
    const expected = Object.fromEntries(
      Object.entries(data.roles.seating[String(n)]).filter(([, v]) => v > 0)
    );
    assert.deepEqual(counts, expected);
    assert.equal(game.state.players.length, n);
    assert.equal(new Set(game.state.players.map((p) => p.character.id)).size, n, '角色不应重复');
  }
});

test('圆桌距离在出局后重新计算且最小为 1', () => {
  const game = createGame({ ...data, playerCount: 5, seed: 11, decide: makeRandomDecider() });
  const s = game.state;
  assert.equal(rules.seatDistance(s, 0, 1), 1);
  assert.equal(rules.seatDistance(s, 0, 2), 2);
  assert.equal(rules.seatDistance(s, 0, 3), 2, '5 人圆桌对向距离应为 2');
  assert.equal(rules.seatDistance(s, 0, 4), 1);

  s.players[2].alive = false;
  assert.equal(rules.seatDistance(s, 0, 3), 2, '跳过出局者后 0→3 仍为 2');
  s.players[1].alive = false;
  assert.equal(rules.seatDistance(s, 0, 3), 1, '只剩 0/3/4 三人时 0→3 应为 1');
  assert.equal(rules.seatDistance(s, 0, 1), Infinity, '出局者不参与距离计算');
});

test('前沿实验室获得 +1 算力，手牌上限随算力和 Chat 产品变化', () => {
  const game = createGame({ ...data, playerCount: 5, seed: 3, decide: makeRandomDecider() });
  const lab = game.state.players.find((p) => p.role.id === rules.ROLE.LAB);
  assert.equal(lab.compute, lab.character.compute + 1);
  assert.equal(rules.handLimit(lab), lab.compute);
  lab.equipment.task_chat = { params: { handLimitBonus: 2 } };
  assert.equal(rules.handLimit(lab), lab.compute + 2);
});

test('无武器时射程为 1，装备武器后按 params.range 生效', () => {
  const game = createGame({ ...data, playerCount: 5, seed: 7, decide: makeRandomDecider() });
  const p = game.state.players[0];
  assert.equal(rules.rangeOf(p), 1);
  p.equipment.weapon = { params: { range: 3 } };
  assert.equal(rules.rangeOf(p), 3);
});

test('批量对局：每局都能正常结束并产生合法胜者', async () => {
  const winners = {};
  for (let seed = 1; seed <= 60; seed++) {
    const playerCount = 4 + (seed % 4);
    const { state } = await playGame(seed, playerCount);
    assert.ok(state.gameOver, `seed ${seed} 未结束`);
    assert.ok(state.winner, `seed ${seed} 没有胜者`);
    assert.ok(
      [rules.ROLE.LAB, rules.ROLE.DISTILLER, rules.ROLE.LONE_WOLF].includes(state.winner.winner),
      `seed ${seed} 胜者身份非法: ${state.winner.winner}`
    );
    assert.ok(state.turnNumber > 0, `seed ${seed} 一回合都没跑`);
    assert.ok(state.turnNumber < 2000, `seed ${seed} 疑似死循环 (${state.turnNumber} 回合)`);

    for (const p of state.players) {
      assert.ok(p.alive || p.compute === 0, `seed ${seed} ${p.name} 出局但算力为 ${p.compute}`);
      assert.ok(p.compute <= rules.maxCompute(p), `seed ${seed} ${p.name} 算力超上限`);
      assert.ok(p.revealed, `seed ${seed} 结算后应公开身份`);
      assert.equal(p.hand.length, p.alive ? p.hand.length : 0);
    }

    // 胜利条件自洽性校验
    const alive = state.players.filter((p) => p.alive);
    const lab = state.players.find((p) => p.role.id === rules.ROLE.LAB);
    if (state.winner.winner === rules.ROLE.LONE_WOLF) {
      assert.equal(alive.length, 1);
      assert.equal(alive[0].role.id, rules.ROLE.LONE_WOLF);
    } else if (state.winner.winner === rules.ROLE.DISTILLER) {
      assert.equal(lab.alive, false);
    } else {
      assert.ok(lab.alive);
      assert.ok(!alive.some((p) => [rules.ROLE.DISTILLER, rules.ROLE.LONE_WOLF].includes(p.role.id)));
    }

    const key = `${playerCount}p:${state.winner.winner}`;
    winners[key] = (winners[key] ?? 0) + 1;
  }
  console.log('    胜者分布:', JSON.stringify(winners, null, 0));
});

test('开源独狼「唯一存活」优先于「实验室已死」', () => {
  const state = {
    players: [
      { index: 0, alive: false, role: { id: rules.ROLE.LAB } },
      { index: 1, alive: false, role: { id: rules.ROLE.DISTILLER } },
      { index: 2, alive: true, role: { id: rules.ROLE.LONE_WOLF } },
      { index: 3, alive: false, role: { id: rules.ROLE.PARTNER } },
    ],
  };
  assert.equal(rules.checkWinner(state).winner, rules.ROLE.LONE_WOLF);
});

test('实验室阵营在威胁全部出局时获胜', () => {
  const state = {
    players: [
      { index: 0, alive: true, role: { id: rules.ROLE.LAB } },
      { index: 1, alive: false, role: { id: rules.ROLE.DISTILLER } },
      { index: 2, alive: false, role: { id: rules.ROLE.LONE_WOLF } },
      { index: 3, alive: true, role: { id: rules.ROLE.PARTNER } },
    ],
  };
  assert.equal(rules.checkWinner(state).winner, rules.ROLE.LAB);
});
