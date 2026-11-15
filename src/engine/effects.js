/**
 * 卡牌效果与主动产品（Task）结算。
 * playCard 按 kind 分派各牌型的完整结算；activateTask / activateCharacterAbility
 * 是装备与角色能力的主动效果。全部以 (game, ...) 自由函数实现，Game 做单行委托。
 */
import * as R from './rules.js';
import { resolveAttack, resolveDuel, dealDamage, heal } from './combat.js';

/** 挖角/律师函共用的「手牌或某件装备」选择列表。 */
function possessionOptions(game, target, { handLabel, slotLabel }) {
  const options = [];
  if (target.hand.length) options.push({ id: 'hand', label: `${handLabel}（${target.hand.length} 张）` });
  for (const [slot, eq] of Object.entries(target.equipment)) {
    if (eq) options.push({ id: `slot:${slot}`, label: `${slotLabel} ${game.typeOf(eq).name}` });
  }
  return options;
}

export async function playCard(game, player, card, targetIndex, { asAttack = false } = {}) {
  const t = game.typeOf(card);
  const target = targetIndex == null ? null : game.player(targetIndex);
  game.emit({ type: 'play', playerIndex: player.index, card, targetIndex, typeId: card.typeId, asAttack });
  game.log(
    `${player.name} 使用 ${game.cardLabel(card)}${asAttack ? '（当作指控）' : ''}${target ? ` → ${target.name}` : ''}`,
    { card, targetIndex }
  );

  if (asAttack || t.kind === 'attack') {
    if (asAttack) {
      game.noteSkill(player, 'any_card_as_attack');
    } else if (player.attacksThisTurn >= 1 && R.unlimitedAttacks(player)) {
      game.noteSkill(player, 'unlimited_attacks_per_turn');
    }
    game.toDiscard(card);
    player.attacksThisTurn++;
    await resolveAttack(game, player, target, `${t.name}${card.flavor ? ` · ${card.flavor}` : ''}`);
    return;
  }

  switch (t.kind) {
    case 'heal':
      game.toDiscard(card);
      await heal(game, player, t.params.heal);
      break;

    case 'draw':
      game.toDiscard(card);
      await game.drawCards(player, t.params.draw);
      break;

    case 'gamble': {
      game.toDiscard(card);
      const flipped = await game.judge(player, 'gamble');
      if (flipped?.suit === t.params.failSuit) {
        game.log(`${player.name} 榜单刷分翻车，失去 1 点算力但摸 3 张`);
        await game.drawCards(player, t.params.failDraw);
        await dealDamage(game, null, player, t.params.failDamage, '榜单刷分翻车');
      } else {
        await game.drawCards(player, t.params.successDraw);
      }
      break;
    }

    case 'general_store': {
      const alive = game.alivePlayers();
      const start = alive.findIndex((p) => p.index === player.index);
      const order = [...alive.slice(start), ...alive.slice(0, start)];
      const pool = [];
      for (let i = 0; i < order.length; i++) {
        const c = game.drawTop();
        if (c) pool.push(c);
      }
      game.emit({ type: 'reveal', playerIndex: player.index, cards: pool });
      game.log(`「HuggingFace 上架」公开 ${pool.length} 张牌`);
      for (const p of order) {
        if (!pool.length) break;
        const choice = await game.ask(p, {
          type: 'select',
          purpose: 'general_store_pick',
          prompt: '「HuggingFace 上架」：选择一张牌收入手牌',
          options: pool.map((c) => ({ id: c.uid, label: game.cardLabel(c), card: c })),
          min: 1,
          max: 1,
        });
        const i = pool.findIndex((c) => c.uid === choice.ids[0]);
        const taken = pool.splice(i < 0 ? 0 : i, 1)[0];
        p.hand.push(taken);
        game.log(`${p.name} 取走了 ${game.cardLabel(taken)}`);
      }
      pool.forEach((c) => game.toDiscard(c));
      game.toDiscard(card);
      break;
    }

    case 'mass_heal':
      game.toDiscard(card);
      for (const p of game.alivePlayers()) {
        game.noteRelation(player.index, p.index, -1);
        await heal(game, p, t.params.heal);
      }
      break;

    case 'mass_attack': {
      game.toDiscard(card);
      for (const p of game.othersFrom(player)) {
        if (!p.alive || game.state.gameOver) break;
        game.noteRelation(player.index, p.index, 1);
        const ok = await game.offerDefense(p, `「API 降价战」波及你`, player, { needed: 1, remaining: 1 });
        if (!ok) await dealDamage(game, player, p, t.params.damage, 'API 降价战');
      }
      break;
    }

    case 'mass_challenge': {
      game.toDiscard(card);
      for (const p of game.othersFrom(player)) {
        if (!p.alive || game.state.gameOver) break;
        game.noteRelation(player.index, p.index, 0.5);
        const attacks = p.hand.filter((c) => game.canBeUsedAsAttack(p, c));
        let played = null;
        if (attacks.length) {
          const choice = await game.ask(p, {
            type: 'select',
            purpose: 'challenge_response',
            prompt: `「监管问询」：打出一张「蒸馏指控」自证，否则失去 1 点算力`,
            options: [
              ...attacks.map((c) => ({ id: c.uid, label: game.cardLabel(c), card: c })),
              { id: 'pass', label: '放弃（失去 1 点算力）' },
            ],
            min: 1,
            max: 1,
          });
          if (choice.ids[0] !== 'pass') played = game.removeFromHand(p, choice.ids[0]);
        }
        if (played) {
          game.toDiscard(played);
          game.log(`${p.name} 打出 ${game.cardLabel(played)} 回应监管问询`);
          await game.afterHandChange(p);
        } else {
          await dealDamage(game, player, p, t.params.damage, '监管问询');
        }
      }
      break;
    }

    case 'duel':
      game.toDiscard(card);
      await resolveDuel(game, player, target);
      break;

    case 'steal': {
      game.toDiscard(card);
      game.noteRelation(player.index, target.index, 1);
      if (!target.hand.length && !Object.values(target.equipment).some(Boolean)) break;
      const choice = await game.ask(player, {
        type: 'select',
        purpose: 'steal_choice',
        prompt: `「挖角研究员」：从 ${target.name} 处抽取`,
        options: possessionOptions(game, target, { handLabel: '随机抽取手牌', slotLabel: '夺取装备' }),
        min: 1,
        max: 1,
      });
      const id = choice.ids[0];
      if (id === 'hand') {
        const stolen = game.stealRandomFromHand(target);
        if (stolen) {
          player.hand.push(stolen);
          game.log(`${player.name} 从 ${target.name} 手中抽走 1 张牌`);
          await game.afterHandChange(target);
        }
      } else {
        const slot = id.slice('slot:'.length);
        const eq = target.equipment[slot];
        target.equipment[slot] = null;
        player.equipment[slot] = eq;
        game.log(`${player.name} 夺走了 ${target.name} 的「${game.typeOf(eq).name}」`);
      }
      break;
    }

    case 'force_discard': {
      game.toDiscard(card);
      game.noteRelation(player.index, target.index, 1);
      if (!target.hand.length && !Object.values(target.equipment).some(Boolean)) break;
      const choice = await game.ask(player, {
        type: 'select',
        purpose: 'discard_victim_choice',
        prompt: `「律师函 C&D」：令 ${target.name} 弃掉`,
        options: possessionOptions(game, target, { handLabel: '随机弃掉手牌', slotLabel: '弃掉装备' }),
        min: 1,
        max: 1,
      });
      const id = choice.ids[0];
      if (id === 'hand') {
        const gone = game.stealRandomFromHand(target);
        game.toDiscard(gone);
        game.log(`${target.name} 被迫弃掉 1 张手牌`);
        await game.afterHandChange(target);
      } else {
        const slot = id.slice('slot:'.length);
        const eq = target.equipment[slot];
        target.equipment[slot] = null;
        game.toDiscard(eq);
        game.log(`${target.name} 被迫弃掉装备「${game.typeOf(eq).name}」`);
      }
      break;
    }

    case 'jail':
      target.jail = card;
      game.state.inPlay.jail = true;
      game.noteRelation(player.index, target.index, 1);
      break;

    case 'dynamite':
      player.dynamite = card;
      game.state.inPlay.dynamite = true;
      break;

    case 'weapon':
    case 'distance':
    case 'product': {
      // 同槽替换：旧装备进弃牌堆。产品槽一次一张，装新品即换旧品。
      const replaced = player.equipment[t.slot];
      player.equipment[t.slot] = card;
      if (replaced) game.toDiscard(replaced);
      game.emit({ type: 'equip', playerIndex: player.index, slot: t.slot, card });
      break;
    }

    default:
      game.toDiscard(card);
      break;
  }
  game.checkGameOver();
}

export async function activateCharacterAbility(game, player, ability) {
  if (ability !== 'discard_two_heal_one') return;
  game.noteSkill(player, 'discard_two_heal_one');
  const picked = await game.pickCards(player, '「端侧自足」：弃 2 张手牌', 2, 'ability_discard');
  picked.forEach((c) => game.toDiscard(c));
  await heal(game, player, 1);
}

export async function activateTask(game, player, task, targetIndex) {
  player.taskUses[task] = (player.taskUses[task] ?? 0) + 1;
  const s = game.state;

  switch (task) {
    case 'code': {
      const target = game.player(targetIndex);
      const picked = await game.pickCards(player, '【生产力杠杆】：弃 1 张手牌当作指控', 1, 'task_discard');
      picked.forEach((c) => game.toDiscard(c));
      game.emit({ type: 'play', playerIndex: player.index, card: R.productCard(player, 'code'), targetIndex });
      game.log(`${player.name} 发动【生产力杠杆】`);
      player.attacksThisTurn++;
      await resolveAttack(game, player, target, '生产力杠杆');
      break;
    }
    case 'office': {
      const picked = await game.pickCards(player, '【文档协作】：弃 2 张手牌', 2, 'task_discard');
      picked.forEach((c) => game.toDiscard(c));
      game.log(`${player.name} 发动【文档协作】`);
      await heal(game, player, 1);
      break;
    }
    case 'tts': {
      const target = game.player(targetIndex);
      const card = game.stealRandomFromHand(target);
      if (!card) break;
      const isAttack = game.typeOf(card).kind === 'attack';
      game.emit({ type: 'reveal', playerIndex: target.index, cards: [card] });
      game.log(
        `${player.name}【舆论广播】公开了 ${target.name} 的 ${game.cardLabel(card)}${isAttack ? '，并据为己有' : '，退回原主'}`
      );
      if (isAttack) {
        player.hand.push(card);
        await game.afterHandChange(target);
      } else {
        target.hand.push(card);
      }
      break;
    }
    case 'stt': {
      const peeked = [];
      for (let i = 0; i < 2; i++) {
        const c = game.drawTop();
        if (c) peeked.push(c);
      }
      if (!peeked.length) break;
      const choice = await game.ask(player, {
        type: 'select',
        purpose: 'reorder_deck_top',
        prompt: '【会议纪要】：安排牌堆顶的顺序（第一张将先被摸到）',
        options: peeked.map((c) => ({ id: c.uid, label: game.cardLabel(c), card: c })),
        min: peeked.length,
        max: peeked.length,
        ordered: true,
      });
      const ordered = choice.ids.map((uid) => peeked.find((c) => c.uid === uid)).filter(Boolean);
      for (const c of peeked) if (!ordered.includes(c)) ordered.push(c);
      // drawPile 用 pop() 取牌，故牌堆顶要 push 在最后
      for (const c of ordered.reverse()) s.drawPile.push(c);
      game.log(`${player.name}【会议纪要】查看了牌堆顶 ${peeked.length} 张牌`);
      break;
    }
    case 'iti': {
      // 必须先取走弃牌堆顶，再弃手牌；否则刚弃掉的牌立刻成为堆顶，会被原样换回来。
      const gained = s.discardPile.pop();
      if (!gained) break;
      const picked = await game.pickCards(
        player,
        `【风格迁移】：弃 1 张手牌，换取弃牌堆顶的 ${game.cardLabel(gained)}`,
        1,
        'task_discard'
      );
      picked.forEach((c) => game.toDiscard(c));
      player.hand.push(gained);
      game.emit({ type: 'reveal', playerIndex: player.index, cards: [gained] });
      game.log(`${player.name}【风格迁移】从弃牌堆顶重绘出 ${game.cardLabel(gained)}`);
      break;
    }
    default:
      break;
  }
}
