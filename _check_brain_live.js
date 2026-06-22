'use strict';
const https = require('https');
const zlib = require('zlib');
const T = '3456b576-97ec-41bb-90a3-5951670ba79b';
const SHARD = 'shard3';
function api(p) { return new Promise((r, j) => { https.request({ host: 'screeps.com', path: '/api/' + p, headers: { 'X-Token': T, 'X-Username': T } }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => r(d)); }).on('error', j).end(); }); }
function dec(b) { let j = JSON.parse(b); let d = j.data; if (typeof d === 'string' && d.startsWith('gz:')) return JSON.parse(zlib.gunzipSync(Buffer.from(d.slice(3), 'base64')).toString()); return d; }
(async () => {
  // 1. 哪个分支是 activeWorld
  const br = await api('user/branches');
  const bj = JSON.parse(br);
  console.log('=== 分支 ===');
  for (const b of bj.list) console.log(`  ${b.branch}  activeWorld=${!!b.activeWorld} activeSim=${!!b.activeSim}`);
  // 2. 房间真实状态
  const ro = await api(`game/room-objects?room=E9N52&shard=${SHARD}`);
  let objs = []; try { objs = JSON.parse(ro.body).objects || []; } catch (e) {}
  const by = {}; for (const o of objs) (by[o.type] = by[o.type] || []).push(o);
  const ctrl = (by.controller || [])[0];
  console.log('=== E9N52 ===');
  if (ctrl) console.log(`RCL ${ctrl.level} progress ${ctrl.progress}`);
  console.log(`spawns=${(by.spawn||[]).length} ext=${(by.extension||[]).length} containers=${(by.container||[]).length} towers=${(by.tower||[]).length}`);
  (by.container||[]).forEach((c,i)=>console.log(`  container[${i}] @${c.x},${c.y} e=${(c.store&&c.store.energy)||0}`));
  (by.source||[]).forEach((s,i)=>console.log(`  source[${i}] @${s.x},${s.y} e=${s.energy}`));
  const myCreeps = (by.creep||[]).filter(c=>c.user);
  console.log(`myCreeps=${myCreeps.length}`);
  // 3. creep memory（看大脑分配的 taskType）
  const cm = await api(`user/memory?shard=${SHARD}&path=creeps`);
  const creeps = dec(cm.body) || {};
  const taskCount = {};
  for (const [nm, m] of Object.entries(creeps)) {
    const tt = m.taskType || '(none)';
    taskCount[tt] = (taskCount[tt] || 0) + 1;
  }
  console.log('creep按taskType:', JSON.stringify(taskCount));
  // 4. brain memory（战略权重）
  const bm = await api(`user/memory?shard=${SHARD}&path=brain`);
  console.log('Memory.brain:', JSON.stringify(dec(bm.body)));
  // 5. game time
  const t = await api(`game/time?shard=${SHARD}`);
  console.log('time:', JSON.parse(t.body).time);
})().catch(e => console.log('ERR', e.message));
