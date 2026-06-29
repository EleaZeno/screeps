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
// —— tower 主动控制（V3 架构原本缺失：没人指挥 tower 结构开火/治疗/维修）——
let towerControl;
try { towerControl = require('tower.control'); } catch (e) { towerControl = null; }
let linkControl;
try { linkControl = require('link.control'); } catch (e) { linkControl = null; }

// —— Memory 自净：清理调试残留的 __xxx 顶层临时键 ——
// 控制台调试/autopilot 会往 Memory 写一次性 __probe/__diag/__autopilot 等 scratch 键，
// 不会自清，长期累积成几十 KB 死垃圾 -> 每 tick 序列化都白烧 CPU。
// 约定：顶层以 '__' 开头的键一律视为临时调试键，任何线上模块都不读写它们（已核验）。
// 每 100 tick 扫一次（CPU 可忽略），只删 Memory 顶层 __ 键，绝不碰 creeps/brain/intel/config 等正式键。
function _pruneScratch() {
  let n = 0;
  for (const k in Memory) {
    if (k.length >= 2 && k[0] === '_' && k[1] === '_') { delete Memory[k]; n++; }
  }
  if (n > 0) console.log(`🧹 Memory 自净: 清理 ${n} 个调试残留 __ 键`);
  return n;
}

module.exports.loop = function () {
  const _cpuStart = (typeof Game !== 'undefined' && Game.cpu && Game.cpu.getUsed) ? Game.cpu.getUsed() : 0;
  // 清理死 creep 内存
  for (const name in Memory.creeps) {
    if (!Game.creeps[name]) delete Memory.creeps[name];
  }
  // Memory 自净（每 100 tick，低频低耗）
  if (Game.time % 100 === 0) { try { _pruneScratch(); } catch (e) { /* 自净失败不影响主逻辑 */ } }

  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller || !room.controller.my) continue;

    const myCreeps = room.find(FIND_MY_CREEPS);

    // 0a. 防御层：主动驱动 tower（攻击敌人 > 治疗友军 > 和平期维修）。
    // 放在最前：tower 反应速度直接决定房间被打时能否扛住。CPU 极低。
    if (towerControl) { try { towerControl.run(room); } catch (e) { console.log('tower err ' + e); } }
    // 0b. 能量层：RCL5+ link 瞬移（source→controller/storage），不下令 link 就是死能量。
    if (linkControl) { try { linkControl.run(room); } catch (e) { console.log('link err ' + e); } }

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
