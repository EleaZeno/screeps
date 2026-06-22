'use strict';

/*
 * Screeps v2.1 主循环 — 急速扩张 + 防御 + (可选)进攻
 * ------------------------------------------------------------------
 * 模块：
 *  config.js          — 全局开关/策略（改行为只动这里）
 *  spawn.manager.js   — 孵化（config 驱动，身体自适应）
 *  source.manager.js  — source 容量 + 采集者固定分配
 *  build.planner.js   — 自动铺 extension/container/tower
 *  tower.manager.js   — tower 自动防御 + 修理
 *  role.*.js          — miner/hauler/harvester/upgrader/builder/defender/attacker
 *  utils.js           — 移动缓存 + 找目标 + 取能量
 *
 * 进攻默认关闭。经济起来后在控制台开：
 *   Memory.config = { attack: { enabled: true, targetRoom: 'E5N53', squadSize: 4, type: 'melee' } }
 */
const config = require('config');
const spawnManager = require('spawn.manager');
const sourceManager = require('source.manager');
const buildPlanner = require('build.planner');
const towerManager = require('tower.manager');

const ROLES = {
  harvester: require('role.harvester'),
  miner: require('role.miner'),
  hauler: require('role.hauler'),
  upgrader: require('role.upgrader'),
  builder: require('role.builder'),
  defender: require('role.defender'),
  attacker: require('role.attacker'),
};

module.exports.loop = function () {
  // 0. Memory 初始化
  if (!Memory.creeps) Memory.creeps = {};
  if (!Memory.stats) Memory.stats = {};

  // 1. 清理死亡 creep 内存
  for (const name in Memory.creeps) {
    if (!Game.creeps[name]) delete Memory.creeps[name];
  }

  // 2. 房间级管理：source 容量、建造规划、tower 防御、孵化
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller || !room.controller.my) continue;

    sourceManager.ensureSourceCapacity(room);
    if (config.economy.autoBuild) buildPlanner.run(room);
    if (config.military.towerDefense) towerManager.run(room);
    spawnManager.run(room);
  }

  // 3. 执行每个 creep 的角色逻辑（带 try/catch 隔离）
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    const role = ROLES[creep.memory.role];
    if (role) {
      try { role.run(creep); }
      catch (err) { console.log(`[ERR] ${name} (${creep.memory.role}): ${err.stack || err}`); }
    }
  }

  // 4. 轻量统计（每 10 tick）
  if (Game.time % 10 === 0) reportStats();
};

function reportStats() {
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller || !room.controller.my) continue;
    const counts = {};
    for (const name in Game.creeps) {
      if (Game.creeps[name].room.name !== roomName) continue;
      const r = Game.creeps[name].memory.role;
      counts[r] = (counts[r] || 0) + 1;
    }
    const c = room.controller;
    const pct = c.progressTotal ? ((c.progress / c.progressTotal) * 100).toFixed(1) : '100';
    const roster = Object.keys(counts).map((k) => `${k[0].toUpperCase()}:${counts[k]}`).join(' ');
    console.log(
      `[${roomName}] RCL${c.level} ${pct}% | E ${room.energyAvailable}/${room.energyCapacityAvailable} | ${roster} | CPU ${Game.cpu.getUsed().toFixed(1)}`
    );
  }
}
