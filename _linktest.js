'use strict';
/* _linktest.js —— link.control 回归测试（纯 mock，无 Game 依赖） */

global.STRUCTURE_LINK = 'link';
global.FIND_MY_STRUCTURES = 1;
global.FIND_SOURCES = 2;
global.RESOURCE_ENERGY = 'energy';
global.OK = 0;

function pos(x, y) {
  return {
    x, y,
    inRangeTo(tx, ty, range) { return Math.max(Math.abs(this.x - tx), Math.abs(this.y - ty)) <= range; },
  };
}
function store(energy, cap) {
  return {
    [RESOURCE_ENERGY]: energy,
    getCapacity() { return cap; },
  };
}
function link(x, y, energy, cap, cooldown) {
  const transfers = [];
  return {
    structureType: STRUCTURE_LINK,
    pos: pos(x, y),
    cooldown: cooldown || 0,
    store: store(energy, cap || 800),
    _transfers: transfers,
    transferEnergy(target) { transfers.push(target); return OK; },
  };
}
function makeRoom(opts) {
  const links = opts.links || [];
  const sources = opts.sources || [];
  return {
    name: 'E9N54',
    controller: { my: true, level: opts.rcl == null ? 5 : opts.rcl, pos: opts.ctrlPos || pos(25, 25) },
    storage: opts.storagePos ? { pos: opts.storagePos } : undefined,
    find(type) {
      if (type === FIND_MY_STRUCTURES) return links;
      if (type === FIND_SOURCES) return sources;
      return [];
    },
  };
}

const lc = require('./link.control.js');
let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name); } }

// 1. RCL<5 直接 return false
ok(lc.run(makeRoom({ rcl: 4, links: [link(10, 10, 800), link(25, 25, 0)] })) === false, 'RCL4 不操作 link');

// 2. 单 link 不瞬移
ok(lc.run(makeRoom({ links: [link(10, 10, 800)], sources: [{ pos: pos(10, 11) }] })) === false, '单 link 不瞬移');

// 3. source link 满 → 转给 controller link（最高优先）
{
  const srcL = link(10, 11, 800);            // 离 source(10,10) ≤2
  const ctrlL = link(25, 26, 0);             // 离 controller(25,25) ≤2
  const room = makeRoom({ links: [srcL, ctrlL], sources: [{ pos: pos(10, 10) }], ctrlPos: pos(25, 25) });
  const acted = lc.run(room);
  ok(acted === true && srcL._transfers.length === 1 && srcL._transfers[0] === ctrlL, 'source→controller 瞬移');
}

// 4. controller link 已满 → 退而转给 storage link
{
  const srcL = link(10, 11, 800);
  const ctrlL = link(25, 26, 800, 800);      // 满，无空位
  const stoL = link(30, 31, 0, 800);         // 离 storage(30,30) ≤2
  const room = makeRoom({ links: [srcL, ctrlL, stoL], sources: [{ pos: pos(10, 10) }], ctrlPos: pos(25, 25), storagePos: pos(30, 30) });
  lc.run(room);
  ok(srcL._transfers.length === 1 && srcL._transfers[0] === stoL, 'controller满→退storage');
}

// 5. 发送方能量不足阈值 → 不转
{
  const srcL = link(10, 11, 300);            // <400
  const ctrlL = link(25, 26, 0);
  const room = makeRoom({ links: [srcL, ctrlL], sources: [{ pos: pos(10, 10) }], ctrlPos: pos(25, 25) });
  ok(lc.run(room) === false && srcL._transfers.length === 0, '能量不足阈值不转');
}

// 6. 发送方 cooldown 中 → 不转
{
  const srcL = link(10, 11, 800, 800, 5);
  const ctrlL = link(25, 26, 0);
  const room = makeRoom({ links: [srcL, ctrlL], sources: [{ pos: pos(10, 10) }], ctrlPos: pos(25, 25) });
  ok(lc.run(room) === false, 'cooldown 中不转');
}

// 7. controller link 只收不发（即使它满了也不当 sender）
{
  const ctrlL = link(25, 26, 800);           // controller 旁但满
  const stoL = link(30, 31, 0);
  const room = makeRoom({ links: [ctrlL, stoL], sources: [], ctrlPos: pos(25, 25), storagePos: pos(30, 30) });
  ok(lc.run(room) === false && ctrlL._transfers.length === 0, 'controller link 不外发');
}

console.log('\n_linktest:', pass, 'pass /', fail, 'fail');
process.exit(fail === 0 ? 0 : 1);
