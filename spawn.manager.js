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
const guardian = require('colony.guardian');

module.exports = {
  run(room) {
    const spawn = room.find(FIND_MY_SPAWNS, { filter: (s) => !s.spawning })[0];
    if (!spawn) return;

    // 【免疫系统优先】求生模式下，孵化完全交给 guardian，这里不插手。
    // 避免 guardian 与 spawn.manager 两套逻辑抢 spawn / 反复回收打架。
    if (guardian.isEmergency()) return;

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
    // 【自愈】绝境保护：若 creep 死光，能量够 200 出标准最小号。
    // 【修复】永不出无 CARRY 的 [WORK,MOVE]（采了运不走=白采）；<200 等回血。
    const gatherers = n('harvester') + n('miner');
    if (gatherers === 0) {
      if (cur >= 200) this.spawnCreep(spawn, 'harvester', [WORK, CARRY, MOVE]);
      return; // 未出也 return，下 tick 继续（spawn 正回血）
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
      //
      // 【关键修复 2026-06-23·静态期 bootstrap 死锁】
      //   原 bug：cap≥500 一进静态模式，targets 里再无 'harvester'，只点名 miner(需~600能量)。
      //   若此时采集者很少(如只剩 1 个弱 SOS 体)，能量永远攒不到 600 出 miner，
      //   harvester 又不再补 → 卡死在「1 个采集者 + 能量封顶 500」，表现=「再也不造收获者」。
      //   修复：静态期也保留「最低采集者保底」——采集者(harvester+miner) < 2 时，
      //   先用「当前能量买得起的最大 harvester」把生产力垫起来，再谈高效 miner。
      //
      //   【2026-06-23·二次加固·throughput 死锁】只补到 2 个还不够：2 个弱 harvester(如 W1+W2)
      //   产能撑不起 ~600 能量的 miner，会在「2 采集者 + 能量永远到不了 600」二次卡死。
      //   真正出口：在「还没有任何 miner」之前，持续用 transition 式 harvester-fill 经济
      //   （按开采位数补 harvester），直到攒得出第一个 miner；miner 一旦诞生再切纯静态。
      const _miners = n('miner');
      const _harvesters = n('harvester');
      if (_miners === 0) {
        // 还没有 miner：先把 harvester 补到能填满开采位（含 oversub），用当前能量买得起的体型。
        const _ecoOv = (Memory.config && Memory.config.economy) || {};
        const _oversub = _ecoOv.harvesterOversub || config.economy.harvesterOversub || 1.3;
        const _slots = scheduler.totalSlots(room) || spots || numSources;
        const _harvNeed = Math.min(Math.max(2, Math.ceil(_slots * _oversub)), 12);
        if (_harvesters < _harvNeed) {
          const body = this.affordableHarvester(cur);
          if (body) {
            const res = this.spawnCreep(spawn, 'harvester', body);
            if (res === OK || res === ERR_NOT_ENOUGH_ENERGY) return;
          }
        }
        // harvester 已够：尝试攒/造第一个 miner（buildBody 自适应；钱不够就等）
        if (n('miner') < numSources) {
          const body = this.buildBody('miner', cap);
          const res = this.spawnCreep(spawn, 'miner', body);
          if (res === OK || res === ERR_NOT_ENOUGH_ENERGY) return;
        }
      }
      targets = [
        ['miner', numSources],
        ['hauler', this.haulerTarget(room, numSources)],
        ['builder', hasConstruction ? 4 : 0],
        ['upgrader', infraComplete ? this.upgraderTarget(room, rcl) : 1],
      ];
    } else if (rcl >= 2) {
      // 过渡发育期（RCL2 但 extension 没建完，cap<500）：填满开采位最大化进账。
      const slots = scheduler.totalSlots(room) || spots;
      // 控制台 setOversub() 写 Memory.config.economy.harvesterOversub，优先于静态 config。
      const _ecoOv = (Memory.config && Memory.config.economy) || {};
      const _oversub = _ecoOv.harvesterOversub || config.economy.harvesterOversub || 1.4;
      const harvFill = Math.min(
        Math.ceil(slots * _oversub),
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
      // miner 满 WORK 榨干 source；【关键修复 2026-06-23】保证总成本 ≤ energyCap。
      //   原 bug：work=floor((cap-100)/100) 算出的 body 可能超 cap（cap=550 → 4W+C+3M=600>550）
      //   → miner 永远 ERR_NOT_ENOUGH_ENERGY 造不出 → 静态采矿永远启动不了。
      //   修复：从 work 递减找到「总成本≤cap」的最大身体。
      let work = Math.max(2, Math.min(5, Math.floor((energyCap - 100) / 100)));
      let body;
      for (; work >= 1; work--) {
        const moves = Math.max(1, Math.ceil((work + 1) / 2)); // (work 个 WORK + 1 CARRY) 的一半
        const cost = work * 100 + 50 + moves * 50;
        if (cost <= energyCap) {
          body = [];
          for (let i = 0; i < work; i++) body.push(WORK);
          body.push(CARRY);
          for (let i = 0; i < moves; i++) body.push(MOVE);
          break;
        }
      }
      return body || [WORK, CARRY, MOVE];
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
      const work = this.harvesterWorkCount(energyCap);
      const body = [];
      let e = energyCap;
      for (let i = 0; i < work; i++) { body.push(WORK); e -= 100; }
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
   * 【S2 动态平衡】hauler 数 = 按平均 source→spawn 路程算：路越远需越多。
   * 从 scheduler 预算的 slot.dist 取均值，避免写死 2/source 造成近房空跑/远房不够。
   */
  haulerTarget(room, numSources) {
    const slots = room.memory.slots;
    let avgDist = 15;
    if (slots && slots.all && slots.all.length) {
      const bySrc = {};
      for (const t of slots.all) {
        if (bySrc[t.sourceId] === undefined || t.dist < bySrc[t.sourceId]) bySrc[t.sourceId] = t.dist;
      }
      const dists = Object.keys(bySrc).map((k) => bySrc[k]);
      if (dists.length) avgDist = dists.reduce((a, b) => a + b, 0) / dists.length;
    }
    const cap = room.energyCapacityAvailable;
    const carryCap = Math.max(2, Math.min(8, Math.floor(cap / 100))) * 50;
    const perSource = Math.max(1, Math.ceil((2 * avgDist * 10) / carryCap));
    return Math.min(numSources * perSource, numSources * 4); // 封顶 4/source
  },

  /**
   * 【M4 修复·单一权威公式】采集者 body 的 WORK 数 = floor((cap-50)/100) 上限6。
   * buildBody 和 recycleObsolete 都用此函数，两边口径永远一致，杜绝换号抖动。
   */
  harvesterWorkCount(cap) {
    // 留 50 给 CARRY，其余每 100 一个 WORK，最多 6（≈榨干 source 的 12 能量/tick）
    return Math.max(1, Math.min(6, Math.floor((cap - 50) / 100)));
  },

  /**
   * 【bootstrap 保底体】用「当前可用能量 cur」造买得起的最大 harvester（含 CARRY，能采能运）。
   * 与 buildBody 不同：这里看的是当前 energyAvailable 而非 cap，保证采集者奇缺时总能出一个能用的。
   * cur<200 返回 null（等回血，不出残缺体）。
   */
  affordableHarvester(cur) {
    if (cur < 200) return null; // 连最小 [WORK,CARRY,MOVE]=200 都出不起 → 等回血
    const units = Math.max(1, Math.min(6, Math.floor(cur / 200))); // [WORK,CARRY,MOVE]=200/单元，上限 6
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
    const idealWork = this.harvesterWorkCount(cap); // 【M4】与 buildBody 同一公式

    // 【关键修复 2026-06-23·防经济崩盘】
    // 原 bug：求生模式强孵化的小 harvester（如 [WORK,CARRY,MOVE]，1 WORK）一旦 cap≥500
    //   立刻被判“过时”→标记 recycle→跑回 spawn 拆解消失（表现=“新采集者走两步就回母体自杀”）。
    //   若此时大号还没造出来，会反复回收→团灭→死亡螺旋。
    // 修复门禁：① 现役采集者(harvester+miner)必须 >2 才允许回收（留够生产力，不动最后几个）；
    //          ② 必须已存在至少 1 个“达标大号”(work>=idealWork-1) 才换，确保新陈代谢有接班人。
    let gatherers = 0;
    let hasBigReady = false;
    for (const nm in Game.creeps) {
      const cc = Game.creeps[nm];
      if (cc.room.name !== room.name) continue;
      if (cc.memory.role === 'harvester' || cc.memory.role === 'miner') {
        gatherers++;
        if (cc.getActiveBodyparts(WORK) >= idealWork - 1 && !cc.memory.recycle) hasBigReady = true;
      }
    }
    if (gatherers <= 2 || !hasBigReady) return; // 生产力不足或无接班人 → 本周期不回收

    let marked = 0;
    for (const name in Game.creeps) {
      if (marked >= 1) break; // 每次最多换 1 个，平滑过渡
      const c = Game.creeps[name];
      if (c.room.name !== room.name) continue;
      if (c.memory.role !== 'harvester') continue;
      if (c.memory.recycle) continue;
      // 【关键修复 2026-06-23·新生不回收】刚出生/仍在孵化的幼体不回收，防 spawn→recycle 来回抖动。
      //   原 bug：孵化中 / 刚出生的 creep 其 ticksToLive === undefined，原判据 `c.ticksToLive && c.ticksToLive > 1400`
      //   对 undefined 为假 → 门禄失效 → 新生小号被立即标记 recycle → “生成后没走两步就跑回母体消失”。
      //   修复：undefined(孵化中) 或 ticksToLive>1400(刚生) 都视为新生，一律跳过。
      if (c.spawning || c.ticksToLive === undefined || c.ticksToLive > 1400) continue;
      const work = c.getActiveBodyparts(WORK);
      // 现役号比理想号小一半以上 → 过时，标记回收（idealWork-2 确保不会刚换就被判过时）
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
