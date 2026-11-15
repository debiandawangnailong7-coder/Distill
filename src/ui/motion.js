/**
 * 可等待、可降级的动效队列。
 *
 * 引擎的事件是同步发出的；UI 把每个事件包成一个 beat 入队，按顺序播放，
 * 同一时刻至多一条主动画。决策前 await drain()，保证「先看到上一拍，再轮到你」。
 * 降级：reduceMotion 时所有动画瞬时完成（相当于全部关闭），队列语义不变。
 */

export function createMotion({ reduced = false } = {}) {
  let queue = [];
  let running = false;
  let reduceMode = reduced;

  const instant = () => reduceMode;
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

  /** 声明响应：从响应者方向斜插入场，与攻击牌并排。dirX 为响应者相对桌面中心的左右方向（±1）。 */
  async function cardSlide(el, dirX = 1) {
    await animate(
      el,
      [
        { opacity: 0, transform: `translate(${dirX * 46}px, 26px) scale(.88) rotate(${dirX * 6}deg)` },
        { opacity: 1, transform: 'translate(0, 0) scale(1) rotate(0deg)' },
      ],
      { duration: 300 }
    );
  }

  /**
   * 飞牌：把 fromEl 的「影像」从来源位置抛到目标位置后移除。
   * 用于攻击出牌（手牌区→目标座位）、摸牌（牌堆→座位）、装备（座位→装备槽）。
   * 传 node 时克隆该节点作为飞行体（卡面/牌背），否则用空壳 + className。
   * reduceMotion 时直接省略（宁可省略，不堆积）。
   */
  async function flyClone(host, fromEl, toEl, { node = null, className = '' } = {}) {
    if (!host || !fromEl || !toEl) return;
    const fb = fromEl.getBoundingClientRect();
    const tb = toEl.getBoundingClientRect();
    const hb = host.getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.className = `flyGhost ${className}`;
    const payload = node ? node.cloneNode(true) : null;
    if (payload) ghost.appendChild(payload);
    ghost.style.width = `${Math.max(fb.width, 40)}px`;
    ghost.style.height = `${Math.max(fb.height, 40)}px`;
    const sx = fb.left + fb.width / 2 - hb.left;
    const sy = fb.top + fb.height / 2 - hb.top;
    const tx = tb.left + tb.width / 2 - hb.left;
    const ty = tb.top + tb.height / 2 - hb.top;
    ghost.style.left = `${sx}px`;
    ghost.style.top = `${sy}px`;
    host.appendChild(ghost);
    // 入文档后再按真实卡面调整飞行体尺寸（脱离文档的节点量不到宽高）。
    if (payload) {
      const pb = payload.getBoundingClientRect();
      if (pb.width > 0 && pb.height > 0) {
        ghost.style.width = `${pb.width}px`;
        ghost.style.height = `${pb.height}px`;
      }
    }
    await animate(
      ghost,
      [
        { transform: 'translate(-50%, -50%) scale(1) rotate(0deg)', opacity: 0.95 },
        { transform: `translate(calc(-50% + ${(tx - sx) * 0.55}px), calc(-50% + ${(ty - sy) * 0.55 - 34}px)) scale(.94) rotate(-4deg)`, opacity: 1, offset: 0.55 },
        { transform: `translate(calc(-50% + ${tx - sx}px), calc(-50% + ${ty - sy}px)) scale(.6) rotate(3deg)`, opacity: 0.9 },
      ],
      { duration: 380, easing: 'cubic-bezier(.3,.7,.3,1)' }
    );
    ghost.remove();
  }

  /** 判定：牌从牌堆翻出，边位移边翻转入场。 */
  async function flipInFrom(el, fromEl) {
    if (!el || !fromEl) return;
    const eb = el.getBoundingClientRect();
    const fb = fromEl.getBoundingClientRect();
    const dx = fb.left + fb.width / 2 - (eb.left + eb.width / 2);
    const dy = fb.top + fb.height / 2 - (eb.top + eb.height / 2);
    await animate(
      el,
      [
        { opacity: 0, transform: `translate(${dx}px, ${dy}px) rotateY(84deg) scale(.8)` },
        { opacity: 1, transform: 'translate(0, 0) rotateY(0deg) scale(1)' },
      ],
      { duration: 400, easing: 'cubic-bezier(.2,.7,.2,1)' }
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
    flyClone,
    flipInFrom,
    shake,
    pulse,
    flipIn,
    setReduced(v) { reduceMode = Boolean(v); },
    isReduced() { return reduceMode; },
    scale,
  };
}
