'use strict';

/*
 * utils.js — 通用工具
 * ------------------------------------------------------------------
 * 把"移动 + 缓存路径""找回填目标"等高频操作集中起来。
 */

module.exports = {
  /**
   * 统一移动接口：用 reusePath 缓存路径，大幅降低寻路 CPU。
   * 路径缓存由 Screeps 引擎托管，失效会自动重算，无需手动存 Memory。
   */
  moveTo(creep, target, color) {
    return creep.moveTo(target, {
      reusePath: 8,                       // 缓存 8 tick 的路径
      visualizePathStyle: { stroke: color || '#ffffff' },
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
