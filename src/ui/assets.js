/**
 * 素材清单 → 可直接放进 <img> 的 URL。
 * manifest 由 `npm run assets:manifest` 生成；缺清单时整个 UI 自动退回纯文字版本。
 */

async function loadManifest() {
  try {
    const res = await fetch('./assets/manifest.json');
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export function buildAssetIndex(manifest) {
  if (!manifest) return null;
  const byKey = new Map(manifest.entries.map((e) => [`${e.kind}:${e.id}`, e]));

  const url = (entry) => {
    if (!entry) return null;
    const path = entry.status === 'ready' && entry.file ? entry.file : entry.fallback;
    // CSS 自定义属性里的相对 URL 解析基准不可靠，统一转绝对 URL。
    return path ? new URL(path, document.baseURI).href : null;
  };

  const kindId = (card) => {
    if (card.category === 'equipment') return 'kind_equipment';
    if (card.kind === 'attack') return 'kind_attack';
    if (card.kind === 'defense') return 'kind_defense';
    return 'kind_action';
  };

  const charDefault = url(byKey.get('generic:char_default'));
  const kangaroo = url(byKey.get('generic:kangaroo'));
  const portraitOf = (id) => {
    const e = byKey.get(`character:${id}`);
    const path = e?.portrait && e.status === 'ready' ? e.portrait : e?.portraitFallback ?? e?.fallback;
    return path ? new URL(path, document.baseURI).href : charDefault;
  };
  // 是否有专属普通立绘（开场页排序用：非占位立绘排在前，奶蛙占位靠后）。
  const hasPortrait = (id) => Boolean(byKey.get(`character:${id}`)?.portrait);
  return {
    raw: manifest,
    character: (id) => url(byKey.get(`character:${id}`)) ?? charDefault,
    portrait: portraitOf,
    hasPortrait,
    kangaroo,
    role: (id) => url(byKey.get(`generic:role_${id}`)),
    card: (card) => url(byKey.get(`card:${card.typeId}`)) ?? url(byKey.get(`generic:${kindId(card)}`)),
    kind: (card) => url(byKey.get(`generic:${kindId(card)}`)),
    cardBack: url(byKey.get('generic:card_back')),
    title: url(byKey.get('generic:title')),
  };
}

export async function loadAssets() {
  return buildAssetIndex(await loadManifest());
}
