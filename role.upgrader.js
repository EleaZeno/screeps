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
        if (creep.upgradeController(ctrl) === ERR_NOT_IN_RANGE) {
          utils.moveTo(creep, ctrl, '#66ccff');
        }
      }
    } else {
      utils.gatherEnergy(creep);
    }
  },
};
