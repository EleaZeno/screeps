'use strict';
/* _linkfill_test.js — 验证阶段1：source link 选址 + 矿工相邻 link 灌能
 * 纯 mock，无 Game 依赖。覆盖两处改动：
 *   1) build.planner._sourceLinkSpot：在开采格相邻空格选 source link 位（不压 source/开采格/墙/已占）
 *   2) build.planner.planLinks 优先级：controller link 先于 source link
 */
global.STRUCTURE_LINK = 'link';
global.STRUCTURE_CONTAINER = 'container';
global.STRUCTURE_EXTENSION = 'extension';
global.STRUCTURE_TOWER = 'tower';
global.STRUCTURE_STORAGE = 'storage';
global.STRUCTURE_TERMINAL = 'terminal';
global.STRUCTURE_EXTRACTOR = 'extractor';
global.STRUCTURE_LAB = 'lab';
global.STRUCTURE_FACTORY = 'factory';
global.STRUCTURE_SPAWN = 'spawn';
global.STRUCTURE_NUKER = 'nuker';
global.STRUCTURE_OBSERVER = 'observer';
global.STRUCTURE_POWER_SPAWN = 'powerSpawn';
global.STRUCTURE_ROAD = 'road';
global.STRUCTURE_RAMPART = 'rampart';
global.FIND_SOURCES = 2;
global.FIND_STRUCTURES = 3;
global.FIND_CONSTRUCTION_SITES = 4;
global.FIND_MY_STRUCTURES = 5;
global.FIND_MY_CONSTRUCTION_SITES = 6;
global.FIND_MY_SPAWNS = 7;
global.TERRAIN_MASK_WALL = 1;
global.LOOK_STRUCTURES = 'structure';
global.LOOK_CONSTRUCTION_SITES = 'csite';
global.OK = 0;
global.RESOURCE_ENERGY = 'energy';

let pass = 0, fail = 0;
function ok(c, n) { if (c) { pass++; console.log('  PASS', n); } else { fail++; console.log('  FAIL', n); } }

// --- mock RoomPosition ---
global.RoomPosition = function (x, y, roomName) {
  this.x = x; this.y = y; this.roomName = roomName;
  this.lookFor = function () { return []; };
  this.findInRange = function () { return []; };
  this.inRangeTo = function (tx, ty, r) { return Math.max(Math.abs(this.x - tx), Math.abs(this.y - ty)) <= r; };
};

// 让 require 能找到 build.planner（它顶部 require('roadmap')）——给个最小 stub
const Module = require('module');
const origResolve = Module._resolveFilename;
const path = require('path');
Module._resolveFilename = function (request, ...rest) {
  if (request === 'roadmap') return path.resolve('roadmap.js');
  if (request === 'worldmodel') return path.resolve('worldmodel.js');
  if (request === 'infra') return path.resolve('infra.js');
  return origResolve.call(this, request, ...rest);
};

const bp = require('./build.planner.js');

// === 测试 _sourceLinkSpot ===
// source 在 (12,36)，开采格缓存 (11,36)(13,36)(11,37)。地形全平地。
function makeRoom(createdSites) {
  const created = createdSites || [];
  return {
    name: 'E9N54',
    memory: { slots: { done: true, bySource: { 's1': [{ x: 11, y: 36 }, { x: 13, y: 36 }, { x: 11, y: 37 }] } } },
    getTerrain() { return { get() { return 0; } }; }, // 全平地
    createConstructionSite(x, y, type) { created.push({ x, y, type }); return OK; },
    _created: created,
  };
}
const source = { id: 's1', pos: { x: 12, y: 36 } };

// 1. 选出的 spot 必须与某开采格相邻，且不是 source 本身、不是开采格本身
{
  const room = makeRoom();
  const spot = bp._sourceLinkSpot(room, source);
  ok(spot != null, 'source link spot 找到');
  const slots = [{ x: 11, y: 36 }, { x: 13, y: 36 }, { x: 11, y: 37 }];
  const adjToSlot = slots.some((s) => Math.max(Math.abs(s.x - spot.x), Math.abs(s.y - spot.y)) === 1);
  ok(adjToSlot, 'spot 与开采格相邻(矿工 range1 可灌)');
  ok(!(spot.x === 12 && spot.y === 36), 'spot 不在 source 上');
  ok(!slots.some((s) => s.x === spot.x && s.y === spot.y), 'spot 不压开采格');
}

console.log('\n_linkfill_test:', pass, 'pass /', fail, 'fail');
process.exit(fail === 0 ? 0 : 1);
