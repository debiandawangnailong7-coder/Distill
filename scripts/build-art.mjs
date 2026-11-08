import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 代码渲染的 Q 版角色贴纸。
 *
 * 设计语言（与 assets/generic 的徽记保持一致）：
 *   - 1024×1024，二头身胸像，头部占画面主体，方便 64px 圆形裁切。
 *   - 深色外描边 + 白色内描边 + 平涂 + 硬阴影，缩到 64px 仍能读出剪影。
 *   - 每个角色只保留 3–4 个识别锚点：发色/发型、耳角、服装主色、一件道具。
 *   - 透明背景；光晕放在角色后方，避免圆形裁切后变成色块。
 *
 * 社区形象参考（仅作视觉锚点，不复刻原图）：
 *   - DeepSeek：上善无形「溟月」→ ZipZipPipe「大肥鱼 / 鲸鱼娘」
 *   - Claude：ZipZipPipe「小 C」；GPT：ZipZipPipe「白发龙娘」；
 *     Kimi：ZipZipPipe；豆包 Seed：ZipZipPipe「Seed 娘」。
 *   详见 ASSETS.md 的“社区设定来源”。
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets/characters');

// ---------------------------------------------------------------- primitives

const INK = '#141821';
const WHITE = '#ffffff';

/** 深色外描边 + 白色内描边 + 平涂。顺序保证白边夹在描边和填充之间。 */
function outlinedPath(d, fill, { dark = 28, rim = 11, opacity = 1 } = {}) {
  return `
    <path d="${d}" fill="none" stroke="${INK}" stroke-width="${dark}" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${d}" fill="none" stroke="${WHITE}" stroke-width="${rim}" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${d}" fill="${fill}" opacity="${opacity}"/>`;
}

function outlinedEllipse(cx, cy, rx, ry, fill, { dark = 26, rim = 10 } = {}) {
  return `
    <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${INK}" stroke-width="${dark}"/>
    <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${WHITE}" stroke-width="${rim}"/>
    <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}"/>`;
}

/** 平涂形状，只带深色描边（用于头发内层、服装细节）。 */
function shape(d, fill, stroke = INK, width = 14) {
  return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"/>`;
}

function eye(cx, cy, irisA, irisB, { rx = 46, ry = 58, style = 'normal' } = {}) {
  const id = `eye-${cx}-${cy}`;

  // 闭眼 / 弯眼：用于笑眼和 wink，避免所有角色共用同一张“睁眼证件照”。
  if (style === 'happy' || style === 'wink') {
    const bend = style === 'happy' ? -0.62 : 0.5;
    return `
      <path d="M${cx - rx} ${cy} Q${cx} ${cy + ry * bend} ${cx + rx} ${cy}"
            fill="none" stroke="${INK}" stroke-width="14" stroke-linecap="round"/>
      <path d="M${cx + rx - 2} ${cy + (style === 'happy' ? -6 : 6)} L${cx + rx + 16} ${cy + (style === 'happy' ? -22 : -10)}"
            stroke="${INK}" stroke-width="9" stroke-linecap="round"/>`;
  }

  const base = `
    <defs>
      <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${irisA}"/>
        <stop offset="1" stop-color="${irisB}"/>
      </linearGradient>
    </defs>
    <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#fff" stroke="${INK}" stroke-width="12"/>
    <ellipse cx="${cx}" cy="${cy + 4}" rx="${rx - 9}" ry="${ry - 8}" fill="url(#${id})"/>
    <ellipse cx="${cx}" cy="${cy + 12}" rx="${rx - 22}" ry="${ry - 21}" fill="#141a3a" opacity=".88"/>
    <circle cx="${cx - 15}" cy="${cy - 20}" r="12" fill="#fff"/>
    <circle cx="${cx + 13}" cy="${cy + 8}" r="7" fill="#fff" opacity=".9"/>
    <path d="M${cx - rx + 10} ${cy + ry - 12} Q${cx} ${cy + ry + 8} ${cx + rx - 12} ${cy + ry - 10}"
          fill="none" stroke="#ffffff" stroke-width="6" stroke-linecap="round" opacity=".55"/>
    <path d="M${cx - rx - 8} ${cy - ry + 2} Q${cx} ${cy - ry - 24} ${cx + rx + 8} ${cy - ry + 2}"
          fill="none" stroke="${INK}" stroke-width="11" stroke-linecap="round"/>`;

  if (style === 'half') {
    return `${base}
      <path d="M${cx - rx - 8} ${cy - ry + 18} Q${cx} ${cy - ry - 2} ${cx + rx + 8} ${cy - ry + 18}
               L${cx + rx + 8} ${cy - ry + 52} Q${cx} ${cy - ry + 26} ${cx - rx - 8} ${cy - ry + 52} Z"
            fill="#ffe3d3"/>
      <path d="M${cx - rx - 8} ${cy - ry + 26} Q${cx} ${cy - ry + 2} ${cx + rx + 8} ${cy - ry + 26}"
            fill="none" stroke="${INK}" stroke-width="13" stroke-linecap="round"/>`;
  }

  if (style === 'sparkle') {
    return `${base}
      ${star(cx - 2, cy - 2, 16, '#ffffff')}`;
  }

  return base;
}

function blush(cx, cy) {
  return `<ellipse cx="${cx}" cy="${cy}" rx="32" ry="17" fill="#ff8a9a" opacity=".38"/>`;
}

function mouth(cx, cy, style = 'smile') {
  if (style === 'calm') {
    return `<path d="M${cx - 18} ${cy} Q${cx} ${cy + 14} ${cx + 18} ${cy}"
            fill="none" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>`;
  }
  if (style === 'open') {
    return `<ellipse cx="${cx}" cy="${cy + 6}" rx="18" ry="24" fill="#c94f5c" stroke="${INK}" stroke-width="8"/>
            <path d="M${cx - 10} ${cy + 2} Q${cx} ${cy - 4} ${cx + 10} ${cy + 2}"
                  fill="none" stroke="#ffb3bd" stroke-width="6" stroke-linecap="round"/>`;
  }
  if (style === 'grin') {
    return `<path d="M${cx - 38} ${cy - 2} Q${cx} ${cy + 46} ${cx + 38} ${cy - 2} Q${cx} ${cy + 18} ${cx - 38} ${cy - 2}"
                  fill="#c94f5c" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>
            <path d="M${cx - 20} ${cy + 18} Q${cx} ${cy + 34} ${cx + 20} ${cy + 18}"
                  fill="#ff9d9d" stroke="none"/>`;
  }
  if (style === 'pout') {
    return `<path d="M${cx - 10} ${cy + 4} Q${cx} ${cy - 4} ${cx + 10} ${cy + 4}"
            fill="none" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>`;
  }
  return `<path d="M${cx - 26} ${cy} Q${cx} ${cy + 30} ${cx + 26} ${cy} Q${cx} ${cy + 8} ${cx - 26} ${cy}"
             fill="#c94f5c" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>`;
}

/** 头顶的白色蕾丝/花边带，DeepSeek 的女仆头饰、Generic 都不用。 */
function frillBand(y, width = 470) {
  const left = 512 - width / 2;
  const right = 512 + width / 2;
  const bumps = [];
  const n = 11;
  for (let i = 0; i <= n; i++) {
    const x = left + ((right - left) * i) / n;
    bumps.push(`<circle cx="${x}" cy="${y}" r="31" fill="${WHITE}" stroke="${INK}" stroke-width="13"/>`);
  }
  return `
    ${bumps.join('')}
    <rect x="${left - 8}" y="${y - 8}" width="${width + 16}" height="46" rx="23"
          fill="#f3f6ff" stroke="${INK}" stroke-width="13"/>`;
}

/** 脖子周围的一圈小荷叶领。 */
function collarFrill(y, width = 300) {
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const x = 512 - width / 2 + (width * i) / 8;
    pts.push(`<circle cx="${x}" cy="${y}" r="21" fill="${WHITE}" stroke="${INK}" stroke-width="10"/>`);
  }
  return pts.join('');
}

/** 太阳花/雏菊发饰。 */
function flower(cx, cy, r, petals, petalColor, centerColor) {
  const petalSvg = Array.from({ length: petals }, (_, i) => {
    const a = (i / petals) * Math.PI * 2;
    const x = cx + Math.cos(a) * r * 0.55;
    const y = cy + Math.sin(a) * r * 0.55;
    return `<ellipse cx="${x}" cy="${y}" rx="${r * 0.42}" ry="${r * 0.26}" transform="rotate(${(a * 180) / Math.PI} ${x} ${y})" fill="${petalColor}" stroke="${INK}" stroke-width="9"/>`;
  }).join('');
  return `${petalSvg}<circle cx="${cx}" cy="${cy}" r="${r * 0.3}" fill="${centerColor}" stroke="${INK}" stroke-width="9"/>`;
}

/** 龙角。 */
function horn(x, y, flip, fill = '#f4f0ff') {
  const s = flip ? -1 : 1;
  return `
    ${outlinedPath(
      `M${x} ${y}
       C ${x + s * 18} ${y - 74} ${x + s * 52} ${y - 126} ${x + s * 106} ${y - 156}
       C ${x + s * 84} ${y - 100} ${x + s * 78} ${y - 52} ${x + s * 70} ${y + 4}
       C ${x + s * 42} ${y - 2} ${x + s * 20} ${y} ${x} ${y} Z`,
      fill
    )}
    <path d="M${x + s * 28} ${y - 30} C ${x + s * 46} ${y - 64} ${x + s * 64} ${y - 96} ${x + s * 88} ${y - 122}"
          fill="none" stroke="#d9c27a" stroke-width="10" stroke-linecap="round" opacity=".9"/>`;
}

/** 新月发饰。 */
function crescent(cx, cy, r, fill = '#f2d27a') {
  return `
    <path d="M${cx + r * 0.35} ${cy - r}
             A ${r} ${r} 0 1 0 ${cx + r * 0.35} ${cy + r}
             A ${r * 0.78} ${r * 0.78} 0 1 1 ${cx + r * 0.35} ${cy - r} Z"
          fill="${fill}" stroke="${INK}" stroke-width="10" stroke-linejoin="round"/>
    <path d="M${cx + r * 0.18} ${cy - r * 0.72} A ${r * 0.72} ${r * 0.72} 0 0 0 ${cx + r * 0.18} ${cy + r * 0.72}"
          fill="none" stroke="#fff6cf" stroke-width="8" stroke-linecap="round" opacity=".8"/>`;
}

function star(x, y, r, fill = '#f2d27a') {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.44;
    pts.push(`${x + Math.cos(a) * rr},${y + Math.sin(a) * rr}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>`;
}

/** 四角星闪光，给静态胸像加一点空气感。 */
function sparkle(x, y, r, fill = '#ffffff') {
  const k = r * 0.24;
  return `<path d="M${x} ${y - r} L${x + k} ${y - k} L${x + r} ${y} L${x + k} ${y + k} L${x} ${y + r} L${x - k} ${y + k} L${x - r} ${y} L${x - k} ${y - k} Z"
                 fill="${fill}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>`;
}

/** 手持小书。 */
function book(x, y, w, h, cover, pages = '#fff8e8', label = '') {
  return `
    <g transform="rotate(-9 ${x} ${y})">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${pages}" stroke="${INK}" stroke-width="12"/>
      <rect x="${x}" y="${y}" width="${w * 0.34}" height="${h}" rx="10" fill="${cover}" stroke="${INK}" stroke-width="10"/>
      <path d="M${x + w * 0.42} ${y + h * 0.16} H${x + w * 0.86}" stroke="#c9bda4" stroke-width="7" stroke-linecap="round"/>
      ${label ? `<text x="${x + w * 0.6}" y="${y + h * 0.62}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="${h * 0.3}" font-weight="800" fill="${cover}" stroke="${INK}" stroke-width="4" paint-order="stroke">${label}</text>` : ''}
    </g>`;
}

/** 简单的 Q 版手臂 + 手套感的小手，用来打破正面站桩。 */
function arm({ d, handX, handY, handR = 38, sleeve = '#f4f6fb', skin = '#ffe3d3', width = 54, cuff = null }) {
  return `
    <path d="${d}" fill="none" stroke="${INK}" stroke-width="${width + 22}" stroke-linecap="round"/>
    <path d="${d}" fill="none" stroke="${sleeve}" stroke-width="${width}" stroke-linecap="round"/>
    ${cuff ? `<path d="${d}" fill="none" stroke="${cuff}" stroke-width="${width * 0.5}" stroke-linecap="round" stroke-dasharray="${width * 0.7} ${width * 999}" stroke-dashoffset="-4"/>` : ''}
    <circle cx="${handX}" cy="${handY}" r="${handR}" fill="${skin}" stroke="${INK}" stroke-width="12"/>
    <path d="M${handX - handR * 0.45} ${handY - handR * 0.1} Q${handX} ${handY - handR * 0.55} ${handX + handR * 0.45} ${handY - handR * 0.1}"
          fill="none" stroke="#e3a992" stroke-width="6" stroke-linecap="round" opacity=".75"/>
    <circle cx="${handX - handR * 0.55}" cy="${handY + handR * 0.25}" r="${handR * 0.3}" fill="${skin}" stroke="${INK}" stroke-width="8"/>`;
}

/** 一撮飞出轮廓的头发，给静态胸像一点风向。 */
function strand(d, fill) {
  return `<path d="${d}" fill="${fill}" stroke="${INK}" stroke-width="10" stroke-linejoin="round"/>`;
}

function halo(color) {
  return `
    <defs>
      <radialGradient id="halo" cx="50%" cy="48%" r="52%">
        <stop offset="0" stop-color="${color}" stop-opacity=".34"/>
        <stop offset=".62" stop-color="${color}" stop-opacity=".14"/>
        <stop offset="1" stop-color="${color}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <circle cx="512" cy="480" r="430" fill="url(#halo)"/>`;
}

/**
 * 统一的人形 Q 版底模：大头、胸像、共享的脸和眼睛。
 * 每个角色只提供头发、服装、配件等片段，保证 64px 下仍是同一套贴纸语言。
 */
function chibi({
  haloColor,
  hairDefs = '',
  backHair,
  backExtra = '',
  body,
  eyeA,
  eyeB,
  bangs,
  sideL = '',
  sideR = '',
  neck = '',
  headwear = '',
  frontExtra = '',
  headTilt = 0,
  eyes = ['normal', 'normal'],
  mouthStyle = 'smile',
  arms = '',
  sparkles = '',
}) {
  const tilt = headTilt ? ` transform="rotate(${headTilt} 512 760)"` : '';
  return `
    ${halo(haloColor)}
    ${hairDefs}
    <g${tilt}>${backHair}</g>
    ${backExtra}
    ${body}
    <g${tilt}>
      ${outlinedEllipse(512, 470, 222, 238, '#ffe3d3')}
      ${blush(356, 560)}
      ${blush(668, 560)}
      ${eye(426, 508, eyeA, eyeB, { style: eyes[0] })}
      ${eye(598, 508, eyeA, eyeB, { style: eyes[1] })}
      <path d="M500 570 Q512 578 524 570" fill="none" stroke="#c98d7c" stroke-width="7" stroke-linecap="round" opacity=".7"/>
      ${mouth(512, 602, mouthStyle)}
      ${bangs}
      ${sideL}
      ${sideR}
      ${headwear}
    </g>
    ${neck}
    ${arms}
    ${frontExtra}
    ${sparkles}
  `;
}

// ---------------------------------------------------------------- DeepSeek

function deepseek() {
  const hairDefs = `
    <defs>
      <linearGradient id="hairGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#26479f"/>
        <stop offset=".5" stop-color="#3f74d8"/>
        <stop offset="1" stop-color="#8cc8f7"/>
      </linearGradient>
      <linearGradient id="finGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#4f86e0"/>
        <stop offset="1" stop-color="#1f3f86"/>
      </linearGradient>
    </defs>`;

  // 背后的长卷发。顶部会被头盖住，只露出两鬓和下摆的波浪。
  const backHair = outlinedPath(
    `M512 196
     C 352 196 252 306 244 456
     C 238 560 246 640 222 744
     C 210 806 224 862 256 906
     C 292 868 314 818 324 766
     C 322 848 344 918 386 980
     C 428 928 448 868 456 806
     C 478 898 520 958 572 990
     C 612 926 622 858 620 796
     C 652 878 694 928 746 958
     C 786 898 796 838 786 778
     C 818 828 856 848 898 838
     C 856 716 844 616 834 494
     C 826 314 700 196 512 196 Z`,
    'url(#hairGrad)'
  );

  // 鲸鱼鳍耳：从两鬓伸出，先画后脑勺再画头，内缘会被脸挡住。
  const earFin = (tx, flip) => {
    const s = flip ? -1 : 1;
    return `
      ${outlinedPath(
        `M${tx} 424
         C ${tx + s * 72} 386 ${tx + s * 128} 402 ${tx + s * 148} 462
         C ${tx + s * 110} 486 ${tx + s * 82} 510 ${tx + s * 66} 552
         C ${tx + s * 56} 498 ${tx + s * 34} 456 ${tx} 424 Z`,
        'url(#finGrad)'
      )}
      <path d="M${tx + s * 34} 444 C ${tx + s * 70} 440 ${tx + s * 100} 452 ${tx + s * 116} 476"
            fill="none" stroke="#a8d4ff" stroke-width="9" stroke-linecap="round" opacity=".85"/>`;
  };

  // 背后的鲸尾，给 64px 也留一个轮廓钩子。
  const tail = `
    <path d="M756 826
             C 812 798 874 816 902 874
             C 864 890 836 920 820 962
             C 786 910 766 868 756 826 Z"
          fill="url(#finGrad)" stroke="${INK}" stroke-width="16" stroke-linejoin="round"/>
    <path d="M786 844 C 818 832 846 842 862 864" fill="none" stroke="#a8d4ff" stroke-width="9" stroke-linecap="round"/>`;

  const body = `
    ${outlinedPath(
      `M284 1024
       C 284 866 384 760 512 760
       C 640 760 740 866 740 1024 Z`,
      '#1c2a4a'
    )}
    <path d="M330 842 C 306 900 296 966 296 1024 L408 1024 L408 806 Z"
          fill="#24365e" stroke="${INK}" stroke-width="12" stroke-linejoin="round"/>
    <path d="M694 842 C 718 900 728 966 728 1024 L616 1024 L616 806 Z"
          fill="#24365e" stroke="${INK}" stroke-width="12" stroke-linejoin="round"/>
    <path d="M360 812 Q512 884 664 812 L680 1024 L344 1024 Z"
          fill="#f4f6fb" stroke="${INK}" stroke-width="14" stroke-linejoin="round"/>
    <path d="M386 826 Q512 884 638 826" fill="none" stroke="#d6deee" stroke-width="9" stroke-linecap="round"/>
    <path d="M462 940 C 486 918 520 916 544 936 C 556 946 558 958 550 968 C 532 958 514 956 496 962 C 482 966 474 962 470 954 C 466 950 462 946 462 940 Z"
          fill="#3f74d8" opacity=".92"/>
    <path d="M544 936 C 558 924 574 922 588 928 C 578 940 574 954 576 968 C 564 958 554 946 544 936 Z"
          fill="#3f74d8" opacity=".92"/>
    <circle cx="486" cy="944" r="5" fill="#f4f6fb"/>`;

  const head = outlinedEllipse(512, 470, 222, 238, '#ffe3d3');

  // 前发：中分刘海 + 两缕厚鬓发，遮住额头两侧。
  const bangs = shape(
    `M292 466
     C 296 322 384 242 512 242
     C 640 242 728 322 732 466
     C 700 420 668 408 646 446
     C 624 372 580 352 552 448
     C 524 360 492 360 466 450
     C 438 380 394 392 366 448
     C 344 414 316 428 292 466 Z`,
    'url(#hairGrad)',
    INK,
    16
  );

  const sideLock = (x, flip) => {
    const s = flip ? -1 : 1;
    return shape(
      `M${x} 444
       C ${x + s * 18} 568 ${x + s * 10} 682 ${x - s * 30} 790
       C ${x - s * 72} 724 ${x - s * 78} 596 ${x - s * 52} 466 Z`,
      'url(#hairGrad)',
      INK,
      15
    );
  };

  // 女仆头饰：沿头顶弧线排一圈白色荷叶边。
  const frill = (() => {
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const x = 296 + 432 * t;
      const y = 334 - 196 * Math.sin(Math.PI * t) * 0.62;
      pts.push(`<circle cx="${x}" cy="${y}" r="30" fill="${WHITE}" stroke="${INK}" stroke-width="12"/>`);
    }
    return `
      ${pts.join('')}
      <path d="M296 338 Q512 196 728 338" fill="none" stroke="${INK}" stroke-width="40" stroke-linecap="round"/>
      <path d="M296 338 Q512 196 728 338" fill="none" stroke="${WHITE}" stroke-width="26" stroke-linecap="round"/>`;
  })();

  return chibi({
    haloColor: '#4f8df0',
    hairDefs,
    backHair,
    backExtra: tail,
    body,
    eyeA: '#9fd2ff',
    eyeB: '#2b62d8',
    bangs,
    sideL: `${sideLock(310, false)}
      ${strand('M292 556 C 248 626 238 702 256 776 C 270 700 282 638 316 590 Z', 'url(#hairGrad)')}
      <path d="M300 500 C 292 590 294 680 316 760" fill="none" stroke="#a8d4ff" stroke-width="11" stroke-linecap="round" opacity=".42"/>`,
    sideR: `${sideLock(714, true)}
      ${strand('M732 556 C 776 626 786 702 768 776 C 754 700 742 638 708 590 Z', 'url(#hairGrad)')}
      <path d="M724 500 C 732 590 730 680 708 760" fill="none" stroke="#a8d4ff" stroke-width="11" stroke-linecap="round" opacity=".42"/>`,
    neck: collarFrill(744, 290),
    headwear: `
      <path d="M392 358 C 430 328 470 318 512 318" fill="none" stroke="#a8d4ff" stroke-width="10" stroke-linecap="round" opacity=".55"/>
      ${earFin(306, true)}
      ${earFin(718, false)}
      ${frill}
      <path d="M676 322 C 704 300 736 308 748 336 C 724 344 708 360 700 382 C 686 356 680 338 676 322 Z"
            fill="#4f86e0" stroke="${INK}" stroke-width="12" stroke-linejoin="round"/>
      <path d="M512 242 C 540 190 574 176 604 188 C 578 204 568 226 568 250 C 548 240 530 238 512 242 Z"
            fill="url(#hairGrad)" stroke="${INK}" stroke-width="13" stroke-linejoin="round"/>
      <circle cx="512" cy="300" r="16" fill="#8fc4ff" stroke="${INK}" stroke-width="8"/>`,
    headTilt: -7,
    eyes: ['happy', 'wink'],
    mouthStyle: 'grin',
    arms: `
      ${arm({ d: 'M352 1000 C 310 906 298 800 330 700', handX: 330, handY: 664, handR: 36, sleeve: '#1c2a4a' })}
      ${arm({ d: 'M672 1000 C 714 906 726 800 694 700', handX: 694, handY: 664, handR: 36, sleeve: '#1c2a4a' })}`,
    sparkles: `
      ${sparkle(252, 380, 26, '#8fc4ff')}
      ${sparkle(792, 520, 18, '#ffffff')}
      ${sparkle(760, 300, 14, '#a8d4ff')}
      <path d="M230 610 Q206 640 212 676" fill="none" stroke="#a8d4ff" stroke-width="9" stroke-linecap="round" opacity=".75"/>`,
  });
}

// ---------------------------------------------------------------- Claude

function claude() {
  const hairDefs = `
    <defs>
      <linearGradient id="hairGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#a8431f"/>
        <stop offset=".52" stop-color="#c85a2a"/>
        <stop offset="1" stop-color="#f0a063"/>
      </linearGradient>
    </defs>`;

  const backHair = outlinedPath(
    `M512 198
     C 348 198 250 312 244 466
     C 240 578 252 670 226 774
     C 214 832 228 884 262 924
     C 300 884 322 836 332 786
     C 330 866 352 930 394 986
     C 438 934 458 876 468 816
     C 490 904 532 958 584 986
     C 626 926 636 862 634 804
     C 668 878 712 924 764 950
     C 802 892 810 836 798 780
     C 830 826 866 842 904 830
     C 858 708 846 612 836 494
     C 828 314 700 198 512 198 Z`,
    'url(#hairGrad)'
  );

  const body = `
    ${outlinedPath(
      `M292 1024
       C 292 868 386 760 512 760
       C 638 760 732 868 732 1024 Z`,
      '#f3ead9'
    )}
    <path d="M330 850 C 310 908 300 970 300 1024 L414 1024 L414 808 Z"
          fill="#efe2cc" stroke="${INK}" stroke-width="12" stroke-linejoin="round"/>
    <path d="M694 850 C 714 908 724 970 724 1024 L610 1024 L610 808 Z"
          fill="#efe2cc" stroke="${INK}" stroke-width="12" stroke-linejoin="round"/>
    <path d="M430 800 L512 900 L594 800 L620 1024 L404 1024 Z"
          fill="#c85a2a" stroke="${INK}" stroke-width="14" stroke-linejoin="round"/>
    <path d="M430 800 L512 900 L594 800" fill="none" stroke="#f0a063" stroke-width="9" stroke-linecap="round"/>
    <path d="M392 810 Q512 870 632 810" fill="none" stroke="#d9c7a8" stroke-width="9" stroke-linecap="round"/>
    <circle cx="512" cy="930" r="11" fill="#f2d27a" stroke="${INK}" stroke-width="6"/>`;

  const bangs = shape(
    `M292 464
     C 298 320 386 242 512 242
     C 638 242 726 320 732 464
     C 704 418 674 404 650 444
     C 628 368 584 350 556 446
     C 528 358 496 358 470 448
     C 442 378 398 390 370 446
     C 346 412 316 426 292 464 Z`,
    'url(#hairGrad)',
    INK,
    16
  );

  const sideLock = (x, flip) => {
    const s = flip ? -1 : 1;
    return shape(
      `M${x} 444
       C ${x + s * 22} 566 ${x + s * 16} 684 ${x - s * 24} 796
       C ${x - s * 72} 730 ${x - s * 80} 596 ${x - s * 52} 464 Z`,
      'url(#hairGrad)',
      INK,
      15
    );
  };

  const ribbon = `
    <path d="M390 322 C 356 300 330 316 326 348 C 352 352 370 368 380 390 C 388 362 392 340 390 322 Z"
          fill="#1b1b22" stroke="${INK}" stroke-width="11" stroke-linejoin="round"/>
    <path d="M374 386 C 356 426 344 468 342 514" fill="none" stroke="#1b1b22" stroke-width="15" stroke-linecap="round"/>
    <path d="M390 390 C 390 432 386 472 376 510" fill="none" stroke="#1b1b22" stroke-width="12" stroke-linecap="round"/>`;

  const neck = `
    <path d="M392 738 Q512 786 632 738 L632 806 Q512 856 392 806 Z"
          fill="#1b1b22" stroke="${INK}" stroke-width="13" stroke-linejoin="round"/>
    <path d="M474 802 C 486 788 502 794 512 808 C 522 794 538 788 550 802 C 540 820 524 830 512 836 C 500 830 484 820 474 802 Z"
          fill="#c85a2a" stroke="${INK}" stroke-width="9" stroke-linejoin="round"/>`;

  return chibi({
    haloColor: '#e8843c',
    hairDefs,
    backHair,
    body,
    eyeA: '#ffe09a',
    eyeB: '#c87a1a',
    bangs,
    sideL: `${sideLock(310, false)}
      ${strand('M292 556 C 246 630 236 708 256 784 C 270 704 282 640 316 590 Z', 'url(#hairGrad)')}`,
    sideR: `${sideLock(714, true)}
      ${strand('M732 556 C 778 630 788 708 768 784 C 754 704 742 640 708 590 Z', 'url(#hairGrad)')}`,
    neck,
    headwear: `
      ${flower(296, 330, 86, 11, '#e8894f', '#d9a441')}
      ${ribbon}
      <path d="M596 330 C 620 306 650 310 664 334 C 642 342 628 358 620 380 C 606 356 600 342 596 330 Z"
            fill="#c85a2a" stroke="${INK}" stroke-width="11" stroke-linejoin="round"/>`,
    headTilt: 6,
    eyes: ['half', 'normal'],
    mouthStyle: 'calm',
    arms: `
      ${arm({ d: 'M676 1000 C 712 938 732 890 724 846', handX: 724, handY: 846, handR: 34, sleeve: '#efe2cc' })}
      ${arm({ d: 'M352 1000 C 330 950 330 900 344 862', handX: 344, handY: 862, handR: 32, sleeve: '#efe2cc' })}`,
    frontExtra: book(674, 812, 126, 168, '#8a4a2a', '#fff6e4', ''),
    sparkles: `
      ${sparkle(214, 470, 22, '#f0a063')}
      ${sparkle(786, 620, 16, '#f2d27a')}
      <path d="M150 700 Q126 736 136 776" fill="none" stroke="#f0a063" stroke-width="8" stroke-linecap="round" opacity=".7"/>`,
  });
}

// ---------------------------------------------------------------- GPT

function gpt() {
  const hairDefs = `
    <defs>
      <linearGradient id="hairGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffffff"/>
        <stop offset=".55" stop-color="#e4dcf6"/>
        <stop offset="1" stop-color="#c8bde8"/>
      </linearGradient>
      <linearGradient id="wingGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fbf8ff"/>
        <stop offset="1" stop-color="#cfc4ef"/>
      </linearGradient>
    </defs>`;

  const backHair = outlinedPath(
    `M512 188
     C 342 188 238 310 232 472
     C 228 588 240 684 214 792
     C 202 850 218 902 252 942
     C 292 900 316 850 326 798
     C 324 878 346 942 388 996
     C 432 944 452 886 462 824
     C 486 912 528 966 580 994
     C 622 934 632 868 630 808
     C 664 884 708 930 760 956
     C 798 896 806 838 794 782
     C 826 828 862 844 900 832
     C 854 710 842 614 832 496
     C 824 316 700 188 512 188 Z`,
    'url(#hairGrad)'
  );

  const wings = `
    <path d="M292 900 C 216 862 170 792 172 712 C 226 748 262 800 282 858 Z"
          fill="url(#wingGrad)" stroke="${INK}" stroke-width="14" stroke-linejoin="round"/>
    <path d="M732 900 C 808 862 854 792 852 712 C 798 748 762 800 742 858 Z"
          fill="url(#wingGrad)" stroke="${INK}" stroke-width="14" stroke-linejoin="round"/>
    <path d="M258 844 C 236 812 220 778 214 744" fill="none" stroke="#b9aee0" stroke-width="9" stroke-linecap="round"/>
    <path d="M766 844 C 788 812 804 778 810 744" fill="none" stroke="#b9aee0" stroke-width="9" stroke-linecap="round"/>`;

  const body = `
    ${outlinedPath(
      `M296 1024
       C 296 868 388 760 512 760
       C 636 760 728 868 728 1024 Z`,
      '#f8f5ff'
    )}
    <path d="M330 852 C 310 910 300 970 300 1024 L414 1024 L414 808 Z"
          fill="#efeafd" stroke="${INK}" stroke-width="12" stroke-linejoin="round"/>
    <path d="M694 852 C 714 910 724 970 724 1024 L610 1024 L610 808 Z"
          fill="#efeafd" stroke="${INK}" stroke-width="12" stroke-linejoin="round"/>
    <path d="M430 806 L512 900 L594 806 L620 1024 L404 1024 Z"
          fill="#ffffff" stroke="${INK}" stroke-width="14" stroke-linejoin="round"/>
    <path d="M430 806 L512 900 L594 806" fill="none" stroke="#d9c27a" stroke-width="10" stroke-linecap="round"/>
    <path d="M512 900 L512 1024" stroke="#d9c27a" stroke-width="8" stroke-linecap="round"/>
    <path d="M448 860 C 460 900 460 940 448 980" fill="none" stroke="#cfc4ef" stroke-width="8" stroke-linecap="round"/>
    <path d="M576 860 C 564 900 564 940 576 980" fill="none" stroke="#cfc4ef" stroke-width="8" stroke-linecap="round"/>
    <circle cx="512" cy="980" r="12" fill="#d9c27a" stroke="${INK}" stroke-width="6"/>`;

  const bangs = shape(
    `M292 466
     C 296 318 386 238 512 238
     C 638 238 728 318 732 466
     C 700 420 668 406 646 446
     C 624 370 582 352 554 446
     C 526 358 494 358 468 446
     C 440 378 396 390 368 446
     C 344 412 316 426 292 466 Z`,
    'url(#hairGrad)',
    INK,
    16
  );

  const sideLock = (x, flip) => {
    const s = flip ? -1 : 1;
    return shape(
      `M${x} 444
       C ${x + s * 22} 568 ${x + s * 14} 688 ${x - s * 26} 800
       C ${x - s * 74} 732 ${x - s * 82} 596 ${x - s * 54} 464 Z`,
      'url(#hairGrad)',
      INK,
      15
    );
  };

  const neck = `
    <path d="M398 736 Q512 780 626 736 L626 804 Q512 850 398 804 Z"
          fill="#f8f5ff" stroke="${INK}" stroke-width="13" stroke-linejoin="round"/>
    <path d="M438 804 Q512 842 586 804" fill="none" stroke="#d9c27a" stroke-width="9" stroke-linecap="round"/>`;

  return chibi({
    haloColor: '#a99cf0',
    hairDefs,
    backHair,
    backExtra: wings,
    body,
    eyeA: '#c9b6ff',
    eyeB: '#6f57c8',
    bangs,
    sideL: `${sideLock(310, false)}
      ${strand('M292 556 C 246 630 236 708 256 784 C 270 704 282 640 316 590 Z', 'url(#hairGrad)')}`,
    sideR: `${sideLock(714, true)}
      ${strand('M732 556 C 778 630 788 708 768 784 C 754 704 742 640 708 590 Z', 'url(#hairGrad)')}`,
    neck,
    headTilt: -6,
    eyes: ['normal', 'sparkle'],
    mouthStyle: 'grin',
    arms: `
      ${arm({ d: 'M676 1000 C 704 936 724 860 734 792', handX: 734, handY: 792, handR: 34, sleeve: '#efeafd' })}
      ${arm({ d: 'M352 1000 C 330 946 330 894 342 852', handX: 342, handY: 852, handR: 30, sleeve: '#efeafd' })}`,
    headwear: `
      ${horn(372, 316, true)}
      ${horn(652, 316, false)}
      <circle cx="512" cy="270" r="15" fill="#f2d27a" stroke="${INK}" stroke-width="7"/>
      <path d="M472 268 Q512 244 552 268" fill="none" stroke="#d9c27a" stroke-width="8" stroke-linecap="round"/>`,
    frontExtra: `
      <path d="M676 808 C 714 792 754 806 770 842 C 748 852 732 874 724 904 C 700 868 686 838 676 808 Z"
            fill="#d9c27a" stroke="${INK}" stroke-width="12" stroke-linejoin="round"/>
      <path d="M702 830 C 722 824 740 832 750 848" fill="none" stroke="#fff6cf" stroke-width="8" stroke-linecap="round"/>
      <circle cx="744" cy="744" r="34" fill="#8fc4ff" stroke="${INK}" stroke-width="11"/>
      <circle cx="734" cy="734" r="11" fill="#ffffff" opacity=".9"/>`,
    sparkles: `
      ${sparkle(226, 420, 20, '#c9b6ff')}
      ${sparkle(806, 560, 24, '#f2d27a')}
      ${sparkle(790, 330, 14, '#8fc4ff')}
      <path d="M180 600 Q156 640 166 682" fill="none" stroke="#d9c27a" stroke-width="8" stroke-linecap="round" opacity=".75"/>`,
  });
}

// ---------------------------------------------------------------- Kimi

function kimi() {
  const hairDefs = `
    <defs>
      <linearGradient id="hairGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fbf9ff"/>
        <stop offset=".52" stop-color="#ddd5f6"/>
        <stop offset="1" stop-color="#b9aee8"/>
      </linearGradient>
    </defs>`;

  const backHair = outlinedPath(
    `M512 194
     C 344 194 242 312 236 472
     C 232 586 244 680 220 786
     C 208 844 224 896 258 936
     C 298 894 322 846 332 794
     C 330 874 352 938 394 992
     C 438 940 458 882 468 820
     C 492 908 534 962 586 990
     C 628 930 638 864 636 804
     C 670 880 714 926 766 952
     C 804 892 812 834 800 778
     C 832 824 868 840 906 828
     C 860 706 848 610 838 492
     C 830 312 700 194 512 194 Z`,
    'url(#hairGrad)'
  );

  const body = `
    ${outlinedPath(
      `M296 1024
       C 296 868 388 760 512 760
       C 636 760 728 868 728 1024 Z`,
      '#232044'
    )}
    <path d="M330 852 C 310 910 300 970 300 1024 L414 1024 L414 808 Z"
          fill="#2d2a58" stroke="${INK}" stroke-width="12" stroke-linejoin="round"/>
    <path d="M694 852 C 714 910 724 970 724 1024 L610 1024 L610 808 Z"
          fill="#2d2a58" stroke="${INK}" stroke-width="12" stroke-linejoin="round"/>
    <path d="M402 804 Q512 880 622 804 L640 1024 L384 1024 Z"
          fill="#f4f1fb" stroke="${INK}" stroke-width="14" stroke-linejoin="round"/>
    <path d="M428 840 Q512 892 596 840" fill="none" stroke="#c9c4e8" stroke-width="9" stroke-linecap="round"/>
    <path d="M512 900 L512 1024" stroke="#c9c4e8" stroke-width="8" stroke-linecap="round"/>
    <path d="M458 916 L472 944 L502 948 L480 968 L486 998 L458 984 L430 998 L436 968 L414 948 L444 944 Z"
          fill="#f2d27a" stroke="${INK}" stroke-width="7" stroke-linejoin="round" opacity=".95"/>
    <circle cx="584" cy="952" r="9" fill="#f2d27a" stroke="${INK}" stroke-width="5"/>`;

  const bangs = shape(
    `M292 466
     C 298 320 386 240 512 240
     C 638 240 726 320 732 466
     C 700 420 670 406 646 446
     C 624 370 582 352 554 446
     C 526 358 494 358 468 446
     C 440 378 396 390 368 446
     C 344 412 316 426 292 466 Z`,
    'url(#hairGrad)',
    INK,
    16
  );

  const sideLock = (x, flip) => {
    const s = flip ? -1 : 1;
    return shape(
      `M${x} 444
       C ${x + s * 22} 568 ${x + s * 14} 688 ${x - s * 26} 800
       C ${x - s * 74} 732 ${x - s * 82} 596 ${x - s * 54} 464 Z`,
      'url(#hairGrad)',
      INK,
      15
    );
  };

  return chibi({
    haloColor: '#8b7bd8',
    hairDefs,
    backHair,
    body,
    eyeA: '#c2b7ff',
    eyeB: '#5b4fc8',
    bangs,
    sideL: `${sideLock(310, false)}
      ${strand('M292 556 C 246 630 236 708 256 784 C 270 704 282 640 316 590 Z', 'url(#hairGrad)')}`,
    sideR: `${sideLock(714, true)}
      ${strand('M732 556 C 778 630 788 708 768 784 C 754 704 742 640 708 590 Z', 'url(#hairGrad)')}`,
    neck: collarFrill(744, 280),
    headTilt: 7,
    eyes: ['half', 'normal'],
    mouthStyle: 'calm',
    arms: `
      ${arm({ d: 'M664 1000 C 702 938 722 890 714 848', handX: 714, handY: 848, handR: 32, sleeve: '#2d2a58' })}
      ${arm({ d: 'M360 1000 C 338 950 338 902 350 864', handX: 350, handY: 864, handR: 30, sleeve: '#2d2a58' })}`,
    headwear: `
      ${crescent(296, 320, 74)}
      <path d="M330 386 C 356 420 368 466 366 514" fill="none" stroke="#232044" stroke-width="14" stroke-linecap="round"/>
      <path d="M310 382 C 300 424 300 466 310 508" fill="none" stroke="#232044" stroke-width="12" stroke-linecap="round"/>
      ${star(356, 300, 22)}
      ${star(260, 388, 15)}`,
    frontExtra: book(674, 812, 120, 156, '#232044', '#f4f1fb', 'K'),
    sparkles: `
      ${sparkle(216, 510, 18, '#c2b7ff')}
      ${sparkle(790, 620, 22, '#f2d27a')}
      <path d="M156 690 Q132 730 144 772" fill="none" stroke="#c2b7ff" stroke-width="8" stroke-linecap="round" opacity=".7"/>`,
  });
}

// ---------------------------------------------------------------- Doubao Seed

function doubao() {
  return `
    ${halo('#ff9d8a')}
    <ellipse cx="512" cy="850" rx="300" ry="52" fill="#000" opacity=".16"/>
    <g transform="rotate(-5 512 780)">
      ${outlinedPath(
        `M512 238
         C 348 238 246 386 246 566
         C 246 762 356 886 512 886
         C 668 886 778 762 778 566
         C 778 386 676 238 512 238 Z`,
        '#fbf8f2'
      )}
      <path d="M430 300 C 452 266 482 250 512 250 C 542 250 572 266 594 300 C 566 322 538 330 512 330 C 486 330 458 322 430 300 Z"
            fill="#efe7da" stroke="${INK}" stroke-width="11" stroke-linejoin="round"/>
      <path d="M512 250 L512 330 M474 270 C 486 296 498 310 512 320 M550 270 C 538 296 526 310 512 320"
            fill="none" stroke="#cfc3b2" stroke-width="8" stroke-linecap="round"/>
      <path d="M548 214 C 582 190 618 202 624 234 C 630 264 606 284 580 276"
            fill="none" stroke="#ffffff" stroke-width="14" stroke-linecap="round" opacity=".9"/>
      ${outlinedEllipse(512, 586, 196, 172, '#fffdf8')}
      <ellipse cx="512" cy="606" rx="146" ry="122" fill="#f7f1e6" opacity=".8"/>
      <path d="M392 574 Q426 548 460 574" fill="none" stroke="${INK}" stroke-width="12" stroke-linecap="round"/>
      <circle cx="472" cy="558" r="5" fill="${INK}" opacity=".55"/>
      <ellipse cx="598" cy="574" rx="34" ry="40" fill="#2a2020"/>
      <circle cx="586" cy="560" r="11" fill="#fff"/>
      <path d="M462 640 Q512 694 562 640 Q512 660 462 640" fill="#c94f5c" stroke="${INK}" stroke-width="9" stroke-linejoin="round"/>
      <path d="M492 668 Q512 684 532 668" fill="#ff9d9d"/>
      <ellipse cx="356" cy="632" rx="30" ry="15" fill="#ff9d9d" opacity=".45"/>
      <ellipse cx="668" cy="632" rx="30" ry="15" fill="#ff9d9d" opacity=".45"/>
      <path d="M300 700 C 360 744 664 744 724 700 C 750 722 754 758 730 780 C 664 816 360 816 294 780 C 270 758 274 722 300 700 Z"
            fill="#e6483f" stroke="${INK}" stroke-width="15" stroke-linejoin="round"/>
      <path d="M330 704 C 380 736 644 736 694 704" fill="none" stroke="#ff8a7a" stroke-width="10" stroke-linecap="round" opacity=".8"/>
      <path d="M300 720 C 244 692 208 646 214 588 C 252 618 284 662 312 712 Z"
            fill="#e6483f" stroke="${INK}" stroke-width="13" stroke-linejoin="round"/>
      <path d="M724 756 C 780 786 806 830 804 884 C 776 862 748 854 718 858 C 726 820 730 786 724 756 Z"
            fill="#e6483f" stroke="${INK}" stroke-width="13" stroke-linejoin="round"/>
      ${arm({ d: 'M300 760 C 252 704 232 630 246 574', handX: 246, handY: 562, handR: 30, sleeve: '#fbf8f2', skin: '#fbf8f2' })}
      ${arm({ d: 'M730 820 C 766 850 782 892 782 932', handX: 782, handY: 944, handR: 28, sleeve: '#fbf8f2', skin: '#fbf8f2' })}
      <g transform="rotate(-8 650 806)">
        <rect x="602" y="772" width="150" height="68" rx="22" fill="#5b8def" stroke="${INK}" stroke-width="11"/>
        <text x="677" y="818" text-anchor="middle" font-family="system-ui, sans-serif" font-size="34" font-weight="800" fill="#ffffff">SEED</text>
      </g>
    </g>
    ${sparkle(176, 430, 24, '#ffd166')}
    ${sparkle(830, 620, 18, '#8fc4ff')}
    <path d="M150 690 Q126 726 136 766" fill="none" stroke="#ff8a7a" stroke-width="8" stroke-linecap="round" opacity=".7"/>
    <path d="M196 520 Q170 540 164 570" fill="none" stroke="#ffd166" stroke-width="7" stroke-linecap="round" opacity=".8"/>
  `;
}

// ---------------------------------------------------------------- Generic

function generic() {
  return `
    ${halo('#f2c94c')}
    <ellipse cx="512" cy="858" rx="292" ry="50" fill="#000" opacity=".16"/>
    <g transform="rotate(5 512 780)">
      ${outlinedPath(
        `M512 246
         C 352 246 250 392 250 570
         C 250 766 360 888 512 888
         C 664 888 774 766 774 570
         C 774 392 672 246 512 246 Z`,
        '#f6c94c'
      )}
      ${outlinedEllipse(512, 600, 188, 164, '#fff2c4')}
      <path d="M512 246 C 512 208 532 186 560 180" fill="none" stroke="${INK}" stroke-width="13" stroke-linecap="round"/>
      <circle cx="566" cy="178" r="24" fill="#8fc4ff" stroke="${INK}" stroke-width="11"/>
      <path d="M398 570 Q430 546 462 570" fill="none" stroke="${INK}" stroke-width="12" stroke-linecap="round"/>
      <circle cx="472" cy="554" r="5" fill="${INK}" opacity=".55"/>
      <ellipse cx="594" cy="570" rx="30" ry="36" fill="#2a2020"/>
      <circle cx="583" cy="556" r="10" fill="#fff"/>
      <ellipse cx="512" cy="646" rx="20" ry="24" fill="#c94f5c" stroke="${INK}" stroke-width="9"/>
      <ellipse cx="512" cy="656" rx="10" ry="10" fill="#ff9d9d"/>
      <ellipse cx="360" cy="626" rx="28" ry="14" fill="#ff9d9d" opacity=".45"/>
      <ellipse cx="664" cy="626" rx="28" ry="14" fill="#ff9d9d" opacity=".45"/>
      <circle cx="512" cy="742" r="58" fill="#ffffff" stroke="${INK}" stroke-width="12"/>
      <text x="512" y="770" text-anchor="middle" font-family="system-ui, sans-serif" font-size="76" font-weight="800" fill="#5b8def">?</text>
      ${arm({ d: 'M300 780 C 252 722 236 652 250 594', handX: 250, handY: 582, handR: 28, sleeve: '#f6c94c', skin: '#f6c94c' })}
      ${arm({ d: 'M724 840 C 760 870 776 910 776 950', handX: 776, handY: 960, handR: 26, sleeve: '#f6c94c', skin: '#f6c94c' })}
    </g>
    ${sparkle(176, 470, 22, '#ffffff')}
    ${sparkle(836, 560, 17, '#8fc4ff')}
    <path d="M150 700 Q126 740 138 780" fill="none" stroke="#f2c94c" stroke-width="8" stroke-linecap="round" opacity=".8"/>
  `;
}

// ---------------------------------------------------------------- registry

const CHARACTERS = {
  deepseek_r1: { name: 'DeepSeek-R1', render: deepseek },
  claude_3_5_sonnet: { name: 'Claude 3.5 Sonnet', render: claude },
  gpt_4o: { name: 'GPT-4o', render: gpt },
  kimi_k2: { name: 'Kimi K2', render: kimi },
  doubao_seed: { name: '豆包 Seed', render: doubao },
};

const GENERIC = {
  char_default: { name: '通用模型', render: generic },
};

async function writeSvg(file, render) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
${render()}
</svg>
`;
  await writeFile(file, svg);
  console.log(`生成 ${file.slice(ROOT.length + 1)}`);
}

await mkdir(OUT, { recursive: true });
await mkdir(join(ROOT, 'assets/generic'), { recursive: true });
for (const [id, spec] of Object.entries(CHARACTERS)) {
  await writeSvg(join(OUT, `${id}.svg`), spec.render);
}
for (const [id, spec] of Object.entries(GENERIC)) {
  await writeSvg(join(ROOT, `assets/generic/${id}.svg`), spec.render);
}
