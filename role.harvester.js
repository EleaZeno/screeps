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
const scheduler = require('source.scheduler');
const utils = require('utils');

module.exports = {
  run(creep) {
    // 中央调度标记回收（过时小号）：跑回 spawn 拆解返还能量，不浪费
    if (creep.memory.recycle) {
      const spawn = creep.pos.findClosestByRange(FIND_MY_SPAWNS);
      if (spawn) {
        if (creep.pos.isNearTo(spawn)) spawn.recycleCreep(creep);
        else utils.moveTo(creep, spawn, '#888888');
        return;
      }
    }

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
        // 所有存储都满了，能量溢出。发育哲学：基建未完成时，
        // 溢出能量优先去帮忙建造（而不是去升级 controller），把能量锁在建设上。
        const site = creep.pos.findClosestByRange(FIND_CONSTRUCTION_SITES);
        const infra = require('infra');
        if (site && !infra.isComplete(creep.room)) {
          // 基建未完成 + 有工地 → 去建造
          if (creep.build(site) === ERR_NOT_IN_RANGE) utils.moveTo(creep, site, '#ffdd00');
        } else {
          // 基建已完成（或无工地）：才去升级 controller，别站着浪费
          const ctrl = creep.room.controller;
          if (ctrl && creep.upgradeController(ctrl) === ERR_NOT_IN_RANGE) utils.moveTo(creep, ctrl, '#66ccff');
        }
      }
    } else {
      // 采集：分配专属开采格（调度器），走到那一格采 —— 根上消除抢位冲突
      if (!creep.memory.slot) {
        scheduler.assignSlot(creep);
      }
      const slot = creep.memory.slot;
      let source = creep.memory.sourceId ? Game.getObjectById(creep.memory.sourceId) : null;
      // 绑定 source 没能量了，临时找个有能量的
      if (!source || source.energy === 0) {
        source = creep.pos.findClosestByRange(FIND_SOURCES_ACTIVE);
        if (source) {
          if (creep.harvest(source) === ERR_NOT_IN_RANGE) utils.moveTo(creep, source, '#ffaa00');
        }
        return;
      }
      // 有专属格子：先走到格子上（避免多人振在同一格互堵），再采
      if (slot && (creep.pos.x !== slot.x || creep.pos.y !== slot.y)) {
        // 已在 source 旁且能采到就直接采，否则走向专属格
        if (creep.pos.isNearTo(source)) {
          creep.harvest(source);
        } else {
          creep.moveTo(slot.x, slot.y, { reusePath: 30, visualizePathStyle: { stroke: '#ffaa00', opacity: 0.15 } });
        }
      } else if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
        utils.moveTo(creep, source, '#ffaa00');
      }
    }
  },
};
