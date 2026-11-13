/**
 * 角色卡组件：开场角色墙与局内技能预览共用同一份数据与布局。
 * 仅两处可变：size（lg=开场大图 / sm=局内浮层 / md=预览页）与美术轴
 * art（'portrait'=普通立绘 portraits/，'avatar'=Q 版座位头像 characters/）。
 * 数据始终来自 data/characters.json 的 character 对象，技能读取 primarySkill。
 */
import { primarySkill } from '../engine/index.js';

export function createCharacterCard(character, { assets, art = 'portrait', size = 'md' } = {}) {
  const card = document.createElement('div');
  card.className = `charCard charCard-${size}`;
  card.dataset.characterId = character.id;

  const img = document.createElement('img');
  img.className = 'charCardArt';
  img.src = art === 'portrait' ? assets?.portrait(character.id) : assets?.character(character.id);
  img.alt = character.name;
  img.decoding = 'async';
  card.appendChild(img);

  const name = document.createElement('span');
  name.className = 'charCardName';
  name.textContent = character.name;
  card.appendChild(name);

  const skill = primarySkill(character);
  if (skill) {
    const line = document.createElement('span');
    line.className = 'charCardSkill';
    line.textContent = `「${skill.name}」`;
    card.appendChild(line);
    card.title = skill.effect ?? '';
  }
  return card;
}

/** 技能详情文本（技能名 + 效果），详情面板与局内浮层共用。 */
export function skillDetailText(character) {
  const skill = primarySkill(character);
  return skill ? `「${skill.name}」${skill.effect ?? ''}` : '';
}
