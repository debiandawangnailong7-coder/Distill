import { cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = import.meta.dirname ? join(import.meta.dirname, '..') : process.cwd();
const DIST = join(ROOT, 'dist');

// 只打包浏览器真正加载的文件：入口页、引擎/AI/UI 模块与卡牌数据。
// 测试、脚本、规则文档与 node 侧工具都不进公开产物。
const PUBLIC = [
  'index.html',
  'src/engine/rng.js',
  'src/engine/rules.js',
  'src/engine/game.js',
  'src/engine/index.js',
  'src/ai/memory.js',
  'src/ai/heuristic.js',
  'src/ai/index.js',
  'src/ui/style.css',
  'src/ui/app.js',
  'src/ui/assets.js',
  'src/ui/characterCard.js',
  'src/ui/hints.js',
  'src/ui/input.js',
  'src/ui/intent.js',
  'src/ui/motion.js',
  'src/ui/render.js',
  'src/ui/screens.js',
  'data/deck.json',
  'data/cardTypes.json',
  'data/characters.json',
  'data/roles.json',
];

// 美术素材整目录拷贝：manifest + generic/characters/cards。
const ASSETS_DIR = 'assets';

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

for (const rel of PUBLIC) {
  await cp(join(ROOT, rel), join(DIST, rel));
}
await cp(join(ROOT, ASSETS_DIR), join(DIST, ASSETS_DIR), { recursive: true });

console.log(`dist/ 已生成：${PUBLIC.length} 个公开文件 + ${ASSETS_DIR}/ 素材目录`);
