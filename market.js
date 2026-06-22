'use strict';

/*
 * market.js — L1/L2 任务市场撮合（大脑的"调度中枢"）
 * ==================================================================
 * 把任务池分配给 creep。核心机制 = 贪心拍卖 + 容量饱和。
 *
 * 算法（每 tick）：
 *  1. 对所有 (creep, task) 算效用分
 *  2. 按分数从高到低排序所有 (creep, task) 配对
 *  3. 贪心认领：从最高分开始，若 creep 未分配 且 task 未满容量 → 成交
 *  4. 重复直到所有 creep 都有任务 或 无可分配任务
 *
 * 这天然解决：
 *  - 4 creep 挤一格：harvest 任务 capacity=1，第一个占了就满，其余自动去别处
 *  - 负载均衡：高价值任务先被最合适的 creep 抢，次合适的去次任务
 *  - 无 if 嵌套：纯排序 + 容量检查
 *
 * 复杂度：creep × task 配对。RCL2~4 通常 <20 creep × <40 task = 800 配对，
 *   CPU 完全可接受（我们才用 3-5/20）。大房间可加距离剪枝。
 */

const utility = require('utility');

module.exports = {
  /**
   * 撮合：给每个 creep 分配一个最优任务。
   * 返回 Map<creepName, task>，同时写入 creep.memory.taskId 供连续性使用。
   * @param creeps  本房间我方 creep 数组
   * @param tasks   blackboard 产出的任务池
   * @param weights 战略层权重
   */
  assign(creeps, tasks, weights) {
    const assignment = {}; // creepName -> task
    if (!creeps.length || !tasks.length) {
      // 没任务时清空所有 creep 的 taskId（让它们 idle，executor 决定兜底）
      creeps.forEach((c) => { delete c.memory.taskId; });
      return assignment;
    }

    // 1. 生成 (creep, task) 配对及其效用分
    //    【CPU 优化：距离剖枝】不再暴力算所有 creep×task。
    //    对每个 creep，同类任务按距离预排序只取最近 CAND_PER_TYPE 个（最近的同类
    //    效用必然最高，不改变最优解）+ 高价值任务。把 O(N×M) 压到 ≈O(N×k)。
    const CAND_PER_TYPE = (typeof Memory !== 'undefined' && Memory.brain && Memory.brain.genome && Memory.brain.genome.genes)
      ? Math.round(Memory.brain.genome.genes.candPerType || 4) : 4;
    // 按类型分桶
    const byType = {};
    for (const task of tasks) (byType[task.type] = byType[task.type] || []).push(task);
    const pairs = [];
    for (const creep of creeps) {
      const cx = creep.pos.x, cy = creep.pos.y, cr = creep.room.name;
      for (const type in byType) {
        let cand = byType[type];
        // 同类任务多于阈值时，按距离预排序取最近几个（廉价切比雪夫距离）
        if (cand.length > CAND_PER_TYPE) {
          cand = cand.slice().sort((a, b) => {
            const da = a.pos && a.pos.roomName === cr ? Math.max(Math.abs(a.pos.x - cx), Math.abs(a.pos.y - cy)) : 99;
            const db = b.pos && b.pos.roomName === cr ? Math.max(Math.abs(b.pos.x - cx), Math.abs(b.pos.y - cy)) : 99;
            return da - db;
          }).slice(0, CAND_PER_TYPE);
        }
        for (const task of cand) {
          const s = utility.score(creep, task, weights);
          if (s > 0) pairs.push({ creep, task, score: s });
        }
      }
    }

    // 2. 按分数降序
    pairs.sort((a, b) => b.score - a.score);

    // 3. 贪心认领
    const taskLoad = {}; // taskId -> 已认领数
    for (const p of pairs) {
      const cn = p.creep.name;
      if (assignment[cn]) continue;                 // 该 creep 已有任务
      const load = taskLoad[p.task.id] || 0;
      if (load >= p.task.capacity) continue;          // 该任务已满
      // 成交
      assignment[cn] = p.task;
      taskLoad[p.task.id] = load + 1;
      p.creep.memory.taskId = p.task.id;
      p.creep.memory.taskType = p.task.type;
      p.creep.memory.taskTarget = p.task.targetId;
      if (p.task.meta && p.task.meta.slot) p.creep.memory.slot = p.task.meta.slot;
    }

    // 4. 未分到任务的 creep 清空 taskId（executor 会给兜底行为）
    for (const creep of creeps) {
      if (!assignment[creep.name]) {
        delete creep.memory.taskId;
        delete creep.memory.taskType;
      }
    }

    return assignment;
  },

  /**
   * 市场缺口分析：哪些任务类型供不应求（用于 spawning 决定造什么 body）。
   * 返回每种任务类型的 "未满足容量"（capacity - assigned），越大越缺人。
   */
  shortage(tasks, assignment) {
    const taskLoad = {};
    for (const cn in assignment) {
      const t = assignment[cn];
      taskLoad[t.id] = (taskLoad[t.id] || 0) + 1;
    }
    const gap = {}; // type -> 未满足容量总和（按价值加权）
    for (const task of tasks) {
      const load = taskLoad[task.id] || 0;
      const unmet = Math.max(0, task.capacity - load);
      if (unmet > 0) {
        gap[task.type] = (gap[task.type] || 0) + unmet * task.baseValue;
      }
    }
    return gap;
  },
};
