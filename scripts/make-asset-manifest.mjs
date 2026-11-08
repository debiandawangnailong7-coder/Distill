import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const ASSETS = join(ROOT, 'assets');

const characters = JSON.parse(readFileSync(join(ROOT, 'data/characters.json'), 'utf8')).characters;
const cardTypes = JSON.parse(readFileSync(join(ROOT, 'data/cardTypes.json'), 'utf8')).cardTypes;
const roles = JSON.parse(readFileSync(join(ROOT, 'data/roles.json'), 'utf8')).roles;

mkdirSync(join(ASSETS, 'characters'), { recursive: true });
mkdirSync(join(ASSETS, 'cards'), { recursive: true });

/** 优先用矢量 SVG，没有则退回同名 PNG。返回相对仓库根目录的路径。 */
function pickAsset(baseRel) {
  for (const ext of ['.svg', '.png']) {
    const rel = `${baseRel}${ext}`;
    if (existsSync(join(ROOT, rel))) return { file: rel, format: ext.slice(1) };
  }
  return null;
}

// 通用兜底素材库。新增角色/牌型不需要补图，直接复用这套徽记。
const GENERIC = {
  roles: {
    frontier_lab: 'assets/generic/role_frontier_lab',
    licensed_partner: 'assets/generic/role_licensed_partner',
    distiller: 'assets/generic/role_distiller',
    lone_wolf: 'assets/generic/role_lone_wolf',
  },
  kinds: {
    attack: 'assets/generic/kind_attack',
    defense: 'assets/generic/kind_defense',
    equipment: 'assets/generic/kind_equip',
    action: 'assets/generic/kind_action',
  },
  cardBack: 'assets/generic/card_back',
  title: 'assets/generic/title',
  charDefault: 'assets/generic/char_default',
};

const entries = [];

for (const r of roles) {
  const picked = pickAsset(GENERIC.roles[r.id]);
  entries.push({
    kind: 'generic',
    id: `role_${r.id}`,
    name: `${r.name} / ${r.en}`,
    file: picked?.file ?? null,
    format: picked?.format ?? null,
    status: picked ? 'ready' : 'missing',
    slot: '身份徽记：开局抽身份与结算揭示时显示，与角色立绘是两条独立的轴',
  });
}

for (const [k, base] of Object.entries(GENERIC.kinds)) {
  const picked = pickAsset(base);
  entries.push({
    kind: 'generic',
    id: `kind_${k}`,
    name: k,
    file: picked?.file ?? null,
    format: picked?.format ?? null,
    status: picked ? 'ready' : 'missing',
    slot: '牌型通用徽记：卡面角标与装备 chip 复用',
  });
}

const SYSTEM_SLOT = {
  card_back: '牌堆 56x76px 与手牌背面',
  title: '开场遮罩与顶栏',
  char_default: '所有没有专属立绘的角色共用这张默认头像',
};

for (const [id, name, base] of [
  ['card_back', '牌背', GENERIC.cardBack],
  ['title', '标题图', GENERIC.title],
  ['char_default', '默认角色立绘', GENERIC.charDefault],
]) {
  const picked = pickAsset(base);
  entries.push({
    kind: 'generic',
    id,
    name,
    file: picked?.file ?? null,
    format: picked?.format ?? null,
    status: picked ? 'ready' : 'missing',
    slot: SYSTEM_SLOT[id],
  });
}

const charDefault = pickAsset(GENERIC.charDefault);

// 专属素材：有 SVG/PNG 则 ready，没有则走通用兜底。缺文件不会阻塞，只是少一张立绘。
for (const c of characters) {
  const picked = pickAsset(`assets/characters/${c.id}`);
  entries.push({
    kind: 'character',
    id: c.id,
    name: c.name,
    file: picked?.file ?? null,
    format: picked?.format ?? null,
    status: picked ? 'ready' : 'generic',
    fallback: charDefault?.file ?? null,
    skill: c.skill.name,
  });
}

for (const t of cardTypes) {
  const picked = pickAsset(`assets/cards/${t.id}`);
  const k = kindKey(t);
  const fallback = pickAsset(GENERIC.kinds[k]);
  entries.push({
    kind: 'card',
    id: t.id,
    name: t.name,
    file: picked?.file ?? null,
    format: picked?.format ?? null,
    status: picked ? 'ready' : 'generic',
    fallback: fallback?.file ?? null,
    count: t.count,
  });
}

const manifest = {
  _comment:
    '素材清单，由 `node scripts/make-asset-manifest.mjs` 生成。status=ready 表示有专属素材（优先 SVG，其次 PNG）；' +
    'status=generic 表示该槽位没有专属图，渲染时用 fallback 指向的通用徽记。' +
    '新增角色或牌型后重跑本脚本即可自动纳管，无需补图。',
  generatedBy: 'scripts/make-asset-manifest.mjs',
  display: {
    characterAvatar: { box: 64, shape: 'circle', inset: 0.88, objectPosition: '50% 34%' },
    cardIcon: { box: 24 },
    chipIcon: { box: 16 },
    pileBack: { width: 56, height: 76 },
  },
  entries,
};

writeFileSync(join(ASSETS, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const ready = entries.filter((e) => e.status === 'ready').length;
const generic = entries.filter((e) => e.status === 'generic').length;
const missing = entries.filter((e) => e.status === 'missing').length;
console.log(`素材清单：${entries.length} 项 · 专属 ready ${ready} · 走通用兜底 ${generic} · 通用库缺图 ${missing}`);

function kindKey(t) {
  if (t.category === 'equipment') return 'equipment';
  if (t.kind === 'attack') return 'attack';
  if (t.kind === 'defense') return 'defense';
  return 'action';
}
