import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, rules } from '../src/engine/index.js';
import { loadData } from './helpers.js';

const data = loadData();
let uidSeq = 0;

function card(typeId, over = {}) {
  const def = data.cardTypes.cardTypes.find((t) => t.id === typeId);
  assert.ok(def, `未知牌型 ${typeId}`);
  return {
    uid: `t_${typeId}_${uidSeq++}`,
    typeId,
    suit: def.suits?.[0] ?? 'spade',
    rank: 7,
    name: def.name,
    category: def.category,
    kind: def.kind,
    slot: def.slot,
    task: def.task,
    target: def.target,
    effect: def.effect,
    params: def.params ? structuredClone(def.params) : undefined,
    ...over,
  };
}

const FOUR_PLAYER_ROLES = ['frontier_lab', 'distiller', 'distiller', 'lone_wolf'];

const noopDecide = ({ request }) =>
  request.type === 'play_action' ? { kind: 'end_turn' } : { ids: [request.options[0].id] };

function fixture({ playerCount = 4, decide = noopDecide, seed = 99, onEvent } = {}) {
  const game = createGame({ ...data, playerCount, seed, decide, onEvent });
  game.state.players.forEach((p, i) => {
    const role = data.roles.roles.find((r) => r.id === FOUR_PLAYER_ROLES[i % FOUR_PLAYER_ROLES.length]);
    p.role = { ...role };
    p.revealed = role.public;
  });
  game.state.currentPlayerIndex = 0;
  return game;
}

function setChar(player, id) {
  player.character = { ...data.characters.characters.find((c) => c.id === id) };
}

function setup(charId, { hand = [], weapon = null, compute = 4, decide = noopDecide } = {}) {
  const g = fixture({ decide });
  const p = g.state.players[0];
  setChar(p, charId);
  p.hand = hand;
  p.compute = compute;
  p.equipment.weapon = weapon;
  g.state.drawPile = [];
  g.state.discardPile = [];
  return { g, p, others: g.state.players.slice(1) };
}

// ------------------------------------------------------------ 角色技能

test('GPT-4o「全模态」：非指控牌也能作为指控行动出现', () => {
  const { g, p, others } = setup('gpt_4o', {
    hand: [card('scaling_law'), card('attack')],
    weapon: card('weapon_reasoning_cluster'),
  });
  const actions = g.legalActions(p);
  const asAttack = actions.filter((a) => a.asAttack);
  assert.equal(asAttack.length, others.filter((o) => o.alive).length, '每张非指控牌应对每个可及目标各产生一个行动');
  assert.ok(asAttack.every((a) => a.cardUid === p.hand[0].uid));
  assert.ok(actions.some((a) => a.kind === 'play_card' && !a.asAttack && a.cardUid === p.hand[1].uid), '原指控牌仍可正常使用');
});

test('GPT-4o「全模态」：把补牌牌当指控打出会进入弃牌堆而非生效', async () => {
  const g = fixture({ decide: noopDecide });
  const [a, b] = g.state.players;
  setChar(a, 'gpt_4o');
  setChar(b, 'phi_4');
  const drawCard = card('scaling_law');
  a.hand = [drawCard];
  b.hand = [];
  b.compute = 4;
  g.state.drawPile = [card('attack'), card('attack')];
  await g.performAction(a, { kind: 'play_card', cardUid: drawCard.uid, targetIndex: b.index, asAttack: true });
  assert.equal(a.hand.length, 0, '该牌被消耗掉了');
  assert.ok(g.state.discardPile.some((c) => c.uid === drawCard.uid), '当作指控打出后进弃牌堆');
  assert.equal(b.compute, 3, '造成 1 点伤害');
});

test('GPT-4.5「成本外溢」：受伤时其他所有玩家各弃 1 张', async () => {
  const discarded = [];
  const g = fixture({
    decide: ({ player, request }) => {
      if (request.type !== 'select') return { kind: 'end_turn' };
      discarded.push(player.name);
      return { ids: [request.options[0].id] };
    },
  });
  const [victim, ...others] = g.state.players;
  setChar(victim, 'gpt_4_5');
  victim.compute = 4;
  victim.hand = [card('attack')];
  others.forEach((o) => (o.hand = [card('defense'), card('defense')]));
  await g.dealDamage(null, victim, 1, '测试');
  assert.equal(discarded.length, others.length, '其他三名玩家都被要求弃牌');
  others.forEach((o) => assert.equal(o.hand.length, 1));
});

test('Sky「音色风波」：受伤时从伤害来源手中抽 1 张', async () => {
  const g = fixture();
  const [victim, source] = g.state.players;
  setChar(victim, 'sky_voice');
  victim.compute = 4;
  victim.hand = [];
  source.hand = [card('defense'), card('defense'), card('defense')];
  await g.dealDamage(source, victim, 1, '测试');
  assert.equal(source.hand.length, 2);
  assert.equal(victim.hand.length, 1);
});

test('豆包 Seed「国民应用」：其他角色回合结束后获得无判定额外回合，并触发「3 = 1+1」', async () => {
  const starts = [];
  const g = fixture({
    onEvent: (e) => {
      if (e.type === 'turnStart') starts.push(e);
    },
  });
  const [first, doubao] = g.state.players;
  setChar(first, 'phi_4');
  setChar(doubao, 'doubao_seed');
  doubao.compute = 6;
  // 额外回合跳过判定阶段，AGI 宣言不应引爆
  doubao.dynamite = card('agi_claim');
  g.state.inPlay.dynamite = true;
  g.state.currentPlayerIndex = first.index;

  await g.runTurnWithFollowUps(first);

  assert.equal(starts.length, 2, '普通回合 + 豆包额外回合');
  assert.equal(starts[0].playerIndex, first.index);
  assert.equal(starts[0].extra, false);
  assert.equal(starts[1].playerIndex, doubao.index);
  assert.equal(starts[1].extra, true);
  assert.equal(doubao.compute, 5, '额外回合结束损失 1 点算力');
  assert.ok(doubao.dynamite, '额外回合没有判定阶段，AGI 宣言保留');
});

test('豆包 Seed 自己的回合不额外触发「国民应用」，但会触发「3 = 1+1」', async () => {
  const starts = [];
  const g = fixture({
    onEvent: (e) => {
      if (e.type === 'turnStart') starts.push(e);
    },
  });
  const doubao = g.state.players[0];
  setChar(doubao, 'doubao_seed');
  doubao.compute = 6;
  g.state.currentPlayerIndex = doubao.index;

  await g.runTurnWithFollowUps(doubao);

  assert.equal(starts.length, 1, '自己的回合不应再触发额外回合');
  assert.equal(starts[0].extra, false);
  assert.equal(doubao.compute, 5);
});

test('豆包 Seed 出局后不再触发「国民应用」', async () => {
  const starts = [];
  const g = fixture({
    onEvent: (e) => {
      if (e.type === 'turnStart') starts.push(e);
    },
  });
  const [first, doubao] = g.state.players;
  setChar(first, 'phi_4');
  setChar(doubao, 'doubao_seed');
  doubao.alive = false;
  g.state.currentPlayerIndex = first.index;

  await g.runTurnWithFollowUps(first);
  assert.equal(starts.length, 1);
});

test('豆包 Seed「3 = 1+1」在回合结束时可能直接导致出局', async () => {
  const g = fixture();
  const doubao = g.state.players[0];
  setChar(doubao, 'doubao_seed');
  doubao.compute = 1;
  for (const p of g.state.players) p.hand = [];
  g.state.drawPile = [card('attack'), card('attack')];

  await g.runTurn(doubao);
  assert.equal(doubao.alive, false);
});

test('Grok-2「无过滤」需要 2 张声明，普通角色只需 1 张', async () => {
  const alwaysDefend = ({ request }) => {
    if (request.type !== 'select') return { kind: 'end_turn' };
    const def = request.options.find((o) => o.id.startsWith('card:'));
    return { ids: [def ? def.id : 'pass'] };
  };

  for (const [charId, expectedDamage] of [['grok_2', 1], ['gpt_4o', 0]]) {
    const g = fixture({ decide: alwaysDefend });
    const [a, b] = g.state.players;
    setChar(a, charId);
    setChar(b, 'phi_4');
    a.hand = [card('attack')];
    b.hand = [card('defense')];
    b.compute = 4;
    await g.resolveAttack(a, b, '蒸馏指控');
    assert.equal(4 - b.compute, expectedDamage, `${charId} 造成的伤害不符`);
  }
});

test('o3「无上限推理」与端侧小模型都解除每回合指控次数限制', () => {
  const { p } = setup('o3');
  p.attacksThisTurn = 5;
  assert.equal(rules.attacksLeft(p), Infinity);

  const { p: q } = setup('gpt_4o');
  q.attacksThisTurn = 5;
  assert.equal(rules.attacksLeft(q), 0);
  q.equipment.weapon = card('weapon_on_device');
  assert.equal(rules.attacksLeft(q), Infinity);
});

test('端侧小模型触发的无限指控上报武器机制，而非玩家角色技能', async () => {
  const skills = [];
  const g = fixture({
    decide: noopDecide,
    onEvent: (e) => e.type === 'skill' && skills.push(e.mechanic),
  });
  const [a, b] = g.state.players;
  setChar(a, 'gemini_2_0_pro');
  setChar(b, 'phi_4');
  a.equipment.weapon = card('weapon_on_device');
  a.hand = [card('attack')];
  b.hand = [];
  b.compute = 6;
  a.attacksThisTurn = 1;
  await g.playCard(a, a.hand[0], b.index);
  assert.equal(b.compute, 5);
  assert.ok(skills.includes('unlimited_attacks_per_turn'));
  assert.ok(!skills.includes('outgoing_distance_minus_one'), '不应把武器机制误报成角色的距离技能');
});

test('Llama「许可护城河」+1 与 Gemini「超长上下文」−1 影响有效距离', () => {
  const g = fixture();
  const [a, b] = g.state.players;
  setChar(a, 'phi_4');
  setChar(b, 'phi_4');
  const base = rules.effectiveDistance(g.state, a, b);
  assert.equal(base, 1);
  setChar(b, 'llama_3_1_405b');
  assert.equal(rules.effectiveDistance(g.state, a, b), 2, '护城河使别人更难打到 Llama');
  setChar(a, 'gemini_2_0_pro');
  assert.equal(rules.effectiveDistance(g.state, a, b), 1, '超长上下文抵消了 +1');
  b.equipment.distance_in = card('distance_long_context');
  assert.equal(rules.effectiveDistance(g.state, a, b), 2, '装备与角色效果叠加');
});

test('Phi-4「端侧自足」：算力未满且手牌≥2 时可反复弃牌回血', async () => {
  const { g, p } = setup('phi_4', { hand: [card('defense'), card('defense'), card('attack')], compute: 2 });
  const actions = g.legalActions(p);
  const ability = actions.find((a) => a.kind === 'character_ability');
  assert.ok(ability, '应当出现弃牌回血行动');
  p.character.compute = 4;
  await g.activateCharacterAbility(p, 'discard_two_heal_one');
  assert.equal(p.hand.length, 1);
  assert.equal(p.compute, 3);
  assert.ok(g.legalActions(p).some((a) => a.kind === 'character_ability') === false, '手牌不足 2 张时不可再用');
});

test('Qwen「全尺寸开源」：手牌归零立即补 1 张', async () => {
  const { g, p } = setup('qwen2_5_72b', { hand: [] });
  g.state.drawPile = [card('defense')];
  await g.afterHandChange(p);
  assert.equal(p.hand.length, 1);
  setChar(p, 'phi_4');
  p.hand = [];
  g.state.drawPile = [card('defense')];
  await g.afterHandChange(p);
  assert.equal(p.hand.length, 0, '非 Qwen 不触发');
});

test('Qwen「全尺寸开源」：被 TTS 夺走最后一张指控后立即补牌', async () => {
  const { g, p, others } = setup('phi_4', { hand: [] });
  const qwen = others[0];
  setChar(qwen, 'qwen2_5_72b');
  qwen.hand = [card('attack')];
  p.equipment.product = card('task_tts');
  g.state.drawPile = [card('defense')];
  await g.activateTask(p, 'tts', qwen.index);
  assert.equal(qwen.hand.length, 1, 'Qwen 手牌归零后应立即摸 1 张');
});

test('Sora「数据回收」：玩家出局时接管其手牌与装备', async () => {
  const g = fixture();
  const [sora, victim] = g.state.players;
  setChar(sora, 'sora');
  setChar(victim, 'phi_4');
  sora.hand = [];
  victim.hand = [card('attack'), card('defense')];
  victim.equipment.weapon = card('weapon_code_agent');
  victim.equipment.product = card('task_iti');
  victim.compute = 0;
  await g.eliminate(victim, null);
  assert.equal(sora.hand.length, 2);
  assert.equal(sora.equipment.weapon.typeId, 'weapon_code_agent');
  assert.equal(sora.equipment.product.typeId, 'task_iti');
  assert.equal(victim.hand.length, 0);
  assert.equal(g.state.discardPile.length, 0, '牌不应进入弃牌堆');
});

test('Sora「数据回收」：同槽位顶掉的旧装备进弃牌堆，不静默消失', async () => {
  const g = fixture();
  const [sora, victim] = g.state.players;
  setChar(sora, 'sora');
  setChar(victim, 'phi_4');
  sora.hand = [];
  sora.equipment.weapon = card('weapon_reasoning_cluster'); // Sora 已有武器（射程 3）
  sora.equipment.product = card('task_stt');
  victim.hand = [card('attack')];
  victim.equipment.weapon = card('weapon_full_stack_cloud'); // 死者武器（射程 5）
  victim.equipment.product = card('task_iti');
  victim.compute = 0;
  await g.eliminate(victim, null);
  assert.equal(sora.equipment.weapon.typeId, 'weapon_full_stack_cloud', '接管死者的武器');
  assert.equal(sora.equipment.product.typeId, 'task_iti');
  const discarded = g.state.discardPile.map((c) => c.typeId).sort();
  assert.deepEqual(discarded, ['task_stt', 'weapon_reasoning_cluster'], '被顶掉的旧装备应进弃牌堆');
});

test('挖角研究员：偷取装备到自己已占用的槽位时，旧装备进弃牌堆', async () => {
  const { g, p, others } = setup('phi_4', { hand: [] });
  const target = others[0];
  target.hand = [];
  target.equipment.weapon = card('weapon_full_stack_cloud');
  p.equipment.weapon = card('weapon_code_agent');
  const steal = card('poach');
  await g.playCard(p, steal, target.index);
  assert.equal(p.equipment.weapon.typeId, 'weapon_full_stack_cloud', '偷来的武器落槽');
  assert.equal(target.equipment.weapon, null, '目标武器被夺走');
  assert.equal(
    g.state.discardPile.some((c) => c.typeId === 'weapon_code_agent'),
    true,
    '被顶掉的旧武器应进弃牌堆'
  );
  assert.equal(
    g.state.discardPile.some((c) => c.typeId === 'poach'),
    true,
    '挖角研究员本体进弃牌堆'
  );
});

test('Sora「数据回收」：Sora 自己出局时不触发', async () => {
  const g = fixture();
  const [sora] = g.state.players;
  setChar(sora, 'sora');
  sora.hand = [card('attack')];
  sora.compute = 0;
  await g.eliminate(sora, null);
  assert.equal(g.state.discardPile.length, 1);
});

test('前沿实验室误杀授权被许可方需弃掉全部手牌与装备', async () => {
  const g = fixture();
  const [lab, victim] = g.state.players;
  lab.role = { ...data.roles.roles.find((r) => r.id === 'frontier_lab') };
  victim.role = { ...data.roles.roles.find((r) => r.id === 'licensed_partner') };
  lab.hand = [card('attack'), card('defense')];
  lab.equipment.weapon = card('weapon_code_agent');
  victim.compute = 0;
  await g.eliminate(victim, lab);
  assert.equal(lab.hand.length, 0);
  assert.equal(lab.equipment.weapon, null);
});

test('击倒蒸馏者摸 3 张牌', async () => {
  const g = fixture();
  const [killer, victim] = g.state.players;
  setChar(killer, 'phi_4');
  victim.role = { ...data.roles.roles.find((r) => r.id === 'distiller') };
  victim.compute = 0;
  killer.hand = [];
  g.state.drawPile = [card('attack'), card('attack'), card('attack')];
  await g.eliminate(victim, killer);
  assert.equal(killer.hand.length, 3);
});

test('DeepSeek-R1「开源思维链」：第 2 张为 ♦ 时额外摸 1 张', async () => {
  const diamond = card('attack', { suit: 'diamond' });
  for (const [charId, deck, expected] of [
    ['deepseek_r1', [card('defense'), diamond, card('funding')], 3],
    ['deepseek_r1', [card('defense'), card('attack', { suit: 'spade' }), card('funding')], 2],
    ['phi_4', [card('defense'), diamond, card('funding')], 2],
  ]) {
    const g = fixture();
    const p = g.state.players[0];
    setChar(p, charId);
    p.hand = [];
    // drawTop() 用 pop()，数组末尾才是牌堆顶
    g.state.drawPile = [...deck].reverse();
    await g.drawPhase(p);
    assert.equal(p.hand.length, expected, `${charId} / 第二张 ${deck[1].suit}`);
  }
});

test('GLM-4「学术溯源」：第 1 张可从其他玩家手中抽取', async () => {
  const seen = [];
  const g = fixture({
    decide: ({ request }) => {
      seen.push(request);
      return { ids: [request.options[0].id] };
    },
  });
  const p = g.state.players[0];
  setChar(p, 'glm_4');
  p.hand = [];
  g.state.players[1].hand = [card('attack')];
  g.state.drawPile = [card('defense')];
  await g.drawPhase(p);
  assert.equal(seen.length, 1);
  assert.ok(seen[0].options.some((o) => o.id === 'deck'), '应保留正常摸牌选项');
  assert.equal(p.hand.length, 2, '抽取 1 张 + 正常摸 1 张');
});

test('Kimi「长文本速读」：摸 3 张后放回 2 张', async () => {
  const g = fixture({
    decide: ({ request }) => {
      if (request.type !== 'select') return { kind: 'end_turn' };
      return { ids: request.options.slice(0, request.max).map((o) => o.id) };
    },
  });
  const p = g.state.players[0];
  setChar(p, 'kimi_k2');
  p.hand = [];
  g.state.drawPile = [card('attack'), card('defense'), card('funding')].reverse();
  await g.drawPhase(p);
  assert.equal(p.hand.length, 1);
  assert.equal(g.state.drawPile.length, 2);
});

test('Mixtral「MoE 路由」判定时翻 2 张并择一', async () => {
  const seen = [];
  const g = fixture({
    decide: ({ request }) => {
      seen.push(request);
      return { ids: [request.options.at(-1).id] };
    },
  });
  const p = g.state.players[0];
  setChar(p, 'mixtral_8x22b');
  g.state.drawPile = [card('attack', { suit: 'heart' }), card('attack', { suit: 'spade' })].reverse();
  const result = await g.judge(p, '测试');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].options.length, 2, '应提供两张候选');
  assert.equal(result.suit, 'spade', '选择了候选中的第二张');
  assert.equal(g.state.discardPile.length, 2, '落选的那张也要进弃牌堆');
});

test('Gemma 3「回收再利用」可用弃牌堆顶代替判定牌', async () => {
  const seen = [];
  const g = fixture({
    decide: ({ request }) => {
      seen.push(request);
      return { ids: ['discard'] };
    },
  });
  const p = g.state.players[0];
  setChar(p, 'gemma_3');
  const top = card('funding', { suit: 'heart' });
  g.state.discardPile = [card('attack'), top];
  g.state.drawPile = [card('attack', { suit: 'spade' })];
  const result = await g.judge(p, '测试');
  assert.equal(result.uid, top.uid);
  assert.ok(!g.state.discardPile.some((c) => c.uid === top.uid), '选用的牌已从弃牌堆移除');
  assert.equal(g.state.discardPile.length, 2, '原有的 attack 与落选的牌堆顶判定牌都留在弃牌堆');
});

test('Claude「Constitutional AI」与 RLHF 对齐都提供判定式防御', async () => {
  const offers = [];
  const g = fixture({
    decide: ({ request }) => {
      offers.push(request);
      return { ids: ['pass'] };
    },
  });
  const p = g.state.players[0];
  setChar(p, 'claude_3_5_sonnet');
  p.hand = [];
  await g.offerDefense(p, '测试', g.state.players[1]);
  assert.ok(offers[0].options.some((o) => o.id === 'judge'), '角色技能应提供判定选项');

  setChar(p, 'phi_4');
  await g.offerDefense(p, '测试', g.state.players[1]);
  assert.ok(!offers[1].options.some((o) => o.id === 'judge'), '没有技能或装备时不应出现');

  p.equipment.product = card('rlhf_alignment');
  await g.offerDefense(p, '测试', g.state.players[1]);
  assert.ok(offers[2].options.some((o) => o.id === 'judge'), 'RLHF 对齐装备应提供判定选项');
});

test('判定 ♥ 成功抵消指控', async () => {
  const g = fixture({
    decide: ({ request }) => {
      if (request.type !== 'select') return { kind: 'end_turn' };
      const judge = request.options.find((o) => o.id === 'judge');
      return { ids: [judge ? judge.id : 'pass'] };
    },
  });
  const [a, b] = g.state.players;
  setChar(a, 'phi_4');
  setChar(b, 'claude_3_5_sonnet');
  b.hand = [];
  b.compute = 4;
  a.hand = [card('attack')];
  g.state.drawPile = [card('funding', { suit: 'heart' })];
  await g.resolveAttack(a, b, '蒸馏指控');
  assert.equal(b.compute, 4, '♥ 判定成功，未受伤');
});

// ------------------------------------------------------------ Task 装备

function withTask(task, opts = {}) {
  const { g, p, others } = setup('phi_4', { hand: [], ...opts });
  p.equipment.product = card(`task_${task}`);
  return { g, p, others };
}

test('Code 产品【生产力杠杆】弃 1 张手牌当作指控，并计入回合指控次数', async () => {
  const { g, p, others } = withTask('code', { hand: [card('defense')], weapon: card('weapon_code_agent') });
  const target = others[0];
  target.hand = [];
  target.compute = 4;
  assert.ok(g.legalActions(p).some((a) => a.kind === 'task' && a.task === 'code'), '行动列表应包含生产力杠杆');
  await g.activateTask(p, 'code', target.index);
  assert.equal(p.hand.length, 0);
  assert.equal(p.attacksThisTurn, 1);
  assert.equal(target.compute, 3);
  assert.equal(g.legalActions(p).some((a) => a.task === 'code'), false, '每回合只能发动一次');
});

test('办公套件【文档协作】弃 2 张回复 1 点算力', async () => {
  const { g, p } = withTask('office', {
    hand: [card('defense'), card('defense'), card('attack')],
    compute: 2,
  });
  p.character.compute = 4;
  await g.activateTask(p, 'office');
  assert.equal(p.hand.length, 1);
  assert.equal(p.compute, 3);
});

test('TTS【舆论广播】公开手牌，若是指控则被夺走', async () => {
  for (const [held, expectSteal] of [[card('attack'), true], [card('defense'), false]]) {
    const { g, p, others } = withTask('tts');
    const target = others[0];
    target.hand = [held];
    await g.activateTask(p, 'tts', target.index);
    assert.equal(p.hand.length, expectSteal ? 1 : 0);
    assert.equal(target.hand.length, expectSteal ? 0 : 1);
  }
});

test('STT【会议纪要】查看牌堆顶 2 张并可重排', async () => {
  const bottom = card('attack', { rank: 2 });
  const top = card('defense', { rank: 10 });
  const { g, p } = withTask('stt', {
    decide: ({ request }) => ({ ids: request.options.map((o) => o.id).reverse() }),
  });
  g.state.drawPile = [bottom, top]; // 末尾为顶，先被摸到的是 top
  await g.activateTask(p, 'stt');
  assert.equal(g.state.drawPile.length, 2);
  assert.equal(g.state.drawPile.at(-1).uid, bottom.uid, '玩家把 bottom 重排到了最顶');
});

test('图生图 ITI【风格迁移】弃 1 张手牌换取弃牌堆顶', async () => {
  const { g, p } = withTask('iti', { hand: [card('defense')] });
  const recycled = card('attack');
  g.state.discardPile = [card('funding'), recycled];
  await g.activateTask(p, 'iti');
  assert.equal(p.hand.length, 1);
  assert.equal(p.hand[0].uid, recycled.uid, '换回的是原本的弃牌堆顶，而不是刚弃掉的那张');
  assert.equal(g.state.discardPile.length, 2);
  assert.equal(g.state.discardPile.at(-1).kind, 'defense', '弃掉的手牌现在位于堆顶');
});

test('Chat 产品【用户留存】手牌上限 +2', () => {
  const { p } = withTask('chat', { compute: 3 });
  assert.equal(rules.handLimit(p), 5);
});

test('产品槽一次一张，可与武器和双向距离装备共存', async () => {
  const g = fixture();
  const p = g.state.players[0];
  for (const slot of ['weapon', 'distance_in', 'distance_out']) {
    p.equipment[slot] = card(
      { weapon: 'weapon_code_agent', distance_in: 'distance_long_context', distance_out: 'distance_proprietary_channel' }[slot]
    );
  }
  p.equipment.product = card('task_chat');
  assert.equal(Object.values(p.equipment).filter(Boolean).length, 4);
  assert.equal(rules.rangeOf(p), 2);
  assert.equal(rules.handLimit(p), p.compute + 2);
  // 产品槽换装：新产品替换旧产品，旧品进弃牌堆
  await g.playCard(p, card('task_iti'), null);
  assert.equal(p.equipment.product.typeId, 'task_iti');
  assert.equal(Object.values(p.equipment).filter(Boolean).length, 4, '换装不增加槽位');
  assert.equal(g.state.discardPile.some((c) => c.typeId === 'task_chat'), true, '旧产品进弃牌堆');
});

// ------------------------------------------------------------ 卡牌效果

test('监管问询：未打出指控者失去 1 点算力', async () => {
  const g = fixture({
    decide: ({ request }) => {
      if (request.type !== 'select') return { kind: 'end_turn' };
      const usable = request.options.find((o) => o.id !== 'pass');
      return { ids: [usable ? usable.id : 'pass'] };
    },
  });
  const players = g.state.players;
  setChar(players[0], 'phi_4');
  players.forEach((p, i) => {
    p.compute = 4;
    p.hand = i === 1 ? [card('attack')] : [card('defense')];
  });
  await g.playCard(players[0], card('regulator_inquiry'), null);
  assert.equal(players[1].compute, 4, '打出指控者不受影响');
  assert.equal(players[2].compute, 3);
  assert.equal(players[3].compute, 3);
});

test('API 降价战：可用合规声明抵消', async () => {
  const g = fixture({
    decide: ({ request }) => {
      if (request.type !== 'select') return { kind: 'end_turn' };
      const def = request.options.find((o) => o.id.startsWith('card:'));
      return { ids: [def ? def.id : 'pass'] };
    },
  });
  const players = g.state.players;
  players.forEach((p) => {
    p.compute = 4;
    p.hand = [];
  });
  players[1].hand = [card('defense')];
  await g.playCard(players[0], card('price_war'), null);
  assert.equal(players[0].compute, 4, '发起者不受影响');
  assert.equal(players[1].compute, 4, '声明抵消');
  assert.equal(players[2].compute, 3);
  assert.equal(players[3].compute, 3);
});

test('Benchmark 对决：先放弃的一方失去算力', async () => {
  const g = fixture({
    decide: ({ request }) => (request.type === 'select' ? { ids: ['pass'] } : { kind: 'end_turn' }),
  });
  const [challenger, target] = g.state.players;
  setChar(challenger, 'phi_4');
  challenger.compute = 4;
  target.compute = 4;
  target.hand = [];
  await g.playCard(challenger, card('benchmark_duel'), target.index);
  assert.equal(target.compute, 3, '目标先行动，放弃即落败');
  assert.equal(challenger.compute, 4);
});

test('账号封禁：判定为黑色时跳过摸牌与出牌阶段', async () => {
  for (const [suit, expectSkip] of [['spade', true], ['heart', false]]) {
    const g = fixture();
    const p = g.state.players[1];
    setChar(p, 'phi_4');
    p.jail = card('account_ban');
    g.state.inPlay.jail = true;
    p.hand = [];
    // drawTop() 用 pop()，判定牌要放在数组末尾才会被第一个翻开
    g.state.drawPile = [card('attack'), card('attack'), card('attack', { suit })];
    const skipped = await g.judgmentPhase(p);
    assert.equal(skipped, expectSkip, suit);
    assert.equal(p.jail, null);
    assert.equal(g.state.inPlay.jail, false);
  }
});

test('AGI 宣言：♠2–♠9 引爆扣 3 点，否则传给下家', async () => {
  for (const [judgeCard, expectBoom] of [[card('attack', { suit: 'spade', rank: 5 }), true], [card('attack', { suit: 'spade', rank: 12 }), false], [card('attack', { suit: 'heart', rank: 5 }), false]]) {
    const g = fixture();
    const p = g.state.players[0];
    setChar(p, 'phi_4');
    p.compute = 4;
    p.dynamite = card('agi_claim');
    g.state.inPlay.dynamite = true;
    g.state.drawPile = [judgeCard];
    await g.judgmentPhase(p);
    if (expectBoom) {
      assert.equal(p.compute, 1, `${judgeCard.suit}${judgeCard.rank} 应引爆`);
      assert.equal(g.state.players[1].dynamite, null);
    } else {
      assert.equal(p.compute, 4);
      assert.equal(g.state.players[1].dynamite?.typeId, 'agi_claim', '应传递给下家');
      assert.equal(g.state.inPlay.dynamite, true);
    }
  }
});

test('HuggingFace 上架：按存活人数发牌，从使用者开始依次挑选', async () => {
  const pickedBy = [];
  const g = fixture({
    decide: ({ player, request }) => {
      if (request.type !== 'select') return { kind: 'end_turn' };
      pickedBy.push(player.index);
      return { ids: [request.options[0].id] };
    },
  });
  g.state.players.forEach((p) => (p.hand = []));
  g.state.drawPile = [card('attack'), card('defense'), card('funding'), card('scaling_law')].reverse();
  await g.playCard(g.state.players[2], card('hf_listing'), null);
  assert.deepEqual(pickedBy, [2, 3, 0, 1], '应从使用者开始按座位顺序挑选');
  g.state.players.forEach((p) => assert.equal(p.hand.length, 1));
});

test('挖角研究员：可抽手牌或指定夺走装备', async () => {
  const g = fixture({
    decide: ({ request }) => (request.type === 'select' ? { ids: ['slot:weapon'] } : { kind: 'end_turn' }),
  });
  const [a, b] = g.state.players;
  setChar(a, 'phi_4');
  a.hand = [];
  b.equipment.weapon = card('weapon_code_agent');
  await g.playCard(a, card('poach'), b.index);
  assert.equal(a.equipment.weapon?.typeId, 'weapon_code_agent');
  assert.equal(b.equipment.weapon, null);
});

test('融资到账不能超过算力上限，且仅剩 2 人时不可主动使用', () => {
  const { g, p, others } = setup('phi_4', { hand: [card('funding')], compute: 4 });
  assert.equal(rules.maxCompute(p), 5, '前沿实验室 +1 算力');
  p.compute = rules.maxCompute(p);
  assert.ok(!g.legalActions(p).some((a) => a.typeId === 'funding'), '满算力时不能用');
  p.compute = 2;
  assert.ok(g.legalActions(p).some((a) => a.typeId === 'funding'), '未满时可以用');
  others.forEach((o) => (o.alive = false));
  others[0].alive = true;
  assert.ok(!g.legalActions(p).some((a) => a.typeId === 'funding'), '仅剩 2 人时不可主动使用');
});

test('濒死时可由他人打出融资到账救援', async () => {
  const g = fixture({
    decide: ({ player, request }) => {
      if (request.type !== 'select') return { kind: 'end_turn' };
      const heal = request.options.find((o) => o.id !== 'pass');
      return { ids: [player.index === 2 || !heal ? 'pass' : heal.id] };
    },
  });
  const players = g.state.players;
  players.forEach((p, i) => {
    setChar(p, 'phi_4');
    p.compute = 4;
    p.hand = i === 1 ? [] : [card('funding')];
  });
  players[1].compute = 0;
  await g.resolveDying(players[1], null);
  assert.equal(players[1].alive, true);
  assert.equal(players[1].compute, 1);
  assert.equal(players[0].hand.length, 1, '濒死者自身无牌，救援顺序为 1→2→3→0，轮到 P0 前已被救起');
  assert.equal(players[2].hand.length, 1, 'P2 选择不介入');
  assert.equal(players[3].hand.length, 0, 'P3 打出了融资到账');
});

test('无人救援时濒死者出局', async () => {
  const g = fixture({ decide: ({ request }) => (request.type === 'select' ? { ids: ['pass'] } : { kind: 'end_turn' }) });
  const victim = g.state.players[1];
  setChar(victim, 'phi_4');
  victim.compute = -1;
  victim.hand = [];
  await g.resolveDying(victim, null);
  assert.equal(victim.alive, false);
  assert.equal(victim.compute, 0);
  assert.equal(victim.revealed, true, '出局后身份公开');
});
