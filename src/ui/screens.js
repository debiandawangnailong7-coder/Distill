/**
 * 页面级界面：开场介绍（intro）与终局结算（game over）。
 * 它们是整页布局，不属于牌桌的 keyed DOM，因此与 render.js 分开。
 */
import { createCharacterCard, skillDetailText } from './characterCard.js';

const SEEN_KEY = 'distill.intro.seen';
const PAGE_SIZE = 4; // 2×2 网格

function readSeen() {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
}
function markSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
}

/** 本机是否已看过开场介绍（localStorage 记忆；已看过则启动时直接进牌桌）。 */
export function introSeen() {
  return readSeen();
}

function img(src, cls, alt = '') {
  if (!src) return null;
  const node = document.createElement('img');
  node.className = cls;
  node.src = src;
  node.alt = alt;
  node.decoding = 'async';
  return node;
}

function overlayParts() {
  return {
    overlay: document.getElementById('overlay'),
    kicker: document.getElementById('overlayKicker'),
    title: document.getElementById('overlayTitle'),
    body: document.getElementById('overlayBody'),
    btn: document.getElementById('overlayBtn'),
  };
}

function hideOverlay() {
  document.getElementById('overlay').classList.add('hidden');
}

/**
 * 开场页：普通立绘角色卡 2×2 网格逐页翻阅（无普通立绘的角色用奶蛙占位），
 * 点击卡片在下方预览技能。卡片与局内技能预览共用 createCharacterCard 组件，
 * 只是 size 与美术轴（portrait/普通立绘 ↔ avatar/Q 版座位头像）不同。
 * resume=true 表示对局已在进行（从设置里重新打开），按钮改为「继续对局」。
 */
export function showIntro({ assets, characters, roles, onStart, resume = false }) {
  const { overlay, kicker, title, body, btn } = overlayParts();
  kicker.textContent = 'CASE FILE · 模型权重身份牌局';
  title.innerHTML = assets?.title
    ? `<img class="titleImg" src="${assets.title}" alt="DISTILL!">`
    : 'DISTILL!';

  body.replaceChildren();

  const tagline = document.createElement('p');
  tagline.className = 'introTagline';
  tagline.textContent = '一场关于模型权重的身份牌局。找出谁在蒸馏，别让实验室出局。';
  body.appendChild(tagline);

  const grid = document.createElement('div');
  grid.className = 'castGrid';
  body.appendChild(grid);

  const detail = document.createElement('div');
  detail.className = 'castDetail';
  body.appendChild(detail);

  const pager = document.createElement('div');
  pager.className = 'castPager';
  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'pagerBtn';
  prev.textContent = '‹';
  const counter = document.createElement('span');
  counter.className = 'pagerCounter';
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'pagerBtn';
  next.textContent = '›';
  pager.append(prev, counter, next);
  body.appendChild(pager);

  const roleRow = document.createElement('div');
  roleRow.className = 'roleRow';
  for (const r of roles?.roles ?? []) {
    const badge = document.createElement('span');
    badge.className = 'roleBadge';
    const icon = img(assets?.role(r.id), 'roleBadgeIcon', r.name);
    if (icon) badge.appendChild(icon);
    const label = document.createElement('span');
    label.textContent = r.name;
    badge.appendChild(label);
    badge.title = `${r.name}：${r.objective ?? ''}`;
    roleRow.appendChild(badge);
  }
  body.appendChild(roleRow);

  const note = document.createElement('p');
  note.className = 'startNote';
  note.textContent = '提示强度随时可在 ⚙ 调整；对局中按 F 快进、E 结束回合。';
  body.appendChild(note);

  const cast = characters ?? [];
  const pageCount = Math.max(1, Math.ceil(cast.length / PAGE_SIZE));
  let page = 0;
  let selected = null;

  function render() {
    grid.replaceChildren();
    for (const c of cast.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
      const card = createCharacterCard(c, { assets, art: 'portrait', size: 'lg' });
      if (selected === c) card.classList.add('picked');
      card.addEventListener('click', () => {
        selected = selected === c ? null : c;
        render();
      });
      grid.appendChild(card);
    }
    counter.textContent = `${page + 1} / ${pageCount}`;
    prev.disabled = page === 0;
    next.disabled = page >= pageCount - 1;
    const text = selected ? skillDetailText(selected) : '点击角色卡预览技能';
    detail.textContent = text;
    detail.classList.toggle('empty', !selected);
  }
  prev.addEventListener('click', () => { page = Math.max(0, page - 1); render(); });
  next.addEventListener('click', () => { page = Math.min(pageCount - 1, page + 1); render(); });
  render();

  btn.textContent = resume ? '继续对局' : '开始对局';
  btn.disabled = false;
  btn.onclick = () => {
    markSeen();
    hideOverlay();
    if (!resume) onStart?.();
  };
  overlay.classList.remove('hidden');
}

export function showGameOver({ assets, state, humanIndex }) {
  const { overlay, title, body, btn } = overlayParts();
  const w = state.winner;
  const campLabel = w.winner === 'frontier_lab' ? '前沿实验室阵营'
    : w.winner === 'distiller' ? '未授权蒸馏者阵营' : '开源独狼';
  const human = state.players[humanIndex];
  const didWin = (p) => w.winner === 'lone_wolf'
    ? p.role.id === 'lone_wolf' && p.alive
    : w.winner === 'distiller'
      ? p.role.id === 'distiller'
      : p.role.id === 'frontier_lab' || p.role.id === 'licensed_partner';
  const youWon = didWin(human);

  const table = document.createElement('table');
  table.className = 'resultTable';
  table.innerHTML = '<thead><tr><th>玩家</th><th>角色</th><th>身份</th><th>状态</th><th>结果</th></tr></thead>';
  const tbody = document.createElement('tbody');
  for (const p of state.players) {
    const tr = document.createElement('tr');
    if (didWin(p)) tr.className = 'win';
    tr.appendChild(document.createElement('td')).textContent = p.index === humanIndex ? '你' : p.name;
    const charTd = document.createElement('td');
    charTd.className = 'withIcon';
    const avatar = img(assets?.character(p.character.id), 'miniAvatar', p.character.name);
    if (avatar) charTd.appendChild(avatar);
    charTd.appendChild(document.createTextNode(p.character.name));
    tr.appendChild(charTd);
    const roleTd = document.createElement('td');
    roleTd.className = 'withIcon';
    const roleIcon = img(assets?.role(p.role.id), 'miniRole', p.role.name);
    if (roleIcon) roleTd.appendChild(roleIcon);
    roleTd.appendChild(document.createTextNode(p.role.name));
    tr.appendChild(roleTd);
    tr.appendChild(document.createElement('td')).textContent = p.alive ? `存活（${p.compute}）` : '出局';
    tr.appendChild(document.createElement('td')).textContent = didWin(p) ? '胜' : '负';
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  body.replaceChildren();
  const verdict = document.createElement('p');
  const camp = document.createElement('b');
  camp.textContent = campLabel;
  verdict.appendChild(camp);
  verdict.appendChild(document.createTextNode(`获胜 — ${w.reason}`));
  body.appendChild(verdict);

  const mine = document.createElement('p');
  const b = document.createElement('b');
  b.textContent = human.role.name;
  mine.appendChild(document.createTextNode('你的身份是 '));
  mine.appendChild(b);
  mine.appendChild(document.createTextNode(`，共进行了 ${state.turnNumber} 回合。`));
  body.appendChild(mine);
  body.appendChild(table);

  title.textContent = youWon ? '你赢了' : '你输了';
  btn.textContent = '再来一局';
  btn.disabled = false;
  btn.onclick = () => location.reload();
  overlay.classList.remove('hidden');
}
