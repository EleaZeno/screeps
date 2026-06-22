'use strict';

/*
 * brain.js — L3 战略层（大脑的"意志"：想要什么）
 * ==================================================================
 * 每 ~5 tick 跑一次。读世界宏观状态，产出全局权重 weights{}。
 * 权重会乘到每种任务的价值上，从而平滑地调节整个殖民地的行为重心。
 *
 * 不做微观决策（那是 market/utility 的事）。只回答一个问题：
 *   "当前局面下，殖民地的重心应该偏向哪几类活？"
 *
 * 输出权重越高 = 该类任务越被优先抢。全连续，无硬切换。
 * 权重存 Memory.brain.weights，供 adaptive 层进一步自适应微调。
 */

const STRATEGY_INTERVAL = 5;

module.exports = {
  /** 主入口：必要时重算权重，返回当前权重 */
  think(room) {
    if (!Memory.brain) Memory.brain = {};
    const b = Memory.brain;
    if (b.weights && b.nextThink && Game.time < b.nextThink) {
      return b.weights; // 用缓存权重，省 CPU
    }
    b.weights = this._compute(room);
    b.nextThink = Game.time + STRATEGY_INTERVAL;
    return b.weights;
  },

  /** 计算权重：全连续函数，根据局面平滑调节 */
  _compute(room) {
    const ctrl = room.controller;
    const rcl = ctrl ? ctrl.level : 1;
    const cap = room.energyCapacityAvailable;
    const cur = room.energyAvailable;
    const energyFill = cur / Math.max(1, cap);          // 当前能量充裕度 0..1
    const hostiles = room.find(FIND_HOSTILE_CREEPS).length;
    const sites = room.find(FIND_MY_CONSTRUCTION_SITES).length;
    const storage = room.storage;
    const stored = storage ? storage.store[RESOURCE_ENERGY] : 0;
    const downgradeRisk = ctrl && ctrl.ticksToDowngrade && ctrl.ticksToDowngrade < 3000;

    // 基础权重（1.0 = 中性）。下面按局面平滑加减。
    const w = {
      harvest: 1.0,  // 采集：经济根基，恒定偏高
      haul: 1.0,     // 搬运：跟随采集
      fill: 1.0,     // 填充：孵化命脉
      upgrade: 1.0,  // 升级：冲 RCL
      build: 1.0,    // 建造：扩基建
      repair: 0.8,   // 维修：平时低优先
      defend: 1.0,   // 防御：有敌才升
    };

    // —— 防御压倒一切：有敌人时 defend 权重飙升 ——
    if (hostiles > 0) {
      w.defend = 3.0 + hostiles * 0.5;
    } else {
      w.defend = 0.01; // 无敌人时几乎不产生防御抢占（仍保留极小值）
    }

    // —— 采集恒定高：经济根基，永远要保证有人采 ——
    w.harvest = 1.4;
    w.haul = 1.2;

    // —— 建造优先于升级（基建决定身体上限，先把家盖好）——
    //    有工地 → build 升高；同时压低 upgrade（除非逼近降级）
    if (sites > 0) {
      w.build = 1.6;
      w.upgrade = downgradeRisk ? 1.5 : 0.6; // 防降级才升级，否则先盖房
    } else {
      // 无工地 → 能量全砸升级冲 RCL（aggressiveUpgrade 哲学）
      w.build = 0.3;
      w.upgrade = 1.0 + energyFill * 1.5 + (stored > 5000 ? 1.0 : 0); // 能量越富余越狂升
    }

    // —— 能量紧张（孵化都吃力）→ fill 升高保孵化 ——
    w.fill = 1.0 + (1 - energyFill) * 1.0; // 越缺能量越优先回填 spawn/ext

    // —— 维修：建筑受损多时升高（这里粗略用 RCL≥3 有 tower 后稍升）——
    w.repair = rcl >= 3 ? 1.0 : 0.6;

    return w;
  },
};
