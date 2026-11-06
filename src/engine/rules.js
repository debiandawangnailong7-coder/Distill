export const ROLE = {
  LAB: 'frontier_lab',
  PARTNER: 'licensed_partner',
  DISTILLER: 'distiller',
  LONE_WOLF: 'lone_wolf',
};

export function hasMechanic(player, mechanic) {
  return player.character?.mechanic === mechanic;
}

export function alivePlayers(state) {
  return state.players.filter((p) => p.alive);
}

export function maxCompute(player) {
  return player.character.compute + (player.role.id === ROLE.LAB ? player.role.computeBonus : 0);
}

/** BANG! 的距离只在存活玩家之间计算，出局者被跳过。 */
export function seatDistance(state, fromIndex, toIndex) {
  const alive = alivePlayers(state).map((p) => p.index);
  const n = alive.length;
  const a = alive.indexOf(fromIndex);
  const b = alive.indexOf(toIndex);
  if (a === -1 || b === -1) return Infinity;
  return Math.min((b - a + n) % n, (a - b + n) % n);
}

export function effectiveDistance(state, from, to) {
  let d = seatDistance(state, from.index, to.index);
  if (to.equipment.distance_in) d += 1;
  if (hasMechanic(to, 'incoming_distance_plus_one')) d += 1;
  if (from.equipment.distance_out) d -= 1;
  if (hasMechanic(from, 'outgoing_distance_minus_one')) d -= 1;
  return Math.max(1, d);
}

export function rangeOf(player) {
  return player.equipment.weapon?.params.range ?? 1;
}

export function canTarget(state, from, to) {
  return from.alive && to.alive && from.index !== to.index &&
    effectiveDistance(state, from, to) <= rangeOf(from);
}

export function unlimitedAttacks(player) {
  return hasMechanic(player, 'unlimited_attacks_per_turn') ||
    player.equipment.weapon?.params.unlimitedAttacks === true;
}

export function attacksLeft(player) {
  return unlimitedAttacks(player) ? Infinity : Math.max(0, 1 - player.attacksThisTurn);
}

export function handLimit(player) {
  const base = Math.max(0, player.compute);
  return base + (player.equipment.task_chat?.params.handLimitBonus ?? 0);
}

export function taskUsesLeft(player, task) {
  const eq = player.equipment[`task_${task}`];
  if (!eq) return 0;
  const perTurn = eq.params.perTurn ?? 1;
  return Math.max(0, perTurn - (player.taskUses[task] ?? 0));
}

/**
 * 胜负判定。开源独狼「唯一存活」优先于「实验室已死」——
 * 独狼在最后一刀同时清掉实验室时应当算独狼赢，这是 BANG! 叛徒的核心规则。
 */
export function checkWinner(state) {
  const alive = alivePlayers(state);
  const lab = state.players.find((p) => p.role.id === ROLE.LAB);

  if (alive.length === 1 && alive[0].role.id === ROLE.LONE_WOLF) {
    return { winner: ROLE.LONE_WOLF, reason: '开源独狼成为唯一存活者' };
  }
  if (!lab.alive) {
    return { winner: ROLE.DISTILLER, reason: '前沿实验室出局' };
  }
  const threats = alive.filter((p) => p.role.id === ROLE.DISTILLER || p.role.id === ROLE.LONE_WOLF);
  if (threats.length === 0) {
    return { winner: ROLE.LAB, reason: '所有蒸馏者与开源独狼均已出局' };
  }
  return null;
}
