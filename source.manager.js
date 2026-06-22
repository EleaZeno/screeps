'use strict';

/*
 * source.manager.js
 * ------------------------------------------------------------------
 * Source 容量计算 + harvester 固定分配（取代原来的"贝叶斯打分"）
 *
 * 核心思想：
 *  - 每个 Source 周围的"可站立空地数"决定它最多能容纳几个采集者
 *  - harvester 一旦绑定某个 source，就一直采它，不抢不挤
 *  - 这是确定性最优分配，比每 tick 概率计算又快又稳
 */

module.exports = {
  /**
   * 计算并缓存房间内每个 source 的开采位（mining spot）数量。
   * 只在未缓存或地形可能变化时计算，平时直接读缓存，几乎不耗 CPU。
   */
  ensureSourceCapacity(room) {
    if (!room.memory.sources) room.memory.sources = {};

    const sources = room.find(FIND_SOURCES);
    for (const source of sources) {
      if (room.memory.sources[source.id] !== undefined) continue; // 已缓存

      // 数 source 周围 8 格里非墙（可站人）的格子数 = 最大采集者数
      const terrain = room.getTerrain();
      let openSpots = 0;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          const x = source.pos.x + dx;
          const y = source.pos.y + dy;
          if (x < 0 || x > 49 || y < 0 || y > 49) continue;
          if (terrain.get(x, y) !== TERRAIN_MASK_WALL) openSpots++;
        }
      }
      room.memory.sources[source.id] = openSpots;
    }
  },

  /**
   * 【S1 已废弃·保留傅兼容】harvester 现由 source.scheduler.assignSlot 统一分配
   * （它会同时设好 slot 和 sourceId）。本方法仅作紧急回退，勿再新增调用。
   */
  assignSource(creep) {
    const room = creep.room;
    if (!room.memory.sources) this.ensureSourceCapacity(room);

    // 统计每个 source 当前已绑定多少采集者（harvester / miner 均算）
    const assigned = {};
    for (const name in Game.creeps) {
      const c = Game.creeps[name];
      if ((c.memory.role === 'harvester' || c.memory.role === 'miner') && c.memory.sourceId) {
        assigned[c.memory.sourceId] = (assigned[c.memory.sourceId] || 0) + 1;
      }
    }

    const sources = room.find(FIND_SOURCES);
    // 选"剩余空位最多"的 source，让采集者均匀分布
    let best = null;
    let bestFree = 0;
    for (const source of sources) {
      const cap = room.memory.sources[source.id] || 1;
      const free = cap - (assigned[source.id] || 0);
      if (free > bestFree) {
        bestFree = free;
        best = source;
      }
    }
    if (best) {
      creep.memory.sourceId = best.id;
      return best.id;
    }
    return null;
  },

  /**
   * 【S1 统一】房间总开采位：委托给 source.scheduler（唯一权威调度源）。
   * scheduler 的精确格子数才是真实可占位数；未规划时回退到本地 8 邻粗算。
   */
  totalMiningSpots(room) {
    const scheduler = require('source.scheduler');
    const slots = scheduler.totalSlots(room);
    if (slots > 0) return slots;
    // scheduler 未规划完成时的回退（起步几 tick）
    if (!room.memory.sources) this.ensureSourceCapacity(room);
    let total = 0;
    for (const id in room.memory.sources) total += room.memory.sources[id];
    return total;
  },

  /**
   * 静态采矿专用：为 miner 分配一个"还没 miner的 source"（每 source 只绑 1 个 miner）。
   */
  assignSourceForMiner(creep) {
    const room = creep.room;
    const minerOn = {};
    for (const name in Game.creeps) {
      const c = Game.creeps[name];
      if (c.memory.role === 'miner' && c.memory.sourceId) minerOn[c.memory.sourceId] = true;
    }
    const sources = room.find(FIND_SOURCES);
    for (const source of sources) {
      if (!minerOn[source.id]) {
        creep.memory.sourceId = source.id;
        return source.id;
      }
    }
    return null;
  },
};
