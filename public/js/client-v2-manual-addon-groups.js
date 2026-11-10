// Layout compacto de adicionais para pedidos manuais enviados às clientes.
// O catálogo, preços e disponibilidade continuam vindo da API do servidor.
const groupOrder = ['filter', 'save_the_date', 'reminder', 'moments', 'retrospectiva', 'moments_extra'];
const groupTitles = {
  filter: 'Filtro personalizado',
  save_the_date: 'Save the Date',
  reminder: 'Lembrete do evento',
  moments: 'Álbum da Festa',
  retrospectiva: 'Retrospectiva',
  moments_extra: 'Mais fotos para o álbum',
};
const shortNames = {
  save_static: 'Estático',
  save_animated: 'Animado',
  reminder_static: 'Estático',
  reminder_animated: 'Animado',
  moments_festa: 'Festa',
  moments_premium: 'Premium',
  moments_exclusive: 'Exclusive',
  retro_070: '70 fotos • até 5 vídeos',
  retro_100: '100 fotos • até 10 vídeos',
  retro_150: '150 fotos • até 10 vídeos + legendas',
  retro_200: '200 fotos • até 10 vídeos + legendas',
  retro_250: '250 fotos • até 10 vídeos + legendas',
  moments_extra_100: '+100 fotos',
};
export const isMomentsPlan = code => /^moments_(festa|premium|exclusive)$/.test(code);

export function compactManualAddonGroups(available = []) {
  const byGroup = new Map();
  for (const addon of available) {
    const group = addon.group || 'extras';
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push(addon);
  }
  return [...byGroup].sort(([a], [b]) =>
    (groupOrder.indexOf(a) < 0 ? 999 : groupOrder.indexOf(a))
    - (groupOrder.indexOf(b) < 0 ? 999 : groupOrder.indexOf(b))
  ).map(([key, options]) => ({
    key, label: groupTitles[key] || key,
    options: options.slice().sort((a, b) => a.priceCents - b.priceCents),
    minPriceCents: Math.min(...options.map(x => x.priceCents)),
  }));
}

export function compactManualAddonsHtml(available, selected, contractedCodes, money, esc) {
  const groupHtml = compactManualAddonGroups(available).map(group => {
    const ownedMoments = contractedCodes.some(isMomentsPlan);
    const isExtra = group.key === 'moments_extra';
    if (group.options.length === 1) {
      const item = group.options[0];
      return `<label class="manual-addon-single ${isExtra && !ownedMoments && !selected.some(isMomentsPlan) ? 'hidden' : ''}"
          ${isExtra ? 'id="manualMomentsExtraRow"' : ''}>
        <input type="checkbox" data-manual-addon="1" value="${esc(item.code)}"
          ${selected.includes(item.code) ? 'checked' : ''}>
        <span class="manual-addon-label">${esc(group.label)}</span>
        <strong class="manual-addon-price">+${money(item.priceCents)}</strong>
      </label>`;
    }
    const chosen = group.options.find(item => selected.includes(item.code));
    const note = group.key === 'retrospectiva'
      ? '<p class="manual-addon-note">Inclui abertura, músicas, animações e dedicatória. Os arquivos da retrospectiva serão solicitados pela Libri após a contratação.</p>'
      : '';
    return `<details class="manual-addon-group" data-manual-addon-group="${esc(group.key)}"
      ${chosen ? 'open' : ''}>
      <summary>
        <span class="manual-addon-title">${esc(group.label)}
          <small data-addon-choice>${chosen ? esc(shortNames[chosen.code] || chosen.name) : 'Toque para escolher'}</small>
        </span>
        <strong data-addon-price class="manual-addon-price">${chosen ? money(chosen.priceCents) : 'A partir de ' + money(group.minPriceCents)}</strong>
      </summary>
      <div class="manual-addon-options" role="radiogroup" aria-label="${esc(group.label)}">
        <label class="manual-addon-option">
          <input type="radio" data-manual-addon-group="${esc(group.key)}"
            name="manualAddonGroup_${esc(group.key)}" value=""
            ${!chosen ? 'checked' : ''}>
          <span>Não adicionar</span>
        </label>
        ${group.options.map(item => `<label class="manual-addon-option">
          <input type="radio" data-manual-addon="1" data-manual-addon-group="${esc(group.key)}"
            name="manualAddonGroup_${esc(group.key)}" value="${esc(item.code)}"
            ${chosen?.code === item.code ? 'checked' : ''}>
          <span>${esc(shortNames[item.code] || item.name)}</span>
          <strong>+${money(item.priceCents)}</strong>
        </label>`).join('')}
        ${note}
      </div>
    </details>`;
  }).join('');
  return groupHtml;
}
