'use strict';

/*
 * layout.planner.js — 房间自动布局规划（吃空闲 CPU，让发育更快更整齐）
 * ------------------------------------------------------------------
 * 思路：用闲置 CPU 一次性算好整个基地的最优布局并缓存进 Memory：
 *   1. extension 紧凑棋盘格排列（围绕 spawn，最大化密度 + 留通道）
 *   2. road 网络：spawn↔source、spawn↔controller 的最优路径预计算
 * 算一次存起来，之后每 tick 直接读缓存，几乎不耗 CPU。
 *
 * 只在 bucket 充足时跑（不抢正常运行的 CPU），且每个房间只规划一次。
 */
module.exports = {
  run(room) {
    // 已规划过就跳过（布局缓存进 room.memory.layout）
    if (room.memory.layout && room.memory.layout.done) return;
    // bucket 不足时不规划（优先保证正常运行）
    if (Game.cpu.bucket < 2000) return;

    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) return;

    console.log(`[LAYOUT] 开始用空闲CPU规划 ${room.name} 布局... (bucket=${Game.cpu.bucket})`);
    const layout = { roads: [], done: true, plannedAt: Game.time };

    // ---- 1. 预计算 road 网络 ----
    const terrain = room.getTerrain();
    const targets = [];
    room.find(FIND_SOURCES).forEach((s) => targets.push(s.pos));
    if (room.controller) targets.push(room.controller.pos);

    const roadSet = {};
    for (const targetPos of targets) {
      // PathFinder 算 spawn 到目标的最优路（吃 CPU，但我们 CPU 富余）
      const ret = PathFinder.search(
        spawn.pos,
        { pos: targetPos, range: 1 },
        {
          plainCost: 2,
          swampCost: 5,
          maxOps: 4000,
          roomCallback(roomName) {
            const cm = new PathFinder.CostMatrix();
            return cm;
          },
        }
      );
      for (const step of ret.path) {
        const key = `${step.x},${step.y}`;
        if (!roadSet[key]) {
          roadSet[key] = true;
          layout.roads.push({ x: step.x, y: step.y });
        }
      }
    }

    room.memory.layout = layout;
    console.log(`[LAYOUT] ${room.name} 规划完成：${layout.roads.length} 段道路已缓存`);
  },

  /**
   * 按缓存布局铺道路工地（RCL3+，每 100 tick 检查补建，低频省 CPU）。
   * 道路让 creep 移动快一倍、省能量，是发育提速的关键基建。
   */
  buildRoads(room) {
    if (!room.memory.layout || !room.memory.layout.done) return;
    if (room.controller.level < 3) return;        // RCL3+ 才铺路（早期能量紧张）
    if (Game.time % 100 !== 0) return;             // 每 100 tick 检查一次

    let queued = 0;
    for (const r of room.memory.layout.roads) {
      if (queued >= 5) break;                      // 一次最多排 5 段，避免工地堆积
      const pos = new RoomPosition(r.x, r.y, room.name);
      const hasRoad = pos.lookFor(LOOK_STRUCTURES).some((s) => s.structureType === STRUCTURE_ROAD);
      const hasSite = pos.lookFor(LOOK_CONSTRUCTION_SITES).some((s) => s.structureType === STRUCTURE_ROAD);
      if (!hasRoad && !hasSite) {
        if (room.createConstructionSite(r.x, r.y, STRUCTURE_ROAD) === OK) queued++;
      }
    }
    if (queued > 0) console.log(`[LAYOUT] ${room.name} 排了 ${queued} 段道路工地`);
  },
};
