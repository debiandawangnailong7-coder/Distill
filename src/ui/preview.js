/**
 * 静态 UI 预览：不启动引擎，用固定 mock view 渲染牌桌。
 * 用法：npm run serve 后打开 /src/ui/preview.html
 * 参数：?mode=targeting|actions|modal|inspect|gameover|intro
 */
import { createRenderer } from './render.js';
import { buildAssetIndex } from './assets.js';
import { showIntro, showGameOver } from './screens.js';
import { buildProjection } from './project.js';

const root = document.getElementById('app');
const mode = new URLSearchParams(location.search).get('mode') ?? 'targeting';

// 与正式入口一致：预览也走 manifest 索引，不再维护一份硬编码的素材清单。
let assets = null;
try {
  const res = await fetch(new URL('../../assets/manifest.json', document.baseURI));
  if (res.ok) assets = buildAssetIndex(await res.json());
} catch {
  /* 缺清单时退回 null，渲染层自动使用文字占位 */
}

let seq = 0;
function card(typeId, name, kind, extra = {}) {
  return {
    uid: `preview_${++seq}`,
    typeId,
    name,
    kind,
    category: extra.category ?? 'event',
    suit: extra.suit ?? 'spade',
    rank: extra.rank ?? 7,
    flavor: extra.flavor ?? '',
    effect: extra.effect ?? '',
    params: extra.params,
  };
}

const attack = card('attack', '蒸馏指控', 'attack', { suit: 'spade', rank: 7, flavor: 'ToS 第七条', effect: '目标必须打出一张「合规声明」，否则失去 1 点算力。' });
const attack2 = card('attack', '蒸馏指控', 'attack', { suit: 'heart', rank: 10, flavor: '训练数据溯源', effect: '目标必须打出一张「合规声明」，否则失去 1 点算力。' });
const defense = card('defense', '合规声明', 'defense', { suit: 'club', rank: 9, flavor: 'fair use', effect: '抵消一张「蒸馏指控」。' });
const funding = card('funding', '融资到账', 'heal', { suit: 'heart', rank: 4, flavor: 'A 轮到账', effect: '回复 1 点算力。' });
const weapon = card('weapon_code_agent', 'Code Agent', 'weapon', { category: 'equipment', suit: 'diamond', rank: 8, flavor: '生产力工具', effect: '射程 2。', params: { range: 2 } });
const task = card('task_office', '办公套件', 'product', { category: 'equipment', suit: 'club', rank: 5, flavor: '文档协作', effect: '弃 2 张手牌回复 1 点算力。', params: { perTurn: 1 } });
const chat = card('task_chat', 'Chat 产品', 'product', { category: 'equipment', suit: 'heart', rank: 6, flavor: '用户留存', effect: '手牌上限 +2。', params: { handLimitBonus: 2 } });
const stt = card('task_stt', 'STT 语音识别', 'product', { category: 'equipment', suit: 'spade', rank: 3, flavor: '会议纪要', effect: '查看牌堆顶 2 张并排序。', params: { perTurn: 1 } });
const discardTop = card('regulator_inquiry', '监管问询', 'mass_challenge', { suit: 'diamond', rank: 9, flavor: '监管问询', effect: '所有其他玩家必须打出一张指控。' });

const players = [
  {
    index: 0, name: '你', character: { id: 'deepseek_r1', name: 'DeepSeek-R1', compute: 4, skills: [{ name: '开源思维链', effect: '摸牌阶段的第 2 张牌翻开展示，若为 ♦ 则额外摸 1 张', mechanic: 'draw_reveal_diamond_bonus' }] },
    role: { id: 'frontier_lab', computeBonus: 1 }, compute: 5, hand: [attack, defense, funding, weapon, task, chat],
    equipment: { weapon, product: chat }, jail: null, dynamite: null, alive: true, revealed: true,
  },
  {
    index: 1, name: 'dario', character: { id: 'claude_3_5_sonnet', name: 'Claude 3.5 Sonnet', compute: 4, skills: [{ name: 'Constitutional AI', effect: '需要打出「合规声明」时可改为判定，♥ 视为声明', mechanic: 'judge_heart_as_defense' }] },
    role: { id: 'distiller', computeBonus: 0 }, compute: 4, hand: [defense, defense, attack],
    equipment: {}, jail: null, dynamite: null, alive: true, revealed: false,
  },
  {
    index: 2, name: 'sam A.', character: { id: 'gpt_4o', name: 'GPT-4o', compute: 4, skills: [{ name: '全模态', effect: '任意手牌可当作「蒸馏指控」使用', mechanic: 'any_card_as_attack' }] },
    role: { id: 'lone_wolf', computeBonus: 0 }, compute: 2, hand: [attack, defense, funding, defense],
    equipment: { weapon: card('weapon_reasoning_cluster', '推理集群', 'weapon', { category: 'equipment', params: { range: 3 } }) }, jail: null, dynamite: null, alive: true, revealed: false,
  },
  {
    index: 3, name: 'tibo', character: { id: 'kimi_k2', name: 'Kimi K2', compute: 4, skills: [{ name: '长文本速读', effect: '摸 3 张后放回 2 张', mechanic: 'draw_three_return_two' }] },
    role: { id: 'licensed_partner', computeBonus: 0 }, compute: 3, hand: [defense, funding],
    equipment: { product: stt }, jail: null, dynamite: null, alive: true, revealed: false,
  },
  {
    index: 4, name: '梁文峰', character: { id: 'doubao_seed', name: '豆包 Seed', compute: 6, skills: [{ name: '国民应用', effect: '每名其他角色回合结束后进行一次无判定回合；每回合结束损失 1 点算力', mechanic: 'extra_turn_after_each_other_turn' }] },
    role: { id: 'distiller', computeBonus: 0 }, compute: 6, hand: [attack, defense, attack, funding, defense],
    equipment: {}, jail: null, dynamite: null, alive: true, revealed: false,
  },
];

// 与正式入口一致的 mock：客户端只认 view(seat)，预览直接构造 0 号座位的 view。
const [youPlayer, ...rivalPlayers] = players;
const view = {
  yourIndex: 0,
  you: youPlayer,
  others: rivalPlayers.map((p) => ({
    index: p.index,
    name: p.name,
    alive: p.alive,
    character: p.character,
    compute: p.compute,
    maxCompute: p.character.compute + (p.role.id === 'frontier_lab' ? p.role.computeBonus : 0),
    handCount: p.hand.length,
    equipment: p.equipment,
    jail: p.jail,
    dynamite: p.dynamite,
    role: p.revealed ? p.role : null,
    distance: p.index === 2 ? 1 : 2,
    targetable: p.index !== 4,
  })),
  turnNumber: 7,
  drawPileCount: 62,
  discardTop,
  inPlay: { jail: false, dynamite: false },
  log: [
    { text: '—— 第 7 回合：你（DeepSeek-R1）——' },
    { text: 'dario 使用 ♣9 蒸馏指控 · 训练数据溯源 → 你' },
    { text: '你打出 ♣9 合规声明 · fair use' },
    { text: '你 对 sam A. 发起「蒸馏指控」' },
    { text: 'sam A. 失去 1 点算力（蒸馏指控），剩余 2' },
    { text: '你 装备 Code Agent（射程 2）' },
  ],
};

const projection = () => buildProjection(view, { currentIndex: 0 });

const attackActions = [1, 2, 3, 4].map((targetIndex) => ({
  kind: 'play_card', cardUid: attack.uid, typeId: 'attack', targetIndex,
  label: `蒸馏指控 · ToS 第七条 → ${players[targetIndex].name}`,
}));
const actions = [
  ...attackActions,
  ...([1, 2, 3, 4].map((targetIndex) => ({
    kind: 'play_card', cardUid: attack2.uid, typeId: 'attack', targetIndex,
    label: `蒸馏指控 · 训练数据溯源 → ${players[targetIndex].name}`,
  }))),
  { kind: 'play_card', cardUid: funding.uid, typeId: 'funding', label: '融资到账' },
  { kind: 'play_card', cardUid: weapon.uid, typeId: 'weapon_code_agent', label: '装备 Code Agent' },
  { kind: 'play_card', cardUid: task.uid, typeId: 'task_office', label: '装备 办公套件' },
  { kind: 'task', task: 'office', label: '【文档协作】弃 2 张手牌回复 1 点算力' },
  { kind: 'end_turn', label: '结束回合' },
];

const ui = {
  pending: { type: 'play_action', actions },
  resolve: null,
  selectedCardUid: mode === 'actions' ? weapon.uid : attack.uid,
  targeting: mode === 'actions' ? null : { actions: attackActions, label: '蒸馏指控' },
  dropTargetIndex: mode === 'targeting' ? 2 : null,
  preferAsAttack: false,
  thinkingIndex: null,
  extraTurn: false,
  gameOver: false,
};

const renderer = createRenderer({
  assets,
  hints: null,
  onAction: () => {},
  onCancel: () => {},
});

renderer.render(projection(), ui);
renderer.setStage([
  { id: 's1', card: attack, caption: '你 → dario', tone: 'attack' },
  { id: 's2', card: defense, caption: '响应 · dario', tone: 'defense' },
]);

if (mode === 'modal') {
  renderer.showInteraction({
    type: 'select',
    purpose: 'discard_choice',
    prompt: '选择 2 张手牌弃掉（按顺序）',
    options: youPlayer.hand.map((c) => ({ id: c.uid, label: `${c.name}${c.flavor ? ` · ${c.flavor}` : ''}`, card: c })),
    min: 2,
    max: 2,
    ordered: true,
  }, () => {});
}
if (mode === 'inspect') {
  renderer.openInspect(2);
}
if (mode === 'gameover') {
  // 终局引擎会全量亮出身份：mock 直接改写 view.others 的 role。
  for (const o of view.others) o.role = players[o.index].role;
  const finalProjection = buildProjection(view, { currentIndex: 0, gameOver: true, result: { winner: 'frontier_lab', reason: '所有蒸馏者与开源独狼均已出局' } });
  showGameOver({ assets, projection: finalProjection, seat: 0 });
}
if (mode === 'intro') {
  showIntro({
    assets,
    characters: players.map((p) => p.character),
    roles: {
      roles: [
        { id: 'frontier_lab', name: '前沿实验室', objective: '清除所有蒸馏者与独狼' },
        { id: 'licensed_partner', name: '授权被许可方', objective: '保护前沿实验室' },
        { id: 'distiller', name: '未授权蒸馏者', objective: '让前沿实验室出局' },
        { id: 'lone_wolf', name: '开源独狼', objective: '成为唯一存活者' },
      ],
    },
    onStart: () => {},
  });
}
