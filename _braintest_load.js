'use strict';
// 验证"装满再走"状态机：creep 不应半载就跑去干活，应装满(或取不到)才走
global.RESOURCE_ENERGY = 'energy';
global.ERR_NOT_IN_RANGE = -9;
global.ERR_NOT_ENOUGH_RESOURCES = -6;
global.OK = 0;
const Module = require('module');
const origReq = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'utils') return { gatherEnergy(){}, work(){return OK;}, moveTo(){}, findEnergyDropOff(){return null;}, markBusy(){} };
  if (id === 'worldmodel') return { parts(c){return c._parts;} };
  return origReq.apply(this, arguments);
};
const ex = require('./executor.js');
let pass = 0, fail = 0;
function chk(name, cond) { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌', name); } }

// 模拟一个 upgrader：容量100，逐tick取能
function mkCreep(carry, cap) {
  return {
    memory: {}, _parts: { work: 1, carry: 2, move: 1 },
    store: { [RESOURCE_ENERGY]: carry, getFreeCapacity() { return cap - carry; }, getCapacity() { return cap; } },
  };
}

console.log('=装满再走状态机=');
// 1. 空载 → working 应为 false（去取能，不去干活）
let c = mkCreep(0, 100);
chk('空载: 不该working(该去取能)', ex._loaded(c) === false);

// 2. 半载(50/100) 且之前在取能 → 仍 working=false（继续取，不半载就跑）
c = mkCreep(50, 100); c.memory.working = false;
chk('半载且取能中: 仍不working(继续装,不半载跑)', ex._loaded(c) === false);

// 3. 满载(100/100) → working 切 true（装满了,出发干活）
c = mkCreep(100, 100); c.memory.working = false;
chk('满载: 切working=true(装满再走)', ex._loaded(c) === true);

// 4. 干活中且还有能量(50/100) → 保持 working=true（别没用完就回去取）
c = mkCreep(50, 100); c.memory.working = true;
chk('干活中还有能量: 保持working(用完再取)', ex._loaded(c) === true);

// 5. 干活中用完(0) → 切回 working=false（去补能）
c = mkCreep(0, 100); c.memory.working = true;
chk('干活用完: 切回不working(去补能)', ex._loaded(c) === false);

console.log(`\n${fail === 0 ? '🎉 装载状态机 ALL ' + pass + ' PASSED' : '⚠️ ' + fail + ' FAILED'}`);
process.exit(fail === 0 ? 0 : 1);
