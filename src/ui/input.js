import {
  maxComputeOf,
  rangeOfYou,
  hasMechanicOf,
} from './project.js';
import {
  actionsForCard,
  targetedActions,
  nonTargetActions,
  actionForTarget,
  actionForTargeting,
  actionGroupKey,
  actionGroupLabel,
  hasIntentChoice,
  actionLabel,
  endTurnAction,
  SLOT_LABEL,
} from './intent.js';

/**
 * 指针/键盘输入层（纯客户端）：只消费 view 投影，不读原始 state。
 * 桌面端优先拖拽；点击选牌 + 点座位是等价路径；键盘 1–9 / 方向键 / Enter / Esc。
 * 点空闲座位打开该角色的检视弹窗（技能 + 装备效果）。
 */
export function createInput({ motion, renderer, hints, getView, onIntent }) {
  const handHost = document.getElementById('hand');
  const seatHost = document.getElementById('seats');
  const table = document.getElementById('table');
  const rangeLayer = document.getElementById('rangeLayer');

  let drag = null;
  let rangeLine = null;
  let lastHintKey = null;
  let suppressSeatClickUntil = 0;
  let targetCursor = -1;

  const view = () => getView();
  const ui = () => getUi();
  // app 启动后注入（避免环引用）
  let getUi = () => ({});
  function bindUi(getter) { getUi = getter; }

  const isPlayPhase = () => ui().pending?.type === 'play_action';
  const localSeat = () => view()?.yourIndex ?? 0;

  function actsFor(uid) {
    return isPlayPhase() ? actionsForCard(ui().pending.actions, uid) : [];
  }

  function me() {
    return view()?.you ?? null;
  }

  function seatModel(index) {
    const v = view();
    if (!v) return null;
    if (v.yourIndex === index) {
      return {
        index,
        isYou: true,
        name: v.you.name,
        alive: v.you.alive,
        character: v.you.character,
        compute: v.you.compute,
        maxCompute: maxComputeOf(v.you),
        handCount: v.you.hand.length,
        equipment: v.you.equipment,
        distance: null,
        targetable: false,
      };
    }
    return v.others.find((o) => o.index === index) ?? null;
  }

  function cardName(uid) {
    return me()?.hand.find((c) => c.uid === uid)?.name ?? '手牌';
  }

  /**
   * 点一张不可用的牌时给出具体原因，而不是笼统的「不能使用」。
   * 减少「技能/道具/卡牌莫名失效」的误判。所有判断只走 view 投影数据。
   */
  function unavailableReason(uid) {
    const v = view();
    const you = v?.you;
    const card = you?.hand.find((c) => c.uid === uid);
    if (!card || !you || !v) return '这张牌现在不能使用。';
    const aliveOthers = v.others.filter((o) => o.alive);
    switch (card.kind) {
      case 'defense':
        return '「合规声明」只能在被指控时作为响应打出。';
      case 'attack': {
        const inRange = aliveOthers.filter((o) => o.targetable);
        if (!inRange.length) {
          const nearest = aliveOthers.length
            ? Math.min(...aliveOthers.map((o) => o.distance ?? Infinity))
            : 0;
          return `射程内没有目标：当前射程 ${rangeOfYou(you)}，最近对手距离 ${nearest}。可以先装备基建武器。`;
        }
        return '本回合的「蒸馏指控」次数已经用完。';
      }
      case 'heal':
        if (you.compute >= maxComputeOf(you)) return '算力已满，无法继续回复。';
        return '仅剩 2 人时不能主动使用「融资到账」。';
      case 'steal':
      case 'force_discard': {
        const maxD = card.params?.maxDistance ?? 1;
        const hasTarget = aliveOthers.some(
          (o) => (o.distance ?? Infinity) <= maxD &&
            (o.handCount > 0 || Object.values(o.equipment ?? {}).some(Boolean))
        );
        if (hasTarget) return '这张牌现在不能使用。';
        return `有效距离 ${maxD} 内没有可抽取/弃牌的目标。`;
      }
      case 'jail':
        return v.inPlay.jail ? '场上已经有一张「账号封禁」。' : '这张牌现在不能使用。';
      case 'dynamite':
        return v.inPlay.dynamite ? '场上已经有一张「AGI 宣言」。' : '这张牌现在不能使用。';
      case 'mass_heal':
        return aliveOthers.length <= 1 ? '仅剩 2 人时不能主动使用群体回复。' : '这张牌现在不能使用。';
      case 'distance':
      case 'product': {
        const slot = card.slot;
        if (slot && you.equipment[slot]) {
          return `「${SLOT_LABEL[slot] ?? slot}」槽位已经有装备，同槽位不能叠放。`;
        }
        return '这张装备现在不能使用。';
      }
      default:
        return '这张牌现在不能使用。';
    }
  }

  function targetSeats() {
    const actions = ui().targeting?.actions ?? [];
    return [...new Set(actions.map((a) => a.targetIndex))].filter((i) => i != null);
  }

  function clearRange() {
    motion.clearRangeLine(rangeLine);
    rangeLine = null;
  }

  function endDragVisuals() {
    clearRange();
    renderer.clearDropTarget();
    renderer.render(projectionOf(), ui());
    hints.hide();
    lastHintKey = null;
  }

  // input 只持有 view；投影组装交给 app 注入，避免两处重复维护 meta。
  let projectionOf = () => null;
  function bindProjection(fn) { projectionOf = fn; }

  function makeGhost(cardEl) {
    const ghost = cardEl.cloneNode(true);
    ghost.classList.add('dragGhost');
    ghost.classList.remove('sel', 'dragging');
    ghost.style.width = `${cardEl.getBoundingClientRect().width}px`;
    ghost.style.height = `${cardEl.getBoundingClientRect().height}px`;
    document.body.appendChild(ghost);
    return ghost;
  }

  function moveGhost(ghost, clientX, clientY) {
    if (!ghost) return;
    const w = ghost.offsetWidth || 112;
    const h = ghost.offsetHeight || 156;
    ghost.style.left = `${clientX - w / 2}px`;
    ghost.style.top = `${clientY - h / 2}px`;
  }

  function hintForTarget(action, targetIndex, uid = null) {
    const target = seatModel(targetIndex);
    const you = me();
    if (!you || !target) return '';
    const dist = target.distance ?? '—';
    const range = rangeOfYou(you);
    const bits = [`<b>${actionLabel(action)}</b>`, `距离 ${dist} / 射程 ${range}`];
    if (action.asAttack || action.typeId === 'attack') {
      const need = hasMechanicOf(target.character, 'attack_needs_two_defenses') ? 2 : 1;
      bits.push(need === 2 ? '目标需要 2 张「合规声明」' : '命中后目标失去 1 点算力');
    }
    if (uid && hasIntentChoice(ui().pending.actions, uid, targetIndex)) {
      bits.push('<b>Tab</b> 切换：当作指控 / 正常使用');
    }
    return bits.join('<br>');
  }

  function updateTarget(targetIndex, clientX, clientY) {
    const v = view();
    const u = ui();
    const target = seatModel(targetIndex);
    if (!v || !target) return;
    const action = actionForTarget(u.pending.actions, drag.uid, targetIndex, u.preferAsAttack);
    if (!action) {
      u.dropTargetIndex = null;
      renderer.setDropTarget(null);
      clearRange();
      const key = `x:${targetIndex}`;
      if (lastHintKey !== key) {
        lastHintKey = key;
        hints.show(`这张牌不能对 <b>${target.name}</b> 使用<br>距离 ${target.distance ?? '—'} / 射程 ${rangeOfYou(v.you)}`, renderer.seatEl(targetIndex), { force: true });
      }
      return;
    }
    u.dropTargetIndex = targetIndex;
    renderer.setDropTarget(targetIndex);
    const key = `${targetIndex}:${u.preferAsAttack ? 'a' : 'n'}:${action.label}`;
    if (lastHintKey !== key) {
      lastHintKey = key;
      hints.show(hintForTarget(action, targetIndex, drag.uid), renderer.seatEl(targetIndex), { force: true });
      if (ui().targeting) {
        hints.coach('target', '拖动到发光的座位就能指定目标；Esc 随时取消。', renderer.seatEl(targetIndex));
      }
    }
    clearRange();
    rangeLine = motion.rangeLine(rangeLayer, renderer.seatEl(localSeat()), renderer.seatEl(targetIndex));
  }

  function commit(action) {
    endDragVisuals();
    ui().selectedCardUid = null;
    ui().targeting = null;
    ui().dropTargetIndex = null;
    onIntent?.(action);
  }

  function selectCard(uid) {
    const u = ui();
    if (u.selectedCardUid === uid) {
      cancel();
      return;
    }
    const targeted = targetedActions(u.pending.actions, uid);
    u.selectedCardUid = uid;
    u.preferAsAttack = false;
    u.targeting = targeted.length ? { actions: targeted, label: cardName(uid), source: 'card' } : null;
    renderer.render(projectionOf(), u);
    hints.brief(targeted.length
      ? `「${cardName(uid)}」— 拖到高亮座位，或点击座位`
      : `「${cardName(uid)}」— 在右侧选择用法，或拖到桌面中央`);
    if (targeted.length) {
      hints.coach('select', '把牌拖到发光的座位即可指定目标；也可以直接点击座位。', renderer.handEl(uid));
    }
  }

  function cancel() {
    const u = ui();
    u.selectedCardUid = null;
    u.targeting = null;
    u.dropTargetIndex = null;
    u.preferAsAttack = false;
    targetCursor = -1;
    endDragVisuals();
    hints.brief('');
  }

  /** 当前瞄准状态（手牌或主动 Task）在某个座位上的具体行动。 */
  function actionAtTarget(index) {
    const u = ui();
    if (u.selectedCardUid) {
      return actionForTarget(u.pending.actions, u.selectedCardUid, index, u.preferAsAttack);
    }
    if (u.targeting?.source === 'action') {
      return actionForTargeting(u.targeting, index);
    }
    return null;
  }

  /**
   * 行动面板的统一入口：需要选目标的主动效果先进入瞄准状态，
   * 其余行动直接提交。
   */
  function handleAction(action) {
    if (!action || !isPlayPhase()) return;
    if (action.cardUid != null || action.targetIndex == null) {
      commit(action);
      return;
    }
    const u = ui();
    const key = actionGroupKey(action);
    const group = u.pending.actions.filter(
      (a) => a.cardUid == null && a.targetIndex != null && actionGroupKey(a) === key
    );
    if (!group.length) {
      commit(action);
      return;
    }
    u.selectedCardUid = null;
    u.dropTargetIndex = null;
    u.preferAsAttack = false;
    u.targeting = { actions: group, label: actionGroupLabel(action), source: 'action' };
    targetCursor = -1;
    renderer.render(projectionOf(), u);
    hints.brief(`「${u.targeting.label}」— 点击高亮座位指定目标。Esc 取消。`);
  }

  function onPointerDown(e) {
    if (e.button != null && e.button !== 0) return;
    if (!isPlayPhase()) return;
    const cardEl = e.target.closest?.('.handCard[data-uid]');
    if (!cardEl) return;
    const uid = cardEl.dataset.uid;
    const acts = actsFor(uid);
    if (!acts.length) {
      hints.show(unavailableReason(uid), cardEl, { force: true });
      return;
    }
    e.preventDefault();
    drag = {
      uid,
      cardEl,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      ghost: null,
      actions: acts,
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
  }

  function onPointerMove(e) {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 7) return;
    if (!drag.moved) {
      drag.moved = true;
      drag.ghost = makeGhost(drag.cardEl);
      drag.cardEl.classList.add('dragging');
      const u = ui();
      const targeted = targetedActions(u.pending.actions, drag.uid);
      u.selectedCardUid = drag.uid;
      u.targeting = targeted.length ? { actions: targeted, label: cardName(drag.uid), source: 'card' } : null;
      renderer.render(projectionOf(), u);
    }
    moveGhost(drag.ghost, e.clientX, e.clientY);

    const under = document.elementFromPoint(e.clientX, e.clientY);
    const seat = under?.closest?.('.seat[data-index]');
    if (seat) {
      updateTarget(Number(seat.dataset.index), e.clientX, e.clientY);
      return;
    }
    const u = ui();
    u.dropTargetIndex = null;
    renderer.setDropTarget(null);
    clearRange();
    const nt = nonTargetActions(u.pending.actions, drag.uid);
    const overCenter = under?.closest?.('#center, #piles, #stage, #table');
    const key = `center:${nt.length}`;
    if (overCenter && nt.length && lastHintKey !== key) {
      lastHintKey = key;
      hints.show(`<b>${actionLabel(nt[0])}</b><br>松手使用`, drag.ghost, { force: true });
    } else if (!overCenter && lastHintKey !== 'outside') {
      lastHintKey = 'outside';
      hints.show('拖到发光座位指定目标，或拖到桌面中央直接使用。', drag.ghost, { force: true });
    }
  }

  function onPointerUp(e) {
    window.removeEventListener('pointermove', onPointerMove);
    if (!drag) return;
    const d = drag;
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const seat = under?.closest?.('.seat[data-index]');
    const u = ui();

    if (!d.moved) {
      drag = null;
      selectCard(d.uid);
      return;
    }

    d.ghost?.remove();
    d.cardEl.classList.remove('dragging');
    suppressSeatClickUntil = Date.now() + 350;

    if (seat) {
      const action = actionForTarget(u.pending.actions, d.uid, Number(seat.dataset.index), u.preferAsAttack);
      if (action) {
        drag = null;
        commit(action);
        return;
      }
    }

    const overCenter = under?.closest?.('#center, #piles, #stage, #table');
    const nt = nonTargetActions(u.pending.actions, d.uid);
    if (overCenter && !seat && nt.length) {
      drag = null;
      commit(nt[0]);
      return;
    }

    drag = null;
    endDragVisuals();
  }

  function onSeatClick(e) {
    if (Date.now() < suppressSeatClickUntil) return;
    const seatEl = e.target.closest?.('.seat[data-index]');
    if (!seatEl) return;
    const index = Number(seatEl.dataset.index);
    // 出牌阶段且正在瞄准 → 座位是攻击目标，点击即提交；否则点开检视弹窗。
    if (isPlayPhase() && (ui().selectedCardUid || ui().targeting)) {
      const action = actionAtTarget(index);
      if (!action) {
        renderer.toast(ui().targeting?.source === 'action' ? '这个效果不能对该目标使用' : '这张牌不能对该目标使用', 'bad');
        return;
      }
      commit(action);
      return;
    }
    renderer.openInspect(index);
  }

  function onKeyDown(e) {
    if (e.defaultPrevented) return;
    const tag = document.activeElement?.tagName;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag ?? '')) return;
    const focusModalOpen = !document.getElementById('focusModal')?.classList.contains('hidden');
    if (focusModalOpen) {
      if (e.key === 'Escape') {
        // 弹窗优先消费 Esc：交互窗收起、检视窗关闭
        e.preventDefault();
        renderer.handleEscape();
      }
      return;
    }
    const u = ui();
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
      return;
    }
    if (!isPlayPhase()) return;

    if (e.key === 'e' || e.key === 'E') {
      const end = endTurnAction(u.pending.actions);
      if (end) {
        e.preventDefault();
        commit(end);
      }
      return;
    }

    if (/^[1-9]$/.test(e.key)) {
      const hand = me()?.hand ?? [];
      const idx = Number(e.key) - 1;
      if (hand[idx]) {
        e.preventDefault();
        selectCard(hand[idx].uid);
      }
      return;
    }

    if (!u.selectedCardUid && !u.targeting) return;
    const targets = targetSeats();
    if ((e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowUp') && targets.length) {
      e.preventDefault();
      targetCursor = (targetCursor + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + targets.length) % targets.length;
      const idx = targets[targetCursor];
      u.dropTargetIndex = idx;
      renderer.setDropTarget(idx);
      const action = actionAtTarget(idx);
      if (action) {
        hints.show(hintForTarget(action, idx, u.selectedCardUid), renderer.seatEl(idx), { force: true });
        clearRange();
        rangeLine = motion.rangeLine(rangeLayer, renderer.seatEl(localSeat()), renderer.seatEl(idx));
      }
      return;
    }

    if (e.key === 'Tab') {
      const idx = u.dropTargetIndex ?? targets[0];
      if (u.selectedCardUid && idx != null && hasIntentChoice(u.pending.actions, u.selectedCardUid, idx)) {
        e.preventDefault();
        u.preferAsAttack = !u.preferAsAttack;
        const action = actionForTarget(u.pending.actions, u.selectedCardUid, idx, u.preferAsAttack);
        if (action) hints.show(hintForTarget(action, idx, u.selectedCardUid), renderer.seatEl(idx), { force: true });
      }
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (u.dropTargetIndex != null) {
        const action = actionAtTarget(u.dropTargetIndex);
        if (action) commit(action);
      } else if (u.selectedCardUid) {
        const nt = nonTargetActions(u.pending.actions, u.selectedCardUid);
        if (nt.length === 1) commit(nt[0]);
        else if (nt.length > 1) renderer.toast('这张牌有多种用法，请在右侧选择', 'gold');
      }
    }
  }

  handHost.addEventListener('pointerdown', onPointerDown);
  seatHost.addEventListener('click', onSeatClick);
  window.addEventListener('keydown', onKeyDown);
  // 点击桌面空白取消选择（弹窗、抽屉、设置除外）
  table.addEventListener('click', (e) => {
    if (Date.now() < suppressSeatClickUntil) return;
    if (e.target.closest?.('.seat, .handCard, #focusModal, #settingsPanel, #logDrawer')) return;
    if (ui().selectedCardUid) cancel();
  });

  return {
    cancel,
    handleAction,
    bindUi,
    bindProjection,
    refresh: () => renderer.render(projectionOf(), ui()),
  };
}
