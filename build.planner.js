'use strict';

/*
 * build.planner.js — 自动建造规划（急速扩张的关键）
 * ------------------------------------------------------------------
 * RCL 提升后自动铺设：
 *  - extension（决定身体大小上限 → 直接决定发育速度）
 *  - container（source 旁，配合静态 miner）
 *  - tower（RCL3+，防御）
 * 用简单的"围绕 spawn 螺旋找空地"策略放 extension，够早期用。
 * 每 50 tick 规划一次，省 CPU。
 */

// 各 RCL 等级允许的 extension 数量（官方上限）
const EXT_PER_RCL = { 0: 0, 1: 0, 2: 5, 3: 10, 4: 20, 5: 30, 6: 40, 7: 50, 8: 60 };
const TOWER_PER_RCL = { 0: 0, 1: 0, 2: 0, 3: 1, 4: 1, 5: 2, 6: 2, 7: 3, 8: 6 };

module.exports = {
  run(room) {
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) return;
    const rcl = room.controller.level;

    // RCL 刚升级 → 立刻规划（解锁新建筑要马上铺，不等周期，加速扩张）
    const mem = room.memory;
    const rclJustChanged = mem._lastRcl !== rcl;
    mem._lastRcl = rcl;
    // 平时每 20 tick 规划一次（比原 50 更勤快），RCL 变化时立即规划
    if (!rclJustChanged && Game.time % 20 !== 0) return;
    if (rclJustChanged) console.log(`[BUILD] RCL=${rcl} 升级，立即重新规划建造 in ${room.name}`);

    // 已有 + 在建的 extension/tower 数
    const exts = this.countStructAndSites(room, STRUCTURE_EXTENSION);
    const towers = this.countStructAndSites(room, STRUCTURE_TOWER);

    // ---- 规划 extension ----
    const extTarget = EXT_PER_RCL[rcl] || 0;
    if (exts < extTarget) {
      this.placeAround(room, spawn.pos, STRUCTURE_EXTENSION, extTarget - exts);
    }

    // ---- 规划 tower ----
    const towerTarget = TOWER_PER_RCL[rcl] || 0;
    if (towers < towerTarget) {
      this.placeAround(room, spawn.pos, STRUCTURE_TOWER, towerTarget - towers, 3);
    }

    // ---- 规划 container（每个 source 旁一个，配合静态 miner）----
    if (rcl >= 2) {
      const sources = room.find(FIND_SOURCES);
      for (const source of sources) {
        const near = source.pos.findInRange(FIND_STRUCTURES, 1, {
          filter: (s) => s.structureType === STRUCTURE_CONTAINER,
        });
        const nearSites = source.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, {
          filter: (s) => s.structureType === STRUCTURE_CONTAINER,
        });
        if (near.length === 0 && nearSites.length === 0) {
          this.placeAround(room, source.pos, STRUCTURE_CONTAINER, 1, 1);
        }
      }
      // controller 旁也建一个 container（让 upgrader 静态站着升级，效率翻倍）
      const ctrl = room.controller;
      const ctrlNear = ctrl.pos.findInRange(FIND_STRUCTURES, 2, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER,
      });
      const ctrlNearSites = ctrl.pos.findInRange(FIND_CONSTRUCTION_SITES, 2, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER,
      });
      if (ctrlNear.length === 0 && ctrlNearSites.length === 0) {
        this.placeAround(room, ctrl.pos, STRUCTURE_CONTAINER, 1, 2);
      }
    }
  },

  countStructAndSites(room, type) {
    const built = room.find(FIND_MY_STRUCTURES, { filter: (s) => s.structureType === type }).length;
    const sites = room.find(FIND_MY_CONSTRUCTION_SITES, { filter: (s) => s.structureType === type }).length;
    return built + sites;
  },

  /** 围绕 center 螺旋找空地放 count 个建筑（跳过路、墙、已占用格）*/
  placeAround(room, center, type, count, maxRange) {
    maxRange = maxRange || 6;
    const terrain = room.getTerrain();
    let placed = 0;
    for (let r = 2; r <= maxRange && placed < count; r++) {
      for (let dx = -r; dx <= r && placed < count; dx++) {
        for (let dy = -r; dy <= r && placed < count; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // 只走当前环
          const x = center.x + dx;
          const y = center.y + dy;
          if (x < 2 || x > 47 || y < 2 || y > 47) continue;
          if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
          // 留出棋盘格通道：避免把建筑铺死（简单策略：跳过奇偶相同的格子做路）
          if ((x + y) % 2 === 0 && type !== STRUCTURE_CONTAINER) continue;
          const pos = new RoomPosition(x, y, room.name);
          const here = pos.lookFor(LOOK_STRUCTURES).concat(pos.lookFor(LOOK_CONSTRUCTION_SITES));
          if (here.length > 0) continue;
          const res = room.createConstructionSite(x, y, type);
          if (res === OK) placed++;
        }
      }
    }
    if (placed > 0) console.log(`[BUILD] queued ${placed} x ${type} in ${room.name}`);
  },
};
