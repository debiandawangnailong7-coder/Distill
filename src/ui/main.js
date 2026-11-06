import { createGame } from '../engine/index.js';
import { createAi, TableMemory } from '../ai/index.js';
import { mulberry32 } from '../engine/rng.js';

const HUMAN = 0;
const PLAYER_COUNT = 5;
const SEED = Math.floor(Math.random() * 1e9);

const SUIT = { spade: '♠', heart: '♥', club: '♣', diamond: '♦' };
const RANK = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const ROLE_LABEL = {
  frontier_lab: '前沿实验室',
  licensed_partner: '授权被许可方',
  distiller: '未授权蒸馏者',
  lone_wolf: '开源独狼',
};
const SLOT_LABEL = {
  weapon: '基建', distance_in: '护城河', distance_out: '渠道', support: '辅助',
  task_chat: 'Chat', task_code: 'Code', task_office: '办公',
  task_tts: 'TTS', task_stt: 'STT', task_iti: 'ITI',
};

let game = null;
let memories = [];
let ais = [];
let resolver = null;
let pendingCtx = null;
let selectedCardUid = null;
let modalPicked = [];
let stageMsg = '';
let fast = false;

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function face(card) {
  return `${SUIT[card.suit]}${RANK[card.rank] ?? card.rank}`;
}

function kindClass(card) {
  if (card.category === 'equipment') return 'k-equip';
  if (card.kind === 'attack') return 'k-attack';
  if (card.kind === 'defense') return 'k-defense';
  return 'k-action';
}

function cardTitle(card) {
  return `${card.name}${card.flavor ? ` · ${card.flavor}` : ''}`;
}

// ---------------------------------------------------------------- rendering

function renderCardEl(card) {
  const el = document.createElement('div');
  el.className = `card ${kindClass(card)}`;
  const red = card.suit === 'heart' || card.suit === 'diamond';
  el.innerHTML = `
    <div class="cardFace"><span class="${red ? 'red' : 'black'}">${face(card)}</span></div>
    <div class="cardName">${cardTitle(card)}</div>
    <div class="cardEffect">${card.effect ?? ''}</div>`;
  return el;
}

function seatPosition(i, n) {
  const a = Math.PI / 2 - (i * 2 * Math.PI) / n;
  return { x: 50 + 36 * Math.cos(a), y: 50 + 34 * Math.sin(a) };
}

function renderSeats() {
  const host = $('seats');
  host.innerHTML = '';
  const s = game.state;
  const me = s.players[HUMAN];

  for (const p of s.players) {
    const pos = seatPosition(p.index, s.players.length);
    const el = document.createElement('div');
    el.className = 'seat';
    if (p.index === s.currentPlayerIndex && !s.gameOver) el.classList.add('turn');
    if (!p.alive) el.classList.add('dead');
    el.style.left = `${pos.x}%`;
    el.style.top = `${pos.y}%`;
    el.dataset.index = p.index;

    const max = p.character.compute + (p.role.id === 'frontier_lab' ? 1 : 0);
    const pips = Array.from({ length: max }, (_, i) => `<span class="pip${i < p.compute ? ' on' : ''}"></span>`).join('');

    const chips = Object.entries(p.equipment)
      .filter(([, c]) => c)
      .map(([slot, c]) => `<span class="chip${slot.startsWith('task_') ? ' task' : ''}" title="${c.effect ?? ''}">${SLOT_LABEL[slot] ?? slot}</span>`)
      .join('');
    const status = [
      p.jail ? '<span class="chip jail">封禁</span>' : '',
      p.dynamite ? '<span class="chip bomb">AGI宣言</span>' : '',
    ].join('');

    const roleHtml = p.revealed
      ? `<span class="seatRole ${p.role.id}">${ROLE_LABEL[p.role.id]}</span>`
      : (p.index === HUMAN ? `<span class="seatRole ${p.role.id}">${ROLE_LABEL[p.role.id]}</span>` : '');

    const dist = p.index === HUMAN || !p.alive ? '' : `距离 ${distance(me, p)}`;

    el.innerHTML = `
      <div class="seatTop">
        <span class="seatName">${p.index === HUMAN ? '你' : p.name}</span>
        <span class="seatDist">${dist}</span>
      </div>
      <div class="seatChar">${p.character.name}</div>
      <div class="seatSkill" title="${p.character.effect}">「${p.character.skill.name}」</div>
      <div class="pips">${pips}</div>
      <div class="seatBottom">
        <span class="handCount">${p.alive ? `手牌 ${p.hand.length}` : '已出局'}</span>
        <span class="equipChips">${chips}${status}</span>
      </div>
      ${roleHtml}`;
    host.appendChild(el);
  }
}

function distance(from, to) {
  const alive = game.state.players.filter((p) => p.alive);
  const n = alive.length;
  const a = alive.findIndex((p) => p.index === from.index);
  const b = alive.findIndex((p) => p.index === to.index);
  if (a < 0 || b < 0) return '—';
  let d = Math.min((b - a + n) % n, (a - b + n) % n);
  if (to.equipment.distance_in) d += 1;
  if (to.character.mechanic === 'incoming_distance_plus_one') d += 1;
  if (from.equipment.distance_out) d -= 1;
  if (from.character.mechanic === 'outgoing_distance_minus_one') d -= 1;
  return Math.max(1, d);
}

function renderYou() {
  const p = game.state.players[HUMAN];
  const max = p.character.compute + (p.role.id === 'frontier_lab' ? 1 : 0);
  const limit = Math.max(0, p.compute) + (p.equipment.task_chat?.params.handLimitBonus ?? 0);
  $('youInfo').innerHTML = `
    <b>${p.character.name}</b>
    <span class="youRole ${p.role.id}">${ROLE_LABEL[p.role.id]}</span>
    <span>算力 ${p.compute}/${max}</span>
    <span>射程 ${p.equipment.weapon?.params.range ?? 1}</span>
    <span>手牌 ${p.hand.length}/${limit}</span>
    <span title="${p.character.effect}">「${p.character.skill.name}」${p.character.effect}</span>`;
}

function renderHand() {
  const host = $('hand');
  host.innerHTML = '';
  const p = game.state.players[HUMAN];
  for (const c of p.hand) {
    const el = renderCardEl(c);
    if (pendingCtx) el.classList.add('clickable');
    if (c.uid === selectedCardUid) el.classList.add('sel');
    el.addEventListener('click', () => {
      if (!pendingCtx || pendingCtx.request.type !== 'play_action') return;
      selectedCardUid = selectedCardUid === c.uid ? null : c.uid;
      renderHand();
      renderActions();
    });
    host.appendChild(el);
  }
}

const ACTION_ORDER = { attack: 0, task: 1, duel: 2, jail: 3, steal: 4, force_discard: 5 };

function actionRank(a) {
  if (a.kind === 'end_turn') return 99;
  if (a.kind === 'task') return 10;
  if (a.kind === 'character_ability') return 11;
  const card = game.state.players[HUMAN].hand.find((c) => c.uid === a.cardUid);
  const k = card?.kind;
  if (a.asAttack) return 0;
  return ACTION_ORDER[k] ?? (card?.category === 'equipment' ? 20 : 30);
}

function renderActions() {
  const host = $('actions');
  host.innerHTML = '';
  if (!pendingCtx || pendingCtx.request.type !== 'play_action') {
    $('actionPrompt').textContent = '';
    return;
  }
  const req = pendingCtx.request;
  let actions = req.actions.slice().sort((a, b) => actionRank(a) - actionRank(b));

  $('actionPrompt').textContent = selectedCardUid
    ? '已筛选选中手牌的可用操作（再点一次该牌取消筛选）'
    : `轮到你出牌 — 共 ${actions.filter((a) => a.kind !== 'end_turn').length} 个可选操作`;

  if (selectedCardUid) {
    actions = actions.filter((a) => a.cardUid === selectedCardUid || a.kind === 'end_turn');
  }

  for (const a of actions) {
    const b = document.createElement('button');
    b.textContent = a.label;
    if (a.kind === 'end_turn') b.className = 'end';
    else if (a.asAttack || a.kind === 'task') b.className = 'atk';
    b.addEventListener('click', () => resolveHuman(a));
    host.appendChild(b);
  }
}

function renderPiles() {
  const s = game.state;
  $('drawPile').querySelector('.pileCount').textContent = s.drawPile.length;
  const top = s.discardPile[s.discardPile.length - 1];
  $('discardPile').querySelector('.pileCount').textContent = s.discardPile.length;
  $('discardPile').title = top ? `弃牌堆顶：${cardTitle(top)} ${face(top)}` : '弃牌堆为空';
  $('turnInfo').innerHTML = `第 <b>${s.turnNumber}</b> 回合 · 当前 <b>${s.players[s.currentPlayerIndex].name}</b>`;
  $('pileInfo').textContent = `牌堆 ${s.drawPile.length} / 弃牌堆 ${s.discardPile.length}`;
}

function renderLog() {
  const host = $('log');
  const atBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 40;
  host.innerHTML = '';
  for (const e of game.state.log.slice(-120)) {
    const d = document.createElement('div');
    d.textContent = e.text;
    if (e.text.startsWith('——')) d.className = 'turn';
    else if (e.text.includes('失去') || e.text.includes('出局') || e.text.includes('引爆')) d.className = 'bad';
    else if (e.text.includes('回复') || e.text.includes('救援')) d.className = 'good';
    else if (e.text.startsWith('⚠') || e.text.startsWith('🏁') || e.text.startsWith('💥')) d.className = 'big';
    host.appendChild(d);
  }
  if (atBottom) host.scrollTop = host.scrollHeight;
}

function renderAll() {
  if (!game) return;
  renderSeats();
  renderYou();
  renderHand();
  renderActions();
  renderPiles();
  renderLog();
  $('stageMsg').textContent = stageMsg;
}

// ---------------------------------------------------------------- decisions

function resolveHuman(choice) {
  const r = resolver;
  resolver = null;
  pendingCtx = null;
  selectedCardUid = null;
  $('modal').classList.add('hidden');
  stageMsg = '';
  renderAll();
  r?.(choice);
}

function decide(ctx) {
  if (ctx.player.index === HUMAN) return humanDecide(ctx);
  return aiDecide(ctx);
}

async function aiDecide(ctx) {
  stageMsg = `${ctx.player.name} 正在思考…`;
  renderAll();
  await sleep(fast ? 0 : ctx.request.type === 'play_action' ? 400 : 210);
  const out = ais[ctx.player.index].decide(ctx);
  stageMsg = '';
  return out;
}

function humanDecide(ctx) {
  pendingCtx = ctx;
  if (ctx.request.type === 'play_action') {
    selectedCardUid = null;
    stageMsg = '你的出牌阶段';
    $('modal').classList.add('hidden');
    renderAll();
  } else {
    showSelectModal(ctx);
  }
  return new Promise((resolve) => {
    resolver = resolve;
  });
}

function showSelectModal(ctx) {
  const req = ctx.request;
  modalPicked = [];
  stageMsg = req.prompt;
  $('modalPrompt').textContent = req.prompt;
  const host = $('modalOptions');
  host.innerHTML = '';

  const single = req.max === 1;
  $('modalConfirm').classList.toggle('hidden', single);
  $('modalHint').textContent = single
    ? '点击一项做出选择'
    : `按顺序选择 ${req.min}${req.max > req.min ? `–${req.max}` : ''} 项`;

  const label = (o) => {
    const at = modalPicked.indexOf(o.id);
    return `${at >= 0 ? `${at + 1}.&nbsp;` : ''}${o.label}`;
  };

  const buttons = req.options.map((o) => {
    const b = document.createElement('button');
    b.innerHTML = label(o);
    if (o.id === 'pass') b.className = 'end';
    else if (o.id === 'judge') b.className = 'def';
    else if (o.card?.kind === 'attack') b.className = 'atk';
    else if (o.card?.kind === 'defense') b.className = 'def';

    b.addEventListener('click', () => {
      if (single) {
        resolveHuman({ ids: [o.id] });
        return;
      }
      const at = modalPicked.indexOf(o.id);
      if (at >= 0) modalPicked.splice(at, 1);
      else if (modalPicked.length < req.max) modalPicked.push(o.id);
      refresh();
    });
    host.appendChild(b);
    return b;
  });

  function refresh() {
    req.options.forEach((o, i) => {
      buttons[i].innerHTML = label(o);
      buttons[i].classList.toggle('picked', modalPicked.includes(o.id));
    });
    $('modalConfirm').disabled = modalPicked.length < req.min;
  }

  $('modalConfirm').disabled = true;
  $('modalConfirm').onclick = () => resolveHuman({ ids: modalPicked.slice() });
  $('modal').classList.remove('hidden');
  renderAll();
}

// ---------------------------------------------------------------- lifecycle

async function loadData() {
  const files = ['deck', 'cardTypes', 'characters', 'roles'];
  const out = {};
  for (const f of files) {
    const res = await fetch(`./data/${f}.json`);
    if (!res.ok) throw new Error(`无法加载 data/${f}.json (${res.status})`);
    out[f] = await res.json();
  }
  return out;
}

const NAMES = ['你', 'Kimi', 'Qwen', 'GLM', 'Mistral'];

function introHtml() {
  return `
    <p>你是 5 人局中的一名玩家，其余 4 位由启发式 AI 扮演。身份与角色开局随机发给你。</p>
    <h4>四种身份</h4>
    <ul>
      <li><span class="roleTag">前沿实验室</span>（公开，+1 算力）— 消灭所有蒸馏者与独狼</li>
      <li><span class="roleTag">授权被许可方</span> — 与实验室同阵营，<b>绝不能攻击实验室</b></li>
      <li><span class="roleTag">未授权蒸馏者</span> ×2 — 干掉实验室即可获胜，即使自己已出局</li>
      <li><span class="roleTag">开源独狼</span> — 成为唯一存活者。蒸馏者没死光时不能让实验室死</li>
    </ul>
    <h4>核心机制</h4>
    <ul>
      <li><b>算力</b>就是生命值，归零进入濒死，可用「融资到账」自救或被人救</li>
      <li>圆桌<b>距离</b>按存活玩家的最短座位数算；<b>射程</b>由基建武器决定，无武器为 1</li>
      <li>「蒸馏指控」需要目标打出「合规声明」抵消，否则失去 1 点算力</li>
      <li>每回合只能用 1 次指控（o3 与端侧小模型例外）</li>
      <li>回合结束要弃牌到<b>手牌上限 = 当前算力</b>（装了 Chat 产品则 +2）</li>
    </ul>
    <h4>三套装备槽</h4>
    <ul>
      <li><b>基建武器</b>决定射程；<b>分发护城河</b>修正距离</li>
      <li><b>Task 装备</b>：Chat 加手牌上限、Code 弃牌当指控、办公弃牌回血、TTS 侦察抢牌、STT 预知牌堆顶、图生图 ITI 用弃牌堆顶重绘手牌</li>
    </ul>`;
}

function showIntro() {
  $('overlayTitle').textContent = 'DISTILL!';
  $('overlayBody').innerHTML = introHtml();
  $('overlayBtn').textContent = '开始对局';
  $('overlay').classList.remove('hidden');
  $('overlayBtn').onclick = () => {
    $('overlay').classList.add('hidden');
    startGame();
  };
}

function showGameOver() {
  const s = game.state;
  const w = s.winner;
  const campLabel =
    w.winner === 'frontier_lab' ? '前沿实验室阵营' :
    w.winner === 'distiller' ? '未授权蒸馏者阵营' : '开源独狼';
  const youWon =
    w.winner === 'lone_wolf'
      ? s.players[HUMAN].role.id === 'lone_wolf' && s.players[HUMAN].alive
      : w.winner === 'distiller'
        ? s.players[HUMAN].role.id === 'distiller'
        : s.players[HUMAN].role.id === 'frontier_lab' || s.players[HUMAN].role.id === 'licensed_partner';

  const rows = s.players
    .map((p) => {
      const won =
        w.winner === 'lone_wolf' ? p.role.id === 'lone_wolf' && p.alive
        : w.winner === 'distiller' ? p.role.id === 'distiller'
        : p.role.id === 'frontier_lab' || p.role.id === 'licensed_partner';
      return `<tr class="${won ? 'win' : ''}">
        <td>${p.index === HUMAN ? '你' : p.name}</td>
        <td>${p.character.name}</td>
        <td>${ROLE_LABEL[p.role.id]}</td>
        <td>${p.alive ? `存活（${p.compute}）` : '出局'}</td>
        <td>${won ? '胜' : '负'}</td>
      </tr>`;
    })
    .join('');

  $('overlayTitle').textContent = youWon ? '你赢了' : '你输了';
  $('overlayBody').innerHTML = `
    <p><b>${campLabel}</b>获胜 — ${w.reason}</p>
    <p>你的身份是 <span class="roleTag">${ROLE_LABEL[s.players[HUMAN].role.id]}</span>，
       共进行了 ${s.turnNumber} 回合。</p>
    <table class="resultTable">
      <thead><tr><th>玩家</th><th>角色</th><th>身份</th><th>状态</th><th>结果</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  $('overlayBtn').textContent = '再来一局';
  $('overlay').classList.remove('hidden');
  $('overlayBtn').onclick = () => location.reload();
}

async function startGame() {
  const data = await loadData();
  memories = Array.from({ length: PLAYER_COUNT }, () => new TableMemory(PLAYER_COUNT));
  ais = memories.map((memory, i) =>
    createAi({ memory, roles: data.roles, playerCount: PLAYER_COUNT, rand: mulberry32(SEED + i) })
  );

  game = createGame({
    ...data,
    playerCount: PLAYER_COUNT,
    seed: SEED,
    names: NAMES,
    decide,
    onEvent: (e) => {
      for (const m of memories) m.observe(e);
      if (e.type === 'gameOver') return;
      renderAll();
    },
  });

  renderAll();
  await game.run();
  renderAll();
  showGameOver();
}

$('speedBtn').addEventListener('click', (e) => {
  fast = !fast;
  e.target.textContent = fast ? '常速' : '快进';
  e.target.classList.toggle('primary', fast);
});

showIntro();
