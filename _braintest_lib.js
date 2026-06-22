'use strict';
// V3 brain test harness — mock factory + scenarios. Run with: node _braintest_run.js
const t = require('./_braintest'); // loads globals
const { ok } = t;

// ---------- mock factory ----------
function mkBody(parts) { return parts.map((p) => ({ type: p, hits: 100 })); }

function mkCreep(name, parts, x, y, roomName, energy) {
  const body = mkBody(parts);
  const cap = parts.filter((p) => p === CARRY).length * 50;
  const c = {
    name, body, memory: (Memory.creeps[name] = Memory.creeps[name] || {}),
    pos: new RoomPosition(x, y, roomName),
    store: { [RESOURCE_ENERGY]: energy || 0, getCapacity: () => cap, getFreeCapacity: () => cap - (energy || 0) },
    room: { name: roomName }, my: true,
    harvest: () => OK, transfer: () => OK, withdraw: () => OK, pickup: () => OK,
    build: () => OK, repair: () => OK, upgradeController: () => OK, attack: () => OK, rangedAttack: () => OK,
    moveTo: () => OK, move: () => OK,
  };
  Game.creeps[name] = c;
  return c;
}

function mkSource(id, x, y, roomName, energy, capE) {
  const o = { id, pos: new RoomPosition(x, y, roomName), energy: energy, energyCapacity: capE || 3000, structureType: FIND_SOURCES };
  global._objs[id] = o; return o;
}
function mkSpawn(id, x, y, roomName, energy) {
  const o = { id, structureType: STRUCTURE_SPAWN, pos: new RoomPosition(x, y, roomName), spawning: null,
    store: { [RESOURCE_ENERGY]: energy, getFreeCapacity: () => 300 - energy, getCapacity: () => 300 },
    spawnCreep: function (body, nm, opts) { o._spawned = o._spawned || []; o._spawned.push({ body, nm }); return OK; } };
  global._objs[id] = o; return o;
}
function mkRoom(name, opts) {
  opts = opts || {};
  const room = {
    name, memory: {},
    controller: { id: 'ctrl_' + name, my: true, level: opts.rcl || 2, pos: new RoomPosition(25, 25, name), ticksToDowngrade: opts.downgrade || 20000 },
    energyAvailable: opts.cur != null ? opts.cur : 300,
    energyCapacityAvailable: opts.cap != null ? opts.cap : 550,
    storage: null,
    _find: opts.find || {},
    getTerrain: () => ({ get: () => 0 }),
    find: function (type, filter) {
      let arr = this._find[type] || [];
      if (filter && filter.filter) arr = arr.filter(filter.filter);
      return arr;
    },
  };
  Game.rooms[name] = room;
  return room;
}

module.exports = { mkCreep, mkSource, mkSpawn, mkRoom, mkBody, ok };
