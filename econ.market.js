'use strict';

/*
 * econ.market.js — Screeps 官方市场变现层（RCL6+ terminal 就位后自动激活）
 * ==================================================================
 * ⚠️ 区别于 market.js：market.js 是【内部任务撮合】(creep↔task)，本模块是【真·买卖市场】(Game.market)。
 *
 * 目的：terminal 一好就把房间的【矿物 L(Lemergium) + 余量能量】卖成 credits，
 *       credits 攒够买 CPU Unlock 代币 = 游戏内白嫖 CPU，不花真钱。
 *
 * 设计原则（与 remote.mining 一致的安全门控）：
 *   - 默认随 RCL 自动激活：检测到 terminal 才动作；无 terminal 提前 return（RCL5 现在=休眠）。
 *   - 低频：每 SELL_INTERVAL tick 才评估一次（市场操作不急，省 CPU + 省 terminal 冷却）。
 *   - 保守卖：矿物攒到阈值才卖；能量只卖【storage 满溢】的余量，绝不卖掉发育能量。
 *   - 只用 market.deal 吃现有 buy 单（不自己挂 sell 单占 credits/冷却），优先单价最高的买单。
 *   - 任何一步出错 try/catch，绝不影响主循环。
 *
 * 可调（Memory.econ）：
 *   Memory.econ.enabled       默认 undefined=自动(有terminal就跑)；设 false 可强制关停
 *   Memory.econ.minMineralSell 矿物攒到多少才卖（默认 5000）
 *   Memory.econ.energyFloor    storage 能量高于此值才卖余量能量（默认 700000，接近满仓）
 *   Memory.econ.sellEnergy     是否卖余量能量（默认 false——能量优先自用，谨慎）
 */

const SELL_INTERVAL = 50;        // 每 50 tick 评估一次
const MIN_MINERAL_SELL = 5000;   // 矿物攒到 5000 才卖（够一笔像样交易，摊薄手续费）
const ENERGY_FLOOR = 700000;     // storage 能量超过 70 万（满仓 100 万）才考虑卖余量
const MAX_DEAL_AMOUNT = 5000;    // 单笔最大成交量（控制 terminal 能量消耗 + 风险）

module.exports = {
  /**
   * 主入口：对一个 my 房间调用。无 terminal / 未到评估 tick / 被强制关停 → 提前 return。
   * @param {Room} room
   * @returns {boolean} 本 tick 是否做过市场操作
   */
  run(room) {
    if (!room || !room.controller || !room.controller.my) return false;
    const econ = Memory.econ || (Memory.econ = {});
    if (econ.enabled === false) return false;           // 显式关停
    const terminal = room.terminal;
    if (!terminal) return false;                        // ⭐ 无 terminal=休眠（RCL5 现状）
    if (Game.time % SELL_INTERVAL !== 0) return false;  // 低频
    if (terminal.cooldown && terminal.cooldown > 0) return false;
    if (typeof Game.market === 'undefined' || !Game.market.deal) return false;

    let acted = false;
    this._activeTerminal = terminal;
    try {
      try { if (this._sellMinerals(room, terminal, econ)) acted = true; } catch (e) { console.log('econ mineral err ' + e); }
      if (!acted) {
        try { if (this._sellSurplusEnergy(room, terminal, econ)) acted = true; } catch (e) { console.log('econ energy err ' + e); }
      }
      return acted;
    } finally {
      this._activeTerminal = null;
    }
  },

  /** 卖矿物：把 terminal 里攒够阈值的非能量资源，吃净收益最佳且燃料可负担的买单。 */
  _sellMinerals(room, terminal, econ) {
    const minSell = econ.minMineralSell || MIN_MINERAL_SELL;
    // 找 terminal 里达到阈值的矿物（排除能量）
    for (const res in terminal.store) {
      if (res === RESOURCE_ENERGY) continue;
      const amount = terminal.store[res];
      if (amount < minSell) continue;
      const sold = this._dealBest(res, Math.min(amount, MAX_DEAL_AMOUNT), room.name);
      if (sold) { console.log('[ECON] 卖出 ' + sold.amount + ' ' + res + ' @' + sold.price + ' (' + room.name + ')'); return true; }
    }
    return false;
  },

  /** 卖余量能量：仅当 storage 能量高于地板线且开关打开。把 terminal 内能量余量卖掉。 */
  _sellSurplusEnergy(room, terminal, econ) {
    if (!econ.sellEnergy) return false;                 // 默认不卖能量
    const floor = econ.energyFloor || ENERGY_FLOOR;
    const storage = room.storage;
    if (!storage || storage.store[RESOURCE_ENERGY] < floor) return false;
    const inTerm = terminal.store[RESOURCE_ENERGY] || 0;
    // 留 20000 能量给 terminal 做交易燃料，其余可卖
    const sellable = inTerm - 20000;
    if (sellable < 1000) return false;
    const sold = this._dealBest(RESOURCE_ENERGY, Math.min(sellable, MAX_DEAL_AMOUNT), room.name);
    if (sold) { console.log('[ECON] 卖出余量能量 ' + sold.amount + ' @' + sold.price + ' (' + room.name + ')'); return true; }
    return false;
  },

  /** 吃“当前 terminal 能量实际付得起”的最佳 buy 单。
   *  不再盲目按裸单价选远端订单；用少量迭代求最大可成交量，并按净收益排序。
   *  能量估值可用 Memory.econ.energyCreditValue 调整（默认 0.05 credit/e）。 */
  _dealBest(resource, amount, roomName) {
    const orders = Game.market.getAllOrders({ type: ORDER_BUY, resourceType: resource });
    if (!orders || !orders.length) return null;
    const room = Game.rooms && Game.rooms[roomName];
    // 正常运行从 Game.rooms 取；纯 mock/回归测试可由 run() 暂存当前 terminal。
    const terminal = (room && room.terminal) || this._activeTerminal;
    if (!terminal) return null;
    const fuel = terminal.store[RESOURCE_ENERGY] || 0;
    const energyValue = (Memory.econ && Memory.econ.energyCreditValue) || 0.05;
    const feasible = [];
    for (const order of orders) {
      if (!order || order.amount <= 0) continue;
      let hi = Math.floor(Math.min(amount, order.amount));
      if (resource === RESOURCE_ENERGY) hi = Math.min(hi, fuel); // 卖出的能量本体也必须在 terminal
      let lo = 0;
      // 二分最大可付交易能耗的成交量。
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        const tx = Game.market.calcTransactionCost ? Game.market.calcTransactionCost(mid, roomName, order.roomName) : 0;
        const required = tx + (resource === RESOURCE_ENERGY ? mid : 0);
        if (required <= fuel) lo = mid; else hi = mid - 1;
      }
      if (lo <= 0) continue;
      const tx = Game.market.calcTransactionCost ? Game.market.calcTransactionCost(lo, roomName, order.roomName) : 0;
      feasible.push({ order, amount: lo, tx, net: order.price * lo - tx * energyValue });
    }
    feasible.sort((a, b) => b.net - a.net);
    for (const f of feasible) {
      const r = Game.market.deal(f.order.id, f.amount, roomName);
      if (r === OK) return { amount: f.amount, price: f.order.price };
      console.log('[ECON] deal失败 code=' + r + ' res=' + resource + ' amount=' + f.amount + ' room=' + roomName);
    }
    return null;
  },
};
