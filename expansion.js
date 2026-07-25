'use strict';

/*
 * expansion.js — 殖民扩张模块（占领第二房间）
 * ==================================================================
 * 背景：GCL≥2 允许占第 2 个房间。但 brain 主循环的 build.planner/layout.planner
 *       都以 room.find(FIND_MY_SPAWNS)[0] 为原点，新房没 spawn 就什么都规划不了、
 *       spawning 也孵化不了。所以从 0 到"新房能自转"这段引导期必须本模块托管。
 *
 * 引导期三阶段（每个 route 独立推进，靠 target 房实际状态判断，不靠计时）：
 *   Stage 1 CLAIM   ：从 home 派 1 个 claimer(CLAIM+MOVE) → 走到 target → claimController。
 *                     target.controller.my 变 true 即完成。
 *   Stage 2 BUILD   ：controller 已占但房内无 spawn → 从 home 派 pioneer(WORK/CARRY/MOVE)。
 *                     pioneer 到 target 后：自采本地 source → 就近 spawn 工地建造。
 *                     第一个 spawn 工地由本模块在 controller 附近选址下达。
 *                     房内出现 my spawn 即完成 → 本 route 退休(交还主循环)。
 *   Stage 3 DONE    ：新房已有 spawn，主循环的 brain/blackboard/spawning/planner 全接管。
 *                     pioneer 仍可留几只帮建 extension，寿命到自然消亡。
 *
 * 设计原则（对齐 remote.mining，不破坏 brain/market/blackboard 核心）：
 *   - 独立全局模块：只新增本文件 + executor 3 个 handler + 1 个 expand() 命令。
 *   - 安全门控：自动模式只选择连续侦察安全、无主无塔的候选房；target 探到敌人立即撤退并冷却。
 *   - 经济门控：home RCL/能量不达标不派 claimer(claimer 要 650 能量身体)。
 *   - 低 CPU：每 REPLAN_INTERVAL tick 才规划孵化；creep 执行靠 memory 标记 + 原生寻路。
 *
 * creep 角色(memory.expand=true, executor 识别 memory.eTask)：
 *   - 'claim' ：走到 target 房 claimController。
 *   - 'pioneer'：在 target 房自采 source → 建 spawn 工地/其它工地。
 *
 * 启用：expand('E8N54')  → 写 Memory.expansion.routes 并激活。
 * 停用：stopExpand()
 */

// home RCL 门槛：claimer 身体 = CLAIM(600)+MOVE(50)=650，home 至少要能凑出 650 能量。
const MIN_HOME_RCL = 3;
const MIN_HOME_CREEPS = 8;      // 本房人口够了才分兵扩张（不拖垮冲级）
const REPLAN_INTERVAL = 15;     // 每 15 tick 评估一次孵化缺口
const MAX_PIONEERS = 4;         // 建 spawn 期最多派几个 pioneer
const CLAIM_TTL_GUARD = 100;    // claimer 快死了(ttl<此)也没占成 → 允许补一个
const AUTO_INTERVAL = 25;
const SCOUT_REFRESH = 150;
const SAFE_SCANS_REQUIRED = 3;
const EXPAND_STORAGE_FLOOR = 30000;
const EXPAND_CPU_EMA_MAX = 12;
const EXPAND_BUCKET_MIN = 8000;
const DANGER_COOLDOWN = 1500;

module.exports = {
  run() {
    // 轻量控制台命令注册（不依赖任何 UI 模块，只挂 global）。
    // 线上不加载 commands.js（其依赖 dashboard 等未上线模块），所以扩张命令自己挂。
    this._registerCommands();
    Memory.expansion = Memory.expansion || {};
    if (Memory.expansion.auto === undefined) Memory.expansion.auto = true;
    if (Memory.expansion.auto && Game.time % AUTO_INTERVAL === 0) {
      try { this._autoPlan(); } catch (e) { console.log('[EXPAND] auto err ' + e); }
    }
    // 手动 stopExpand() 只暂停占领队；Scout 仍维持低频安全情报，供外矿与后续恢复使用。
    if (!Memory.expansion.enabled) {
      this._driveExpandCreeps();
      return;
    }
    const routes = Memory.expansion.routes || [];
    if (!routes.length) return;

    for (const route of routes) {
      try { this._runRoute(route); } catch (e) { console.log('[EXPAND] route err ' + route.home + '->' + route.target + ': ' + e); }
    }

    // 统一驱动所有扩张 creep（它们大多在 target 房，主循环 per-room 会跳过非 my 房，
    // 或新房刚占下但还没 spawn，主循环虽接管但 executor 只驱动 market 分配的 creep）。
    this._driveExpandCreeps();
  },

  _driveExpandCreeps() {
    let executor; try { executor = require('executor'); } catch (e) { executor = null; }
    if (executor) {
      for (const name in Game.creeps) {
        const c = Game.creeps[name];
        if (c.memory && c.memory.expand && !c.spawning) {
          try { executor.run(c); } catch (e) { console.log('[EXPAND] exec err ' + name + ': ' + e); }
        }
      }
    }
  },

  /** 帝国自动层：维护邻房 Scout 情报；GCL、CPU、储备和连续安全观测均达标后，只启动一条殖民路线。 */
  _autoPlan() {
    const e = Memory.expansion;
    const owned = this._ownedRooms();
    if (!owned.length) return;
    this._recordVisibleIntel();
    this._ensureScouts(owned);

    const active = (e.routes || []).find((r) => !r.done && !r.failed);
    if (active || owned.length >= Game.gcl.level) return;
    const cpu = Memory.brain && Memory.brain.cpu;
    if (cpu && ((cpu.ema || 0) > EXPAND_CPU_EMA_MAX || (cpu.bucket || 0) < EXPAND_BUCKET_MIN)) return;

    const existingTargets = {};
    for (const r of (e.routes || [])) existingTargets[r.target] = r;
    const candidates = this._candidateRooms(owned).map((rn) => {
      const intel = Memory.intel && Memory.intel.rooms && Memory.intel.rooms[rn];
      if (!intel || (Game.time - intel.lastSeen) > SCOUT_REFRESH * 3) return null;
      if (intel.owner || intel.reservation || intel.hostileTower || intel.invaderCore || intel.danger) return null;
      if ((intel.safeScans || 0) < SAFE_SCANS_REQUIRED || (intel.sources || 0) < 2) return null;
      if (intel.cooldownUntil && intel.cooldownUntil > Game.time) return null;
      let bestHome = null, bestHomeScore = -Infinity;
      for (const room of owned) {
        const stored = room.storage ? (room.storage.store[RESOURCE_ENERGY] || 0) : 0;
        const hostiles = room.find(FIND_HOSTILE_CREEPS).length;
        if (room.controller.level < 6 || stored < EXPAND_STORAGE_FLOOR || hostiles) continue;
        const dist = Game.map.getRoomLinearDistance(room.name, rn);
        const score = stored / 1000 - dist * 12 + room.controller.level * 5;
        if (score > bestHomeScore) { bestHomeScore = score; bestHome = room.name; }
      }
      if (!bestHome) return null;
      return { room: rn, home: bestHome, score: (intel.sources || 0) * 100 - (intel.swampRatio || 0) * 40 + bestHomeScore };
    }).filter(Boolean).sort((a, b) => b.score - a.score);
    if (!candidates.length) return;
    const pick = candidates[0];
    e.enabled = true;
    e.routes = e.routes || [];
    const previous = existingTargets[pick.room];
    if (previous) {
      previous.home = pick.home; previous.failed = false; previous.done = false;
      previous.started = Game.time; previous.score = Math.round(pick.score); previous.auto = true;
    } else {
      e.routes.push({ home: pick.home, target: pick.room, auto: true, started: Game.time, score: Math.round(pick.score) });
    }
    console.log('[EXPAND] auto selected ' + pick.home + '->' + pick.room + ' score=' + Math.round(pick.score));
  },

  _ownedRooms() {
    const out = [];
    for (const rn in Game.rooms) {
      const r = Game.rooms[rn];
      if (r.controller && r.controller.my) out.push(r);
    }
    return out;
  },

  _candidateRooms(owned) {
    const seen = {};
    for (const room of owned) {
      const exits = Game.map.describeExits(room.name) || {};
      for (const d in exits) if (exits[d]) seen[exits[d]] = true;
    }
    return Object.keys(seen).filter((rn) => !Game.rooms[rn] || !Game.rooms[rn].controller || !Game.rooms[rn].controller.my);
  },

  _ensureScouts(owned) {
    const candidates = this._candidateRooms(owned);
    const scouts = Object.keys(Game.creeps).map((n) => Game.creeps[n]).filter((c) => c.memory && c.memory.expand && c.memory.eTask === 'scout');
    const assigned = {};
    for (const c of scouts) assigned[c.memory.eTarget] = true;
    for (const target of candidates) {
      const intel = Memory.intel && Memory.intel.rooms && Memory.intel.rooms[target];
      if (assigned[target] || (intel && Game.time - intel.lastSeen < SCOUT_REFRESH)) continue;
      let home = null;
      for (const r of owned) {
        if (r.controller.level < 3 || r.find(FIND_MY_CREEPS).length < 6) continue;
        const sp = r.find(FIND_MY_SPAWNS, { filter: (s) => !s.spawning })[0];
        if (sp && r.energyAvailable >= 50) { home = { room: r, spawn: sp }; break; }
      }
      if (!home) return;
      const ret = home.spawn.spawnCreep([MOVE], 'Scout_' + target + '_' + Game.time, {
        memory: { expand: true, eTask: 'scout', eHome: home.room.name, eTarget: target, born: Game.time },
      });
      if (ret === OK) return; // 每轮最多占用一个 spawn tick
    }
  },

  _recordVisibleIntel() {
    Memory.intel = Memory.intel || {};
    Memory.intel.rooms = Memory.intel.rooms || {};
    for (const rn in Game.rooms) {
      const room = Game.rooms[rn];
      if (!room.controller || room.controller.my) continue;
      const old = Memory.intel.rooms[rn] || {};
      const towers = room.find(FIND_HOSTILE_STRUCTURES, { filter: (s) => s.structureType === STRUCTURE_TOWER });
      const cores = room.find(FIND_HOSTILE_STRUCTURES, { filter: (s) => s.structureType === STRUCTURE_INVADER_CORE });
      const threats = room.find(FIND_HOSTILE_CREEPS, { filter: (h) => h.getActiveBodyparts && (h.getActiveBodyparts(ATTACK) + h.getActiveBodyparts(RANGED_ATTACK) + h.getActiveBodyparts(HEAL)) > 0 });
      const ctrl = room.controller;
      const owner = ctrl.owner && ctrl.owner.username;
      const reservation = ctrl.reservation && ctrl.reservation.username;
      const danger = !!(towers.length || cores.length || threats.length || owner || reservation);
      let swamp = 0, open = 0;
      const terrain = room.getTerrain();
      for (let x = 2; x < 48; x += 3) for (let y = 2; y < 48; y += 3) {
        const t = terrain.get(x, y);
        if (t !== TERRAIN_MASK_WALL) { open++; if (t === TERRAIN_MASK_SWAMP) swamp++; }
      }
      Memory.intel.rooms[rn] = {
        lastSeen: Game.time, owner: owner || null, reservation: reservation || null,
        hostileTower: towers.length, invaderCore: cores.length, danger,
        sources: room.find(FIND_SOURCES).length, swampRatio: open ? swamp / open : 1,
        safeScans: danger ? 0 : Math.min(20, (old.safeScans || 0) + 1),
        cooldownUntil: danger ? Game.time + DANGER_COOLDOWN : (old.cooldownUntil || 0),
      };
    }
  },

  _runRoute(route) {
    const home = Game.rooms[route.home];
    if (!home || !home.controller || !home.controller.my) return;

    const target = Game.rooms[route.target];
    const claimed = target && target.controller && target.controller.my;
    const hasSpawn = target && target.find(FIND_MY_SPAWNS).length > 0;

    // —— Stage 3：新房已自转，本 route 退休 ——
    if (claimed && hasSpawn) {
      if (!route.done) {
        route.done = true;
        console.log('🎉 [EXPAND] ' + route.target + ' 已建成第一个 spawn，扩张完成！交还主循环托管。');
      }
      // pioneer 不再补充，剩余的自然消亡（它们仍会被驱动帮建）。
      return;
    }

    // —— 安全检查：target 可见且有攻击敌人 → 全队撤退 ——
    let danger = false;
    if (target) {
      const threats = target.find(FIND_HOSTILE_CREEPS, {
        filter: (h) => h.getActiveBodyparts && (h.getActiveBodyparts(ATTACK) + h.getActiveBodyparts(RANGED_ATTACK) + h.getActiveBodyparts(HEAL)) > 0,
      });
      danger = threats.length > 0;
      const inv = target.find(FIND_HOSTILE_STRUCTURES, { filter: (s) => s.structureType === STRUCTURE_INVADER_CORE });
      if (inv.length) danger = true;
    }
    Memory.expansion[route.target + ':danger'] = danger;
    const mine = _.filter(Game.creeps, (c) => c.memory.expand && c.memory.eHome === route.home && c.memory.eTarget === route.target);
    if (danger) {
      for (const c of mine) c.memory.retreat = true;
      route.dangerAt = Game.time;
      route.failed = !!(route.auto && !claimed);
      const intel = Memory.intel && Memory.intel.rooms && Memory.intel.rooms[route.target];
      if (intel) intel.cooldownUntil = Game.time + DANGER_COOLDOWN;
      console.log('⚠️ [EXPAND] ' + route.target + ' 有敌，扩张队撤退。');
      return;
    }
    for (const c of mine) delete c.memory.retreat;

    // —— 经济门控 ——
    const homeCreeps = home.find(FIND_MY_CREEPS, { filter: (c) => !c.memory.remote && !c.memory.expand });
    if (home.controller.level < MIN_HOME_RCL) return;
    if (homeCreeps.length < MIN_HOME_CREEPS) return;

    const claimers = mine.filter((c) => c.memory.eTask === 'claim');
    const pioneers = mine.filter((c) => c.memory.eTask === 'pioneer');

    // —— Stage 2：已占控制器但无 spawn → 确保 spawn 工地存在 + 派 pioneer 建 ——
    if (claimed && !hasSpawn) {
      this._ensureSpawnSite(target);
    }

    // —— 孵化评估（低频）——
    if (Game.time % REPLAN_INTERVAL !== 0) return;
    const idleSpawn = home.find(FIND_MY_SPAWNS, { filter: (s) => !s.spawning })[0];
    if (!idleSpawn) return;
    const cap = home.energyCapacityAvailable;
    const cur = home.energyAvailable;

    // Stage 1：还没占 → 保证有 1 个 claimer 在路上
    if (!claimed) {
      const aliveClaimer = claimers.find((c) => (c.ticksToLive || 1500) > CLAIM_TTL_GUARD || c.spawning);
      if (!aliveClaimer) {
        const body = [CLAIM, MOVE];
        // 远路多加 MOVE（CLAIM part 重，1 MOVE 拖不动跨房长途）
        if (cap >= 700) body.push(MOVE);
        if (cap >= 750) body.push(MOVE);
        const cost = this._cost(body);
        if (cur >= cost) {
          const r = idleSpawn.spawnCreep(body, 'Claimer_' + Game.time, {
            memory: { expand: true, eHome: route.home, eTarget: route.target, eTask: 'claim', born: Game.time },
          });
          if (r === OK) console.log('🚩 [EXPAND] 孵化 claimer → ' + route.target + ' body=[' + body.join(',') + ']');
        }
      }
      return; // 占领前不派 pioneer（省得白跑）
    }

    // Stage 2：已占，补 pioneer 建 spawn
    if (pioneers.length < MAX_PIONEERS) {
      const body = this._pioneerBody(cap);
      const cost = this._cost(body);
      if (cur >= cost) {
        const r = idleSpawn.spawnCreep(body, 'Pioneer_' + Game.time, {
          memory: { expand: true, eHome: route.home, eTarget: route.target, eTask: 'pioneer', born: Game.time },
        });
        if (r === OK) console.log('👷 [EXPAND] 孵化 pioneer → ' + route.target + ' (' + (pioneers.length + 1) + '/' + MAX_PIONEERS + ')');
      }
    }
  },

  /** 在新房 controller 附近选址下达第一个 spawn 工地（只下一个，已有则跳过）。
   *  选址：controller 与最近 source 连线的中点附近找一块平地(留出周边扩展空间)。 */
  _ensureSpawnSite(target) {
    const existing = target.find(FIND_MY_CONSTRUCTION_SITES, { filter: (s) => s.structureType === STRUCTURE_SPAWN });
    if (existing.length) return;
    const existingSp = target.find(FIND_MY_SPAWNS);
    if (existingSp.length) return;

    const ctrl = target.controller;
    const srcs = target.find(FIND_SOURCES);
    if (!ctrl || !srcs.length) return;
    // 目标点：controller 与最近 source 的中点（兼顾采矿与升级距离）
    const src = ctrl.pos.findClosestByRange(srcs) || srcs[0];
    const midX = Math.round((ctrl.pos.x + src.pos.x) / 2);
    const midY = Math.round((ctrl.pos.y + src.pos.y) / 2);
    const terrain = target.getTerrain();
    // 从中点螺旋外扩找第一块 3x3 都非墙、且远离 controller≥3(避免贴脸)的平地中心
    for (let r = 0; r <= 8; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // 只走当前环
        const x = midX + dx, y = midY + dy;
        if (x < 3 || x > 46 || y < 3 || y > 46) continue;
        if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
        const pos = new RoomPosition(x, y, target.name);
        if (pos.getRangeTo(ctrl.pos) < 3) continue;       // 别贴控制器
        // 周边 8 格至少 6 格非墙（留出 extension 空间）
        let open = 0;
        for (let ex = -1; ex <= 1; ex++) for (let ey = -1; ey <= 1; ey++) {
          if (!ex && !ey) continue;
          if (terrain.get(x + ex, y + ey) !== TERRAIN_MASK_WALL) open++;
        }
        if (open < 6) continue;
        const here = pos.lookFor(LOOK_STRUCTURES).concat(pos.lookFor(LOOK_CONSTRUCTION_SITES));
        if (here.length) continue;
        if (target.createConstructionSite(x, y, STRUCTURE_SPAWN) === OK) {
          console.log('🏗️ [EXPAND] ' + target.name + ' spawn 工地选址 @' + x + ',' + y);
          Memory.expansion[target.name + ':spawnSite'] = { x, y };
          return;
        }
      }
    }
    console.log('⚠️ [EXPAND] ' + target.name + ' 找不到合适 spawn 选址(地形太差)');
  },

  /** pioneer 体：均衡 WORK/CARRY/MOVE（既要自采又要建造，还要跨房走）。 */
  _pioneerBody(cap) {
    // 每组 [WORK,CARRY,MOVE]=200；跨房路远，MOVE 足量
    const groups = Math.max(2, Math.min(6, Math.floor(cap / 200)));
    const b = [];
    for (let i = 0; i < groups; i++) b.push(WORK);
    for (let i = 0; i < groups; i++) b.push(CARRY);
    for (let i = 0; i < groups; i++) b.push(MOVE);
    return b;
  },

  _cost(body) {
    const c = { work: 100, carry: 50, move: 50, attack: 80, ranged_attack: 150, heal: 250, tough: 10, claim: 600 };
    return body.reduce((s, p) => s + (c[p] || 0), 0);
  },

  /** 挂载 expand()/stopExpand()/expandStatus() 到 global（幂等，每 tick 调也便宜）。 */
  _registerCommands() {
    if (typeof global === 'undefined' || global.__expandCmds) return;
    global.__expandCmds = true;
    global.expand = function (targetRoom, homeRoom) {
      if (!targetRoom) return '用法: expand("E8N54") 或 expand("E8N54","E9N54")。当前 GCL=' + Game.gcl.level;
      const home = homeRoom || Object.keys(Game.rooms).find((r) => Game.rooms[r].controller && Game.rooms[r].controller.my);
      if (!home) return '⚠ 找不到主房作为 home';
      const owned = Object.keys(Game.rooms).filter((r) => Game.rooms[r].controller && Game.rooms[r].controller.my).length;
      if (owned >= Game.gcl.level) return '❌ GCL=' + Game.gcl.level + ' 只能拥有 ' + Game.gcl.level + ' 个房，已有 ' + owned + ' 个。';
      Memory.expansion = Memory.expansion || {};
      Memory.expansion.enabled = true;
      Memory.expansion.routes = Memory.expansion.routes || [];
      const exist = Memory.expansion.routes.find((r) => r.target === targetRoom);
      if (exist) { exist.home = home; exist.done = false; return '🔄 已更新扩张路线 ' + home + '→' + targetRoom; }
      Memory.expansion.routes.push({ home, target: targetRoom });
      return '🚀 扩张已启动：' + home + ' → ' + targetRoom + '。claim→建spawn→交还主循环。停止: stopExpand()';
    };
    global.stopExpand = function () {
      Memory.expansion = Memory.expansion || {};
      Memory.expansion.enabled = false;
      return '🛑 扩张已暂停（现役 creep 自然消亡）。重启: expand("房名")';
    };
    global.expandStatus = function () {
      const e = Memory.expansion;
      if (!e || !e.routes || !e.routes.length) return '无扩张路线。输入 expand("E8N54") 启动。';
      const lines = e.routes.map((r) => {
        const t = Game.rooms[r.target];
        const claimed = t && t.controller && t.controller.my;
        const hasSpawn = t && t.find(FIND_MY_SPAWNS).length > 0;
        const stage = r.done ? '✅完成' : (claimed ? (hasSpawn ? '✅完成' : '🏗️建spawn') : '🚩claim');
        const crew = _.filter(Game.creeps, (c) => c.memory.expand && c.memory.eTarget === r.target).length;
        return '　' + r.home + '→' + r.target + ' [' + stage + '] 队员' + crew + (t ? '' : ' (不可见)');
      });
      return '🚀 扩张 (enabled=' + (e.enabled ? 'on' : 'off') + '):\n' + lines.join('\n');
    };
  },
};
