'use strict';

/*
 * build.planner.js — 自动建造规划（按 roadmap 蓝图逐级铺设所有建筑）
 * ------------------------------------------------------------------
 * RCL 提升后，按 roadmap.BLUEPRINT 自动铺设该级解锁的全部建筑：
 *  extension / container / tower / storage / link / terminal /
 *  extractor / lab / factory / spawn / nuker / observer / powerSpawn
 * 哲学：先把当前级该建的全建满，再升级（配合 infra 闸门）。
 * 每 20 tick 规划一次；RCL 变化时立即规划。
 */

const roadmap = require('roadmap');

// 单点型建筑（数量少，放 spawn 附近核心区）
const SINGLE_NEAR_SPAWN = ['storage', 'terminal', 'factory', 'nuker', 'observer', 'powerSpawn', 'powerspawn'];
// Screeps 常量名映射
const TYPE = {
  extension: STRUCTURE_EXTENSION,
  container: STRUCTURE_CONTAINER,
  tower: STRUCTURE_TOWER,
  storage: STRUCTURE_STORAGE,
  link: STRUCTURE_LINK,
  terminal: STRUCTURE_TERMINAL,
  extractor: STRUCTURE_EXTRACTOR,
  lab: STRUCTURE_LAB,
  factory: STRUCTURE_FACTORY,
  spawn: STRUCTURE_SPAWN,
  nuker: STRUCTURE_NUKER,
  observer: STRUCTURE_OBSERVER,
  powerSpawn: STRUCTURE_POWER_SPAWN,
};

module.exports = {
  run(room) {
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) return;
    const rcl = room.controller.level;

    const mem = room.memory;
    const rclJustChanged = mem._lastRcl !== rcl;
    mem._lastRcl = rcl;
    if (!rclJustChanged && Game.time % 20 !== 0) return;
    if (rclJustChanged) console.log(`[BUILD] RCL=${rcl} 升级，立即按蓝图重新规划 ${room.name}`);

    const bp = roadmap.blueprint(rcl);

    // ---- 1. extension（核心，最优先）----
    // 老房核心区会逐级被道路/仓库/link/lab 占满。若永远只搜 spawn 周围 6 格，
    // RCL6 后会出现“蓝图要 40、实际卡 33，且每 20 tick 永久重试失败”的静默死锁。
    // 先用紧凑核心区；不足时由 ensureCount 自动扩大到整个安全腹地继续找位。
    this.ensureCount(room, spawn.pos, 'extension', bp.extension || 0, 6, 20);

    // ---- 2. tower（防御）----
    // tower 同理：第 2 塔解锁较晚，4 格核心区往往已无空位，允许回退到 12 格。
    if (bp.tower) this.ensureCount(room, spawn.pos, 'tower', bp.tower, 4, 12);

    // ---- 3. container（source 旁 + controller 旁）----
    if (rcl >= 2) this.planContainers(room);

    // ---- 3.5 ⭐ 道路 ----
    // 数据结论(_road_math.py, E9N54 0%沼泽): 极早期全量修路净亏(抽走能量>负重提速),
    // 但 spawn↔source【主脊】在 RCL2 静态采矿一开始就被 hauler 反复走 => 提前修脊划算。
    // 故拆两条:
    //   (a) RCL≥2 且 source container 就位 => 只修 spawn↔source 主脊(高频, ROI正)
    //   (b) RCL≥3 => 全量 ROI 修路(controller 路 + 其余)
    if (rcl >= 2) this.planSpineRoads(room);   // 主脊提前
    if (rcl >= 3) this.planRoads(room);        // 全量(含 controller)

    // ---- 4. storage（RCL4+，单点，放 spawn 旁核心）----
    if (bp.storage) this.ensureSingle(room, spawn.pos, 'storage', 2);

    // ---- 5. link（RCL5+：controller 旁 + source 旁 + storage 旁）----
    if (bp.link) this.planLinks(room, bp.link);

    // ---- 6-8. RCL6 可选产业设施 ----
    // 快速发展模式先完成 extension/tower/storage/link 等“产能与安全骨架”，并形成储备，
    // 再铺 terminal/extractor/lab。已有工地不会删除，只是不继续追加，避免新房刚升 RCL6
    // 就被 20 万级产业工程量压住，controller 数天不涨。
    const deferIndustry = this._deferIndustry(room, bp);
    if (!deferIndustry) {
      if (bp.terminal) this.ensureSingle(room, spawn.pos, 'terminal', 3);
      if (bp.extractor) this.planExtractor(room);
      if (bp.lab) this.ensureCount(room, spawn.pos, 'lab', bp.lab, 7, 14);
    }

    // ---- 9. factory（RCL7+，单点）----
    if (bp.factory) this.ensureSingle(room, spawn.pos, 'factory', 4);

    // ---- 10. 额外 spawn（RCL7=2, RCL8=3）----
    if (bp.spawn && bp.spawn > 1) this.ensureCount(room, spawn.pos, 'spawn', bp.spawn, 5);

    // ---- 11. nuker / observer / powerSpawn（RCL8）----
    if (bp.nuker) this.ensureSingle(room, spawn.pos, 'nuker', 5);
    if (bp.observer) this.ensureSingle(room, spawn.pos, 'observer', 6);
    if (bp.powerSpawn) this.ensureSingle(room, spawn.pos, 'powerSpawn', 4);
  },

  /** 确保某类建筑达到 target 数量（已建+在建），不足则围绕 center 补建 */
  ensureCount(room, center, key, target, maxRange, fallbackRange) {
    const type = TYPE[key];
    if (!type) return;
    const have = this.countStructAndSites(room, type);
    if (have >= target) return;
    this.placeAround(room, center, type, target - have, maxRange);
    // 核心区摆不下时扩大搜索范围。重新计数，避免重复/超建；仍保持同一棋盘式布局规则。
    const afterCompact = this.countStructAndSites(room, type);
    if (afterCompact < target && fallbackRange && fallbackRange > maxRange) {
      this.placeAround(room, center, type, target - afterCompact, fallbackRange);
    }
  },

  _deferIndustry(room, bp) {
    const strategy = Memory.strategy || {};
    if (strategy.rapidGrowth === false || room.controller.level < 6) return false;
    const reserve = strategy.industryReserve || 30000;
    const energy = room.storage ? (room.storage.store[RESOURCE_ENERGY] || 0) : 0;
    const core = [
      ['extension', bp.extension || 0], ['tower', bp.tower || 0],
      ['storage', bp.storage || 0], ['link', bp.link || 0],
    ];
    for (const pair of core) {
      const type = TYPE[pair[0]];
      if (type && this.countStructAndSites(room, type) < pair[1]) return true;
    }
    return energy < reserve;
  },

  /** 单点建筑：只建 1 个（已有就跳过）*/
  ensureSingle(room, center, key, maxRange) {
    const type = TYPE[key];
    if (!type) return;
    if (this.countStructAndSites(room, type) >= 1) return;
    this.placeAround(room, center, type, 1, maxRange || 3);
  },

  /**
   * ⭐ 主脊提前修路(RCL2): 只修 spawn↔每个 source 的路。
   * 触发条件: source container 已就位(静态采矿开始, hauler 开始在脊上高频往返)。
   * 不等 extension 全建完 —— 这条脊的交通是确定的、立刻发生的, 提前修立即省负重往返 tick。
   * 保守: 同时最多 3 个脊路工地, 不压城; container 没就位则不修(避免 hauler 还没上线就白修)。
   */
  planSpineRoads(room) {
    // 闸门: source container 必须就位(否则静态采矿/hauler 还没跑, 修路无收益)
    let infra; try { infra = require('infra'); } catch (e) { infra = null; }
    if (infra && !infra.containersReady(room)) return;
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) return;
    const existingRoadSites = room.find(FIND_CONSTRUCTION_SITES, { filter: (s) => s.structureType === STRUCTURE_ROAD }).length;
    if (existingRoadSites >= 3) return; // 主脊阶段更保守, 最多 3 个工地
    let budget = 3 - existingRoadSites;
    let built = 0;
    const sources = room.find(FIND_SOURCES);
    for (const src of sources) {
      if (budget <= 0) break;
      const path = spawn.pos.findPathTo(src.pos, { ignoreCreeps: true, swampCost: 5, range: 1 });
      for (const step of path) {
        if (budget <= 0) break;
        const pos = new RoomPosition(step.x, step.y, room.name);
        const here = pos.lookFor(LOOK_STRUCTURES).concat(pos.lookFor(LOOK_CONSTRUCTION_SITES));
        if (here.some((s) => s.structureType === STRUCTURE_ROAD)) continue; // 已有路
        if (here.some((s) => s.structureType !== STRUCTURE_ROAD && s.structureType !== STRUCTURE_RAMPART)) continue;
        if (room.createConstructionSite(step.x, step.y, STRUCTURE_ROAD) === OK) { budget--; built++; }
      }
    }
    if (built > 0) console.log('[BUILD] RCL2 spine road +' + built + ' (spawn<->source)');
  },

  /** ⭐ 自主修路：用 worldmodel.planRoads 的 ROI 判据决定哪些格该铺路。
   *  每次限铺少量工地(避免一次太多压城)，只在“划算”的格上建。 */
  planRoads(room) {
    let wm; try { wm = require('worldmodel'); } catch (e) { return; }
    const existingRoadSites = room.find(FIND_CONSTRUCTION_SITES, { filter: (s) => s.structureType === STRUCTURE_ROAD }).length;
    if (existingRoadSites >= 10) return; // 激进：同时最多 10 个路工地（原 5）
    const plan = wm.planRoads(room);
    let budget = 10 - existingRoadSites;
    let built = 0;
    for (const seg of plan.segments) {
      if (budget <= 0) break;
      const pos = new RoomPosition(seg.x, seg.y, room.name);
      const here = pos.lookFor(LOOK_STRUCTURES).concat(pos.lookFor(LOOK_CONSTRUCTION_SITES));
      if (here.some((s) => s.structureType === STRUCTURE_ROAD)) continue; // 已有路
      if (here.some((s) => s.structureType !== STRUCTURE_ROAD && s.structureType !== STRUCTURE_RAMPART && s.structureType !== STRUCTURE_CONTAINER)) continue; // 格被其他建筑占
      if (room.createConstructionSite(seg.x, seg.y, STRUCTURE_ROAD) === OK) { budget--; built++; }
    }
    if (built > 0) console.log(`[BUILD] ⭐brain自主修路: ${built}段(ROI划算), 总推荐${plan.count}段`);
  },

  planContainers(room) {
    // 【世界模型对齐】容器建在【开采格】上，让矿工站上去采矿能量直接掉进 container=静态采矿成立。
    // RCL2 可建 5 个(container 不分RCL，每房上限5)：每 source 取最近spawn的2个开采格 + controller旁1个。
    const MAX = 5;
    const have = this.countStructAndSites(room, STRUCTURE_CONTAINER);
    if (have >= MAX) return;
    let budget = MAX - have;
    const slots = (room.memory.slots && room.memory.slots.bySource) || {};
    // 每个 source 在其最近的2个开采格上建 container
    for (const sid in slots) {
      if (budget <= 0) break;
      const list = slots[sid].slice().sort((a, b) => (a.dist || 0) - (b.dist || 0)).slice(0, 2);
      for (const slot of list) {
        if (budget <= 0) break;
        const pos = new RoomPosition(slot.x, slot.y, room.name);
        const here = pos.lookFor(LOOK_STRUCTURES).concat(pos.lookFor(LOOK_CONSTRUCTION_SITES));
        if (here.some((s) => s.structureType === STRUCTURE_CONTAINER)) continue; // 已有
        if (here.length > 0) continue; // 该格被其他占
        if (room.createConstructionSite(slot.x, slot.y, STRUCTURE_CONTAINER) === OK) { budget--; console.log(`[BUILD] container @开采格 ${slot.x},${slot.y}`); }
      }
    }
    // controller 旁建 1 个(升级者从此取能)
    const ctrl = room.controller;
    if (budget > 0 && ctrl) {
      const cNear = ctrl.pos.findInRange(FIND_STRUCTURES, 2, { filter: (s) => s.structureType === STRUCTURE_CONTAINER });
      const cNearSites = ctrl.pos.findInRange(FIND_CONSTRUCTION_SITES, 2, { filter: (s) => s.structureType === STRUCTURE_CONTAINER });
      if (cNear.length === 0 && cNearSites.length === 0) this.placeAround(room, ctrl.pos, STRUCTURE_CONTAINER, 1, 2);
    }
  },

  /** link（RCL5+）：先保证一发一收，再补 storage receiver。
   *  关键：source link 必须放在矿工开采格相邻(range1)格上，否则矿工灌不进去=死 link。
   *  RCL5 只有2个配额，必须是 controller receiver + source sender；
   *  controller+storage 都是接收方，会导致整级 link 投资闲置。 */
  planLinks(room, target) {
    const have = this.countStructAndSites(room, STRUCTURE_LINK);
    if (have >= target) return;
    let placed = have;

    // 优先级 1: controller link（直接喂 upgrade，rcl_push 目标下收益最高）
    if (placed < target && room.controller) {
      if (this._noLinkNear(room, room.controller.pos)) {
        const before = this.countStructAndSites(room, STRUCTURE_LINK);
        this.placeAround(room, room.controller.pos, STRUCTURE_LINK, 1, 2);
        if (this.countStructAndSites(room, STRUCTURE_LINK) > before) placed++;
      } else { /* 已有 */ }
    }
    // 优先级 2: source sender——只放在某开采格相邻空格（矿工能 range1 灌进去）。
    //   无可达空格则不放（宁缺勿滥：放了也是死 link）。
    if (placed < target) {
      const sources = room.find(FIND_SOURCES);
      for (const s of sources) {
        if (placed >= target) break;
        if (!this._noLinkNear(room, s.pos)) continue; // 该 source 旁已有 link/工地
        const spot = this._sourceLinkSpot(room, s);
        if (!spot) continue;
        if (room.createConstructionSite(spot.x, spot.y, STRUCTURE_LINK) === OK) {
          placed++;
          console.log('[BUILD] source link @' + spot.x + ',' + spot.y + ' (歗开采格)');
        }
      }
    }
    // 优先级 3: storage receiver（RCL6 的第3个 link 起再补）。
    if (placed < target && room.storage) {
      if (this._noLinkNear(room, room.storage.pos)) {
        const before = this.countStructAndSites(room, STRUCTURE_LINK);
        this.placeAround(room, room.storage.pos, STRUCTURE_LINK, 1, 2);
        if (this.countStructAndSites(room, STRUCTURE_LINK) > before) placed++;
      }
    }
  },

  /** 锁定位置 range2 内是否已有 link 或 link 工地 */
  _noLinkNear(room, pos) {
    const near = pos.findInRange(FIND_STRUCTURES, 2, { filter: (s) => s.structureType === STRUCTURE_LINK });
    const nearS = pos.findInRange(FIND_CONSTRUCTION_SITES, 2, { filter: (s) => s.structureType === STRUCTURE_LINK });
    return near.length === 0 && nearS.length === 0;
  },

  /** 为 source 选一个 source link 位：在开采格(矿工站位)相邻、非开采格本身、空闲、不压 source 的格。 */
  _sourceLinkSpot(room, source) {
    const terrain = room.getTerrain();
    const slots = (room.memory.slots && room.memory.slots.bySource && room.memory.slots.bySource[source.id]) || [];
    // 候选开采格：优先用缓存的开采格，否则现算 source 周边 8 格
    let harvestTiles = slots.map((s) => ({ x: s.x, y: s.y }));
    if (!harvestTiles.length) {
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const x = source.pos.x + dx, y = source.pos.y + dy;
        if (x < 1 || x > 48 || y < 1 || y > 48) continue;
        if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
        harvestTiles.push({ x, y });
      }
    }
    const occupied = (x, y) => {
      const pos = new RoomPosition(x, y, room.name);
      const here = pos.lookFor(LOOK_STRUCTURES).concat(pos.lookFor(LOOK_CONSTRUCTION_SITES));
      return here.length > 0;
    };
    const isHarvestTile = (x, y) => harvestTiles.some((t) => t.x === x && t.y === y);
    // 在某开采格相邻找一个空格（不是开采格本身、不是 source、不是墙、未占）
    for (const ht of harvestTiles) {
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const x = ht.x + dx, y = ht.y + dy;
        if (x < 2 || x > 47 || y < 2 || y > 47) continue;
        if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
        if (x === source.pos.x && y === source.pos.y) continue;
        if (isHarvestTile(x, y)) continue;       // 不压其他开采格
        if (occupied(x, y)) continue;
        return { x, y };
      }
    }
    return null;
  },

  /** extractor 必须盖在 mineral 上 */
  planExtractor(room) {
    const mineral = room.find(FIND_MINERALS)[0];
    if (!mineral) return;
    const has = mineral.pos.lookFor(LOOK_STRUCTURES).some((s) => s.structureType === STRUCTURE_EXTRACTOR);
    const hasSite = mineral.pos.lookFor(LOOK_CONSTRUCTION_SITES).some((s) => s.structureType === STRUCTURE_EXTRACTOR);
    if (!has && !hasSite) room.createConstructionSite(mineral.pos, STRUCTURE_EXTRACTOR);
  },

  countStructAndSites(room, type) {
    const built = room.find(FIND_MY_STRUCTURES, { filter: (s) => s.structureType === type }).length;
    const sites = room.find(FIND_MY_CONSTRUCTION_SITES, { filter: (s) => s.structureType === type }).length;
    return built + sites;
  },

  /** 围绕 center 螺旋找空地放 count 个建筑（跳过路、墙、已占用格）*/
  placeAround(room, center, type, count, maxRange) {
    maxRange = maxRange || 6;
    const terrain = room.getTerrain();
    let placed = 0;
    for (let r = 1; r <= maxRange && placed < count; r++) {
      for (let dx = -r; dx <= r && placed < count; dx++) {
        for (let dy = -r; dy <= r && placed < count; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = center.x + dx;
          const y = center.y + dy;
          if (x < 2 || x > 47 || y < 2 || y > 47) continue;
          if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
          // 棋盘格留通道（container/road/特殊单点除外）
          if ((x + y) % 2 === 0 && type !== STRUCTURE_CONTAINER && type !== STRUCTURE_STORAGE &&
              type !== STRUCTURE_TERMINAL && type !== STRUCTURE_LINK) continue;
          const pos = new RoomPosition(x, y, room.name);
          const here = pos.lookFor(LOOK_STRUCTURES).concat(pos.lookFor(LOOK_CONSTRUCTION_SITES));
          if (here.length > 0) continue;
          const res = room.createConstructionSite(x, y, type);
          if (res === OK) placed++;
        }
      }
    }
    if (placed > 0) console.log(`[BUILD] queued ${placed} x ${type} in ${room.name}`);
  },
};

