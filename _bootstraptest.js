// 专项复现：cap≥500 静态模式下 bootstrap 死锁（只剩 1 弱采集者+能量封顶，造不出 miner 又不再补 harvester）
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
  WORK: 'work', CARRY: 'carry', MOVE: 'move', ATTACK: 'attack', RANGED_ATTACK: 'ranged_attack', TOUGH: 'tough',
  RESOURCE_ENERGY: 'energy',
  OK: 0, ERR_NOT_ENOUGH_ENERGY: -6, ERR_BUSY: -4,
  FIND_SOURCES: 1, FIND_MY_SPAWNS: 3, FIND_MY_CONSTRUCTION_SITES: 6, FIND_HOSTILE_CREEPS: 9,
  FIND_MY_STRUCTURES: 4, FIND_STRUCTURES: 5,
  STRUCTURE_CONTAINER: 'container', STRUCTURE_EXTENSION: 'extension',
});

const spawnManager = require('spawn.manager');

let fail = 0;
function assert(cond, msg) { if (!cond) { console.log('❌ ' + msg); fail++; } else { console.log('✅ ' + msg); } }

// ---- 复现线上死局：E9N52 cap=550 cur=500 只有 1 个弱 harvester(SOS体) ----
(function () {
  const spawned = [];
  const sources = [{ id: 's1' }, { id: 's2' }];
  const spawn = {
    spawning: null,
    room: { name: 'E9N52' },
    spawnCreep: (body, name, opts) => {
      const energyCost = body.reduce((a, p) => a + ({ work: 100, carry: 50, move: 50, attack: 80, tough: 10, ranged_attack: 150 }[p] || 0), 0);
      if (energyCost > 500) return ERR_NOT_ENOUGH_ENERGY; // cur=500 买不起更贵的
      spawned.push({ role: opts.memory.role, body: body.slice(), cost: energyCost });
      return OK;
    },
  };
  const room = {
    name: 'E9N52',
    controller: { level: 2, my: true },
    energyCapacityAvailable: 550,
    energyAvailable: 500,
    getTerrain: () => ({ get: () => 0 }),
    find: (type) => {
      if (type === FIND_MY_SPAWNS) return [spawn];
      if (type === FIND_SOURCES) return sources;
      return [];
    },
    memory: { sources: { s1: 3, s2: 3 } },
  };
  // 现役：1 个弱 harvester（SOS 体，1 WORK）
  const harv = { name: 'SOS_1', room, memory: { role: 'harvester', room: 'E9N52' },
    getActiveBodyparts: () => 1, ticksToLive: 200 };

  global.Game = { time: 1000, creeps: { SOS_1: harv }, cpu: { bucket: 10000 }, rooms: { E9N52: room } };
  global.Memory = { guardian: { mode: 'normal' }, config: {} };

  // useStatic 需要 config.economy.useStaticMining=true（默认应为 true）。直接跑。
  spawnManager.run(room);

  const madeHarvester = spawned.some((s) => s.role === 'harvester');
  const madeMiner = spawned.some((s) => s.role === 'miner');

  assert(spawned.length > 0, `必须孵化出点东西，不能卡死什么都不出 (实际孵化=${spawned.length})`);
  assert(madeHarvester, `gatherers<2 + cur=500 → 应 bootstrap 出一个买得起的 harvester (实际: ${JSON.stringify(spawned.map(s=>s.role))})`);
  assert(!madeMiner, `cur=500 买不起 600 能量的 miner，不应硬塞 miner 卡死 (实际 madeMiner=${madeMiner})`);
  if (madeHarvester) {
    const h = spawned.find((s) => s.role === 'harvester');
    assert(h.body.includes(CARRY), `bootstrap harvester 必须含 CARRY（能采能运）`);
    assert(h.cost <= 500, `bootstrap harvester 成本必须 ≤ 当前能量 500 (实际 ${h.cost})`);
  }
})();

console.log(fail === 0 ? '\n🎉 BOOTSTRAP 死锁复现/回归全部通过' : `\n💥 ${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
