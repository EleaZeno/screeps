'use strict';
const https = require('https'), zlib = require('zlib');
const T = '3456b576-97ec-41bb-90a3-5951670ba79b';
function api(p) { return new Promise((r, j) => { https.request({ host: 'screeps.com', path: '/api/' + p, headers: { 'X-Token': T, 'X-Username': T } }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => r(d)); }).on('error', j).end(); }); }
function dec(b) { try { let j = JSON.parse(b); let d = j.data; if (typeof d === 'string' && d.startsWith('gz:')) return JSON.parse(zlib.gunzipSync(Buffer.from(d.slice(3), 'base64')).toString()); return d; } catch (e) { return null; } }
(async () => {
  const creeps = dec(await api('user/memory?shard=shard3&path=creeps')) || {};
  const names = Object.keys(creeps);
  console.log('=== 每个 creep: 名字 | taskType | slot | dest | _stk ===');
  for (const n of names) {
    const m = creeps[n];
    const slot = m.slot ? `${m.slot.x},${m.slot.y}` : '-';
    const dest = m._move && m._move.dest ? `${m._move.dest.x},${m._move.dest.y}` : '-';
    console.log(`${n.padEnd(22)} ${(m.taskType||'(none)').padEnd(9)} slot=${slot.padEnd(7)} dest=${dest.padEnd(7)} stk=${m._stk||0} tgt=${(m.taskTarget||'-').slice(-6)}`);
  }
  const tt = {}; for (const n of names) tt[creeps[n].taskType || '(none)'] = (tt[creeps[n].taskType || '(none)'] || 0) + 1;
  console.log('\ntaskType:', JSON.stringify(tt));
  // brain weights + plan + genome
  const b = dec(await api('user/memory?shard=shard3&path=brain')) || {};
  console.log('\nweights:', JSON.stringify(b.weights));
  console.log('plan:', JSON.stringify(b.plan));
  console.log('genome.gen:', b.genome && b.genome.gen, 'lastFitness:', b.genome && b.genome.lastFitness);
})().catch(e => console.log('ERR', e.message));
