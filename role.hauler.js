'use strict';

/*
 * role.hauler.js — 搬运工（配合静态 miner）
 * ------------------------------------------------------------------
 * 从 container/掉落能量取货 → 送到 spawn/extension/tower/storage。
 * 全 CARRY+MOVE 身体，专职运输，让 miner 专心采矿。
 */
const utils = require('utils');

module.exports = {
  run(creep) {
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
      creep.memory.working = false;
      creep.say('🔄');
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
      creep.say('📦');
    }

    if (creep.memory.working) {
      // 送货：优先回填，没地方填就送去 controller 旁让 upgrader 取（或自己升级）
      const target = utils.findEnergyDropOff(creep);
      if (target) {
        if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) utils.moveTo(creep, target, '#ffffff');
      } else {
        const ctrl = creep.room.controller;
        if (ctrl && creep.upgradeController(ctrl) === ERR_NOT_IN_RANGE) utils.moveTo(creep, ctrl, '#66ccff');
      }
    } else {
      // 取货：优先 source 旁 container（最满的），再掉落能量
      const containers = creep.room.find(FIND_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER && s.store[RESOURCE_ENERGY] > 50,
      });
      if (containers.length) {
        containers.sort((a, b) => b.store[RESOURCE_ENERGY] - a.store[RESOURCE_ENERGY]);
        if (creep.withdraw(containers[0], RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) utils.moveTo(creep, containers[0], '#ffaa00');
        return;
      }
      const dropped = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
        filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 50,
      });
      if (dropped) {
        if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) utils.moveTo(creep, dropped, '#ffaa00');
        return;
      }
      // 实在没货，去 source 旁等
      const source = creep.pos.findClosestByRange(FIND_SOURCES_ACTIVE);
      if (source) utils.moveTo(creep, source, '#ffaa00');
    }
  },
};
