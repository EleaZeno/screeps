'use strict';

/*
 * brain.loop.js — V3 大脑主循环（串起三层大脑）
 * ==================================================================
 * 每 tick 流程（无 if 嵌套决策，只有数据流）：
 *   1. brain.think()      → 战略权重 weights（想要什么）
 *   2. blackboard.scan()  → 任务池 tasks（有哪些活）
 *   3. market.assign()    → 给每个 creep 分配最优任务（谁干）
 *   4. executor.run()     → 每个 creep 执行中标任务
 *   5. market.shortage()  → 算缺口
 *   6. spawning.run()     → 按缺口造 body
 *
 * 旧的 spawn.manager / colony.guardian / 所有 role.* 都不再需要——
 * 它们的功能全被这 6 步的连续效用 + 市场涌现出来。
 */

const brain = require('brain');
const blackboard = require('blackboard');
const market = require('market');
const executor = require('executor');
const spawning = require('spawning');

module.exports.loop = function () {
  // 清理死 creep 内存
  for (const name in Memory.creeps) {
    if (!Game.creeps[name]) delete Memory.creeps[name];
  }

  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller || !room.controller.my) continue;

    const myCreeps = room.find(FIND_MY_CREEPS);

    // 1. 战略层：想要什么
    const weights = brain.think(room);
    // 2. 黑板：有哪些活
    const tasks = blackboard.scan(room);
    // 3. 市场：谁干（写入 creep.memory.taskId/taskType/taskTarget）
    const assignment = market.assign(myCreeps, tasks, weights);
    // 4. 执行：每个 creep 干自己中标的活
    for (const creep of myCreeps) {
      executor.run(creep);
    }
    // 5. 缺口分析
    const shortage = market.shortage(tasks, assignment);
    // 6. 孵化：最缺什么造什么
    spawning.run(room, shortage, myCreeps.length);

    // 轻量观测（每 10 tick 打一次大脑状态）
    if (Game.time % 10 === 0) {
      const gapStr = Object.entries(shortage).map(([k, v]) => `${k}:${Math.round(v)}`).join(' ') || '(满员)';
      console.log(`🧠 ${roomName} RCL${room.controller.level} creeps=${myCreeps.length} tasks=${tasks.length} 缺口=[${gapStr}]`);
    }
  }
};
