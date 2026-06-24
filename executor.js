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
      // 装满再走状态机：取能中且未满→继续取；但取不到更多(src空)时不死等，有货就走。
      const working = module.exports._loaded(creep, utils);
      if (!working && src) {
        const method = src instanceof Resource ? 'pickup' : 'withdraw';
        const r = src instanceof Resource
          ? utils.work(creep, 'pickup', src)
          : utils.work(creep, 'withdraw', src, RESOURCE_ENERGY);
        if (r === ERR_NOT_IN_RANGE) { utils.moveTo(creep, src, '#ffaa00'); return; }
        // 取不到更多(src空/不足)且已有一些货→提前转送，不死等装满
        if (r === ERR_NOT_ENOUGH_RESOURCES && creep.store[RESOURCE_ENERGY] > 0) { creep.memory.working = true; }
        else if (r === ERR_NOT_ENOUGH_RESOURCES) { /* 空载且src空，下tick市场重分 */ return; }
        else return; // 正常取货中，继续
      }
      // 满了(或提前转送) → 送去最近的需求点
      const drop = utils.findEnergyDropOff(creep);
      if (drop) {
        if (utils.work(creep, 'transfer', drop, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) utils.moveTo(creep, drop, '#ffffff');
      } else {
        const ctrl = creep.room.controller;
        if (ctrl && utils.work(creep, 'upgradeController', ctrl) === ERR_NOT_IN_RANGE) utils.moveTo(creep, ctrl, '#66ccff');
      }
    },

    fill(creep, struct, utils) {
      // 装满再去填（状态机）：没装满且还能取到能→继续取
      if (!module.exports._loaded(creep, utils)) { module.exports._refill(creep, utils); return; }
      if (!struct) return;
      if (utils.work(creep, 'transfer', struct, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) utils.moveTo(creep, struct, '#ffffff');
    },

    upgrade(creep, ctrl, utils) {
      if (!module.exports._loaded(creep, utils)) { module.exports._refill(creep, utils); return; }
      if (!ctrl) return;
      if (utils.work(creep, 'upgradeController', ctrl) === ERR_NOT_IN_RANGE) utils.moveTo(creep, ctrl, '#66ccff');
    },

    build(creep, site, utils) {
      if (!module.exports._loaded(creep, utils)) { module.exports._refill(creep, utils); return; }
      if (!site) return;
      if (utils.work(creep, 'build', site) === ERR_NOT_IN_RANGE) utils.moveTo(creep, site, '#88ff88');
    },

    repair(creep, struct, utils) {
      if (!module.exports._loaded(creep, utils)) { module.exports._refill(creep, utils); return; }
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

  /** 装载状态机：装满再去干活，用完再去取。返回 true=应该干活(能量就绪), false=该去取能。
   *  修复“半载就跑”：不再一有能量就跑，而是装满(或取不到更多)才出发。 */
  _loaded(creep, utils) {
    const free = creep.store.getFreeCapacity(RESOURCE_ENERGY);
    const energy = creep.store[RESOURCE_ENERGY];
    if (creep.memory.working) {
      // 干活中：用完才切回取能
      if (energy === 0) { creep.memory.working = false; }
    } else {
      // 取能中：装满才切去干活（free===0 即满）
      if (free === 0) { creep.memory.working = true; }
    }
    return !!creep.memory.working;
  },

  /** 通用补能：去最近的能量源取货（给 upgrade/build/fill/repair 用） */
  _refill(creep, utils) {
    utils.gatherEnergy(creep);
  },

  /** 无任务兜底：去 controller 附近待命（不瞎跑），有能量就升级 */
  _idle(creep, utils) {
    const wm = require('worldmodel');
    const p = wm.parts(creep);
    const ctrl = creep.room.controller;
    const hasEnergy = creep.store[RESOURCE_ENERGY] > 0;
    if (p.work === 0) {
      // 纯CARRY(Hauler)不能升级/采矿：有能量→送需求点/container；空载→取货待命。
      if (hasEnergy) {
        const drop = utils.findEnergyDropOff ? utils.findEnergyDropOff(creep) : null;
        if (drop) { if (utils.work(creep, 'transfer', drop, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) utils.moveTo(creep, drop, '#ffffff'); return; }
        const store = creep.pos.findClosestByPath(FIND_STRUCTURES, { filter: (s) => (s.structureType === STRUCTURE_CONTAINER || s.structureType === STRUCTURE_STORAGE) && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0 });
        if (store) { if (utils.work(creep, 'transfer', store, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) utils.moveTo(creep, store, '#ffffff'); return; }
        return;
      }
      // 空载待命：去 source 旁 container 接货，按名字哈希分散到不同 source(不挤一处)
      const srcs = creep.room.find(FIND_SOURCES);
      if (srcs.length) {
        const pick = srcs[creep.name.charCodeAt(creep.name.length - 1) % srcs.length];
        const cont = pick.pos.findInRange(FIND_STRUCTURES, 1, { filter: (s) => s.structureType === STRUCTURE_CONTAINER })[0];
        const dst = cont || pick;
        if (!creep.pos.inRangeTo(dst, 2)) utils.moveTo(creep, dst, '#888888');
        return;
      }
      utils.gatherEnergy(creep);
      return;
    }
    if (hasEnergy && ctrl) {
      if (utils.work(creep, 'upgradeController', ctrl) === ERR_NOT_IN_RANGE) utils.moveTo(creep, ctrl, '#66ccff');
    } else {
      utils.gatherEnergy(creep);
    }
  },
};

