'use strict';

/*
 * spawning.js — spawn 作为市场参与者，按"市场缺口"动态造 body
 * ==================================================================
 * 替代旧 spawn.manager.js（6000+ 字节 if 嵌套）。
 *
 * 核心思想：spawn 不再用 if 判断"该造 miner 还是 harvester"。
 * 它看 market.shortage()——哪类任务最缺人，就造一个最擅长那类任务的 body。
 *
 * body 设计：
 *  - 缺 harvest → 重 WORK 的"矿工体"（钉 source 榨干）
 *  - 缺 haul    → 纯 CARRY+MOVE 的"搬运体"
 *  - 缺 upgrade/build → 均衡 WORK+CARRY+MOVE 的"工人体"
 *  - 缺 fill    → 搬运体（CARRY 多）
 *  - 缺 defend  → 战斗体
 *
 * 人口上限：用"任务总容量"自然约束——所有任务都满员了就不造。
 * 无硬阈值、无 if 嵌套决策树；只有"最缺什么造什么"。
 */

module.exports = {
  /**
   * @param room
   * @param shortage  market.shortage() 的结果：{type: 加权缺口}
   * @param creepCount 当前 creep 总数
   */
  run(room, shortage, creepCount) {
    const spawn = room.find(FIND_MY_SPAWNS, { filter: (s) => !s.spawning })[0];
    if (!spawn) return;

    // 无缺口 = 所有任务满员 → 不造（人口由任务容量自然封顶）
    const types = Object.keys(shortage);
    if (types.length === 0) return;

    // 绝境保护：完全没 creep 且能量够最小体 → 立刻出一个最小工人（防团灭死锁）
    // 这是唯一保留的"保底"，但它不是 if 嵌套决策——是市场空转时的冷启动种子。
    if (creepCount === 0) {
      if (room.energyAvailable >= 200) spawn.spawnCreep([WORK, CARRY, MOVE], 'Seed_' + Game.time, { memory: {} });
      return;
    }

    // 找加权缺口最大的任务类型
    let topType = null, topGap = -1;
    for (const t of types) {
      if (shortage[t] > topGap) { topGap = shortage[t]; topType = t; }
    }

    // 能量预算：用 energyCapacityAvailable（满状态），不够就等（返回不造）
    const cap = room.energyCapacityAvailable;
    const cur = room.energyAvailable;
    const body = this._bodyFor(topType, cap);
    const cost = this._cost(body);
    if (cur < cost) return; // 攒能量，下 tick 再来（不出垃圾小号）

    const name = this._nameFor(topType) + '_' + Game.time;
    spawn.spawnCreep(body, name, { memory: { born: Game.time } });
  },
  /** 按任务类型 + 能量上限造最优 body */
  _bodyFor(type, cap) {
    switch (type) {
      case 'harvest':
        return this._minerBody(cap);
      case 'haul':
      case 'fill':
        return this._haulerBody(cap);
      case 'defend':
        return this._defenderBody(cap);
      case 'upgrade':
      case 'build':
      case 'repair':
      default:
        return this._workerBody(cap);
    }
  },

  /** 矿工体：尽量多 WORK（榨干 source），1 CARRY，少量 MOVE。成本≤cap */
  _minerBody(cap) {
    let work = Math.max(1, Math.min(6, Math.floor((cap - 100) / 100)));
    for (; work >= 1; work--) {
      const moves = Math.max(1, Math.ceil((work + 1) / 2));
      const cost = work * 100 + 50 + moves * 50;
      if (cost <= cap) {
        const b = [];
        for (let i = 0; i < work; i++) b.push(WORK);
        b.push(CARRY);
        for (let i = 0; i < moves; i++) b.push(MOVE);
        return b;
      }
    }
    return [WORK, CARRY, MOVE];
  },

  /** 搬运体：成对 CARRY+MOVE */
  _haulerBody(cap) {
    const pairs = Math.max(1, Math.min(8, Math.floor(cap / 100)));
    const b = [];
    for (let i = 0; i < pairs; i++) { b.push(CARRY); b.push(MOVE); }
    return b;
  },

  /** 工人体：均衡 WORK+CARRY+MOVE 单元堆叠（采/建/升通用） */
  _workerBody(cap) {
    const units = Math.max(1, Math.min(6, Math.floor(cap / 200)));
    const b = [];
    for (let i = 0; i < units; i++) { b.push(WORK); b.push(CARRY); b.push(MOVE); }
    return b;
  },

  /** 战斗体：TOUGH + ATTACK + MOVE */
  _defenderBody(cap) {
    const units = Math.max(1, Math.min(5, Math.floor(cap / 190)));
    const b = [];
    for (let i = 0; i < units; i++) b.push(TOUGH);
    for (let i = 0; i < units; i++) { b.push(ATTACK); b.push(MOVE); }
    return b;
  },

  _cost(body) {
    const c = { work: 100, carry: 50, move: 50, attack: 80, ranged_attack: 150, heal: 250, tough: 10, claim: 600 };
    return body.reduce((s, p) => s + (c[p] || 0), 0);
  },

  _nameFor(type) {
    // 按职能清晰命名（creep 名不可改，只能出生时定；旧名 creep 会随 TTL 自然淘汰）。
    // Miner=钉 container 静采；Carrier=专职搬运；Filler=回填 spawn/ext；
    // Upgrader=钉 controller；Builder=盖楼修路；Guard=防御。保持 ASCII 控制台安全。
    return {
      harvest: 'Miner', haul: 'Carrier', fill: 'Filler',
      upgrade: 'Upgrader', build: 'Builder', repair: 'Repairer', defend: 'Guard',
    }[type] || 'Creep';
  },
};
