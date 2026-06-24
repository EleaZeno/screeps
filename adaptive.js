'use strict';

/*
 * adaptive.js — L5 自适应学习层（大脑的"经验沉淀，越用越聪明"）
 * ==================================================================
 * 用户母题落地：自主存档有用经验、不靠人反复改代码就能变聪明。
 *
 * 核心机制（轻量强化，纯数据驱动，CPU 极低）：
 *   1. 每 EVAL_INTERVAL tick 记一次"绩效快照"：controller progress 速率 + 经济健康。
 *   2. 把"当前主目标(goalId) + 关键调制参数"和"这段时间的绩效增量"关联。
 *   3. 维护 playbook：{ goalId: { samples, avgGain } } —— 每个目标历史平均收益。
 *   4. 若某目标长期低收益（如冲级时 progress 不涨=被卡），给 brain 一个"该目标乏力"
 *      的信号 staleness，brain 可据此微调（如基建卡住时提示该补采集）。
 *
 * 关键：经验是 Memory.brain.playbook 里的【数据】，不是代码。
 *   大脑调自己的认知，不用 grunt 重新部署。这是"自进化"的最小可用形态。
 *
 * 不做：不引入会破坏稳定性的激进自改参数（避免 wireheading/震荡）。
 *   只做"记录+评估+乏力预警"，把调节幅度控制在安全小范围，可解释可回滚。
 */

const EVAL_INTERVAL = 30; // 每 30 tick 评估一次（约半分钟）

module.exports = {
  /**
   * 每 tick 调用（极低开销，到点才真评估）。
   * @param room
   * @param brainMem  Memory.brain
   */
  observe(room, brainMem) {
    if (!brainMem) return;
    if (!brainMem.playbook) brainMem.playbook = {};
    if (!brainMem.learn) brainMem.learn = {};
    const L = brainMem.learn;
    const ctrl = room.controller;
    const prog = ctrl ? (ctrl.level * 1e6 + (ctrl.progress || 0)) : 0; // 单调累计进度

    if (L.lastProg === undefined) {
      L.lastProg = prog; L.lastEvalT = Game.time; return;
    }
    if (Game.time - L.lastEvalT < EVAL_INTERVAL) return;

    // —— 到点评估：算这段时间的进度增益速率 ——
    const dt = Game.time - L.lastEvalT;
    const gain = (prog - L.lastProg) / dt; // 每 tick 进度增益
    const goalId = (brainMem.plan && brainMem.plan.goalId) || 'unknown';

    // 更新 playbook：该目标的滑动平均收益
    const pb = brainMem.playbook[goalId] || { samples: 0, avgGain: 0 };
    pb.avgGain = pb.avgGain * 0.8 + gain * 0.2; // EMA
    pb.samples += 1;
    pb.lastGain = Math.round(gain * 100) / 100;
    brainMem.playbook[goalId] = pb;

    // —— 乏力检测：当前主目标若长期零增益 → 标记 staleness ——
    // （例：冲级时 progress 不涨，多半是能量/采集链断了，brain 可据此补救）
    if (gain <= 0 && goalId === 'rcl_push') {
      L.staleness = (L.staleness || 0) + 1;
    } else {
      L.staleness = Math.max(0, (L.staleness || 0) - 1);
    }

    L.lastProg = prog;
    L.lastEvalT = Game.time;
    L.lastGain = Math.round(gain * 100) / 100;
  },

  /**
   * 给 brain 的反馈信号：当前是否处于"乏力"状态（主目标推不动）。
   * brain 可据此临时加强采集/搬运（疏通经济命脉）。
   * @return {number} stalenessBoost 0..1（越大越该疏通经济）
   */
  stalenessBoost(brainMem) {
    if (!brainMem || !brainMem.learn) return 0;
    const s = brainMem.learn.staleness || 0;
    return s > 2 ? Math.min(1, (s - 2) / 5) : 0; // 连续乏力>2次才介入，平滑
  },
};

