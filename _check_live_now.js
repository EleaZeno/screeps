'use strict';
// 查线上 activeWorld 分支 + E9N52 房间状态
const https = require('https');
const T = '3456b576-97ec-41bb-90a3-5951670ba79b';
function api(path, method, body) {
  return new Promise((res, rej) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      host: 'screeps.com', path: '/api/' + path, method: method || 'GET',
      headers: { 'X-Token': T, 'Content-Type': 'application/json',
                 ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) }
    }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); });
    req.on('error', rej);
    if (data) req.write(data);
    req.end();
  });
}
(async () => {
  // 1. 哪个分支是 activeWorld
  const branches = JSON.parse(await api('user/branches'));
  console.log('=== 分支 ===');
  (branches.list || []).forEach(b => console.log(`  ${b.branch}  activeWorld=${b.activeWorld}  activeSim=${b.activeSim}`));
  // 2. brain 分支模块清单
  const code = JSON.parse(await api('user/code?branch=brain'));
  console.log('=== brain 分支模块 ===');
  if (code.modules) console.log('  ', Object.keys(code.modules).join(', '));
  else console.log('  (无)', JSON.stringify(code).slice(0,200));
  // 3. Memory 看房间运行状态
  const mem = await api('user/memory?shard=shard3');
  try {
    const m = JSON.parse(mem);
    let data = m.data;
    if (typeof data === 'string' && data.startsWith('gz:')) {
      const zlib = require('zlib');
      data = zlib.gunzipSync(Buffer.from(data.slice(3), 'base64')).toString();
    }
    const M = JSON.parse(data);
    console.log('=== Memory keys ===', Object.keys(M).join(', '));
    if (M.creeps) console.log('  creep数:', Object.keys(M.creeps).length);
    if (M.stats) console.log('  stats:', JSON.stringify(M.stats).slice(0,400));
    if (M.rooms) console.log('  rooms:', JSON.stringify(M.rooms).slice(0,400));
  } catch(e) { console.log('=== Memory ===', mem.slice(0,300)); }
})();
