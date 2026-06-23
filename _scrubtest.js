'use strict';
/*
 * _scrubtest.js — 回归：Memory 自清只删 __ 调试残留键，绝不碰正式键。
 * 锁定 brain.loop.js 新增的 _pruneScratch 行为（防止它误删 creeps/brain/intel 等）。
 */
const path = require('path');
const Module = require('module');

// —— 最小 Screeps 运行时桩 —— 让 brain.loop.js 能跑一 tick 而不崩 ——
global.Game = {
  time: 100, // 命中 % 100 === 0，触发自清
  cpu: { getUsed: () => 1, bucket: 10000, limit: 20 },
  rooms: {},      // 无房间 -> 跳过房间循环，只测 Memory 自清那段
  creeps: {},
};
global.Memory = {
  creeps: { alive1: { role: 'hauler' } },
  brain: { weights: {}, cpu: { ema: 5 } },
  intel: { tasks: {} },
  config: { dashboardText: true },
  guardian: { mode: 'normal' },
  rooms: { E9N52: { _lastRcl: 2 } },
  stats: {},
  // —— 调试残留（应被清掉）——
  __probe: 1, __autopilot: { x: 1 }, __diag2: { y: 2 }, __prog: { z: 3 },
  __v7: true, __sos: 'help', __snap: {}, __f: 0,
};
// brain.loop.js 里 Game.creeps 没有 alive1 -> 死 creep 清理会删 Memory.creeps.alive1，
// 这与本测试无关（我们只关心 __ 键），但为避免误判，先把 alive1 放进 Game.creeps。
global.Game.creeps.alive1 = { name: 'alive1', memory: global.Memory.creeps.alive1 };

// require 解析：brain.loop.js 里 require('brain') 等裸模块名，需指到本目录同名文件
const ROOT = __dirname;
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, opts) {
  if (!request.startsWith('.') && !request.startsWith('/') && !path.isAbsolute(request)) {
    const local = path.join(ROOT, request + '.js');
    try { return origResolve.call(this, local, parent, isMain, opts); } catch (e) { /* 落回默认 */ }
  }
  return origResolve.call(this, request, parent, isMain, opts);
};

const beforeScratch = Object.keys(global.Memory).filter(k => k.startsWith('__')).length;
const loop = require('./brain.loop.js').loop;
loop();

let pass = 0, fail = 0;
function chk(name, cond) { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name); } }

const afterScratch = Object.keys(global.Memory).filter(k => k.startsWith('__')).length;
chk(`自清前有 ${beforeScratch} 个 __ 键`, beforeScratch === 8);
chk('自清后 __ 键全部清零', afterScratch === 0);
chk('正式键 creeps 保留', !!global.Memory.creeps);
chk('正式键 brain 保留(含权重/cpu)', global.Memory.brain && global.Memory.brain.cpu);
chk('正式键 intel 保留', !!global.Memory.intel);
chk('正式键 config 保留', !!global.Memory.config);
chk('正式键 guardian 保留', !!global.Memory.guardian);
chk('正式键 rooms 保留(含 E9N52)', global.Memory.rooms && global.Memory.rooms.E9N52);

// 非整百 tick 不应触发自清（避免每 tick 白跑）
global.Game.time = 137;
global.Memory.__late = 99;
loop();
chk('非整百 tick 不自清(__late 仍在)', global.Memory.__late === 99);
global.Game.time = 200;
loop();
chk('整百 tick 再次自清(__late 被清)', global.Memory.__late === undefined);

console.log(`\n${fail === 0 ? '🎉 SCRUB 回归全部通过' : '❌ SCRUB 回归失败'} (${pass} pass, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
