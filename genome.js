'use strict';

/*
 * genome.js — 进化系统（让大脑的"调参"自己进化出来，而非手写拍脑袋）
 * ==================================================================
 * 用户路线：先弄进化（不搞神经网络/链下学习）。
 *
 * 核心思想（这是【真·自学习】的最小形态，区别于规则引擎）：
 *   - worldmodel 的【物理公式】是游戏真值，不进化（改了就错）。
 *   - 但大脑里一堆【我拍脑袋定的系数】（proximity衰减、continuity加成、各权重斜率…）
 *     本不该由我猜，应由【进化】根据真实表现找出最优。
 *   - 这些系数收进 genome（基因组），存 Memory.brain.genome。
 *   - 用【真实适应度】(controller progress 增速，游戏铁律，作弊不了)评估。
 *   - 周期性变异 + 保留更优 = (1+1) 进化策略（爬山+随机扰动）。
 *
 * 为什么这是真自学习而非自欺：
 *   适应度 = 真实长期产出（progress/tick），不是大脑自己算的分。
 *   大脑无法通过"调高自评分"作弊——progress 是游戏按物理结算的硬指标。
 *   若某次变异让 progress 真涨了，才保留；否则回滚。这是无法自欺的爬山。
 */

// 基因定义：每个可进化系数 [默认值, 最小, 最大]
const GENES = {
  // utility 因子
  proxDecay:    [0.04, 0.01, 0.15],   // 距离衰减率（大=更看重近）
  contBonus:    [1.35, 1.0, 2.0],     // 连续性奖励（大=更不爱换任务）
  harvestEnerW: [0.6, 0.2, 1.0],      // harvest 能量状态权重
  haulEnerW:    [0.7, 0.3, 1.0],      // haul 空载偏好强度
  useEnerW:     [0.8, 0.3, 1.0],      // 用能任务满载偏好强度
  // brain 战略斜率
  harvestBase:  [1.4, 1.0, 2.2],      // 采集基础权重
  haulBase:     [1.2, 0.8, 2.0],      // 搬运基础权重
  upgradeGain:  [1.5, 0.5, 3.0],      // 富余时升级权重增益
  buildUrgency: [1.4, 0.5, 2.5],      // 建造紧急度斜率
  fillStarve:   [1.5, 0.5, 3.0],      // 饥荒时回填强度
  // 市场
  candPerType:  [4, 2, 8],            // 每类候选数（CPU vs 质量权衡）
};

module.exports = {
  GENES,

  /** 读当前基因组（不存在则用默认值初始化）。返回 {geneName: value} */
  current(brainMem) {
    if (!brainMem.genome) {
      const g = {};
      for (const k in GENES) g[k] = GENES[k][0];
      brainMem.genome = { genes: g, fitness: null, gen: 0, baselineProg: null, evalStart: Game.time };
    }
    return brainMem.genome.genes;
  },

  /**
   * 进化一步（(1+1)-ES：评估当前基因→若优于历史最优则保留，否则回滚→变异产生挑战者）。
   * 每 EVAL_TICKS 调一次。适应度 = 这段时间 controller progress 增速（真实硬指标）。
   * @param room
   * @param brainMem  Memory.brain
   */
  evolve(room, brainMem, EVAL_TICKS) {
    EVAL_TICKS = EVAL_TICKS || 300;
    const G = brainMem.genome || (this.current(brainMem), brainMem.genome);
    const ctrl = room.controller;
    // ⭐ 适应度信号修复(2026-06-23): 不再用 level*1e7 + progress。
    // 原公式在 RCL 升级瞬间 prog 暴跳 1e7, 造成 fitness 假峰(33000)/假谷(-16000),
    // 把真实的微小增速(0.07)当噪声淹没 => 进化 30 代原地踏步。
    // 改为: 只用同级 progress 增量作适应度; 跨级的评估窗口作废(不参与比较)。
    const level = ctrl ? ctrl.level : 0;
    const prog = ctrl ? (ctrl.progress || 0) : 0;

    if (G.baselineProg === null) { G.baselineProg = prog; G.baselineLevel = level; G.evalStart = Game.time; return; }
    if (Game.time - G.evalStart < EVAL_TICKS) return;

    // ⭐ 跨级作废: 评估窗口内 RCL 变了 => progress 被重置/换算, 增量不可比, 跳过本次。
    if (level !== G.baselineLevel) {
      G.baselineProg = prog; G.baselineLevel = level; G.evalStart = Game.time;
      G.history = (G.history || []).slice(-9);
      G.history.push({ gen: G.gen, fitness: null, kept: false, skipped: 'levelup' });
      return;
    }

    // —— 评估：这段时间的真实同级 progress 增速 ——
    const dt = Game.time - G.evalStart;
    const fitness = (prog - G.baselineProg) / dt; // progress/tick，越高越好

    if (G.best === undefined) {
      // 首次评估 = 建立 champion 基线
      G.best = { genes: this._clone(G.genes), fitness };
      G.champion = this._clone(G.genes);
      G.history = [{ gen: G.gen, fitness: Math.round(fitness * 100) / 100, kept: true }];
    } else {
      // ⭐ 一次性迁移(2026-06-23): 旧 fitness 含 level*1e7 污染, best.fitness 可能是 33000 这种假高分。
      // 干净信号下低 RCL 的 progress/tick 不可能超 1000。检到污染值则重置 champion 基线。
      if (G.best.fitness > 1000) {
        G.best = { genes: this._clone(G.genes), fitness };
        G.champion = this._clone(G.genes);
      }
      // 当前是挑战者：和 champion 比
      const improved = fitness > G.best.fitness * 1.02; // 需真涨 >2% 才算赢（抗噪声）
      if (improved) {
        G.best = { genes: this._clone(G.genes), fitness };
        G.champion = this._clone(G.genes);
      } else {
        // 挑战失败 → 回滚到 champion
        G.genes = this._clone(G.champion);
      }
      G.history = (G.history || []).slice(-9);
      G.history.push({ gen: G.gen, fitness: Math.round(fitness * 100) / 100, kept: improved });
    }

    // —— 产生新挑战者：变异 champion ——
    G.genes = this._mutate(this._clone(G.champion));
    G.gen += 1;
    G.baselineProg = prog;
    G.baselineLevel = level;
    G.evalStart = Game.time;
    G.lastFitness = Math.round(fitness * 100) / 100;
  },

  /** 高斯式变异：随机挑 1-2 个基因小幅扰动（爬山式探索） */
  _mutate(genes) {
    const keys = Object.keys(GENES);
    const nMut = 1 + Math.floor(Math.random() * 2); // 变异 1-2 个基因
    for (let i = 0; i < nMut; i++) {
      const k = keys[Math.floor(Math.random() * keys.length)];
      const [, lo, hi] = GENES[k];
      const range = hi - lo;
      // 扰动幅度 = 范围的 ±15%
      const delta = (Math.random() - 0.5) * 2 * range * 0.15;
      genes[k] = Math.max(lo, Math.min(hi, genes[k] + delta));
    }
    return genes;
  },

  _clone(o) { const r = {}; for (const k in o) r[k] = o[k]; return r; },
};
