'use strict';

/*
 * build.planner.js — 自动建造规划（按 roadmap 蓝图逐级铺设所有建筑）
 * ------------------------------------------------------------------
 * RCL 提升后，按 roadmap.BLUEPRINT 自动铺设该级解锁的全部建筑：
 *  extension / container / tower / storage / link / terminal /
 *  extractor / lab / factory / spawn / nuker / observer / powerSpawn
 * 哲学：先把当前级该建的全建满，再升级（配合 infra 闸门）。
 * 每 20 tick 规划一次；RCL 变化时立即规划。
 */

const roadmap = require('roadmap');

// 单点型建筑（数量少，放 spawn 附近核心区）
const SINGLE_NEAR_SPAWN = ['storage', 'terminal', 'factory', 'nuker', 'observer', 'powerSpawn', 'powerspawn'];
// Screeps 常量名映射
const TYPE = {
  extension: STRUCTURE_EXTENSION,
  container: STRUCTURE_CONTAINER,
  tower: STRUCTURE_TOWER,
  storage: STRUCTURE_STORAGE,
  link: STRUCTURE_LINK,
  terminal: STRUCTURE_TERMINAL,
  extractor: STRUCTURE_EXTRACTOR,
  lab: STRUCTURE_LAB,
  factory: STRUCTURE_FACTORY,
  spawn: STRUCTURE_SPAWN,
  nuker: STRUCTURE_NUKER,
  observer: STRUCTURE_OBSERVER,
  powerSpawn: STRUCTURE_POWER_SPAWN,
};

module.exports = {
  run(room) {
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) return;
    const rcl = room.controller.level;

    const mem = room.memory;
    const rclJustChanged = mem._lastRcl !== rcl;
    mem._lastRcl = rcl;
    if (!rclJustChanged && Game.time % 20 !== 0) return;
    if (rclJustChanged) console.log(`[BUILD] RCL=${rcl} 升级，立即按蓝图重新规划 ${room.name}`);

    const bp = roadmap.blueprint(rcl);

    // ---- 1. extension（核心，最优先）----
    this.ensureCount(room, spawn.pos, 'extension', bp.extension || 0, 6);

    // ---- 2. tower（防御）----
    if (bp.tower) this.ensureCount(room, spawn.pos, 'tower', bp.tower, 4);

    // ---- 3. container（source 旁 + controller 旁）----
    if (rcl >= 2) this.planContainers(room);

    // ---- 4. storage（RCL4+，单点，放 spawn 旁核心）----
    if (bp.storage) this.ensureSingle(room, spawn.pos, 'storage', 2);

    // ---- 5. link（RCL5+：controller 旁 + source 旁 + storage 旁）----
    if (bp.link) this.planLinks(room, bp.link);

    // ---- 6. terminal（RCL6+，单点）----
    if (bp.terminal) this.ensureSingle(room, spawn.pos, 'terminal', 3);

    // ---- 7. extractor（RCL6+，盖在 mineral 上）----
    if (bp.extractor) this.planExtractor(room);

    // ---- 8. lab（RCL6+，成簇放）----
    if (bp.lab) this.ensureCount(room, spawn.pos, 'lab', bp.lab, 7);

    // ---- 9. factory（RCL7+，单点）----
    if (bp.factory) this.ensureSingle(room, spawn.pos, 'factory', 4);

    // ---- 10. 额外 spawn（RCL7=2, RCL8=3）----
    if (bp.spawn && bp.spawn > 1) this.ensureCount(room, spawn.pos, 'spawn', bp.spawn, 5);

    // ---- 11. nuker / observer / powerSpawn（RCL8）----
    if (bp.nuker) this.ensureSingle(room, spawn.pos, 'nuker', 5);
    if (bp.observer) this.ensureSingle(room, spawn.pos, 'observer', 6);
    if (bp.powerSpawn) this.ensureSingle(room, spawn.pos, 'powerSpawn', 4);
  },

  /** 确保某类建筑达到 target 数量（已建+在建），不足则围绕 center 补建 */
  ensureCount(room, center, key, target, maxRange) {
    const type = TYPE[key];
    if (!type) return;
    const have = this.countStructAndSites(room, type);
    if (have < target) this.placeAround(room, center, type, target - have, maxRange);
  },

  /** 单点建筑：只建 1 个（已有就跳过）*/
  ensureSingle(room, center, key, maxRange) {
    const type = TYPE[key];
    if (!type) return;
    if (this.countStructAndSites(room, type) >= 1) return;
    this.placeAround(room, center, type, 1, maxRange || 3);
  },

  planContainers(room) {
    const sources = room.find(FIND_SOURCES);
    for (const source of sources) {
      const near = source.pos.findInRange(FIND_STRUCTURES, 1, { filter: (s) => s.structureType === STRUCTURE_CONTAINER });
      const nearSites = source.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, { filter: (s) => s.structureType === STRUCTURE_CONTAINER });
      if (near.length === 0 && nearSites.length === 0) this.placeAround(room, source.pos, STRUCTURE_CONTAINER, 1, 1);
    }
    const ctrl = room.controller;
    const cNear = ctrl.pos.findInRange(FIND_STRUCTURES, 2, { filter: (s) => s.structureType === STRUCTURE_CONTAINER });
    const cNearSites = ctrl.pos.findInRange(FIND_CONSTRUCTION_SITES, 2, { filter: (s) => s.structureType === STRUCTURE_CONTAINER });
    if (cNear.length === 0 && cNearSites.length === 0) this.placeAround(room, ctrl.pos, STRUCTURE_CONTAINER, 1, 2);
  },

  /** link：优先 controller 旁、storage 旁、各 source 旁，每处 1 个，总数不超 target */
  planLinks(room, target) {
    const have = this.countStructAndSites(room, STRUCTURE_LINK);
    if (have >= target) return;
    const anchors = [];
    if (room.controller) anchors.push(room.controller.pos);
    if (room.storage) anchors.push(room.storage.pos);
    room.find(FIND_SOURCES).forEach((s) => anchors.push(s.pos));
    let placed = have;
    for (const a of anchors) {
      if (placed >= target) break;
      const near = a.findInRange(FIND_STRUCTURES, 2, { filter: (s) => s.structureType === STRUCTURE_LINK });
      const nearS = a.findInRange(FIND_CONSTRUCTION_SITES, 2, { filter: (s) => s.structureType === STRUCTURE_LINK });
      if (near.length === 0 && nearS.length === 0) {
        const before = this.countStructAndSites(room, STRUCTURE_LINK);
        this.placeAround(room, a, STRUCTURE_LINK, 1, 2);
        if (this.countStructAndSites(room, STRUCTURE_LINK) > before) placed++;
      }
    }
  },

  /** extractor 必须盖在 mineral 上 */
  planExtractor(room) {
    const mineral = room.find(FIND_MINERALS)[0];
    if (!mineral) return;
    const has = mineral.pos.lookFor(LOOK_STRUCTURES).some((s) => s.structureType === STRUCTURE_EXTRACTOR);
    const hasSite = mineral.pos.lookFor(LOOK_CONSTRUCTION_SITES).some((s) => s.structureType === STRUCTURE_EXTRACTOR);
    if (!has && !hasSite) room.createConstructionSite(mineral.pos, STRUCTURE_EXTRACTOR);
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
    for (let r = 1; r <= maxRange && placed < count; r++) {
      for (let dx = -r; dx <= r && placed < count; dx++) {
        for (let dy = -r; dy <= r && placed < count; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = center.x + dx;
          const y = center.y + dy;
          if (x < 2 || x > 47 || y < 2 || y > 47) continue;
          if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
          // 棋盘格留通道（container/road/特殊单点除外）
          if ((x + y) % 2 === 0 && type !== STRUCTURE_CONTAINER && type !== STRUCTURE_STORAGE &&
              type !== STRUCTURE_TERMINAL && type !== STRUCTURE_LINK) continue;
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
