// 专项复现：新生小收获者被 recycleObsolete 立刻标记 recycle → 跑回母体消失
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
  WORK: 'work', CARRY: 'carry', MOVE: 'move', RESOURCE_ENERGY: 'energy',
  OK: 0, ERR_NOT_ENOUGH_ENERGY: -6, ERR_BUSY: -4,
  FIND_SOURCES: 1, FIND_MY_SPAWNS: 3,
});

const spawnManager = require('spawn.manager');

let fail = 0;
function assert(cond, msg) { if (!cond) { console.log('❌ ' + msg); fail++; } else { console.log('✅ ' + msg); } }

function mkHarvester(name, workParts, ttl) {
  return {
    name,
    room: { name: 'W1N1' },
    memory: { role: 'harvester' },
    ticksToLive: ttl,
    getActiveBodyparts: (t) => (t === WORK ? workParts : 0),
  };
}

function run(creeps, time) {
  global.Game = { time, creeps, cpu: { bucket: 10000 } };
  global.Memory = {};
  spawnManager.recycleObsolete({ name: 'W1N1' }, {}, 550);
}

// 场景1：新生小号(仍在孵化, ticksToLive=undefined) 不应被回收
(function () {
  const c = {
    Big_1: mkHarvester('Big_1', 5, 1490),
    Big_1b: mkHarvester('Big_1b', 5, 1480),
    Harvester_NEW: mkHarvester('Harvester_NEW', 1, undefined),
  };
  run(c, 100);
  assert(!c.Harvester_NEW.memory.recycle,
    `新生小号(work=1, ticksToLive=undefined 仍在孵化) 不应被标记 recycle (实际=${c.Harvester_NEW.memory.recycle})`);
})();

// 场景2：刚出生满 TTL 的小号(ttl=1500) 不该被立刻回收
(function () {
  const c = {
    Big_2: mkHarvester('Big_2', 5, 1490),
    Big_2b: mkHarvester('Big_2b', 5, 1480),
    Harvester_FRESH: mkHarvester('Harvester_FRESH', 1, 1500),
  };
  run(c, 200);
  assert(!c.Harvester_FRESH.memory.recycle,
    `刚出生满TTL小号(ttl=1500) 不应被立刻 recycle (实际=${c.Harvester_FRESH.memory.recycle})`);
})();

// 场景3：老化小号(ttl=800) 仍能被正常回收(新陈代谢功能不削)
(function () {
  const c = {
    Big_3: mkHarvester('Big_3', 5, 1490),
    Big_3b: mkHarvester('Big_3b', 5, 1480),
    Harvester_OLD: mkHarvester('Harvester_OLD', 1, 800),
  };
  run(c, 300);
  assert(c.Harvester_OLD.memory.recycle === true,
    `老化小号(ttl=800) 仍应被正常标记 recycle，新陈代谢不丢 (实际=${c.Harvester_OLD.memory.recycle})`);
})();

console.log(fail === 0 ? '\n🎉 RECYCLE 复现/回归全部通过' : `\n💥 ${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
