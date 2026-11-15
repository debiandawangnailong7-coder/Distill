/**
 * 角色卡组件：开场角色墙与局内技能预览共用同一份数据与布局。
 * 仅两处可变：size（lg=开场大图 / sm=局内浮层 / md=预览页）与美术轴
 * art（'portrait'=普通立绘 portraits/，'avatar'=Q 版座位头像 characters/）。
 * 数据始终来自 data/characters.json 的 character 对象；技能展示覆盖全部
 * skills[]（如豆包 Seed 的双技能），不只主技能。
 */

/** 技能名一行（多技能以「/」分隔），座位与角色卡共用。 */
export function skillLine(character) {
  const names = (character?.skills ?? []).map((s) => s.name).filter(Boolean);
  return names.length ? `「${names.join(' / ')}」` : '';
}

/** 技能详情文本（全部技能的名称 + 效果），详情面板与局内浮层共用。 */
export function skillDetailText(character) {
  const skills = (character?.skills ?? []).filter((s) => s.name || s.effect);
  return skills.map((s) => `「${s.name}」${s.effect ?? ''}`).join('；');
}

export function createCharacterCard(character, { assets, art = 'portrait', size = 'md', artSrc = null } = {}) {
  const card = document.createElement('div');
  card.className = `charCard charCard-${size}`;
  card.dataset.characterId = character.id;

  const img = document.createElement('img');
  img.className = 'charCardArt';
  // artSrc 优先：开场页用袋鼠团子为「未推出模型」占位时传入。
  img.src = artSrc ?? (art === 'portrait' ? assets?.portrait(character.id) : assets?.character(character.id));
  img.alt = character.name;
  img.decoding = 'async';
  card.appendChild(img);

  const name = document.createElement('span');
  name.className = 'charCardName';
  name.textContent = character.name;
  card.appendChild(name);

  const line = skillLine(character);
  if (line) {
    const skill = document.createElement('span');
    skill.className = 'charCardSkill';
    skill.textContent = line;
    card.appendChild(skill);
    card.title = skillDetailText(character);
  }
  return card;
}
