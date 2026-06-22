'use strict';

/*
 * colony.guardian.js — 殖民地"免疫系统"（不变量守护 / 死亡螺旋熔断）
 * ==================================================================
 * 设计哲学（回应用户"要能应对各种突发，不靠人维护"）：
 *   不预测每一种突发，而是定义一组"无论如何都不能违反的生存不变量"，
 *   每 tick 第一优先检查；任何不变量被破坏 → 立刻触发对应的通用修正，
 *   并临时接管资源分配，直到危机解除。这是一套"免疫系统"而非"if 反射"：
 *   它针对的是"状态偏离健康区间"这一抽象，而不是具体某个剧情。
 *
 * 守护的核心生存不变量：
 *   I1. 必须有人在产能量（采集者/矿工 ≥ 1）
 *   I2. 能量不能被非生存性消费榨干到出不起采集者（死亡螺旋熔断）
 *   I3. creep 不能长期卡死（死锁回收，已在 utils/role 内处理，这里兜最后一道）
 *   I4. controller 不能逼近降级（防 RCL 倒退）
 *
 * 输出：Memory.guardian = { mode, reason, since } 供其他模块感知"是否处于紧急接管"。
 * 其他模块（尤其 spawn.manager / role.builder）应读取 guardian.isEmergency() 让路。
 */

const EMERGENCY_ENERGY_FLOOR = 200; // 低于此且无采集者 → 死亡螺旋
const STUCK_KILL_THRESHOLD = 60;    // creep 卡死超过此 tick → 回收（兜最后一道）
const CTRL_DOWNGRADE_GUARD = 3000;  // controller 剩余降级时间低于此 → 拉响警报

module.exports = {
  /**
   * 每 tick 最先运行。返回当前是否处于紧急接管状态。
   */
  run(room) {
    if (!Memory.guardian) Memory.guardian = {};
    const g = Memory.guardian;
    const prevMode = g.mode || 'normal';

    const counts = this._countRoles(room);
    const gatherers = (counts.harvester || 0) + (counts.miner || 0);
    const avail = room.energyAvailable;
    const cap = room.energyCapacityAvailable;
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    const ctrl = room.controller;

    let mode = 'normal';
    let reason = '';

    // ---- I1 + I2：死亡螺旋检测（最高优先）----
    // 没人产能量，或 能量低且采集者不足 → 进入"求生模式"
    if (gatherers === 0) {
      mode = 'survival';
      reason = 'no-gatherers';
    } else if (gatherers <= 1 && avail < EMERGENCY_ENERGY_FLOOR && cap >= 500) {
      // 切静态采矿后只剩 ≤1 采集者又攒不出大 miner 的典型死锁
      mode = 'survival';
      reason = 'energy-starvation';
    }

    // ---- I4：controller 逼近降级 ----
    if (ctrl && ctrl.ticksToDowngrade && ctrl.ticksToDowngrade < CTRL_DOWNGRADE_GUARD) {
      if (mode === 'normal') { mode = 'guard-controller'; reason = 'downgrade-imminent'; }
    }

    // ---- 记录状态机 ----
    if (mode !== prevMode) {
      g.mode = mode;
      g.reason = reason;
      g.since = Game.time;
      if (mode !== 'normal') {
        console.log(`🛡️ [GUARDIAN] 进入「${mode}」模式 — 原因:${reason} (gatherers=${gatherers}, energy=${avail}/${cap})`);
      } else {
        console.log(`✅ [GUARDIAN] 危机解除，恢复正常 (gatherers=${gatherers}, energy=${avail}/${cap})`);
      }
    }

    // ---- 触发修正动作 ----
    if (mode === 'survival') {
      this._healSurvival(room, spawn, counts, gatherers, avail);
    }

    // ---- I3：死锁兜底回收（任何模式都查）----
    this._killHardStuck(room);

    return mode !== 'normal';
  },

  isEmergency() {
    return Memory.guardian && Memory.guardian.mode === 'survival';
  },

  /**
   * 求生模式修正（死亡螺旋熔断的核心）：
   *  1. 立刻把吃能量却不产能量的角色（builder/upgrader）转成 harvester 回血
   *  2. 强制孵化能力范围内最大的采集者（能量阶梯：550/300/200/150）
   * 这是"通用修正"——不关心为什么会变成这样，只负责把状态拉回健康区间。
   */
  _healSurvival(room, spawn, counts, gatherers, avail) {
    // 1. 寄生角色转采集（builder 最先，它们正在外流能量）
    if (gatherers < 2) {
      let converted = 0;
      for (const name in Game.creeps) {
        const c = Game.creeps[name];
        if (c.room.name !== room.name) continue;
        if ((c.memory.role === 'builder' || c.memory.role === 'upgrader') && converted < 3) {
          c.memory.role = 'harvester';
          delete c.memory.slot;
          delete c.memory.working;
          delete c.memory._move;
          converted++;
        }
      }
      if (converted > 0) console.log(`🛡️ [GUARDIAN] 求生：转 ${converted} 个寄生角色为采集者回血`);
    }

    // 2. 强制孵化采集者（能量阶梯兜底，永不团灭）
    // 【关键】求生体必须含 CARRY！无 CARRY 的 [WORK,MOVE] 采了能量也运不走=白采。
    // 能量不足 200 时不勉强出残缺体，而是等 spawn 自动回血到 200（每 tick +1）。
    if (spawn && !spawn.spawning) {
      let body = null;
      if (avail >= 800) body = [WORK, WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE];
      else if (avail >= 550) body = [WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE, MOVE];
      else if (avail >= 300) body = [WORK, WORK, CARRY, MOVE, MOVE];
      else if (avail >= 200) body = [WORK, CARRY, MOVE]; // 最小可用采集体（含 CARRY，能采能运）
      // avail < 200：出不起任何含 CARRY 的体→等 spawn 回血（别出无 CARRY 的垃圾体）
      if (body) {
        const res = spawn.spawnCreep(body, 'SOS_' + Game.time, { memory: { role: 'harvester', room: room.name } });
        if (res === OK) console.log(`🛡️ [GUARDIAN] 求生：强制孵化采集者 body=${body.length}部件 energy=${avail}`);
      } else if (avail < 200) {
        // 最危险：能量<200连最小采集体都出不起，只能等回血。打印警告让人可见。
        if (Game.time % 10 === 0) console.log(`⚠️ [GUARDIAN] 极危：能量${avail}<200出不起采集者，等 spawn 回血中（每 tick+1）`);
      }
    }
  },

  /**
   * 兜最后一道：creep 卡死超阈值 → 直接回收，释放空间打破死锁。
   * （前置的 utils.moveTo / role 已有较温和的脱困；这里只处理"焊死"的极端情况）
   */
  _killHardStuck(room) {
    for (const name in Game.creeps) {
      const c = Game.creeps[name];
      if (c.room.name !== room.name) continue;
      if ((c.memory._stk || 0) >= STUCK_KILL_THRESHOLD) {
        console.log(`🛡️ [GUARDIAN] 回收焊死 creep ${name} (卡 ${c.memory._stk} tick)`);
        c.suicide();
      }
    }
  },

  _countRoles(room) {
    const counts = {};
    for (const name in Game.creeps) {
      const c = Game.creeps[name];
      if (c.room.name !== room.name && c.memory.room !== room.name) continue;
      counts[c.memory.role] = (counts[c.memory.role] || 0) + 1;
    }
    return counts;
  },
};
