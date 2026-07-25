'use strict';
// L4 GOAP planner + L5 adaptive 专项智能测试
global.FIND_HOSTILE_CREEPS = 1; global.FIND_MY_CONSTRUCTION_SITES = 2; global.FIND_MY_SPAWNS = 3; global.FIND_MY_CREEPS = 10;
global.ATTACK = 'attack'; global.RANGED_ATTACK = 'ranged'; global.WORK = 'work'; global.RESOURCE_ENERGY = 'energy';
global.STRUCTURE_SPAWN='spawn'; global.STRUCTURE_EXTENSION='extension'; global.STRUCTURE_TOWER='tower'; global.STRUCTURE_STORAGE='storage'; global.STRUCTURE_LINK='link'; global.STRUCTURE_CONTAINER='container';
global.Memory = {}; global.Game = { time: 1000 };

const path = require('path'); const Module = require('module');
const orig = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { if (['planner', 'adaptive'].includes(req)) return path.join(__dirname, req + '.js'); return orig.call(this, req, ...a); };
const planner = require('./planner');
const adaptive = require('./adaptive');

let pass = 0, fail = 0;
function ok(c, m) { if (c) { console.log('  PASS ' + m); pass++; } else { console.log('  FAIL ' + m); fail++; } }

function mkRoom(o) {
  const sites = (o.sites || []).map(s => ({ progress: s.p, progressTotal: s.t, structureType: s.type || 'road' }));
  return {
    name: o.name || 'E9N54',
    controller: { level: o.rcl || 2, progress: o.prog || 0, ticksToDowngrade: o.ttd, my: true },
    energyAvailable: o.cur != null ? o.cur : 300,
    energyCapacityAvailable: o.cap != null ? o.cap : 550,
    storage: o.stored ? { store: { energy: o.stored } } : null,
    _creeps: o.creeps != null ? o.creeps : 10,
    _sites: sites,
    find(t) { if (t === FIND_MY_CONSTRUCTION_SITES) return this._sites; if (t === FIND_MY_CREEPS) return new Array(this._creeps).fill({}); return []; },
  };
}

console.log('\n=== GOAP 主目标选择（不同局面选对计划）===');
// 1. 缺人/缺能 → survive
let r = mkRoom({ creeps: 1, cur: 50, cap: 550 });
let p = planner.plan(r, Memory.brain = {});
ok(p.goalId === 'survive', `creep=1 → 选 survive (实际=${p.goalId})`);
ok(p.bias.upgrade < 0.5 && p.bias.harvest > 1.5, '生存模式压制升级、强化采集');

// 2. 有大工地 → infra
r = mkRoom({ creeps: 10, cur: 500, cap: 550, sites: [{ p: 0, t: 3000 }] });
p = planner.plan(r, Memory.brain = {});
ok(p.goalId === 'infra', `有大工地 → 选 infra (实际=${p.goalId})`);
ok(p.bias.build > 1.5, '基建模式强化建造');

// 3. 无工地+能量富余 → rcl_push
r = mkRoom({ creeps: 10, cur: 550, cap: 550, sites: [] });
p = planner.plan(r, Memory.brain = {});
ok(p.goalId === 'rcl_push', `无工地能量满 → 选 rcl_push (实际=${p.goalId})`);
ok(p.bias.upgrade > 1.5, '冲级模式强化升级');

// 4. 工地快完工(剩余小) → 不再 infra，转 rcl_push
r = mkRoom({ creeps: 10, cur: 500, cap: 550, sites: [{ p: 2900, t: 3000 }] }); // 剩100<300
p = planner.plan(r, Memory.brain = {});
ok(p.goalId === 'rcl_push', `工地快完工(剩100) → 平滑转 rcl_push (实际=${p.goalId})`);

// 5. 快速发展：RCL6 只有 lab/terminal 等可选产业工地时，不阻塞冲 RCL7
Memory.strategy = { rapidGrowth: true };
r = mkRoom({ rcl:6, creeps:10, cur:1300, cap:1300, stored:40000, sites:[{p:0,t:100000,type:'terminal'},{p:0,t:50000,type:'lab'}] });
p = planner.plan(r, Memory.brain = {});
ok(p.goalId === 'rcl_push', `rapidGrowth下可选产业工地不阻塞冲级 (实际=${p.goalId})`);
// 关键塔工地仍必须先完成
r = mkRoom({ rcl:6, creeps:10, cur:1300, cap:1300, stored:40000, sites:[{p:0,t:5000,type:'tower'}] });
p = planner.plan(r, Memory.brain = {});
ok(p.goalId === 'infra', `rapidGrowth下tower仍是关键基建 (实际=${p.goalId})`);

console.log('\n=== L5 自适应：乏力检测（冲级卡住→疏通经济）===');
// 模拟：冲级目标但 progress 一直不涨 → staleness 累积 → stalenessBoost 触发
const bm = { plan: { goalId: 'rcl_push' }, learn: {} };
Game.time = 2000;
let rr = mkRoom({ rcl: 2, prog: 5000, creeps: 10 });
adaptive.observe(rr, bm); // 首次建基线
// 多轮评估，progress 不涨（卡住）
for (let i = 0; i < 6; i++) { Game.time += 30; adaptive.observe(mkRoom({ rcl: 2, prog: 5000, creeps: 10 }), bm); }
const boost = adaptive.stalenessBoost(bm, 'E9N54');
ok((bm.learn.rooms.E9N54.staleness || 0) >= 3, `冲级progress不涨 → staleness累积 (实际=${bm.learn.rooms.E9N54.staleness})`);
ok(boost > 0, `乏力 → stalenessBoost触发疏通经济 (实际=${Math.round(boost * 100) / 100})`);
ok(bm.playbook && bm.playbook.rcl_push, 'playbook记录了rcl_push目标的历史收益');

// 反向：progress 正常涨 → 不乏力
const bm2 = { plan: { goalId: 'rcl_push' }, learn: {} };
Game.time = 5000; adaptive.observe(mkRoom({ rcl: 2, prog: 0, creeps: 10 }), bm2);
for (let i = 0; i < 4; i++) { Game.time += 30; adaptive.observe(mkRoom({ rcl: 2, prog: 1000 * (i + 1), creeps: 10 }), bm2); }
ok(((bm2.learn.rooms.E9N54 && bm2.learn.rooms.E9N54.staleness) || 0) === 0, '进度正常涨 → 不触发乏力');
ok(bm2.playbook.rcl_push.avgGain > 0, 'playbook记录正收益（学到“冲级有效”）');

console.log('\n========================================');
console.log(fail === 0 ? `🎉 ALL ${pass} CHECKS PASSED` : `❌ ${fail} FAILED / ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
