'use strict';
/*
 * _backlogtest.js — 回归：能量积压时把过剩能量转成 RCL 进度，而非堆 24 个 hauler 空转。
 *
 * 复现 2026-06-23 自动驾驶发现的线上 E9N52 低效（非死锁）：
 *   RCL2、5 container 囤 ~6849 能量、24 haul / 仅 6 upgrade、升级速率仅 6.67/tick、
 *   ETA RCL3 ~3000 tick。根因：
 *     (1) haul capacity=ceil(amount/200) 随 container 囤量膨胀 → 吸走 24 creep 去搬一个
 *         本质是"消费端不足"造成的 backlog；
 *     (2) upgrade upCap 只看 harvestRate(=6)，无视巨大 container 积压 → 升级产能上不去。
 *   修复：haul/源 封顶 2；upgrade upCap 随 container+storage backlog 提额(每1500+1，封顶12)。
 */
const path = require('path');
const Module = require('module');
const origResolve = Module._resolveFilename;
const LOCAL = ['source.scheduler', 'worldmodel'];
Module._resolveFilename = function (r, ...a) {
  if (LOCAL.includes(r)) return path.join(__dirname, r + '.js');
  return origResolve.call(this, r, ...a);
};

Object.assign(global, {
  WORK: 'work', CARRY: 'carry', MOVE: 'move', RESOURCE_ENERGY: 'energy',
  FIND_SOURCES: 1, FIND_DROPPED_RESOURCES: 7, FIND_STRUCTURES: 5, FIND_TOMBSTONES: 12,
  FIND_MY_STRUCTURES: 4, FIND_MY_CONSTRUCTION_SITES: 6, FIND_HOSTILE_CREEPS: 9, FIND_MY_CREEPS: 10,
  FIND_MY_SPAWNS: 3,
  STRUCTURE_CONTAINER: 'container', STRUCTURE_STORAGE: 'storage', STRUCTURE_SPAWN: 'spawn',
  STRUCTURE_EXTENSION: 'extension', STRUCTURE_TOWER: 'tower', STRUCTURE_WALL: 'constructedWall',
  STRUCTURE_RAMPART: 'rampart', STRUCTURE_ROAD: 'road',
});
global.Resource = class Resource {};
global.Game = { time: 1000, cpu: { bucket: 10000 }, getObjectById: (id) => global._objs[id] };
global.Memory = { brain: {} };
global._objs = {};

const blackboard = require('./blackboard.js');

let pass = 0, fail = 0;
function ok(c, m, actual) {
  if (c) { console.log('  PASS ' + m + (actual !== undefined ? ' (实际=' + actual + ')' : '')); pass++; }
  else { console.log('  FAIL ' + m + (actual !== undefined ? ' (实际=' + actual + ')' : '')); fail++; }
}

// 构造线上现状：2 source(已采空), 5 container 囤 [1217,2000,32,1600,2000], cap=550
// harvestRate=20（2 source 各满采）→ 让 economyFlow 算出基线 upCap=round(20*0.6/2)=6
function mkCreeps(n) {
  const arr = [];
  for (let i = 0; i < n; i++) arr.push({
    body: [WORK, WORK, WORK, WORK, WORK, CARRY, MOVE].map((t) => ({ type: t })),
    memory: { taskType: 'harvest' },
  });
  return arr;
}
function mkRoom(containerEnergies, storageEnergy) {
  const sources = [
    { id: 's1', energy: 0, energyCapacity: 3000, pos: { x: 15, y: 32 } },
    { id: 's2', energy: 0, energyCapacity: 3000, pos: { x: 24, y: 36 } },
  ];
  global._objs.s1 = sources[0]; global._objs.s2 = sources[1];
  const harvCreeps = mkCreeps(4); // 4 个重WORK矿工 → harvestCapacity 吃满 source ceil
  const containers = containerEnergies.map((e, i) => ({
    id: 'c' + i, structureType: STRUCTURE_CONTAINER,
    pos: { x: 20 + i, y: 30 }, store: { [RESOURCE_ENERGY]: e, getFreeCapacity: () => 2000 - e, getCapacity: () => 2000 },
  }));
  const ctrl = { id: 'ctrl', my: true, level: 2, progress: 25000, progressTotal: 45000,
    ticksToDowngrade: 20000, pos: { x: 30, y: 30 } };
  const room = {
    name: 'E9N52', memory: { slots: { done: true, all: [
      { x: 14, y: 32, sourceId: 's1', dist: 8 }, { x: 16, y: 32, sourceId: 's1', dist: 9 },
      { x: 23, y: 36, sourceId: 's2', dist: 7 }, { x: 25, y: 36, sourceId: 's2', dist: 8 },
    ] } },
    controller: ctrl,
    energyAvailable: 550, energyCapacityAvailable: 550,
    storage: storageEnergy ? { store: { [RESOURCE_ENERGY]: storageEnergy } } : null,
    getTerrain: () => ({ get: () => 0 }),
    find(type, opts) {
      let arr = [];
      if (type === FIND_SOURCES) arr = sources;
      else if (type === FIND_STRUCTURES) arr = containers;
      else if (type === FIND_MY_STRUCTURES) arr = [];
      else if (type === FIND_MY_SPAWNS) arr = [{ pos: { x: 25, y: 25 } }];
      else if (type === FIND_MY_CREEPS) arr = harvCreeps;
      else arr = [];
      if (opts && opts.filter) arr = arr.filter(opts.filter);
      return arr;
    },
  };
  return room;
}

console.log('=== 场景1：container 大量囤积 → upgrade 容量随 backlog 提额（把过剩能量烧成 RCL）===');
{
  const room = mkRoom([1217, 2000, 32, 1600, 2000], 0); // 总 backlog 6849
  const tasks = blackboard.scan(room);
  const upTask = tasks.find((t) => t.type === 'upgrade');
  ok(!!upTask, 'upgrade 任务存在');
  // backlog 6849 → 提额 floor(6849/1500)=4，基础 upCap=round(20*0.6/2)=6 → 6+4=10
  ok(upTask.capacity >= 9, 'backlog 6849 时 upgrade 容量显著提升(>=9)，把积压能量转 RCL', upTask.capacity);
}

console.log('\n=== 场景2：haul 容量每源封顶 2（不再 24 个 hauler 抢搬一堆积压）===');
{
  const room = mkRoom([1217, 2000, 32, 1600, 2000], 0);
  const tasks = blackboard.scan(room);
  const haulTasks = tasks.filter((t) => t.type === 'haul');
  const totalHaulCap = haulTasks.reduce((s, t) => s + t.capacity, 0);
  ok(haulTasks.every((t) => t.capacity <= 2), '每个 haul 任务容量 <= 2', haulTasks.map((t) => t.capacity).join(','));
  // 5 个 container(>50能量的) 各最多 2 → <=10，远少于旧公式 ~36
  ok(totalHaulCap <= 10, 'haul 总容量受控(<=10)，不再吸走 24 个 creep', totalHaulCap);
}

console.log('\n=== 场景3：能量不积压时 upgrade 容量回落到 harvestRate 决定的基线（不滥发）===');
{
  const room = mkRoom([0, 0, 0, 0, 0], 0); // 无 backlog
  const tasks = blackboard.scan(room);
  const upTask = tasks.find((t) => t.type === 'upgrade');
  ok(upTask.capacity <= 8, '无积压时 upgrade 容量不超基线(<=8)，不无脑滥发 upgrader', upTask.capacity);
  ok(upTask.capacity >= 1, '无积压时仍保至少 1 个 upgrader(防降级)', upTask.capacity);
}

console.log('');
if (fail === 0) { console.log('🎉 BACKLOG 回归全部通过 (' + pass + ' checks)'); process.exit(0); }
else { console.log('❌ ' + fail + ' 个检查失败'); process.exit(1); }
