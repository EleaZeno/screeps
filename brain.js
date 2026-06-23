'use strict';

/*
 * brain.js — L3 战略层 v2（前瞻预测版 / Lookahead Strategist）
 * ==================================================================
 * 升级要点（相比 v1 纯反应式）：
 *   1. 前瞻预测 lookahead：不再只看"当前状态"，而是预测"未来事件的提前量"
 *      - 降级倒计时：连续提前增援（越近越猛），而非 <3000 才硬跳
 *      - 敌人 ETA + 威胁强度：算敌人到家步数 × 攻击部件，提前布防
 *      - 能量趋势：用 Memory 里上次能量差预测"会不会饿"，提前回填
 *      - 工地完工预判：剩余工程量小则平滑把重心移向 upgrade，不浪费 tick
 *   2. 全连续：所有权重是平滑函数，无硬 if 跳变（除安全红线 defend）
 *   3. 低 CPU：每 STRATEGY_INTERVAL tick 算一次，结果缓存到 Memory.brain.weights
 *
 * 仍只回答一个问题："当前+不久的将来，殖民地重心该偏向哪几类活？"
 * 微观执行交给 market/utility/executor。
 */

const STRATEGY_INTERVAL = 5;
const planner = require('planner');
const adaptive = require('adaptive');

// —— 平滑工具：把 x 从 [a,b] 映射到 [0,1]，超界 clamp ——
function ramp(x, a, b) {
  if (b === a) return x >= b ? 1 : 0;
  const t = (x - a) / (b - a);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

module.exports = {
  think(room) {
    if (!Memory.brain) Memory.brain = {};
    const b = Memory.brain;
    // 即使用缓存权重，也每 tick 记一次能量样本，供趋势预测（极低开销）
    this._sampleEnergy(room, b);
    if (b.weights && b.nextThink && Game.time < b.nextThink) {
      return b.weights;
    }
    b.weights = this._compute(room, b);
    b.nextThink = Game.time + STRATEGY_INTERVAL;
    return b.weights;
  },

  /** 每 tick 记录能量，用于趋势预测（指数滑动平均的净流入速率） */
  _sampleEnergy(room, b) {
    const cur = room.energyAvailable;
    if (b._lastE === undefined) { b._lastE = cur; b._eRate = 0; return; }
    const delta = cur - b._lastE;
    // EMA 平滑净流入速率（alpha=0.3）
    b._eRate = (b._eRate || 0) * 0.7 + delta * 0.3;
    b._lastE = cur;
  },

  _compute(room, b) {
    const ctrl = room.controller;
    const rcl = ctrl ? ctrl.level : 1;
    const cap = room.energyCapacityAvailable;
    const cur = room.energyAvailable;
    const energyFill = cur / Math.max(1, cap);
    const sites = room.find(FIND_MY_CONSTRUCTION_SITES);
    const nSites = sites.length;
    const storage = room.storage;
    const stored = storage ? storage.store[RESOURCE_ENERGY] : 0;

    const w = {
      harvest: 1.4, haul: 1.2, fill: 1.0,
      upgrade: 1.0, build: 1.0, repair: 0.8, defend: 0.01,
    };

    // ============ 前瞻 1：敌人 ETA + 威胁强度 ============
    // 不等贴脸——算最近敌人到 spawn 的步数和它的攻击能力，提前按"还有几 tick"布防
    const hostiles = room.find(FIND_HOSTILE_CREEPS);
    if (hostiles.length > 0) {
      const spawn = room.find(FIND_MY_SPAWNS)[0];
      let minEta = 50, threat = 0;
      for (const h of hostiles) {
        const atk = h.getActiveBodyparts ? (h.getActiveBodyparts(ATTACK) + h.getActiveBodyparts(RANGED_ATTACK) * 1.5 + h.getActiveBodyparts(WORK) * 0.5) : 4;
        threat += Math.max(1, atk);
        if (spawn) {
          const d = Math.max(Math.abs(h.pos.x - spawn.pos.x), Math.abs(h.pos.y - spawn.pos.y));
          if (d < minEta) minEta = d;
        }
      }
      // 越近(eta小)、威胁越大 → defend 越高。eta 远时也保持基础警戒。
      const proximity = 1 - ramp(minEta, 0, 30); // 贴脸=1，30格外≈0
      w.defend = 2.0 + threat * 0.4 + proximity * 4.0; // 预判：敌人还在路上就开始拉防御
      // 受威胁时回填 spawn 优先（要能孵防御 creep）
      w.fill += 1.0;
    }

    // ============ 前瞻 2：降级倒计时连续增援 ============
    // v1 是 <3000 硬跳 1.5；这里改成"越接近降级，upgrade 提前量越大"的连续斜坡
    let downgradeBoost = 0;
    if (ctrl && ctrl.ticksToDowngrade !== undefined) {
      // ticksToDowngrade 从 10000→0，越小越危险。5000 开始关注，1000 内拉满
      const danger = 1 - ramp(ctrl.ticksToDowngrade, 1000, 5000);
      downgradeBoost = danger * 2.5; // 最高 +2.5，平滑提前
    }

    // ============ 前瞻 3：建造完工预判 ============
    // 算剩余总工程量，工地快完了就平滑把重心从 build 移向 upgrade（不浪费 tick）
    let remainWork = 0;
    for (const s of sites) remainWork += (s.progressTotal - s.progress);
    if (nSites > 0) {
      // 剩余工程多 → build 高；剩余少(快完工) → build 平滑下降
      const buildUrgency = ramp(remainWork, 200, 3000); // 工程量 200..3000 映射强度
      w.build = 0.6 + buildUrgency * 1.4;               // 0.6 .. 2.0
      // 工地存在时 upgrade 基础压低，但降级风险通过 downgradeBoost 顶上来
      w.upgrade = 0.5 + (1 - buildUrgency) * 0.6 + downgradeBoost;
    } else {
      // 无工地 → 能量全砸升级冲 RCL，富余越多越狂
      w.build = 0.3;
      w.upgrade = 1.0 + energyFill * 1.5 + (stored > 5000 ? 1.0 : 0) + downgradeBoost;
    }

    // ============ 前瞻 4：能量趋势预测（会不会饿死）============
    // 用净流入速率预测：若速率为负且当前不满，提前抬 fill/harvest 而非等空了才救
    const eRate = b._eRate || 0;
    if (eRate < -0.5 && energyFill < 0.8) {
      const starve = ramp(-eRate, 0, 10) * (1 - energyFill); // 流出越快+越空 → 越紧急
      w.fill += starve * 1.5;
      w.harvest += starve * 0.6; // 顺带催采集补源头
    }
    // 静态缺能量保孵化（保底，v1 逻辑保留）
    w.fill += (1 - energyFill) * 0.8;

    // ============ 维修：RCL≥3 有 tower 后稍升 ============
    w.repair = rcl >= 3 ? 1.0 : 0.6;

    // 记录诊断（供你在控制台看大脑"在想什么"）
    b._diag = {
      t: Game.time, rcl, nSites, remainWork,
      eRate: Math.round(eRate * 10) / 10,
      hostiles: hostiles.length, downgradeBoost: Math.round(downgradeBoost * 100) / 100,
    };

    // ============ L4 规划层调制：planner 选主目标 → 乘性调制权重 ============
    // brain 算出"看当下+前瞻"的权重后，planner 用"远见/计划"再做一次顶层调制。
    // 防御红线不被规划覆盖（生存/安全优先级最高，单独保护）。
    const savedDefend = w.defend;
    const { bias, goalId, planText } = planner.plan(room, b);
    for (const type in bias) {
      if (w[type] !== undefined) w[type] *= bias[type];
    }
    w.defend = Math.max(w.defend, savedDefend); // 防御不被规划削弱
    b._diag.goal = goalId;
    b._diag.plan = planText;

    // ============ L5 自适应反馈：主目标乏力时疏通经济命脉 ============
    // adaptive 检测到如“冲级却进度不涨”→ 多半是采集/运输链断，提升 harvest/haul 疏通
    const stale = adaptive.stalenessBoost(b);
    if (stale > 0) {
      w.harvest += stale * 0.8;
      w.haul += stale * 0.8;
      b._diag.stale = Math.round(stale * 100) / 100;
    }

    // ============ ⭐ 分工流水线保护：采集/运输是"挖金"，升级/建造是"花钱" ============
    // 核心原则：花钱的优先级绝不能碌压挖金的，否则大家抢着升级、没人采矿喚 container
    // (这正是用户看到的"不分工、自采自用"的根因)。保证采集权重不低于升级。
    // 例外：防降级紧急(downgradeBoost大)时允许升级临时超过。
    if (downgradeBoost < 1.0) {
      const harvestFloor = w.harvest;       // 采集是流水线源头，作为地板
      w.upgrade = Math.min(w.upgrade, harvestFloor * 1.5); // 升级最多是采集的 1.5 倍
      w.build = Math.min(w.build, harvestFloor * 1.5);
    }

    return w;
  },
};
