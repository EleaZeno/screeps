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

  /** 读进化基因（缺失用默认）。让 brain 的战略斜率真正由进化决定，而非写死。 */
  _genes(b) {
    if (b && b.genome && b.genome.genes) return b.genome.genes;
    return { harvestBase: 1.4, haulBase: 1.2, upgradeGain: 1.5, buildUrgency: 1.4, fillStarve: 1.5 };
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

    // ⭐ 接通进化基因：基础权重不再写死，由 genome 进化决定（修复进化空转）
    const G = this._genes(b);
    const w = {
      harvest: G.harvestBase, haul: G.haulBase, fill: 1.0, store: 0.7,
      upgrade: 1.0, build: 1.0, repair: 0.8, defend: 0.01,
    };

    // ============ 前瞻 1：敌人 ETA + 威胁强度 ============
    // 不等贴脸——算最近敌人到 spawn 的步数和它的攻击能力，提前按"还有几 tick"布防
    // 【修复 2026-06-24·空耗：追无害侦察兵】原逻辑对任意敌方 creep 都 threat += max(1,atk)，
    //   导致一个纯 MOVE 的 1 身侦察兵(0 攻击)也触发 w.defend=2.0+，把没有 ATTACK 部件的
    //   工人拉去 defend(fitness 仅 0.05)，徒劳追逐一个追不上、也打不动的侦察兵 → RCL 进度被拖。
    //   真正构成威胁的是带 ATTACK/RANGED_ATTACK(或 WORK 拆迁/CLAIM 降级)的敌人。无攻击部件的
    //   纯侦察兵在新手保护期下零威胁，应忽略，让殖民地专心冲级。
    const allHostiles = room.find(FIND_HOSTILE_CREEPS);
    const threatening = allHostiles.filter((h) => {
      if (!h.getActiveBodyparts) return true; // 拿不到 body 信息保守视为威胁
      const _CLAIM = (typeof CLAIM !== 'undefined') ? CLAIM : 'claim';
      const atk = h.getActiveBodyparts(ATTACK);
      const rng = h.getActiveBodyparts(RANGED_ATTACK);
      const work = h.getActiveBodyparts(WORK); // 可拆建筑
      const claim = h.getActiveBodyparts(_CLAIM); // 可降级/夺控
      return (atk + rng + work + claim) > 0;
    });
    if (threatening.length > 0) {
      const spawn = room.find(FIND_MY_SPAWNS)[0];
      let minEta = 50, threat = 0;
      for (const h of threatening) {
        const atk = h.getActiveBodyparts ? (h.getActiveBodyparts(ATTACK) + h.getActiveBodyparts(RANGED_ATTACK) * 1.5 + h.getActiveBodyparts(WORK) * 0.5 + h.getActiveBodyparts((typeof CLAIM !== 'undefined') ? CLAIM : 'claim') * 1.0) : 4;
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
    // 诊断里记录"真威胁数 vs 总敌数"，便于线上区分侦察兵骚扰与真攻击
    const hostiles = threatening; // 下游诊断沿用真威胁列表

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
    // ⭐ 2026-07-01 keystone 检测: storage/controller 旁的 link 是能量物流总开关。
    //   有这种工地时, build 不能被 ramp/spendCap 压到饿死(线上实测 link 卡 4786/5000)。
    let hasKeystone = false;
    const _LINK = (typeof STRUCTURE_LINK !== 'undefined') ? STRUCTURE_LINK : 'link';
    for (const s of sites) {
      if (s.structureType === _LINK && s.pos && s.pos.inRangeTo) {
        if ((room.storage && s.pos.inRangeTo(room.storage, 2)) ||
            (room.controller && s.pos.inRangeTo(room.controller, 2))) { hasKeystone = true; break; }
      }
    }
    if (nSites > 0) {
      // 剩余工程多 → build 高；剩余少(快完工) → build 平滑下降。斜率由进化基因 buildUrgency 决定。
      const buildRamp = ramp(remainWork, 200, 3000); // 工程量 200..3000 映射强度
      w.build = 0.8 + buildRamp * (G.buildUrgency + 0.4);   // 激进：建造发力更猛
      // ⭐ 修复 2026-07-01: 旧 bug=快完工(remainWork小)→buildRamp≈0→build权重≈0.8 再被 spendCap
      //   压到 0.32 → 96% 的工地永远没人建完(线上实测 link 卡 4786/5000)。
      //   给"工地存在"一个 build 地板(2.0), keystone 工地给压倒性权重(5.0)确保插队建成。
      if (hasKeystone) w.build = Math.max(w.build, 5.0);
      else w.build = Math.max(w.build, 2.0);
      // 工地存在时 upgrade 基础压低，但降级风险通过 downgradeBoost 顶上来
      w.upgrade = 0.6 + (1 - buildRamp) * 0.8 + downgradeBoost;
    } else {
      // 无工地 → 能量全砸升级冲 RCL，富余越多越狂。增益由进化基因 upgradeGain 决定。
      w.build = 0.3;
      w.upgrade = 1.0 + energyFill * G.upgradeGain + (stored > 5000 ? 1.2 : 0) + downgradeBoost;
    }

    // ============ 前瞻 4：能量趋势预测（会不会饿死）============
    // 用净流入速率预测：若速率为负且当前不满，提前抬 fill/harvest 而非等空了才救
    const eRate = b._eRate || 0;
    if (eRate < -0.5 && energyFill < 0.8) {
      const starve = ramp(-eRate, 0, 10) * (1 - energyFill); // 流出越快+越空 → 越紧急
      w.fill += starve * G.fillStarve;
      w.harvest += starve * 0.6; // 顺带催采集补源头
    }
    // 静态缺能量保孵化（保底，v1 逻辑保留）
    w.fill += (1 - energyFill) * 0.8;

    // ============ 维修：RCL≥3 有 tower 后稍升 ============
    w.repair = rcl >= 3 ? 1.0 : 0.6;

    // 记录诊断（供你在控制台看大脑"在想什么"）
    b._diag = {
      t: Game.time, rcl, nSites, remainWork, room: room.name,
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
      // ⭐ 激进改造：原硜上限 1.5x 压死建设/升级，能量囤再多也烧不出去。
      // 改为动态上限：能量越囤积（当前能量满+storage存货多），升级/建造越该狂烧（到 4x）。
      // 这是“能量产出>消费”的客观经济事实要求增加消费端，而非调参。
      // ★ 配时旋钮：storage 囤积对烧钱上限的放大权重由基因 spendBacklogK 决定（不再写死 0.6）。
      const _k = (typeof G.spendBacklogK === 'number' && isFinite(G.spendBacklogK)) ? G.spendBacklogK : 0.6;
      const backlogRatio = Math.min(1, energyFill * (1 - _k) + ramp(stored, 0, 20000) * _k);
      const spendCap = 1.5 + backlogRatio * 2.5; // 1.5x(缺能) .. 4.0x(囤积狂烧)
      w.upgrade = Math.min(w.upgrade, harvestFloor * spendCap);
      // ⭐ keystone build(物流总开关一次性建成)豁免 spendCap 钳制; 普通 build 仍受约束防失业
      if (!hasKeystone) w.build = Math.min(w.build, harvestFloor * spendCap);
      b._diag.spendCap = Math.round(spendCap * 100) / 100;
    }

    // 多房观测修复（2026-07-01）：_diag 是单个共享槽，多房时会被最后处理的房覆盖（
    // 新殖民地 RCL1/survive 会掩盖主房 RCL5 健康态，造成诊断假警报）。额外再写一份按房名索
    // 引的 _diagByRoom，不动原有 _diag（向后兼容），供外部探针逐房回读真实状态。
    if (!b._diagByRoom) b._diagByRoom = {};
    b._diagByRoom[room.name] = b._diag;

    return w;
  },
};

