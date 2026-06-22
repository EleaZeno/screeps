'use strict';
const https = require('https');
const T = '3456b576-97ec-41bb-90a3-5951670ba79b';
function api(p) { return new Promise((r, j) => { https.request({ host: 'screeps.com', path: '/api/' + p, headers: { 'X-Token': T, 'X-Username': T } }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => r(d)); }).on('error', j).end(); }); }
(async () => {
  const b = await api('user/code?branch=brain');
  const j = JSON.parse(b);
  const mods = Object.keys(j.modules || {});
  console.log('brain 分支模块:', mods.join(', '));
  console.log('main 模块字节:', (j.modules.main || '').length);
  console.log('main 含 brain.loop 标志:', (j.modules.main || '').includes('brain.loop'));
})().catch(e => console.log('ERR', e.message));
