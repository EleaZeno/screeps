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
const scheduler = require('source.scheduler');
const infra = require('infra');

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

    // ---- 主动淘汰过时小号（中央调度，不给 creep 自由）----
    // 能量上限提升后，旧的小采集者效率低。当 cap 比某 creep 出生时大很多，
    // 主动回收它（送回 spawn 拆解返还能量），换成吃满新 cap 的大号。每 tick 最多标记 1 个。
    this.recycleObsolete(room, spawn, cap);

    // 静态采矿要发挥威力需要“大 miner”（能堆 4-5 WORK 榨干 source）。
    // 但 RCL2 extension 没建完时能量上限只有 300，miner 太小吃不满 source。
    // 过渡策略：能量上限 < 500 时先用“多小 harvester 填满开采位”，进账更快；
    // extension 建完(cap≥500)后再切回高效的“大 miner + hauler”。
    const bigMinerReady = cap >= 500;
    const useStatic = config.economy.useStaticMining && rcl >= 2 && bigMinerReady;
    const hasConstruction = room.find(FIND_MY_CONSTRUCTION_SITES).length > 0;
    const hostiles = room.find(FIND_HOSTILE_CREEPS).length;
    const spots = sourceManager.totalMiningSpots(room);

    // 防御：有敌人且开启自动防御
    if (config.military.autoDefendCreeps && hostiles > 0 && n('defender') < Math.min(hostiles + 1, 4)) {
      const body = this.combatBody('defender', cap);
      if (this.spawnCreep(spawn, 'defender', body) === OK) return;
    }

    let targets;
    // 发育哲学（用户原则）：每一级先把基建+开采速度榚满，再升下一级。
    // infraComplete = 当前 RCL 的 extension 全建成 + source container 就位。
    // 未完成 → 能量全砸基建（只留 1 upgrader 防降级）；完成 → 才放行 upgrader 冲下一级。
    const infraComplete = infra.isComplete(room);

    if (useStatic) {
      // 静态采矿模式：每 source 1 miner + N hauler
      // 哲学：基建未完成时 upgrader 只留 1（防降级），能量全给 builder
      targets = [
        ['miner', numSources],
        ['hauler', numSources * config.population.haulersPerSource],
        ['builder', hasConstruction ? 4 : 0],
        ['upgrader', infraComplete ? this.upgraderTarget(room, rcl) : 1],
      ];
    } else if (rcl >= 2) {
      // 过渡发育期（RCL2 但 extension 没建完，cap<500）：填满开采位最大化进账。
      const slots = scheduler.totalSlots(room) || spots;
      const harvFill = Math.min(
        Math.ceil(slots * (config.economy.harvesterOversub || 1.4)),
        16
      );
      // 哲学：基建未完成 → 专心干一件事（填满采集位 + 多 builder 建 extension），
      // upgrader 只留 1 防降级；基建完成后才放行多 upgrader 冲级。
      targets = [
        ['harvester', Math.min(3, harvFill)],
        ['builder', hasConstruction ? 4 : 0],
        ['harvester', harvFill],
        ['upgrader', infraComplete ? this.upgraderTarget(room, rcl) : 1],
      ];
    } else {
      // RCL1：无 extension，基建算“完成”，可狂升 controller 冲 RCL2
      const harvTarget = Math.min(spots, 3);
      targets = [
        ['harvester', Math.min(2, harvTarget)],
        ['upgrader', 2],
        ['harvester', harvTarget],
        ['builder', hasConstruction ? config.population.buildersWithSites : 0],
        ['upgrader', this.upgraderTarget(room, rcl)],
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
      // 能量储备多 → 狂派 upgrader 冲 RCL/GCL（快速扩张核心：能量全砂 controller）
      const storage = room.storage;
      if (storage && storage.store[RESOURCE_ENERGY] > 10000) base += 6;
      else if (storage && storage.store[RESOURCE_ENERGY] > 5000) base += 4;
      else if (room.energyAvailable >= room.energyCapacityAvailable * 0.8) base += 2;
      if (rcl >= 3 && rcl < 8) base += 2;
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

  /**
   * 主动淘汰过时小号：cap 提升后，body 远小于当前能造的最大号的采集者，
   * 标记 recycle。creep 逻辑里看到 recycle 标记会跑回 spawn 自我拆解返还能量。
   * 哲学：中央调度统一决策，旧号不达标主动换新，不留低效单位。
   */
  recycleObsolete(room, spawn, cap) {
    // 基建未建完时不回收（避免青黄不接停采），只在 cap≥500 静态期做新陈代谢
    if (cap < 500) return;
    if (Game.time % 10 !== 0) return; // 低频检查省 CPU
    const idealWork = Math.min(6, Math.floor((cap - 50) / 100)); // 当前能造的采集者 WORK 数
    let marked = 0;
    for (const name in Game.creeps) {
      if (marked >= 1) break; // 每次最多换 1 个，平滑过渡
      const c = Game.creeps[name];
      if (c.room.name !== room.name) continue;
      if (c.memory.role !== 'harvester') continue;
      if (c.memory.recycle) continue;
      const work = c.getActiveBodyparts(WORK);
      // 现役号比理想号小一半以上 → 过时，标记回收
      if (work > 0 && work <= idealWork - 2) {
        c.memory.recycle = true;
        marked++;
        console.log(`[RECYCLE] ${name} W${work} 过时(理想W${idealWork})，标记回收换大号`);
      }
    }
  },

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
