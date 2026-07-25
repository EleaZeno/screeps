'use strict';
const fs = require('fs');
const Module = require('module');
let pass = 0, fail = 0;
function ok(c, n) { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n); } }

// Shared Screeps constants used while loading the modules.
Object.assign(global, {
  STRUCTURE_EXTENSION: 'extension', STRUCTURE_CONTAINER: 'container', STRUCTURE_TOWER: 'tower',
  STRUCTURE_STORAGE: 'storage', STRUCTURE_LINK: 'link', STRUCTURE_TERMINAL: 'terminal',
  STRUCTURE_EXTRACTOR: 'extractor', STRUCTURE_LAB: 'lab', STRUCTURE_FACTORY: 'factory',
  STRUCTURE_SPAWN: 'spawn', STRUCTURE_NUKER: 'nuker', STRUCTURE_OBSERVER: 'observer',
  STRUCTURE_POWER_SPAWN: 'powerSpawn', STRUCTURE_ROAD: 'road', RESOURCE_ENERGY: 'energy',
  WORK: 'work', CARRY: 'carry', MOVE: 'move', ATTACK: 'attack', RANGED_ATTACK: 'ranged_attack', HEAL: 'heal', TOUGH: 'tough', CLAIM: 'claim',
  FIND_MY_SPAWNS: 1, FIND_CONSTRUCTION_SITES: 2, FIND_STRUCTURES: 3, FIND_MY_CONSTRUCTION_SITES: 4,
  FIND_SOURCES: 5, FIND_MINERALS: 6, LOOK_STRUCTURES: 's', LOOK_CONSTRUCTION_SITES: 'cs',
  TERRAIN_MASK_WALL: 1, OK: 0,
});
global.Memory = {};
global.Game = { time: 20 };
global.RoomPosition = function (x, y, roomName) { this.x=x; this.y=y; this.roomName=roomName; };

// 1) Planner fallback expands search after compact ring fails.
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'roadmap') return { blueprint: () => ({ extension: 40, tower: 2 }) };
  if (request === 'source.scheduler') return {};
  if (request === 'worldmodel') return require('./worldmodel.js');
  return origLoad.apply(this, arguments);
};
delete require.cache[require.resolve('./build.planner.js')];
const planner = require('./build.planner.js');
let calls = [];
planner.countStructAndSites = () => calls.length === 0 ? 33 : (calls.length === 1 ? 33 : 40);
planner.placeAround = (room, center, type, count, range) => { calls.push({ type, count, range }); };
planner.ensureCount({}, {}, 'extension', 40, 6, 20);
ok(calls.length === 2 && calls[0].range === 6 && calls[1].range === 20, 'extension compact search falls back to range 20');

// 2) Build capacity uses remaining work and is capped at 3.
const bb = require('./blackboard.js');
function buildCap(total, progress) {
  const tasks = [];
  const site = { id: 's1', progressTotal: total, progress, structureType: 'terminal', pos: { x: 1, y: 1 } };
  bb._collectBuild({ name: 'W0N0', find: (t) => t === FIND_MY_CONSTRUCTION_SITES ? [site] : [] }, tasks);
  return tasks[0].capacity;
}
ok(buildCap(100000, 0) === 3, 'fresh terminal site capped at 3 builders');
ok(buildCap(100000, 99000) === 1, '99% complete terminal requests one builder');

// 3) Terminal fuel task appears only with cargo + storage surplus.
Memory.econ = {};
const tasks = [];
const terminal = { id: 'term', pos: { x: 5, y: 5 }, store: { energy: 0, L: 68000 } };
const storage = { id: 'store', store: { energy: 30000 } };
bb._collectTerminalFuel({ name: 'W0N0', terminal, storage }, tasks);
ok(tasks.length === 1 && tasks[0].type === 'terminalFuel' && tasks[0].meta.need === 20000, 'terminal cargo creates 20k fuel demand');

// 4) Production credentials are no longer literal in ignored deploy config.
const grunt = fs.readFileSync('Gruntfile.brain.js', 'utf8');
ok(/process\.env\.SCREEPS_TOKEN/.test(grunt) && !/token:\s*'[0-9a-f-]{30,}'/i.test(grunt), 'deploy config uses environment token, no literal');

// 5) Pure CARRY creeps are valid for store, and store maps to a hauler body.
const utility = require('./utility.js');
const pureCarry = { body: [{type:'carry'},{type:'move'}], store: { getCapacity:()=>50, energy:0 } };
global.Memory.brain = undefined;
ok(utility.fitness(pureCarry, {type:'store'}, {}) > 0, 'pure CARRY is eligible for store task');
const spawning = require('./spawning.js');
ok(spawning._bodyFor('store', 300).includes('carry') && !spawning._bodyFor('store', 300).includes('work'), 'store shortage spawns hauler body, not worker');
Module._load = origLoad;

console.log(`\n_rcl6fix_test: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
