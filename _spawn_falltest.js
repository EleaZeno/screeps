'use strict';
/*
 * _spawn_falltest.js — 回归测试：haul/fill 被世界模型否决后，spawning 必须回落到
 * 真实的 upgrade 缺口，而不是直接 return（否则能量满仓溢出、spawn 空转、卡级）。
 *
 * 复现 2026-06-23 自动驾驶发现的线上 bug：
 *   E9N52 RCL2、能量 550/550(100%)、spawn idle、仅 1 upgrader。
 *   根因：haul 任务 capacity 随 container 囤量膨胀(达84)，霸占 shortage 排名，
 *         worldmodel 判定 haulHave>=haulNeed 否决造 Hauler → 旧代码直接 return，
 *         upgrade 缺口(gap=200)永远得不到孵化。
 */

// ---- 桩：Screeps 常量 ----
global.WORK = 'work'; global.CARRY = 'carry'; global.MOVE = 'move';
global.ATTACK = 'attack'; global.TOUGH = 'tough';
global.FIND_MY_SPAWNS = 'spawns'; global.FIND_SOURCES = 'sources'; global.FIND_MY_CREEPS = 'creeps';
global.RESOURCE_ENERGY = 'energy';
global.Game = { time: 1000, rooms: {} };

// ---- 桩：worldmodel（haul 已足，不缺采集）----
// spawning.js 内部调 require('worldmodel')（裸名）。游戏里按模块名解析，
// 本地用 Module._resolveFilename 覆盖将裸名映射到同目录文件，再注入桩。
const path = require('path');
const Module = require('module');
const origResolve = Module._resolveFilename;
const LOCAL = ['worldmodel', 'utils', 'source.scheduler', 'blackboard', 'market', 'config'];
Module._resolveFilename = function (r, ...a) {
  if (LOCAL.includes(r)) return path.join(__dirname, r + '.js');
  return origResolve.call(this, r, ...a);
};
const wmPath = path.join(__dirname, 'worldmodel.js');
require.cache[wmPath] = {
  id: wmPath, filename: wmPath, loaded: true, exports: {
    economyFlow() {
      // 能量产出充足、运力已足、源头不饿 —— 正是线上 E9N52 的状态
      return { harvestRate: 20, harvestCapacity: 32, harvestStarved: false, srcFill: 0.83, haulHave: 2, haulNeed: 2 };
    },
  },
};

const spawning = require('./spawning.js');

let passed = 0, failed = 0;
function check(cond, msg, actual) {
  if (cond) { console.log('  PASS ' + msg + (actual !== undefined ? ' (实际=' + actual + ')' : '')); passed++; }
  else { console.log('  FAIL ' + msg + (actual !== undefined ? ' (实际=' + actual + ')' : '')); failed++; }
}

// ---- 桩房间：能量满仓 ----
function mkRoom() {
  let spawned = null;
  const spawn = {
    spawning: null,
    spawnCreep(body, name) { spawned = { body: body.slice(), name }; return 0; },
  };
  const room = {
    energyAvailable: 550,
    energyCapacityAvailable: 550,
    find(type) { return type === FIND_MY_SPAWNS ? [spawn] : []; },
    get _spawned() { return spawned; },
  };
  return room;
}

console.log('=== 场景1：haul 缺口最大但被否决 + 存在 upgrade 缺口 → 必须造 Upgrader（不得空转）===');
{
  const room = mkRoom();
  // shortage：haul 加权最大(被否决)，upgrade 是真实剩余缺口
  const shortage = { haul: 6900, fill: 200, upgrade: 200, repair: 60 };
  spawning.run(room, shortage, 7);
  const sp = room._spawned;
  check(!!sp, 'spawn 不应空转（必须孵化一个 creep）', sp ? sp.name : 'idle');
  if (sp) {
    check(/^Upgrader_/.test(sp.name), '回落到 upgrade → 造 Upgrader', sp.name);
    check(sp.body.includes(WORK) && sp.body.includes(CARRY), 'Upgrader 是工人体(含WORK+CARRY)', sp.body.join(','));
  }
}

console.log('\n=== 场景2：haul 被否决 且无任何非搬运缺口 → 不造（保留原"运力已足不浪费"语义）===');
{
  const room = mkRoom();
  const shortage = { haul: 6900, fill: 200 }; // 只有搬运类缺口
  spawning.run(room, shortage, 7);
  check(!room._spawned, '无真实非搬运缺口 → 正确地不造多余 Hauler', room._spawned ? room._spawned.name : 'idle(正确)');
}

console.log('\n=== 场景3：_bestNonHaul 正确挑出加权最大的非搬运类型 ===');
{
  check(spawning._bestNonHaul({ haul: 9999, fill: 9999, upgrade: 200, build: 70 }) === 'upgrade', '挑出 upgrade(>build)', spawning._bestNonHaul({ haul: 9999, fill: 9999, upgrade: 200, build: 70 }));
  check(spawning._bestNonHaul({ haul: 9999, fill: 9999 }) === null, '只有搬运类 → 返回 null', String(spawning._bestNonHaul({ haul: 9999, fill: 9999 })));
}

console.log('');
if (failed === 0) { console.log('🎉 SPAWN-FALLTHROUGH 回归全部通过 (' + passed + ' checks)'); process.exit(0); }
else { console.log('❌ ' + failed + ' 个检查失败'); process.exit(1); }
