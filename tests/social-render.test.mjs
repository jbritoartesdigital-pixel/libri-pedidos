import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {buildProjectBible,buildSocialDraft,renderSocialDraft}
  from '../scripts/libri-project-automation.mjs';

const hasFfmpeg=spawnSync('ffmpeg',['-version'],{stdio:'ignore'}).status===0;
const hasFfprobe=spawnSync('ffprobe',['-version'],{stdio:'ignore'}).status===0;

test('renderizar Reels, Stories e capa 9:16 sem mídia real, dados privados ou upload',{
  skip:!hasFfmpeg||!hasFfprobe
}, t=>{
  const dir=mkdtempSync(join(tmpdir(),'libri-social-ci-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const video=join(dir,'entrada_sintetica.mp4');
  const fake=spawnSync('ffmpeg',[
    '-hide_banner','-loglevel','error','-y','-f','lavfi',
    '-i','color=c=black:s=180x320:r=6:d=2',
    '-f','lavfi','-i','anullsrc=channel_layout=stereo:sample_rate=44100',
    '-shortest','-t','2','-c:v','libx264','-pix_fmt','yuv420p',
    '-c:a','aac',video
  ],{encoding:'utf8',timeout:45_000});
  assert.equal(fake.status,0,fake.stderr?.slice(-500)||'Não gerou vídeo sintético');
  const bible=buildProjectBible({
    projectId:'projeto_99990',orderCode:'pedido_99990',format:'video',
    driveFolderId:'1fakeFolderId9876543210ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    approvals:[{id:'aprov_vid00001',type:'final_video',version:1,
      approved:true,approvedAt:'2026-10-10T11:00:00Z',
      sha256:'d'.repeat(64),mimeType:'video/mp4',sourceRef:'asset_99990'}]
  });
  const permissionDenied=buildSocialDraft(bible);
  assert.throws(()=>renderSocialDraft(permissionDenied,video,dir),/Autorização/);
  const approved=buildSocialDraft(bible,{hasMarketingPermission:true});
  const target=join(dir,'saida');
  const result=renderSocialDraft(approved,video,target);
  assert.equal(result.length,3);
  for(const file of result)assert.ok(statSync(file).size>200,'Arquivo gerado vazio');
  for(const videoPath of result.filter(x=>x.endsWith('.mp4'))){
    const info=spawnSync('ffprobe',['-v','error','-select_streams','v:0',
      '-show_entries','stream=width,height','-of','csv=p=0',videoPath],
      {encoding:'utf8',timeout:10_000});
    assert.equal(info.status,0);
    assert.equal(info.stdout.trim(),'1080,1920');
  }
  assert.ok(statSync(join(target,'Legenda_Rascunho.txt')).size>20);
});
