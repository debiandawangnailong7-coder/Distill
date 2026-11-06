import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadData() {
  const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
  return {
    deck: read('data/deck.json'),
    cardTypes: read('data/cardTypes.json'),
    characters: read('data/characters.json'),
    roles: read('data/roles.json'),
  };
}

/** 随机决策器，仅用于冒烟测试：验证引擎能跑完整局而不崩溃或死循环。 */
export function makeRandomDecider(rand = Math.random) {
  return function decide({ request }) {
    if (request.type === 'play_action') {
      const playable = request.actions.filter((a) => a.kind !== 'end_turn');
      if (!playable.length || rand() < 0.25) return { kind: 'end_turn' };
      return playable[Math.floor(rand() * playable.length)];
    }
    const k = Math.min(request.max, request.options.length);
    const pool = request.options.slice();
    if (!request.ordered) {
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
    }
    return { ids: pool.slice(0, Math.max(k, request.min)).map((o) => o.id) };
  };
}
