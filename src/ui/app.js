import { loadAssets } from './assets.js';
import { createHints } from './hints.js';
import { createMotion } from './motion.js';
import { createRenderer } from './render.js';
import { createInput } from './input.js';
import { showIntro, showGameOver, introSeen } from './screens.js';
import { buildProjection, seatByIndex } from './project.js';

const $ = (id) => document.getElementById(id);

const REDUCE_KEY = 'distill.ui.reduce';
const MODE_KEY = 'distill.ui.mode';

function readKey(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeKey(key, value) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

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

/**
 * 通用客户端启动：UI 不持有引擎，只消费协议三件套——
 *   decide(ctx) 请求（本地座位走人机交互，其余交给注入的外部决策者）
 *   onEvent(e)  事件流（驱动动画与公共元数据跟踪）
 *   view(seat)  视图（getView 注入，渲染唯一信息来源）
 *
 * config:
 *   seat           本地座位号（0 基）
 *   autopilot      true 时本地座位也交给 externalDecide（demo 的 autoplay 回归）
 *   externalDecide(ctx) 非本地座位的决策回调（demo 注入 AI）
 *   getView()      取本地座位的最新 view 快照
 *   startGame({ decide, onEvent })  由外部建局并跑完，返回 Promise
 *   mode / reduce / autoStart      开场设置（由入口解析 URL 后传入）
 */
export async function bootDistillClient(config) {
  const seat = config.seat ?? 0;

  const assets = await loadAssets();
  const data = await loadData();

  const hints = createHints({ mode: config.mode ?? 'standard' });
  if (config.mode) hints.setMode(config.mode);
  const reduced = Boolean(config.reduce)
    || readKey(REDUCE_KEY) === '1'
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motion = createMotion({ reduced });

  // 客户端状态：交互请求、瞄准/拖拽、思考指示等纯 UI 状态。
  const ui = {
    pending: null,
    resolve: null,
    selectedCardUid: null,
    targeting: null,
    dropTargetIndex: null,
    preferAsAttack: false,
    thinkingIndex: null,
  };

  // 公共元数据：引擎不放进 view 的桌面公共状态，由事件流跟踪。
  const meta = { currentIndex: null, extraTurn: false, gameOver: false, result: null };

  let view = null; // 最近一次 view(seat) 快照
  let stageSeq = 0;
  let stageTone = null;
  let booted = false;

  const projection = () => (view ? buildProjection(view, meta) : null);
  const renderNow = () => renderer.render(projection(), ui);
  const refreshView = (next) => { view = next ?? config.getView(); };
  const nameOf = (index) => {
    const model = projection() && seatByIndex(projection(), index);
    return model ? (model.isYou ? '你' : model.name) : '—';
  };

  const renderer = createRenderer({
    assets,
    hints,
    onAction: (action) => input.handleAction(action),
    onCancel: () => input.cancel(),
  });

  const input = createInput({
    motion,
    renderer,
    hints,
    getView: () => view,
    onIntent: resolvePending,
  });
  input.bindUi(() => ui);
  input.bindProjection(projection);

  // ------------------------------------------------------------ decisions

  function resolvePending(choice) {
    if (!ui.resolve) return;
    const resolve = ui.resolve;
    ui.resolve = null;
    ui.pending = null;
    ui.selectedCardUid = null;
    ui.targeting = null;
    ui.dropTargetIndex = null;
    ui.preferAsAttack = false;
    hints.brief('');
    renderNow();
    resolve(choice);
  }

  async function decide(ctx) {
    await motion.drain();
    // 注意：ctx.view 属于「正在决策的那个座位」。本地人机交互时它正好等于
    // 本地视图；AI 决策时绝不能用它的 view 刷新本地投影。
    if (ctx.player.index === seat && !config.autopilot) return humanDecide(ctx);
    return externalDecide(ctx);
  }

  /** 外部座位决策：包一层「正在思考」的表现，决策本身由注入的回调提供。 */
  async function externalDecide(ctx) {
    ui.thinkingIndex = ctx.player.index;
    renderNow();
    hints.brief(`${ctx.player.name} 正在思考…`);
    await motion.wait(260);
    const choice = await config.externalDecide(ctx);
    ui.thinkingIndex = null;
    renderNow();
    hints.brief('');
    return choice;
  }

  function humanDecide(ctx) {
    return new Promise((resolve) => {
      refreshView(ctx.view); // 本地座位的决策请求自带最新本地视图
      ui.pending = ctx.request;
      ui.resolve = resolve;
      ui.selectedCardUid = null;
      ui.targeting = null;
      ui.dropTargetIndex = null;
      ui.preferAsAttack = false;
      renderNow();
      if (ctx.request.type === 'select') {
        hints.brief(ctx.request.prompt ?? '请做出选择');
        renderer.showInteraction(ctx.request, resolvePending);
      } else {
        hints.brief('轮到你 — 拖动手牌到目标座位，或点击手牌。');
        hints.coach('turn', '把牌拖到发光的座位即可指定目标；也可以先点击手牌再点座位。', $('hand'));
      }
    });
  }

  // ------------------------------------------------------------ events（需求 2：固定句式动画）

  function fxHost() {
    return $('fxLayer');
  }

  /** 响应者相对桌面中心的左右方向（±1），用于声明斜插入场的来向。 */
  function slideDir(index) {
    const table = $('table')?.getBoundingClientRect();
    const seatEl = renderer.seatEl(index)?.getBoundingClientRect();
    if (!table || !seatEl) return 1;
    const a = table.left + table.width / 2;
    const b = seatEl.left + seatEl.width / 2;
    return b >= a ? 1 : -1;
  }

  function stageCardEl(card) {
    const node = renderer.createCardEl(card, { size: 'small' });
    node.style.pointerEvents = 'none';
    return node;
  }

  async function applyEvent(e) {
    refreshView(); // 每个 beat 开头拉取最新快照，保证渲染与事件同步

    switch (e.type) {
      case 'gameStart':
        renderNow();
        break;

      case 'turnStart':
        meta.currentIndex = e.playerIndex;
        meta.extraTurn = Boolean(e.extra);
        ui.thinkingIndex = null;
        stageTone = null;
        renderer.clearStage();
        renderNow();
        if (e.playerIndex != null) motion.pulse(renderer.seatEl(e.playerIndex));
        if (e.extra) renderer.toast(`${nameOf(e.playerIndex)}「国民应用」额外回合`, 'gold');
        break;

      case 'play': {
        const isDefense = e.card.kind === 'defense';
        if (isDefense && stageTone === 'attack') {
          // 响应：声明牌从响应者方向斜插入场，与攻击牌并排
          const item = {
            id: `stage-${++stageSeq}`,
            card: e.card,
            caption: `响应 · ${nameOf(e.playerIndex)}`,
            tone: 'defense',
          };
          const node = renderer.appendStage(item);
          renderNow();
          await motion.cardSlide(node, slideDir(e.playerIndex));
          break;
        }
        if (!isDefense && e.card.kind === 'attack' && e.targetIndex != null) {
          // 攻击：卡牌从来源手牌区飞向目标座位 + 攻击光束，再落台
          renderNow();
          const from = e.playerIndex === seat ? $('handWrap') : renderer.seatEl(e.playerIndex);
          await motion.flyClone(fxHost(), from, renderer.seatEl(e.targetIndex), { node: stageCardEl(e.card) });
          await motion.beam($('table'), renderer.seatEl(e.playerIndex), renderer.seatEl(e.targetIndex), 'bad');
          const item = {
            id: `stage-${++stageSeq}`,
            card: e.card,
            caption: `${nameOf(e.playerIndex)} → ${nameOf(e.targetIndex)}`,
            tone: 'attack',
          };
          renderer.setStage([item]);
          stageTone = 'attack';
          await motion.cardDrop(renderer.stageEl(item.id));
          break;
        }
        const item = {
          id: `stage-${++stageSeq}`,
          card: e.card,
          caption: `${nameOf(e.playerIndex)}${e.targetIndex != null ? ` → ${nameOf(e.targetIndex)}` : ''}`,
          tone: isDefense ? 'defense' : 'drop',
        };
        renderer.setStage([item]);
        stageTone = item.tone;
        renderNow();
        await motion.cardDrop(renderer.stageEl(item.id));
        break;
      }

      case 'attack':
        renderNow();
        await motion.beam($('table'), renderer.seatEl(e.sourceIndex), renderer.seatEl(e.targetIndex), 'bad');
        break;

      case 'damage': {
        renderNow();
        renderer.flashSeat(e.targetIndex, 'hurt-anim', 460);
        motion.shake(renderer.seatEl(e.targetIndex));
        const host = fxHost();
        const seatEl = renderer.seatEl(e.targetIndex);
        if (host && seatEl) {
          const hb = host.getBoundingClientRect();
          const sb = seatEl.getBoundingClientRect();
          const x = sb.left + sb.width / 2 - hb.left;
          const y = sb.top + 34 - hb.top;
          motion.floatText(host, x, y, `-${e.amount}`, 'bad');
          motion.spark(host, x, y - 8, '#ff6a5e');
        }
        break;
      }

      case 'heal': {
        renderNow();
        motion.shake(renderer.seatEl(e.playerIndex));
        const host = fxHost();
        const seatEl = renderer.seatEl(e.playerIndex);
        if (host && seatEl) {
          const hb = host.getBoundingClientRect();
          const sb = seatEl.getBoundingClientRect();
          const x = sb.left + sb.width / 2 - hb.left;
          const y = sb.top + 34 - hb.top;
          motion.floatText(host, x, y, `+${e.amount}`, 'good');
          motion.spark(host, x, y - 8, '#62d084');
        }
        break;
      }

      case 'draw': {
        renderNow();
        motion.pulse(renderer.drawPileEl());
        if (e.reveal?.length) {
          const card = e.reveal[0];
          const item = { id: `reveal-${++stageSeq}`, card, caption: `${nameOf(e.playerIndex)} 公开`, tone: 'judge' };
          renderer.setStage([item]);
          await motion.flipIn(renderer.stageEl(item.id));
        } else {
          // 摸牌：牌堆脉冲 + 牌背飞入对应座位（不公开内容）
          const back = document.createElement('div');
          back.className = 'flyCardBack';
          if (assets?.cardBack) back.style.backgroundImage = `url("${assets.cardBack}")`;
          await motion.flyClone(fxHost(), renderer.drawPileEl(), renderer.seatEl(e.playerIndex), { node: back });
        }
        break;
      }

      case 'judge': {
        // 判定：判定牌从牌堆翻出翻转入场
        const item = { id: `judge-${++stageSeq}`, card: e.card, caption: `判定 · ${nameOf(e.playerIndex)}`, tone: 'judge' };
        renderer.setStage([item]);
        stageTone = 'judge';
        renderNow();
        await motion.flipInFrom(renderer.stageEl(item.id), renderer.drawPileEl());
        break;
      }

      case 'equip': {
        // 装备：装备牌飞入座位下方装备区落槽
        renderNow();
        const slotKey = e.slot === 'product' ? 'item' : e.slot?.startsWith('distance') ? 'horse' : 'weapon';
        const target = renderer.slotEl(e.playerIndex, slotKey) ?? renderer.seatEl(e.playerIndex);
        await motion.flyClone(fxHost(), renderer.seatEl(e.playerIndex), target, { node: stageCardEl(e.card) });
        motion.pulse(target);
        break;
      }

      case 'eliminated': {
        renderNow();
        renderer.toast(`${nameOf(e.playerIndex)} 出局`, 'bad');
        motion.shake(renderer.seatEl(e.playerIndex));
        const host = fxHost();
        const seatEl = renderer.seatEl(e.playerIndex);
        if (host && seatEl) {
          const hb = host.getBoundingClientRect();
          const sb = seatEl.getBoundingClientRect();
          motion.floatText(host, sb.left + sb.width / 2 - hb.left, sb.top + 34 - hb.top, '出局', 'bad');
        }
        break;
      }

      case 'loot':
        renderer.toast(`${nameOf(e.playerIndex)} 接管了出局者的手牌与装备`, 'gold');
        renderNow();
        break;

      case 'rescue':
        renderer.toast(`${nameOf(e.playerIndex)} 救援了 ${nameOf(e.targetIndex)}`, 'good');
        break;

      case 'reveal':
        if (e.cards?.length === 1 && e.cards[0].kind === 'defense' && stageTone === 'attack') {
          const item = { id: `reveal-${++stageSeq}`, card: e.cards[0], caption: `响应 · ${nameOf(e.playerIndex)}`, tone: 'defense' };
          const node = renderer.appendStage(item);
          renderNow();
          motion.cardSlide(node, slideDir(e.playerIndex));
        } else if (e.cards?.length) {
          renderer.toast(`${nameOf(e.playerIndex)} 公开了 ${e.cards.length} 张牌`, 'gold');
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
          renderer.toast(`${nameOf(e.playerIndex)}「${e.skill}」`, 'gold');
        }
        break;

      case 'gameOver':
        meta.gameOver = true;
        meta.result = e.result;
        ui.pending = null;
        renderNow();
        break;

      case 'end':
        renderNow();
        break;

      default:
        renderNow();
    }
  }

  function onEvent(e) {
    motion.enqueue(() => applyEvent(e));
  }

  // ------------------------------------------------------------ lifecycle

  async function bootGame() {
    if (booted) return;
    booted = true;
    renderer.hideOverlay();
    try {
      await config.startGame({ decide, onEvent, data });
      await motion.drain();
      refreshView();
      showGameOver({ assets, projection: projection(), seat });
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

  // ------------------------------------------------------------ chrome

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

    for (const btn of document.querySelectorAll('#modeControl button')) {
      btn.addEventListener('click', () => {
        hints.setMode(btn.dataset.mode);
        writeKey(MODE_KEY, btn.dataset.mode);
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

    // 重新打开开场角色介绍：对局已在进行时按钮显示「继续对局」，不重新建局。
    $('introBtn').addEventListener('click', () => {
      showIntro({
        assets,
        characters: data.characters.characters,
        roles: data.roles,
        onStart: bootGame,
        resume: booted,
      });
    });

    syncModeUI();
  }

  // ------------------------------------------------------------ boot

  const overlayBtn = $('overlayBtn');
  overlayBtn.textContent = '读取牌堆中…';
  overlayBtn.disabled = true;
  $('overlayBody').innerHTML = '<p>正在读取牌堆、角色与素材清单…</p>';

  bindChrome();
  // 已看过开场介绍（localStorage 记忆）则直接进牌桌；设置里的「角色介绍」可随时重新打开。
  if (introSeen() && !config.autoStart) {
    bootGame();
  } else {
    showIntro({ assets, characters: data.characters.characters, roles: data.roles, onStart: bootGame });
    if (config.autoStart) bootGame(); // 入口约定的调试参数：自动隐藏开场页直接开局
  }

  return { renderNow, get projection() { return projection(); } };
}
