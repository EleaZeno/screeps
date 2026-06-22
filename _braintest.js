'use strict';
// V3 brain test: mock Screeps env, replay old bug scenarios, prove immunity.
const Module = require('module');
const path = require('path');
const fs = require('fs');
const localMods = new Set(fs.readdirSync(__dirname).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3)));
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (localMods.has(request)) return path.join(__dirname, request + '.js');
  return origResolve.call(this, request, ...args);
};

// --- minimal Screeps globals ---
Object.assign(global, {
  WORK: 'work', CARRY: 'carry', MOVE: 'move', ATTACK: 'attack', RANGED_ATTACK: 'ranged_attack', TOUGH: 'tough', CLAIM: 'claim', HEAL: 'heal',
  RESOURCE_ENERGY: 'energy',
  OK: 0, ERR_NOT_IN_RANGE: -9, ERR_NOT_ENOUGH_ENERGY: -6, ERR_BUSY: -4,
  FIND_SOURCES: 1, FIND_MY_SPAWNS: 3, FIND_MY_STRUCTURES: 4, FIND_STRUCTURES: 5,
  FIND_MY_CONSTRUCTION_SITES: 6, FIND_HOSTILE_CREEPS: 9, FIND_MY_CREEPS: 10,
  FIND_DROPPED_RESOURCES: 11, FIND_TOMBSTONES: 12, FIND_SOURCES_ACTIVE: 13,
  STRUCTURE_CONTAINER: 'container', STRUCTURE_EXTENSION: 'extension', STRUCTURE_SPAWN: 'spawn',
  STRUCTURE_TOWER: 'tower', STRUCTURE_STORAGE: 'storage', STRUCTURE_ROAD: 'road',
  STRUCTURE_WALL: 'constructedWall', STRUCTURE_RAMPART: 'rampart', STRUCTURE_LINK: 'link',
  TERRAIN_MASK_WALL: 1,
  TOP: 1, TOP_RIGHT: 2, RIGHT: 3, BOTTOM_RIGHT: 4, BOTTOM: 5, BOTTOM_LEFT: 6, LEFT: 7, TOP_LEFT: 8,
});
global.Resource = class Resource {};
global.RoomPosition = class { constructor(x, y, roomName) { this.x = x; this.y = y; this.roomName = roomName; } isNearTo(o) { const p = o.pos || o; return Math.max(Math.abs(this.x - p.x), Math.abs(this.y - p.y)) <= 1; } isEqualTo(o) { const p = o.pos || o; return this.x === p.x && this.y === p.y; } };
global.PathFinder = { search: () => ({ incomplete: false, path: [{}, {}, {}] }) };
global.Game = { time: 1000, cpu: { bucket: 10000 }, creeps: {}, rooms: {}, getObjectById: (id) => global._objs[id] };
global.Memory = { creeps: {}, brain: {} };
global._objs = {};

let fail = 0, pass = 0;
function ok(cond, msg) { if (cond) { console.log('  PASS ' + msg); pass++; } else { console.log('  FAIL ' + msg); fail++; } }
module.exports = { ok, report: () => ({ fail, pass }) };
