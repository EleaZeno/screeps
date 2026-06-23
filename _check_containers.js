'use strict';
const https = require('https'), zlib = require('zlib');
const T = '3456b576-97ec-41bb-90a3-5951670ba79b';
function api(p) { return new Promise((r, j) => { https.request({ host: 'screeps.com', path: '/api/' + p, headers: { 'X-Token': T, 'X-Username': T } }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => r(d)); }).on('error', j).end(); }); }
function dec(b) { try { let j = JSON.parse(b); let d = j.data; if (typeof d === 'string' && d.startsWith('gz:')) return JSON.parse(zlib.gunzipSync(Buffer.from(d.slice(3), 'base64')).toString()); return d; } catch (e) { return null; } }
(async () => {
  // 开采格 slots（在 rooms.E9N52.slots 或 Memory.slots）
  const rooms = dec(await api('user/memory?shard=shard3&path=rooms')) || {};
  const r = rooms.E9N52 || {};
  console.log('E9N52 memory keys:', Object.keys(r).join(','));
  if (r.slots) console.log('开采格 slots:', JSON.stringify(r.slots).slice(0, 400));
  if (r.layout) console.log('layout.roads 数:', (r.layout.roads || []).length);
  // sources 与 controller 坐标（从 creep slot 反推已知: src637483@15,32 src637484@24,36 ctrl@?）
  const slotsTop = dec(await api('user/memory?shard=shard3&path=slots')) || dec(await api('user/memory?shard=shard3&path=E9N52'));
  console.log('top-level slots:', JSON.stringify(slotsTop).slice(0, 300));
})().catch(e => console.log('ERR', e.message));
