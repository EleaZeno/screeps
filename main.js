'use strict';

/*
 * Screeps v2.1 主循环 — 急速扩张 + 防御 + (可选)进攻
 * ------------------------------------------------------------------
 * 模块：
 *  config.js          — 全局开关/策略（改行为只动这里）
 *  spawn.manager.js   — 孵化（config 驱动，身体自适应）
 *  source.manager.js  — source 容量 + 采集者固定分配
 *  build.planner.js   — 自动铺 extension/container/tower
 *  tower.manager.js   — tower 自动防御 + 修理
 *  role.*.js          — miner/hauler/harvester/upgrader/builder/defender/attacker
 *  utils.js           — 移动缓存 + 找目标 + 取能量
 *
 * 进攻默认关闭。经济起来后在控制台开：
 *   Memory.config = { attack: { enabled: true, targetRoom: 'E5N53', squadSize: 4, type: 'melee' } }
 */
const config = require('config');
const guardian = require('colony.guardian');
const spawnManager = require('spawn.manager');
const sourceManager = require('source.manager');
const scheduler = require('source.scheduler');
const buildPlanner = require('build.planner');
const towerManager = require('tower.manager');
const cpuManager = require('cpu.manager');
const layoutPlanner = require('layout.planner');
const intelManager = require('intel.manager');
const profiler = require('cpu.profiler');
const dashboard = require('dashboard');
const commands = require('commands');
const visual = require('visual');
const statsTracker = require('stats.tracker');

const ROLES = {
  harvester: require('role.harvester'),
  miner: require('role.miner'),
  hauler: require('role.hauler'),
  upgrader: require('role.upgrader'),
  builder: require('role.builder'),
  defender: require('role.defender'),
  attacker: require('role.attacker'),
};

module.exports.loop = function () {
  profiler.init(config.profiler !== false);
  if (!global.__cmdRegistered) { commands.register(); global.__cmdRegistered = true; } // 【M1】只注册一次，不每 tick 重挂
  const _t0 = profiler.start();

  // 0. Memory 初始化
  if (!Memory.creeps) Memory.creeps = {};
  if (!Memory.stats) Memory.stats = {};

  // 1. 清理死亡 creep 内存
  for (const name in Memory.creeps) {
    if (!Game.creeps[name]) delete Memory.creeps[name];
  }

  // 2. 房间级管理：source 容量、建造规划、tower 防御、孵化
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller || !room.controller.my) continue;

    // 【免疫系统】最高优先：先守护生存不变量（死亡螺旋熔断/死锁回收）。
    // 返回 true 表示处于紧急接管，spawn/builder 等模块会读 guardian.isEmergency() 让路。
    const emergency = profiler.wrap('guard', () => guardian.run(room));

    sourceManager.ensureSourceCapacity(room);
    profiler.wrap('sched', () => scheduler.planSlots(room)); // 空闲 CPU 预计算开采格+路线（只算一次，缓存）
    // 紧急求生模式下暂停一切非生存性建造，能量全留给采集/孵化
    if (config.economy.autoBuild && !emergency) profiler.wrap('build', () => buildPlanner.run(room));
    if (config.economy.layoutPlanning) profiler.wrap('layout', () => { layoutPlanner.run(room); layoutPlanner.buildRoads(room); });
    if (config.military.towerDefense) profiler.wrap('tower', () => towerManager.run(room));
    profiler.wrap('spawn', () => spawnManager.run(room));
    if (config.visualOverlay !== false) profiler.wrap('visual', () => { try { visual.draw(room); } catch (e) { /* 可视化失败不影响主逻辑 */ } });
  }

  // 3. 执行每个 creep 的角色逻辑（带 try/catch 隔离）
  const _tc = profiler.start();
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    const role = ROLES[creep.memory.role];
    if (role) {
      try { role.run(creep); }
      catch (err) { console.log(`[ERR] ${name} (${creep.memory.role}): ${err.stack || err}`); }
    }
  }
  profiler.end('creeps', _tc);

  // 4. 闲置 CPU 变现：bucket 满时自动生成 pixel（全局每 tick 检查一次）
  // 控制台 pixelOn()/pixelOff() 写 Memory.config.economy.autoPixel，优先于静态 config。
  const _ecoOv = (Memory.config && Memory.config.economy) || {};
  const _autoPixel = _ecoOv.autoPixel !== undefined ? _ecoOv.autoPixel : config.economy.autoPixel;
  if (_autoPixel) profiler.wrap('pixel', () => cpuManager.run());

  // 4b. 闲置 CPU/内存全面利用：预计算情报/威胁/扩张预案/距离矩阵（严格 bucket 门控，多房自动覆盖）
  if (config.economy.intelPlanning) profiler.wrap('intel', () => intelManager.run(config.economy.intelReserveBucket));

  // 5. 控制台 dashboard（每 N tick）
  profiler.tickDone();
  statsTracker.sample(); // 每 tick 采样关键指标（滞动统计）
  if (Game.time % (config.dashboardInterval || 15) === 0) dashboard.print();
};
