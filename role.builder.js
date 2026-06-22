'use strict';

/*
 * role.builder.js — 建造者
 * ------------------------------------------------------------------
 * 改进：
 *  - 有工地就建造（按优先级：先建防御 rampart/wall 之外的关键建筑）
 *  - 没工地时回退去升级 controller（不再站着发呆）
 *  - 顺手修一下快坏的建筑（hits < hitsMax 的非墙建筑）
 */

const utils = require('utils');
const guardian = require('colony.guardian');

module.exports = {
  run(creep) {
    // 【免疫系统】求生模式：停止建造，把能量送回 spawn 救孵化
    if (guardian.isEmergency()) {
      if (creep.store[RESOURCE_ENERGY] > 0) {
        const sp = creep.pos.findClosestByRange(FIND_MY_SPAWNS);
        if (sp && sp.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
          if (creep.transfer(sp, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) utils.moveTo(creep, sp, '#ff0000');
          return;
        }
      } else {
        utils.gatherEnergy(creep);
        return;
      }
    }
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
      creep.memory.working = false;
      creep.say('🔄');
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
      creep.say('🚧');
    }

    if (creep.memory.working) {
      // 1. 优先建造工地
      const site = creep.pos.findClosestByRange(FIND_MY_CONSTRUCTION_SITES);
      if (site) {
        if (creep.build(site) === ERR_NOT_IN_RANGE) utils.moveTo(creep, site, '#0099ff');
        return;
      }

      // 2. 没工地则修理受损建筑（排除墙/壁垒，避免无底洞）
      const repair = creep.pos.findClosestByRange(FIND_STRUCTURES, {
        filter: (s) =>
          s.hits < s.hitsMax &&
          s.structureType !== STRUCTURE_WALL &&
          s.structureType !== STRUCTURE_RAMPART,
      });
      if (repair) {
        if (creep.repair(repair) === ERR_NOT_IN_RANGE) utils.moveTo(creep, repair, '#00ff00');
        return;
      }

      // 3. 都没有就去升级 controller
      const ctrl = creep.room.controller;
      if (ctrl) {
        if (creep.upgradeController(ctrl) === ERR_NOT_IN_RANGE) utils.moveTo(creep, ctrl, '#66ccff');
      }
    } else {
      utils.gatherEnergy(creep);
    }
  },
};
