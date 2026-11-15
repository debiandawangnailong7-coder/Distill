/**
 * 单一焦点弹窗仲裁（纯状态机，可单测）：游戏页同时至多一个大弹窗。
 *
 * 两类内容争夺焦点：
 *   interaction — 引擎请求（select / play_action 的强制交互），优先级高；
 *   inspect     — 点座位卡的技能/装备检视，自愿。
 *
 * 规则：
 *   1. 交互窗打开时抢占焦点，检视窗让位（回到「准备视检」的空闲态）。
 *   2. 交互窗可收起为待处理徽标；收起期间检视窗可以占用弹窗。
 *   3. 待处理徽标点击恢复交互窗时，检视窗让位。
 *   4. 交互窗随决策完成而关闭，不残留。
 */

export function createFocus() {
  let interaction = null; // { request } —— 有值即存在待处理交互（无论展开/收起）
  let minimized = false;
  let inspect = null; // { seat }

  function openInteraction(request) {
    interaction = { request };
    minimized = false;
    inspect = null; // 交互优先：检视窗让位
    return current();
  }

  /** 决策已提交或请求被取消：交互窗彻底关闭。 */
  function dismissInteraction() {
    interaction = null;
    minimized = false;
    return current();
  }

  /** 收起为待处理徽标；没有交互时不产生副作用。 */
  function minimizeInteraction() {
    if (!interaction) return current();
    minimized = true;
    return current();
  }

  function restoreInteraction() {
    if (!interaction) return current();
    minimized = false;
    inspect = null; // 恢复交互 = 抢占焦点
    return current();
  }

  /** 检视窗只在没人占用弹窗时打开；交互展开时直接被拒绝。 */
  function openInspect(seat) {
    if (interaction && !minimized) return { ok: false, reason: 'interaction' };
    inspect = { seat };
    return { ok: true, ...current() };
  }

  function closeInspect() {
    inspect = null;
    return current();
  }

  /** 此刻弹窗应显示的内容：'interaction' | 'inspect' | null。 */
  function current() {
    if (interaction && !minimized) return { view: 'interaction', request: interaction.request, minimized: false, pending: true, inspect: null };
    if (inspect) return { view: 'inspect', seat: inspect.seat, minimized, pending: interaction != null, inspect: inspect.seat };
    return { view: null, minimized, pending: interaction != null, inspect: null };
  }

  return {
    openInteraction,
    dismissInteraction,
    minimizeInteraction,
    restoreInteraction,
    openInspect,
    closeInspect,
    current,
    /** 有待处理交互（含收起态）——待处理徽标是否出现。 */
    hasPending: () => interaction != null,
    /** 弹窗是否正被交互占用（未收起）——输入层据此禁止座位点击检视。 */
    interactionOpen: () => interaction != null && !minimized,
  };
}
