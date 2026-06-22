'use strict';
const https = require('https');
const T = '3456b576-97ec-41bb-90a3-5951670ba79b';
function api(p, m, b) {
  return new Promise((res, rej) => {
    const data = b ? JSON.stringify(b) : null;
    const o = { host: 'screeps.com', path: '/api/' + p, method: m || 'GET', headers: { 'X-Token': T, 'X-Username': T } };
    if (data) { o.headers['Content-Type'] = 'application/json'; o.headers['Content-Length'] = Buffer.byteLength(data); }
    const r = https.request(o, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res({ status: x.statusCode, body: d })); });
    r.on('error', rej); if (data) r.write(data); r.end();
  });
}
(async () => {
  const r = await api('user/clone-branch', 'POST', { branch: 'default', newName: 'brain', defaultModules: false });
  console.log('clone-branch:', r.status, r.body);
})().catch(e => console.log('ERR', e.message));
