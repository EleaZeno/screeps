'use strict';
// V3 brain test runner — replays old bug scenarios, proves market immunity.
const lib = require('./_braintest_lib');
const { mkCreep, mkSource, mkSpawn, mkRoom, ok } = lib;
const t = require('./_braintest');

const blackboard = require('./blackboard');
const market = require('./market');
const brain = require('./brain');
const spawning = require('./spawning');
const utility = require('./utility');

function reset() { Game.creeps = {}; Game.rooms = {}; global._objs = {}; Memory.creeps = {}; Memory.brain = {}; Game.time = 1000; }

// ============ SCENARIO 1: bootstrap — no creeps, must seed, never deadlock ============
console.log('\n=== S1: bootstrap 冷启动（旧 bug: 攒不出 miner 死锁）===');
(function () {
  reset();
  const room = mkRoom('W1N1', { rcl: 2, cap: 550, cur: 300 });
  const spawn = mkSpawn('sp1', 25, 25, 'W1N1', 300);
  const s1 = mkSource('src1', 10, 10, 'W1N1', 3000);
  const s2 = mkSource('src2', 40, 40, 'W1N1', 3000);
  room._find[FIND_MY_SPAWNS] = [spawn];
  room._find[FIND_SOURCES] = [s1, s2];
  room._find[FIND_MY_CREEPS] = [];
  const weights = brain.think(room);
  const tasks = blackboard.scan(room);
  const assignment = market.assign([], tasks, weights);
  const shortage = market.shortage(tasks, assignment);
  spawning.run(room, shortage, 0);
  ok(spawn._spawned && spawn._spawned.length === 1, '0 creep 时必须孵化种子 creep（防团灭死锁）');
  ok(tasks.some((x) => x.type === 'harvest'), 'harvest 任务被生成（source 待采）');
})();

// ============ SCENARIO 2: 4 creeps must NOT pile on 1 slot (saturation) ============
console.log('\n=== S2: 多 creep 不挤同一开采格（旧 bug: 4 harvester 挤 1 格）===');
(function () {
  reset();
  const room = mkRoom('W2N2', { rcl: 2, cap: 550, cur: 550 });
  const spawn = mkSpawn('sp2', 25, 25, 'W2N2', 550);
  const s1 = mkSource('s2src1', 10, 10, 'W2N2', 3000);
  const s2 = mkSource('s2src2', 40, 40, 'W2N2', 3000);
  room._find[FIND_MY_SPAWNS] = [spawn];
  room._find[FIND_SOURCES] = [s1, s2];
  const creeps = [];
  for (let i = 0; i < 6; i++) creeps.push(mkCreep('h' + i, [WORK, WORK, CARRY, MOVE], 25, 25, 'W2N2', 0));
  room._find[FIND_MY_CREEPS] = creeps;
  const weights = brain.think(room);
  const tasks = blackboard.scan(room);
  const assignment = market.assign(creeps, tasks, weights);
  // count how many creeps assigned to each harvest slot
  const slotLoad = {};
  for (const cn in assignment) {
    const tk = assignment[cn];
    if (tk.type === 'harvest') slotLoad[tk.id] = (slotLoad[tk.id] || 0) + 1;
  }
  const maxPerSlot = Math.max(0, ...Object.values(slotLoad));
  ok(maxPerSlot <= 1, '每个开采格最多 1 个 creep（capacity=1 饱和生效），实际 max=' + maxPerSlot);
})();

// ============ SCENARIO 3: defend overrides everything when enemy present ============
console.log('\n=== S3: 有敌时防御压倒一切（战略权重 + 高 baseValue）===');
(function () {
  reset();
  const room = mkRoom('W3N3', { rcl: 3, cap: 800, cur: 800 });
  const spawn = mkSpawn('sp3', 25, 25, 'W3N3', 800);
  const s1 = mkSource('s3src1', 10, 10, 'W3N3', 3000);
  room._find[FIND_MY_SPAWNS] = [spawn];
  room._find[FIND_SOURCES] = [s1];
  const enemy = { id: 'enemy1', pos: new RoomPosition(20, 20, 'W3N3') };
  global._objs.enemy1 = enemy;
  room._find[FIND_HOSTILE_CREEPS] = [enemy];
  const fighter = mkCreep('f1', [TOUGH, ATTACK, MOVE], 22, 22, 'W3N3', 0);
  room._find[FIND_MY_CREEPS] = [fighter];
  const weights = brain.think(room);
  ok(weights.defend > 2, '有敌人时 defend 权重飙升 (实际=' + weights.defend.toFixed(2) + ')');
  const tasks = blackboard.scan(room);
  const assignment = market.assign([fighter], tasks, weights);
  ok(assignment.f1 && assignment.f1.type === 'defend', '战斗 creep 被分配去防御');
})();

// ============ SCENARIO 4: continuity prevents thrash ============
console.log('\n=== S4: 连续性防抖动（creep 不每 tick 改主意）===');
(function () {
  reset();
  const room = mkRoom('W4N4', { rcl: 2, cap: 550, cur: 550 });
  const sp4 = mkSpawn('sp4', 25, 25, 'W4N4', 550);
  const s1 = mkSource('s4src1', 10, 10, 'W4N4', 3000);
  room._find[FIND_MY_SPAWNS] = [sp4];
  room._find[FIND_SOURCES] = [s1];
  const c = mkCreep('w1', [WORK, CARRY, MOVE], 11, 11, 'W4N4', 0);
  room._find[FIND_MY_CREEPS] = [c];
  const weights = brain.think(room);
  const tasks = blackboard.scan(room);
  // first assign
  const a1 = market.assign([c], tasks, weights);
  const firstTask = c.memory.taskId;
  // second assign (same world) — should keep same task due to continuity bonus
  const a2 = market.assign([c], tasks, weights);
  ok(c.memory.taskId === firstTask, 'creep 保持上 tick 的任务（连续性奖励，防来回跑）');
})();

const r = t.report();
console.log('\n========================================');
console.log(r.fail === 0 ? `🎉 ALL ${r.pass} CHECKS PASSED` : `❌ ${r.fail} FAILED / ${r.pass} passed`);
process.exit(r.fail === 0 ? 0 : 1);
