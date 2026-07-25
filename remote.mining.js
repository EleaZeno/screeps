'use strict';

/*
 * remote.mining.js — 跨房外矿模块（V3 brain 架构原本缺失的一环）
 * ==================================================================
 * 背景：brain 主循环只处理 room.controller.my 的房间，creep 永远不离开出生房。
 *       周边有无主空房（0 塔、无人守、有 source + 现成掉落/容器能量）= 免费外矿。
 *       本模块让指定 home 房派"外矿队"去 target 房采矿/搬运，走原生 moveTo（自动跨房 + 复用路网）。
 *
 * 设计原则（不破坏现有效用/市场范式）：
 *   - 完全独立：只新增本模块 + executor 两个 handler；不改 brain/market/blackboard/spawning 的核心。
 *   - 安全第一：进 target 房前若探到带攻击部件的敌人 → 全队撤退回 home，不送死。
 *   - 经济门控：home 房 RCL/能量不达标不派（外矿是锦上添花，不能拖垮本房）。
 *   - 低 CPU：每 N tick 才做一次规划；creep 执行靠 memory 标记 + 原生寻路。
 *
 * creep 角色（memory.remote=true 标记，executor 识别 memory.taskType）：
 *   - 'rharvest'：去 target 房钉某个 source 采矿（重 WORK）。采满就近丢进 container/地上。
 *   - 'rhaul'   ：在 target 房捡能量（掉落>container>采矿者身上），运回 home 房 storage/spawn/controller。
 *
 * 配置：Memory.remote.routes = [{home, target, maxHarvest, maxHaul}]
 *   不配置则用本文件 DEFAULT_ROUTES。
 */

const DEFAULT_ROUTES = [
  // （历史）E9N54 → E8N54 曾为外矿。但 E8N54 已于 2026-06 claim 为自己的殖民地，
  //   不再是无主外矿。默认不配任何外矿路线（若将来发现新的无主邻房再手动加）。
];

// home 房经济门槛：低于这些不派外矿（避免拖垮本房发育）
const MIN_HOME_RCL = 2;          // RCL 至少 2（能造像样的 body）
const MIN_HOME_CREEPS = 6;       // 本房自己人口够了才外扩
const REPLAN_INTERVAL = 25;      // 每 25 tick 规划一次（够人就不再生产）
const AUTO_SAFE_SCANS = 3;
const AUTO_CPU_MAX = 12;
const AUTO_BUCKET_MIN = 8000;
const AUTO_STORAGE_FLOOR = 12000;
const DANGER_COOLDOWN = 1000;

module.exports = {
  /**
   * 主入口：处理所有外矿路线。在 main 循环里、对每个 home 房调用一次（或全局调一次）。
   * 这里做全局处理（遍历 routes），与 main 的 per-room 循环解耦。
   */
  run() {
    // ⭐ 安全门控：外矿默认休眠。未显式启用不派任何队。
    //   原因：单 spawn 的 RCL4 房处于 rcl_push 时，外矿会与本房争 spawn 时间、
    //   并把 creep 送进未侦察的邻房。未经线上验证前不自动生效。
    //   启用：Memory.remote.enabled = true（侦察确认 target 房无主无塔、本房能量富余后）。
    Memory.remote = Memory.remote || {};
    if (Memory.remote.auto === undefined) Memory.remote.auto = true;
    if (Memory.remote.auto && Game.time % REPLAN_INTERVAL === 0) this._autoRecover();
    if (!Memory.remote.enabled) return;
    const routes = (Memory.remote && Memory.remote.routes) || DEFAULT_ROUTES;
    if (!Memory.remote.routes) Memory.remote.routes = routes;

    // ⭐ 多房残留自清(2026-07-02): 剔除 target 已成为自己房的死路线，避免反复派矿工去抢自己房。
    const liveRoutes = [];
    for (const route of routes) {
      const tgt = Game.rooms[route.target];
      if (tgt && tgt.controller && tgt.controller.my) {
        route._retired = 'target_now_owned';
        continue; // 跳过：不再为已拥有的 target 派外矿队
      }
      liveRoutes.push(route);
    }

    for (const route of liveRoutes) {
      try { this._runRoute(route); } catch (e) { console.log('remote route err ' + route.home + '->' + route.target + ': ' + e); }
    }

    // ⭐ 驱动所有外矿 creep 的执行。关键：外矿 creep 在 target 房(非我的房)时，
    // main 的 per-room 循环会 continue 跳过那个房 → executor.run 永远驱不到它们。
    // 所以这里统一驱动全体外矿 creep(不管在哪个房)，保证跨房路上也有人推它走。
    let executor; try { executor = require('executor'); } catch (e) { executor = null; }
    if (executor) {
      for (const name in Game.creeps) {
        const c = Game.creeps[name];
        if (c.memory && c.memory.remote && !c.spawning) {
          try { executor.run(c); } catch (e) { console.log('remote exec err ' + name + ': ' + e); }
        }
      }
    }
  },

  /** CPU/储备恢复且 Scout 连续确认安全后逐线恢复。每次最多启用一条，先 1 Miner+1 Hauler 试运行。 */
  _autoRecover() {
    const cpu = Memory.brain && Memory.brain.cpu;
    if (cpu && ((cpu.ema || 0) > AUTO_CPU_MAX || (cpu.bucket || 0) < AUTO_BUCKET_MIN)) return;
    const routes = Memory.remote.routes || DEFAULT_ROUTES;
    let anyLive = false;
    for (const r of routes) if (!r.disabled && !r._retired && r.autoActive) anyLive = true;
    for (const route of routes) {
      if (route._retired || route.manualDisabled) continue;
      const home = Game.rooms[route.home];
      const intel = Memory.intel && Memory.intel.rooms && Memory.intel.rooms[route.target];
      if (!home || !home.controller || !home.controller.my || home.controller.level < 5) continue;
      const stored = home.storage ? (home.storage.store[RESOURCE_ENERGY] || 0) : 0;
      if (stored < AUTO_STORAGE_FLOOR || home.find(FIND_MY_CREEPS).length < MIN_HOME_CREEPS) continue;
      if (!intel || Game.time - intel.lastSeen > 500 || intel.owner || intel.reservation || intel.hostileTower || intel.invaderCore || intel.danger || (intel.safeScans || 0) < AUTO_SAFE_SCANS) continue;
      if (route.cooldownUntil && route.cooldownUntil > Game.time) continue;
      if (!route.autoActive && anyLive) continue; // 一次只恢复一条，先看真实收益/风险
      route.disabled = false;
      route.autoActive = true;
      route.maxHarvest = Math.max(1, Math.min(route.maxHarvest || 1, 1));
      route.maxHaul = Math.max(1, Math.min(route.maxHaul || 1, 1));
      Memory.remote.enabled = true;
      anyLive = true;
    }
  },

  _runRoute(route) {
    if (route.disabled || route.manualDisabled) return;
    const home = Game.rooms[route.home];
    if (!home || !home.controller || !home.controller.my) return; // home 不在视野/不是我的

    // ⭐ 多房残留修复(2026-07-02): target 房若已成为我自己的殖民地(claim 后)，
    //   就不再是“无主外矿”——再派外矿队会去抢它自己的 source、与本地矿工冲突。
    //   自动跳过并标记作废(待 run() 清理配置)。这修用户指出的“两房联动”残留隐患。
    const tgtRoom = Game.rooms[route.target];
    if (tgtRoom && tgtRoom.controller && tgtRoom.controller.my) {
      route._retired = 'target_now_owned';
      return;
    }

    // —— 经济门控：本房没发育起来不外扩 ——
    const homeCreeps = home.find(FIND_MY_CREEPS);
    if (home.controller.level < MIN_HOME_RCL) return;
    if (homeCreeps.length < MIN_HOME_CREEPS) return;

    // —— 本路线现役外矿 creep ——
    const mine = _.filter(Game.creeps, (c) => c.memory.remote && c.memory.rHome === route.home && c.memory.rTarget === route.target);
    const harvesters = mine.filter((c) => c.memory.taskType === 'rharvest');
    const haulers = mine.filter((c) => c.memory.taskType === 'rhaul');

    // —— 安全检查：target 房可见时，探到带攻击部件敌人 → 全队撤退 ——
    const target = Game.rooms[route.target];
    let danger = false;
    if (target) {
      const threats = target.find(FIND_HOSTILE_CREEPS, {
        filter: (h) => h.getActiveBodyparts && (h.getActiveBodyparts(ATTACK) + h.getActiveBodyparts(RANGED_ATTACK)) > 0,
      });
      danger = threats.length > 0;
      const hostileInfra = target.find(FIND_HOSTILE_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_TOWER || s.structureType === STRUCTURE_INVADER_CORE,
      });
      if (hostileInfra.length) danger = true;
    }
    const intel = Memory.intel && Memory.intel.rooms && Memory.intel.rooms[route.target];
    if (intel && (intel.hostileTower || intel.invaderCore || intel.danger)) danger = true;
    Memory.remote[route.target + ':danger'] = danger;
    if (danger) {
      // 撤退：标记所有本队 creep 回家避难（executor 看到 retreat 标记就往 home 撤）
      for (const c of mine) c.memory.retreat = true;
      route.autoActive = false;
      route.cooldownUntil = Game.time + DANGER_COOLDOWN;
      return; // 危险期不再孵化
    }
    for (const c of mine) delete c.memory.retreat;

    // —— 驱动现役 creep（执行交给 executor 的 rharvest/rhaul handler，这里只确保有任务标记）——
    // target source 分配：把 harvester 钉到不同 source（按出生顺序轮流）
    if (target) {
      const srcs = target.find(FIND_SOURCES);
      let i = 0;
      for (const c of harvesters) {
        if (!c.memory.rSource && srcs.length) { c.memory.rSource = srcs[i % srcs.length].id; i++; }
      }
      // —— 阶段3 外矿提效：低频铺路网 + target 房 source 旁建 container ——
      // 只在 target 可见时做，且低频（避免每 tick 扫）；CPU 微。
      if (Game.time % 50 === 0) {
        try { this._planRemoteContainers(target, srcs); } catch (e) { /* 不影响主逻辑 */ }
        try { this._planRouteRoads(home, target); } catch (e) { /* 同上 */ }
      }
    }

    // —— 孵化（每 REPLAN_INTERVAL tick 评估一次缺口）——
    if (Game.time % REPLAN_INTERVAL !== 0) return;
    const idleSpawn = home.find(FIND_MY_SPAWNS, { filter: (s) => !s.spawning })[0];
    if (!idleSpawn) return;

    const cap = home.energyCapacityAvailable;
    const cur = home.energyAvailable;

    // 优先补 harvester（没人采就没货可搬），再补 hauler
    if (harvesters.length < route.maxHarvest) {
      const body = this._remoteMinerBody(cap);
      if (cur >= this._cost(body)) {
        idleSpawn.spawnCreep(body, 'RMiner_' + Game.time, {
          memory: { remote: true, rHome: route.home, rTarget: route.target, taskType: 'rharvest', born: Game.time },
        });
      }
      return;
    }
    if (haulers.length < route.maxHaul) {
      const body = this._remoteHaulerBody(cap);
      if (cur >= this._cost(body)) {
        idleSpawn.spawnCreep(body, 'RHaul_' + Game.time, {
          memory: { remote: true, rHome: route.home, rTarget: route.target, taskType: 'rhaul', born: Game.time },
        });
      }
    }

    // 试运行自适应：target container/掉落长期积压说明运力不足，逐步加 Hauler；无积压不盲目扩军。
    if (route.autoActive && target && Game.time % 100 === 0) {
      let backlog = 0;
      for (const d of target.find(FIND_DROPPED_RESOURCES, { filter: (r) => r.resourceType === RESOURCE_ENERGY })) backlog += d.amount || 0;
      for (const s of target.find(FIND_STRUCTURES, { filter: (s) => s.structureType === STRUCTURE_CONTAINER })) backlog += s.store[RESOURCE_ENERGY] || 0;
      if (backlog > 1500) route.maxHaul = Math.min(4, (route.maxHaul || 1) + 1);
      route.lastBacklog = backlog;
    }
  },

  /** 阶段3(a)：target 房每个 source 旁建一个 container（矿工采满丢 container，hauler 整仓搬，减空跑）。
   *  外矿房是无主房，可以在里面建 container（不需控制权）。每 source 只建 1 个，已有则跳过。 */
  _planRemoteContainers(target, srcs) {
    if (!target || !srcs || !srcs.length) return;
    const terrain = target.getTerrain();
    for (const src of srcs) {
      // 该 source range1 已有 container/工地则跳过
      const near = src.pos.findInRange(FIND_STRUCTURES, 1, { filter: (s) => s.structureType === STRUCTURE_CONTAINER });
      const nearS = src.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, { filter: (s) => s.structureType === STRUCTURE_CONTAINER });
      if (near.length || nearS.length) continue;
      // 在 source 周边找一个可站空格建 container
      let done = false;
      for (let dx = -1; dx <= 1 && !done; dx++) for (let dy = -1; dy <= 1 && !done; dy++) {
        if (!dx && !dy) continue;
        const x = src.pos.x + dx, y = src.pos.y + dy;
        if (x < 1 || x > 48 || y < 1 || y > 48) continue;
        if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
        const pos = new RoomPosition(x, y, target.name);
        const here = pos.lookFor(LOOK_STRUCTURES).concat(pos.lookFor(LOOK_CONSTRUCTION_SITES));
        if (here.length) continue;
        if (target.createConstructionSite(x, y, STRUCTURE_CONTAINER) === OK) {
          console.log('[REMOTE] container @' + x + ',' + y + ' (' + target.name + ' source旁)');
          done = true;
        }
      }
    }
  },

  /** 阶段3(b)：home spawn → target 每个 source 的路径上铺 road（hauler 走路网移动减半=运力翻倍）。
   *  跨房用 PathFinder 算路径；只在可见房间内的格建工地（不可见房间建不了）。
   *  低频 + 上限工地数，避免压城/抽能量。 */
  _planRouteRoads(home, target) {
    if (!home || !target) return;
    const homeSpawn = home.find(FIND_MY_SPAWNS)[0];
    if (!homeSpawn) return;
    // 控制总工地数：两房加起来外矿路工地 ≥6 就不再排（先修完再说）
    const roadSites = (r) => r.find(FIND_CONSTRUCTION_SITES, { filter: (s) => s.structureType === STRUCTURE_ROAD }).length;
    if (roadSites(home) + roadSites(target) >= 6) return;
    let budget = 3;
    const srcs = target.find(FIND_SOURCES);
    for (const src of srcs) {
      if (budget <= 0) break;
      const ret = PathFinder.search(homeSpawn.pos, { pos: src.pos, range: 1 }, {
        plainCost: 2, swampCost: 5, maxOps: 4000,
        roomCallback: (rn) => {
          const rm = Game.rooms[rn];
          if (!rm) return undefined;
          const cm = new PathFinder.CostMatrix();
          rm.find(FIND_STRUCTURES).forEach((s) => {
            if (s.structureType === STRUCTURE_ROAD) cm.set(s.pos.x, s.pos.y, 1);
          });
          return cm;
        },
      });
      if (ret.incomplete) continue;
      for (const step of ret.path) {
        if (budget <= 0) break;
        const rm = Game.rooms[step.roomName];
        if (!rm) continue;                       // 不可见房间跳过
        const pos = new RoomPosition(step.x, step.y, step.roomName);
        const here = pos.lookFor(LOOK_STRUCTURES).concat(pos.lookFor(LOOK_CONSTRUCTION_SITES));
        if (here.some((s) => s.structureType === STRUCTURE_ROAD)) continue;
        if (here.some((s) => s.structureType !== STRUCTURE_ROAD && s.structureType !== STRUCTURE_RAMPART && s.structureType !== STRUCTURE_CONTAINER)) continue;
        if (rm.createConstructionSite(step.x, step.y, STRUCTURE_ROAD) === OK) budget--;
      }
    }
  },

  /** 外矿矿工体：重 WORK + 1 CARRY + 足够 MOVE（外矿路远，要走得动）。
   *  外矿无 spawn 喂，靠自己走过去，MOVE 配比要高些（背 WORK 在平原走）。 */
  _remoteMinerBody(cap) {
    // 目标 5 WORK 榨干 source；MOVE 按 (WORK+CARRY) 一半（平原每 2 part 1 MOVE）
    let work = Math.min(5, Math.max(2, Math.floor((cap - 150) / 130)));
    for (; work >= 2; work--) {
      const moves = Math.max(2, Math.ceil((work + 1) / 2));
      const cost = work * 100 + 50 + moves * 50;
      if (cost <= cap) {
        const b = [];
        for (let i = 0; i < work; i++) b.push(WORK);
        b.push(CARRY);
        for (let i = 0; i < moves; i++) b.push(MOVE);
        return b;
      }
    }
    return [WORK, WORK, CARRY, MOVE, MOVE];
  },

  /** 外矿搬运体：成对 CARRY+MOVE（满速跑，外矿路远运量要大）。 */
  _remoteHaulerBody(cap) {
    const pairs = Math.max(2, Math.min(12, Math.floor(cap / 100)));
    const b = [];
    for (let i = 0; i < pairs; i++) { b.push(CARRY); b.push(MOVE); }
    return b;
  },

  _cost(body) {
    const c = { work: 100, carry: 50, move: 50, attack: 80, ranged_attack: 150, heal: 250, tough: 10, claim: 600 };
    return body.reduce((s, p) => s + (c[p] || 0), 0);
  },
};
