'use strict';

/*
 * config.js — 全局开关与策略参数（改这里就能调整 AI 行为，无需翻代码）
 * ------------------------------------------------------------------
 * 急速扩张 + 攻击性，但攻击默认关闭（避免过早打仗饿死经济）。
 * 在游戏控制台可临时覆盖：Memory.config.xxx = ...
 */
module.exports = {
  // ---- 经济：急速发育 ----
  economy: {
    useStaticMining: true,     // 静态 miner + hauler 分离（效率翻倍，急速发育核心）
    aggressiveUpgrade: true,   // 能量富余时狂堆 upgrader 冲 RCL
    autoBuild: true,           // 自动规划建造 extension/container/road/tower
    autoPixel: true,           // bucket 满 10000 时自动生成 pixel（闲置 CPU 变现）
    rushInfra: true,           // RCL≤3 且有工地时，优先突击建 extension（打破低RCL死循环，加速发育）
  },

  // ---- 军事：防御常开，进攻默认关 ----
  military: {
    towerDefense: true,        // tower 自动打敌人 + 修墙（常开，几乎不耗 CPU）
    autoDefendCreeps: true,    // 有敌人入侵时自动孵化防御 creep

    // 主动进攻：默认关闭！经济起来后在控制台开：
    //   Memory.config = Memory.config || {};
    //   Memory.config.attack = { enabled: true, targetRoom: 'E5N53', squadSize: 4 };
    attack: {
      enabled: false,
      targetRoom: null,        // 目标房间名，如 'E5N53'
      squadSize: 4,            // 攻击小队规模
      type: 'melee',           // 'melee'(近战) 或 'ranged'(远程)
    },
  },

  // ---- creep 数量目标（随 RCL 缩放，0 表示由代码动态算）----
  population: {
    // 静态采矿模式下：每个 source 1 个 miner + 若干 hauler
    haulersPerSource: 2,
    upgradersBase: 1,          // 基础 upgrader 数（富余时会自动加）
    buildersWithSites: 2,      // 有工地时的 builder 数
    scouts: 0,                 // 斥候数（0=不派）
  },
};
