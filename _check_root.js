'use strict';
const https = require('https');
const zlib = require('zlib');
const T = '3456b576-97ec-41bb-90a3-5951670ba79b';
function api(p) { return new Promise((r, j) => { https.request({ host: 'screeps.com', path: '/api/' + p, headers: { 'X-Token': T, 'X-Username': T } }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => r(d)); }).on('error', j).end(); }); }
function dec(b) { try { let j = JSON.parse(b); let d = j.data; if (typeof d === 'string' && d.startsWith('gz:')) return JSON.parse(zlib.gunzipSync(Buffer.from(d.slice(3), 'base64')).toString()); return d; } catch (e) { return 'PARSEFAIL:' + b.slice(0, 100); } }
(async () => {
  const root = await api('user/memory?shard=shard3');
  const m = dec(root);
  if (typeof m === 'object' && m) {
    console.log('Memory根keys:', Object.keys(m));
    console.log('brain:', JSON.stringify(m.brain));
    const cn = Object.keys(m.creeps || {});
    console.log('creeps数:', cn.length);
    if (cn.length) {
      console.log('样本creep:', cn[0], JSON.stringify(m.creeps[cn[0]]));
      const tt = {}; for (const n of cn) tt[m.creeps[n].taskType || '(none)'] = (tt[m.creeps[n].taskType || '(none)'] || 0) + 1;
      console.log('按taskType:', JSON.stringify(tt));
    }
  } else console.log('根解码结果:', String(m).slice(0, 200));
})().catch(e => console.log('ERR', e.message));
