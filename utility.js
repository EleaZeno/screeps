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

  /** 身体胜任度：creep 的部件是否适合这个任务 [0..1] */
  fitness(creep, task) {
    const body = creep.body;
    const work = body.filter((p) => p.type === WORK).length;
    const carry = body.filter((p) => p.type === CARRY).length;
    const attack = body.filter((p) => p.type === ATTACK || p.type === RANGED_ATTACK).length;
    switch (task.type) {
      case 'harvest':
        return work > 0 ? Math.min(1, work / 5) : 0; // WORK 越多越胜任，满 5 WORK 封顶
      case 'haul':
        return carry > 0 ? Math.min(1, carry / 6) : 0; // 纯搬运看 CARRY
      case 'fill':
        return carry > 0 ? Math.min(1, carry / 4) : 0;
      case 'upgrade':
      case 'build':
      case 'repair':
        return work > 0 && carry > 0 ? Math.min(1, (work + carry) / 8) : 0; // 既要 WORK 也要 CARRY
      case 'defend':
        return attack > 0 ? Math.min(1, attack / 4) : 0.05; // 无攻击部件几乎不胜任（但非0，紧急时肉盾）
      default:
        return 0.5;
    }
  },

  /** 距离衰减：越近效用越高。1/(1+dist*k) */
  proximity(creep, task) {
    if (!task.pos || task.pos.roomName !== creep.room.name) return 0.3; // 跨房先给低值
    const dx = creep.pos.x - task.pos.x;
    const dy = creep.pos.y - task.pos.y;
    const dist = Math.max(Math.abs(dx), Math.abs(dy)); // 切比雪夫距离（Screeps 8向移动）
    return 1 / (1 + dist * 0.04); // dist=0→1.0, dist=25→0.5, dist=50→0.33
  },

  /** 连续性奖励（迟滞）：若 creep 上 tick 就在做这个任务，加成，防止来回改主意 */
  continuity(creep, task) {
    return creep.memory.taskId === task.id ? 1.35 : 1.0;
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
    switch (task.type) {
      case 'harvest':
        // miner 钉着采（能量直接掉container），空载更该去；但满WORK矿工不太在乎自身store
        return 0.4 + (1 - fillRatio) * 0.6; // 空→1.0, 满→0.4
      case 'haul':
        return 0.3 + (1 - fillRatio) * 0.7; // 空载去取货：空→1.0, 满→0.3
      case 'fill':
      case 'upgrade':
      case 'build':
      case 'repair':
        return 0.2 + fillRatio * 0.8; // 满载去用能：满→1.0, 空→0.2
      case 'defend':
        return 1.0; // 防御不看能量
      default:
        return 1.0;
    }
  },
};
