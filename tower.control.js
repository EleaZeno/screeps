'use strict';

/*
 * tower.control.js — 主动驱动 tower 结构（V3 brain 架构缺失的一环）
 * ==================================================================
 * 背景：brain.loop.js 架构里 executor 只驱动 creep 战斗，
 *       从没有任何模块命令 tower 本身 attack/heal/repair。
 *       tower 是被动建筑：不每 tick 主动下令，它就是一堆死能量。
 *       RCL3 刚解锁 tower 且正在建造 → 建好后若无人指挥=白瞎 5000 能量、房间裸奔。
 *
 * 优先级（每 tower 每 tick 只做一件事，按序短路）：
 *   1. 攻击：最近敌人（带治疗部件的敌人优先点杀，否则就近）。压倒一切。
 *   2. 治疗：受伤友军 creep（离 tower 越近治疗效率越高，但 tower heal 全程满效，按伤情选最缺血的）。
 *   3. 维修：仅在「无敌人 + 无伤员 + tower 能量充足(≥floor)」时，修最该修的非墙建筑/低血 rampart，
 *           且留能量底线，和平期不把自己抽干（真打起来还要靠这点能量开火）。
 *
 * 设计原则：自包含、无外部依赖、CPU 极低（每 tower O(房间敌人数+伤员数)）。
 * 不破坏效用/市场范式：tower 不是 creep，本就该由专门结构逻辑驱动。
 */

// tower 维修时保留的能量底线（满 1000）：低于此值和平期不再维修，攒着应急开火。
const REPAIR_ENERGY_FLOOR = 500;
// 普通建筑维修触发阈值（低于最大血量此比例才修，避免抖动）。
const REPAIR_RATIO = 0.7;
// rampart/wall 维持的目标血量（早期 RCL 不堆太高，够挡一阵即可）。
const RAMPART_TARGET = 30000;

module.exports = {
  /**
   * 驱动 room 内全部我方 tower。返回本 tick 是否有 tower 开火（供日志用）。
   */
  run(room) {
    const towers = room.find(FIND_MY_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_TOWER,
    });
    if (towers.length === 0) return false;

    // 房间敌人（缓存一次，所有 tower 共用）
    const hostiles = room.find(FIND_HOSTILE_CREEPS);
    let fired = false;

    if (hostiles.length > 0) {
      // 选目标：优先打带治疗/进攻部件的（威胁大），其次最近。
      const target = this._pickHostile(towers[0], hostiles);
      for (const t of towers) {
        if (t.store[RESOURCE_ENERGY] >= 10) { t.attack(target); fired = true; }
      }
      return fired;
    }

    // 无敌人 → 治疗受伤友军
    const hurt = room.find(FIND_MY_CREEPS, { filter: (c) => c.hits < c.hitsMax });
    if (hurt.length > 0) {
      // 治最缺血的（绝对缺血量最大）
      let worst = hurt[0], gap = worst.hitsMax - worst.hits;
      for (const c of hurt) {
        const g = c.hitsMax - c.hits;
        if (g > gap) { gap = g; worst = c; }
      }
      for (const t of towers) {
        if (t.store[RESOURCE_ENERGY] >= 10) { t.heal(worst); }
      }
      return false;
    }

    // 和平期 → 维修（留能量底线，避免抽干）
    const target = this._pickRepair(room);
    if (target) {
      for (const t of towers) {
        if (t.store[RESOURCE_ENERGY] >= REPAIR_ENERGY_FLOOR) { t.repair(target); }
      }
    }
    return false;
  },

  /** 选最该打的敌人：治疗部件 > 进攻部件 > 距离近。 */
  _pickHostile(anchor, hostiles) {
    let best = null, bestScore = -Infinity;
    for (const h of hostiles) {
      const heal = h.getActiveBodyparts ? h.getActiveBodyparts(HEAL) : 0;
      const atk = h.getActiveBodyparts ? (h.getActiveBodyparts(ATTACK) + h.getActiveBodyparts(RANGED_ATTACK)) : 0;
      const dist = anchor.pos.getRangeTo(h);
      // 治疗兵最该先点掉（否则打不死），其次进攻兵，再按距离（越近塔伤越高）。
      const score = heal * 1000 + atk * 100 - dist;
      if (score > bestScore) { bestScore = score; best = h; }
    }
    return best;
  },

  /** 选最该修的建筑：低血非墙建筑 > 低于目标的 rampart。返回 null=没活。 */
  _pickRepair(room) {
    // 非墙非rampart：受损低于阈值的，挑伤情最重的
    const damaged = room.find(FIND_STRUCTURES, {
      filter: (s) => s.structureType !== STRUCTURE_WALL &&
        s.structureType !== STRUCTURE_RAMPART &&
        s.hits < s.hitsMax * REPAIR_RATIO,
    });
    if (damaged.length > 0) {
      let worst = damaged[0], r = worst.hits / worst.hitsMax;
      for (const s of damaged) {
        const sr = s.hits / s.hitsMax;
        if (sr < r) { r = sr; worst = s; }
      }
      return worst;
    }
    // rampart 维持到目标血量
    const ramparts = room.find(FIND_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_RAMPART && s.hits < RAMPART_TARGET,
    });
    if (ramparts.length > 0) {
      let worst = ramparts[0];
      for (const s of ramparts) if (s.hits < worst.hits) worst = s;
      return worst;
    }
    return null;
  },
};
