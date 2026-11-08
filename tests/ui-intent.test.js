import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actionForTarget,
  actionForTargeting,
  actionGroupLabel,
  groupTargetedActions,
  hasIntentChoice,
  targetedActions,
  nonTargetActions,
  playableActions,
  endTurnAction,
  faceLabel,
  kindClass,
} from '../src/ui/intent.js';

const attack = { kind: 'attack', uid: 'a', name: '蒸馏指控' };
const heal = { kind: 'heal', uid: 'h', name: '融资到账' };
const weapon = { kind: 'weapon', category: 'equipment', uid: 'w', name: 'Code Agent', slot: 'weapon' };

const actions = [
  { kind: 'play_card', cardUid: 'a', targetIndex: 1, label: '指控 → A' },
  { kind: 'play_card', cardUid: 'a', targetIndex: 2, label: '指控 → B' },
  { kind: 'play_card', cardUid: 'h', label: '融资到账' },
  { kind: 'play_card', cardUid: 'w', label: '装备 Code Agent' },
  { kind: 'task', task: 'office', label: '文档协作' },
  { kind: 'end_turn', label: '结束回合' },
];

test('意图层：按卡牌拆分目标行动与非目标行动', () => {
  assert.deepEqual(targetedActions(actions, 'a').map((a) => a.targetIndex), [1, 2]);
  assert.deepEqual(nonTargetActions(actions, 'h').map((a) => a.label), ['融资到账']);
  assert.deepEqual(nonTargetActions(actions, 'w').map((a) => a.label), ['装备 Code Agent']);
  assert.deepEqual(nonTargetActions(actions, 'a'), []);
});

test('意图层：同一目标的 normal / asAttack 两种用法可切换', () => {
  const pool = [
    { kind: 'play_card', cardUid: 'x', targetIndex: 1, label: '正常使用' },
    { kind: 'play_card', cardUid: 'x', targetIndex: 1, asAttack: true, label: '当作指控' },
  ];
  assert.equal(actionForTarget(pool, 'x', 1, false).label, '正常使用');
  assert.equal(actionForTarget(pool, 'x', 1, true).label, '当作指控');
  assert.equal(hasIntentChoice(pool, 'x', 1), true);

  assert.equal(actionForTarget(actions, 'a', 1).label, '指控 → A');
  assert.equal(actionForTarget(actions, 'a', 3), null);
  assert.equal(hasIntentChoice(actions, 'a', 1), false);
});

test('意图层：主动 Task 按效果归组，点击入口后再选目标', () => {
  const taskActions = [
    { kind: 'task', task: 'code', targetIndex: 1, label: '【生产力杠杆】弃 1 张手牌当作指控 → A', labelBase: '【生产力杠杆】弃 1 张手牌当作指控' },
    { kind: 'task', task: 'code', targetIndex: 2, label: '【生产力杠杆】弃 1 张手牌当作指控 → B', labelBase: '【生产力杠杆】弃 1 张手牌当作指控' },
    { kind: 'task', task: 'tts', targetIndex: 1, label: '【舆论广播】公开 A 的一张手牌', labelBase: '【舆论广播】公开一名玩家的手牌' },
    { kind: 'task', task: 'tts', targetIndex: 2, label: '【舆论广播】公开 B 的一张手牌', labelBase: '【舆论广播】公开一名玩家的手牌' },
    { kind: 'task', task: 'office', label: '【文档协作】' },
    ...actions,
  ];
  const groups = groupTargetedActions(taskActions);
  assert.deepEqual(groups.map((a) => a.task), ['code', 'tts']);
  assert.equal(actionGroupLabel(groups[0]), '【生产力杠杆】弃 1 张手牌当作指控');

  const targeting = { actions: taskActions.filter((a) => a.task === 'code'), label: 'code', source: 'action' };
  assert.equal(actionForTargeting(targeting, 2).label, '【生产力杠杆】弃 1 张手牌当作指控 → B');
  assert.equal(actionForTargeting(targeting, 3), null);

  const cardTargeting = {
    actions: [
      { kind: 'play_card', cardUid: 'x', targetIndex: 1, label: '正常使用' },
      { kind: 'play_card', cardUid: 'x', targetIndex: 1, asAttack: true, label: '当作指控' },
    ],
    source: 'card',
  };
  assert.equal(actionForTargeting(cardTargeting, 1, false).label, '正常使用');
  assert.equal(actionForTargeting(cardTargeting, 1, true).label, '当作指控');
});

test('意图层：结束回合不算可打出的行动', () => {
  assert.equal(playableActions(actions).some((a) => a.kind === 'end_turn'), false);
  assert.equal(endTurnAction(actions)?.kind, 'end_turn');
});

test('意图层：花色点数、牌型样式与装备分类', () => {
  assert.equal(faceLabel({ suit: 'spade', rank: 14 }), '♠A');
  assert.equal(faceLabel({ suit: 'heart', rank: 10 }), '♥10');
  assert.equal(kindClass(attack), 'k-attack');
  assert.equal(kindClass(heal), 'k-action');
  assert.equal(kindClass(weapon), 'k-equip');
});
