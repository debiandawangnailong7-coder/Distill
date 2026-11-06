/**
 * 公开行为账本。只消费引擎广播的 `relation` 事件，不读 state——
 * state 里有未公开的身份，AI 偷看就等于作弊。
 *
 * score[from][to] > 0 表示 from 对 to 表现出的敌意累积，< 0 表示友好。
 */
export class TableMemory {
  constructor(playerCount) {
    this.n = playerCount;
    this.score = Array.from({ length: playerCount }, () => new Array(playerCount).fill(0));
  }

  observe(event) {
    if (event.type !== 'relation') return;
    const { from, to, weight } = event;
    if (from == null || to == null || from === to) return;
    if (!this.score[from]) return;
    this.score[from][to] += weight;
  }

  hostility(from, to) {
    return this.score[from]?.[to] ?? 0;
  }

  /** 该玩家对场上其他人表现出的总敌意，用来判断他是不是「见谁打谁」的独狼。 */
  aggression(from) {
    return (this.score[from] ?? []).reduce((a, b) => a + Math.max(0, b), 0);
  }
}
