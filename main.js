'use strict';

/*
 * Screeps 主循环 — 干净、低 CPU、可扩展的早期脚本
 * ------------------------------------------------------------------
 * 设计原则：
 *  1. 不每 tick 重算路径，移动统一用 moveTo + reusePath 缓存
 *  2. Source 固定分配（每个 source 绑定固定数量 harvester，绝不抢）
 *  3. 身体部件随房间能量自适应缩放
 *  4. 所有 Memory 访问前先初始化，绝不裸 .xxx
 *  5. 单房间起步，但所有逻辑遍历 Game.rooms / Game.spawns，天然支持多房间
 *
 * 文件结构：
 *  main.js            — 主循环、Memory 初始化、内存清理
 *  spawn.manager.js   — 孵化逻辑（数量、身体自适应）
 *  source.manager.js  — Source 容量计算 + harvester 固定分配
 *  role.harvester.js  — 采集 -> 回填 spawn/extension/tower
 *  role.upgrader.js   — 升级 controller
 *  role.builder.js    — 建造工地，无工地时回退去升级
 *  utils.js           — 通用工具（缓存路径、找目标等）
 */

const spawnManager = require('spawn.manager');
const sourceManager = require('source.manager');
const roleHarvester = require('role.harvester');
const roleUpgrader = require('role.upgrader');
const roleBuilder = require('role.builder');

// 角色名 -> 执行模块映射，新增角色只需在这里加一行
const ROLES = {
  harvester: roleHarvester,
  upgrader: roleUpgrader,
  builder: roleBuilder,
};

module.exports.loop = function () {
  // ---- 0. Memory 初始化（防裸访问崩溃）----
  if (!Memory.creeps) Memory.creeps = {};
  if (!Memory.stats) Memory.stats = {};

  // ---- 1. 内存清理：删除已死亡 creep 的残留内存 ----
  cleanupDeadCreeps();

  // ---- 2. 每个房间：计算 source 容量并分配 ----
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller || !room.controller.my) continue;

    // 缓存 source 容量（很少变，按需重算）
    sourceManager.ensureSourceCapacity(room);

    // 孵化逻辑
    spawnManager.run(room);
  }

  // ---- 3. 执行每个 creep 的角色逻辑 ----
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    const role = ROLES[creep.memory.role];
    if (role) {
      try {
        role.run(creep);
      } catch (err) {
        console.log(`[ERR] creep ${name} (${creep.memory.role}): ${err.stack || err}`);
      }
    }
  }

  // ---- 4. 轻量统计（每 10 tick 打印一次，省 CPU）----
  if (Game.time % 10 === 0) {
    reportStats();
  }
};

/** 删除已死亡 creep 的内存，避免 Memory 膨胀 */
function cleanupDeadCreeps() {
  for (const name in Memory.creeps) {
    if (!Game.creeps[name]) {
      // 释放它占用的 source 槽位（如果有）
      delete Memory.creeps[name];
    }
  }
}

/** 打印关键指标，方便观察经济健康度 */
function reportStats() {
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller || !room.controller.my) continue;

    const counts = {};
    for (const name in Game.creeps) {
      const r = Game.creeps[name].memory.role;
      counts[r] = (counts[r] || 0) + 1;
    }
    const ctrl = room.controller;
    const pct = ((ctrl.progress / ctrl.progressTotal) * 100).toFixed(1);
    console.log(
      `[${roomName}] RCL${ctrl.level} ${pct}% | energy ${room.energyAvailable}/${room.energyCapacityAvailable} | ` +
      `H:${counts.harvester || 0} U:${counts.upgrader || 0} B:${counts.builder || 0} | CPU ${Game.cpu.getUsed().toFixed(1)}`
    );
  }
}
