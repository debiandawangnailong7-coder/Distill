import { createFocus } from './focus.js';
import {
  maxComputeOf,
  rangeOfYou,
  handLimitOf,
  taskUsesLeftOf,
  computeStates,
  seatArt,
  seatByIndex,
  seatAngle,
} from './project.js';
import { skillLine, skillDetailText, createCharacterCard } from './characterCard.js';
import {
  ROLE_LABEL,
  faceLabel,
  cardTitle,
  kindClass,
  kindLabel,
  actionsForCard,
  actionTone,
  actionLabel,
  actionGroupLabel,
  groupTargetedActions,
  endTurnAction,
} from './intent.js';

const $ = (id) => document.getElementById(id);

/** 简笔矢量「无头服务器」：两层圆角机箱 + 指示灯 + 光驱缝，颜色区分满/损/空三态。 */
const SERVER_SVG = `
<svg viewBox="0 0 20 20" aria-hidden="true">
  <rect class="srvBox" x="2" y="1.6" width="16" height="7" rx="2"/>
  <rect class="srvBox" x="2" y="11" width="16" height="7" rx="2"/>
  <circle class="srvDot" cx="6.1" cy="5.1" r="1.15"/>
  <circle class="srvDot" cx="6.1" cy="14.5" r="1.15"/>
  <rect class="srvSlot" x="9.6" y="4.3" width="6.4" height="1.6" rx="0.8"/>
  <rect class="srvSlot" x="9.6" y="13.7" width="6.4" height="1.6" rx="0.8"/>
</svg>`;

const SLOT_NAMES = { weapon: '武器', item: '道具', horse: '马' };

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

export function createRenderer({ assets, hints, onAction, onCancel }) {
  const refs = {
    seats: $('seats'),
    hand: $('hand'),
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
    overlay: $('overlay'),
    toastLayer: $('toastLayer'),
    focusModal: $('focusModal'),
    focusBox: $('focusBox'),
    focusKicker: $('focusKicker'),
    focusPrompt: $('focusPrompt'),
    focusBody: $('focusBody'),
    focusFoot: $('focusFoot'),
    focusHint: $('focusHint'),
    focusConfirm: $('focusConfirm'),
    focusCollapse: $('focusCollapse'),
    focusClose: $('focusClose'),
    pendingBadge: $('pendingBadge'),
  };

  const seatMap = new Map();
  const handMap = new Map();
  const stageMap = new Map();
  const hurtTimers = new Map();
  let lastProjection = null;

  // 单一焦点弹窗：交互窗（引擎请求）与检视窗（座位卡说明）互斥。
  const focus = createFocus();
  let interactionResolve = null;

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

  function serverIcon(state) {
    const wrap = el('span', `srvIcon ${state}`);
    wrap.innerHTML = SERVER_SVG;
    return wrap;
  }

  // ------------------------------------------------------------ seats

  function createSeat(index) {
    const seat = el('div', 'seat');
    seat.dataset.index = String(index);
    seat.innerHTML = `
      <div class="seatArtWrap">
        <img class="seatArt" alt="" decoding="async">
        <span class="seatArtFallback hidden"></span>
        <span class="seatCharName"></span>
        <div class="seatRole hidden"></div>
        <div class="seatCompute">
          <span class="handNum" title="手牌数"></span>
          <span class="srvs"></span>
        </div>
        <div class="seatBadges"></div>
      </div>
      <div class="seatEquip">
        <div class="eqSlot" data-eq="weapon" title="武器槽"><span class="eqPh">武</span></div>
        <div class="eqSlot" data-eq="item" title="道具槽"><span class="eqPh">道</span></div>
        <div class="eqSlot" data-eq="horse" title="马槽（+1 防守 / -1 进攻）"><span class="eqPh">马</span></div>
      </div>
      <div class="seatNoRow">
        <span class="seatDist"></span>
        <span class="seatNum"></span>
      </div>
      <div class="seatStatus"></div>
      <div class="turnFlag hidden">TURN</div>
      <div class="extraFlag hidden">额外</div>`;
    const parts = {
      el: seat,
      art: seat.querySelector('.seatArt'),
      artFallback: seat.querySelector('.seatArtFallback'),
      charName: seat.querySelector('.seatCharName'),
      role: seat.querySelector('.seatRole'),
      handNum: seat.querySelector('.handNum'),
      srvs: seat.querySelector('.srvs'),
      badges: seat.querySelector('.seatBadges'),
      slots: {
        weapon: seat.querySelector('.eqSlot[data-eq="weapon"]'),
        item: seat.querySelector('.eqSlot[data-eq="item"]'),
        horse: seat.querySelector('.eqSlot[data-eq="horse"]'),
      },
      dist: seat.querySelector('.seatDist'),
      num: seat.querySelector('.seatNum'),
      status: seat.querySelector('.seatStatus'),
      turnFlag: seat.querySelector('.turnFlag'),
      extraFlag: seat.querySelector('.extraFlag'),
    };
    seatMap.set(index, parts);
    refs.seats.appendChild(seat);
    return parts;
  }

  function setSeatArt(parts, model) {
    const src = assets ? seatArt(assets, model.character, { hurt: model.hurt }) : null;
    if (src) {
      // 满血/残血切换不同素材轴，换源时强制重绘避免缓存串图。
      if (parts.art.dataset.for !== `${model.character.id}:${model.hurt ? 'q' : 'n'}`) {
        parts.art.dataset.for = `${model.character.id}:${model.hurt ? 'q' : 'n'}`;
        parts.art.src = src;
      }
      parts.art.classList.remove('hidden');
      parts.artFallback.classList.add('hidden');
    } else {
      parts.art.removeAttribute('src');
      parts.art.classList.add('hidden');
      parts.artFallback.textContent = (model.character?.name || '?').slice(0, 1);
      parts.artFallback.classList.remove('hidden');
    }
  }

  function setRoleBadge(parts, model) {
    const role = parts.role;
    if (!model.roleKnown) {
      role.className = 'seatRole unknown';
      role.classList.remove('hidden');
      role.textContent = '？未公开';
      role.title = '身份未公开';
      return;
    }
    role.className = `seatRole ${model.role.id}`;
    role.classList.remove('hidden');
    role.innerHTML = '';
    const icon = imgTag(assets?.role(model.role.id), 'roleIcon', ROLE_LABEL[model.role.id]);
    if (icon) role.appendChild(icon);
    role.appendChild(document.createTextNode(ROLE_LABEL[model.role.id] ?? model.role.name ?? model.role.id));
    role.title = ROLE_LABEL[model.role.id] ?? model.role.name ?? '';
  }

  function setCompute(parts, model) {
    parts.handNum.textContent = model.alive ? String(model.handCount) : '—';
    parts.handNum.title = model.alive ? `手牌 ${model.handCount}` : '已出局';
    const states = computeStates(Math.max(0, model.compute), model.maxCompute, model.alive);
    if (parts.srvs.childElementCount !== states.length) {
      parts.srvs.innerHTML = '';
      for (const st of states) parts.srvs.appendChild(serverIcon(st));
    } else {
      [...parts.srvs.children].forEach((node, i) => { node.className = `srvIcon ${states[i]}`; });
    }
    parts.srvs.title = `算力 ${Math.max(0, model.compute)}/${model.maxCompute}`;
  }

  function setEquipSlot(parts, key, cards, { usedUp = false, labels = null } = {}) {
    const slot = parts.slots[key];
    slot.innerHTML = '';
    const list = cards.filter(Boolean);
    if (!list.length) {
      slot.appendChild(el('span', 'eqPh', SLOT_NAMES[key].slice(0, 1)));
      slot.classList.toggle('filled', false);
      return;
    }
    slot.classList.add('filled');
    list.forEach((card, i) => {
      const chip = el('span', 'eqCard');
      const icon = imgTag(assets?.card(card), 'eqIcon', cardTitle(card));
      if (icon) chip.appendChild(icon);
      chip.appendChild(el('span', 'eqName', labels?.[i] ?? card.name));
      chip.title = `${SLOT_NAMES[key]}：${cardTitle(card)}\n${card.effect ?? ''}`;
      slot.appendChild(chip);
    });
    if (usedUp) slot.appendChild(el('span', 'eqUsed', '已用'));
  }

  function setBadges(parts, model) {
    const badges = [];
    if (model.jail) {
      const b = el('span', 'miniBadge jail', '封');
      b.title = '账号封禁：下个判定阶段黑色则跳过摸牌与出牌';
      badges.push(b);
    }
    if (model.dynamite) {
      const b = el('span', 'miniBadge bomb', 'AGI');
      b.title = 'AGI 宣言：判定 ♠2–♠9 引爆';
      badges.push(b);
    }
    parts.badges.replaceChildren(...badges);
  }

  function renderSeats(projection, ui) {
    const count = projection.seats.length;
    const myRange = rangeOfYou(projection.you);

    for (const model of projection.seats) {
      const parts = seatMap.get(model.index) ?? createSeat(model.index);
      const seat = parts.el;
      const a = seatAngle(projection.seat, model.index, count);
      seat.style.left = `${50 + 36 * Math.cos(a)}%`;
      // 纵向压扁并上移：正下方是本家座位，避免被底栏手牌区遮住。
      seat.style.top = `${47 + 31 * Math.sin(a)}%`;

      const isTurn = projection.currentIndex === model.index && !projection.gameOver;
      const isTarget = Boolean(ui.targeting?.actions?.some((act) => act.targetIndex === model.index));
      const isDrop = ui.dropTargetIndex === model.index;
      const isThinking = ui.thinkingIndex === model.index;

      seat.classList.toggle('turn', isTurn);
      seat.classList.toggle('dead', !model.alive);
      seat.classList.toggle('you', model.isYou);
      seat.classList.toggle('hurt', model.hurt);
      seat.classList.toggle('targetable', isTarget && !isDrop);
      seat.classList.toggle('drop-target', isDrop);
      seat.classList.toggle('thinking', isThinking);
      parts.turnFlag.classList.toggle('hidden', !isTurn);
      parts.extraFlag.classList.toggle('hidden', !(isTurn && projection.extraTurn));

      setSeatArt(parts, model);
      parts.charName.textContent = model.character?.name ?? '';
      parts.charName.title = skillDetailText(model.character);
      setRoleBadge(parts, model);
      setCompute(parts, model);
      setBadges(parts, model);

      // 三显示位：武器 / 道具（产品槽）/ 马（双向距离合并，+1 防守 / -1 进攻）
      setEquipSlot(parts, 'weapon', [model.slots.weapon]);
      const itemCard = model.slots.item;
      const itemUsed = Boolean(
        itemCard?.typeId?.startsWith('task_') &&
        itemCard.params?.perTurn &&
        model.isYou && // 只有本家的回合内使用次数是私有记账
        taskUsesLeftOf(projection.you, itemCard.typeId.slice(5)) <= 0
      );
      setEquipSlot(parts, 'item', [itemCard], { usedUp: itemUsed });
      setEquipSlot(parts, 'horse', [model.slots.horseIn, model.slots.horseOut], { labels: ['+1', '-1'] });

      if (model.distance != null) {
        parts.dist.textContent = `距离 ${model.distance}`;
        parts.dist.className = `seatDist ${model.distance <= myRange ? 'inRange' : 'outRange'}`;
      } else {
        parts.dist.textContent = '';
        parts.dist.className = 'seatDist';
      }
      parts.num.textContent = `${model.index + 1}位`;

      parts.status.innerHTML = '';
      if (!model.alive) parts.status.appendChild(el('span', 'outBadge', '出局'));
    }

    // 座位数收缩（回放/不同人数）时清掉多余座位
    for (const [index, parts] of seatMap) {
      if (!projection.seats.some((m) => m.index === index)) {
        parts.el.remove();
        seatMap.delete(index);
      }
    }
  }

  // ------------------------------------------------------------ hand / you

  function renderHand(projection, ui) {
    const you = projection.you;
    const playPhase = ui.pending?.type === 'play_action';
    const hand = you.hand;
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

  function renderYou(projection) {
    const you = projection.you;
    const avatar = imgTag(assets?.character(you.character.id), 'youAvatar', you.character.name);
    const roleIcon = imgTag(assets?.role(you.role.id), 'roleIcon', ROLE_LABEL[you.role.id]);
    refs.youInfo.innerHTML = `
      ${avatar ? avatar.outerHTML : ''}
      <b>${you.character.name}</b>
      <span class="youRole ${you.role.id}">${roleIcon ? roleIcon.outerHTML : ''}${ROLE_LABEL[you.role.id] ?? you.role.id}</span>
      <span class="youStat">算力 <b>${Math.max(0, you.compute)}</b>/${maxComputeOf(you)}</span>
      <span class="youStat">射程 <b>${rangeOfYou(you)}</b></span>
      <span class="youStat">手牌 <b>${you.hand.length}</b>/${handLimitOf(you)}</span>
      <span class="youSkill" title="${skillDetailText(you.character)}">${skillLine(you.character)}</span>`;
  }

  // ------------------------------------------------------------ piles / stage

  function renderPiles(projection) {
    refs.drawPile.querySelector('.pileCount').textContent = projection.drawPileCount;
    const top = projection.discardTop;
    // view 只公开弃牌堆顶，不公开总数（引擎协议如此）：有顶牌即亮顶牌，无数值徽标。
    refs.discardPile.querySelector('.pileCount').textContent = '';
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
    for (const item of items) {
      const node = stageMap.get(item.id);
      if (node && node.parentNode === refs.stage && refs.stage.lastElementChild !== node) refs.stage.appendChild(node);
    }
  }

  function appendStage(item) {
    const current = [...stageMap.values()];
    if (current.length >= 3) {
      stageMap.delete(current[0].dataset.stageId);
      current[0].remove();
    }
    return makeStageItem(item);
  }

  function clearStage() {
    for (const node of stageMap.values()) node.remove();
    stageMap.clear();
  }

  // ------------------------------------------------------------ log / turn

  // view.log 是滑动窗口（最近 40 条），全局游标会随窗口漂移失效；
  // 日志量小，每次按内容整体重建，保证与最新投影一致。
  function renderLog(projection) {
    const log = projection.log;
    const nearBottom = refs.log.scrollHeight - refs.log.scrollTop - refs.log.clientHeight < 60;
    refs.log.innerHTML = '';
    for (const entry of log) {
      const node = el('div', 'logEntry', entry.text);
      if (entry.text.startsWith('——')) node.className = 'logEntry turn';
      else if (entry.text.includes('失去') || entry.text.includes('出局') || entry.text.includes('引爆')) node.className = 'logEntry bad';
      else if (entry.text.includes('回复') || entry.text.includes('救援')) node.className = 'logEntry good';
      else if (entry.text.startsWith('⚠') || entry.text.startsWith('🏁') || entry.text.startsWith('💥')) node.className = 'logEntry big';
      refs.log.appendChild(node);
    }
    if (nearBottom) refs.log.scrollTop = refs.log.scrollHeight;
  }

  function nameOf(projection, index) {
    if (index == null) return '—';
    const model = seatByIndex(projection, index);
    return model ? (model.isYou ? '你' : model.name) : '—';
  }

  function renderTurn(projection, ui) {
    if (projection.gameOver) {
      refs.turnInfo.textContent = '对局结束';
      refs.phaseInfo.textContent = '结算';
      refs.turnRibbon.innerHTML = '对局结束';
      return;
    }
    const currentName = nameOf(projection, projection.currentIndex);
    refs.turnInfo.innerHTML = `第 <b>${projection.turnNumber}</b> 回合 · 当前 <b>${currentName}</b>`;
    refs.phaseInfo.textContent = ui.pending?.purpose === 'defense_response'
      ? '响应窗口'
      : ui.pending
        ? '轮到你'
        : ui.thinkingIndex != null ? '对手行动' : '进行中';
    refs.turnRibbon.innerHTML = `第 ${projection.turnNumber} 回合 · <b>${currentName}</b>${projection.extraTurn ? '<span class="extra">额外回合</span>' : ''}`;
  }

  // ------------------------------------------------------------ actions

  function actionChip(action, label = actionLabel(action), title = '') {
    const btn = el('button', `actionChip ${actionTone(action)}`, label);
    btn.type = 'button';
    if (title) btn.title = title;
    btn.addEventListener('click', () => onAction?.(action));
    return btn;
  }

  function renderActions(projection, ui) {
    refs.actions.innerHTML = '';
    if (projection.gameOver) {
      refs.prompt.textContent = '对局结束 — 查看结算';
      return;
    }
    if (!ui.pending) {
      refs.prompt.textContent = ui.thinkingIndex != null
        ? `${nameOf(projection, ui.thinkingIndex)} 正在思考…`
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
    const groupEntries = groupTargetedActions(all);
    const selectedCard = selected ? projection.you.hand.find((c) => c.uid === selected) : null;

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

  // ------------------------------------------------------------ 单一焦点弹窗

  function syncFocusModal() {
    const cur = focus.current();
    const isDefense = cur.request?.purpose === 'defense_response';

    if (cur.view === 'interaction') {
      renderInteractionBody(cur.request);
      refs.focusModal.classList.remove('hidden');
      refs.focusBox.classList.toggle('defense', isDefense);
      refs.focusCollapse.classList.remove('hidden');
      refs.focusClose.classList.add('hidden');
      document.getElementById('app').classList.toggle('responding', isDefense);
      syncPendingBadge();
      return;
    }
    document.getElementById('app').classList.remove('responding');

    if (cur.view === 'inspect') {
      renderInspectBody(cur.seat);
      refs.focusModal.classList.remove('hidden');
      refs.focusBox.classList.remove('defense');
      refs.focusCollapse.classList.add('hidden');
      refs.focusClose.classList.remove('hidden');
      syncPendingBadge();
      return;
    }

    refs.focusModal.classList.add('hidden');
    syncPendingBadge();
  }

  function renderInteractionBody(request) {
    const single = request.max === 1;
    const ordered = Boolean(request.ordered);
    const picked = [];

    refs.focusKicker.textContent = request.purpose === 'general_store_pick' ? '从公开牌中挑选'
      : request.purpose === 'defense_response' ? '响应窗口'
      : '选择';
    refs.focusPrompt.textContent = request.prompt ?? '请选择';
    refs.focusBody.innerHTML = '';
    refs.focusFoot.classList.remove('hidden');
    refs.focusConfirm.classList.toggle('hidden', single);

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
      refs.focusConfirm.disabled = picked.length < (request.min ?? 1);
      refs.focusHint.textContent = ordered
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
          resolveInteraction({ ids: [option.id] });
          return;
        }
        const at = picked.indexOf(option.id);
        if (at >= 0) picked.splice(at, 1);
        else if (picked.length < (request.max ?? 1)) picked.push(option.id);
        refresh();
      });
      refs.focusBody.appendChild(btn);
      buttons.push({ btn, option });
    }

    refs.focusConfirm.onclick = () => {
      if (picked.length < (request.min ?? 1)) return;
      resolveInteraction({ ids: picked.slice() });
    };
    refresh();
  }

  /** 引擎请求到达：抢占弹窗（检视窗让位）。resolve 由调用方包过一层清理。 */
  function showInteraction(request, resolve) {
    interactionResolve = resolve;
    focus.openInteraction(request);
    syncFocusModal();
  }

  function resolveInteraction(choice) {
    const resolve = interactionResolve;
    interactionResolve = null;
    focus.dismissInteraction();
    syncFocusModal();
    resolve?.(choice);
  }

  function collapseInteraction() {
    focus.minimizeInteraction();
    syncFocusModal();
  }

  function restoreInteraction() {
    focus.restoreInteraction();
    syncFocusModal();
  }

  // ------------------------------------------------------------ 检视窗

  function renderInspectBody(seatIndex) {
    const model = lastProjection ? seatByIndex(lastProjection, seatIndex) : null;
    refs.focusKicker.textContent = '档案检视';
    refs.focusPrompt.textContent = model
      ? `${model.index + 1} 位 · ${model.character?.name ?? ''}${model.isYou ? '（你）' : ''}`
      : '座位档案';
    refs.focusBody.innerHTML = '';
    refs.focusFoot.classList.add('hidden');
    if (!model) return;

    if (model.character) {
      const card = createCharacterCard(model.character, { assets, art: 'portrait', size: 'md' });
      refs.focusBody.appendChild(card);
    }
    const detail = el('div', 'inspectDetail');
    const skillText = skillDetailText(model.character);
    if (skillText) {
      const p = el('p', 'inspectSkills');
      p.textContent = skillText;
      detail.appendChild(p);
    }
    const items = [
      ['武器', model.slots.weapon],
      ['道具', model.slots.item],
      ['马 · +1（防守距离）', model.slots.horseIn],
      ['马 · -1（进攻距离）', model.slots.horseOut],
    ].filter(([, card]) => card);
    if (items.length) {
      const h = el('h4', null, '装备效果');
      detail.appendChild(h);
      for (const [label, card] of items) {
        const row = el('div', 'inspectEquip');
        row.appendChild(el('b', null, `${label}｜${cardTitle(card)}`));
        if (card.effect) row.appendChild(el('span', null, card.effect));
        detail.appendChild(row);
      }
    } else {
      detail.appendChild(el('p', 'inspectEmpty', '当前没有装备。'));
    }
    const meta = el('p', 'inspectMeta');
    meta.textContent = `身份：${model.roleKnown ? (ROLE_LABEL[model.role.id] ?? model.role.name) : '未公开'} · 手牌 ${model.alive ? model.handCount : '—'} · 算力 ${Math.max(0, model.compute)}/${model.maxCompute}`;
    detail.appendChild(meta);
    refs.focusBody.appendChild(detail);
  }

  /** 点座位卡：检视窗占用弹窗；交互窗展开期间被拒绝（优先级）。 */
  function openInspect(seatIndex) {
    const res = focus.openInspect(seatIndex);
    if (res.ok) syncFocusModal();
    return res.ok;
  }

  function closeInspect() {
    focus.closeInspect();
    syncFocusModal();
  }

  /** Esc：交互窗收起为待处理徽标，检视窗关闭。 */
  function handleEscape() {
    const cur = focus.current();
    if (cur.view === 'interaction') {
      collapseInteraction();
      return true;
    }
    if (cur.view === 'inspect') {
      closeInspect();
      return true;
    }
    return false;
  }

  function syncPendingBadge() {
    const cur = focus.current();
    // 弹窗已展开交互时徽标隐藏；收起或检视占用期间徽标出现，点击切回。
    const show = cur.pending && cur.view !== 'interaction';
    if (show) {
      const prompt = cur.request?.prompt ?? '请做出选择';
      refs.pendingBadge.textContent = `待处理 · ${prompt}`;
      refs.pendingBadge.classList.remove('hidden');
    } else {
      refs.pendingBadge.classList.add('hidden');
    }
  }

  refs.focusCollapse.addEventListener('click', collapseInteraction);
  refs.focusClose.addEventListener('click', closeInspect);
  refs.pendingBadge.addEventListener('click', () => {
    if (focus.hasPending()) restoreInteraction();
  });
  // 点遮罩空白：检视窗自愿关闭；交互窗是强制的，不随点击消失。
  refs.focusModal.addEventListener('click', (e) => {
    if (e.target === refs.focusModal && focus.current().view === 'inspect') closeInspect();
  });

  // ------------------------------------------------------------ overlay

  function hideOverlay() {
    refs.overlay.classList.add('hidden');
  }

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

  function seatArtEl(index) {
    return seatMap.get(index)?.art ?? null;
  }

  function slotEl(index, key) {
    return seatMap.get(index)?.slots[key] ?? null;
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

  function drawPileEl() {
    return refs.drawPile;
  }

  function toast(text, tone = '') {
    const node = el('div', `toast ${tone}`, text);
    refs.toastLayer.appendChild(node);
    setTimeout(() => node.remove(), 2600);
  }

  function render(projection, ui) {
    if (!projection) return;
    lastProjection = projection;
    renderSeats(projection, ui);
    renderHand(projection, ui);
    renderYou(projection);
    renderPiles(projection);
    renderTurn(projection, ui);
    renderActions(projection, ui);
    renderLog(projection);
    syncPendingBadge();
  }

  return {
    render,
    renderSeats,
    renderHand,
    renderActions,
    renderPiles,
    renderTurn,
    renderLog,
    setStage,
    appendStage,
    clearStage,
    showInteraction,
    collapseInteraction,
    restoreInteraction,
    openInspect,
    closeInspect,
    handleEscape,
    hideOverlay,
    flashSeat,
    setDropTarget,
    clearDropTarget,
    seatEl,
    seatArtEl,
    slotEl,
    handEl,
    cardEl,
    stageEl,
    drawPileEl,
    toast,
    createCardEl,
  };
}
