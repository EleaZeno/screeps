'use strict';

/*
 * role.upgrader.js — 升级者
 * ------------------------------------------------------------------
 * 专职升级 controller。空了去取能量（优先掉落/容器，再 source），满了回去升级。
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
      creep.say('⚡');
    }

    if (creep.memory.working) {
      const ctrl = creep.room.controller;
      if (ctrl) {
        // 优先从 controller 旁 container 取能量（静态升级，不跑路）
        const ctrlContainer = ctrl.pos.findInRange(FIND_STRUCTURES, 3, {
          filter: (s) => s.structureType === STRUCTURE_CONTAINER && s.store[RESOURCE_ENERGY] > 0,
        })[0];
        if (ctrlContainer && creep.store.getFreeCapacity() > 0 && creep.pos.inRangeTo(ctrlContainer, 1)) {
          creep.withdraw(ctrlContainer, RESOURCE_ENERGY); // 边升级边补能量
        }
        if (creep.upgradeController(ctrl) === ERR_NOT_IN_RANGE) {
          utils.moveTo(creep, ctrl, '#66ccff');
        }
      }
    } else {
      utils.gatherEnergy(creep);
    }
  },
};
