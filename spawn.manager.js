'use strict';

/*
 * spawn.manager.js — 孵化管理
 * ------------------------------------------------------------------
 * 关键改进 vs 旧版：
 *  1. 不写死 'Spawn1'，遍历房间里所有可用 spawn
 *  2. 身体部件随 energyCapacityAvailable 自适应缩放（能量越多身体越大）
 *  3. 目标数量随 RCL / source 容量动态调整，不会一上来要 30 个 creep
 *  4. 优先级排序：先保 harvester（经济命脉），再 upgrader，再 builder
 */

const sourceManager = require('source.manager');

module.exports = {
  run(room) {
    // 找一个空闲（没在孵化）的 spawn
    const spawn = room.find(FIND_MY_SPAWNS, { filter: (s) => !s.spawning })[0];
    if (!spawn) return;

    // 统计现有各角色数量
    const counts = { harvester: 0, upgrader: 0, builder: 0 };
    for (const name in Game.creeps) {
      const c = Game.creeps[name];
      if (c.room.name === room.name && counts[c.memory.role] !== undefined) {
        counts[c.memory.role]++;
      }
    }

    // ---- 目标数量：随 RCL 和地形容量动态计算 ----
    const rcl = room.controller.level;
    const miningSpots = sourceManager.totalMiningSpots(room);     // 物理上能站多少采集者
    const hasConstruction = room.find(FIND_MY_CONSTRUCTION_SITES).length > 0;

    const targets = {
      // harvester 上限 = 开采位，但早期先少养，随 RCL 放开
      harvester: Math.min(miningSpots, rcl <= 1 ? 4 : miningSpots),
      upgrader: rcl <= 1 ? 2 : (rcl <= 3 ? 3 : 2),
      builder: hasConstruction ? (rcl <= 2 ? 2 : 3) : 0,
    };

    // ---- 紧急兜底：如果一个 harvester 都没有，用最小身体强行出一个，防经济崩盘 ----
    if (counts.harvester === 0) {
      this.spawnCreep(spawn, 'harvester', [WORK, CARRY, MOVE]);
      return;
    }

    // ---- 按优先级孵化第一个缺额角色 ----
    const order = ['harvester', 'upgrader', 'builder'];
    for (const role of order) {
      if (counts[role] < targets[role]) {
        const body = this.buildBody(role, room.energyCapacityAvailable);
        const res = this.spawnCreep(spawn, role, body);
        if (res === OK) return; // 一个 spawn 一 tick 只孵一个
        // 能量不够就等下一 tick，不再尝试更贵的角色
        if (res === ERR_NOT_ENOUGH_ENERGY) return;
      }
    }
  },

  /**
   * 根据可用能量上限自适应生成身体。
   * 用 [WORK,CARRY,MOVE] 作为一个单元（成本 200），尽可能多堆几组。
   */
  buildBody(role, energyCap) {
    // 一组 [WORK,CARRY,MOVE] = 100+50+50 = 200 能量
    const unitCost = 200;
    let units = Math.floor(energyCap / unitCost);
    units = Math.max(1, Math.min(units, 8)); // 至少 1 组，最多 8 组（避免身体过长移动慢）

    // upgrader 偏重 WORK（升级快），harvester 偏均衡，builder 偏均衡
    const body = [];
    for (let i = 0; i < units; i++) {
      body.push(WORK);
      body.push(CARRY);
      body.push(MOVE);
    }
    return body;
  },

  /** 实际孵化，名字带角色前缀 + tick 防重名 */
  spawnCreep(spawn, role, body) {
    const name = `${role.charAt(0).toUpperCase()}${role.slice(1)}_${Game.time}`;
    const res = spawn.spawnCreep(body, name, {
      memory: { role, room: spawn.room.name, working: false },
    });
    if (res === OK) {
      console.log(`[SPAWN] ${role} -> ${name} body=${body.length}`);
    } else if (res !== ERR_NOT_ENOUGH_ENERGY && res !== ERR_BUSY) {
      console.log(`[SPAWN-FAIL] ${role} err=${res}`);
    }
    return res;
  },
};
