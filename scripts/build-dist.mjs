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
  'src/ui/main.js',
  'data/deck.json',
  'data/cardTypes.json',
  'data/characters.json',
  'data/roles.json',
];

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

for (const rel of PUBLIC) {
  await cp(join(ROOT, rel), join(DIST, rel));
}

console.log(`dist/ 已生成，共 ${PUBLIC.length} 个公开文件`);
