'use strict';
const https = require('https'), zlib = require('zlib');
const T = '3456b576-97ec-41bb-90a3-5951670ba79b';
function api(p) { return new Promise((r, j) => { https.request({ host: 'screeps.com', path: '/api/' + p, headers: { 'X-Token': T, 'X-Username': T } }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => r(d)); }).on('error', j).end(); }); }
function dec(b) { try { let j = JSON.parse(b); let d = j.data; if (typeof d === 'string' && d.startsWith('gz:')) return JSON.parse(zlib.gunzipSync(Buffer.from(d.slice(3), 'base64')).toString()); return d; } catch (e) { return null; } }
(async () => {
  const creeps = dec(await api('user/memory?shard=shard3&path=creeps')) || {};
  const names = Object.keys(creeps);
  console.log('creep 总数:', names.length);
  // 找含 1430 的，或所有 creep 列出 taskType + 是否疑似不动(_stk)
  console.log('\n=== 含 "1430" 的 creep ===');
  for (const n of names) if (n.includes('1430')) console.log(n, JSON.stringify(creeps[n]));
  console.log('\n=== 所有 creep: name | taskType | _stk(卡死计数) | _move目标 ===');
  for (const n of names) {
    const m = creeps[n];
    const mv = m._move ? `${m._move.dest.x},${m._move.dest.y}` : '-';
    console.log(`${n.padEnd(20)} task=${(m.taskType||'(none)').padEnd(9)} stk=${m._stk||0} slot=${m.slot?(m.slot.x+','+m.slot.y):'-'} dest=${mv}`);
  }
  // taskType 统计
  const tt = {}; for (const n of names) tt[creeps[n].taskType || '(none)'] = (tt[creeps[n].taskType || '(none)'] || 0) + 1;
  console.log('\ntaskType:', JSON.stringify(tt));
})().catch(e => console.log('ERR', e.message));
