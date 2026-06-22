'use strict';
const https = require('https');
const T = '3456b576-97ec-41bb-90a3-5951670ba79b';
function api(p, m, b) { return new Promise((res, rej) => { const data = b ? JSON.stringify(b) : null; const o = { host: 'screeps.com', path: '/api/' + p, method: m || 'GET', headers: { 'X-Token': T, 'X-Username': T } }; if (data) { o.headers['Content-Type'] = 'application/json'; o.headers['Content-Length'] = Buffer.byteLength(data); } const r = https.request(o, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res({ status: x.statusCode, body: d })); }); r.on('error', rej); if (data) r.write(data); r.end(); }); }
(async () => {
  // 删除游戏里的 default 分支（旧 v2 系统）。brain 已是 activeWorld，删 default 安全。
  const r = await api('user/delete-branch', 'POST', { branch: 'default' });
  console.log('delete default:', r.status, r.body);
  // 确认剩余分支
  const br = await api('user/branches');
  const bj = JSON.parse(br);
  console.log('剩余分支:');
  for (const b of bj.list) console.log(`  ${b.branch} activeWorld=${!!b.activeWorld}`);
})().catch(e => console.log('ERR', e.message));
