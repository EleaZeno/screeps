'use strict';

/*
 * utils.js — 通用工具
 * ------------------------------------------------------------------
 * 把"移动 + 缓存路径""找回填目标"等高频操作集中起来。
 */

module.exports = {
  /**
   * 标记 creep 本 tick 干了正事（采矿/送货/取能/建造/升级）。
   * 被标记后，moveTo 的卡死检测不会把“静止干活”误判为焦死。
   * 任何角色成功执行一个工作动作后都应调用。
   * 【关键修复】同时把卡死计数 _stk 清零——原 bug：creep 贴着 source/container
   * 静止采矿时根本不走 moveTo，_stk 永不重置，会一路累加到 60 被 guardian 误杀。
   */
  markBusy(creep) {
    creep.memory._busy = Game.time;
    creep.memory._stk = 0;
  },

  /**
   * 工作动作统一封装：执行一个原地工作意图（harvest/transfer/withdraw/build/
   * repair/upgradeController/pickup），返回原始返回码。
   *  - 成功(OK) → markBusy（清零卡死计数，防止静止干活被误杀）
   *  - ERR_NOT_IN_RANGE → 调用方负责 moveTo 过去（不算“卡”，因为正在赶路）
   * 用法：const r = utils.work(creep, 'harvest', source); if (r===ERR_NOT_IN_RANGE) utils.moveTo(...)
   */
  work(creep, method, target, resourceType) {
    const res =
      resourceType !== undefined
        ? creep[method](target, resourceType)
        : creep[method](target);
    if (res === OK) this.markBusy(creep);
    return res;
  },

  /**
   * 统一移动接口：CPU 只算一次最优路径复用，+ 防堵塞三级决策。
   * 防堵逻辑（修复版）：检测原地卡顿几 tick 后，CPU 三选一里升级：
   *   ≤1 tick 原地未动：正常（可能刚好会合/疲劳），不管
   *   2~3 tick 卡：重算路径且 ignoreCreeps（穿过友军强行寻路，不被堵）
   *   ≥4 tick 卡：丢弃缓存重走全新路 + 同 tick 只下一个随机挪步（打破死锁）
   * 路线稳定时复用 20 tick（算一次走很久，省 CPU）。
   */
  moveTo(creep, target, color) {
    const m = creep.memory;
    // 卡顿检测：与上一 tick 位置相同 → stuck 计数，不同 → 清零
    // 【关键修复】只有本 tick “没干正事又没动”才算卡。若 creep 本 tick 已成功
    // 执行过工作动作（采矿/送货/取能/建造/升级=设了 m._busy=Game.time），则不算卡。
    // 这防住了“贴着 spawn/source 静止干活”被误判为焦死→被 guardian 误杀的致命 bug。
    const busyThisTick = m._busy === Game.time;
    if (busyThisTick) {
      m._stk = 0;
    } else if (m._mx === creep.pos.x && m._my === creep.pos.y) {
      m._stk = (m._stk || 0) + 1;
    } else {
      m._stk = 0;
    }
    m._mx = creep.pos.x; m._my = creep.pos.y;

    const stk = m._stk || 0;

    // ≥4 tick 重度卡死 → 同 tick 只下一个随机挪步打破死锁（不要再叠 moveTo，否则被覆盖）
    if (stk >= 4) {
      delete m._move;
      const dirs = [TOP, TOP_RIGHT, RIGHT, BOTTOM_RIGHT, BOTTOM, BOTTOM_LEFT, LEFT, TOP_LEFT];
      // 优先朝目标大致方向随机偏移，找一个可走的空格强行挪出去
      creep.move(dirs[Math.floor(Math.random() * 8)]);
      return OK;
    }

    let reuse = 20;
    let ignoreCreeps = false;
    if (stk >= 2) {
      // 轻度卡顿 → 重算路径 + 无视 creep 强行穿过（关键修复：原来 ignoreCreeps 从没设 true）
      reuse = 0;
      ignoreCreeps = true;
      delete m._move;
    }

    return creep.moveTo(target, {
      reusePath: reuse,
      serializeMemory: true,
      ignoreCreeps,
      visualizePathStyle: color ? { stroke: stk >= 2 ? '#ff5555' : color, opacity: 0.15 } : undefined,
    });
  },

  /**
   * 找"需要填能量"的回填目标，按优先级：
   * spawn/extension（孵化命脉）> tower（防御）> storage（仓库）
   */
  findEnergyDropOff(creep) {
    let targets = creep.room.find(FIND_MY_STRUCTURES, {
      filter: (s) =>
        (s.structureType === STRUCTURE_EXTENSION || s.structureType === STRUCTURE_SPAWN) &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    });
    if (targets.length) return creep.pos.findClosestByRange(targets);

    targets = creep.room.find(FIND_MY_STRUCTURES, {
      filter: (s) =>
        s.structureType === STRUCTURE_TOWER &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > s.store.getCapacity(RESOURCE_ENERGY) * 0.2,
    });
    if (targets.length) return creep.pos.findClosestByRange(targets);

    targets = creep.room.find(FIND_STRUCTURES, {
      filter: (s) =>
        (s.structureType === STRUCTURE_STORAGE || s.structureType === STRUCTURE_CONTAINER) &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    });
    if (targets.length) return creep.pos.findClosestByRange(targets);

    return null;
  },

  /**
   * 让 creep 去取能量（采集者之外的角色用）：优先掉落能量/容器，再去 source 现采。
   */
  gatherEnergy(creep) {
    const dropped = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
      filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 50,
    });
    if (dropped) {
      if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) this.moveTo(creep, dropped, '#ffaa00');
      return;
    }

    const store = creep.pos.findClosestByRange(FIND_STRUCTURES, {
      filter: (s) =>
        (s.structureType === STRUCTURE_CONTAINER || s.structureType === STRUCTURE_STORAGE) &&
        s.store[RESOURCE_ENERGY] > 0,
    });
    if (store) {
      if (creep.withdraw(store, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) this.moveTo(creep, store, '#ffaa00');
      return;
    }

    const source = creep.pos.findClosestByRange(FIND_SOURCES_ACTIVE);
    if (source) {
      if (creep.harvest(source) === ERR_NOT_IN_RANGE) this.moveTo(creep, source, '#ffaa00');
    }
  },
};
