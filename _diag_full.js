'use strict';
const https = require('https');
const zlib = require('zlib');
const T = '3456b576-97ec-41bb-90a3-5951670ba79b';
const SHARD = 'shard3';
function api(p) { return new Promise((r, j) => { https.request({ host: 'screeps.com', path: '/api/' + p, headers: { 'X-Token': T, 'X-Username': T } }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => r(d)); }).on('error', j).end(); }); }
function dec(b) { try { let j = JSON.parse(b); let d = j.data; if (typeof d === 'string' && d.startsWith('gz:')) return JSON.parse(zlib.gunzipSync(Buffer.from(d.slice(3), 'base64')).toString()); return d; } catch (e) { return null; } }
(async () => {
  const br = JSON.parse(await api('user/branches'));
  console.log('=== 分支 ===');
  for (const b of br.list) console.log(`  ${b.branch} activeWorld=${!!b.activeWorld}`);

  const root = dec(await api(`user/memory?shard=${SHARD}`));
  if (!root) { console.log('Memory 读取失败'); return; }

  // creep 分析：按 memory + 推断角色
  const creeps = root.creeps || {};
  const names = Object.keys(creeps);
  console.log(`\n=== creeps: ${names.length} ===`);
  const tt = {}, roleOld = {};
  let minerCnt = 0;
  for (const n of names) {
    const m = creeps[n];
    tt[m.taskType || '(none)'] = (tt[m.taskType || '(none)'] || 0) + 1;
    roleOld[m.role || '(noRole)'] = (roleOld[m.role || '(noRole)'] || 0) + 1;
    if (/^Miner/i.test(n) || m.role === 'miner') minerCnt++;
  }
  console.log('按 taskType:', JSON.stringify(tt));
  console.log('按 旧role:', JSON.stringify(roleOld));
  console.log('名字含Miner/role=miner:', minerCnt);
  console.log('creep 名字前缀统计:');
  const prefix = {};
  for (const n of names) { const p = n.split('_')[0]; prefix[p] = (prefix[p] || 0) + 1; }
  console.log(' ', JSON.stringify(prefix));

  console.log('\n=== brain ===');
  const b = root.brain || {};
  console.log('weights:', JSON.stringify(b.weights));
  console.log('plan:', JSON.stringify(b.plan));
  console.log('playbook:', JSON.stringify(b.playbook));
  console.log('learn:', JSON.stringify(b.learn));

  // CPU / stats
  console.log('\n=== stats/cpu ===');
  console.log('stats:', JSON.stringify(root.stats || root.statistics || {}).slice(0, 300));

  // 账户 CPU 信息
  const me = JSON.parse(await api('auth/me'));
  console.log('account cpu limit:', me.cpu, 'cpuShard:', JSON.stringify(me.cpuShard || {}));
})().catch(e => console.log('ERR', e.message));
