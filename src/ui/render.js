import { rules } from '../engine/index.js';
import { skillLine, skillDetailText } from './characterCard.js';
import {
  ROLE_LABEL,
  SLOT_LABEL,
  faceLabel,
  cardTitle,
  kindClass,
  kindLabel,
  actionsForCard,
  actionForTarget,
  actionTone,
  actionLabel,
  actionGroupLabel,
  groupTargetedActions,
  endTurnAction,
} from './intent.js';

const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function imgTag(src, cls, alt = '') {
  if (!src) return null;
  const image = document.createElement('img');
  image.className = cls;
  image.src = src;
  image.alt = alt;
  image.loading = 'eager';
  image.decoding = 'async';
  return image;
}

export function createRenderer({ assets, hints, onAction, onSelectCard, onCancel, onModalResolve, onResponseResolve }) {
  const refs = {
    seats: $('seats'),
    hand: $('hand'),
    handWrap: $('handWrap'),
    youInfo: $('youInfo'),
    stage: $('stage'),
    drawPile: $('drawPile'),
    discardPile: $('discardPile'),
    log: $('log'),
    prompt: $('prompt'),
    actions: $('actions'),
    turnInfo: $('turnInfo'),
    phaseInfo: $('phaseInfo'),
    turnRibbon: $('turnRibbon'),
    hintLine: $('hintLine'),
    modal: $('modal'),
    modalKicker: $('modalKicker'),
    modalPrompt: $('modalPrompt'),
    modalOptions: $('modalOptions'),
    modalHint: $('modalHint'),
    modalConfirm: $('modalConfirm'),
    responseTray: $('responseTray'),
    overlay: $('overlay'),
    overlayTitle: $('overlayTitle'),
    overlayBody: $('overlayBody'),
    overlayBtn: $('overlayBtn'),
    toastLayer: $('toastLayer'),
  };

  const seatMap = new Map();
  const handMap = new Map();
  const stageMap = new Map();
  const hurtTimers = new Map();
  let logCursor = 0;
  let modalState = null;
  let responseState = null;

  // ------------------------------------------------------------ atoms

  function createCardEl(card, { size = 'hand' } = {}) {
    const cardEl = el('div', `card ${kindClass(card)}`);
    cardEl.dataset.uid = card.uid;
    if (size === 'hand') cardEl.classList.add('handCard');
    if (size === 'stage') cardEl.classList.add('stageCard');
    if (size === 'small') cardEl.classList.add('smallCard');
    cardEl.title = `${cardTitle(card)}\n${card.effect ?? ''}`;

    const top = el('div', 'cardTop');
    const face = el('span', `cardFace${card.suit === 'heart' || card.suit === 'diamond' ? ' red' : ''}`, faceLabel(card));
    top.appendChild(face);
    const icon = imgTag(assets?.card(card), 'cardIcon', cardTitle(card));
    if (icon) top.appendChild(icon);
    cardEl.appendChild(top);

    cardEl.appendChild(el('div', 'cardName', card.name));
    if (card.flavor) cardEl.appendChild(el('div', 'cardFlavor', card.flavor));
    if (card.effect) cardEl.appendChild(el('div', 'cardEffect', card.effect));
    cardEl.appendChild(el('div', 'cardTypeTag', kindLabel(card)));
    return cardEl;
  }

  function createSeat(index) {
    const seat = el('div', 'seat');
    seat.dataset.index = String(index);
    seat.innerHTML = `
      <div class="seatHead">
        <div class="avatarWrap">
          <img class="seatAvatar" alt="" decoding="async">
          <span class="avatarFallback hidden"></span>
        </div>
        <div class="seatWho">
          <div class="seatTop"><span class="seatName"></span><span class="seatDist"></span></div>
          <div class="seatChar"></div>
          <div class="seatSkill"></div>
        </div>
      </div>
      <div class="pips"></div>
      <div class="seatFoot"><span class="handCount"></span><span class="equipChips"></span></div>
      <div class="seatRole hidden"></div>
      <div class="seatStatus"></div>
      <div class="turnFlag hidden">TURN</div>
      <div class="extraFlag hidden">额外</div>`;
    const parts = {
      el: seat,
      avatar: seat.querySelector('.seatAvatar'),
      fallback: seat.querySelector('.avatarFallback'),
      name: seat.querySelector('.seatName'),
      dist: seat.querySelector('.seatDist'),
      char: seat.querySelector('.seatChar'),
      skill: seat.querySelector('.seatSkill'),
      pips: seat.querySelector('.pips'),
      handCount: seat.querySelector('.handCount'),
      chips: seat.querySelector('.equipChips'),
      role: seat.querySelector('.seatRole'),
      status: seat.querySelector('.seatStatus'),
      turnFlag: seat.querySelector('.turnFlag'),
      extraFlag: seat.querySelector('.extraFlag'),
    };
    seatMap.set(index, parts);
    refs.seats.appendChild(seat);
    return parts;
  }

  function setAvatar(img, fallback, src, label) {
    if (src) {
      img.src = src;
      img.classList.remove('hidden');
      fallback.classList.add('hidden');
    } else {
      img.removeAttribute('src');
      img.classList.add('hidden');
      fallback.textContent = (label || '?').slice(0, 1);
      fallback.classList.remove('hidden');
    }
  }

  // ------------------------------------------------------------ seats

  function seatPosition(i, n) {
    const a = Math.PI / 2 - (i * 2 * Math.PI) / n;
    return { x: 50 + 36 * Math.cos(a), y: 50 + 34 * Math.sin(a) };
  }

  function renderSeats(state, ui) {
    const me = state.players[0];
    const range = me ? rules.rangeOf(me) : 1;

    for (const p of state.players) {
      const parts = seatMap.get(p.index) ?? createSeat(p.index);
      const seat = parts.el;
      const pos = seatPosition(p.index, state.players.length);
      seat.style.left = `${pos.x}%`;
      seat.style.top = `${pos.y}%`;
      const isTurn = state.currentPlayerIndex === p.index && !state.gameOver;
      const isTarget = Boolean(ui.targeting?.actions?.some((a) => a.targetIndex === p.index));
      const isDrop = ui.dropTargetIndex === p.index;
      const isThinking = ui.thinkingIndex === p.index;

      seat.classList.toggle('turn', isTurn);
      seat.classList.toggle('dead', !p.alive);
      seat.classList.toggle('targetable', isTarget && !isDrop);
      seat.classList.toggle('drop-target', isDrop);
      seat.classList.toggle('thinking', isThinking);
      parts.turnFlag.classList.toggle('hidden', !isTurn);
      parts.extraFlag.classList.toggle('hidden', !(isTurn && ui.extraTurn));

      setAvatar(parts.avatar, parts.fallback, assets?.character(p.character.id), p.character.name);
      parts.name.textContent = p.index === 0 ? '你' : p.name;
      parts.char.textContent = p.character.name;
      parts.skill.textContent = skillLine(p.character);
      parts.skill.title = skillDetailText(p.character);

      const dist = p.index === 0 || !p.alive ? null : rules.effectiveDistance(state, me, p);
      if (dist == null) {
        parts.dist.textContent = '';
        parts.dist.className = 'seatDist';
      } else {
        parts.dist.textContent = `距离 ${dist}`;
        parts.dist.className = `seatDist ${dist <= range ? 'inRange' : 'outRange'}`;
      }

      const max = rules.maxCompute(p);
      const compute = Math.max(0, Math.min(p.compute, max));
      if (parts.pips.childElementCount !== max) {
        parts.pips.innerHTML = '';
        for (let i = 0; i < max; i++) parts.pips.appendChild(el('span', 'pip'));
      }
      [...parts.pips.children].forEach((pip, i) => {
        pip.className = `pip${i < compute ? ' on' : i < max ? ' lost' : ''}`;
      });

      parts.handCount.textContent = p.alive ? `手牌 ${p.hand.length}` : '已出局';

      const chips = [];
      for (const [slot, eq] of Object.entries(p.equipment)) {
        if (!eq) continue;
        const chip = el('span', `chip${slot.startsWith('task_') ? ' task' : ''}`);
        const icon = imgTag(assets?.card(eq), 'chipIcon', cardTitle(eq));
        if (icon) chip.appendChild(icon);
        let label = SLOT_LABEL[slot] ?? slot;
        // 主动 Task 显示本回合剩余次数，已用完的置灰，避免「道具怎么没用」的困惑。
        if (slot.startsWith('task_') && eq.params?.perTurn) {
          const left = rules.taskUsesLeft(p, slot.slice('task_'.length));
          label += left > 0 ? `·${left}` : '·已用';
          chip.classList.toggle('used', left <= 0);
        }
        chip.appendChild(el('span', null, label));
        chip.title = `${SLOT_LABEL[slot] ?? slot}：${cardTitle(eq)}\n${eq.effect ?? ''}`;
        chips.push(chip);
      }
      if (p.jail) {
        const chip = el('span', 'chip jail', '封禁');
        chip.title = '账号封禁：下个判定阶段黑色则跳过摸牌与出牌';
        chips.push(chip);
      }
      if (p.dynamite) {
        const chip = el('span', 'chip bomb', 'AGI');
        chip.title = 'AGI 宣言：判定 ♠2–♠9 引爆';
        chips.push(chip);
      }
      parts.chips.replaceChildren(...chips);

      const showRole = p.revealed || p.index === 0;
      parts.role.classList.toggle('hidden', !showRole);
      if (showRole) {
        parts.role.className = `seatRole ${p.role.id}`;
        parts.role.innerHTML = '';
        const icon = imgTag(assets?.role(p.role.id), 'roleIcon', ROLE_LABEL[p.role.id]);
        if (icon) parts.role.appendChild(icon);
        parts.role.appendChild(document.createTextNode(ROLE_LABEL[p.role.id] ?? p.role.id));
      }

      parts.status.innerHTML = '';
      if (!p.alive) parts.status.appendChild(el('span', 'chip jail', '出局'));
    }
  }

  // ------------------------------------------------------------ hand

  function renderHand(state, ui) {
    const human = state.players[0];
    if (!human) return;
    const playPhase = ui.pending?.type === 'play_action';
    const hand = human.hand;
    const live = new Set(hand.map((c) => c.uid));

    for (const [uid, node] of handMap) {
      if (!live.has(uid)) {
        node.el.remove();
        handMap.delete(uid);
      }
    }

    const nodes = [];
    for (const card of hand) {
      let entry = handMap.get(card.uid);
      if (!entry) {
        const cardEl = createCardEl(card, { size: 'hand' });
        entry = { el: cardEl, uid: card.uid };
        handMap.set(card.uid, entry);
      }
      const acts = playPhase ? actionsForCard(ui.pending.actions, card.uid) : [];
      const node = entry.el;
      node.classList.toggle('clickable', playPhase && acts.length > 0);
      node.classList.toggle('idle', playPhase && acts.length === 0);
      node.classList.toggle('sel', ui.selectedCardUid === card.uid);
      node.classList.toggle('dimmed', !playPhase);
      nodes.push(node);
    }

    // 只移动顺序，不重建节点；正在拖拽的卡片保持原位。
    nodes.forEach((node, i) => {
      if (refs.hand.children[i] !== node) refs.hand.insertBefore(node, refs.hand.children[i] ?? null);
    });

    const n = nodes.length;
    const mid = (n - 1) / 2;
    nodes.forEach((node, i) => {
      node.style.setProperty('--tilt', `${((i - mid) * 2.4).toFixed(2)}deg`);
      node.style.setProperty('--lift', `${Math.abs(i - mid) * 1.8}px`);
      node.style.zIndex = String(i + 1);
    });
  }

  function renderYou(state) {
    const human = state.players[0];
    if (!human) return;
    const max = rules.maxCompute(human);
    const limit = rules.handLimit(human);
    const range = rules.rangeOf(human);
    const avatar = imgTag(assets?.character(human.character.id), 'youAvatar', human.character.name);
    const roleIcon = imgTag(assets?.role(human.role.id), 'roleIcon', ROLE_LABEL[human.role.id]);
    refs.youInfo.innerHTML = `
      ${avatar ? avatar.outerHTML : ''}
      <b>${human.character.name}</b>
      <span class="youRole ${human.role.id}">${roleIcon ? roleIcon.outerHTML : ''}${ROLE_LABEL[human.role.id] ?? human.role.id}</span>
      <span class="youStat">算力 <b>${Math.max(0, human.compute)}</b>/${max}</span>
      <span class="youStat">射程 <b>${range}</b></span>
      <span class="youStat">手牌 <b>${human.hand.length}</b>/${limit}</span>
      <span class="youSkill" title="${skillDetailText(human.character)}">${skillLine(human.character)}</span>`;
  }

  // ------------------------------------------------------------ piles / stage

  function renderPiles(state) {
    const drawCount = state.drawPile.length;
    const discardCount = state.discardPile.length;
    const top = state.discardPile[discardCount - 1];
    refs.drawPile.querySelector('.pileCount').textContent = drawCount;
    refs.discardPile.querySelector('.pileCount').textContent = discardCount;
    refs.discardPile.title = top ? `弃牌堆顶：${cardTitle(top)} ${faceLabel(top)}` : '弃牌堆为空';

    const back = assets?.cardBack;
    refs.drawPile.classList.toggle('hasBack', Boolean(back));
    if (back) refs.drawPile.style.setProperty('--pile-img', `url("${back}")`);

    const topSrc = top ? assets?.card(top) : back;
    refs.discardPile.classList.toggle('hasBack', Boolean(topSrc));
    refs.discardPile.classList.toggle('topCard', Boolean(top));
    if (topSrc) refs.discardPile.style.setProperty('--pile-img', `url("${topSrc}")`);
  }

  function makeStageItem(item) {
    const wrap = el('div', `stageItem ${item.tone ?? 'drop'}`);
    wrap.dataset.stageId = item.id;
    wrap.appendChild(createCardEl(item.card, { size: 'stage' }));
    wrap.appendChild(el('div', 'stageCaption', item.caption ?? ''));
    stageMap.set(item.id, wrap);
    refs.stage.appendChild(wrap);
    return wrap;
  }

  function setStage(items) {
    const ids = new Set(items.map((i) => i.id));
    for (const [id, node] of stageMap) {
      if (!ids.has(id)) {
        node.remove();
        stageMap.delete(id);
      }
    }
    for (const item of items) {
      if (!stageMap.has(item.id)) makeStageItem(item);
    }
    // 保持顺序
    for (const item of items) {
      const node = stageMap.get(item.id);
      if (node && node.parentNode === refs.stage && refs.stage.lastElementChild !== node) refs.stage.appendChild(node);
    }
  }

  function appendStage(item) {
    const current = [...stageMap.values()].map((node) => node);
    if (current.length >= 3) {
      const first = current[0];
      stageMap.delete(first.dataset.stageId);
      first.remove();
    }
    return makeStageItem(item);
  }

  function clearStage() {
    for (const node of stageMap.values()) node.remove();
    stageMap.clear();
  }

  // ------------------------------------------------------------ log / turn

  function renderLog(state) {
    if (state.log.length < logCursor) {
      refs.log.innerHTML = '';
      logCursor = 0;
    }
    const nearBottom = refs.log.scrollHeight - refs.log.scrollTop - refs.log.clientHeight < 60;
    for (let i = logCursor; i < state.log.length; i++) {
      const entry = state.log[i];
      const node = el('div', 'logEntry', entry.text);
      if (entry.text.startsWith('——')) node.className = 'logEntry turn';
      else if (entry.text.includes('失去') || entry.text.includes('出局') || entry.text.includes('引爆')) node.className = 'logEntry bad';
      else if (entry.text.includes('回复') || entry.text.includes('救援')) node.className = 'logEntry good';
      else if (entry.text.startsWith('⚠') || entry.text.startsWith('🏁') || entry.text.startsWith('💥')) node.className = 'logEntry big';
      refs.log.appendChild(node);
    }
    logCursor = state.log.length;
    if (nearBottom) refs.log.scrollTop = refs.log.scrollHeight;
  }

  function renderTurn(state, ui) {
    const current = state.players[state.currentPlayerIndex];
    if (state.gameOver) {
      refs.turnInfo.textContent = '对局结束';
      refs.phaseInfo.textContent = '结算';
      refs.turnRibbon.innerHTML = '对局结束';
      return;
    }
    refs.turnInfo.innerHTML = `第 <b>${state.turnNumber}</b> 回合 · 当前 <b>${current?.name ?? '—'}</b>`;
    refs.phaseInfo.textContent = ui.pending?.purpose === 'defense_response'
      ? '响应窗口'
      : ui.pending
        ? '轮到你'
        : ui.thinkingIndex != null ? '对手行动' : '进行中';
    refs.turnRibbon.innerHTML = `第 ${state.turnNumber} 回合 · <b>${current?.name ?? '—'}</b>${ui.extraTurn ? '<span class="extra">额外回合</span>' : ''}`;
  }

  // ------------------------------------------------------------ actions

  function actionChip(action, label = actionLabel(action), title = '') {
    const btn = el('button', `actionChip ${actionTone(action)}`, label);
    btn.type = 'button';
    if (title) btn.title = title;
    btn.addEventListener('click', () => onAction?.(action));
    return btn;
  }

  function renderActions(state, ui) {
    refs.actions.innerHTML = '';
    if (state.gameOver) {
      refs.prompt.textContent = '对局结束 — 查看结算';
      return;
    }
    if (!ui.pending) {
      refs.prompt.textContent = ui.thinkingIndex != null
        ? `${state.players[ui.thinkingIndex]?.name ?? '对手'} 正在思考…`
        : '等待其他玩家…';
      return;
    }
    const req = ui.pending;
    if (req.type !== 'play_action') {
      refs.prompt.textContent = '请做出选择';
      return;
    }

    const selected = ui.selectedCardUid;
    const all = req.actions;
    const nonTarget = all.filter((a) => a.targetIndex == null && a.kind !== 'end_turn');
    const visible = selected
      ? nonTarget.filter((a) => a.cardUid === selected || !a.cardUid)
      : nonTarget.filter((a) => !a.cardUid);
    // 主动 Task 效果没有手牌 uid，但需要选目标；面板给出一个归组入口，
    // 点击后进入与手牌选中等价的瞄准状态。
    const groupEntries = groupTargetedActions(all);
    const selectedCard = selected ? state.players[0].hand.find((c) => c.uid === selected) : null;

    if (ui.targeting?.source === 'action') {
      refs.prompt.textContent = `「${ui.targeting.label}」→ 点击高亮座位（Esc 取消）`;
    } else if (ui.targeting) {
      refs.prompt.textContent = `「${ui.targeting.label}」→ 拖到高亮座位，或点击目标`;
    } else if (selectedCard) {
      const targeted = all.some((a) => a.cardUid === selected && a.targetIndex != null);
      refs.prompt.textContent = targeted
        ? `「${selectedCard.name}」→ 拖到目标座位，或点击座位`
        : `「${selectedCard.name}」→ 在右侧选择用法，或拖到桌面中央`;
    } else {
      const playable = all.some((a) => a.kind !== 'end_turn');
      refs.prompt.textContent = playable
        ? '轮到你出牌 — 拖动手牌到目标，或点击手牌。'
        : '没有可打出的牌，结束回合。';
    }

    for (const a of visible) refs.actions.appendChild(actionChip(a));
    if (!selected) {
      for (const a of groupEntries) {
        refs.actions.appendChild(actionChip(a, actionGroupLabel(a), '点击后选择目标'));
      }
    }
    if (selected || ui.targeting) {
      const cancel = el('button', 'actionChip', '取消选择');
      cancel.addEventListener('click', () => onCancel?.());
      refs.actions.appendChild(cancel);
    }
    const end = endTurnAction(all);
    if (end) refs.actions.appendChild(actionChip(end));
  }

  // ------------------------------------------------------------ modal / response

  function hideModal() {
    refs.modal.classList.add('hidden');
    modalState = null;
  }

  function showModal(request, resolve) {
    hideResponse();
    modalState = { request, resolve, picked: [] };
    refs.modalKicker.textContent = request.purpose === 'general_store_pick' ? '从公开牌中挑选' : '选择';
    refs.modalPrompt.textContent = request.prompt ?? '请选择';
    refs.modalOptions.innerHTML = '';
    refs.modal.classList.remove('hidden');

    const single = request.max === 1;
    const ordered = Boolean(request.ordered);
    const picked = modalState.picked;
    const buttons = [];

    function refresh() {
      buttons.forEach(({ btn, option }) => {
        const at = picked.indexOf(option.id);
        btn.classList.toggle('picked', at >= 0);
        let badge = btn.querySelector('.orderBadge');
        if (!badge) {
          badge = el('span', 'orderBadge');
          btn.prepend(badge);
        }
        badge.textContent = at >= 0 ? String(at + 1) : '';
        badge.style.display = at >= 0 ? 'grid' : 'none';
      });
      const need = request.min ?? 1;
      refs.modalConfirm.disabled = picked.length < need;
      refs.modalHint.textContent = ordered
        ? `按顺序选择 ${request.min}${request.max > request.min ? `–${request.max}` : ''} 项`
        : `选择 ${request.min}${request.max > request.min ? `–${request.max}` : ''} 项`;
    }

    for (const option of request.options ?? []) {
      const btn = el('button', 'modalOption');
      btn.type = 'button';
      if (option.id === 'pass') btn.classList.add('pass');
      if (option.id === 'judge') btn.classList.add('judge');
      if (option.card) btn.appendChild(createCardEl(option.card, { size: 'small' }));
      btn.appendChild(el('span', 'optLabel', option.label ?? option.id));
      btn.addEventListener('click', () => {
        if (single) {
          hideModal();
          resolve?.({ ids: [option.id] });
          return;
        }
        const at = picked.indexOf(option.id);
        if (at >= 0) picked.splice(at, 1);
        else if (picked.length < (request.max ?? 1)) picked.push(option.id);
        refresh();
      });
      refs.modalOptions.appendChild(btn);
      buttons.push({ btn, option });
    }

    refs.modalConfirm.onclick = () => {
      if (picked.length < (request.min ?? 1)) return;
      const ids = picked.slice();
      hideModal();
      resolve?.({ ids });
    };
    refs.modalConfirm.classList.toggle('hidden', single);
    refresh();
  }

  function hideResponse() {
    document.getElementById('app').classList.remove('responding');
    refs.responseTray.classList.add('hidden');
    refs.responseTray.innerHTML = '';
    responseState = null;
  }

  function showResponse(request, resolve) {
    hideModal();
    responseState = { request, resolve };
    document.getElementById('app').classList.add('responding');
    refs.responseTray.innerHTML = '';
    const banner = el('div', 'responseBanner');
    banner.appendChild(el('span', null, request.prompt ?? '需要响应'));
    if (request.needed) {
      banner.appendChild(el('b', null, request.needed > 1 ? `需要 ${request.remaining} 张声明` : '可出一张声明抵消'));
    }
    refs.responseTray.appendChild(banner);

    const options = el('div', 'responseOptions');
    for (const option of request.options ?? []) {
      const btn = el('button', 'responseCard');
      btn.type = 'button';
      if (option.id === 'pass') btn.classList.add('pass');
      if (option.id === 'judge') btn.classList.add('judge');
      if (option.card) btn.appendChild(createCardEl(option.card, { size: 'small' }));
      btn.appendChild(el('span', 'responseLabel', option.label ?? option.id));
      btn.addEventListener('click', () => {
        hideResponse();
        resolve?.({ ids: [option.id] });
      });
      options.appendChild(btn);
    }
    refs.responseTray.appendChild(options);
    refs.responseTray.classList.remove('hidden');
  }

  // ------------------------------------------------------------ overlay

  function hideOverlay() {
    refs.overlay.classList.add('hidden');
  }

  // 开场介绍与终局结算见 screens.js —— 页面级界面与牌桌渲染分离。

  // ------------------------------------------------------------ effects / accessors

  function flashSeat(index, cls, ms = 420) {
    const seat = seatMap.get(index)?.el;
    if (!seat) return;
    seat.classList.add(cls);
    clearTimeout(hurtTimers.get(index));
    hurtTimers.set(index, setTimeout(() => seat.classList.remove(cls), ms));
  }

  function setDropTarget(index) {
    for (const [i, parts] of seatMap) {
      parts.el.classList.toggle('drop-target', i === index);
    }
  }

  function clearDropTarget() {
    for (const parts of seatMap.values()) parts.el.classList.remove('drop-target');
  }

  function seatEl(index) {
    return seatMap.get(index)?.el ?? null;
  }

  function handEl(uid) {
    return handMap.get(uid)?.el ?? null;
  }

  function cardEl(uid) {
    return handMap.get(uid)?.el ?? null;
  }

  function stageEl(id) {
    return stageMap.get(id) ?? null;
  }

  function toast(text, tone = '') {
    const node = el('div', `toast ${tone}`, text);
    refs.toastLayer.appendChild(node);
    setTimeout(() => node.remove(), 2600);
  }

  function render(state, ui) {
    if (!state) return;
    renderSeats(state, ui);
    renderHand(state, ui);
    renderYou(state);
    renderPiles(state);
    renderTurn(state, ui);
    renderActions(state, ui);
    renderLog(state);
  }

  return {
    render,
    renderSeats,
    renderHand,
    renderActions,
    renderPiles,
    renderYou,
    renderTurn,
    renderLog,
    setStage,
    appendStage,
    clearStage,
    showModal,
    hideModal,
    showResponse,
    hideResponse,
    hideOverlay,
    flashSeat,
    setDropTarget,
    clearDropTarget,
    seatEl,
    handEl,
    cardEl,
    stageEl,
    toast,
    createCardEl,
  };
}
