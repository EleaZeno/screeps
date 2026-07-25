'use strict';

/*
 * planner.js — L4 目标导向规划器（GOAP-lite，大脑的"远见与计划"）
 * ==================================================================
 * 这是 brain(L3战略层) 之上的一层。brain 回答"看着当前+前瞻该偏向哪些活"，
 * planner 回答更高层的问题："殖民地这一阶段的【主目标】是什么？为达成它，
 * 需要哪些【前置条件】按什么顺序满足？" —— 然后把这个计划压成权重调制喂给 brain。
 *
 * 与 GOAP 的关系（GOAP-lite）：
 *   - 完整 GOAP = 给目标用 A* 在动作空间搜索最优序列，CPU 开销大。
 *   - 这里用【目标分解 + 前置条件门控】的轻量版：手工定义目标的前置依赖图(DAG)，
 *     运行时检查每个前置是否满足，未满足的最浅前置 = 当前应该发力的方向。
 *   - 既有"规划/远见"的能力（知道为了 RCL3 现在该干嘛），又 CPU 极低（无搜索）。
 *
 * 输出：goalBias{} —— 每种任务类型的【乘性调制因子】(默认1)，brain 把它乘到权重上。
 * 同时输出 planText 供控制台观测大脑"当前计划"。
 */

// ramp: x 从 [a,b] 映射到 [0,1]
function ramp(x, a, b) { if (b === a) return x >= b ? 1 : 0; const t = (x - a) / (b - a); return t < 0 ? 0 : t > 1 ? 1 : t; }

/*
 * 战略目标库。每个目标：
 *   id, desc
 *   active(ctx): 此目标当前是否是【主目标】（按 RCL/局面选一个）
 *   plan(ctx): 返回 { bias:{type:factor}, text:'...' } —— 为达成此目标的权重调制
 * 顺序 = 优先级（前面的目标优先成为主目标）。防御类目标用 brain 的红线处理，这里管发展。
 */
const GOALS = [
  {
    id: 'survive',
    desc: '生存：维持最低人口与能量，绝不团灭',
    active: (c) => c.creepCount < 3 || (c.energyFill < 0.15 && c.creepCount < 6),
    plan: (c) => {
      // 缺人/缺能 → 强制采集+回填，暂停一切消耗
      return {
        bias: { harvest: 2.2, haul: 1.8, fill: 2.0, upgrade: 0.2, build: 0.1, repair: 0.2 },
        text: `生存模式(creep=${c.creepCount},能量${Math.round(c.energyFill * 100)}%)`,
      };
    },
  },
  {
    id: 'anti_downgrade',
    desc: '防降级：controller 逼近降级是生存级紧急，压倒盖房',
    // controller 降级会丢 RCL，比任何发展都重要。ticksToDowngrade < 2000 视为紧急。
    active: (c) => c.ticksToDowngrade !== undefined && c.ticksToDowngrade < 2000,
    plan: (c) => {
      // 越近降级越狂升级；同时保采集供能，压制建造
      const danger = ramp(2000 - c.ticksToDowngrade, 0, 2000); // 越小越急
      return {
        bias: { upgrade: 3.0 + danger * 2.0, harvest: 1.3, haul: 1.3, build: 0.2, fill: 1.2 },
        text: `防降级紧急(ttd=${c.ticksToDowngrade})`,
      };
    },
  },
  {
    id: 'infra',
    desc: '基建：有工地优先盖完（extension决定身体上限）',
    // rapidGrowth 下只让关键基建阻塞冲级；terminal/lab/extractor/road 等可并行慢建，
    // 不再把整个房间长期锁死在 infra，避免 RCL6→7 被 20 万级可选工程量拖住。
    active: (c) => c.nSites > 0 && (c.rapidGrowth ? c.criticalRemain > 300 : c.remainWork > 300),
    plan: (c) => {
      // 工地多→建造发力，但保证采集/搬运供得上建造
      const blockingWork = c.rapidGrowth ? c.criticalRemain : c.remainWork;
      const urgency = ramp(blockingWork, 300, 4000);
      return {
        bias: { build: 1.5 + urgency * 0.8, haul: 1.3, harvest: 1.2, upgrade: 0.5 },
        text: `基建冲刺(关键剩${blockingWork},总剩${c.remainWork})`,
      };
    },
  },
  {
    id: 'rcl_push',
    desc: '冲级：无紧急工地时全力 upgrade 冲下一个 RCL',
    active: (c) => true, // 兜底主目标：没有更紧急的就冲级
    plan: (c) => {
      // 能量越富余越狂升；但保证采集链供得上
      const surplus = ramp(c.energyFill, 0.3, 1.0);
      return {
        bias: {
          upgrade: 1.3 + surplus * 1.0 + (c.stored > 5000 ? 0.8 : 0),
          harvest: 1.15, haul: 1.15, build: 0.4,
        },
        text: `冲级RCL${c.rcl}→${c.rcl + 1}(能量${Math.round(c.energyFill * 100)}%)`,
      };
    },
  },
];

module.exports = {
  /**
   * 规划：选主目标 + 产出权重调制。
   * @return { bias:{type:factor}, goalId, planText }
   */
  plan(room, brainMem) {
    const ctrl = room.controller;
    const ctx = this._context(room, brainMem);
    // 选第一个 active 的目标作为主目标（顺序=优先级）
    let goal = GOALS[GOALS.length - 1];
    for (const g of GOALS) { if (g.active(ctx)) { goal = g; break; } }
    const out = goal.plan(ctx);
    // 记录计划到 Memory 供观测 + 自适应层使用
    if (brainMem) {
      brainMem.plan = { goalId: goal.id, text: out.text, t: Game.time, ctx: this._slimCtx(ctx) };
    }
    return { bias: out.bias || {}, goalId: goal.id, planText: out.text };
  },

  _context(room, brainMem) {
    const ctrl = room.controller;
    const sites = room.find(FIND_MY_CONSTRUCTION_SITES);
    let remainWork = 0, criticalRemain = 0;
    const criticalTypes = {};
    [
      (typeof STRUCTURE_SPAWN !== 'undefined' ? STRUCTURE_SPAWN : 'spawn'),
      (typeof STRUCTURE_EXTENSION !== 'undefined' ? STRUCTURE_EXTENSION : 'extension'),
      (typeof STRUCTURE_TOWER !== 'undefined' ? STRUCTURE_TOWER : 'tower'),
      (typeof STRUCTURE_STORAGE !== 'undefined' ? STRUCTURE_STORAGE : 'storage'),
      (typeof STRUCTURE_LINK !== 'undefined' ? STRUCTURE_LINK : 'link'),
      (typeof STRUCTURE_CONTAINER !== 'undefined' ? STRUCTURE_CONTAINER : 'container'),
    ].forEach((t) => { criticalTypes[t] = true; });
    for (const s of sites) {
      const left = s.progressTotal - s.progress;
      remainWork += left;
      if (criticalTypes[s.structureType]) criticalRemain += left;
    }
    const storage = room.storage;
    const strategy = Memory.strategy || {};
    return {
      rcl: ctrl ? ctrl.level : 1,
      ticksToDowngrade: ctrl ? ctrl.ticksToDowngrade : undefined,
      creepCount: room.find(FIND_MY_CREEPS).length,
      energyFill: room.energyAvailable / Math.max(1, room.energyCapacityAvailable),
      nSites: sites.length,
      remainWork,
      criticalRemain,
      rapidGrowth: strategy.rapidGrowth !== false && ctrl && ctrl.level >= 6,
      stored: storage ? storage.store[RESOURCE_ENERGY] : 0,
      eRate: brainMem ? (brainMem._eRate || 0) : 0,
    };
  },

  _slimCtx(c) {
    return { rcl: c.rcl, creeps: c.creepCount, eFill: Math.round(c.energyFill * 100), sites: c.nSites, remain: c.remainWork, critical: c.criticalRemain, rapid: c.rapidGrowth };
  },
};

