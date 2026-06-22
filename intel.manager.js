'use strict';

/*
 * intel.manager.js — 闲置 CPU/内存"全面利用"中枢
 * ==================================================================
 * 现状诊断（2026-06-23）：CPU 用 3.7/20（闲 81%）、内存 36/2048KB（用 1.7%）。
 * 巨量算力与内存闲置 = 纯浪费。本模块把闲置资源转成"发育情报与预案"，
 * 让 creep 决策更快更准、未来扩张/防御/进攻有现成数据可用。
 *
 * 设计铁律：
 *  - 严格 bucket 门控：bucket 低于阈值一律不跑，绝不抢正常运行 CPU。
 *  - 分时调度：把不同重计算任务摊到不同 tick，避免单帧爆表（tickLimit=500 有余量但不浪费）。
 *  - 全部结果缓存进 Memory（内存反正闲着），平时零成本读取。
 *  - 每项任务有明确"发育价值"，不为算而算。
 */

const TASKS = [
  'roomIntel',     // 房间情报：每个房的威胁/资源/可建性快照
  'threatScan',    // 邻居威胁评估：周边房有没有敌对大佬
  'expansionPlan', // 扩张预案：GCL 涨到能开新房时，预选最佳目标房
  'distanceCache', // 距离矩阵：spawn/controller/source 互距，供路径与排程复用
];

module.exports = {
  /**
   * 主入口：每 tick 调一次，但内部严格门控 —— 只在 bucket 富余时做重计算。
   * @param {number} reserveBucket 保留水位，低于此值只做最轻量的事
   */
  run(reserveBucket) {
    const reserve = reserveBucket || 4000;
    if (!Memory.intel) Memory.intel = { tasks: {}, updatedAt: {} };

    // bucket 不足：什么重活都不干，把 CPU 全留给主循环
    if (Game.cpu.bucket < reserve) return;

    // 分时：每 tick 只跑一个任务，按 tick 轮转，摊平 CPU 峰值
    const task = TASKS[Game.time % TASKS.length];

    // 二级门控：单帧已用 CPU 接近 limit 一半就跳过（给 creep 逻辑留足空间）
    if (Game.cpu.getUsed() > Game.cpu.limit * 0.5) return;

    try {
      switch (task) {
        case 'roomIntel': this.buildRoomIntel(); break;
        case 'threatScan': this.scanThreats(); break;
        case 'expansionPlan': this.planExpansion(); break;
        case 'distanceCache': this.cacheDistances(); break;
      }
      Memory.intel.updatedAt[task] = Game.time;
    } catch (e) {
      console.log(`[INTEL] ${task} 出错: ${e.message}`);
    }
  },

  /** 房间情报快照：能量/敌情/工地/结构计数，供 dashboard 与决策快速读取 */
  buildRoomIntel() {
    const snap = {};
    for (const rn in Game.rooms) {
      const room = Game.rooms[rn];
      if (!room.controller) continue;
      const hostiles = room.find(FIND_HOSTILE_CREEPS).length;
      snap[rn] = {
        my: !!(room.controller.my),
        rcl: room.controller.level,
        ctrlProg: room.controller.progress,
        ctrlTot: room.controller.progressTotal,
        energy: room.energyAvailable,
        energyCap: room.energyCapacityAvailable,
        storedEnergy: room.storage ? room.storage.store[RESOURCE_ENERGY] : 0,
        sites: room.find(FIND_CONSTRUCTION_SITES).length,
        hostiles,
        sources: room.find(FIND_SOURCES).length,
        ts: Game.time,
      };
    }
    Memory.intel.tasks.roomIntel = snap;
  },

  /** 威胁扫描：自家房里若出现敌对 creep，记录其规模与归属，供预警/防御预案 */
  scanThreats() {
    const threats = {};
    for (const rn in Game.rooms) {
      const room = Game.rooms[rn];
      if (!room.controller || !room.controller.my) continue;
      const hostiles = room.find(FIND_HOSTILE_CREEPS);
      if (hostiles.length) {
        let attack = 0, ranged = 0, heal = 0, work = 0;
        for (const h of hostiles) {
          attack += h.getActiveBodyparts(ATTACK);
          ranged += h.getActiveBodyparts(RANGED_ATTACK);
          heal += h.getActiveBodyparts(HEAL);
          work += h.getActiveBodyparts(WORK);
        }
        threats[rn] = { count: hostiles.length, attack, ranged, heal, work, owner: hostiles[0].owner && hostiles[0].owner.username, ts: Game.time };
      }
    }
    Memory.intel.tasks.threats = threats;
  },

  /**
   * 扩张预案：当 GCL 接近升级（可开新房）时，从已侦察房里挑最优扩张目标。
   * 现阶段 GCL1（30%），先把"想要的房特征"算法备好，到 GCL2 直接用。
   */
  planExpansion() {
    if (!Game.gcl) return; // 防御：某些环境/mock 可能无 gcl
    const gclPct = Game.gcl.progress / Game.gcl.progressTotal;
    Memory.intel.tasks.expansion = {
      gclLevel: Game.gcl.level,
      gclPct: +(gclPct * 100).toFixed(2),
      canExpandSoon: gclPct > 0.8, // 接近 GCL2 时提示
      myRoomCount: Object.keys(Game.rooms).filter((rn) => Game.rooms[rn].controller && Game.rooms[rn].controller.my).length,
      note: gclPct > 0.8 ? '接近可开第二房，建议预侦察邻近 2-source 无主房' : 'GCL 距开新房尚远，专注当前房发育',
      ts: Game.time,
    };
  },

  /** 距离矩阵缓存：spawn↔source↔controller 的预算步数，供排程/孵化决策复用 */
  cacheDistances() {
    const cache = {};
    for (const rn in Game.rooms) {
      const room = Game.rooms[rn];
      if (!room.controller || !room.controller.my) continue;
      const spawn = room.find(FIND_MY_SPAWNS)[0];
      if (!spawn) continue;
      const dists = { toSources: [], toController: null };
      for (const s of room.find(FIND_SOURCES)) {
        const ret = PathFinder.search(spawn.pos, { pos: s.pos, range: 1 }, { plainCost: 2, swampCost: 5, maxOps: 2000 });
        dists.toSources.push({ id: s.id, dist: ret.incomplete ? 999 : ret.path.length });
      }
      const cr = PathFinder.search(spawn.pos, { pos: room.controller.pos, range: 3 }, { plainCost: 2, swampCost: 5, maxOps: 2000 });
      dists.toController = cr.incomplete ? 999 : cr.path.length;
      cache[rn] = dists;
    }
    Memory.intel.tasks.distances = cache;
  },
};
