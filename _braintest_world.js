'use strict';
// 世界模型测试：验证大脑用真实物理理解"静态采矿 vs 来回跑谁高效"
global.WORK = 'work'; global.CARRY = 'carry'; global.MOVE = 'move'; global.ATTACK = 'attack'; global.RANGED_ATTACK = 'ranged'; global.TOUGH = 'tough';
const path = require('path'); const Module = require('module'); const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { if (r === 'worldmodel') return path.join(__dirname, 'worldmodel.js'); return orig.call(this, r, ...a); };
const wm = require('./worldmodel');

let pass = 0, fail = 0;
function ok(c, m) { if (c) { console.log('  PASS ' + m); pass++; } else { console.log('  FAIL ' + m); fail++; } }
function mkCreep(parts) { return { body: parts.map(t => ({ type: t })) }; }

console.log('\n=== 世界模型：静态采矿 vs 来回跑 (真实物理) ===');
// 5 WORK 1 CARRY 矿工，source 距 spawn 10 格(往返20)
const miner = mkCreep([WORK, WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE]);
const t10 = wm.miningThroughput(miner, 20);
console.log(`  5WORK矿工 往返20格: 静态=${t10.staticRate.toFixed(2)} 往返=${t10.roundTripRate.toFixed(2)} 静态优势=${t10.advantage.toFixed(1)}x`);
ok(t10.staticRate > t10.roundTripRate, '静态吞吐 > 往返吞吐（大脑理解静采更高效）');
ok(t10.advantage > 2, `静态优势 >2x（通勤损耗显著），实际 ${t10.advantage.toFixed(1)}x`);

// 距离越远，静态优势越大（理解"距离=时间损耗"）
const tNear = wm.miningThroughput(miner, 4);
const tFar = wm.miningThroughput(miner, 40);
console.log(`  近(往返4)优势=${tNear.advantage.toFixed(1)}x  远(往返40)优势=${tFar.advantage.toFixed(1)}x`);
ok(tFar.advantage > tNear.advantage, '距离越远静态优势越大（理解距离=吞吐损耗）');

// 静态吞吐受 source 再生上限封顶：5 WORK 和 8 WORK 静态吞吐相同(都=10)
const miner8 = mkCreep([WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE]);
const t8 = wm.miningThroughput(miner8, 20);
ok(Math.abs(t8.staticRate - t10.staticRate) < 0.01, '8WORK与5WORK静态吞吐相同（理解source上限10，多WORK浪费）');
ok(t10.staticRate === 10, `5WORK静态吞吐=10=source上限 (实际${t10.staticRate})`);

console.log('\n=== 世界模型：分工吞吐（重WORK采矿 vs 重CARRY搬运）===');
const wm2 = require('./worldmodel');
const heavyWork = mkCreep([WORK, WORK, WORK, WORK, WORK, CARRY, MOVE]);
const heavyCarry = mkCreep([CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE]);
const hwHarvest = wm2.taskThroughput(heavyWork, { type: 'harvest' }, 5);
const hcHarvest = wm2.taskThroughput(heavyCarry, { type: 'harvest' }, 5);
const hwHaul = wm2.taskThroughput(heavyWork, { type: 'haul' }, 5);
const hcHaul = wm2.taskThroughput(heavyCarry, { type: 'haul' }, 5);
console.log(`  重WORK: 采矿吞吐=${hwHarvest.toFixed(1)} 搬运吞吐=${hwHaul.toFixed(1)}`);
console.log(`  重CARRY: 采矿吞吐=${hcHarvest.toFixed(1)} 搬运吞吐=${hcHaul.toFixed(1)}`);
ok(hwHarvest > hcHarvest, '重WORK采矿吞吐 > 重CARRY采矿吞吐（重WORK该去采）');
ok(hcHaul > hwHaul, '重CARRY搬运吞吐 > 重WORK搬运吞吐（重CARRY该去搬）');

console.log('\n=== 能量经济流：理解需几个 Hauler（防失业）===');
const wm3 = require('./worldmodel');
function mkRoom2(harvCreeps, haulerCreeps, srcDist) {
  const sources = [{ pos: { x: 10, y: 25 } }, { pos: { x: 40, y: 25 } }];
  const spawn = { pos: { x: 25, y: 25 } };
  const creeps = [];
  for (let i = 0; i < harvCreeps; i++) creeps.push({ body: [WORK, WORK, WORK, WORK, WORK, CARRY, MOVE].map(t => ({ type: t })), memory: { taskType: 'harvest' } });
  for (let i = 0; i < haulerCreeps; i++) creeps.push({ body: [CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE].map(t => ({ type: t })), memory: { taskType: 'haul' } });
  return { find(t) { if (t === FIND_SOURCES) return sources; if (t === FIND_MY_SPAWNS) return [spawn]; if (t === FIND_MY_CREEPS) return creeps; return []; } };
}
global.FIND_SOURCES = 1; global.FIND_MY_SPAWNS = 3; global.FIND_MY_CREEPS = 10;
const flowBalanced = wm3.economyFlow(mkRoom2(2, 3, 15));
console.log('  2采集+3Hauler:', JSON.stringify(flowBalanced));
const flowGlut = wm3.economyFlow(mkRoom2(2, 8, 15));
console.log('  2采集+8Hauler:', JSON.stringify(flowGlut));
ok(flowGlut.balance > 0, `8 Hauler 时检测到过剩 balance>0 (实际${flowGlut.balance})`);
ok(flowGlut.haulNeed < 8, `理解只需 ${flowGlut.haulNeed} 个 Hauler，8个是浪费`);

console.log('\n========================================');
console.log(fail === 0 ? `🎉 ALL ${pass} CHECKS PASSED` : `❌ ${fail} FAILED / ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
