import { rules } from '../engine/index.js';
import { createCharacterCard, skillDetailText } from './characterCard.js';
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
 * 指针/键盘输入层。
 * 桌面端优先拖拽；点击选牌 + 点座位是等价路径；键盘 1–9 / 方向键 / Enter / Esc。
 */
export function createInput({ assets, motion, renderer, hints, getState, getUi, onIntent, onFastToggle }) {
  const handHost = document.getElementById('hand');
  const seatHost = document.getElementById('seats');
  const table = document.getElementById('table');
  const rangeLayer = document.getElementById('rangeLayer');

  let drag = null;
  let rangeLine = null;
  let lastHintKey = null;
  let suppressSeatClickUntil = 0;
  let targetCursor = -1;

  const ui = () => getUi();
  const state = () => getState();
  const isPlayPhase = () => ui().pending?.type === 'play_action';

  function actsFor(uid) {
    return isPlayPhase() ? actionsForCard(ui().pending.actions, uid) : [];
  }

  function human() {
    return state()?.players?.[0] ?? null;
  }

  function cardName(uid) {
    return human()?.hand.find((c) => c.uid === uid)?.name ?? '手牌';
  }

  /**
   * 点一张不可用的牌时给出具体原因，而不是笼统的「不能使用」。
   * 减少「技能/道具/卡牌莫名失效」的误判。
   */
  function unavailableReason(uid) {
    const me = human();
    const s = state();
    const card = me?.hand.find((c) => c.uid === uid);
    if (!card || !me || !s) return '这张牌现在不能使用。';
    const others = s.players.filter((p) => p.alive && p.index !== me.index);
    switch (card.kind) {
      case 'defense':
        return '「合规声明」只能在被指控时作为响应打出。';
      case 'attack': {
        const inRange = others.filter((p) => rules.canTarget(s, me, p));
        if (!inRange.length) {
          const nearest = others.length
            ? Math.min(...others.map((p) => rules.effectiveDistance(s, me, p)))
            : 0;
          return `射程内没有目标：当前射程 ${rules.rangeOf(me)}，最近对手距离 ${nearest}。可以先装备基建武器。`;
        }
        return '本回合的「蒸馏指控」次数已经用完。';
      }
      case 'heal':
        if (me.compute >= rules.maxCompute(me)) return '算力已满，无法继续回复。';
        return '仅剩 2 人时不能主动使用「融资到账」。';
      case 'steal':
      case 'force_discard':
        return '有效距离 1 内没有可抽取/弃牌的目标。';
      case 'jail':
        return '场上已经有一张「账号封禁」。';
      case 'dynamite':
        return '场上已经有一张「AGI 宣言」。';
      case 'mass_heal':
        return '仅剩 2 人时不能主动使用群体回复。';
      case 'distance':
      case 'product': {
        const slot = card.slot;
        if (slot && me.equipment[slot]) {
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
    renderer.render(state(), ui());
    hints.hide();
    lastHintKey = null;
  }

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
    const s = state();
    const me = s.players[0];
    const target = s.players[targetIndex];
    if (!me || !target) return '';
    const dist = rules.effectiveDistance(s, me, target);
    const range = rules.rangeOf(me);
    const bits = [`<b>${actionLabel(action)}</b>`, `距离 ${dist} / 射程 ${range}`];
    if (action.asAttack || action.typeId === 'attack') {
      const need = rules.hasMechanic(target, 'attack_needs_two_defenses') ? 2 : 1;
      bits.push(need === 2 ? '目标需要 2 张「合规声明」' : '命中后目标失去 1 点算力');
    }
    if (uid && hasIntentChoice(ui().pending.actions, uid, targetIndex)) {
      bits.push('<b>Tab</b> 切换：当作指控 / 正常使用');
    }
    return bits.join('<br>');
  }

  function updateTarget(targetIndex, clientX, clientY) {
    const s = state();
    const u = ui();
    const target = s?.players?.[targetIndex];
    if (!target) return;
    const action = actionForTarget(u.pending.actions, drag.uid, targetIndex, u.preferAsAttack);
    if (!action) {
      u.dropTargetIndex = null;
      renderer.setDropTarget(null);
      clearRange();
      const key = `x:${targetIndex}`;
      if (lastHintKey !== key) {
        lastHintKey = key;
        hints.show(`这张牌不能对 <b>${target.name}</b> 使用<br>距离 ${rules.effectiveDistance(s, s.players[0], target)} / 射程 ${rules.rangeOf(s.players[0])}`, renderer.seatEl(targetIndex), { force: true });
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
    rangeLine = motion.rangeLine(rangeLayer, renderer.seatEl(0), renderer.seatEl(targetIndex));
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
    renderer.render(state(), u);
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
   * 其余行动直接提交。修复【生产力杠杆】【舆论广播】没有任何 UI 入口的问题。
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
    renderer.render(state(), u);
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
      renderer.render(state(), u);
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
    if (!isPlayPhase()) return;
    const seatEl = e.target.closest?.('.seat[data-index]');
    if (!seatEl) return;
    const index = Number(seatEl.dataset.index);
    const u = ui();
    if (!u.selectedCardUid && !u.targeting) {
      const target = state()?.players?.[index];
      if (target && index !== 0) {
        // 局内角色预览：与开场角色墙共用同一张角色卡（换用 Q 版美术轴），
        // 点空闲座位即可查看对手的角色与技能。
        const card = createCharacterCard(target.character, { assets, art: 'avatar', size: 'sm' });
        const detail = document.createElement('div');
        detail.className = 'charCardDetail';
        detail.textContent = skillDetailText(target.character);
        const wrap = document.createElement('div');
        wrap.className = 'seatPreview';
        wrap.appendChild(card);
        wrap.appendChild(detail);
        hints.show(wrap.innerHTML, seatEl, { force: true });
      }
      return;
    }
    const action = actionAtTarget(index);
    if (!action) {
      renderer.toast(u.targeting?.source === 'action' ? '这个效果不能对该目标使用' : '这张牌不能对该目标使用', 'bad');
      return;
    }
    commit(action);
  }

  function onKeyDown(e) {
    if (e.defaultPrevented) return;
    const tag = document.activeElement?.tagName;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag ?? '')) return;
    const modalOpen = !document.getElementById('modal')?.classList.contains('hidden');
    const responseOpen = !document.getElementById('responseTray')?.classList.contains('hidden');
    if (modalOpen || responseOpen) {
      if (e.key === 'Escape') {
        // 由 app 的取消逻辑处理，这里只阻止穿透
        e.preventDefault();
      }
      return;
    }
    const u = ui();
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
      return;
    }
    if (e.key === 'f' || e.key === 'F') {
      onFastToggle?.();
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
      const hand = human()?.hand ?? [];
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
        rangeLine = motion.rangeLine(rangeLayer, renderer.seatEl(0), renderer.seatEl(idx));
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
  // 点击桌面空白取消选择
  table.addEventListener('click', (e) => {
    if (Date.now() < suppressSeatClickUntil) return;
    if (e.target.closest?.('.seat, .handCard, #modal, #responseTray, #settingsPanel')) return;
    if (ui().selectedCardUid) cancel();
  });

  return { cancel, handleAction, refresh: () => renderer.render(state(), ui()) };
}
