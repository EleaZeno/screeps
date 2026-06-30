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
    // ⭐ 外矿 creep 优先走跨房 handler（memory.remote 标记），不走市场任务流。
    if (creep.memory.remote) { this._remote(creep, utils); return; }
    const type = creep.memory.taskType;
    const target = creep.memory.taskTarget ? Game.getObjectById(creep.memory.taskTarget) : null;
    // ⭐ 修复 2026-06-30：专职矿工被 market 弹出(fitness=0 不接非采矿活)时，不走 _idle
    //   (会去升级/gatherEnergy)，而是回自己的 slot 继续静采。防止矿工断采去干别的。
    if (!type && creep.memory.slot) {
      const p = require('worldmodel').parts(creep);
      if (p.work >= 3 && p.carry <= 1) {
        const src = creep.memory.slot.sourceId ? Game.getObjectById(creep.memory.slot.sourceId) : null;
        this._handlers.harvest(creep, src || creep.pos.findClosestByRange(FIND_SOURCES), utils);
        return;
      }
    }
    const fn = this._handlers[type];
    if (fn && target !== undefined) {
      fn(creep, target, utils);
    } else {
      this._idle(creep, utils);
    }
  },

  /** 跨房外矿执行：rharvest(去 target 房采矿) / rhaul(在 target 房捆能量运回 home)。
   *  retreat 标记(target 房有敌)时一律撤回 home 避难。 */
  _remote(creep, utils) {
    const home = creep.memory.rHome;
    const targetRoom = creep.memory.rTarget;

    // —— 撤退：target 有敌 → 跑回 home 房 ——
    if (creep.memory.retreat) {
      if (creep.room.name !== home) {
        const exitDir = Game.map.findExit(creep.room.name, home);
        if (exitDir >= 0) {
          const exit = creep.pos.findClosestByRange(exitDir);
          if (exit) utils.moveTo(creep, exit, '#ff0000');
        }
      }
      return;
    }

    if (creep.memory.taskType === 'rhaul') { this._rhaul(creep, home, targetRoom, utils); return; }
    this._rharvest(creep, home, targetRoom, utils);
  },

  /** 外矿矿工：走到 target 房，钉住分配的 source 采；采满就近丢进 container/地上。 */
  _rharvest(creep, home, targetRoom, utils) {
    // 不在 target 房 → 先走过去（原生 moveTo 跨房 + 复用路网）
    if (creep.room.name !== targetRoom) {
      const dir = Game.map.findExit(creep.room.name, targetRoom);
      if (dir >= 0) { const exit = creep.pos.findClosestByRange(dir); if (exit) utils.moveTo(creep, exit, '#ffaa00'); }
      return;
    }
    const src = creep.memory.rSource ? Game.getObjectById(creep.memory.rSource) : null;
    const source = src || creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE) || creep.room.find(FIND_SOURCES)[0];
    if (!source) return;
    if (!creep.memory.rSource && source) creep.memory.rSource = source.id;
    // 满了 → 丢进就近 container（给 rhaul 取），没 container 就地上 drop
    if (creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
      const cont = source.pos.findInRange(FIND_STRUCTURES, 1, { filter: (s) => s.structureType === STRUCTURE_CONTAINER && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0 })[0];
      if (cont) { if (utils.work(creep, 'transfer', cont, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) utils.moveTo(creep, cont, '#ffffff'); }
      else { creep.drop(RESOURCE_ENERGY); }
      return;
    }
    if (utils.work(creep, 'harvest', source) === ERR_NOT_IN_RANGE) utils.moveTo(creep, source, '#ffaa00');
  },

  /** 外矿搬运：在 target 房装能量(掉落>container>矿工身上)，装满运回 home 房。 */
  _rhaul(creep, home, targetRoom, utils) {
    const loaded = creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0;
    const empty = creep.store[RESOURCE_ENERGY] === 0;
    // 状态机：未满且不在回家途中 → 去 target 房装货；满了 → 回 home 卸货。
    if (creep.memory.rState === 'deliver' && empty) creep.memory.rState = 'load';
    if (loaded) creep.memory.rState = 'deliver';
    if (!creep.memory.rState) creep.memory.rState = 'load';

    if (creep.memory.rState === 'load') {
      // 去 target 房
      if (creep.room.name !== targetRoom) {
        const dir = Game.map.findExit(creep.room.name, targetRoom);
        if (dir >= 0) { const exit = creep.pos.findClosestByRange(dir); if (exit) utils.moveTo(creep, exit, '#ffaa00'); }
        return;
      }
      // 优先：地上掉落 > container > tombstone
      const drop = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, { filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 20 });
      if (drop) { if (creep.pickup(drop) === ERR_NOT_IN_RANGE) utils.moveTo(creep, drop, '#ffaa00'); return; }
      const cont = creep.pos.findClosestByPath(FIND_STRUCTURES, { filter: (s) => (s.structureType === STRUCTURE_CONTAINER || s.structureType === STRUCTURE_STORAGE) && s.store[RESOURCE_ENERGY] > 0 });
      if (cont) { if (utils.work(creep, 'withdraw', cont, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) utils.moveTo(creep, cont, '#ffaa00'); return; }
      const tomb = creep.pos.findClosestByPath(FIND_TOMBSTONES, { filter: (t) => t.store[RESOURCE_ENERGY] > 0 });
      if (tomb) { if (utils.work(creep, 'withdraw', tomb, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) utils.moveTo(creep, tomb, '#ffaa00'); return; }
      // target 房没现成能量：走到矿工旁等装(靠近 source 的矿工会 drop)
      const rsrc = creep.room.find(FIND_SOURCES)[0];
      if (rsrc && !creep.pos.inRangeTo(rsrc, 3)) utils.moveTo(creep, rsrc, '#888888');
      return;
    }

    // deliver：回 home 房卸货
    if (creep.room.name !== home) {
      const dir = Game.map.findExit(creep.room.name, home);
      if (dir >= 0) { const exit = creep.pos.findClosestByRange(dir); if (exit) utils.moveTo(creep, exit, '#ffffff'); }
      return;
    }
    const drop = utils.findEnergyDropOff ? utils.findEnergyDropOff(creep) : null;
    const dst = drop || (Game.rooms[home] && Game.rooms[home].storage) || (Game.rooms[home] && Game.rooms[home].controller);
    if (!dst) return;
    const verb = (dst.structureType === STRUCTURE_CONTROLLER) ? 'upgradeController' : 'transfer';
    const r = verb === 'transfer' ? utils.work(creep, 'transfer', dst, RESOURCE_ENERGY) : utils.work(creep, 'upgradeController', dst);
    if (r === ERR_NOT_IN_RANGE) utils.moveTo(creep, dst, '#ffffff');
  },

  /**
   * ⭐ 为静态矿工找倒货 sink（2026-07-01）。优先级：
   *   1) 相邻(range1) source link 有空 —— 能瞬移到 controller/storage link，最高价值
   *   2) 脚下同格 container 有空 —— 就地静态存储，hauler 来搬
   *   3) 相邻(range1) container 有空 —— 兜底
   * 用 _linkFree/_contFree 做稳健空位判断（link 的 getFreeCapacity 偶发返回 null）。
   * @returns {Structure|null}
   */
  _harvestSink(creep) {
    const linkFree = (s) => {
      const cap = (s.store.getCapacity && s.store.getCapacity(RESOURCE_ENERGY)) || 800;
      return cap - (s.store[RESOURCE_ENERGY] || 0);
    };
    // 1) 相邻 source link
    const links = creep.pos.findInRange(FIND_MY_STRUCTURES, 1, {
      filter: (s) => s.structureType === STRUCTURE_LINK && linkFree(s) > 0,
    });
    if (links && links.length) return links[0];
    // 2) 脚下同格 container
    const here = creep.pos.lookFor(LOOK_STRUCTURES).find(
      (s) => s.structureType === STRUCTURE_CONTAINER && (s.store.getFreeCapacity(RESOURCE_ENERGY) || 0) > 0);
    if (here) return here;
    // 3) 相邻 container 兜底
    const conts = creep.pos.findInRange(FIND_STRUCTURES, 1, {
      filter: (s) => s.structureType === STRUCTURE_CONTAINER && (s.store.getFreeCapacity(RESOURCE_ENERGY) || 0) > 0,
    });
    if (conts && conts.length) return conts[0];
    return null;
  },

  _handlers: {
    harvest(creep, source, utils) {
      if (!source) return;
      const p = require('worldmodel').parts(creep);
      // 站到开采格上采（能量掉进 container），无格则就近采
      const slot = creep.memory.slot;
      if (slot && !(creep.pos.x === slot.x && creep.pos.y === slot.y)) {
        utils.moveTo(creep, new RoomPosition(slot.x, slot.y, creep.room.name), '#ffaa00');
        // 顺路如果已在 range 内也采一下
        if (creep.pos.isNearTo(source)) utils.work(creep, 'harvest', source);
        return;
      }
      // ⭐ 静态采矿倒货（彻底修复 2026-07-01）：
      //   旧 bug：仅 getFreeCapacity===0（100% 满仓）才倒货。但进化大脑产出的矿工常是
      //   9W9C(450 容量)通用体，450 容量几乎填不满 → 永远不倒 → container/source link 全空、
      //   storage 也是 0（线上实测三 container 全 0、source link 全 0 的根因）。
      //   新逻辑：身上有货且【快溢出】（剩余空间 < 一次采量，再采就浪费）就倒。
      //   优先级：source link > 脚下 container（link 能瞬移到 storage=高价值，container 只就地存）。
      const harvestPerTick = Math.min(p.work * 2, source.energy || 0); // HARVEST_POWER=2
      const free = creep.store.getFreeCapacity(RESOURCE_ENERGY);
      const carried = creep.store[RESOURCE_ENERGY] || 0;
      const shouldOffload = carried > 0 && free <= harvestPerTick; // 快溢出或已满
      if (p.work > 0 && p.carry > 0 && shouldOffload) {
        const sink = module.exports._harvestSink(creep);
        if (sink) { utils.work(creep, 'transfer', sink, RESOURCE_ENERGY); return; }
        // 无可用 sink 且已 100% 满 → 就地 drop（让 hauler 捡），好过卡死不采
        if (free === 0) { creep.drop(RESOURCE_ENERGY); return; }
        // 未满且无 sink：不倒，继续采（落地走静态 container 溢出机制）
      }
      if (utils.work(creep, 'harvest', source) === ERR_NOT_IN_RANGE) utils.moveTo(creep, source, '#ffaa00');
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

    // ⭐ 屯仓（修复 2026-06-30）：装满能量送进 storage 储备。与 fill 同机制，只是目标是 storage。
    store(creep, storage, utils) {
      if (!module.exports._loaded(creep, utils)) { module.exports._refill(creep, utils); return; }
      if (!storage) return;
      if (utils.work(creep, 'transfer', storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) utils.moveTo(creep, storage, '#ffffff');
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
      // 空载待命：先看附近有无地上掉落(会衰减,优先捡)，再去 source 旁 container 接货。
      const nearDrop = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, { filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount >= 10 });
      if (nearDrop) { if (creep.pickup(nearDrop) === ERR_NOT_IN_RANGE) utils.moveTo(creep, nearDrop, '#ffaa00'); return; }
      // 按名字哈希分散到不同 source(不挤一处)
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

