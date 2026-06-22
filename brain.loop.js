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
const adaptive = require('adaptive');
const genome = require('genome');
// —— 工程规划层（复用旧系统已写好的成熟规划器，之前重写时漏接）——
// 这是大脑"会运筹/布局"的关键：主动规划 container/extension/tower/路网，
// 往世界里添加工地，市场自然会派人去建。不破坏效用/市场原则。
let buildPlanner, layoutPlanner;
try { buildPlanner = require('build.planner'); } catch (e) { buildPlanner = null; }
try { layoutPlanner = require('layout.planner'); } catch (e) { layoutPlanner = null; }

module.exports.loop = function () {
  const _cpuStart = (typeof Game !== 'undefined' && Game.cpu && Game.cpu.getUsed) ? Game.cpu.getUsed() : 0;
  // 清理死 creep 内存
  for (const name in Memory.creeps) {
    if (!Game.creeps[name]) delete Memory.creeps[name];
  }

  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller || !room.controller.my) continue;

    const myCreeps = room.find(FIND_MY_CREEPS);

    // 0. 工程规划层：主动布局基建（这让大脑"会运筹"——多建 container/扩展/修路/规划布局）
    // build.planner 内部每20tick、layout 每100tick 才真跑，CPU 极低。产出的工地由市场派人建。
    if (layoutPlanner) { try { layoutPlanner.run(room); layoutPlanner.buildRoads(room); } catch (e) { console.log('layout err ' + e); } }
    if (buildPlanner) { try { buildPlanner.run(room); } catch (e) { console.log('build err ' + e); } }

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
    // 7. 自适应学习：观察结果，沉淀经验到 playbook（越用越聪明）
    adaptive.observe(room, Memory.brain);
    // 8. 进化：用真实 progress 增速评估基因组，变异保优淘劣（真自学习，不可自欺）
    if (!Memory.brain) Memory.brain = {};
    genome.current(Memory.brain); // 确保基因组已初始化
    genome.evolve(room, Memory.brain, 300);

    // 轻量观测（每 10 tick 打一次大脑状态 + 当前计划）
    if (Game.time % 10 === 0) {
      const gapStr = Object.entries(shortage).map(([k, v]) => `${k}:${Math.round(v)}`).join(' ') || '(满员)';
      const d = (Memory.brain && Memory.brain._diag) || {};
      const gn = (Memory.brain && Memory.brain.genome) || {};
      console.log(`🧠 ${roomName} RCL${room.controller.level} creeps=${myCreeps.length} 计划=[${d.goal || '?'}:${d.plan || ''}] 进化代=${gn.gen || 0} fit=${gn.lastFitness != null ? gn.lastFitness : '?'} 缺口=[${gapStr}]`);
    }
  }

  // ===== CPU 实测（写入 Memory 供外部读回）=====
  if (typeof Game !== 'undefined' && Game.cpu && Game.cpu.getUsed) {
    const used = Game.cpu.getUsed();
    if (!Memory.brain) Memory.brain = {};
    const cm = Memory.brain.cpu || { ema: used, max: 0, n: 0 };
    cm.last = Math.round(used * 100) / 100;
    cm.ema = Math.round((cm.ema * 0.9 + used * 0.1) * 100) / 100;
    cm.max = Math.max(cm.max, Math.round(used * 100) / 100);
    cm.n = (cm.n || 0) + 1;
    cm.creeps = Object.keys(Game.creeps).length;
    cm.bucket = Game.cpu.bucket;
    Memory.brain.cpu = cm;
  }
};
