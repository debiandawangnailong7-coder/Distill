/**
 * 三级提示：
 *   beginner — 首次机制解释 + 拖拽/目标提示
 *   standard — 悬停/拖拽时出现简短说明
 *   expert   — 不主动弹提示，只保留常驻数字
 *
 * 所有模式共用同一套交互；切换模式只改变“解释的多少”，不改变可做的事。
 */

const MODE_KEY = 'distill.ui.mode';
const COACH_PREFIX = 'distill.coach.';

function read(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function createHints({ mode = 'standard' } = {}) {
  let currentMode = read(MODE_KEY, mode);
  let tooltip = null;
  let coach = null;
  let coachKey = null;
  const shownThisSession = new Set();

  const hintLine = document.getElementById('hintLine');

  function setMode(next) {
    currentMode = next;
    write(MODE_KEY, next);
    if (next === 'expert') hide();
    if (next !== 'beginner') hideCoach();
  }

  function getMode() {
    return currentMode;
  }

  function place(el, anchor, preferAbove = true) {
    if (!anchor) {
      el.style.left = '50%';
      el.style.top = '50%';
      el.style.transform = 'translate(-50%, -50%)';
      return;
    }
    const r = anchor.getBoundingClientRect();
    const w = 260;
    const h = el.offsetHeight || 54;
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(10, Math.min(window.innerWidth - w - 10, left));
    let top = preferAbove ? r.top - h - 10 : r.bottom + 10;
    if (top < 8) top = r.bottom + 10;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 10);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.transform = 'none';
  }

  function show(text, anchor, { force = false } = {}) {
    if (!text) return;
    if (currentMode === 'expert' && !force) return;
    hide();
    tooltip = document.createElement('div');
    tooltip.className = 'hintTooltip';
    tooltip.innerHTML = text;
    document.body.appendChild(tooltip);
    place(tooltip, anchor, true);
  }

  function hide() {
    tooltip?.remove();
    tooltip = null;
  }

  function coachMarkup(text) {
    const el = document.createElement('div');
    el.className = 'coachBubble';
    el.innerHTML = `${text}<span class="dismiss">知道了</span>`;
    el.querySelector('.dismiss').addEventListener('click', () => {
      write(`${COACH_PREFIX}${coachKey}`, '1');
      hideCoach();
    });
    return el;
  }

  function coachMark(key, text, anchor) {
    if (currentMode !== 'beginner') return;
    if (read(`${COACH_PREFIX}${key}`, '') || shownThisSession.has(key)) return;
    shownThisSession.add(key);
    hideCoach();
    coachKey = key;
    coach = coachMarkup(text);
    document.body.appendChild(coach);
    place(coach, anchor, true);
    // 关闭时写入 localStorage；本次会话内不重复弹出，避免拖拽时闪烁。
  }

  function hideCoach() {
    coach?.remove();
    coach = null;
    coachKey = null;
  }

  function brief(text) {
    if (!hintLine) return;
    hintLine.innerHTML = text || '';
    hintLine.classList.toggle('show', Boolean(text));
  }

  return { setMode, getMode, show, hide, coach: coachMark, hideCoach, brief };
}
