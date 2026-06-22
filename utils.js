'use strict';

/*
 * utils.js — 通用工具
 * ------------------------------------------------------------------
 * 把"移动 + 缓存路径""找回填目标"等高频操作集中起来。
 */

module.exports = {
  /**
   * 统一移动接口：CPU 只算一次最优路径，之后多 tick 反复复用（不每 tick 重算）。
   * 原理：Screeps 引擎的 moveTo 会把路径序列化存进 creep.memory._move，
   * reusePath=N 表示这条路径复用 N tick 才重算一次。把 N 调大
   * = “算一次、走很久”，完全符合你要的“隔一段算一次反复调用”。
   * 静态采矿/固定往返场景路线不变，复用很长也不会错；被堵了引擎会自动让路。
   */
  moveTo(creep, target, color) {
    return creep.moveTo(target, {
      reusePath: 30,                      // 算一次复用 30 tick（原来是 8）→ 寻路 CPU 降 ~75%
      serializeMemory: true,              // 路径序列化存内存（紧凑，用闲置内存换 CPU）
      visualizePathStyle: color ? { stroke: color, opacity: 0.15 } : undefined,
      ignoreCreeps: false,
    });
  },

  /**
   * 找"需要填能量"的回填目标，按优先级：
   * spawn/extension（孵化命脉）> tower（防御）> storage（仓库）
   */
  findEnergyDropOff(creep) {
    // 优先 spawn / extension
    let targets = creep.room.find(FIND_MY_STRUCTURES, {
      filter: (s) =>
        (s.structureType === STRUCTURE_EXTENSION || s.structureType === STRUCTURE_SPAWN) &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    });
    if (targets.length) return creep.pos.findClosestByRange(targets);

    // 其次 tower（留点余量，低于 80% 才补）
    targets = creep.room.find(FIND_MY_STRUCTURES, {
      filter: (s) =>
        s.structureType === STRUCTURE_TOWER &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > s.store.getCapacity(RESOURCE_ENERGY) * 0.2,
    });
    if (targets.length) return creep.pos.findClosestByRange(targets);

    // 最后 storage / container
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
    // 优先捡掉落的能量（高效，不浪费）
    const dropped = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
      filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 50,
    });
    if (dropped) {
      if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) this.moveTo(creep, dropped, '#ffaa00');
      return;
    }

    // 其次从 container/storage 取
    const store = creep.pos.findClosestByRange(FIND_STRUCTURES, {
      filter: (s) =>
        (s.structureType === STRUCTURE_CONTAINER || s.structureType === STRUCTURE_STORAGE) &&
        s.store[RESOURCE_ENERGY] > 0,
    });
    if (store) {
      if (creep.withdraw(store, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) this.moveTo(creep, store, '#ffaa00');
      return;
    }

    // 最后自己去采 source
    const source = creep.pos.findClosestByRange(FIND_SOURCES_ACTIVE);
    if (source) {
      if (creep.harvest(source) === ERR_NOT_IN_RANGE) this.moveTo(creep, source, '#ffaa00');
    }
  },
};
