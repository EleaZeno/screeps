'use strict';

/*
 * roadmap.js — 一个月发育总路线图（自动阶段状态机）
 * ==================================================================
 * 把 RCL2→8 满级的完整发育计划写进代码，无人值守自动逐级推进。
 * 核心哲学（用户铁律）：每一级先把基建+开采榨满，再升下一级；专注一件事。
 *
 * 每个 RCL 定义：
 *   - structures: 该级要建的所有建筑及数量（官方上限）
 *   - focus:      该级的核心任务（给人看的，也驱动 spawn 策略）
 *   - roads:      该级是否开始修路
 *   - milestone:  达成标志
 *
 * roadmap 不直接建造（建造由 build.planner 执行），它是"总规划+相位判定"：
 *   - phase(room) 返回当前处于哪个发育相位
 *   - 驱动 build.planner 知道该建什么、layout 知道该不该修路、spawn 知道该不该冲级
 */

// 各 RCL 完整建筑蓝图（数量=该等级官方上限；建满才算该级基建完成）
const BLUEPRINT = {
  1: { extension: 0, container: 0, tower: 0, road: false,
       focus: '出生起步：少量采集者 + 狂升 controller 冲 RCL2' },
  2: { extension: 5, container: 3, tower: 0, road: false,
       focus: '建满 5 extension + source/controller container，能量上限 300→550' },
  3: { extension: 10, container: 5, tower: 1, road: true,
       focus: '建满 10 extension + 第1座 tower（防御就位）+ 开始修主干路' },
  4: { extension: 20, container: 5, tower: 1, road: true, storage: 1,
       focus: '⭐质变点：建 storage（百万容量囤能量）+ 20 extension + 完善路网' },
  5: { extension: 30, container: 5, tower: 2, road: true, storage: 1, link: 2,
       focus: '建 link（能量瞬移省 hauler）+ 30 extension + 第2座 tower' },
  6: { extension: 40, container: 5, tower: 2, road: true, storage: 1, link: 3, terminal: 1, extractor: 1, lab: 3,
       focus: '建 terminal（跨房贸易变现）+ extractor（采矿物）+ lab（化合物）+ 40 extension' },
  7: { extension: 50, container: 5, tower: 3, road: true, storage: 1, link: 4, terminal: 1, extractor: 1, lab: 6, factory: 1, spawn: 2,
       focus: '建 factory（商品生产）+ 第2个 spawn + 50 extension + 6 lab' },
  8: { extension: 60, container: 5, tower: 6, road: true, storage: 1, link: 6, terminal: 1, extractor: 1, lab: 10, factory: 1, spawn: 3, nuker: 1, observer: 1, powerSpawn: 1,
       focus: '👑满级：3 spawn + 6 tower + nuker + observer + 60 extension，达到顶级帝国' },
};

// 估算各级所需时间（分钟，给人看的；基于经验，实际随能量产能浮动）
const ETA_MINUTES = { 2: 60, 3: 180, 4: 600, 5: 1440, 6: 2880, 7: 5760, 8: 10080 };

module.exports = {
  BLUEPRINT,

  /** 当前 RCL 的蓝图 */
  blueprint(rcl) { return BLUEPRINT[rcl] || BLUEPRINT[8]; },

  /** 该级是否该修路 */
  shouldBuildRoads(rcl) { return !!(BLUEPRINT[rcl] && BLUEPRINT[rcl].road); },

  /**
   * 当前发育相位描述（给 HUD/命令显示）。
   * 返回 { rcl, focus, nextLevel, etaMin, progress }
   */
  phase(room) {
    const rcl = room.controller.level;
    const bp = this.blueprint(rcl);
    return {
      rcl,
      focus: bp.focus,
      nextLevel: rcl < 8 ? rcl + 1 : 8,
      etaMin: ETA_MINUTES[rcl + 1] || null,
      maxed: rcl >= 8,
    };
  },

  /**
   * 整月路线图文本（控制台 roadmap() 命令打印）。
   */
  fullPlan(currentRcl) {
    const lines = ['🗺 一个月发育路线图（逐级夯实）：'];
    for (let lvl = 2; lvl <= 8; lvl++) {
      const bp = BLUEPRINT[lvl];
      const mark = lvl < currentRcl ? '✅' : (lvl === currentRcl ? '▶️' : '⬜');
      const eta = ETA_MINUTES[lvl] ? ` (累计~${(ETA_MINUTES[lvl] / 60).toFixed(0)}h)` : '';
      lines.push(`${mark} RCL${lvl}${eta}: ${bp.focus}`);
    }
    return lines.join('\n');
  },
};
