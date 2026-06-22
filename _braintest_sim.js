'use strict';
// V3 brain — multi-tick continuous sim. Proves colony grows & never deadlocks over N ticks.
const lib = require('./_braintest_lib');
const { mkCreep, mkSource, mkSpawn, mkRoom, ok } = lib;
const t = require('./_braintest');
const blackboard = require('./blackboard');
const market = require('./market');
const brain = require('./brain');
const spawning = require('./spawning');
const executor = require('./executor');

function reset() { Game.creeps = {}; Game.rooms = {}; global._objs = {}; Memory.creeps = {}; Memory.brain = {}; Game.time = 1000; }

console.log('\n=== MULTI-TICK SIM: 200 tick 连续跑，验证经济增长+永不死锁 ===');
reset();
const room = mkRoom('SIM1', { rcl: 2, cap: 550, cur: 300 });
const spawn = mkSpawn('simsp', 25, 25, 'SIM1', 300);
const s1 = mkSource('simsrc1', 10, 25, 'SIM1', 3000);
const s2 = mkSource('simsrc2', 40, 25, 'SIM1', 3000);
room._find[FIND_MY_SPAWNS] = [spawn];
room._find[FIND_SOURCES] = [s1, s2];
room._find[FIND_MY_CREEPS] = [];

// crude economy model: track energy, creep count, controller progress
let energy = 300;
let ctrlProgress = 0;
let creepSeq = 0;
const creeps = [];
let maxStuck = 0; // consecutive ticks with 0 creeps after tick 5
let zeroCreepStreak = 0;

// override spawn to actually materialize creeps in our sim
spawn.spawnCreep = function (body, nm) {
  const cost = body.reduce((s, p) => s + ({ work:100, carry:50, move:50, attack:80, tough:10 }[p] || 0), 0);
  if (energy < cost) return ERR_NOT_ENOUGH_ENERGY;
  energy -= cost;
  const parts = body.slice();
  const c = mkCreep('c' + (creepSeq++), parts, 25, 25, 'SIM1', 0);
  creeps.push(c);
  room._find[FIND_MY_CREEPS] = creeps.slice();
  return OK;
};

for (let tick = 0; tick < 200; tick++) {
  Game.time++;
  // refresh dynamic store views (mock: energyAvailable tracks our energy var)
  room.energyAvailable = Math.min(energy, room.energyCapacityAvailable);
  spawn.store[RESOURCE_ENERGY] = Math.min(energy, 300);
  spawn.store.getFreeCapacity = () => 300 - Math.min(energy, 300);

  const weights = brain.think(room);
  const tasks = blackboard.scan(room);
  const assignment = market.assign(creeps, tasks, weights);

  // simulate work: each assigned creep produces/consumes
  let harvesters = 0, upgraders = 0;
  for (const c of creeps) {
    const tt = c.memory.taskType;
    if (tt === 'harvest') { harvesters++; energy += 6; } // miner ~6 e/tick net into economy
    else if (tt === 'upgrade') { upgraders++; if (energy >= 1) { energy -= 1; ctrlProgress += 1; } }
    else if (tt === 'haul' || tt === 'fill') { /* moves energy, neutral in this crude model */ }
    else if (tt === 'build') { if (energy >= 1) energy -= 1; }
  }

  const shortage = market.shortage(tasks, assignment);
  spawning.run(room, shortage, creeps.length);

  if (tick > 5) {
    if (creeps.length === 0) { zeroCreepStreak++; maxStuck = Math.max(maxStuck, zeroCreepStreak); }
    else zeroCreepStreak = 0;
  }

  if (tick % 40 === 0 || tick === 199) {
    console.log(`  t+${tick}: creeps=${creeps.length} energy=${Math.round(energy)} harv=${harvesters} upg=${upgraders} ctrlProg=${ctrlProgress}`);
  }
}

ok(creeps.length >= 2, '200 tick 后 creep 数量增长（经济活着），实际=' + creeps.length);
ok(maxStuck === 0, '从未出现 0 creep 死锁（团灭防护），最长0creep连续=' + maxStuck);
ok(ctrlProgress > 0, 'controller 有升级进度（系统在发育），实际=' + ctrlProgress);
ok(energy >= 0, '能量从未变负（无能量穿仓）');

const r = t.report();
console.log('\n========================================');
console.log(r.fail === 0 ? `🎉 SIM PASSED (${r.pass} checks)` : `❌ ${r.fail} FAILED`);
process.exit(r.fail === 0 ? 0 : 1);
