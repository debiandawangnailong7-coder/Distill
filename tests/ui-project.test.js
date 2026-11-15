import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  maxComputeOf,
  rangeOfYou,
  handLimitOf,
  taskUsesLeftOf,
  hasMechanicOf,
  computeStates,
  equipSlots,
  seatModels,
  buildProjection,
  seatByIndex,
  seatAngle,
} from '../src/ui/project.js';
import { createGame } from '../src/engine/index.js';
import { loadData, makeRandomDecider } from './helpers.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ------------------------------------------------------------ 夹具

function char(over = {}) {
  return { id: 'c1', name: '测试模型', compute: 4, skills: [], ...over };
}

function you(over = {}) {
  return {
    index: 3,
    name: 'P4',
    alive: true,
    character: char(),
    role: { id: 'distiller', name: '未授权蒸馏者', computeBonus: 0 },
    compute: 4,
    hand: [{ uid: 'h1' }, { uid: 'h2' }],
    equipment: { weapon: null, distance_in: null, distance_out: null, product: null },
    jail: null,
    dynamite: null,
    taskUses: {},
    ...over,
  };
}

function other(over = {}) {
  return {
    index: 0,
    name: 'P1',
    alive: true,
    character: char({ id: 'c0' }),
    compute: 3,
    maxCompute: 5,
    handCount: 4, // 只有数字，没有手牌内容
    equipment: {},
    jail: null,
    dynamite: null,
    role: null, // 未公开
    distance: 2,
    targetable: true,
    ...over,
  };
}

function view(over = {}) {
  return {
    yourIndex: 3,
    you: you(),
    others: [other()],
    turnNumber: 7,
    drawPileCount: 40,
    discardTop: null,
    inPlay: { jail: false, dynamite: false },
    log: [],
    ...over,
  };
}

// ------------------------------------------------------------ 本家数值

test('投影：本家最大算力/射程/手牌上限由 view.you 推导', () => {
  assert.equal(maxComputeOf(you()), 4);
  const lab = you({ role: { id: 'frontier_lab', computeBonus: 1 } });
  assert.equal(maxComputeOf(lab), 5);

  assert.equal(rangeOfYou(you()), 1);
  const armed = you({ equipment: { weapon: { typeId: 'w', params: { range: 3 } } } });
  assert.equal(rangeOfYou(armed), 3);

  assert.equal(handLimitOf(you({ compute: 2 })), 2);
  const product = you({ equipment: { product: { typeId: 'task_chat', params: { handLimitBonus: 2 } } } });
  assert.equal(handLimitOf(product), 6);
});

test('投影：Task 剩余次数按本家产品槽与 taskUses 记账', () => {
  const eq = { product: { typeId: 'task_office', params: { perTurn: 1 } } };
  assert.equal(taskUsesLeftOf(you({ equipment: eq, taskUses: {} }), 'office'), 1);
  assert.equal(taskUsesLeftOf(you({ equipment: eq, taskUses: { office: 1 } }), 'office'), 0);
  // 产品槽装的不是对应产品 → 0 次
  assert.equal(taskUsesLeftOf(you({ equipment: { product: { typeId: 'task_stt' } } }), 'office'), 0);
  assert.equal(taskUsesLeftOf(you(), 'office'), 0);
});

test('投影：机制查询走 character.skills', () => {
  const c = char({ skills: [{ name: '双声明', mechanic: 'attack_needs_two_defenses' }] });
  assert.equal(hasMechanicOf(c, 'attack_needs_two_defenses'), true);
  assert.equal(hasMechanicOf(c, 'any_card_as_attack'), false);
  assert.equal(hasMechanicOf(char(), 'attack_needs_two_defenses'), false);
});

// ------------------------------------------------------------ 座位模型与信息边界

test('投影：他人模型只有手牌数，未公开身份为 null', () => {
  const v = view();
  const seats = seatModels(v);
  assert.equal(seats.length, 2);
  const o = seats.find((s) => s.index === 0);
  assert.equal(o.handCount, 4);
  assert.equal(o.hand, undefined); // 他人手牌内容不存在于模型
  assert.equal(o.role, null);
  assert.equal(o.roleKnown, false);
  const self = seats.find((s) => s.isYou);
  assert.equal(self.role.id, 'distiller');
  assert.equal(self.roleKnown, true);
  assert.equal(self.handCount, 2);
});

test('投影：阵亡者/主公的已公开身份按引擎 revealed 语义透传', () => {
  const v = view({
    others: [
      other({ index: 0, role: null, alive: false }), // 未公开（异常数据也应原样显示占位）
      other({ index: 1, role: { id: 'frontier_lab', name: '前沿实验室' }, revealed: true }), // 主公恒亮
      other({ index: 2, role: { id: 'lone_wolf', name: '开源独狼' }, alive: false }), // 阵亡亮出
    ],
  });
  const seats = seatModels(v);
  assert.equal(seatByIndex(buildProjection(v), 0).roleKnown, false);
  assert.equal(seatByIndex(buildProjection(v), 1).role.id, 'frontier_lab');
  assert.equal(seatByIndex(buildProjection(v), 2).role.id, 'lone_wolf');
});

test('投影：算力图标三态数量等于 maxCompute', () => {
  assert.deepEqual(computeStates(3, 5, true), ['full', 'full', 'full', 'hurt', 'hurt']);
  assert.deepEqual(computeStates(0, 3, true), ['hurt', 'hurt', 'hurt']);
  assert.deepEqual(computeStates(4, 4, false), ['empty', 'empty', 'empty', 'empty']);
});

test('投影：装备四槽映射为三显示位（双向距离合并为马）', () => {
  const equipment = {
    weapon: { uid: 'w' },
    product: { uid: 'p' },
    distance_in: { uid: 'di' },
    distance_out: { uid: 'do' },
  };
  const slots = equipSlots(equipment);
  assert.equal(slots.weapon.uid, 'w');
  assert.equal(slots.item.uid, 'p');
  assert.equal(slots.horseIn.uid, 'di');
  assert.equal(slots.horseOut.uid, 'do');
  assert.deepEqual(equipSlots({}), { weapon: null, item: null, horseIn: null, horseOut: null });
});

test('投影：残血座位标记 hurt，座位环以本家为正下方', () => {
  const v = view({ others: [other({ index: 0 }), other({ index: 1, compute: 1, maxCompute: 5 })] });
  const seats = seatModels(v);
  const hurtSeat = seats.find((s) => s.index === 1);
  assert.equal(hurtSeat.hurt, true);
  assert.equal(seats.find((s) => s.isYou).hurt, false);

  // 本家（座位 3）在 5 人环上的角度 = 正下方 π/2
  assert.ok(Math.abs(seatAngle(3, 3, 5) - Math.PI / 2) < 1e-9);
  // 邻座在两侧对称
  assert.ok(Math.abs(seatAngle(3, 4, 5) - (Math.PI / 2 - 2 * Math.PI / 5)) < 1e-9);
});

test('投影：事件流元数据（当前回合/终局）进入投影', () => {
  const p = buildProjection(view(), { currentIndex: 0, extraTurn: true, gameOver: true, result: { winner: 'distiller' } });
  assert.equal(p.currentIndex, 0);
  assert.equal(p.extraTurn, true);
  assert.equal(p.gameOver, true);
  assert.equal(p.result.winner, 'distiller');
  assert.equal(p.drawPileCount, 40);
  const idle = buildProjection(view());
  assert.equal(idle.currentIndex, null);
  assert.equal(idle.gameOver, false);
});

// ------------------------------------------------------------ view 边界整局守护

test('边界：seat=3 整局，decide 收到的 view 对他人只公开 handCount 与 revealed 身份', async () => {
  const data = loadData();
  const seat = 3;
  const random = makeRandomDecider();
  let checked = 0;
  const game = createGame({
    ...data,
    playerCount: 5,
    seed: 20261115,
    names: ['P1', 'P2', 'P3', 'P4', 'P5'],
    decide(ctx) {
      if (ctx.player.index === seat) {
        checked++;
        const v = ctx.view;
        assert.equal(v.yourIndex, seat);
        assert.ok(Array.isArray(v.you.hand), '本家手牌在 view.you 中');
        for (const o of v.others) {
          assert.equal(o.hand, undefined, '他人手牌内容不可见');
          assert.equal(typeof o.handCount, 'number');
          if (o.role) {
            // 身份可见 ⇒ 引擎的 revealed 标志必须为真（主公开局即公开、阵亡亮出、终局全亮）
            assert.equal(game.state.players[o.index].revealed, true,
              '未满足 revealed 语义的身份不应出现在 view 中');
          }
        }
      }
      return random(ctx);
    },
    onEvent() {},
  });
  await game.run();
  assert.ok(checked > 0, 'seat=3 应至少收到一次决策');
  assert.ok(game.state.gameOver, '整局应打完');
});

// ------------------------------------------------------------ UI 源码边界 grep

test('边界：src/ui 不 import 引擎与 AI，不出现 players[0] 硬编码', () => {
  const uiDir = join(root, 'src/ui');
  const files = readdirSync(uiDir).filter((f) => f.endsWith('.js'));
  assert.ok(files.length >= 10);
  for (const f of files) {
    const src = readFileSync(join(uiDir, f), 'utf8');
    assert.ok(!src.includes("../engine/"), `${f} 不得 import 引擎`);
    assert.ok(!src.includes("../ai/"), `${f} 不得 import AI`);
    assert.ok(!src.includes('players[0]'), `${f} 不得硬编码 players[0]`);
    assert.ok(!src.includes('game.state'), `${f} 不得直接读原始 state`);
  }
});
