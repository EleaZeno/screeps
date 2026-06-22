'use strict';

/*
 * executor.js — L1 执行层（creep 把中标的任务变成动作）
 * ==================================================================
 * creep 无固定 role！它只看 memory.taskType，执行对应动作。
 * 复用旧 utils（moveTo 防卡死三级决策 + work 封装清零卡死计数）。
 *
 * 每种任务类型一个执行函数，互不影响。无 if 嵌套决策（决策已在 market 做完）。
 * 这里只有"执行已决定的事"——动作 + 必要的移动。
 */

const utils = require('utils');

module.exports = {
  run(creep) {
    const type = creep.memory.taskType;
    const target = creep.memory.taskTarget ? Game.getObjectById(creep.memory.taskTarget) : null;
    const fn = this._handlers[type];
    if (fn && target !== undefined) {
      fn(creep, target, utils);
    } else {
      this._idle(creep, utils);
    }
  },

  _handlers: {
    harvest(creep, source, utils) {
      if (!source) return;
      // 站到开采格上采（能量掉进 container），无格则就近采
      const slot = creep.memory.slot;
      if (slot && !(creep.pos.x === slot.x && creep.pos.y === slot.y)) {
        utils.moveTo(creep, new RoomPosition(slot.x, slot.y, creep.room.name), '#ffaa00');
        // 顺路如果已在 range 内也采一下
        if (creep.pos.isNearTo(source)) utils.work(creep, 'harvest', source);
      } else {
        if (utils.work(creep, 'harvest', source) === ERR_NOT_IN_RANGE) utils.moveTo(creep, source, '#ffaa00');
      }
    },

    haul(creep, src, utils) {
      // 取货阶段：从 src（container/掉落/坟墓）取能量
      if (creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0 && src) {
        const method = src instanceof Resource ? 'pickup' : 'withdraw';
        const r = src instanceof Resource
          ? utils.work(creep, 'pickup', src)
          : utils.work(creep, 'withdraw', src, RESOURCE_ENERGY);
        if (r === ERR_NOT_IN_RANGE) utils.moveTo(creep, src, '#ffaa00');
        return;
      }
      // 满了 → 送去最近的需求点（spawn/ext/tower/storage）
      const drop = utils.findEnergyDropOff(creep);
      if (drop) {
        if (utils.work(creep, 'transfer', drop, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) utils.moveTo(creep, drop, '#ffffff');
      } else {
        // 没地方送 → 拿去升级（能量不浪费）
        const ctrl = creep.room.controller;
        if (ctrl && utils.work(creep, 'upgradeController', ctrl) === ERR_NOT_IN_RANGE) utils.moveTo(creep, ctrl, '#66ccff');
      }
    },

    fill(creep, struct, utils) {
      // 空了先去取能，满了去填
      if (creep.store[RESOURCE_ENERGY] === 0) { module.exports._refill(creep, utils); return; }
      if (!struct) return;
      if (utils.work(creep, 'transfer', struct, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) utils.moveTo(creep, struct, '#ffffff');
    },

    upgrade(creep, ctrl, utils) {
      if (creep.store[RESOURCE_ENERGY] === 0) { module.exports._refill(creep, utils); return; }
      if (!ctrl) return;
      if (utils.work(creep, 'upgradeController', ctrl) === ERR_NOT_IN_RANGE) utils.moveTo(creep, ctrl, '#66ccff');
    },

    build(creep, site, utils) {
      if (creep.store[RESOURCE_ENERGY] === 0) { module.exports._refill(creep, utils); return; }
      if (!site) return;
      if (utils.work(creep, 'build', site) === ERR_NOT_IN_RANGE) utils.moveTo(creep, site, '#88ff88');
    },

    repair(creep, struct, utils) {
      if (creep.store[RESOURCE_ENERGY] === 0) { module.exports._refill(creep, utils); return; }
      if (!struct) return;
      if (utils.work(creep, 'repair', struct) === ERR_NOT_IN_RANGE) utils.moveTo(creep, struct, '#ffff88');
    },

    defend(creep, enemy, utils) {
      if (!enemy) return;
      const hasRanged = creep.body.some((p) => p.type === RANGED_ATTACK);
      if (hasRanged) {
        if (creep.rangedAttack(enemy) === ERR_NOT_IN_RANGE) utils.moveTo(creep, enemy, '#ff0000');
        else utils.markBusy(creep);
      } else {
        if (creep.attack(enemy) === ERR_NOT_IN_RANGE) utils.moveTo(creep, enemy, '#ff0000');
        else utils.markBusy(creep);
      }
    },
  },

  /** 通用补能：去最近的能量源取货（给 upgrade/build/fill/repair 用） */
  _refill(creep, utils) {
    delete creep.memory.working;
    utils.gatherEnergy(creep);
  },

  /** 无任务兜底：去 controller 附近待命（不瞎跑），有能量就升级 */
  _idle(creep, utils) {
    const ctrl = creep.room.controller;
    if (creep.store[RESOURCE_ENERGY] > 0 && ctrl) {
      if (utils.work(creep, 'upgradeController', ctrl) === ERR_NOT_IN_RANGE) utils.moveTo(creep, ctrl, '#66ccff');
    } else {
      utils.gatherEnergy(creep);
    }
  },
};
