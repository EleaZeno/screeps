'use strict';
const https = require('https');
const zlib = require('zlib');
const T = '3456b576-97ec-41bb-90a3-5951670ba79b';
const SHARD = 'shard3';
function api(p) { return new Promise((r, j) => { https.request({ host: 'screeps.com', path: '/api/' + p, headers: { 'X-Token': T, 'X-Username': T } }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => r(d)); }).on('error', j).end(); }); }
function dec(b) { try { let j = JSON.parse(b); let d = j.data; if (typeof d === 'string' && d.startsWith('gz:')) return JSON.parse(zlib.gunzipSync(Buffer.from(d.slice(3), 'base64')).toString()); return d; } catch (e) { return null; } }
(async () => {
  // console 日志（最近）
  const con = await api(`user/console?shard=${SHARD}`);
  console.log('=== console (GET, 可能为空) ===', con.slice(0, 200));
  // creep memory 结构（看前 3 个的字段）
  const cm = await api(`user/memory?shard=${SHARD}&path=creeps`);
  const creeps = dec(cm.body) || {};
  const names = Object.keys(creeps);
  console.log('creep 总数:', names.length);
  console.log('前 5 个 creep memory 字段:');
  names.slice(0, 5).forEach(n => console.log(`  ${n}:`, JSON.stringify(creeps[n])));
  // 统计 taskType vs role
  const tt = {}, rl = {};
  for (const n of names) { tt[creeps[n].taskType || '(no taskType)'] = (tt[creeps[n].taskType || '(no taskType)'] || 0) + 1; rl[creeps[n].role || '(no role)'] = (rl[creeps[n].role || '(no role)'] || 0) + 1; }
  console.log('按 taskType:', JSON.stringify(tt));
  console.log('按 role(旧):', JSON.stringify(rl));
})().catch(e => console.log('ERR', e.message));
