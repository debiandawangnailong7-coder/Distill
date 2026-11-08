/**
 * 可等待、可取消、可快进的动效队列。
 *
 * 引擎的事件是同步发出的；UI 把每个事件包成一个 beat 入队，按顺序播放。
 * 人类/AI 决策前 await drain()，保证“先看到上一拍，再轮到你”。
 */

export function createMotion({ fast = false, reduced = false } = {}) {
  let queue = [];
  let running = false;
  let fastMode = fast;
  let reduceMode = reduced;

  const instant = () => fastMode || reduceMode;
  const scale = (ms) => (instant() ? 0 : Math.max(0, Math.round(ms)));

  function wait(ms) {
    const d = scale(ms);
    return d === 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, d));
  }

  function enqueue(beat) {
    queue.push(beat);
    if (!running) run();
  }

  async function run() {
    if (running) return;
    running = true;
    while (queue.length) {
      const beat = queue.shift();
      try {
        await beat();
      } catch (err) {
        console.error('[motion] beat failed', err);
      }
    }
    running = false;
  }

  async function drain() {
    while (running || queue.length) {
      await new Promise((r) => setTimeout(r, 16));
    }
  }

  async function animate(el, frames, opts = {}) {
    if (!el) return;
    const duration = scale(opts.duration ?? 260);
    if (duration === 0) {
      try {
        el.animate(frames, { duration: 0, fill: 'both' }).finish();
      } catch {
        /* ignore */
      }
      return;
    }
    const anim = el.animate(frames, {
      duration,
      easing: opts.easing ?? 'cubic-bezier(.2,.8,.25,1)',
      fill: opts.fill ?? 'both',
      delay: scale(opts.delay ?? 0),
    });
    try {
      await anim.finished;
    } catch {
      /* 动画被取消时继续队列 */
    }
  }

  function centerIn(host, el) {
    const hb = host.getBoundingClientRect();
    const eb = el.getBoundingClientRect();
    return { x: eb.left + eb.width / 2 - hb.left, y: eb.top + eb.height / 2 - hb.top };
  }

  async function beam(host, fromEl, toEl, tone = 'bad') {
    if (!host || !fromEl || !toEl) return;
    const a = centerIn(host, fromEl);
    const b = centerIn(host, toEl);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const line = document.createElement('div');
    line.className = `beamFx ${tone}`;
    line.style.left = `${a.x}px`;
    line.style.top = `${a.y}px`;
    line.style.width = `${len}px`;
    line.style.transform = `rotate(${angle}deg)`;
    host.appendChild(line);
    await animate(
      line,
      [
        { opacity: 0, transform: `rotate(${angle}deg) scaleX(.05)` },
        { opacity: 1, transform: `rotate(${angle}deg) scaleX(1)`, offset: 0.35 },
        { opacity: 0, transform: `rotate(${angle}deg) scaleX(1)` },
      ],
      { duration: 430 }
    );
    line.remove();
  }

  function rangeLine(host, fromEl, toEl) {
    if (!host || !fromEl || !toEl) return null;
    const a = centerIn(host, fromEl);
    const b = centerIn(host, toEl);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const line = document.createElement('div');
    line.className = 'rangeFx';
    line.style.left = `${a.x}px`;
    line.style.top = `${a.y}px`;
    line.style.width = `${len}px`;
    line.style.transform = `rotate(${angle}deg)`;
    host.appendChild(line);
    return line;
  }

  function clearRangeLine(line) {
    line?.remove();
  }

  async function floatText(host, x, y, text, tone = 'bad') {
    if (!host) return;
    const el = document.createElement('div');
    el.className = `floatTextFx ${tone}`;
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    host.appendChild(el);
    await animate(
      el,
      [
        { opacity: 0, transform: 'translate(-50%, 6px) scale(.85)' },
        { opacity: 1, transform: 'translate(-50%, -6px) scale(1)', offset: 0.25 },
        { opacity: 0, transform: 'translate(-50%, -40px) scale(1)' },
      ],
      { duration: 760 }
    );
    el.remove();
  }

  async function spark(host, x, y, color = '#8fc4ff') {
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'sparkFx';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.setProperty('--spark', color);
    host.appendChild(el);
    await animate(
      el,
      [
        { opacity: 0, transform: 'translate(-50%,-50%) scale(.2) rotate(0deg)' },
        { opacity: 1, transform: 'translate(-50%,-50%) scale(1) rotate(25deg)', offset: 0.3 },
        { opacity: 0, transform: 'translate(-50%,-50%) scale(.2) rotate(60deg)' },
      ],
      { duration: 520 }
    );
    el.remove();
  }

  async function cardDrop(el) {
    await animate(
      el,
      [
        { opacity: 0, transform: 'translateY(-38px) scale(.82) rotate(-3deg)' },
        { opacity: 1, transform: 'translateY(0) scale(1) rotate(0deg)' },
      ],
      { duration: 330, easing: 'cubic-bezier(.2,.85,.3,1.2)' }
    );
  }

  async function cardSlide(el) {
    await animate(
      el,
      [
        { opacity: 0, transform: 'translateX(34px) scale(.88)' },
        { opacity: 1, transform: 'translateX(0) scale(1)' },
      ],
      { duration: 280 }
    );
  }

  async function shake(el) {
    await animate(
      el,
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-5px)' },
        { transform: 'translateX(4px)' },
        { transform: 'translateX(-2px)' },
        { transform: 'translateX(0)' },
      ],
      { duration: 300 }
    );
  }

  async function pulse(el) {
    await animate(
      el,
      [{ transform: 'scale(1)' }, { transform: 'scale(1.1)', offset: 0.4 }, { transform: 'scale(1)' }],
      { duration: 320 }
    );
  }

  async function flipIn(el) {
    await animate(
      el,
      [
        { opacity: 0, transform: 'rotateY(82deg) scale(.92)' },
        { opacity: 1, transform: 'rotateY(0deg) scale(1)' },
      ],
      { duration: 360, easing: 'cubic-bezier(.2,.7,.2,1)' }
    );
  }

  return {
    enqueue,
    drain,
    wait,
    animate,
    beam,
    rangeLine,
    clearRangeLine,
    floatText,
    spark,
    cardDrop,
    cardSlide,
    shake,
    pulse,
    flipIn,
    setFast(v) { fastMode = Boolean(v); },
    isFast() { return fastMode; },
    setReduced(v) { reduceMode = Boolean(v); },
    isReduced() { return reduceMode; },
    scale,
  };
}
