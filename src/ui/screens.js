/**
 * 页面级界面：开场介绍（intro）与终局结算（game over）。
 * 它们是整页布局，不属于牌桌的 keyed DOM，因此与 render.js 分开。
 */
import { createCharacterCard } from './characterCard.js';

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
    box: document.getElementById('overlayBox'),
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
 * 开场页：固定尺寸的「书页」式翻页手册。
 * 第 1 页是封面（标题图 + 一句 tagline + 身份一览），第 2 页起是漫画分格版式的
 * 角色卡（每页 4 格：9:16 / 3:4 / 4:3 / 16:9）。翻页器与「开始/继续对局」按钮
 * 固定在页面上方。排序：有非占位立绘的角色在前；无立绘的角色与「未推出模型」
 * 占位用袋鼠团子，数量补足到 4 的倍数，保证末页版式完整。
 * resume=true 表示对局已在进行（从设置里重新打开），按钮改为「继续对局」。
 */
export function showIntro({ assets, characters, roles, onStart, resume = false }) {
  const { overlay, box, kicker, title, body, btn } = overlayParts();
  box.classList.add('introMode'); // 书页式定版：按钮与翻页器在上方，页面尺寸固定
  box.classList.toggle('introResume', resume);
  // resume 模式（从设置重访、对局进行中）：入口按钮换成右上角 ✕，关闭即回到牌桌
  box.querySelector('.introClose')?.remove();
  if (resume) {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'iconBtn introClose';
    close.textContent = '×';
    close.setAttribute('aria-label', '关闭角色介绍');
    close.addEventListener('click', hideOverlay);
    box.appendChild(close);
  }

  kicker.textContent = 'CASE FILE · 模型权重身份牌局';
  title.innerHTML = assets?.title
    ? `<img class="titleImg" src="${assets.title}" alt="DISTILL!">`
    : 'DISTILL!';

  body.replaceChildren();
  body.classList.remove('castMode');

  // 翻页器固定在页面顶部
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

  const tagline = document.createElement('p');
  tagline.className = 'introTagline';
  tagline.textContent = '一场关于模型权重的身份牌局。找出谁在蒸馏，别让实验室出局。';
  body.appendChild(tagline);

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
  note.textContent = '开始后可在右上角 ⚙ 调整提示强度；对局中按 E 结束回合。';
  body.appendChild(note);

  // 角色页：棋盘式双列分格——左列 9:16 + 9:12，右列 9:12 + 9:16，
  // 两列各自 16+12 / 12+16，整页正好铺满 18:28（漫画分格版式）。
  const rows = document.createElement('div');
  rows.className = 'castCols';
  const colL = document.createElement('div');
  colL.className = 'castCol';
  const colR = document.createElement('div');
  colR.className = 'castCol';
  rows.append(colL, colR);
  body.appendChild(rows);

  // 排序：有非占位立绘的角色在前（组内保持 characters.json 顺序）；无立绘的
  // 在场角色保持默认奶蛙占位；最后补 3 个「未推出模型」位，用袋鼠团子占位，
  // 总数凑满 4 的倍数，保证末页版式完整。
  const list = characters ?? [];
  const withArt = list.filter((c) => assets?.hasPortrait?.(c.id) === true);
  const noArt = list.filter((c) => assets?.hasPortrait?.(c.id) !== true);
  const teasers = [1, 2, 3].map((n) => ({
    id: `upcoming_${n}`,
    name: `未推出模型 ${'①②③'[n - 1]}`,
    skills: [],
  }));
  const cast = [...withArt, ...noArt, ...teasers];
  const kangaroo = assets?.kangaroo ?? null;
  const fillerArt = (c) => (c.id.startsWith('upcoming_') ? kangaroo : null);
  const pageCount = 1 + Math.ceil(cast.length / PAGE_SIZE);
  let page = 0;

  function render() {
    const isCover = page === 0;
    kicker.classList.toggle('hidden', !isCover);
    title.classList.toggle('hidden', !isCover);
    tagline.classList.toggle('hidden', !isCover);
    roleRow.classList.toggle('hidden', !isCover);
    note.classList.toggle('hidden', !isCover);
    rows.classList.toggle('hidden', isCover);
    body.classList.toggle('castMode', !isCover);

    colL.replaceChildren();
    colR.replaceChildren();
    if (!isCover) {
      const start = (page - 1) * PAGE_SIZE;
      const quads = cast.slice(start, start + PAGE_SIZE);
      while (quads.length < PAGE_SIZE) quads.push(null); // 占满 4 格，版式稳定
      quads.forEach((c, i) => {
        if (!c) return;
        const card = createCharacterCard(c, {
          assets,
          art: 'portrait',
          size: 'lg',
          artSrc: fillerArt(c),
        });
        card.classList.add(`pos${i}`);
        (i % 2 === 0 ? colL : colR).appendChild(card);
      });
    }

    counter.textContent = `${page + 1} / ${pageCount}`;
    prev.disabled = page === 0;
    next.disabled = page >= pageCount - 1;
  }
  prev.addEventListener('click', () => { page = Math.max(0, page - 1); render(); });
  next.addEventListener('click', () => { page = Math.min(pageCount - 1, page + 1); render(); });
  render();

  btn.textContent = '开始对局';
  btn.disabled = false;
  btn.onclick = () => {
    markSeen();
    hideOverlay();
    if (!resume) onStart?.();
  };
  overlay.classList.remove('hidden');
}

/**
 * 终局结算：消费客户端投影（终局后引擎已全量亮出身份，座位模型里 role 均有值）。
 * seat 为本地座位号，用于「你赢了/你输了」与结果表标注。
 */
export function showGameOver({ assets, projection, seat }) {
  const { overlay, box, title, body, btn } = overlayParts();
  box.classList.remove('introMode', 'introResume'); // 退出书页定版，恢复通用遮罩框
  box.querySelector('.introClose')?.remove();
  const w = projection.result;
  const ROLE_NAMES = {
    frontier_lab: '前沿实验室',
    licensed_partner: '授权被许可方',
    distiller: '未授权蒸馏者',
    lone_wolf: '开源独狼',
  };
  const campLabel = w.winner === 'frontier_lab' ? '前沿实验室阵营'
    : w.winner === 'distiller' ? '未授权蒸馏者阵营' : '开源独狼';
  const human = projection.seats.find((p) => p.index === seat);
  const didWin = (p) => w.winner === 'lone_wolf'
    ? p.role?.id === 'lone_wolf' && p.alive
    : w.winner === 'distiller'
      ? p.role?.id === 'distiller'
      : p.role?.id === 'frontier_lab' || p.role?.id === 'licensed_partner';
  const youWon = human ? didWin(human) : false;

  const table = document.createElement('table');
  table.className = 'resultTable';
  table.innerHTML = '<thead><tr><th>玩家</th><th>角色</th><th>身份</th><th>状态</th><th>结果</th></tr></thead>';
  const tbody = document.createElement('tbody');
  for (const p of projection.seats) {
    const tr = document.createElement('tr');
    if (didWin(p)) tr.className = 'win';
    tr.appendChild(document.createElement('td')).textContent = p.index === seat ? '你' : p.name;
    const charTd = document.createElement('td');
    charTd.className = 'withIcon';
    const avatar = img(assets?.character(p.character.id), 'miniAvatar', p.character.name);
    if (avatar) charTd.appendChild(avatar);
    charTd.appendChild(document.createTextNode(p.character.name));
    tr.appendChild(charTd);
    const roleTd = document.createElement('td');
    roleTd.className = 'withIcon';
    const roleName = ROLE_NAMES[p.role?.id] ?? '未公开';
    const roleIcon = img(assets?.role(p.role?.id), 'miniRole', roleName);
    if (roleIcon) roleTd.appendChild(roleIcon);
    roleTd.appendChild(document.createTextNode(roleName));
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
  b.textContent = ROLE_NAMES[human?.role?.id] ?? '未公开';
  mine.appendChild(document.createTextNode('你的身份是 '));
  mine.appendChild(b);
  mine.appendChild(document.createTextNode(`，共进行了 ${projection.turnNumber} 回合。`));
  body.appendChild(mine);
  body.appendChild(table);

  title.textContent = youWon ? '你赢了' : '你输了';
  btn.textContent = '再来一局';
  btn.disabled = false;
  btn.onclick = () => location.reload();
  overlay.classList.remove('hidden');
}
