// Only release workflow calls --apply, after migrations and recovery bookmark.
import {readFileSync} from 'node:fs';
import {activateApprovedV3Catalog} from '../src/lib/v3-release-catalog.js';
const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
const binding=config.d1_databases.find(x=>x.binding==='DB');
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
const apply=process.argv.includes('--apply');
if(!account||!token||!binding?.database_id)throw Error('Credenciais ou D1 ausentes.');
if(apply&&(process.env.GITHUB_REF!=='refs/heads/main'||config.vars.LIBRI_V3_CHECKOUT_ENABLED!=='true'))throw Error('Ativação somente em release da main com checkout V3 habilitado no código.');
async function query(payload){
 const response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(account)+'/d1/database/'+encodeURIComponent(binding.database_id)+'/query',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(60000)});
 const data=await response.json();
 if(!response.ok||!data.success||!Array.isArray(data.result)||data.result.some(r=>r.success!==true))throw Error('D1 recusou a operação; verificar catálogo e permissões sem expor credenciais.');
 return data.result;
}
const db={prepare(sql){const statement={sql,params:[]};const q={statement,bind(...params){statement.params=params.map(String);return q;},async all(){return (await query(statement))[0];},async first(){return (await q.all()).results?.[0]??null;}};return q;},async batch(queries){return query({batch:queries.map(x=>x.statement)});}};
console.log(JSON.stringify(await activateApprovedV3Catalog(db,{apply})));
