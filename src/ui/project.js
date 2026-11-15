/**
 * 协议投影层（纯函数，可单测）：把引擎 view(seat) 的输出整理成渲染用座位模型。
 *
 * 这是 UI 信息边界的执行点：渲染层只消费这里产出的模型——
 * 他人手牌只有 handCount 数字、身份只在引擎 revealed 后才有值，
 * 本家私有信息一律取 view.you。任何「想看他人隐藏信息」的需求都
 * 必须先回到引擎 view() 解决，不能在这里绕过。
 */

/** 本家最大算力。公式与引擎 rules.maxCompute 对齐：角色基础 + 主公加成。 */
export function maxComputeOf(you) {
  const bonus = you.role?.id === 'frontier_lab' ? (you.role.computeBonus ?? 0) : 0;
  return (you.character?.compute ?? 0) + bonus;
}

/** 本家当前射程（武器决定，无武器为 1）。 */
export function rangeOfYou(you) {
  return you.equipment?.weapon?.params?.range ?? 1;
}

/** 本家手牌上限（当前算力 + 产品槽加成）。 */
export function handLimitOf(you) {
  return Math.max(0, you.compute) + (you.equipment?.product?.params?.handLimitBonus ?? 0);
}

/** 本家某 Task 产品剩余次数（没装对应产品则为 0）。 */
export function taskUsesLeftOf(you, task) {
  const eq = you.equipment?.product;
  if (!eq || eq.typeId !== `task_${task}`) return 0;
  const perTurn = eq.params?.perTurn ?? 1;
  return Math.max(0, perTurn - (you.taskUses?.[task] ?? 0));
}

/** 角色是否带某机制（character.skills[].mechanic）。 */
export function hasMechanicOf(character, mechanic) {
  return (character?.skills ?? []).some((s) => s.mechanic === mechanic);
}

/**
 * 算力图标三态：满（i < compute）/ 损（存活但已损失）/ 空（出局或超出上限）。
 * 数量恒等于 maxCompute。
 */
export function computeStates(compute, maxCompute, alive = true) {
  return Array.from({ length: maxCompute }, (_, i) => {
    if (!alive || i >= maxCompute) return 'empty';
    return i < compute ? 'full' : 'hurt';
  });
}

/**
 * 装备四槽 → 三显示位：武器 / 道具（产品槽，含 RLHF 与 Task 产品）/
 * 马（distance_in + distance_out 合并，用 +1 / -1 小图标区分）。
 */
export function equipSlots(equipment = {}) {
  return {
    weapon: equipment.weapon ?? null,
    item: equipment.product ?? null,
    horseIn: equipment.distance_in ?? null,
    horseOut: equipment.distance_out ?? null,
  };
}

/**
 * 座位立绘轴：满算力拉普通立绘（portraits/），残血拉 Q 版（characters/），
 * 拉不到专属图由 assets 层退回奶蛙占位保底。豆包 Seed 的 Q 版与普通立绘
 * 本来就是同一张素材，无需特殊处理。
 */
export function seatArt(assets, character, { hurt } = {}) {
  return hurt ? assets?.character(character.id) : assets?.portrait(character.id);
}

/**
 * 由 view(seat) 快照生成全量座位模型（含本家，本家 isYou=true）。
 * meta 是客户端从公开事件流跟踪的公共状态（当前回合、终局等）。
 */
export function seatModels(view) {
  const you = view.you;
  const self = oneSeatModel({
    index: you.index,
    isYou: true,
    name: you.name,
    alive: you.alive,
    character: you.character,
    compute: you.compute,
    maxCompute: maxComputeOf(you),
    handCount: you.hand.length,
    equipment: you.equipment,
    jail: you.jail,
    dynamite: you.dynamite,
    role: you.role, // 自己的身份永远对自己可见
    distance: null,
    targetable: false,
  });
  const others = view.others.map((o) => oneSeatModel({
    index: o.index,
    isYou: false,
    name: o.name,
    alive: o.alive,
    character: o.character,
    compute: o.compute,
    maxCompute: o.maxCompute,
    handCount: o.handCount,
    equipment: o.equipment,
    jail: o.jail,
    dynamite: o.dynamite,
    role: o.role, // 引擎 revealed 语义：未公开为 null
    distance: o.distance,
    targetable: o.targetable,
  }));
  // 按座位号排序，保证渲染顺序稳定；本家座位由调用方旋转到正下方。
  return [self, ...others].sort((a, b) => a.index - b.index);
}

function oneSeatModel(data) {
  const hurt = data.alive && data.compute < data.maxCompute;
  return {
    ...data,
    hurt,
    roleKnown: data.role != null,
    slots: equipSlots(data.equipment),
  };
}

/**
 * 渲染投影：view 快照 + 事件流跟踪的公共元数据。
 * currentIndex / gameOver / result 引擎不放进 view，由客户端从
 * turnStart / gameOver 事件维护（公共信息，任何观战者都可见）。
 */
export function buildProjection(view, meta = {}) {
  return {
    seat: view.yourIndex,
    you: view.you,
    others: view.others,
    seats: seatModels(view),
    turnNumber: view.turnNumber,
    drawPileCount: view.drawPileCount,
    discardTop: view.discardTop,
    inPlay: view.inPlay,
    log: view.log,
    currentIndex: meta.currentIndex ?? null,
    extraTurn: Boolean(meta.extraTurn),
    gameOver: Boolean(meta.gameOver),
    result: meta.result ?? null,
  };
}

/** 按座位号取模型（本家或他人）。 */
export function seatByIndex(projection, index) {
  return projection.seats.find((s) => s.index === index) ?? null;
}

/** 座位环布局角度：本家固定在正下方，其余按座位号逆时针排开。 */
export function seatAngle(localSeat, index, count) {
  return Math.PI / 2 - (((index - localSeat + count) % count) * 2 * Math.PI) / count;
}
