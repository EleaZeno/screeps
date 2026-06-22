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

module.exports = {
  HARVEST_POWER, CARRY_CAPACITY, SOURCE_REGEN_RATE, UPGRADE_POWER, BUILD_POWER,

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
      case 'fill': {
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
    return { harvestRate, haulNeed, haulHave, balance: haulHave - haulNeed, avgDist: Math.round(avgDist) };
  },
};
