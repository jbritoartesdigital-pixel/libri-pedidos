import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(x => x.isDirectory() ? walk(join(dir, x.name)) : [join(dir, x.name)]);
}
let count = 0;
for (const file of ['src', 'public', 'scripts', 'tests'].filter(existsSync).flatMap(walk).filter(x => /\.(m?js)$/.test(x))) {
  const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (checked.status !== 0) throw new Error(`${file}: ${checked.stderr}`);
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const target = resolve(dirname(file), match[1].split(/[?#]/)[0]);
    if (!existsSync(target)) throw new Error(`${file}: import ausente ${match[1]}`);
  }
  count++;
}
const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
if (config.main !== 'src/index.js' || !existsSync(config.main)) throw new Error('Worker principal inválido.');
if (!config.d1_databases.some(x => x.binding === 'DB') || !config.r2_buckets.some(x => x.binding === 'FILES') || config.assets.binding !== 'ASSETS') throw new Error('Bindings inválidos.');
console.log(`${count} arquivos JS: sintaxe e imports relativos OK; configuração OK.`);
