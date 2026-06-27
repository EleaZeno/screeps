'use strict';

/*
 * blackboard.js — L2 世界状态扫描 + 任务池生成
 * ==================================================================
 * 大脑的"眼睛"：每 tick 扫描房间，把"有哪些活要干"列成任务池。
 * 不做任何决策（决策是 market 的事），只负责【客观描述世界 + 列出所有可做的任务】。
 *
 * 任务结构：
 *   {
 *     id:       唯一标识（type+target，用于跨 tick 连续性识别）
 *     type:     'harvest'|'haul'|'upgrade'|'build'|'repair'|'fill'|'defend'
 *     targetId: 目标对象 id（source/controller/structure/creep）
 *     pos:      {x,y,roomName} 目标位置（算距离用）
 *     baseValue: 任务基础价值（0..100，战略层权重会再乘上去）
 *     capacity: 这个任务最多能容纳几个 creep 同时干（如一个开采格=1）
 *     meta:     任务特定数据（如 harvest 的 slot 坐标、haul 的能量量）
 *   }
 *
 * 设计原则：任务生成是【数据驱动的列举】，不是 if 嵌套的决策。
 *   每种任务类型一个独立的 collect 函数，互不影响，加任务类型零侵入。
 */

const scheduler = require('source.scheduler');

module.exports = {
  /** 扫描房间，返回任务池数组。纯客观，不决策。 */
  scan(room) {
    const tasks = [];
    this._collectHarvest(room, tasks);
    this._collectHaul(room, tasks);
    this._collectFill(room, tasks);
    this._collectUpgrade(room, tasks);
    this._collectBuild(room, tasks);
    this._collectRepair(room, tasks);
    this._collectDefend(room, tasks);
    return tasks;
  },

  /** 采集任务：每个开采格 = 一个 capacity=1 的 harvest 任务。 */
  _collectHarvest(room, tasks) {
    scheduler.planSlots(room); // 确保开采格已预计算（吃空闲CPU，已缓存则瞬返）
    const slots = (room.memory.slots && room.memory.slots.all) || [];
    // 【关键设计】采集任务不按物理格无限开，而按 source 产能限量：
    //   一个 source 5 energy/tick 再生，1-2 个采集者即可榨干，多了是浪费。
    //   每个 source 最多开 maxPerSource 个采集格任务（取最近的几个格）。
    //   这防止"16 个格全开 → 所有 creep 被采集吸走 → 没人升级/建造"。
    const maxPerSource = 2;
    const bySource = {};
    for (const slot of slots) {
      (bySource[slot.sourceId] = bySource[slot.sourceId] || []).push(slot);
    }
    for (const sid in bySource) {
      const source = Game.getObjectById(sid);
      if (!source) continue;
      const fill = source.energy / Math.max(1, source.energyCapacity);
      // 取离 spawn 最近的 maxPerSource 个格（slot.dist 已由 scheduler 预算）
      const chosen = bySource[sid].sort((a, b) => (a.dist || 0) - (b.dist || 0)).slice(0, maxPerSource);
      for (const slot of chosen) {
        tasks.push({
          id: `harvest:${slot.x},${slot.y}`,
          type: 'harvest',
          targetId: sid,
          pos: { x: slot.x, y: slot.y, roomName: room.name },
          baseValue: 60 + fill * 20, // 60..80
          capacity: 1,
          meta: { slot },
        });
      }
    }
  },

  /** 搬运任务：每个有能量的 container/掉落物/坟墓 = 一个 haul 任务。 */
  _collectHaul(room, tasks) {
    const sources = [];
    // 地上掉落：门槛 30→10（少量散料也捡，地上每 tick 衰减不捡就损耗）。
    room.find(FIND_DROPPED_RESOURCES, { filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 10 })
      .forEach((r) => sources.push({ id: r.id, pos: r.pos, amount: r.amount, kind: 'dropped' }));
    room.find(FIND_STRUCTURES, {
      filter: (s) => (s.structureType === STRUCTURE_CONTAINER) && s.store[RESOURCE_ENERGY] > 50,
    }).forEach((s) => sources.push({ id: s.id, pos: s.pos, amount: s.store[RESOURCE_ENERGY], kind: 'container' }));
    room.find(FIND_TOMBSTONES, { filter: (t) => t.store[RESOURCE_ENERGY] > 0 })
      .forEach((t) => sources.push({ id: t.id, pos: t.pos, amount: t.store[RESOURCE_ENERGY], kind: 'tomb' }));

    for (const s of sources) {
      // 能量越多越该搬（避免 container 溢出浪费）；capacity 随量缩放。
      // 【修复 2026-06-23·hauler 过剩】原 capacity=ceil(amount/200) 在 container 囤积时
      //   会膨胀到极大（5 罐 6800 能量 → ~34 haul 槽 → 24 个 creep 全去搬运一个本质是
      //   "消费端不足" 造成的 backlog）。真正缺的是 upgrader（消费），不是 hauler（搬运）。
      //   每个搬运源最多 2 个 hauler 槽足矣（一个在搬、一个在路上）；多了是把 creep
      //   浪费在搬运一个不该存在的积压上。积压的正解是提高 upgrade 容量去消费它。
      tasks.push({
        id: `haul:${s.id}`,
        type: 'haul',
        targetId: s.id,
        pos: { x: s.pos.x, y: s.pos.y, roomName: room.name },
        baseValue: Math.min(95, 40 + ((s.kind === 'dropped' || s.kind === 'tomb') ? 25 : 0) + s.amount / 30),
        capacity: (s.kind === 'dropped' || s.kind === 'tomb')
          ? Math.min(3, Math.max(1, Math.ceil(s.amount / 250)))
          : Math.min(2, Math.max(1, Math.ceil(s.amount / 400))),
        meta: { amount: s.amount, kind: s.kind },
      });
    }
  },

  /** 填充任务：spawn/extension/tower 缺能量 = 高优先 fill 任务（孵化命脉）。 */
  _collectFill(room, tasks) {
    const needs = room.find(FIND_MY_STRUCTURES, {
      filter: (s) =>
        (s.structureType === STRUCTURE_SPAWN ||
          s.structureType === STRUCTURE_EXTENSION ||
          s.structureType === STRUCTURE_TOWER) &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    });
    for (const s of needs) {
      const free = s.store.getFreeCapacity(RESOURCE_ENERGY);
      // spawn/extension 优先级最高（没能量孵不出 creep）；tower 次之
      const isSpawnExt = s.structureType !== STRUCTURE_TOWER;
      tasks.push({
        id: `fill:${s.id}`,
        type: 'fill',
        targetId: s.id,
        pos: { x: s.pos.x, y: s.pos.y, roomName: room.name },
        baseValue: isSpawnExt ? 95 : 70,
        capacity: 1,
        meta: { free },
      });
    }
  },

  /** 升级任务：controller 永远可升级。价值由战略层权重主导。 */
  _collectUpgrade(room, tasks) {
    const ctrl = room.controller;
    if (!ctrl || !ctrl.my) return;
    // 逼近降级 → 紧急加成（连续函数：剩余降级时间越短价值越高）
    const downgradeUrgency = ctrl.ticksToDowngrade
      ? Math.max(0, 1 - ctrl.ticksToDowngrade / 5000) * 60
      : 0;
    // 【世界模型驱动容量】升级人数受能量供给约束：一个 1-WORK upgrader 消耗 1 e/tick，
    // 能量产出 harvestRate(减去孵化/填充消耗)才能养几个 upgrader。
    // 这是分工流水线的关键：升级人数不能超过能量能养的，否则大家抢着升级没人采矿。
    let upCap = 4; // 默认
    // ⭐ 激进：升级人数上限由进化基因 upCapMax 决定（默认 16，可进化到 30）
    const _g = (Memory.brain && Memory.brain.genome && Memory.brain.genome.genes) || {};
    const UPCAP_MAX = Math.round(_g.upCapMax || 16);
    try {
      const wm = require('worldmodel');
      const flow = wm.economyFlow(room);
      // 能量产出的 ~60% 可用于升级(其余给孵化/填充)，每 upgrader 按 2 WORK 估=2 e/tick
      const upBudget = flow.harvestRate * 0.6;
      upCap = Math.max(1, Math.min(UPCAP_MAX, Math.round(upBudget / 2)));
      // 防降级紧急时至少保 1 个
      if (downgradeUrgency > 0) upCap = Math.max(1, upCap);
      // 【修复 2026-06-23·能量积压未转化为 RCL】当 container/storage 已囤大量能量时，
      //   说明产出>消费、搬运端在空转。此时应放行更多 upgrader 把积压能量直接烧成
      //   controller 进度（而不是让 24 个 hauler 在搬一堆没人消费的能量）。
      //   储备能量按 "每 1000 富余能量多养 1 个 upgrader" 临时提额，封顶 12。
      let backlog = (room.storage ? room.storage.store[RESOURCE_ENERGY] : 0);
      const conts = room.find(FIND_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER,
      });
      for (const c of conts) backlog += (c.store[RESOURCE_ENERGY] || 0);
      if (backlog > 1500) {
        upCap = Math.min(UPCAP_MAX + 8, upCap + Math.floor(backlog / 1500));
      }
    } catch (e) { /* fallback */ }
    tasks.push({
      id: `upgrade:${ctrl.id}`,
      type: 'upgrade',
      targetId: ctrl.id,
      pos: { x: ctrl.pos.x, y: ctrl.pos.y, roomName: room.name },
      baseValue: 40 + downgradeUrgency,
      capacity: upCap, // 世界模型：能量供得起几个升级者
      meta: {},
    });
  },

  /** 建造任务：每个工地 = 一个 build 任务。 */
  _collectBuild(room, tasks) {
    const sites = room.find(FIND_MY_CONSTRUCTION_SITES);
    for (const site of sites) {
      // 重要建筑（extension/container/tower/spawn）价值更高
      const importance = {
        [STRUCTURE_SPAWN]: 90, [STRUCTURE_EXTENSION]: 70, [STRUCTURE_TOWER]: 75,
        [STRUCTURE_CONTAINER]: 65, [STRUCTURE_STORAGE]: 80, [STRUCTURE_ROAD]: 35,
      }[site.structureType] || 45;
      tasks.push({
        id: `build:${site.id}`,
        type: 'build',
        targetId: site.id,
        pos: { x: site.pos.x, y: site.pos.y, roomName: room.name },
        baseValue: importance,
        capacity: Math.max(1, Math.ceil(site.progressTotal / 5000)),
        meta: {},
      });
    }
  },

  /** 维修任务：受损建筑（非墙优先）= repair 任务。
   *  container 是静态分工命脉且衰减快，提前到 80% 就修且价值更高（丢了分工就垮）。 */
  _collectRepair(room, tasks) {
    const damaged = room.find(FIND_STRUCTURES, {
      filter: (s) => {
        if (s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART) return false;
        // container 提前到 80%（衰减快，别等快没了才修）；其他 60%
        const thresh = s.structureType === STRUCTURE_CONTAINER ? 0.8 : 0.6;
        return s.hits < s.hitsMax * thresh;
      },
    });
    for (const s of damaged) {
      const dmgRatio = 1 - s.hits / s.hitsMax;
      const isContainer = s.structureType === STRUCTURE_CONTAINER;
      tasks.push({
        id: `repair:${s.id}`,
        type: 'repair',
        targetId: s.id,
        pos: { x: s.pos.x, y: s.pos.y, roomName: room.name },
        baseValue: (isContainer ? 55 : 30) + dmgRatio * 40, // container 基础价更高
        capacity: 1,
        meta: {},
      });
    }
  },

  /** 防御任务：每个【真威胁】敌人 = 一个高优先 defend 任务。
   *  【修复 2026-06-24】纯 MOVE 侦察兵(无 ATTACK/RANGED/WORK/CLAIM)不生成 defend 任务，
   *  否则 baseValue=100 的高价任务会把工人从升级上拉走去追一个追不上、打不动的侦察兵。 */
  _collectDefend(room, tasks) {
    const hostiles = room.find(FIND_HOSTILE_CREEPS, {
      filter: (h) => {
        if (!h.getActiveBodyparts) return true;
        const _CLAIM = (typeof CLAIM !== 'undefined') ? CLAIM : 'claim';
        return (h.getActiveBodyparts(ATTACK) + h.getActiveBodyparts(RANGED_ATTACK) +
          h.getActiveBodyparts(WORK) + h.getActiveBodyparts(_CLAIM)) > 0;
      },
    });
    for (const h of hostiles) {
      tasks.push({
        id: `defend:${h.id}`,
        type: 'defend',
        targetId: h.id,
        pos: { x: h.pos.x, y: h.pos.y, roomName: room.name },
        baseValue: 100, // 防御压倒一切
        capacity: 3,
        meta: {},
      });
    }
  },
};

