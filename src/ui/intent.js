/** 纯 UI 意图层：把引擎下发的合法行动整理成拖拽/点击可用的意图。 */

export const SUIT = { spade: '♠', heart: '♥', club: '♣', diamond: '♦' };
export const RANK = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
export const ROLE_LABEL = {
  frontier_lab: '前沿实验室',
  licensed_partner: '授权被许可方',
  distiller: '未授权蒸馏者',
  lone_wolf: '开源独狼',
};
export const SLOT_LABEL = {
  weapon: '基建',
  distance_in: '护城河',
  distance_out: '渠道',
  support: '辅助',
  task_chat: 'Chat',
  task_code: 'Code',
  task_office: '办公',
  task_tts: 'TTS',
  task_stt: 'STT',
  task_iti: 'ITI',
};

export function faceLabel(card) {
  return `${SUIT[card.suit] ?? '?'}${RANK[card.rank] ?? card.rank}`;
}

export function cardTitle(card) {
  return `${card.name}${card.flavor ? ` · ${card.flavor}` : ''}`;
}

export function kindClass(card) {
  if (card.category === 'equipment') return 'k-equip';
  if (card.kind === 'attack') return 'k-attack';
  if (card.kind === 'defense') return 'k-defense';
  return 'k-action';
}

export function kindLabel(card) {
  if (card.category === 'equipment') return '装备';
  if (card.kind === 'attack') return '指控';
  if (card.kind === 'defense') return '声明';
  return '行动';
}

export function actionsForCard(actions, uid) {
  return actions.filter((a) => a.cardUid === uid);
}

/**
 * 没有手牌归属、但需要指定目标的主动效果（Task【生产力杠杆】【舆论广播】）。
 * 这类行动不能通过选牌触发，必须由行动面板进入“选择目标”状态。
 */
export function targetedNonCardActions(actions) {
  return actions.filter((a) => a.kind !== 'end_turn' && a.cardUid == null && a.targetIndex != null);
}

/** 同一条主动效果会按目标展开成多个行动，用 kind + task/ability 归组。 */
export function actionGroupKey(action) {
  return `${action.kind}:${action.task ?? action.ability ?? ''}`;
}

/** 行动面板只显示一个入口；具体目标在进入瞄准状态后选择。 */
export function groupTargetedActions(actions) {
  const seen = new Set();
  const out = [];
  for (const a of targetedNonCardActions(actions)) {
    const key = actionGroupKey(a);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

/** 归组后的入口文案，去掉「→ 目标名」之类的按目标后缀。 */
export function actionGroupLabel(action) {
  return action.labelBase ?? action.label ?? action.kind ?? '行动';
}

/** 在瞄准状态下按座位索引取回对应行动；兼容手牌的正常/当作指控两种意图。 */
export function actionForTargeting(targeting, targetIndex, preferAsAttack = false) {
  if (!targeting?.actions) return null;
  const pool = targeting.actions.filter((a) => a.targetIndex === targetIndex);
  if (!pool.length) return null;
  if (pool.length === 1) return pool[0];
  return pool.find((a) => (a.asAttack === true) === preferAsAttack) ?? pool[0];
}

export function targetedActions(actions, uid) {
  return actionsForCard(actions, uid).filter((a) => a.targetIndex != null);
}

export function nonTargetActions(actions, uid) {
  return actionsForCard(actions, uid).filter((a) => a.targetIndex == null);
}

/**
 * 同一张牌、同一个目标可能有多个意图（例如 GPT-4o 的「当作指控」和原本效果）。
 * 默认选正常效果；按住 Tab 或点击意图开关时切到 asAttack。
 */
export function actionForTarget(actions, uid, targetIndex, preferAsAttack = false) {
  const pool = actions.filter((a) => a.cardUid === uid && a.targetIndex === targetIndex);
  if (!pool.length) return null;
  if (pool.length === 1) return pool[0];
  const preferred = pool.find((a) => (a.asAttack === true) === preferAsAttack);
  return preferred ?? pool[0];
}

export function hasIntentChoice(actions, uid, targetIndex) {
  const pool = actions.filter((a) => a.cardUid === uid && a.targetIndex === targetIndex);
  return pool.some((a) => a.asAttack === true) && pool.some((a) => a.asAttack !== true);
}

export function actionTone(action) {
  if (action.kind === 'end_turn') return 'primary';
  if (action.kind === 'task') return 'task';
  if (action.kind === 'character_ability') return 'task';
  if (action.asAttack) return 'attack';
  return 'equip';
}

export function actionLabel(action) {
  return action.label ?? action.kind ?? '行动';
}

/** 当前手牌是否还有可打出的行动（排除结束回合）。 */
export function playableActions(actions) {
  return actions.filter((a) => a.kind !== 'end_turn');
}

export function endTurnAction(actions) {
  return actions.find((a) => a.kind === 'end_turn') ?? null;
}

export function cardById(hand, uid) {
  return hand.find((c) => c.uid === uid) ?? null;
}
