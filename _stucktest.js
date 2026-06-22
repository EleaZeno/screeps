// 专项回归测试：验证“静止采矿不再被误判焊死→suicide”的核心修复
'use strict';
const Module = require('module');
const path = require('path');
const fs = require('fs');
const localMods = new Set(fs.readdirSync(__dirname).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3)));
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (localMods.has(request)) return path.join(__dirname, request + '.js');
  return origResolve.call(this, request, ...args);
};

Object.assign(global, {
  WORK:'work', CARRY:'carry', MOVE:'move', RESOURCE_ENERGY:'energy',
  OK:0, ERR_NOT_ENOUGH_ENERGY:-6, ERR_NOT_IN_RANGE:-9, ERR_BUSY:-4, ERR_NOT_ENOUGH_RESOURCES:-6,
  FIND_SOURCES:1, FIND_SOURCES_ACTIVE:2, FIND_MY_SPAWNS:3, FIND_MY_STRUCTURES:4, FIND_STRUCTURES:5,
  FIND_MY_CONSTRUCTION_SITES:6, FIND_DROPPED_RESOURCES:7, FIND_CONSTRUCTION_SITES:8,
  FIND_HOSTILE_CREEPS:9,
  STRUCTURE_SPAWN:'spawn', STRUCTURE_EXTENSION:'extension', STRUCTURE_TOWER:'tower',
  STRUCTURE_STORAGE:'storage', STRUCTURE_CONTAINER:'container', STRUCTURE_WALL:'wall', STRUCTURE_RAMPART:'rampart',
  TERRAIN_MASK_WALL:1, LOOK_CREEPS:'creep',
  TOP:1, TOP_RIGHT:2, RIGHT:3, BOTTOM_RIGHT:4, BOTTOM:5, BOTTOM_LEFT:6, LEFT:7, TOP_LEFT:8,
});
global.RoomPosition = function (x, y, roomName) { this.x = x; this.y = y; this.roomName = roomName; };

const utils = require('utils');
const guardian = require('colony.guardian');

let fail = 0;
function assert(cond, msg) { if (!cond) { console.log('❌ ' + msg); fail++; } else { console.log('✅ ' + msg); } }

// ---- 测试1：静止采矿的 harvester，_stk 必须始终为 0（绝不被 guardian 杀）----
(function () {
  const source = { id:'s1', energy:3000, pos:{ x:10,y:10 } };
  const room = {
    name:'W1N1',
    find:(t)=> t===FIND_MY_SPAWNS ? [{ pos:{ findInRange:()=>[] } }] : [],
    controller:{ ticksToDowngrade: 99999 },
    energyAvailable:300, energyCapacityAvailable:550,
  };
  // creep 紧挨 source，每 tick 调 harvester 风格的 work('harvest')
  const creep = {
    name:'H1', room, memory:{ role:'harvester' }, ticksToLive: 800,
    store:{ [RESOURCE_ENERGY]:0, getFreeCapacity:()=>50 },
    pos:{ x:11, y:10,
      findInRange:(t)=> t===FIND_MY_SPAWNS ? [] : (t===FIND_SOURCES ? [source] : []),
      isNearTo:()=>true,
    },
    harvest:()=>OK,
    suicide:()=>{ creep._suicided = true; },
  };
  global.Game = { time: 1000, creeps:{ H1: creep }, getObjectById:()=>source,
    cpu:{ bucket:10000, getUsed:()=>1 } };
  global.Memory = { guardian:{} };

  let everKilled = false;
  for (let t=0;t<200;t++){
    global.Game.time = 1000 + t;
    // 模拟 role：原地采矿用 utils.work
    utils.work(creep, 'harvest', source);
    // 然后 guardian 跑兜底检查
    guardian._killHardStuck(room);
    if (creep._suicided) everKilled = true;
  }
  assert(!everKilled, '静止采矿 200 tick：harvester 绝不被 guardian 误杀 (suicide)');
  assert((creep.memory._stk||0) === 0, `静止采矿 _stk 始终为 0 (实际=${creep.memory._stk||0})`);
})();

// ---- 测试2：真正焊死在空地的 creep（从不工作、从不移动）才会被杀 ----
(function () {
  const room = { name:'W1N1', find:()=>[], controller:{ ticksToDowngrade:99999 } };
  const creep = {
    name:'STUCK', room, memory:{ role:'hauler', _stk: 200, _busy: -9999 }, ticksToLive: 800,
    pos:{ x:25, y:25, findInRange:()=>[] }, // 空地：附近无 spawn/source
    suicide:()=>{ creep._suicided = true; },
  };
  global.Game = { time: 5000, creeps:{ STUCK: creep } };
  global.Memory = { guardian:{} };
  guardian._killHardStuck(room);
  assert(creep._suicided === true, '空地真焊死(_stk=200,长期没干活) → 正确被回收');
})();

// ---- 测试3：work() 成功即清零 _stk ----
(function () {
  const creep = { memory:{ _stk: 50, _busy: 0 }, harvest:()=>OK };
  global.Game = { time: 7000 };
  utils.work(creep, 'harvest', {});
  assert((creep.memory._stk||0) === 0, 'work()成功 → _stk 清零');
  assert(creep.memory._busy === 7000, 'work()成功 → _busy 标记为当前 tick');
})();

console.log(fail === 0 ? '\n🎉 STUCK-KILL 回归测试全部通过' : `\n💥 ${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
