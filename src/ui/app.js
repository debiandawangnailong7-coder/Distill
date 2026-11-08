import { createGame } from '../engine/index.js';
import { createAi, TableMemory } from '../ai/index.js';
import { mulberry32 } from '../engine/rng.js';
import { loadAssets } from './assets.js';
import { createHints } from './hints.js';
import { createMotion } from './motion.js';
import { createRenderer } from './render.js';
import { createInput } from './input.js';

const PARAMS = new URLSearchParams(location.search);
const HUMAN = 0;
const rawPlayers = Number(PARAMS.get('players') ?? 5);
const PLAYER_COUNT = Number.isFinite(rawPlayers) ? Math.min(7, Math.max(4, rawPlayers)) : 5;
const seedParam = PARAMS.get('seed');
const SEED = seedParam != null && seedParam !== '' && Number.isFinite(Number(seedParam))
  ? Number(seedParam)
  : Math.floor(Math.random() * 1e9);
const AUTOPLAY = PARAMS.get('autoplay') === '1';
const NAMES = ['你', 'dario', 'sam A.', 'tibo', '梁文峰', 'Qwen 用户', 'Kimi 用户'];

window.__distillErrors = [];
window.addEventListener('error', (e) => window.__distillErrors.push(String(e.error?.stack ?? e.message)));
window.addEventListener('unhandledrejection', (e) => window.__distillErrors.push(String(e.reason?.stack ?? e.reason)));

const FAST_KEY = 'distill.ui.fast';
const REDUCE_KEY = 'distill.ui.reduce';
const MODE_KEY = 'distill.ui.mode';

function readKey(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeKey(key, value) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

const $ = (id) => document.getElementById(id);

let game = null;
let ais = [];
let memories = [];
let assets = null;
let hints = null;
let motion = null;
let renderer = null;
let input = null;
let booted = false;
let stageSeq = 0;
let stageTone = null;

const ui = {
  pending: null,
  resolve: null,
  selectedCardUid: null,
  targeting: null,
  dropTargetIndex: null,
  preferAsAttack: false,
  thinkingIndex: null,
  extraTurn: false,
  fast: PARAMS.get('fast') === '1' || readKey(FAST_KEY) === '1',
  gameOver: false,
};

window.__distill = {
  get game() { return game; },
  get ui() { return ui; },
  get booted() { return booted; },
};

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

function playerName(index) {
  return game?.state?.players?.[index]?.name ?? '—';
}

function fxCenter(index) {
  const host = $('fxLayer');
  const seat = renderer?.seatEl(index);
  if (!host || !seat) return null;
  const hb = host.getBoundingClientRect();
  const sb = seat.getBoundingClientRect();
  return { x: sb.left + sb.width / 2 - hb.left, y: sb.top + 34 - hb.top };
}

// ---------------------------------------------------------------- decisions

function resolvePending(choice) {
  if (!ui.resolve) return;
  const resolve = ui.resolve;
  ui.resolve = null;
  ui.pending = null;
  ui.selectedCardUid = null;
  ui.targeting = null;
  ui.dropTargetIndex = null;
  ui.preferAsAttack = false;
  renderer?.hideModal();
  renderer?.hideResponse();
  hints?.brief('');
  if (game) renderer.render(game.state, ui);
  resolve(choice);
}

async function decide(ctx) {
  await motion.drain();
  if (ctx.player.index === HUMAN && !AUTOPLAY) return humanDecide(ctx);
  return aiDecide(ctx);
}

async function aiDecide(ctx) {
  ui.thinkingIndex = ctx.player.index;
  renderer.render(game.state, ui);
  hints.brief(`${ctx.player.name} 正在思考…`);
  await motion.wait(ui.fast ? 0 : 260);
  const choice = ais[ctx.player.index].decide(ctx);
  ui.thinkingIndex = null;
  renderer.render(game.state, ui);
  hints.brief('');
  return choice;
}

function humanDecide(ctx) {
  return new Promise((resolve) => {
    ui.pending = ctx.request;
    ui.resolve = resolve;
    ui.selectedCardUid = null;
    ui.targeting = null;
    ui.dropTargetIndex = null;
    ui.preferAsAttack = false;
    renderer.render(game.state, ui);
    if (ctx.request.type === 'select') {
      hints.brief(ctx.request.prompt ?? '请做出选择');
      if (ctx.request.purpose === 'defense_response') renderer.showResponse(ctx.request, resolvePending);
      else renderer.showModal(ctx.request, resolvePending);
    } else {
      hints.brief('轮到你出牌 — 拖动一张手牌到目标座位，或点击手牌查看行动。');
      hints.coach('turn', '拖动一张手牌到发光的座位就能指定目标；点击手牌也可以选中，再用方向键或点击座位。', $('hand'));
    }
  });
}

// ---------------------------------------------------------------- events

async function applyEvent(e) {
  const s = game?.state;
  if (!s) return;

  switch (e.type) {
    case 'gameStart':
      renderer.render(s, ui);
      break;

    case 'turnStart':
      ui.extraTurn = Boolean(e.extra);
      ui.thinkingIndex = null;
      stageTone = null;
      renderer.clearStage();
      renderer.render(s, ui);
      if (e.playerIndex != null) motion.pulse(renderer.seatEl(e.playerIndex));
      if (e.extra) renderer.toast(`${playerName(e.playerIndex)}「国民应用」额外回合`, 'gold');
      break;

    case 'play': {
      const isDefense = e.card.kind === 'defense';
      const item = {
        id: `stage-${++stageSeq}`,
        card: e.card,
        caption: `${playerName(e.playerIndex)}${e.targetIndex != null ? ` → ${playerName(e.targetIndex)}` : ''}`,
        tone: isDefense ? 'defense' : e.card.kind === 'attack' ? 'attack' : 'drop',
      };
      if (isDefense && stageTone === 'attack') {
        renderer.appendStage(item);
        await motion.cardSlide(renderer.stageEl(item.id));
      } else {
        renderer.setStage([item]);
        stageTone = item.tone;
        await motion.cardDrop(renderer.stageEl(item.id));
      }
      renderer.render(s, ui);
      break;
    }

    case 'attack':
      renderer.render(s, ui);
      await motion.beam($('table'), renderer.seatEl(e.sourceIndex), renderer.seatEl(e.targetIndex), 'bad');
      break;

    case 'damage': {
      renderer.render(s, ui);
      renderer.flashSeat(e.targetIndex, 'hurt', 460);
      const c = fxCenter(e.targetIndex);
      if (c) {
        motion.floatText($('fxLayer'), c.x, c.y, `-${e.amount}`, 'bad');
        motion.spark($('fxLayer'), c.x, c.y - 8, '#ff6a5e');
      }
      break;
    }

    case 'heal': {
      renderer.render(s, ui);
      const c = fxCenter(e.playerIndex);
      if (c) {
        motion.floatText($('fxLayer'), c.x, c.y, `+${e.amount}`, 'good');
        motion.spark($('fxLayer'), c.x, c.y - 8, '#62d084');
      }
      break;
    }

    case 'draw':
      renderer.render(s, ui);
      motion.pulse($('drawPile'));
      if (e.reveal?.length) {
        const card = e.reveal[0];
        const item = { id: `reveal-${++stageSeq}`, card, caption: `${playerName(e.playerIndex)} 公开`, tone: 'judge' };
        renderer.setStage([item]);
        motion.flipIn(renderer.stageEl(item.id));
      }
      break;

    case 'judge': {
      const item = { id: `judge-${++stageSeq}`, card: e.card, caption: `判定 · ${playerName(e.playerIndex)}`, tone: 'judge' };
      renderer.setStage([item]);
      stageTone = 'judge';
      await motion.flipIn(renderer.stageEl(item.id));
      renderer.render(s, ui);
      break;
    }

    case 'equip': {
      const item = { id: `equip-${++stageSeq}`, card: e.card, caption: `${playerName(e.playerIndex)} 装备`, tone: 'drop' };
      renderer.setStage([item]);
      stageTone = 'drop';
      await motion.cardDrop(renderer.stageEl(item.id));
      renderer.render(s, ui);
      break;
    }

    case 'eliminated': {
      renderer.render(s, ui);
      renderer.toast(`${playerName(e.playerIndex)} 出局`, 'bad');
      const c = fxCenter(e.playerIndex);
      if (c) motion.floatText($('fxLayer'), c.x, c.y, '出局', 'bad');
      break;
    }

    case 'loot':
      renderer.toast(`${playerName(e.playerIndex)} 接管了出局者的手牌与装备`, 'gold');
      renderer.render(s, ui);
      break;

    case 'rescue':
      renderer.toast(`${playerName(e.playerIndex)} 救援了 ${playerName(e.targetIndex)}`, 'good');
      break;

    case 'reveal':
      if (e.cards?.length === 1 && e.cards[0].kind === 'defense' && stageTone === 'attack') {
        const item = { id: `reveal-${++stageSeq}`, card: e.cards[0], caption: `响应 · ${playerName(e.playerIndex)}`, tone: 'defense' };
        renderer.appendStage(item);
        motion.cardSlide(renderer.stageEl(item.id));
      } else if (e.cards?.length) {
        renderer.toast(`${playerName(e.playerIndex)} 公开了 ${e.cards.length} 张牌`, 'gold');
      }
      break;

    case 'skill':
      // 技能提示只保留有辨识度的几条，避免刷屏。
      if ([
        'extra_turn_after_each_other_turn',
        'lose_one_compute_at_turn_end',
        'attack_needs_two_defenses',
        'judge_heart_as_defense',
        'unlimited_attacks_per_turn',
        'any_card_as_attack',
      ].includes(e.mechanic)) {
        renderer.toast(`${playerName(e.playerIndex)}「${e.skill}」`, 'gold');
      }
      break;

    case 'gameOver':
      ui.gameOver = true;
      ui.pending = null;
      renderer.render(s, ui);
      break;

    case 'end':
      renderer.render(s, ui);
      break;

    default:
      renderer.render(s, ui);
  }
}

function onEvent(e) {
  motion.enqueue(() => applyEvent(e));
}

// ---------------------------------------------------------------- lifecycle

async function bootGame() {
  if (booted) return;
  booted = true;
  renderer.hideOverlay();
  try {
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
      onEvent,
    });
    console.info(`[DISTILL] seed=${SEED} players=${PLAYER_COUNT}`);
    renderer.render(game.state, ui);
    hints.brief('对局开始 — 拖动一张手牌到目标座位，或点击手牌查看行动。');
    await game.run();
    await motion.drain();
    renderer.showGameOver(game.state, HUMAN);
  } catch (err) {
    console.error(err);
    booted = false;
    $('overlay').classList.remove('hidden');
    $('overlayTitle').textContent = '启动失败';
    $('overlayBody').innerHTML = `<p>${err.message}</p><p>请通过本地服务器打开：<code>npm run serve</code>，不要直接双击 index.html。</p>`;
    $('overlayBtn').textContent = '重试';
    $('overlayBtn').disabled = false;
    $('overlayBtn').onclick = () => location.reload();
  }
}

// ---------------------------------------------------------------- chrome

function syncFastUI() {
  const btn = $('speedBtn');
  btn.textContent = ui.fast ? '常速' : '快进';
  btn.classList.toggle('primary', ui.fast);
  const checkbox = $('fastMode');
  if (checkbox) checkbox.checked = ui.fast;
}

function toggleFast() {
  ui.fast = !ui.fast;
  motion.setFast(ui.fast);
  writeKey(FAST_KEY, ui.fast ? '1' : '0');
  syncFastUI();
  renderer.toast(ui.fast ? '快进已开启' : '快进已关闭', 'gold');
}

function syncModeUI() {
  const mode = hints.getMode();
  for (const btn of document.querySelectorAll('#modeControl button')) {
    btn.classList.toggle('on', btn.dataset.mode === mode);
  }
}

function bindChrome() {
  $('logBtn').addEventListener('click', () => $('logDrawer').classList.toggle('hidden'));
  $('logClose').addEventListener('click', () => $('logDrawer').classList.add('hidden'));
  $('settingsBtn').addEventListener('click', () => $('settingsPanel').classList.toggle('hidden'));
  $('settingsClose').addEventListener('click', () => $('settingsPanel').classList.add('hidden'));
  $('speedBtn').addEventListener('click', toggleFast);

  for (const btn of document.querySelectorAll('#modeControl button')) {
    btn.addEventListener('click', () => {
      hints.setMode(btn.dataset.mode);
      syncModeUI();
      renderer.toast(btn.dataset.mode === 'beginner' ? '已切换到新手提示' : btn.dataset.mode === 'expert' ? '已切换到专家模式' : '已切换到标准提示', 'gold');
    });
  }

  const reduce = $('reduceMotion');
  reduce.checked = motion.isReduced();
  reduce.addEventListener('change', () => {
    motion.setReduced(reduce.checked);
    writeKey(REDUCE_KEY, reduce.checked ? '1' : '0');
    renderer.toast(reduce.checked ? '已减少动效' : '已恢复动效', 'gold');
  });

  const fast = $('fastMode');
  fast.addEventListener('change', () => {
    ui.fast = fast.checked;
    motion.setFast(ui.fast);
    writeKey(FAST_KEY, ui.fast ? '1' : '0');
    syncFastUI();
  });

  syncFastUI();
  syncModeUI();
}

// ---------------------------------------------------------------- boot

(async function boot() {
  const overlayBtn = $('overlayBtn');
  overlayBtn.textContent = '读取牌堆中…';
  overlayBtn.disabled = true;
  $('overlayBody').innerHTML = '<p>正在读取牌堆、角色与素材清单…</p>';

  assets = await loadAssets();

  hints = createHints({ mode: PARAMS.get('mode') || 'standard' });
  if (PARAMS.get('mode')) hints.setMode(PARAMS.get('mode'));
  const reduced = PARAMS.get('reduce') === '1'
    || readKey(REDUCE_KEY) === '1'
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  motion = createMotion({ fast: ui.fast, reduced });
  renderer = createRenderer({
    assets,
    hints,
    // 带目标的主动效果（Task）需要先进入瞄准状态，不能直接 resolve。
    onAction: (action) => (input ? input.handleAction(action) : resolvePending(action)),
    onCancel: () => input?.cancel(),
  });
  input = createInput({
    motion,
    renderer,
    hints,
    getState: () => game?.state ?? null,
    getUi: () => ui,
    onIntent: resolvePending,
    onFastToggle: toggleFast,
  });
  bindChrome();
  renderer.showIntro({ onStart: bootGame });

  if (PARAMS.get('auto') === '1') bootGame();
})();
