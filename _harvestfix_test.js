'use strict';
/* _harvestfix_test.js — 验证 2026-07-01 静态采矿倒货彻底修复
 * 纯 mock。覆盖：
 *   1) 9W9C 通用矿工(450容量)未满也会在快溢出时倒货（旧 bug：永不倒）
 *   2) _harvestSink 优先级：source link > 脚下 container > 相邻 container
 *   3) link 的 getFreeCapacity 返回 null 时仍能判空位（用 getCapacity 兜底）
 *   4) 无 sink 且满仓 → drop；未满且无 sink → 不 drop 继续采
 */
global.WORK = 'work'; global.CARRY = 'carry'; global.MOVE = 'move';
global.STRUCTURE_LINK = 'link'; global.STRUCTURE_CONTAINER = 'container'; global.STRUCTURE_CONTROLLER = 'controller';
global.FIND_MY_STRUCTURES = 1; global.FIND_STRUCTURES = 2;
global.LOOK_STRUCTURES = 'structure';
global.RESOURCE_ENERGY = 'energy';
global.ERR_NOT_IN_RANGE = -9; global.OK = 0;

const path = require('path');
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  if (req === 'utils') return path.resolve('utils.js');
  if (req === 'worldmodel') return path.resolve('worldmodel.js');
  return origResolve.call(this, req, ...rest);
};

let pass = 0, fail = 0;
function ok(c, n) { if (c) { pass++; console.log('  PASS', n); } else { fail++; console.log('  FAIL', n); } }

// --- mock store ---
function store(energy, cap) {
  return {
    energy, [RESOURCE_ENERGY]: energy,
    getFreeCapacity() { return cap - energy; },
    getCapacity() { return cap; },
  };
}
// link 的 store：getFreeCapacity 返回 null（模拟线上偶发）
function linkStore(energy, cap) {
  return {
    energy, [RESOURCE_ENERGY]: energy,
    getFreeCapacity() { return null; },   // ⚠️ 故意返回 null
    getCapacity() { return cap; },
  };
}
function pos(x, y, structsInRange, structsHere) {
  return {
    x, y,
    isNearTo() { return true; },
    lookFor(t) { return t === LOOK_STRUCTURES ? (structsHere || []) : []; },
    findInRange(type, range, opts) {
      const pool = (structsInRange || []).filter((s) => {
        const d = Math.max(Math.abs(s.pos.x - x), Math.abs(s.pos.y - y));
        if (d > range) return false;
        if (type === FIND_MY_STRUCTURES && !s.my) return false;
        return opts && opts.filter ? opts.filter(s) : true;
      });
      return pool;
    },
  };
}
function link(x, y, energy, cap) { return { structureType: STRUCTURE_LINK, my: true, pos: { x, y }, store: linkStore(energy, cap || 800) }; }
function container(x, y, energy, cap) { return { structureType: STRUCTURE_CONTAINER, my: false, pos: { x, y }, store: store(energy, cap || 2000) }; }

// body: 9W9C → work9 carry9 cap450
function body(nw, nc) {
  const b = [];
  for (let i = 0; i < nw; i++) b.push({ type: WORK });
  for (let i = 0; i < nc; i++) b.push({ type: CARRY });
  return b;
}
function miner(opts) {
  const actions = { transfer: [], harvest: 0, drop: 0, move: 0 };
  const c = {
    name: opts.name || 'M1',
    body: body(opts.W, opts.C),
    store: store(opts.energy, opts.C * 50),
    memory: { slot: opts.slot || { x: opts.x, y: opts.y }, taskType: 'harvest' },
    drop() { actions.drop++; return OK; },
    _actions: actions,
  };
  c.pos = pos(opts.x, opts.y, opts.inRange, opts.here);
  return c;
}

// mock utils.work：记录动作，返回 OK
const utilsMock = {
  work(creep, verb, target) {
    if (verb === 'transfer') creep._actions.transfer.push(target);
    if (verb === 'harvest') creep._actions.harvest++;
    return OK;
  },
  moveTo(creep) { creep._actions.move++; },
};
// 用 mock utils 覆盖真 utils（executor 顶部 require('utils')）
require.cache[path.resolve('utils.js')] = { exports: utilsMock, loaded: true, id: path.resolve('utils.js') };

const executor = require('./executor.js');
const harvest = executor._handlers.harvest;

// source mock：energy 充足
const source = { id: 'src1', energy: 3000, pos: { x: 12, y: 36 } };

// 测试1：9W9C 矿工，身上 420/450（free=30 < harvestPerTick=18? 不，free30>18 不倒）
//   先验证 free 充足时不倒
{
  const cont = container(11, 35, 0);
  const m = miner({ W: 9, C: 9, energy: 360, x: 11, y: 35, here: [cont], inRange: [cont] }); // free=90, perTick=18
  harvest(m, source, utilsMock);
  ok(m._actions.transfer.length === 0 && m._actions.harvest === 1, '9W9C free充足(90>18)→继续采不倒');
}

// 测试2：9W9C 矿工快溢出（free=10 <= perTick=18）→ 倒货
{
  const cont = container(11, 35, 0);
  const m = miner({ W: 9, C: 9, energy: 440, x: 11, y: 35, here: [cont], inRange: [cont] }); // free=10
  harvest(m, source, utilsMock);
  ok(m._actions.transfer.length === 1, '9W9C 快溢出(free10<=18)→倒货');
  ok(m._actions.transfer[0] === cont, '倒进脚下 container');
}

// 测试3：source link（相邻，getFreeCapacity返回null）优先于脚下 container
{
  const cont = container(11, 35, 0);
  const srcL = link(10, 36, 0);  // 相邻(11,35)，空，但 getFreeCapacity 返回 null
  const m = miner({ W: 9, C: 9, energy: 440, x: 11, y: 35, here: [cont], inRange: [cont, srcL] });
  harvest(m, source, utilsMock);
  ok(m._actions.transfer.length === 1 && m._actions.transfer[0] === srcL, 'source link 优先于 container（且 null free 也判对）');
}

// 测试4：source link 满 → 退回脚下 container
{
  const cont = container(11, 35, 0);
  const srcL = link(10, 36, 800, 800);  // 满
  const m = miner({ W: 9, C: 9, energy: 440, x: 11, y: 35, here: [cont], inRange: [cont, srcL] });
  harvest(m, source, utilsMock);
  ok(m._actions.transfer.length === 1 && m._actions.transfer[0] === cont, 'source link满→退脚下container');
}

// 测试5：无 sink 且 100% 满 → drop
{
  const m = miner({ W: 9, C: 9, energy: 450, x: 11, y: 35, here: [], inRange: [] }); // free=0
  harvest(m, source, utilsMock);
  ok(m._actions.drop === 1 && m._actions.transfer.length === 0, '无sink且满仓→drop');
}

// 测试6：无 sink 但未满 → 不 drop，继续采
{
  const m = miner({ W: 9, C: 9, energy: 440, x: 11, y: 35, here: [], inRange: [] }); // free=10
  harvest(m, source, utilsMock);
  ok(m._actions.drop === 0 && m._actions.harvest === 1, '无sink未满→不drop继续采');
}

// 测试7：相邻 container 兜底（脚下无，相邻有）
{
  const adjCont = container(12, 35, 0); // 相邻 (11,35)
  const m = miner({ W: 9, C: 9, energy: 440, x: 11, y: 35, here: [], inRange: [adjCont] });
  harvest(m, source, utilsMock);
  ok(m._actions.transfer.length === 1 && m._actions.transfer[0] === adjCont, '脚下无→相邻container兜底');
}

console.log('\n_harvestfix_test:', pass, 'pass /', fail, 'fail');
process.exit(fail === 0 ? 0 : 1);
