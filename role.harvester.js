'use strict';

/*
 * role.harvester.js — 采集者
 * ------------------------------------------------------------------
 *  - 绑定固定 source（scheduler 分配专属开采格），不抢不挤
 *  - 满仓后用 utils 找最优回填目标（spawn>extension>tower>storage）
 *  - working 状态机：满了去送，空了回去采，减少抖动
 *  - 【防卡死】到不了专属格时不死磕，直接走向 source 本体采矿
 *  - 【关键修复 2026-06-23】所有原地工作动作改用 utils.work()，成功即清零卡死计数，
 *    根除“贴着 source/spawn 静止采矿被 guardian 误判焊死→suicide”的致命 bug。
 *  - 【关键修复 2026-06-23】不再因 source.energy===0（采空再生间隙）就弃格回跑，
 *    根除“走两步又折返”的抖动。
 */

const sourceManager = require('source.manager');
const scheduler = require('source.scheduler');
const utils = require('utils');

module.exports = {
  run(creep) {
    // 中央调度标记回收（过时小号）：跑回 spawn 拆解返还能量
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
      creep.say('🚮');
    }

    if (creep.memory.working) {
      // 送货
      const target = utils.findEnergyDropOff(creep);
      if (target) {
        if (utils.work(creep, 'transfer', target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          utils.moveTo(creep, target, '#ffffff');
        }
      } else {
        // 所有存储都满了，能量溢出。发育哲学：基建未完成时，
        // 溢出能量优先去帮忙建造（而不是去升级 controller），把能量锁在建造上。
        const site = creep.pos.findClosestByRange(FIND_CONSTRUCTION_SITES);
        const infra = require('infra');
        if (site && !infra.isComplete(creep.room)) {
          if (utils.work(creep, 'build', site) === ERR_NOT_IN_RANGE) utils.moveTo(creep, site, '#ffdd00');
        } else {
          const ctrl = creep.room.controller;
          if (ctrl && utils.work(creep, 'upgradeController', ctrl) === ERR_NOT_IN_RANGE) utils.moveTo(creep, ctrl, '#66ccff');
        }
      }
    } else {
      // 【免疫系统·求生优先】紧急模式下，先捡起身边最近的掘落能量/容器能量
      // （比跑去远处 source 现采快得多），快速把能量运回 spawn 脱困。
      const guardian = require('colony.guardian');
      if (guardian.isEmergency()) {
        const drop = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
          filter: (rr) => rr.resourceType === RESOURCE_ENERGY && rr.amount >= 20,
        });
        if (drop) {
          if (utils.work(creep, 'pickup', drop) === ERR_NOT_IN_RANGE) utils.moveTo(creep, drop, '#ff0000');
          return;
        }
        const cont = creep.pos.findClosestByRange(FIND_STRUCTURES, {
          filter: (s) => s.structureType === STRUCTURE_CONTAINER && s.store[RESOURCE_ENERGY] > 0,
        });
        if (cont) {
          if (utils.work(creep, 'withdraw', cont, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) utils.moveTo(creep, cont, '#ff0000');
          return;
        }
        // 地上/容器都没现成能量 → 落到下方正常采矿逻辑
      }

      // 采集：分配专属开采格（调度器），走到那一格采 —— 根上消除抢位冲突
      if (!creep.memory.slot) {
        scheduler.assignSlot(creep);
      }
      const slot = creep.memory.slot;
      let source = creep.memory.sourceId ? Game.getObjectById(creep.memory.sourceId) : null;

      // 【关键修复·消除“走两步回去”抖动】
      // 原 bug：source.energy===0（被采空、正再生的间隙很常见）就立刻丢弃专属
      // source 跑去最近活跃 source，下 tick 原 source 又有能量了再跑回来 → 往返横跳。
      // 修复：只有绑定 source 彻底不存在(被移除)时才另寻；energy===0 时仍守在原 source
      //       旁等再生（harvest 返回 NOT_ENOUGH_RESOURCES，无害），不抛弃专属格、不回跑。
      if (!source) {
        const alt = creep.pos.findClosestByRange(FIND_SOURCES_ACTIVE);
        if (alt) {
          if (utils.work(creep, 'harvest', alt) === ERR_NOT_IN_RANGE) utils.moveTo(creep, alt, '#ffaa00');
        }
        return;
      }

      // ——【防卡死核心修复】——
      // 1. 只要已紧挨 source，直接采/原地等再生（最高优先，立刻产出）；
      //    用 utils.work → 采到能量即清零卡死计数，杜绝静止采矿被 guardian 误杀。
      if (creep.pos.isNearTo(source)) {
        utils.work(creep, 'harvest', source);
        return;
      }

      // 2. 未挨到 source：默认走向 source 本体；
      //    若有专属格且该格“空着或就是自己占的”，才走向专属格；
      //    若专属格被别人占了 → 放弃死磕，直接走向 source（避免 moveTo 走不过去原地卡死）。
      let dest = source.pos;
      if (slot) {
        const occ = creep.room.lookForAt(LOOK_CREEPS, slot.x, slot.y)[0];
        if (!occ || occ.name === creep.name) {
          dest = new RoomPosition(slot.x, slot.y, creep.room.name);
        }
      }
      utils.moveTo(creep, dest, '#ffaa00');
    }
  },
};
