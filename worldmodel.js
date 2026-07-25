'use strict';

/*
 * worldmodel.js — L0 世界模型（大脑对"游戏世界如何运转"的理解）
 * ==================================================================
 * 用户洞察（Yann LeCun 世界模型）：大脑做贪心瞬时打分，却【不理解游戏世界的
 * 运转机制】——不知道 tick=时间、不知道移动消耗 tick、不知道"静态采矿高效是
 * 因为一个 WORK 全程不动 100% 输出、通勤损耗外包给廉价 CARRY"。
 *
 * 这个模块把游戏的【真实物理公式】编码进去，让大脑能计算每个决策的
 * 【实际净吞吐率 energy/tick】，而不是拍脑袋的启发式打分。
 * 这是理解"静态 vs 来回跑谁高效"的根基。
 *
 * Screeps 真实常量（硬规则，世界的物理定律）：
 *   HARVEST_POWER   = 2      // 每 WORK 每 tick 采 2 能量
 *   CARRY_CAPACITY  = 50     // 每 CARRY 装 50 能量
 *   SOURCE_ENERGY   = 3000   // owned source 容量
 *   ENERGY_REGEN    = 300    // 每 300 tick 再生满 → 稳态产出 = 3000/300 = 10 e/tick
 *   UPGRADE/BUILD   = 各 WORK 每 tick 处理对应能量
 *   移动：每个非MOVE部件产生 fatigue，每个 MOVE 抵消；负重影响速度。
 */

const HARVEST_POWER = 2;
const CARRY_CAPACITY = 50;
const SOURCE_REGEN_RATE = 10; // 一个 owned source 稳态最大产出 energy/tick (3000/300)
const UPGRADE_POWER = 1;      // 每 WORK 每 tick 升级处理 1 能量
const BUILD_POWER = 5;        // 每 WORK 每 tick 建造处理 5 能量
const REPAIR_POWER = 100;     // 每 WORK 每 tick 修复 100 hits
const CREEP_LIFE = 1500;      // creep 寿命 (claim creep 600)
const SPAWN_TIME_PER_PART = 3;// 每个身体部件孵化耗 3 tick
const CONTAINER_DECAY = 5000; // container 每 100 tick 衰减 5000 hits(无人修会消失)
const ROAD_DECAY_PER_USE = 1; // 路被踩一次衰 1(换取移动加速)
const PART_COST = { work: 100, carry: 50, move: 50, attack: 80, ranged_attack: 150, heal: 250, tough: 10, claim: 600 };
// 地形移动成本（tick/格，满足 MOVE 时）
const TERRAIN_COST = { plain: 1, swamp: 5, road: 0.5 };
// RCL 升级所需 controller progress
const RCL_PROGRESS = { 1: 200, 2: 45000, 3: 135000, 4: 405000, 5: 1215000, 6: 3645000, 7: 10935000, 8: 0 };

module.exports = {
  HARVEST_POWER, CARRY_CAPACITY, SOURCE_REGEN_RATE, UPGRADE_POWER, BUILD_POWER,
  REPAIR_POWER, CREEP_LIFE, SPAWN_TIME_PER_PART, PART_COST, TERRAIN_COST, RCL_PROGRESS,

  /** creep 各部件计数（缓存到 memory 避免每 tick 重算） */
  parts(creep) {
    if (creep._parts) return creep._parts;
    const b = creep.body;
    const p = { work: 0, carry: 0, move: 0, attack: 0, ranged: 0, tough: 0, total: b.length };
    for (const x of b) {
      if (x.type === WORK) p.work++;
      else if (x.type === CARRY) p.carry++;
      else if (x.type === MOVE) p.move++;
      else if (x.type === ATTACK) p.attack++;
      else if (x.type === RANGED_ATTACK) p.ranged++;
      else if (x.type === TOUGH) p.tough++;
    }
    creep._parts = p;
    return p;
  },

  /**
   * 移动速度模型：负重时每格需要几 tick。
   * fatigue: 每个非MOVE部件(负重时)产生 2 fatigue/格(平原)，每个 MOVE 抵消 2。
   * 满足 move >= 负重部件数 → 1 tick/格(全速)；不足 → 变慢。
   * @param loaded 是否负重(携带能量)
   * @return ticks per tile (>=1)
   */
  ticksPerTile(creep, loaded) {
    const p = this.parts(creep);
    // 负重部件 = 非MOVE部件中会产生疲劳的(WORK/CARRY(带货)/ATTACK等)
    const burden = loaded
      ? (p.work + p.carry + p.attack + p.ranged + p.tough)
      : (p.work + p.attack + p.ranged + p.tough); // 空载时 CARRY 不产生疲劳
    if (burden === 0) return 1;
    // 平原: fatigue/格 = burden*2, 抵消 = move*2。需要 move>=burden 才全速。
    return Math.max(1, Math.ceil(burden / Math.max(1, p.move)));
  },

  /**
   * ⭐ 核心：静态采矿 vs 往返采矿的【净吞吐率】对比。
   * 这是大脑理解"为什么静态高效"的关键计算。
   *
   * 静态采矿 (creep 钉在 source 旁 container，永不移动)：
   *   吞吐 = min(WORK*HARVEST_POWER, SOURCE_REGEN_RATE)  // 受 source 再生上限约束
   *   利用率 100%，零通勤损耗。能量掉进 container 由 hauler 取走。
   *
   * 往返采矿 (creep 采满自己的 CARRY 就走回去卸)：
   *   一个周期 = 采集时间 + 往返通勤时间
   *   采集时间 = (carry*50) / (work*HARVEST_POWER)   // 装满自身需多少 tick
   *   通勤时间 = roundTrip 距离 × ticksPerTile        // 往返路上零采集
   *   有效吞吐 = (carry*50) / (采集时间 + 通勤时间)
   *   → 通勤越远，有效吞吐被稀释越厉害（这就是来回跑低效的数学根源）
   *
   * @return { staticRate, roundTripRate, advantage } energy/tick
   */
  miningThroughput(creep, roundTripTiles) {
    const p = this.parts(creep);
    const work = p.work || 1;
    // 静态：受 source 再生上限封顶
    const staticRate = Math.min(work * HARVEST_POWER, SOURCE_REGEN_RATE);

    // 往返：采满自身 CARRY 的时间 + 通勤损耗
    const carryCap = (p.carry || 1) * CARRY_CAPACITY;
    const harvestTime = carryCap / (work * HARVEST_POWER);
    const commuteTime = roundTripTiles * this.ticksPerTile(creep, true);
    const roundTripRate = carryCap / Math.max(1, harvestTime + commuteTime);

    return {
      staticRate,
      roundTripRate,
      advantage: staticRate / Math.max(0.01, roundTripRate), // 静态比往返高多少倍
    };
  },

  /**
   * 任务的"理论净吞吐贡献"(energy/tick) —— 让 utility 用真实物理而非启发式打分。
   * 这是把"理解世界"接入决策的接口。
   * @return number 该 creep 做该任务每 tick 的有效产出/处理量
   */
  taskThroughput(creep, task, dist) {
    const p = this.parts(creep);
    const tpt = 1; // 到位后大多任务原地进行
    switch (task.type) {
      case 'harvest':
        // 静态采矿：到位后 100% 输出，受 source 上限约束
        return Math.min(p.work * HARVEST_POWER, SOURCE_REGEN_RATE);
      case 'haul':
      case 'fill':
      case 'store':
      case 'terminalFuel': {
        // 搬运吞吐 = 载量 / (取+送的往返时间)。距离越近吞吐越高。
        const carryCap = (p.carry || 1) * CARRY_CAPACITY;
        const roundTrip = (dist || 5) * 2 * this.ticksPerTile(creep, true);
        return carryCap / Math.max(1, roundTrip);
      }
      case 'upgrade':
        return p.work * UPGRADE_POWER;
      case 'build':
      case 'repair':
        return p.work * BUILD_POWER;
      default:
        return p.work || p.carry || 1;
    }
  },

  /**
   * ⭐ 能量经济流模型：理解整个殖民地的能量供求平衡。
   * 让大脑明白"需要几个 Hauler"—— 算：采集产出总速率 ÷ 单个 Hauler 运力。
   * 产出 > 运力 → 缺 Hauler；运力 > 产出 → Hauler 过剩(失业)。
   */
  economyFlow(room) {
    // ⭐ CPU 优化：tick 级缓存（同一 tick 多模块重复调用不重算）
    if (room._ecoFlow && room._ecoFlowTick === Game.time) return room._ecoFlow;
    const sources = room.find(FIND_SOURCES);
    const myCreeps = room.find(FIND_MY_CREEPS);
    let harvestCapacity = 0;
    for (const c of myCreeps) {
      const p = this.parts(c);
      if (c.memory && c.memory.taskType === 'harvest') {
        harvestCapacity += Math.min(p.work * HARVEST_POWER, SOURCE_REGEN_RATE);
      }
    }
    const harvestRate = Math.min(harvestCapacity, sources.length * SOURCE_REGEN_RATE);
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    let avgDist = 10;
    if (spawn && sources.length) {
      let sum = 0;
      for (const s of sources) sum += Math.max(Math.abs(s.pos.x - spawn.pos.x), Math.abs(s.pos.y - spawn.pos.y));
      avgDist = sum / sources.length;
    }
    const haulerThroughput = (6 * CARRY_CAPACITY) / Math.max(1, avgDist * 2);
    const haulNeed = Math.max(1, Math.ceil(harvestRate / Math.max(0.1, haulerThroughput)));
    const haulHave = myCreeps.filter((c) => { const p = this.parts(c); return p.carry > 0 && p.work === 0; }).length;
    // ⭐ source 堆积检测：source 能量越满 = 采集越不足(采不走在堆积浪费再生)。
    // 这是用户看到的"矿池旁堆积"的物理信号。
    let srcFill = 0;
    for (const s of sources) srcFill += (s.energy || 0) / Math.max(1, s.energyCapacity || 3000);
    srcFill = sources.length ? srcFill / sources.length : 0; // 平均填充率 0..1
    // 采集产能是否吃满 source：实际在岗采集产能 vs source 上限
    const harvestStarved = srcFill > 0.6 && harvestCapacity < sources.length * SOURCE_REGEN_RATE * 0.9;
    const _result = {
      harvestRate, haulNeed, haulHave, balance: haulHave - haulNeed, avgDist: Math.round(avgDist),
      srcFill: Math.round(srcFill * 100) / 100,
      harvestStarved, // true = 采集不足, source 能量堆积浪费, 该补强采集
      harvestCapacity,
      harvestCeil: sources.length * SOURCE_REGEN_RATE, // 采集产能物理上限
    };
    room._ecoFlow = _result;
    room._ecoFlowTick = Game.time;
    return _result;
  },

  // ================= 扩充：更多世界机制理解 =================

  /** 身体造价（能量）与孵化耗时。理解"造一个大号多贵、多久"。 */
  bodyCost(body) { return body.reduce((s, p) => s + (PART_COST[p] || PART_COST[p.type] || 0), 0); },
  spawnTime(body) { return body.length * SPAWN_TIME_PER_PART; },

  /**
   * ⭐ 回本分析：一个 creep 一生能产出多少能量 vs 造价。
   * 理解"这个大号值不值得造"——ROI = 一生产出 / 造价。
   * 越高越划算。静态矿工 ROI 极高(一生几万能量 vs 造价几百)。
   */
  lifetimeROI(body, energyPerTick) {
    const cost = this.bodyCost(body);
    const lifeProduce = energyPerTick * (CREEP_LIFE - this.spawnTime(body));
    return cost > 0 ? lifeProduce / cost : 0;
  },

  /**
   * ⭐ 静态采矿的经济学论证（为什么该修路+用 container）：
   *  - container 缓冲：矿工采的能量暂存 container，矿工不必等 Hauler→100%利用
   *  - 道路：Hauler 走路上移动成本减半(1→0.5 tick/格)→同样 Hauler 运力翻倍
   * 返回修路后需要几个 Hauler（现状 vs 修路后），量化修路收益。
   */
  roadSavings(room) {
    const flow = this.economyFlow(room);
    // 修路后移动提速约 2x → Hauler 运力翻倍 → 所需 Hauler 减半
    const haulNeedWithRoads = Math.max(1, Math.ceil(flow.haulNeed / 2));
    return { now: flow.haulNeed, withRoads: haulNeedWithRoads, saved: flow.haulNeed - haulNeedWithRoads };
  },

  /**
   * ⭐ 修路 ROI 判据（"划不划算"的数学）—— 教 brain 自己算。
   * 成本：1 段路 = 建造 300 能量 + 维护(路衰减需 repair，约 0.05 e/tick)。
   * 收益：路上移动疲劳减半→有 MOVE 的体平原 2→1 tick/格，沼泽 10→2。每趟省的 tick × 经过频率。
   * 划算判据：一段路被走得越频繁越划算。回本越快越值。
   * @param trafficPerTile 该格平均多少 tick 被踩一次(越小越频繁); terrain 'plain'|'swamp'
   * @return { worth, paybackTicks, savePerTick }
   */
  roadROI(trafficPerTile, terrain) {
    const BUILD = 300;                   // 1 格路建造成本
    const decayMaint = 0.05;             // 路衰减~5000hits/1000tick, repair 维护粗估 0.05 e/tick
    const savePerPass = terrain === 'swamp' ? 8 : 1;   // 沼泽 10→2 省8; 平原 2→1 省1
    const passesPerTick = 1 / Math.max(1, trafficPerTile);
    const savePerTick = passesPerTick * savePerPass;
    const netPerTick = savePerTick - decayMaint;
    const paybackTicks = netPerTick > 0 ? BUILD / netPerTick : Infinity;
    // 划算 = 净收益为正 且 能在合理时间(<8000tick)回本
    return { worth: netPerTick > 0 && paybackTicks < 8000, paybackTicks: Math.round(paybackTicks), savePerTick: Math.round(savePerTick * 100) / 100, terrain };
  },

  /**
   * ⭐ 道路布局规划（交给 brain 决定在哪修路）。
   * 高交通路径 = spawn↔每 source、spawn↔controller。这些路被 Hauler/Upgrader 反复走。
   * 用 roadROI 逐段判是否该修。返回推荐修路坐标列表。
   * @return { segments:[{x,y,terrain,payback}], count }
   */
  planRoads(room) {
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) return { segments: [], count: 0 };
    const sources = room.find(FIND_SOURCES);
    const ctrl = room.controller;
    const terrain = new Room.Terrain(room.name);
    const targets = [];
    for (const s of sources) targets.push({ pos: s.pos, traffic: 6 });  // source路: Hauler频繁
    if (ctrl) targets.push({ pos: ctrl.pos, traffic: 10 });             // controller路: Upgrader
    const segments = [];
    const seen = {};
    for (const t of targets) {
      const path = spawn.pos.findPathTo(t.pos, { ignoreCreeps: true, swampCost: 5 });
      for (const step of path) {
        const key = step.x + ',' + step.y;
        if (seen[key]) continue; seen[key] = 1;
        const terr = (terrain.get(step.x, step.y) & TERRAIN_MASK_SWAMP) ? 'swamp' : 'plain';
        const roi = this.roadROI(t.traffic, terr);
        if (roi.worth) segments.push({ x: step.x, y: step.y, terrain: terr, payback: roi.paybackTicks });
      }
    }
    return { segments, count: segments.length };
  },

  /**
   * ⭐ link 机制理解：link 能量瞬移(距离无关)，损耗 3%。
   * 理解 RCL5+ 建 link 后可几乎废掉 controller 方向的 Hauler。
   * @return link 能替代几个 Hauler 的运力
   */
  linkValue(room, fromPos, toPos) {
    const dist = fromPos && toPos ? Math.max(Math.abs(fromPos.x - toPos.x), Math.abs(fromPos.y - toPos.y)) : 20;
    // link 传 800/tick效果(冷却后)，等效于一个走 dist 的 Hauler 队列
    const haulerEquiv = (6 * CARRY_CAPACITY) / Math.max(1, dist * 2);
    return { distSaved: dist, energyLossPct: 3, haulerEquiv: Math.round(haulerEquiv * 10) / 10 };
  },

  /**
   * ⭐ controller 降级物理：不升级 controller 会 ticksToDowngrade 递减，到 0 掊 RCL。
   * 维持不降只需很少 upgrade(1 WORK 偶尔点一下)，但掊级损失巨大。
   * @return 维持不降级所需的最低 upgrade 速率(energy/tick)
   */
  downgradeMaintenance(rcl) {
    // 每次 upgradeController 重置 ticksToDowngrade。维持成本极低，近乎 0。
    return 0.1; // 象征值：维持不降几乎免费，但不能不做
  },

  /**
   * ⭐ 孵化经济：spawn 每 tick 只能孵 1 个部件。理解"人口增长有速率上限"。
   * 单 spawn 最大产能 = 持续孵化，但能量供应跟不上会搂。
   * @return 在给定能量产出下，spawn 是否是瓶颈
   */
  spawnBottleneck(room, energyRate) {
    const spawns = room.find(FIND_MY_SPAWNS).length;
    // 单 spawn 持续孵化中等体(8部件=24tick)约消耗 ~22 e/tick 能量产能
    const spawnEnergyAppetite = spawns * 22;
    return { spawns, canConsume: spawnEnergyAppetite, surplus: energyRate - spawnEnergyAppetite };
  },

  /**
   * ⭐ 能量去向决策：给定当前产出，能量该流向哪(孵化/升级/建造/囤积)？
   * 这是大脑对"能量是血液"的理解。
   */
  energyAllocation(room) {
    const flow = this.economyFlow(room);
    const sites = room.find(FIND_MY_CONSTRUCTION_SITES).length;
    const storage = room.storage;
    const ctrl = room.controller;
    return {
      harvestRate: flow.harvestRate,
      // 优先级: 孵化命脉 > 防降级 > 建造 > 升级 > 囤积storage
      needFill: room.energyAvailable < room.energyCapacityAvailable,
      needBuild: sites > 0,
      needUpgrade: ctrl && ctrl.ticksToDowngrade && ctrl.ticksToDowngrade < 3000,
      canStockpile: !!storage && room.energyAvailable >= room.energyCapacityAvailable,
    };
  },
};

