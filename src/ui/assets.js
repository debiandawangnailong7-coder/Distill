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
  return {
    raw: manifest,
    character: (id) => url(byKey.get(`character:${id}`)) ?? charDefault,
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
