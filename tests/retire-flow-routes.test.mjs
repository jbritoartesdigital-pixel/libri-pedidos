import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';

test('Flow integration is detached from the Pedidos application entrypoint', () => {
  const source = readFileSync('src/index.js', 'utf8');
  assert.doesNotMatch(source, /handleAdminFlowV2Api|handleAdminFlowDriveV2Api/);
  assert.doesNotMatch(source, /handleAdminFlowGrantsV2Api|handleInternalFlowGrantRedeem/);
  assert.doesNotMatch(source, /serveStaticShell\(request, env, '\/flow-connect\.html'\)/);
  assert.match(source, /handleAdminOrdersV2Api/);
  assert.doesNotMatch(source, /handleAdminDriveFolderV2Api|runV2DriveSync|driveOAuthReturnPage/);
  assert.doesNotMatch(source, /handleAdminProjectBibleV2Api/);
});

test('Flow internal grant redemption no longer has an active route', async () => {
  const request = new Request(
    'https://pedidos.libriconvites.com.br/api/internal/flow/grant/redeem',
    { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant: 'dummy', nonce: 'dummy' }) }
  );
  const response = await worker.fetch(request, {}, { waitUntil() {} });
  assert.equal(response.status, 404);
});

test('legacy Flow and Drive pages are not shipped by Pedidos', () => {
  assert.equal(exists('public/flow-connect.html'), false);
  assert.equal(exists('public/drive-privacy.html'), false);
  function exists(path) {
    try { readFileSync(path); return true; }
    catch (e) { if (e?.code === 'ENOENT') return false; throw e; }
  }
});
