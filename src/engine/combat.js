/**
 * 战斗与生死结算：伤害、濒死救援、出局清算、攻防响应、Benchmark 对决。
 * 全部以 (game, ...) 自由函数实现；Game 类在 game.js 中做单行委托，
 * 保持对外 API 不变（tests 直接调用 g.dealDamage / g.eliminate 等）。
 */
import * as R from './rules.js';
import { EQUIPMENT_SLOTS } from './rules.js';

export async function heal(game, player, amount) {
  const cap = R.maxCompute(player);
  const before = player.compute;
  player.compute = Math.min(cap, player.compute + amount);
  const gained = player.compute - before;
  if (gained > 0) {
    game.emit({ type: 'heal', playerIndex: player.index, amount: gained });
    game.log(`${player.name} 回复 ${gained} 点算力 → ${player.compute}`);
  }
  return gained;
}

export async function dealDamage(game, source, target, amount, cause) {
  if (!target.alive || amount <= 0) return;
  target.compute -= amount;
  game.emit({ type: 'damage', targetIndex: target.index, sourceIndex: source?.index ?? null, amount, cause });
  game.log(`${target.name} 失去 ${amount} 点算力（${cause}），剩余 ${Math.max(0, target.compute)}`, {
    targetIndex: target.index,
  });

  if (R.hasMechanic(target, 'on_damaged_all_others_discard') && target.alive) {
    game.noteSkill(target, 'on_damaged_all_others_discard');
    for (const other of game.othersFrom(target)) {
      if (!other.alive || !other.hand.length) continue;
      const choice = await game.ask(other, {
        type: 'select',
        purpose: 'forced_discard',
        prompt: `${target.name}「成本外溢」触发：你必须弃掉 1 张手牌`,
        options: other.hand.map((c) => ({ id: c.uid, label: game.cardLabel(c), card: c })),
        min: 1,
        max: 1,
      });
      const card = game.removeFromHand(other, choice.ids[0]);
      game.toDiscard(card);
      game.log(`${other.name} 因「成本外溢」弃掉 ${game.cardLabel(card)}`);
    }
  }

  if (R.hasMechanic(target, 'on_damaged_steal_from_source') && source?.alive && source.hand.length) {
    game.noteSkill(target, 'on_damaged_steal_from_source');
    const stolen = game.stealRandomFromHand(source);
    if (stolen) {
      target.hand.push(stolen);
      game.log(`${target.name}「音色风波」从 ${source.name} 手中抽走 1 张牌`);
      await game.afterHandChange(source);
    }
  }

  if (target.compute <= 0) await resolveDying(game, target, source);
  await game.afterHandChange(target);
  game.checkGameOver();
}

export async function resolveDying(game, victim, source) {
  game.emit({ type: 'dying', playerIndex: victim.index });
  game.log(`⚠ ${victim.name} 进入濒死（算力 ${victim.compute}）`);

  const order = [victim, ...game.othersFrom(victim)];
  while (victim.compute <= 0) {
    let saved = false;
    for (const p of order) {
      if (!p.alive || p.compute <= 0) continue;
      const heals = p.hand.filter((c) => game.typeOf(c).kind === 'heal');
      if (!heals.length) continue;
      const isSelf = p.index === victim.index;
      const choice = await game.ask(p, {
        type: 'select',
        purpose: 'dying_save',
        prompt: isSelf
          ? `你已濒死：打出「融资到账」自救，或放弃`
          : `${victim.name} 濒死：打出「融资到账」救援，或不介入`,
        options: [
          ...heals.map((c) => ({ id: c.uid, label: game.cardLabel(c), card: c })),
          { id: 'pass', label: '不介入' },
        ],
        min: 1,
        max: 1,
        dying: victim.index,
      });
      if (choice.ids[0] === 'pass') continue;
      const card = game.removeFromHand(p, choice.ids[0]);
      game.toDiscard(card);
      victim.compute += 1;
      game.emit({ type: 'rescue', playerIndex: p.index, targetIndex: victim.index });
      game.noteRelation(p.index, victim.index, -2);
      game.log(`${p.name} 打出「融资到账」救援 ${victim.name} → 算力 ${victim.compute}`);
      await game.afterHandChange(p);
      saved = true;
      break;
    }
    if (!saved) break;
  }

  if (victim.compute <= 0) await eliminate(game, victim, source);
}

export async function eliminate(game, victim, killer) {
  victim.alive = false;
  victim.compute = 0;
  victim.revealed = true;
  victim.jail = null;
  victim.dynamite = null;
  const s = game.state;
  s.inPlay.jail = game.alivePlayers().some((p) => p.jail);
  s.inPlay.dynamite = game.alivePlayers().some((p) => p.dynamite);

  game.emit({ type: 'eliminated', playerIndex: victim.index, role: victim.role, killerIndex: killer?.index ?? null });
  game.log(`✖ ${victim.name} 出局 — 身份是【${victim.role.name}】`, { playerIndex: victim.index });

  const loot = [...victim.hand];
  const equip = Object.entries(victim.equipment)
    .filter(([, c]) => c)
    .map(([slot, c]) => ({ slot, card: c }));
  for (const slot of EQUIPMENT_SLOTS) victim.equipment[slot] = null;

  const sora = s.players.find(
    (p) => p.alive && R.hasMechanic(p, 'on_eliminated_loot') && p.index !== victim.index
  );
  if (sora) {
    game.noteSkill(sora, 'on_eliminated_loot');
    sora.hand.push(...loot);
    for (const { slot, card } of equip) sora.equipment[slot] = card;
    game.log(`${sora.name}「数据回收」获得了 ${victim.name} 的全部手牌与装备`);
    game.emit({ type: 'loot', playerIndex: sora.index, fromIndex: victim.index });
  } else {
    loot.forEach((c) => game.toDiscard(c));
    equip.forEach(({ card }) => game.toDiscard(card));
  }
  victim.hand = [];

  if (killer && killer.alive) {
    if (victim.role.id === R.ROLE.DISTILLER) {
      await game.drawCards(killer, 3);
      game.log(`${killer.name} 击倒了一名蒸馏者，摸 3 张牌`);
    }
    if (killer.role.id === R.ROLE.LAB && victim.role.id === R.ROLE.PARTNER) {
      const lost = [...killer.hand];
      killer.hand = [];
      for (const slot of EQUIPMENT_SLOTS) {
        if (killer.equipment[slot]) {
          lost.push(killer.equipment[slot]);
          killer.equipment[slot] = null;
        }
      }
      lost.forEach((c) => game.toDiscard(c));
      game.log(`${killer.name} 误杀了授权被许可方，弃掉全部手牌与装备`);
    }
  }
  game.checkGameOver();
}

export async function offerDefense(game, player, prompt, source, meta = {}) {
  const options = [];
  const defenses = player.hand.filter((c) => game.typeOf(c).kind === 'defense');
  for (const c of defenses)
    options.push({ id: `card:${c.uid}`, label: game.cardLabel(c), cardUid: c.uid, card: c });

  // 替代类效果只结算一次：RLHF 对齐装备与同名角色技能（Constitutional AI）共用同一个判定选项
  const canJudge =
    player.equipment.product?.typeId === 'rlhf_alignment' || R.hasMechanic(player, 'judge_heart_as_defense');
  if (canJudge) {
    if (R.hasMechanic(player, 'judge_heart_as_defense')) game.noteSkill(player, 'judge_heart_as_defense');
    options.push({ id: 'judge', label: '进行对齐判定（♥ 视为声明）' });
  }

  options.push({ id: 'pass', label: '不响应' });

  const choice = await game.ask(player, {
    type: 'select',
    purpose: 'defense_response',
    prompt,
    options,
    min: 1,
    max: 1,
    response: true,
    defenseCount: defenses.length,
    sourceIndex: source?.index ?? null,
    ...meta,
  });
  const id = choice.ids[0];

  if (id === 'pass') return false;
  if (id === 'judge') {
    const flipped = await game.judge(player, 'alignment');
    const ok = flipped?.suit === 'heart';
    game.log(`${player.name} 对齐判定${ok ? '成功' : '失败'}`);
    return ok;
  }
  const card = game.removeFromHand(player, id.slice('card:'.length));
  game.toDiscard(card);
  game.log(`${player.name} 打出 ${game.cardLabel(card)}`);
  game.emit({ type: 'play', playerIndex: player.index, card, targetIndex: source?.index ?? null });
  await game.afterHandChange(player);
  return true;
}

export async function resolveAttack(game, source, target, cause = '蒸馏指控') {
  const needed = R.hasMechanic(source, 'attack_needs_two_defenses') ? 2 : 1;
  if (needed === 2) game.noteSkill(source, 'attack_needs_two_defenses');
  game.emit({ type: 'attack', sourceIndex: source.index, targetIndex: target.index, cause });
  game.noteRelation(source.index, target.index, 1);
  game.log(`${source.name} 对 ${target.name} 发起「${cause}」${needed === 2 ? '（需 2 张声明）' : ''}`, {
    sourceIndex: source.index,
    targetIndex: target.index,
  });

  let dodged = 0;
  while (dodged < needed) {
    const ok = await offerDefense(
      game,
      target,
      `${source.name} 的「${cause}」命中你${needed === 2 ? `（还需 ${needed - dodged} 张声明）` : ''}`,
      source,
      { needed, remaining: needed - dodged }
    );
    if (!ok) break;
    dodged++;
  }
  if (dodged >= needed) {
    game.log(`${target.name} 成功否认`);
    return false;
  }
  await dealDamage(game, source, target, 1, cause);
  return true;
}

export async function resolveDuel(game, challenger, target) {
  let current = target;
  game.noteRelation(challenger.index, target.index, 1);
  game.log(`「Benchmark 对决」：${challenger.name} vs ${target.name}`);
  for (let guard = 0; guard < 100; guard++) {
    const other = current.index === challenger.index ? target : challenger;
    const attacks = current.hand.filter((c) => game.canBeUsedAsAttack(current, c));
    let played = null;
    if (attacks.length) {
      const choice = await game.ask(current, {
        type: 'select',
        purpose: 'duel_response',
        prompt: `「Benchmark 对决」对 ${other.name}：打出一张「蒸馏指控」继续，或认输（失去 1 点算力）`,
        options: [
          ...attacks.map((c) => ({ id: c.uid, label: game.cardLabel(c), card: c })),
          { id: 'pass', label: '认输' },
        ],
        min: 1,
        max: 1,
      });
      if (choice.ids[0] !== 'pass') played = game.removeFromHand(current, choice.ids[0]);
    }
    if (!played) break;
    game.toDiscard(played);
    game.log(`${current.name} 在对决中打出 ${game.cardLabel(played)}`);
    await game.afterHandChange(current);
    current = other;
  }
  const loser = current;
  const winner = loser.index === challenger.index ? target : challenger;
  game.log(`${loser.name} 在 Benchmark 对决中落败`);
  await dealDamage(game, winner, loser, 1, 'Benchmark 对决');
}
