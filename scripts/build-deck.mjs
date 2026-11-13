import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SUITS = ['spade', 'heart', 'club', 'diamond'];
const MIN_RANK = 2;
const MAX_RANK = 14;
const RANK_SPAN = MAX_RANK - MIN_RANK + 1;

const source = JSON.parse(readFileSync(join(root, 'data/cardTypes.json'), 'utf8'));
const cards = [];
const errors = [];

// 点数用全局游标轮转，再按牌型序号做偏移。若每个牌型都从 2 起算，低点数会大量堆积
// （22 张指控 + 14 张声明全挤在 2/3），「AGI 宣言」的 ♠2–♠9 判定就会严重超频。
//
// deck.json 只保存每张牌的独立事实（uid / 花色 / 点数 / flavor），牌型定义统一存放在
// cardTypes.json，由引擎在建局时按 typeId 水合——同一份数据不重复保存两处。
source.cardTypes.forEach((type, typeIndex) => {
  const suits = type.suits ?? SUITS;
  if (!suits.length) errors.push(`${type.id}: suits 为空`);
  if (type.flavors && type.flavors.length < type.count) {
    errors.push(`${type.id}: flavors 只有 ${type.flavors.length} 条，少于 count ${type.count}`);
  }

  for (let i = 0; i < type.count; i++) {
    cards.push({
      uid: `${type.id}_${String(i + 1).padStart(2, '0')}`,
      typeId: type.id,
      suit: suits[i % suits.length],
      rank: MIN_RANK + ((cards.length + typeIndex * 3) % RANK_SPAN),
      ...(type.flavors ? { flavor: type.flavors[i] } : {}),
    });
  }
});

if (errors.length) {
  console.error('cardTypes.json 校验失败:');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}

const bySuit = Object.fromEntries(SUITS.map((s) => [s, 0]));
const byRank = {};
for (const c of cards) {
  bySuit[c.suit]++;
  byRank[c.rank] = (byRank[c.rank] ?? 0) + 1;
}

// 「AGI 宣言」判定 ♠2–♠9 引爆。BANG! 原版炸药为 8/52 ≈ 15.4%，偏离过多说明点数分布被改坏了。
const spadeBoom = cards.filter((c) => c.suit === 'spade' && c.rank >= 2 && c.rank <= 9).length;
const boomRate = spadeBoom / cards.length;
const eventCount = cards.filter(
  (c) => source.cardTypes.find((x) => x.id === c.typeId).category === 'event'
).length;

if (boomRate < 0.12 || boomRate > 0.2) {
  console.error(
    `AGI 宣言引爆率 ${(boomRate * 100).toFixed(1)}% 超出 12%–20% 合理区间（基准 15.4%），` +
      '请检查 suits 偏好与点数分配。已中止写入。'
  );
  process.exit(1);
}

const deck = {
  version: 2,
  generatedFrom: 'data/cardTypes.json',
  generator: 'scripts/build-deck.mjs',
  totalCards: cards.length,
  distribution: { bySuit, byRank, dynamiteBoomRate: Number(boomRate.toFixed(4)) },
  cards,
};

writeFileSync(join(root, 'data/deck.json'), JSON.stringify(deck, null, 2) + '\n');

console.log(
  `生成 data/deck.json — 共 ${cards.length} 张（事件牌 ${eventCount}，装备牌 ${cards.length - eventCount}）`
);
console.log('花色分布:', SUITS.map((s) => `${s} ${bySuit[s]}`).join(' / '));
console.log(
  '点数分布:',
  Object.keys(byRank)
    .sort((a, b) => a - b)
    .map((r) => `${r}:${byRank[r]}`)
    .join(' ')
);
console.log(`AGI 宣言引爆率: ${(boomRate * 100).toFixed(1)}% (基准 15.4%)`);
console.log('牌型种类:', source.cardTypes.length);
