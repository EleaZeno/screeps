'use strict';

/*
 * utility.js — L1 效用函数库（大脑的"判断力"）
 * ==================================================================
 * 给每个 (creep, task) 组合打一个连续分数。谁分高谁干。
 * 这是【替代所有 if 嵌套决策】的核心：不写"如果...就..."，只算分。
 *
 * 总效用：
 *   U(c,t) = task.value(t, weights)        // 任务价值 × 战略权重
 *          × fitness(c, t)                 // creep 身体胜任度 [0..1]
 *          × proximity(c, t)               // 距离衰减
 *          × continuity(c, t)              // 连续性奖励（防抖动迟滞）
 *          × energyState(c, t)             // 空载/满载是否匹配任务
 *
 * 全连续函数，无悬崖，无 if 嵌套分支决策。
 */

module.exports = {
  /** 读当前基因系数（进化产物，不再是写死的拍脑袋值）。缺失时用默认。 */
  _genes() {
    if (typeof Memory !== 'undefined' && Memory.brain && Memory.brain.genome && Memory.brain.genome.genes) {
      return Memory.brain.genome.genes;
    }
    return { proxDecay: 0.04, contBonus: 1.35, harvestEnerW: 0.6, haulEnerW: 0.7, useEnerW: 0.8 };
  },

  /** 任务的最终价值 = 基础价值 × 战略层权重 */
  taskValue(task, weights) {
    const w = (weights && weights[task.type]) != null ? weights[task.type] : 1;
    return task.baseValue * w;
  },

  /** 主效用函数：creep 对某任务的总评分 */
  score(creep, task, weights) {
    const value = this.taskValue(task, weights);
    const fit = this.fitness(creep, task);
    if (fit <= 0) return 0; // 完全不胜任直接 0（如无 WORK 的去 build）
    const prox = this.proximity(creep, task);
    const cont = this.continuity(creep, task);
    const ener = this.energyState(creep, task);
    return value * fit * prox * cont * ener;
  },

  /** 身体胜任度 [0..1] —— 【世界模型升级】
   * 不再是启发式 WORK/5，而是用 worldmodel 算出该 creep 做该任务的【真实吞吐率】，
   * 归一化到 [0..1]。这让大脑理解"重 WORK 去静采、重 CARRY 去搬运"是因为那确实吞吐最高
   * （涵义涵现），而非因为写了规则。fitness=0 仅在物理上不胜任。 */
  fitness(creep, task) {
    const wm = require('worldmodel');
    const p = wm.parts(creep);
    switch (task.type) {
      case 'harvest': if (p.work === 0) return 0; break;
      case 'haul': if (p.carry === 0) return 0; break;
      case 'fill': if (p.carry === 0) return 0; break;
      case 'upgrade': case 'build': case 'repair': if (p.work === 0 || p.carry === 0) return 0; break;
      case 'defend': return (p.attack + p.ranged) > 0 ? Math.min(1, (p.attack + p.ranged) / 4) : 0.05;
      default: return 0.5;
    }
    const tp = wm.taskThroughput(creep, task, 5);
    const CAP = { harvest: wm.SOURCE_REGEN_RATE, haul: 12, fill: 12, upgrade: 8, build: 25, repair: 25 };
    const cap = CAP[task.type] || 10;
    return Math.max(0.05, Math.min(1, tp / cap));
  },

  /** 距离衰减：越近效用越高。1/(1+dist*k) */
  proximity(creep, task) {
    if (!task.pos || task.pos.roomName !== creep.room.name) return 0.3; // 跨房先给低值
    const dx = creep.pos.x - task.pos.x;
    const dy = creep.pos.y - task.pos.y;
    const dist = Math.max(Math.abs(dx), Math.abs(dy)); // 切比雪夫距离（Screeps 8向移动）
    return 1 / (1 + dist * this._genes().proxDecay); // k 由基因进化
  },

  /** 连续性奖励（迟滞）：加成由基因进化 */
  continuity(creep, task) {
    return creep.memory.taskId === task.id ? this._genes().contBonus : 1.0;
  },

  /**
   * 能量状态匹配：核心的"空载去取能、满载去送货"逻辑，但用连续函数表达。
   *  - 取能类任务(harvest/haul-from)：creep 越空越该做
   *  - 用能类任务(upgrade/build/fill/repair)：creep 越满越该做
   */
  energyState(creep, task) {
    const cap = creep.store.getCapacity(RESOURCE_ENERGY) || 1;
    const cur = creep.store[RESOURCE_ENERGY] || 0;
    const fillRatio = cur / cap; // 0=空, 1=满
    const g = this._genes();
    switch (task.type) {
      case 'harvest':
        return (1 - g.harvestEnerW) + (1 - fillRatio) * g.harvestEnerW; // 空载偏好，强度由基因
      case 'haul':
        return (1 - g.haulEnerW) + (1 - fillRatio) * g.haulEnerW; // 空载去取货
      case 'fill':
      case 'upgrade':
      case 'build':
      case 'repair':
        return (1 - g.useEnerW) + fillRatio * g.useEnerW; // 满载去用能
      case 'defend':
        return 1.0; // 防御不看能量
      default:
        return 1.0;
    }
  },
};

