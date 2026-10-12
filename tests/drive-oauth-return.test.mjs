import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {needsDriveOAuthReturnPage,driveOAuthReturnPage} from '../src/lib/v2-drive-oauth-return.js';
const origin='https://pedidos.libriconvites.com.br';
const callback='/api/admin/v2/drive/oauth/callback';

test('return from Google uses a landing page, while its retry requires admin auth',()=>{
  const first=new Request(origin+callback+'?code=example-code&state=example-state',
    {headers:{'sec-fetch-site':'cross-site'}});
  assert.equal(needsDriveOAuthReturnPage(first,new URL(first.url)),true);
  const retry=new Request(first.url+'&oauth_return=1');
  assert.equal(needsDriveOAuthReturnPage(retry,new URL(retry.url)),false);
  const post=new Request(first.url,{method:'POST'});
  assert.equal(needsDriveOAuthReturnPage(post,new URL(post.url)),false);
  const other=new Request(origin+'/api/admin/v2/orders');
  assert.equal(needsDriveOAuthReturnPage(other,new URL(other.url)),false);
  const source=readFileSync('src/index.js','utf8');
  const check=source.indexOf('await requireAdminPasskeyAuth(');
  assert.ok(source.indexOf('if(needsDriveOAuthReturnPage(request,url))')<check);
  assert.ok(source.indexOf('handleAdminDriveFolderV2Api,',check)>check);
});

test('landing page contains no credentials and restricts code exchange to its origin',async()=>{
  const response=driveOAuthReturnPage(),html=await response.text();
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  const nonce=/script-src 'nonce-([a-f0-9]+)'/.exec(response.headers.get('content-security-policy'))[1];
  assert.match(html,new RegExp('<script nonce="'+nonce+'">'));
  assert.match(html,/credentials:'same-origin'/);
  assert.match(html,/history.replaceState/);
  assert.match(html,/destination.origin!==location.origin/);
  assert.match(html,/destination.pathname!=='\/admin-v2'/);
  assert.doesNotMatch(html,/client_secret|refresh_token|example-code|example-state/);
});
