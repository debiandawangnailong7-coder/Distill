/**
 * Game 类：对局编排。
 * 只负责流程与状态——建局、回合循环、阶段推进、合法行动、判定与决策分发。
 * 战斗/生死结算见 combat.js，卡牌与主动产品结算见 effects.js，两者都以
 * (game, ...) 自由函数实现，这里做单行委托以保持对外 API 稳定。
 */
import { mulberry32, shuffle } from './rng.js';
import * as R from './rules.js';
import {
  dealDamage,
  heal,
  resolveDying,
  eliminate,
  offerDefense,
  resolveAttack,
  resolveDuel,
} from './combat.js';
import { playCard, activateTask, activateCharacterAbility } from './effects.js';

/** 判定用途 id → 展示文案。id 同时下发给 AI，让它按用途选择有利的判定牌。 */
const JUDGE_LABELS = {
  dynamite: 'AGI 宣言',
  jail: '账号封禁',
  barrel: '对齐判定',
  gamble: '榜单刷分',
};

export function createGame(config) {
  return new Game(config);
}

export class Game {
  constructor({ deck, cardTypes, characters, roles, playerCount, seed = 1, decide, onEvent, names }) {
    if (playerCount < 4 || playerCount > 7) throw new Error('人数需为 4-7');
    this.rand = mulberry32(seed);
    this.decide = decide;
    this.onEvent = onEvent ?? (() => {});
    this.typesById = new Map(cardTypes.cardTypes.map((t) => [t.id, t]));
    this.skillNameByMechanic = new Map();
    for (const c of characters.characters) {
      for (const s of c.skills ?? []) {
        if (s.mechanic) this.skillNameByMechanic.set(s.mechanic, s.name);
      }
    }
    this.roleDefs = roles;
    this.characterDefs = characters.characters;
    this.playerCount = playerCount;
    this.names = names;

    this.state = {
      seed,
      playerCount,
      players: this.buildPlayers(),
      drawPile: [],
      discardPile: [],
      turnNumber: 0,
      currentPlayerIndex: 0,
      log: [],
      winner: null,
      gameOver: false,
      inPlay: { jail: false, dynamite: false },
    };

    this.buildDrawPile(deck);
    this.dealStartingHands();
    this.state.currentPlayerIndex = this.state.players.findIndex((p) => p.role.id === R.ROLE.LAB);
  }

  // ---------------------------------------------------------------- setup

  buildPlayers() {
    const seating = this.roleDefs.seating[String(this.playerCount)];
    const rolePool = [];
    for (const [roleId, count] of Object.entries(seating)) {
      for (let i = 0; i < count; i++) rolePool.push(roleId);
    }
    const shuffledRoles = shuffle(rolePool, this.rand);
    const shuffledChars = shuffle(this.characterDefs, this.rand);

    return shuffledRoles.map((roleId, index) => {
      const role = { ...this.roleDefs.roles.find((r) => r.id === roleId) };
      const character = { ...shuffledChars[index] };
      const compute = character.compute + (roleId === R.ROLE.LAB ? role.computeBonus : 0);
      return {
        index,
        name: this.names?.[index] ?? `P${index + 1}`,
        isHuman: false,
        role,
        character,
        compute,
        hand: [],
        equipment: Object.fromEntries(R.EQUIPMENT_SLOTS.map((s) => [s, null])),
        jail: null,
        dynamite: null,
        alive: true,
        revealed: role.public,
        attacksThisTurn: 0,
        taskUses: {},
      };
    });
  }

  buildDrawPile(deck) {
    let cards = deck.cards.map((c) => this.hydrateCard({ ...c }));
    // 7 人局按设计文档追加 4 张指控 + 4 张声明
    if (this.playerCount === 7) {
      const bonus = this.roleDefs.rules.sevenPlayerBonus;
      const extra = [];
      for (const [typeId, n] of [['attack', bonus.attack], ['defense', bonus.defense]]) {
        const t = this.typesById.get(typeId);
        for (let i = 0; i < n; i++) {
          extra.push(this.hydrateCard({
            uid: `${typeId}_bonus_${i}`,
            typeId,
            suit: t.suits[i % t.suits.length],
            rank: 2 + ((i * 5) % 13),
            flavor: t.flavors?.[i] ?? undefined,
          }));
        }
      }
      cards = cards.concat(extra);
    }
    this.state.drawPile = shuffle(cards, this.rand);
  }

  /**
   * 牌型水合：deck.json 只保存每张牌的独立事实（uid/花色/点数/flavor），
   * 牌型定义统一来自 cardTypes.json，在这里按 typeId 合并为运行时自描述的卡牌对象。
   * params 直接引用注册表（卡牌参数运行期只读），避免逐卡深拷贝。
   */
  hydrateCard(card) {
    const t = this.typesById.get(card.typeId);
    if (!t) throw new Error(`未知牌型 ${card.typeId}`);
    card.name = t.name;
    card.category = t.category;
    card.kind = t.kind;
    if (t.slot) card.slot = t.slot;
    if (t.task) card.task = t.task;
    if (t.target) card.target = t.target;
    if (t.effect) card.effect = t.effect;
    if (t.params) card.params = t.params;
    return card;
  }

  dealStartingHands() {
    for (const p of this.state.players) {
      for (let i = 0; i < R.maxCompute(p); i++) p.hand.push(this.drawTop());
    }
  }

  /** 卡牌在建局时已按注册表水合牌型定义（name/kind/slot/params），这里直接返回卡牌自身。 */
  typeOf(card) {
    return card ?? null;
  }

  // ---------------------------------------------------------------- events

  log(text, data) {
    const entry = { turn: this.state.turnNumber, text, ...data };
    this.state.log.push(entry);
    this.onEvent({ type: 'log', entry, state: this.state });
    return entry;
  }

  emit(event) {
    this.onEvent({ ...event, state: this.state });
  }

  /**
   * 公开行为产生的阵营信号。正值 = 敌对，负值 = 友好。
   * AI 的敌我推断只消费这个事件流，不读 state 里未公开的身份。
   */
  noteRelation(fromIndex, toIndex, weight) {
    if (fromIndex == null || toIndex == null || fromIndex === toIndex) return;
    this.emit({ type: 'relation', from: fromIndex, to: toIndex, weight });
  }

  /**
   * 角色技能/机制触发通知。UI 用来播提示，覆盖率脚本用来确认每条机制都真的跑到过。
   * 上报的是实际触发的 mechanic 而非玩家角色的 mechanic——「无上限推理」也可能来自
   * 端侧小模型武器，此时玩家角色可以是任何人。
   */
  noteSkill(player, mechanic) {
    if (!player) return;
    this.emit({
      type: 'skill',
      playerIndex: player.index,
      mechanic,
      skill: this.skillNameByMechanic.get(mechanic) ?? R.primarySkill(player.character)?.name ?? mechanic,
    });
  }

  // ---------------------------------------------------------------- piles

  drawTop() {
    const s = this.state;
    if (!s.drawPile.length) {
      if (!s.discardPile.length) return null;
      s.drawPile = shuffle(s.discardPile.splice(0), this.rand);
      this.log('牌堆耗尽，弃牌堆洗回成为新牌堆');
    }
    return s.drawPile.pop();
  }

  async drawCards(player, n, { reveal = false } = {}) {
    const got = [];
    for (let i = 0; i < n; i++) {
      const card = this.drawTop();
      if (!card) break;
      player.hand.push(card);
      got.push(card);
    }
    if (got.length) {
      this.emit({ type: 'draw', playerIndex: player.index, count: got.length, reveal: reveal ? got : null });
    }
    return got;
  }

  toDiscard(card) {
    if (card) this.state.discardPile.push(card);
  }

  removeFromHand(player, uid) {
    const i = player.hand.findIndex((c) => c.uid === uid);
    return i === -1 ? null : player.hand.splice(i, 1)[0];
  }

  // ---------------------------------------------------------------- helpers

  player(index) {
    return this.state.players[index];
  }

  alivePlayers() {
    return R.alivePlayers(this.state);
  }

  /** GPT-4o「全模态」= BANG! 的 Calamity Janet：任意手牌都能当指控打出。 */
  canBeUsedAsAttack(player, card) {
    if (!card) return false;
    if (this.typeOf(card).kind === 'attack') return true;
    return R.hasMechanic(player, 'any_card_as_attack');
  }

  canBeUsedAsDefense(card) {
    return this.typeOf(card).kind === 'defense';
  }

  othersFrom(fromPlayer) {
    const alive = this.alivePlayers();
    const start = alive.findIndex((p) => p.index === fromPlayer.index);
    return [...alive.slice(start + 1), ...alive.slice(0, start)];
  }

  view(player) {
    const s = this.state;
    return {
      you: player,
      yourIndex: player.index,
      turnNumber: s.turnNumber,
      drawPileCount: s.drawPile.length,
      discardTop: s.discardPile[s.discardPile.length - 1] ?? null,
      inPlay: { ...s.inPlay },
      log: s.log.slice(-40),
      others: s.players
        .filter((p) => p.index !== player.index)
        .map((p) => ({
          index: p.index,
          name: p.name,
          alive: p.alive,
          character: p.character,
          compute: p.compute,
          maxCompute: R.maxCompute(p),
          handCount: p.hand.length,
          equipment: { ...p.equipment },
          jail: p.jail,
          dynamite: p.dynamite,
          role: p.revealed ? p.role : null,
          distance: p.alive ? R.effectiveDistance(s, player, p) : null,
          targetable: R.canTarget(s, player, p),
        })),
    };
  }

  async ask(player, request) {
    const choice = await this.decide({
      player,
      request,
      view: this.view(player),
      rules: R,
    });
    if (!choice) throw new Error(`${player.name} 的决策返回空值 (${request.type})`);
    return choice;
  }

  // ---------------------------------------------------------------- judgment

  async judge(player, judgeFor) {
    const label = JUDGE_LABELS[judgeFor] ?? judgeFor;
    const s = this.state;
    const deckCard = this.drawTop();
    if (!deckCard) return null;

    let candidates = [{ id: 'deck', card: deckCard, label: `牌堆顶 ${this.cardLabel(deckCard)}` }];
    const discardTop = s.discardPile[s.discardPile.length - 1];
    if (R.hasMechanic(player, 'judge_from_discard_pile') && discardTop) {
      this.noteSkill(player, 'judge_from_discard_pile');
      candidates.push({
        id: 'discard',
        card: discardTop,
        label: `弃牌堆顶 ${this.cardLabel(discardTop)}`,
      });
    }
    if (R.hasMechanic(player, 'judge_pick_one_of_two')) {
      const second = this.drawTop();
      if (second) {
        this.noteSkill(player, 'judge_pick_one_of_two');
        candidates = [
          { id: 'deck', card: deckCard, label: `第一张 ${this.cardLabel(deckCard)}` },
          { id: 'deck2', card: second, label: `第二张 ${this.cardLabel(second)}` },
        ];
      }
    }

    let chosen = candidates[0].card;
    if (candidates.length > 1) {
      const choice = await this.ask(player, {
        type: 'select',
        purpose: 'judge_choice',
        prompt: `${player.character.name}「${R.primarySkill(player.character)?.name}」：选择一张判定牌（${label}）`,
        options: candidates.map((c) => ({ id: c.id, label: c.label, card: c.card })),
        min: 1,
        max: 1,
        judgeFor,
      });
      chosen = (candidates.find((c) => c.id === choice.ids[0]) ?? candidates[0]).card;
    }

    // 选中弃牌堆顶时必须按身份移除，不能用 pop()：落选的候选牌会先被推入弃牌堆，
    // 那时栈顶已经不是原来那张了。
    const usedFromDiscardPile = chosen === discardTop;
    if (usedFromDiscardPile) {
      const i = s.discardPile.indexOf(chosen);
      if (i !== -1) s.discardPile.splice(i, 1);
    }
    for (const c of candidates) if (c.card !== chosen) this.toDiscard(c.card);
    if (!usedFromDiscardPile) this.toDiscard(chosen);

    this.emit({ type: 'judge', playerIndex: player.index, card: chosen, judgeFor });
    this.log(`${player.name} 判定（${label}）→ ${this.cardLabel(chosen)}`, { card: chosen });
    return chosen;
  }

  cardLabel(card) {
    const SUIT = { spade: '♠', heart: '♥', club: '♣', diamond: '♦' };
    const RANK = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
    const t = this.typeOf(card);
    return `${SUIT[card.suit]}${RANK[card.rank] ?? card.rank} ${t.name}${card.flavor ? ` · ${card.flavor}` : ''}`;
  }

  // ---------------------------------------------------------------- combat / effects 委托

  async heal(player, amount) {
    return heal(this, player, amount);
  }

  async dealDamage(source, target, amount, cause) {
    return dealDamage(this, source, target, amount, cause);
  }

  async resolveDying(victim, source) {
    return resolveDying(this, victim, source);
  }

  async eliminate(victim, killer) {
    return eliminate(this, victim, killer);
  }

  async offerDefense(player, prompt, source, meta = {}) {
    return offerDefense(this, player, prompt, source, meta);
  }

  async resolveAttack(source, target, cause) {
    return resolveAttack(this, source, target, cause);
  }

  async resolveDuel(challenger, target) {
    return resolveDuel(this, challenger, target);
  }

  async playCard(player, card, targetIndex, opts = {}) {
    return playCard(this, player, card, targetIndex, opts);
  }

  async activateTask(player, task, targetIndex) {
    return activateTask(this, player, task, targetIndex);
  }

  async activateCharacterAbility(player, ability) {
    return activateCharacterAbility(this, player, ability);
  }

  stealRandomFromHand(from) {
    if (!from.hand.length) return null;
    const i = Math.floor(this.rand() * from.hand.length);
    return from.hand.splice(i, 1)[0];
  }

  checkGameOver() {
    if (this.state.gameOver) return;
    const result = R.checkWinner(this.state);
    if (!result) return;
    this.state.gameOver = true;
    this.state.winner = result;
    for (const p of this.state.players) p.revealed = true;
    this.emit({ type: 'gameOver', result });
    this.log(`🏁 游戏结束 — ${result.winner === R.ROLE.LAB ? '前沿实验室阵营' : result.winner === R.ROLE.DISTILLER ? '未授权蒸馏者阵营' : '开源独狼'}获胜：${result.reason}`);
  }

  // ---------------------------------------------------------------- legal actions

  legalActions(player) {
    const s = this.state;
    const actions = [];
    if (!player.alive) return [{ kind: 'end_turn', label: '结束回合' }];

    const targets = this.alivePlayers().filter((p) => p.index !== player.index);
    const attacksLeft = R.attacksLeft(player);

    for (const card of player.hand) {
      const t = this.typeOf(card);
      const label = `${t.name}${card.flavor ? ` · ${card.flavor}` : ''}`;

      if (R.hasMechanic(player, 'any_card_as_attack') && attacksLeft > 0 && t.kind !== 'attack') {
        for (const tgt of targets) {
          if (!R.canTarget(s, player, tgt)) continue;
          actions.push({
            kind: 'play_card',
            cardUid: card.uid,
            typeId: card.typeId,
            targetIndex: tgt.index,
            asAttack: true,
            label: `${label} 当作指控 → ${tgt.name}`,
          });
        }
      }

      if (t.kind === 'defense') continue;

      switch (t.kind) {
        case 'attack': {
          if (attacksLeft <= 0) break;
          for (const tgt of targets) {
            if (!R.canTarget(s, player, tgt)) continue;
            actions.push({ kind: 'play_card', cardUid: card.uid, typeId: card.typeId, targetIndex: tgt.index, label: `${label} → ${tgt.name}` });
          }
          break;
        }
        case 'heal': {
          if (player.compute >= R.maxCompute(player)) break;
          if (this.alivePlayers().length <= 2) break;
          actions.push({ kind: 'play_card', cardUid: card.uid, typeId: card.typeId, label });
          break;
        }
        case 'draw':
        case 'gamble':
        case 'general_store':
          actions.push({ kind: 'play_card', cardUid: card.uid, typeId: card.typeId, label });
          break;
        case 'steal':
        case 'force_discard': {
          for (const tgt of targets) {
            if (R.effectiveDistance(s, player, tgt) > t.params.maxDistance) continue;
            const hasSomething = tgt.hand.length > 0 || Object.values(tgt.equipment).some(Boolean);
            if (!hasSomething) continue;
            actions.push({ kind: 'play_card', cardUid: card.uid, typeId: card.typeId, targetIndex: tgt.index, label: `${label} → ${tgt.name}` });
          }
          break;
        }
        case 'jail': {
          if (s.inPlay.jail) break;
          for (const tgt of targets) {
            if (tgt.role.id === R.ROLE.LAB && tgt.revealed) continue;
            actions.push({ kind: 'play_card', cardUid: card.uid, typeId: card.typeId, targetIndex: tgt.index, label: `${label} → ${tgt.name}` });
          }
          break;
        }
        case 'duel':
          for (const tgt of targets) {
            actions.push({ kind: 'play_card', cardUid: card.uid, typeId: card.typeId, targetIndex: tgt.index, label: `${label} → ${tgt.name}` });
          }
          break;
        case 'mass_heal':
          if (this.alivePlayers().length <= 2) break;
          actions.push({ kind: 'play_card', cardUid: card.uid, typeId: card.typeId, label });
          break;
        case 'mass_attack':
        case 'mass_challenge':
          actions.push({ kind: 'play_card', cardUid: card.uid, typeId: card.typeId, label });
          break;
        case 'dynamite':
          if (s.inPlay.dynamite) break;
          actions.push({ kind: 'play_card', cardUid: card.uid, typeId: card.typeId, label });
          break;
        case 'weapon':
          // 武器允许换新（旧的进弃牌堆），评分函数会压低降级替换的分值
          actions.push({ kind: 'play_card', cardUid: card.uid, typeId: card.typeId, label: `装备 ${label}` });
          break;
        case 'distance':
        case 'barrel':
        case 'task':
          // 同名槽位不叠加，占满就不再提供该行动
          if (player.equipment[t.slot]) break;
          actions.push({ kind: 'play_card', cardUid: card.uid, typeId: card.typeId, label: `装备 ${label}` });
          break;
        default:
          break;
      }
    }

    if (R.taskUsesLeft(player, 'code') > 0 && attacksLeft > 0 && player.hand.length > 0) {
      for (const tgt of targets) {
        if (!R.canTarget(s, player, tgt)) continue;
        actions.push({
          kind: 'task',
          task: 'code',
          targetIndex: tgt.index,
          label: `【生产力杠杆】弃 1 张手牌当作指控 → ${tgt.name}`,
          labelBase: '【生产力杠杆】弃 1 张手牌当作指控',
        });
      }
    }
    if (R.taskUsesLeft(player, 'office') > 0 && player.compute < R.maxCompute(player) && player.hand.length >= 2) {
      actions.push({ kind: 'task', task: 'office', label: '【文档协作】弃 2 张手牌回复 1 点算力' });
    }
    if (R.taskUsesLeft(player, 'tts') > 0 && targets.some((t) => t.hand.length > 0)) {
      for (const tgt of targets) {
        if (!tgt.hand.length) continue;
        actions.push({
          kind: 'task',
          task: 'tts',
          targetIndex: tgt.index,
          label: `【舆论广播】公开 ${tgt.name} 的一张手牌`,
          labelBase: '【舆论广播】公开一名玩家的手牌',
        });
      }
    }
    if (R.taskUsesLeft(player, 'stt') > 0 && s.drawPile.length + s.discardPile.length >= 2) {
      actions.push({ kind: 'task', task: 'stt', label: '【会议纪要】查看牌堆顶 2 张并排序' });
    }
    if (R.taskUsesLeft(player, 'iti') > 0 && player.hand.length > 0 && s.discardPile.length > 0) {
      // 把弃牌堆顶写进文案：否则玩家无法评估这次交换值不值。
      const top = s.discardPile[s.discardPile.length - 1];
      actions.push({
        kind: 'task',
        task: 'iti',
        label: `【风格迁移】弃 1 张手牌换取弃牌堆顶的 ${this.cardLabel(top)}`,
      });
    }
    if (R.hasMechanic(player, 'discard_two_heal_one') && player.compute < R.maxCompute(player) && player.hand.length >= 2) {
      actions.push({ kind: 'character_ability', ability: 'discard_two_heal_one', label: `「${R.primarySkill(player.character)?.name}」弃 2 张手牌回复 1 点算力` });
    }

    actions.push({ kind: 'end_turn', label: '结束回合' });
    return actions;
  }

  // ---------------------------------------------------------------- turn

  async run() {
    const s = this.state;
    this.log(`游戏开始 — ${s.playerCount} 人局，${s.players.find((p) => p.role.id === R.ROLE.LAB).name} 是公开的前沿实验室`);
    this.emit({ type: 'gameStart' });

    while (!s.gameOver) {
      const player = s.players[s.currentPlayerIndex];
      if (player.alive) await this.runTurnWithFollowUps(player);
      if (s.gameOver) break;
      do {
        s.currentPlayerIndex = (s.currentPlayerIndex + 1) % s.players.length;
      } while (!s.players[s.currentPlayerIndex].alive && !s.gameOver);
    }
    this.emit({ type: 'end' });
    return s;
  }

  /**
   * 豆包 Seed「国民应用」：每名其他角色回合结束后，立刻进行一个跳过判定阶段的额外回合。
   * 额外回合不触发自己的后续回合，避免递归。currentPlayerIndex 在额外回合期间指向豆包，
   * 让 UI 的高亮和状态栏也能正确显示；结束后再恢复到原座位，主循环继续按座位推进。
   */
  async runTurnWithFollowUps(player) {
    const s = this.state;
    await this.runTurn(player);

    const extra = s.players.find(
      (p) => p.alive && R.hasMechanic(p, 'extra_turn_after_each_other_turn')
    );
    if (!extra || extra.index === player.index || s.gameOver) return;

    const normalIndex = s.currentPlayerIndex;
    this.noteSkill(extra, 'extra_turn_after_each_other_turn');
    this.log(`${extra.name}「国民应用」触发额外回合（跳过判定）`);
    s.currentPlayerIndex = extra.index;
    await this.runTurn(extra, { skipJudgment: true, extra: true });
    s.currentPlayerIndex = normalIndex;
  }

  async runTurn(player, { skipJudgment = false, extra = false } = {}) {
    const s = this.state;
    s.turnNumber++;
    player.attacksThisTurn = 0;
    player.taskUses = {};
    this.emit({ type: 'turnStart', playerIndex: player.index, turnNumber: s.turnNumber, extra });
    this.log(
      `—— 第 ${s.turnNumber} 回合${extra ? '（额外）' : ''}：${player.name}（${player.character.name}）——`
    );

    const skipped = skipJudgment ? false : await this.judgmentPhase(player);
    if (!skipped && player.alive && !s.gameOver) {
      await this.drawPhase(player);
      if (player.alive && !s.gameOver) await this.playPhase(player);
    }
    if (player.alive && !s.gameOver) await this.discardPhase(player);

    // 「3 = 1+1」：每个自己的回合结束时损失 1 点算力（含额外回合）。
    // 用 dealDamage 而不是直接改 compute，让濒死、救援和受伤触发都走正常流程。
    if (player.alive && !s.gameOver && R.hasMechanic(player, 'lose_one_compute_at_turn_end')) {
      this.noteSkill(player, 'lose_one_compute_at_turn_end');
      await this.dealDamage(null, player, 1, '3 = 1+1');
    }

    this.checkGameOver();
    this.emit({ type: 'turnEnd', playerIndex: player.index, turnNumber: s.turnNumber, extra });
  }

  async judgmentPhase(player) {
    const s = this.state;
    if (player.dynamite) {
      const card = player.dynamite;
      const flipped = await this.judge(player, 'dynamite');
      const p = this.typeOf(card).params;
      const boom =
        flipped?.suit === p.judgeFailSuit && flipped.rank >= p.judgeFailRankMin && flipped.rank <= p.judgeFailRankMax;
      this.toDiscard(player.dynamite);
      player.dynamite = null;
      s.inPlay.dynamite = false;
      if (boom) {
        this.log(`💥 AGI 宣言引爆！${player.name} 失去 3 点算力`);
        await this.dealDamage(null, player, 3, 'AGI 宣言');
        return true;
      }
      const next = this.othersFrom(player)[0];
      if (next) {
        next.dynamite = card;
        s.inPlay.dynamite = true;
        this.log(`AGI 宣言未引爆，传递给 ${next.name}`);
      } else {
        this.toDiscard(card);
      }
    }

    if (player.jail) {
      const card = player.jail;
      player.jail = null;
      s.inPlay.jail = false;
      const flipped = await this.judge(player, 'jail');
      const jailed = this.typeOf(card).params.judgeFailSuits.includes(flipped?.suit);
      this.toDiscard(card);
      if (jailed) {
        this.log(`${player.name} 被「账号封禁」，跳过摸牌与出牌阶段`);
        return true;
      }
      this.log(`${player.name} 解除封禁`);
    }
    return false;
  }

  async drawPhase(player) {
    if (R.hasMechanic(player, 'draw_from_any_player')) {
      const donors = this.alivePlayers().filter((p) => p.index !== player.index && p.hand.length > 0);
      const options = [
        ...donors.map((p) => ({ id: String(p.index), label: `从 ${p.name} 手中抽取（${p.hand.length} 张）` })),
        { id: 'deck', label: '正常从牌堆摸牌' },
      ];
      const choice = await this.ask(player, {
        type: 'select',
        purpose: 'draw_source',
        prompt: `${player.character.name}「学术溯源」：第 1 张牌的来源`,
        options,
        min: 1,
        max: 1,
      });
      if (choice.ids[0] === 'deck') {
        await this.drawCards(player, 1);
      } else {
        const donor = this.player(Number(choice.ids[0]));
        const stolen = this.stealRandomFromHand(donor);
        if (stolen) {
          this.noteSkill(player, 'draw_from_any_player');
          player.hand.push(stolen);
          this.log(`${player.name}「学术溯源」从 ${donor.name} 手中抽走 1 张牌`);
        } else {
          await this.drawCards(player, 1);
        }
      }
      await this.drawCards(player, 1);
      await this.afterHandChange(player);
      return;
    }

    if (R.hasMechanic(player, 'draw_three_return_two')) {
      this.noteSkill(player, 'draw_three_return_two');
      const drawn = await this.drawCards(player, 3);
      if (drawn.length >= 2) {
        const choice = await this.ask(player, {
          type: 'select',
          purpose: 'return_to_deck',
          prompt: `${player.character.name}「长文本速读」：选择 2 张按顺序放回牌堆顶`,
          options: player.hand.map((c) => ({ id: c.uid, label: this.cardLabel(c), card: c })),
          min: 2,
          max: 2,
          ordered: true,
        });
        for (const uid of choice.ids) {
          const card = this.removeFromHand(player, uid);
          if (card) this.state.drawPile.push(card);
        }
        this.log(`${player.name}「长文本速读」放回 2 张牌`);
      }
      await this.afterHandChange(player);
      return;
    }

    const first = await this.drawCards(player, 1);
    if (R.hasMechanic(player, 'draw_reveal_diamond_bonus')) {
      const second = await this.drawCards(player, 1);
      const revealed = second[0];
      if (revealed) {
        this.noteSkill(player, 'draw_reveal_diamond_bonus');
        this.emit({ type: 'reveal', playerIndex: player.index, cards: [revealed] });
        this.log(`${player.name}「开源思维链」翻开第 2 张：${this.cardLabel(revealed)}`);
        if (revealed.suit === 'diamond') {
          await this.drawCards(player, 1);
          this.log(`${player.name} 因为是 ♦ 额外摸 1 张`);
        }
      }
    } else {
      await this.drawCards(player, 1);
    }
    if (!first.length) this.log(`${player.name} 无牌可摸`);
    await this.afterHandChange(player);
  }

  async playPhase(player) {
    for (let guard = 0; guard < 200; guard++) {
      if (this.state.gameOver || !player.alive) return;
      const actions = this.legalActions(player);
      if (actions.length === 1) return; // 只剩 end_turn
      const choice = await this.ask(player, {
        type: 'play_action',
        prompt: `${player.name} 的出牌阶段`,
        actions,
        hand: player.hand.map((c) => ({ ...c, label: this.cardLabel(c) })),
      });
      if (choice.kind === 'end_turn') return;
      await this.performAction(player, choice);
      await this.afterHandChange(player);
    }
  }

  async performAction(player, choice) {
    if (choice.kind === 'play_card') {
      const card = this.removeFromHand(player, choice.cardUid);
      if (!card) return;
      await this.playCard(player, card, choice.targetIndex, { asAttack: choice.asAttack === true });
      return;
    }
    if (choice.kind === 'task') return this.activateTask(player, choice.task, choice.targetIndex);
    if (choice.kind === 'character_ability') return this.activateCharacterAbility(player, choice.ability);
  }

  async pickCards(player, prompt, count, purpose = 'discard_choice') {
    if (player.hand.length <= count) {
      const all = player.hand.splice(0);
      return all;
    }
    const choice = await this.ask(player, {
      type: 'select',
      purpose,
      prompt,
      options: player.hand.map((c) => ({ id: c.uid, label: this.cardLabel(c), card: c })),
      min: count,
      max: count,
      ordered: true,
    });
    const picked = [];
    for (const uid of choice.ids) {
      const card = this.removeFromHand(player, uid);
      if (card) picked.push(card);
    }
    while (picked.length < count && player.hand.length) picked.push(player.hand.shift());
    return picked;
  }

  async discardPhase(player) {
    const limit = R.handLimit(player);
    const excess = player.hand.length - limit;
    if (excess <= 0) return;
    const picked = await this.pickCards(player, `弃牌阶段：需弃掉 ${excess} 张（手牌上限 ${limit}）`, excess, 'discard_to_limit');
    picked.forEach((c) => this.toDiscard(c));
    this.log(`${player.name} 弃掉 ${picked.length} 张牌至手牌上限 ${limit}`);
  }

  /** Qwen「全尺寸开源」：手牌归零时立即补一张。弃牌阶段不触发，避免与手牌上限互相拉扯。 */
  async afterHandChange(player) {
    if (!player.alive || player.hand.length > 0) return;
    if (!R.hasMechanic(player, 'empty_hand_draw')) return;
    this.noteSkill(player, 'empty_hand_draw');
    const drawn = await this.drawCards(player, 1);
    if (drawn.length) this.log(`${player.name}「全尺寸开源」手牌归零，立即补 1 张`);
  }
}
