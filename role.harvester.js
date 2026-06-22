'use strict';

/*
 * role.harvester.js — 采集者
 * ------------------------------------------------------------------
 * 改进：
 *  - 绑定固定 source（source.manager 分配），不抢不挤
 *  - 满仓后用 utils 找最优回填目标（spawn>extension>tower>storage）
 *  - working 状态机：满了去送，空了回去采，减少抖动
 */

const sourceManager = require('source.manager');
const utils = require('utils');

module.exports = {
  run(creep) {
    // 状态切换：空了 -> 去采集；满了 -> 去送货
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
      creep.memory.working = false;
      creep.say('⛏️');
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
      creep.say('🚚');
    }

    if (creep.memory.working) {
      // 送货
      const target = utils.findEnergyDropOff(creep);
      if (target) {
        if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          utils.moveTo(creep, target, '#ffffff');
        }
      } else {
        // 所有存储都满了，去帮忙升级 controller，别站着浪费
        const ctrl = creep.room.controller;
        if (ctrl && creep.upgradeController(ctrl) === ERR_NOT_IN_RANGE) {
          utils.moveTo(creep, ctrl, '#66ccff');
        }
      }
    } else {
      // 采集：确保绑定了 source
      if (!creep.memory.sourceId) {
        sourceManager.assignSource(creep);
      }
      let source = creep.memory.sourceId ? Game.getObjectById(creep.memory.sourceId) : null;
      // 绑定的 source 没能量了，临时找个有能量的
      if (!source || source.energy === 0) {
        source = creep.pos.findClosestByRange(FIND_SOURCES_ACTIVE);
      }
      if (source) {
        if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
          utils.moveTo(creep, source, '#ffaa00');
        }
      }
    }
  },
};
