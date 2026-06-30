'use strict';
/* _econtest.js — econ.market 回归测试（纯 mock）
 * 重点验证 RCL5 现状下的安全休眠 + RCL6 激活后的卖矿行为。
 */
global.RESOURCE_ENERGY = 'energy';
global.ORDER_BUY = 'buy';
global.OK = 0;

let pass = 0, fail = 0;
function ok(c, n) { if (c) { pass++; console.log('  PASS', n); } else { fail++; console.log('  FAIL', n); } }

global.Memory = {};
let dealCalls = [];
global.Game = {
  time: 100, // 100 % 50 === 0，命中评估 tick
  market: {
    deal(id, amount, room) { dealCalls.push({ id, amount, room }); return OK; },
    getAllOrders(filter) {
      if (filter.resourceType === 'L') return [{ id: 'o1', price: 0.5, amount: 3000 }, { id: 'o2', price: 0.8, amount: 1000 }];
      return [];
    },
  },
};

const em = require('./econ.market.js');

function room(opts) {
  return {
    controller: { my: true, level: opts.rcl || 5 },
    storage: opts.storageEnergy != null ? { store: { [RESOURCE_ENERGY]: opts.storageEnergy } } : undefined,
    terminal: opts.terminal,
  };
}

// 1. 无 terminal（RCL5 现状）→ 休眠，返回 false
ok(em.run(room({ rcl: 5 })) === false, 'RCL5 无terminal 休眠');

// 2. 有 terminal 但矿物不够阈值 → 不卖
dealCalls = [];
ok(em.run(room({ rcl: 6, terminal: { cooldown: 0, store: { L: 1000 } } })) === false && dealCalls.length === 0, '矿物<阈值不卖');

// 3. 有 terminal 且矿物够 → 吃最高价买单(0.8)，成交量=min(amount,5000,买单余量1000)=1000
dealCalls = [];
{
  const acted = em.run(room({ rcl: 6, terminal: { cooldown: 0, store: { L: 6000 } } }));
  ok(acted === true, '矿物够→卖出');
  ok(dealCalls.length === 1 && dealCalls[0].id === 'o2' && dealCalls[0].amount === 1000, '吃最高价买单(0.8) 量=1000');
}

// 4. 显式 Memory.econ.enabled=false → 强制关停
Memory.econ = { enabled: false };
ok(em.run(room({ rcl: 6, terminal: { cooldown: 0, store: { L: 6000 } } })) === false, 'enabled=false 强制关停');
Memory.econ = {};

// 5. terminal 冷却中 → 不动
ok(em.run(room({ rcl: 6, terminal: { cooldown: 5, store: { L: 6000 } } })) === false, 'terminal冷却中不动');

// 6. 非评估 tick → 不动
Game.time = 101;
ok(em.run(room({ rcl: 6, terminal: { cooldown: 0, store: { L: 6000 } } })) === false, '非评估tick不动');
Game.time = 100;

// 7. 默认不卖能量（sellEnergy 未开）
dealCalls = [];
ok(em.run(room({ rcl: 6, storageEnergy: 900000, terminal: { cooldown: 0, store: { [RESOURCE_ENERGY]: 50000 } } })) === false, '默认不卖能量');

console.log('\n_econtest:', pass, 'pass /', fail, 'fail');
process.exit(fail === 0 ? 0 : 1);
