import { maxCompute, rangeOf } from '../engine/rules.js';
import { TableMemory } from './memory.js';

const ROLE = {
  LAB: 'frontier_lab',
  PARTNER: 'licensed_partner',
  DISTILLER: 'distiller',
  LONE_WOLF: 'lone_wolf',
};

const BASE_VALUE = {
  attack: 5,
  defense: 6,
  heal: 7,
  draw: 5,
  gamble: 2,
  general_store: 6,
  steal: 5,
  force_discard: 3,
  jail: 6,
  mass_heal: 4,
  mass_attack: 4,
  mass_challenge: 3,
  duel: 5,
  dynamite: 1,
  weapon: 7,
  distance: 6,
  barrel: 5,
  task: 7,
};

const TASK_VALUE = {
  task_chat: 10,
  task_code: 18,
  task_office: 13,
  task_tts: 11,
  task_stt: 9,
  task_iti: 14,
};

function isEnemy(myRole, otherRole) {
  if (myRole === ROLE.LONE_WOLF) return true;
  if (myRole === ROLE.DISTILLER) return otherRole === ROLE.LAB || otherRole === ROLE.LONE_WOLF;
  return otherRole === ROLE.DISTILLER || otherRole === ROLE.LONE_WOLF;
}

/**
 * 组装决策上下文。全部输入都来自引擎下发的 view（公开信息）与 TableMemory（公开行为），
 * 不含任何未公开身份。
 */
function buildContext(player, view, memory, roles, playerCount) {
  const byIndex = new Map(view.others.map((o) => [o.index, o]));
  const aliveOthers = view.others.filter((o) => o.alive);

  const labIndex =
    player.role.id === ROLE.LAB
      ? player.index
      : (view.others.find((o) => o.role?.id === ROLE.LAB)?.index ?? null);

  const total = roles.seating[String(playerCount)];
  const remaining = { ...total };
  for (const o of view.others) if (!o.alive && o.role) remaining[o.role.id]--;
  remaining[player.role.id]--;

  const counts = { attack: 0, defense: 0, heal: 0 };
  for (const c of player.hand) {
    if (c.kind === 'attack') counts.attack++;
    else if (c.kind === 'defense') counts.defense++;
    else if (c.kind === 'heal') counts.heal++;
  }

  const ctx = {
    me: player,
    view,
    memory,
    byIndex,
    aliveOthers,
    labIndex,
    myRole: player.role.id,
    remaining,
    counts,
    aliveCount: aliveOthers.length + 1,
    handById: new Map(player.hand.map((c) => [c.uid, c])),
    threats: new Map(),
    hostileIndexes: [],
    friendlyIndexes: [],
  };

  for (const o of aliveOthers) {
    const t = threatScore(o, ctx);
    ctx.threats.set(o.index, t);
    (t > 3 ? ctx.hostileIndexes : ctx.friendlyIndexes).push(o.index);
  }
  return ctx;
}

function threatScore(o, ctx) {
  const { me, memory, myRole, labIndex, aliveCount, byIndex, remaining } = ctx;
  // 净敌意：正数 = 他对我动过手，负数 = 他救过/治疗过我
  const heHitMe = memory.hostility(o.index, me.index);
  const iHitHim = memory.hostility(me.index, o.index);
  const aggression = memory.aggression(o.index);

  const labInfo = labIndex == null ? null : labIndex === me.index ? me : byIndex.get(labIndex);
  const labCompute = labInfo?.compute ?? 0;
  const vsLab =
    labIndex == null || o.index === labIndex
      ? 0
      : memory.hostility(o.index, labIndex) + memory.hostility(labIndex, o.index);

  let s = 0;

  // 授权被许可方永远不打实验室，哪怕被警长盲狙试探。
  // 少了这条会出现死亡螺旋：警长试探 → 副手还手 → 警长确认它是敌人 → 继续压制，
  // 实测实验室每局因此承受 12.6 点伤害（随机出牌只有 5.6）。
  if (myRole === ROLE.PARTNER && o.index === labIndex) return -1000;
  if (myRole === ROLE.LAB && o.role?.id === ROLE.PARTNER) return -1000;

  if (myRole === ROLE.LAB || myRole === ROLE.PARTNER) {
    // 纯证据累积：打我的、跟实验室交火的、到处开火的都更可疑。
    // 「要不要在零证据时试探」不放在这里，交给 scoreAction 按身份决定。
    s += heHitMe * 6 + vsLab * 4 + aggression * 1.2;
    // 我打过他但他没还手 → 更可能是自己人，下一枪换个人试探；还手了则继续压制
    s += iHitHim * (heHitMe > 0 ? 2 : -1.5);
  } else if (myRole === ROLE.DISTILLER) {
    if (o.index === labIndex) {
      s += 100;
    } else {
      // 同样在打实验室的大概率是同伴；直接打我的必须还手（很可能是独狼）
      s -= vsLab * 3;
      s += heHitMe * 7;
    }
  } else {
    // 开源独狼。核心约束：只要还有蒸馏者活着，实验室就绝不能死——
    // 实验室一死蒸馏者立刻获胜，独狼连翻盘窗口都没有。
    s += heHitMe * 3;
    if (remaining.distiller <= 0) {
      // 蒸馏者已全灭：清场，把实验室留到最后单挑
      s += o.index === labIndex ? (aliveCount <= 2 ? 100 : 35) : 60;
    } else if (o.index === labIndex) {
      // 只要还有一个蒸馏者活着，实验室就绝不能死——这条必须是硬约束，
      // 否则群体牌的正分目标会把它盖过去。scoreAction 里按 HARD_FORBIDDEN 拦截。
      s -= 1000;
    } else {
      // 只在实验室真的吃紧时才出手清蒸馏者。平时保存实力让两边互耗，
      // 否则独狼沦为实验室阵营的第三个打手——实测那样蒸馏者胜率只有 29%。
      const labPressure = labCompute <= 3;
      s += labPressure ? 14 + vsLab * 5 : -8;
      if (labPressure && o.compute <= 2) s += 10;
    }
  }

  if (o.compute <= 1) s += 12;
  else if (o.compute <= 2) s += 5;

  if (o.role) s += isEnemy(myRole, o.role.id) ? 15 : -60;

  return s;
}

function cardValue(card, ctx) {
  if (!card) return 0;
  let v = BASE_VALUE[card.kind] ?? 4;
  if (card.kind === 'task') v = TASK_VALUE[card.slot] ?? 7;
  if (card.kind === 'weapon') v = 3 + card.params.range;
  if (card.kind === 'defense' && ctx.me.compute <= 2) v += 5;
  if (card.kind === 'heal') {
    const missing = maxCompute(ctx.me) - ctx.me.compute;
    v += missing <= 0 ? -7 : Math.min(3, missing);
  }
  if (card.kind === 'attack') v -= Math.max(0, ctx.counts.attack - 2);
  return v;
}

function bestTargetReach(ctx, range) {
  return ctx.aliveOthers.filter((o) => o.distance <= range && ctx.threats.get(o.index) > 3).length;
}

function scoreDynamite(ctx) {
  const { me, hostileIndexes, friendlyIndexes } = ctx;
  if (me.compute <= 3) return -25;
  if (hostileIndexes.length <= friendlyIndexes.length) return -15;
  return 7;
}

function scoreWeapon(card, ctx) {
  const cur = rangeOf(ctx.me);
  const reachNow = bestTargetReach(ctx, cur);
  const gain = bestTargetReach(ctx, card.params.range) - reachNow;
  let s = 7 + gain * 14;
  if (card.params.unlimitedAttacks) s += 9;
  if (card.params.range <= cur) s -= 16;
  // 蒸馏者的唯一目标是公开的实验室，够不着就等于整回合空过，武器优先级要显著抬高
  if (ctx.myRole === ROLE.DISTILLER && reachNow === 0 && gain > 0) s += 10;
  return s;
}

function scoreTaskEquip(card, ctx) {
  let s = TASK_VALUE[card.slot] ?? 10;
  if (card.slot === 'task_office') s += (maxCompute(ctx.me) - ctx.me.compute) * 2;
  if (card.slot === 'task_code' && !ctx.me.equipment.weapon) s += 6;
  if (card.slot === 'task_iti' && !ctx.view.discardTop) s -= 8;
  return s;
}

function scoreTaskUse(action, ctx) {
  const target = action.targetIndex == null ? null : ctx.byIndex.get(action.targetIndex);
  const th = target ? ctx.threats.get(target.index) : 0;
  const worst = Math.min(...ctx.me.hand.map((c) => cardValue(c, ctx)), Infinity);

  switch (action.task) {
    case 'code': {
      let s = th > 0 ? 13 + th * 3 : -8;
      if (target?.compute <= 1) s += 18;
      return s - worst * 0.9;
    }
    case 'office': {
      const missing = maxCompute(ctx.me) - ctx.me.compute;
      return missing <= 0 ? -30 : missing * 8 - worst * 1.8;
    }
    case 'tts': {
      if (!target) return -10;
      return 5 + Math.max(0, th) * 0.8 + (target.handCount >= 3 ? 3 : 0);
    }
    case 'stt':
      return 7;
    case 'iti': {
      const top = ctx.view.discardTop;
      if (!top) return -20;
      return cardValue(top, ctx) - worst + 2;
    }
    default:
      return 0;
  }
}

const HARD_FORBIDDEN = -500;

/** 会对目标造成伤害/损失的行动。信息类行动（TTS 侦察）不在此列。 */
const HARMFUL_TARGETED = new Set(['attack', 'duel', 'jail', 'force_discard', 'steal']);

function forbidden(ctx, index) {
  return (ctx.threats.get(index) ?? 0) <= HARD_FORBIDDEN;
}

function scoreAction(action, ctx) {
  if (action.kind === 'end_turn') return 0;

  if (action.kind === 'task') {
    if (action.task === 'code' && action.targetIndex != null && forbidden(ctx, action.targetIndex)) {
      return -1000;
    }
    return scoreTaskUse(action, ctx);
  }
  if (action.kind === 'character_ability') {
    const missing = maxCompute(ctx.me) - ctx.me.compute;
    if (missing <= 0) return -30;
    const sorted = ctx.me.hand.map((c) => cardValue(c, ctx)).sort((a, b) => a - b);
    return missing * 8 - (sorted[0] + sorted[1]) * 1.5;
  }

  const card = ctx.handById.get(action.cardUid);
  if (!card) return -100;
  // GPT-4o「全模态」可以把任意牌当指控打出，此时 must 按 'attack' 评估：
  // 否则 card.kind 仍是原牌型（例如 defense），既绕过下面的硬约束守卫，
  // 又会落到 switch 的 default 拿到 0 分，被 ±0.75 的随机噪声顶成正分而选中。
  const effectiveKind = action.asAttack ? 'attack' : card.kind;
  const target = action.targetIndex == null ? null : ctx.byIndex.get(action.targetIndex);
  const th = target ? ctx.threats.get(target.index) : 0;

  // 硬约束优先于一切评分：副手与独狼在蒸馏者未全灭时绝不能伤到实验室。
  // 光靠负威胁分不够——群体牌会被其他正分目标盖过，决斗/监狱等牌的负分也太温和。
  if (target && HARMFUL_TARGETED.has(effectiveKind) && forbidden(ctx, target.index)) return -1000;
  if ((effectiveKind === 'mass_attack' || effectiveKind === 'mass_challenge') &&
      ctx.aliveOthers.some((o) => forbidden(ctx, o.index))) {
    return -1000;
  }

  switch (effectiveKind) {
    case 'attack': {
      let s;
      if (Math.abs(th) < 0.5) {
        // 零证据。警长必须试探才能逼出信息，副手盲狙是灾难，独狼不愿过早暴露。
        if (ctx.myRole === ROLE.LAB) s = 5 + Math.max(0, ctx.counts.attack - 1) * 4;
        else if (ctx.myRole === ROLE.PARTNER) s = -16;
        else if (ctx.myRole === ROLE.LONE_WOLF) s = -4;
        else s = -8;
      } else {
        s = th > 0 ? 10 + th * 3 : th * 3;
      }
      if (target?.compute <= 1) s += 20;
      if (ctx.myRole === ROLE.DISTILLER && target?.index === ctx.labIndex) s += 15;
      s += Math.max(0, ctx.counts.attack - 2) * 3;
      if (action.asAttack) s -= cardValue(card, ctx) * 0.9;
      return s;
    }
    case 'heal':
      return (maxCompute(ctx.me) - ctx.me.compute) * 9;
    case 'draw':
      return (card.params?.draw ?? 2) >= 3 ? 20 : 14;
    case 'general_store':
      return 11 - ctx.hostileIndexes.length * 2;
    case 'mass_heal': {
      const missing = maxCompute(ctx.me) - ctx.me.compute;
      let s = missing * 5;
      for (const o of ctx.aliveOthers) {
        const m = o.maxCompute - o.compute;
        s += ctx.threats.get(o.index) > 3 ? -m * 6 : m * 4;
      }
      return s;
    }
    case 'mass_attack':
    case 'mass_challenge': {
      const weight = card.kind === 'mass_attack' ? 11 : 9;
      let s = 0;
      for (const o of ctx.aliveOthers) {
        s += ctx.threats.get(o.index) > 3 ? weight : -weight - 3;
      }
      if (ctx.me.compute <= 2) s -= 8;
      return s;
    }
    case 'duel':
      return th > 0 ? 7 + th * 2 + ctx.counts.attack * 2 : -12;
    case 'jail':
      return th > 0 ? 10 + th * 3 : -14;
    case 'steal':
      return th > 0 ? 8 + th * 2 : -6;
    case 'force_discard':
      return th > 0 ? 6 + th * 2 : -8;
    case 'dynamite':
      return scoreDynamite(ctx);
    case 'gamble':
      if (ctx.me.compute <= 2) return -25;
      return ctx.me.hand.length <= 2 ? 10 : 4;
    case 'weapon':
      return scoreWeapon(card, ctx);
    case 'distance':
      return card.slot === 'distance_out' && bestTargetReach(ctx, rangeOf(ctx.me)) === 0 ? 16 : 12;
    case 'barrel':
      return ctx.counts.defense <= 1 ? 16 : 11;
    case 'task':
      return scoreTaskEquip(card, ctx);
    default:
      // 未覆盖的牌型给强负分，让缺漏表现为「从不出这张牌」而不是被随机噪声掷中
      return -1000;
  }
}

// ------------------------------------------------------------ select 决策

function pickLowestValue(options, ctx, count = 1) {
  const cards = options.filter((o) => o.card);
  const sorted = cards.slice().sort((a, b) => cardValue(a.card, ctx) - cardValue(b.card, ctx));
  const ids = sorted.slice(0, count).map((o) => o.id);
  for (const o of options) if (ids.length < count && !ids.includes(o.id)) ids.push(o.id);
  return ids;
}

function pickHighestValue(options, ctx) {
  const cards = options.filter((o) => o.card);
  if (!cards.length) return options[0]?.id;
  return cards.slice().sort((a, b) => cardValue(b.card, ctx) - cardValue(a.card, ctx))[0].id;
}

function judgeScore(card, judgeFor, ctx) {
  if (!card) return 0;
  const spade = card.suit === 'spade';
  const boom = spade && card.rank >= 2 && card.rank <= 9;
  switch (judgeFor) {
    case 'dynamite':
      return boom ? -100 : 10;
    case 'jail':
      return spade || card.suit === 'club' ? -100 : 10;
    case 'barrel':
      return card.suit === 'heart' ? 100 : -10;
    case 'gamble':
      return spade ? (ctx.me.compute >= 4 && ctx.me.hand.length <= 2 ? 20 : -30) : 10;
    default:
      return 0;
  }
}

function respondDefense(request, ctx) {
  const options = request.options;
  const cardOpts = options.filter((o) => o.id.startsWith('card:'));
  const judgeOpt = options.find((o) => o.id === 'judge');
  const remaining = request.remaining ?? 1;

  if (!cardOpts.length && !judgeOpt) return { ids: ['pass'] };
  // 防不住就一张都别浪费（Grok-2 的双声明尤其如此）
  if (remaining > cardOpts.length + (judgeOpt ? 1 : 0)) return { ids: ['pass'] };

  if (judgeOpt && ctx.me.compute >= 3 && cardOpts.length <= 1) return { ids: ['judge'] };
  if (cardOpts.length) {
    const worst = cardOpts
      .slice()
      .sort((a, b) => cardValue(a.card, ctx) - cardValue(b.card, ctx))[0];
    return { ids: [worst.id] };
  }
  return { ids: ['judge'] };
}

function respondDying(request, ctx) {
  const healOpts = request.options.filter((o) => o.id !== 'pass');
  if (!healOpts.length) return { ids: ['pass'] };
  if (request.dying === ctx.me.index) {
    const best = healOpts.slice().sort((a, b) => cardValue(a.card, ctx) - cardValue(b.card, ctx))[0];
    return { ids: [best.id] };
  }
  const th = ctx.threats.get(request.dying) ?? 0;
  if (th > 3) return { ids: ['pass'] };
  if (ctx.me.hand.length <= 2) return { ids: ['pass'] };
  const best = healOpts.slice().sort((a, b) => cardValue(a.card, ctx) - cardValue(b.card, ctx))[0];
  return { ids: [best.id] };
}

function respondChallenge(request, ctx) {
  const cardOpts = request.options.filter((o) => o.card);
  if (!cardOpts.length) return { ids: ['pass'] };
  if (ctx.me.compute <= 2 || ctx.counts.attack >= 2) {
    return { ids: [pickLowestValue(cardOpts, ctx, 1)[0]] };
  }
  return { ids: ['pass'] };
}

function respondDuel(request, ctx) {
  const cardOpts = request.options.filter((o) => o.card);
  if (!cardOpts.length) return { ids: ['pass'] };
  if (ctx.me.compute <= 1) return { ids: [pickLowestValue(cardOpts, ctx, 1)[0]] };
  if (cardOpts.length >= 2 || ctx.me.compute >= 4) {
    return { ids: [pickLowestValue(cardOpts, ctx, 1)[0]] };
  }
  return { ids: ['pass'] };
}

function chooseSteal(request, ctx) {
  const slots = request.options.filter((o) => o.id.startsWith('slot:'));
  const preference = ['slot:weapon', 'slot:distance_out', 'slot:distance_in', 'slot:task_code', 'slot:task_iti'];
  for (const want of preference) {
    const hit = slots.find((o) => o.id === want);
    if (hit) return { ids: [hit.id] };
  }
  if (slots.length) return { ids: [slots[0].id] };
  return { ids: ['hand'] };
}

function chooseDrawSource(request, ctx) {
  const donors = request.options.filter((o) => o.id !== 'deck');
  if (!donors.length) return { ids: ['deck'] };
  const ranked = donors
    .map((o) => ({ id: o.id, th: ctx.threats.get(Number(o.id)) ?? 0 }))
    .sort((a, b) => b.th - a.th);
  if (ranked[0].th <= 0) return { ids: ['deck'] };
  return { ids: [ranked[0].id] };
}

function chooseSelection(request, ctx) {
  const options = request.options;
  switch (request.purpose) {
    case 'judge_choice': {
      const ranked = options
        .filter((o) => o.card)
        .map((o) => ({ id: o.id, s: judgeScore(o.card, request.judgeFor, ctx) }))
        .sort((a, b) => b.s - a.s);
      return { ids: [ranked[0]?.id ?? options[0].id] };
    }
    case 'defense_response':
      return respondDefense(request, ctx);
    case 'dying_save':
      return respondDying(request, ctx);
    case 'challenge_response':
      return respondChallenge(request, ctx);
    case 'duel_response':
      return respondDuel(request, ctx);
    case 'steal_choice':
      return chooseSteal(request, ctx);
    case 'discard_victim_choice': {
      const weapon = options.find((o) => o.id === 'slot:weapon');
      return { ids: [weapon ? weapon.id : 'hand'] };
    }
    case 'draw_source':
      return chooseDrawSource(request, ctx);
    case 'general_store_pick':
      return { ids: [pickHighestValue(options, ctx)] };
    case 'reorder_deck_top': {
      const ranked = options
        .filter((o) => o.card)
        .slice()
        .sort((a, b) => cardValue(b.card, ctx) - cardValue(a.card, ctx));
      return { ids: ranked.map((o) => o.id) };
    }
    case 'return_to_deck':
    case 'forced_discard':
    case 'discard_to_limit':
    case 'task_discard':
    case 'ability_discard':
    case 'discard_choice':
      return { ids: pickLowestValue(options, ctx, request.max) };
    default:
      return { ids: options.slice(0, Math.max(request.min ?? 1, 1)).map((o) => o.id) };
  }
}

// ------------------------------------------------------------ 对外接口

export function createAi({ memory, roles, playerCount, rand = Math.random } = {}) {
  const ledger = memory ?? new TableMemory(playerCount);

  function decide({ player, request, view }) {
    const ctx = buildContext(player, view, ledger, roles, playerCount);

    if (request.type === 'play_action') {
      let best = null;
      let bestScore = 0; // 0 = 结束回合的基准分，正分才值得出牌
      for (const action of request.actions) {
        if (action.kind === 'end_turn') continue;
        const s = scoreAction(action, ctx) + (rand() - 0.5) * 1.5;
        if (s > bestScore) {
          bestScore = s;
          best = action;
        }
      }
      return best ?? { kind: 'end_turn' };
    }

    return chooseSelection(request, ctx);
  }

  return { decide, memory: ledger };
}

export { TableMemory, cardValue, threatScore, buildContext, ROLE };
