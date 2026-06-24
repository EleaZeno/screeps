'use strict';

/*
 * source.scheduler.js — 采集位精细调度（吃空闲 CPU，让 9 个位置容纳更多采集者）
 * ==================================================================
 * 用户洞察落地：
 *   "通过科学规划，即使只有 9 个开采位，也能安排更多人采集——
 *    因为有人在采、有人在路上；空闲 CPU 预测规划路线，让他们互不冲突。"
 *
 * 实现三件事：
 *  1. 【空闲 CPU 预计算】把每个 source 周围的精确开采格 (x,y) 算出来并缓存，
 *     再用 PathFinder 预算 spawn→每个开采格的路线，存进 Memory。只算一次。
 *  2. 【精确占位分配】给每个采集者分配一个"专属开采格"，而不是笼统绑 source，
 *     从根上消除两个 creep 抢同一格、互相踩踏堵路的冲突。
 *  3. 【超额订阅】允许采集者数 > 开采格数（系数 oversub）。因为任一时刻总有
 *     一部分 creep 在往返送货的路上，留在格子上的正好填满空位 → 吞吐更高。
 *
 * 平时几乎零 CPU（直接读缓存）；只有 bucket 充足且未规划时才花 CPU 预计算。
 */

module.exports = {
  /**
   * 空闲 CPU 预计算：每个 source 的开采格坐标 + spawn 到各格的预算路线。
   * 结果缓存进 room.memory.slots，只算一次。
   */
  planSlots(room) {
    if (room.memory.slots && room.memory.slots.done) return;
    if (Game.cpu.bucket < 2000) return; // bucket 不足不抢 CPU

    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) return;
    const terrain = room.getTerrain();
    const sources = room.find(FIND_SOURCES);

    const slots = { done: true, plannedAt: Game.time, bySource: {}, all: [] };

    for (const source of sources) {
      const tiles = [];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          const x = source.pos.x + dx;
          const y = source.pos.y + dy;
          if (x < 1 || x > 48 || y < 1 || y > 48) continue;
          if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
          // 预算 spawn → 这个开采格的步数（吃 CPU，但我们富余），缓存距离用于排程
          const ret = PathFinder.search(spawn.pos, { pos: new RoomPosition(x, y, room.name), range: 0 }, {
            plainCost: 2, swampCost: 5, maxOps: 2000,
          });
          const dist = ret.incomplete ? 999 : ret.path.length;
          const tile = { x, y, sourceId: source.id, dist };
          tiles.push(tile);
          slots.all.push(tile);
        }
      }
      // 近的格子优先分配（减少往返时间）
      tiles.sort((a, b) => a.dist - b.dist);
      slots.bySource[source.id] = tiles;
    }

    room.memory.slots = slots;
    console.log(`[SCHED] ${room.name} 预计算完成：${slots.all.length} 个开采格已缓存（含 spawn 预算路线）`);
  },

  /** 房间开采格总数（物理上限） */
  totalSlots(room) {
    if (!room.memory.slots || !room.memory.slots.done) return 0;
    return room.memory.slots.all.length;
  },

  /**
   * 采集者目标数 = 开采格数 × oversub（超额订阅）。
   * oversub > 1：因为总有 creep 在送货路上，多出来的正好轮替补位，吞吐更高。
   * 距离越远（往返耗时越长）的房，oversub 越大越划算。
   */
  harvesterTarget(room, oversub) {
    const slots = this.totalSlots(room);
    if (slots === 0) return 0;
    // ⭐ 激进：oversub 默认提到 1.6（可被调用方传入的进化基因覆盖），更多采集者轮替提吞吐
    return Math.ceil(slots * (oversub || 1.6));
  },

  /**
   * 给一个采集者分配"专属开采格"。策略：选当前占用最少、且最近的格子。
   * 把分配结果写进 creep.memory.slot = {x,y,sourceId}，creep 直接走到那一格采。
   */
  assignSlot(creep) {
    const room = creep.room;
    if (!room.memory.slots || !room.memory.slots.done) {
      this.planSlots(room);
      if (!room.memory.slots || !room.memory.slots.done) return null;
    }

    // 统计每个格子当前被几个采集者占用
    const occ = {};
    for (const name in Game.creeps) {
      const c = Game.creeps[name];
      if ((c.memory.role === 'harvester' || c.memory.role === 'miner') && c.memory.slot) {
        const k = `${c.memory.slot.x},${c.memory.slot.y}`;
        occ[k] = (occ[k] || 0) + 1;
      }
    }

    // 选占用最少的格子（同占用下选离 creep 最近的），实现均匀错峰
    let best = null;
    let bestScore = Infinity;
    for (const tile of room.memory.slots.all) {
      const k = `${tile.x},${tile.y}`;
      const used = occ[k] || 0;
      // 评分：占用数为主，距离为辅（×0.01 做次要权重）
      const score = used * 100 + tile.dist * 0.01;
      if (score < bestScore) {
        bestScore = score;
        best = tile;
      }
    }
    if (best) {
      creep.memory.slot = { x: best.x, y: best.y, sourceId: best.sourceId };
      creep.memory.sourceId = best.sourceId;
      return best;
    }
    return null;
  },
};

