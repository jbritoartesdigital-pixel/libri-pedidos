import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  compactManualAddonGroups,
  compactManualAddonsHtml,
} from '../public/js/client-v2-manual-addon-groups.js';

const addon = {
  code: 'confirmation_libri',
  name: 'Confirmação de Presença Libri',
  group: 'confirmation',
  priceCents: 3500,
};
const money = amount => 'R$ ' + (amount / 100).toFixed(2).replace('.', ',');
const esc = value => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('"', '&quot;');

test('o adicional opcional usa nome claro e nunca mostra confirmation como título', () => {
  const groups = compactManualAddonGroups([addon]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, 'Confirmação de Presença Libri');

  const html = compactManualAddonsHtml([addon], [], [], money, esc);
  assert.match(html, /Confirmação de Presença Libri/);
  assert.match(html, /\(opcional\)/);
  assert.match(html, /\+R\$ 35,00/);
  assert.match(html, /confirmação simples de presença sem este adicional/);
  assert.match(html, /acompanha as respostas/);
  assert.match(html, /confirmação livre/);
  assert.match(html, /lista de convidados/);
  assert.doesNotMatch(html, />\s*confirmation\s*</i);
  assert.match(html, /value="confirmation_libri"/);
  assert.match(html, /aria-describedby="manualConfirmationExplanation"/);
});

test('a explicação não muda seleção nem pagamento e não aumenta outros adicionais', () => {
  const selected = compactManualAddonsHtml([addon], ['confirmation_libri'], [], money, esc);
  assert.match(selected, /value="confirmation_libri"[\s\S]*?checked/);
  const save = { code: 'save_static', name: 'Save the Date Estático',
    group: 'save_the_date', priceCents: 2000 };
  const list = compactManualAddonsHtml([addon, save], [], [], money, esc);
  assert.match(list, /Confirmação de Presença Libri/);
  assert.match(list, /Save the Date/);
  assert.match(list, /A partir de R\$ 20,00|\+R\$ 20,00/);
});

test('a loja diferencia confirmação simples do RSVP Libri', () => {
  const store = readFileSync('public/js/client-v2-store.js', 'utf8');
  const customerArea = readFileSync('src/lib/v2-customer-area.js', 'utf8');
  const styles = readFileSync('public/css/client-v2.css', 'utf8');
  const shell = readFileSync('public/client-v2.html', 'utf8');
  const entry = readFileSync('public/js/client-v2.js', 'utf8');

  assert.match(customerArea, /'simple_rsvp'/);
  assert.match(store, /Este adicional é opcional/);
  assert.match(store, /confirmação simples de presença sem a Confirmação Libri/);
  assert.match(store, /Você escolhe confirmação livre ou por lista de convidados/);
  assert.match(styles, /\.manual-addon-explanation/);
  assert.match(shell, /client-v2\.css\?v=20261110-confirmation-clear-1/);
  assert.match(shell, /client-v2\.js\?v=20261111-rose-v2-2/);
  assert.match(entry, /client-v2-store\.js\?v=20261111-rose-v2-2/);
  assert.match(store, /client-v2-manual-addon-groups\.js\?v=20261110-confirmation-clear-1/);
});
