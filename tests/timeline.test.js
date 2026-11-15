import test from 'node:test';
import assert from 'node:assert/strict';
import { record, saveGame, resume, replay, thinState, thinCard } from '../src/engine/index.js';
import { loadData, makeRandomDecider } from './helpers.js';

const data = loadData();

function config(playerCount = 5, seed = 7) {
  return {
    ...data,
    playerCount,
    seed,
    names: Array.from({ length: playerCount }, (_, i) => `P${i + 1}`),
    decide: makeRandomDecider(),
  };
}

/** 深比较两个快照（瘦卡状态）是否完全一致。 */
function assertSameState(a, b, msg) {
  assert.deepEqual(thinState(a), thinState(b), msg);
}

/** 恢复存档并跑完，返回 { game }。 */
async function resumeRun(save, data, opts) {
  const g = resume(save, { data, ...opts });
  await g.run();
  return { game: g };
}

test('同一局：转录回放与原局终态一致（事件流可复现）', async () => {
  const { game, transcript, checkpoints } = record(config(5, 11));
  await game.run();
  const originalState = thinState(game.state);

  // 从开局完整回放：终态与原局一致
  const saved = saveGame({ game, transcript, checkpoints });
  const { game: replayed } = await resumeRun(saved, data, { fromTurn: 0 });
  assertSameState(originalState, replayed.state, '完整回放终态应与原局一致');
  assert.equal(replayed.state.winner?.winner, game.state.winner?.winner);
  assert.equal(replayed.state.turnNumber, game.state.turnNumber);
  assert.ok(transcript.length > 20, '转录应有足够决策数');
});

test('中间存档：从第 T 回合检查点 + 转录后缀恢复，剩余对局与原局一致', async () => {
  const { game, transcript, checkpoints } = record(config(5, 23));
  await game.run();
  const finalState = thinState(game.state);
  const saved = saveGame({ game, transcript, checkpoints });

  // 选一个中间回合（既非开头也非结尾）
  const midTurn = Math.floor(saved.checkpoints[Math.floor(saved.checkpoints.length / 2)].turn);
  const { game: resumed } = await resumeRun(saved, data, { fromTurn: midTurn });
  assert.equal(resumed.state.turnNumber, game.state.turnNumber, '回合数一致');
  assertSameState(finalState, resumed.state, '恢复后续玩应与原局完全一致');
});

test('续玩：转录耗尽后交给新决策者继续，可打完整局', async () => {
  const { game, transcript, checkpoints } = record(config(5, 31));
  await game.run();
  const saved = saveGame({ game, transcript, checkpoints });

  // 只喂一半转录，之后用新的随机决策者继续——对局应能正常结束
  const half = Math.floor(saved.transcript.length / 2);
  const truncated = { ...saved, transcript: saved.transcript.slice(0, half), checkpoints: saved.checkpoints };
  const { game: continued } = await resumeRun(truncated, data, { fromTurn: 1, decide: makeRandomDecider() });
  assert.equal(continued.state.gameOver, true, '续玩对局应正常结束');
  assert.ok(continued.state.winner, '续玩对局应产生胜者');
});

test('存档是纯 JSON：卡牌为瘦卡，恢复后重新水合', async () => {
  const { game, transcript, checkpoints } = record(config(5, 41));
  await game.run();
  const saved = saveGame({ game, transcript, checkpoints });

  // JSON 往返无损
  const roundTrip = JSON.parse(JSON.stringify(saved));
  const cp = roundTrip.checkpoints.at(-1);
  const handCard = cp.state.players[0].hand[0] ?? cp.state.drawPile[0];
  assert.ok(handCard, '状态里应有牌');
  assert.equal('kind' in handCard, false, '存档里的卡牌应为瘦卡（不含水合字段）');
  assert.ok(handCard.uid && handCard.typeId);

  const { game: revived } = await resumeRun(roundTrip, data, { fromTurn: Infinity });
  assertSameState(thinState(game.state), thinState(revived.state), 'JSON 往返后回放应与原局一致');
  const liveCard = revived.state.drawPile[0] ?? revived.state.discardPile.at(-1);
  assert.ok(liveCard?.kind, '恢复后的运行时卡牌应重新水合');
});

test('回放可以从任意中间回合开始（直接播放该回合起的历史）', async () => {
  const { game, transcript, checkpoints } = record(config(5, 57));
  await game.run();
  const saved = saveGame({ game, transcript, checkpoints });

  // 从最后一个回合之前的某个回合起播——应能播到终局且终态一致
  const targetTurn = saved.checkpoints.at(-2)?.turn ?? 1;
  let events = 0;
  await replay(saved, data, () => events++, { fromTurn: targetTurn });
  assert.ok(events > 0, '应收到事件流');

  const { game: partial } = await resumeRun(saved, data, { fromTurn: targetTurn });
  assertSameState(thinState(game.state), thinState(partial.state), '中途回放终态应与原局一致');
});

test('thinCard/thinState 是纯函数且卡牌瘦身后不含水合字段', () => {
  const thin = thinCard({ uid: 'a', typeId: 'attack', suit: 'spade', rank: 7, name: '蒸馏指控', kind: 'attack', params: {} });
  assert.deepEqual(thin, { uid: 'a', typeId: 'attack', suit: 'spade', rank: 7 });
});
