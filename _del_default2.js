'use strict';
const https = require('https');
const T = '3456b576-97ec-41bb-90a3-5951670ba79b';
function api(p, m, b) { return new Promise((res, rej) => { const data = b ? JSON.stringify(b) : null; const o = { host: 'screeps.com', path: '/api/' + p, method: m || 'GET', headers: { 'X-Token': T, 'X-Username': T } }; if (data) { o.headers['Content-Type'] = 'application/json'; o.headers['Content-Length'] = Buffer.byteLength(data); } const r = https.request(o, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res({ s: x.statusCode, b: d })); }); r.on('error', rej); if (data) r.write(data); r.end(); }); }
(async () => {
  let r = await api('user/branches', 'GET');
  console.log('before:', JSON.parse(r.b).list.map(x => x.branch + (x.activeWorld ? '(active)' : '')).join(', '));
  r = await api('user/delete-branch', 'POST', { branch: 'default' });
  console.log('delete default:', r.s, r.b);
  await new Promise(z => setTimeout(z, 2500));
  r = await api('user/branches', 'GET');
  console.log('after:', JSON.parse(r.b).list.map(x => x.branch + (x.activeWorld ? '(active)' : '')).join(', '));
})().catch(e => console.log('ERR', e.message));
