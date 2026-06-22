'use strict';

/*
 * spawn.manager.js — 孵化管理（config 驱动，支持急速发育 + 防御 + 进攻）
 * ------------------------------------------------------------------
 * 角色优先级（缺谁先补谁）：
 *   defender(有敌)  > miner/harvester(采集)  > hauler(运输)
 *   > upgrader(升级) > builder(建造) > attacker(进攻,需开关) > scout
 * 身体随 energyCapacityAvailable 自适应缩放。
 */
const config = require('config');
const sourceManager = require('source.manager');

module.exports = {
  run(room) {
    const spawn = room.find(FIND_MY_SPAWNS, { filter: (s) => !s.spawning })[0];
    if (!spawn) return;

    const rcl = room.controller.level;
    const cap = room.energyCapacityAvailable;
    const cur = room.energyAvailable;

    // 现有各角色数量（按房间）
    const counts = {};
    for (const name in Game.creeps) {
      const c = Game.creeps[name];
      if (c.memory.room === room.name || c.room.name === room.name) {
        counts[c.memory.role] = (counts[c.memory.role] || 0) + 1;
      }
    }
    const n = (r) => counts[r] || 0;

    // ---- 紧急兜底：完全没有采集者，强出最小 harvester 防经济崩盘 ----
    const gatherers = n('harvester') + n('miner');
    if (gatherers === 0) {
      this.spawnCreep(spawn, 'harvester', [WORK, CARRY, MOVE]);
      return;
    }

    // ---- 计算目标数量 ----
    const sources = room.find(FIND_SOURCES);
    const numSources = sources.length;
    const useStatic = config.economy.useStaticMining && rcl >= 2; // RCL2+ 才上静态采矿
    const hasConstruction = room.find(FIND_MY_CONSTRUCTION_SITES).length > 0;
    const hostiles = room.find(FIND_HOSTILE_CREEPS).length;

    // 防御：有敌人且开启自动防御
    if (config.military.autoDefendCreeps && hostiles > 0 && n('defender') < Math.min(hostiles + 1, 4)) {
      const body = this.combatBody('defender', cap);
      if (this.spawnCreep(spawn, 'defender', body) === OK) return;
    }

    let targets;
    // 突击基建模式：RCL≤3 且有工地时，多 builder 少 upgrader，能量优先填 extension 打破死循环
    const rushInfra = config.economy.rushInfra && rcl <= 3 && hasConstruction;

    if (useStatic) {
      // 静态采矿模式：每 source 1 miner + N hauler
      targets = [
        ['miner', numSources],
        ['hauler', numSources * config.population.haulersPerSource],
        ['builder', hasConstruction ? (rushInfra ? 3 : config.population.buildersWithSites) : 0],
        ['upgrader', rushInfra ? 1 : this.upgraderTarget(room, rcl)],
      ];
    } else {
      // 早期 harvester 模式（RCL1）
      const spots = sourceManager.totalMiningSpots(room);
      targets = [
        ['harvester', Math.min(spots, rcl <= 1 ? 4 : spots)],
        ['builder', hasConstruction ? (rushInfra ? 3 : config.population.buildersWithSites) : 0],
        ['upgrader', rushInfra ? 1 : this.upgraderTarget(room, rcl)],
      ];
    }

    // 按优先级孵化第一个缺额角色
    for (const [role, target] of targets) {
      if (n(role) < target) {
        const body = this.buildBody(role, cap);
        const res = this.spawnCreep(spawn, role, body);
        if (res === OK) return;
        if (res === ERR_NOT_ENOUGH_ENERGY) return; // 等攒够能量
      }
    }

    // ---- 进攻小队（默认关闭，需 config.military.attack.enabled）----
    const atk = (Memory.config && Memory.config.attack) || config.military.attack;
    if (atk && atk.enabled && atk.targetRoom) {
      if (n('attacker') < atk.squadSize) {
        const body = this.combatBody(atk.type === 'ranged' ? 'ranged' : 'attacker', cap);
        const res = this.spawnCreep(spawn, 'attacker', body, { targetRoom: atk.targetRoom, combatType: atk.type });
        if (res === OK) return;
      }
    }

    // ---- 斥候 ----
    if (config.population.scouts > 0 && n('scout') < config.population.scouts) {
      this.spawnCreep(spawn, 'scout', [MOVE]);
    }
  },

  /** upgrader 目标数：aggressiveUpgrade 时能量富余狂堆 */
  upgraderTarget(room, rcl) {
    let base = config.population.upgradersBase;
    if (config.economy.aggressiveUpgrade) {
      // 能量储备多 → 多派 upgrader 冲 RCL
      const storage = room.storage;
      if (storage && storage.store[RESOURCE_ENERGY] > 5000) base += 3;
      else if (room.energyAvailable >= room.energyCapacityAvailable * 0.8) base += 1;
      if (rcl >= 3 && rcl < 8) base += 1;
    }
    return base;
  },

  /** 经济身体：[WORK,CARRY,MOVE] 单元堆叠；hauler 用 [CARRY,MOVE]；miner 重 WORK */
  buildBody(role, energyCap) {
    if (role === 'miner') {
      // miner 满 WORK 榨干 source：5 WORK + 1 CARRY + 3 MOVE 约 650 能量
      const work = Math.min(5, Math.floor((energyCap - 100) / 100));
      const body = [];
      for (let i = 0; i < Math.max(2, work); i++) body.push(WORK);
      body.push(CARRY);
      const moves = Math.max(1, Math.ceil(body.length / 2));
      for (let i = 0; i < moves; i++) body.push(MOVE);
      return body;
    }
    if (role === 'hauler') {
      // 全 CARRY+MOVE：成对堆叠
      const pairs = Math.max(2, Math.min(8, Math.floor(energyCap / 100)));
      const body = [];
      for (let i = 0; i < pairs; i++) { body.push(CARRY); body.push(MOVE); }
      return body;
    }
    // harvester：source 位置有限时优先堆 WORK（采得快），少量 CARRY/MOVE
    if (role === 'harvester') {
      const body = [];
      let e = energyCap;
      let work = 0;
      // 先尽量堆 WORK（每个100，最多6个=12能量/tick≈榨干source）
      while (e >= 100 && work < 6 && e - 100 >= 100) { body.push(WORK); e -= 100; work++; }
      // 再保证至少 1 CARRY + 足够 MOVE
      body.push(CARRY); e -= 50;
      const moves = Math.max(1, Math.ceil(body.length / 2));
      for (let i = 0; i < moves && e >= 50; i++) { body.push(MOVE); e -= 50; }
      return body.length >= 3 ? body : [WORK, CARRY, MOVE];
    }
    // upgrader / builder：均衡单元
    const units = Math.max(1, Math.min(8, Math.floor(energyCap / 200)));
    const body = [];
    for (let i = 0; i < units; i++) { body.push(WORK); body.push(CARRY); body.push(MOVE); }
    return body;
  },

  /** 战斗身体：defender/attacker 近战，ranged 远程 */
  combatBody(kind, energyCap) {
    const body = [];
    if (kind === 'ranged') {
      // TOUGH + RANGED_ATTACK + MOVE
      const units = Math.max(1, Math.min(5, Math.floor(energyCap / 200)));
      for (let i = 0; i < units; i++) { body.push(TOUGH); body.push(RANGED_ATTACK); body.push(MOVE); body.push(MOVE); }
      return body.length ? body : [RANGED_ATTACK, MOVE];
    }
    // 近战 defender/attacker：TOUGH + ATTACK + MOVE
    const units = Math.max(1, Math.min(6, Math.floor(energyCap / 190)));
    for (let i = 0; i < units; i++) { body.push(TOUGH); body.push(ATTACK); body.push(MOVE); body.push(MOVE); }
    return body.length ? body : [ATTACK, MOVE];
  },

  spawnCreep(spawn, role, body, extraMem) {
    const name = `${role.charAt(0).toUpperCase()}${role.slice(1)}_${Game.time}`;
    const memory = Object.assign({ role, room: spawn.room.name, working: false }, extraMem || {});
    const res = spawn.spawnCreep(body, name, { memory });
    if (res === OK) {
      console.log(`[SPAWN] ${role} -> ${name} body=${body.length}`);
    } else if (res !== ERR_NOT_ENOUGH_ENERGY && res !== ERR_BUSY) {
      console.log(`[SPAWN-FAIL] ${role} err=${res}`);
    }
    return res;
  },
};
