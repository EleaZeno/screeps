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
    this._collectStore(room, tasks);
    this._collectTerminalFuel(room, tasks);
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
    // ⭐ 修复 2026-06-30：预先收集所有 container 坐标（一次遍历，O(结构数)），
    //   用于让开采格优先选【脚下有 container 的格】，矿工采的能量直接进 container。
    const contKeys = {};
    room.find(FIND_STRUCTURES, { filter: (s) => s.structureType === STRUCTURE_CONTAINER })
      .forEach((c) => { contKeys[c.pos.x + ',' + c.pos.y] = 1; });
    for (const sid in bySource) {
      const source = Game.getObjectById(sid);
      if (!source) continue;
      const fill = source.energy / Math.max(1, source.energyCapacity);
      // 有 container 的开采格排前（让矿工站上去，能量 transfer 进脚下 container = 静态采矿成立）；
      // 同类再按 spawn 距离近优先。这修正了原“只按距离选格 → 跟 container 实际位置错开 →
      // 矿工站空格、container 永远 0”的根因。
      const sortedSlots = bySource[sid].slice().sort((a, b) => {
        const ca = contKeys[a.x + ',' + a.y] ? 0 : 1;
        const cb = contKeys[b.x + ',' + b.y] ? 0 : 1;
        if (ca !== cb) return ca - cb;
        return (a.dist || 0) - (b.dist || 0);
      });
      const chosen = sortedSlots.slice(0, maxPerSource);
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
    // ⭐ 2026-07-01: storage link 是物流链最后一环。link.control 把 source link 能量瞬移到
    //   storage link, 但 link 本身不会自动倒进 storage 结构 → 实测 storage link 攒到 776
    //   却 storageE=0。把【storage 旁的 link】(非 controller link, 那个直接喂 upgrader)
    //   挂为 haul 源, 让 hauler withdraw 后经 findEnergyDropOff 送进 storage, 打通最后2格。
    if (room.storage) {
      room.find(FIND_MY_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_LINK &&
          s.store[RESOURCE_ENERGY] > 50 &&
          s.pos.inRangeTo(room.storage, 2) &&
          !(room.controller && s.pos.inRangeTo(room.controller, 2)), // controller link 不抽(留给升级)
      }).forEach((s) => sources.push({ id: s.id, pos: s.pos, amount: s.store[RESOURCE_ENERGY], kind: 'storageLink' }));
    }

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

  /** ⭐ 屯仓任务（修复 2026-06-30）：把 container/掉落里的富余能量辐进 storage 储备。
   *  这是物流链的【出口】：原来 Filler 只会填 spawn/extension(永远有空位)，
   *  能量在“采→填extension→孵化→再采”小循环里空转，storage 永远 0、升不动 RCL5→6。
   *  只在【spawn/extension 都填满】且【能量源有富余】时才开，保证不抢孵化命脉。 */
  _collectStore(room, tasks) {
    const storage = room.storage;
    if (!storage || storage.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) return;
    // 闸门（修订 2026-06-30）：spawn 必须满 + extension 填充率 ≥ 90% 才屯仓。
    //   原逻辑“任一 extension 差 1 点就不屯仓”太挑剔：22 个 extension 总有一两个在被
      //   消耗的瞬间没满 → store 任务长期不生成 → storage 永远積不起来。
      //   改为“绝大部分孵化位已满”即放行屯仓，既保孵化命脉又让富余能量持续进 storage。
    const spawns = room.find(FIND_MY_STRUCTURES, { filter: (s) => s.structureType === STRUCTURE_SPAWN });
    const spawnHungry = spawns.some((s) => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
    if (spawnHungry) return; // spawn 未满绝对优先填 spawn，不屯仓
    const exts = room.find(FIND_MY_STRUCTURES, { filter: (s) => s.structureType === STRUCTURE_EXTENSION });
    if (exts.length > 0) {
      let full = 0;
      for (const e of exts) if (e.store.getFreeCapacity(RESOURCE_ENERGY) === 0) full++;
      // ★ 配时旋钮：门槛由基因 storeExtFull 决定（不再写死 0.9）。
      const _g = (Memory.brain && Memory.brain.genome && Memory.brain.genome.genes) || {};
      const extFullGate = (typeof _g.storeExtFull === 'number' && isFinite(_g.storeExtFull)) ? _g.storeExtFull : 0.9;
      if (full / exts.length < extFullGate) return; // extension 填充率未达门槛 → 先保孵化位
    }
    // 能量源富余：container 有货或地上有散料才值得派人屯。
    let supply = 0;
    room.find(FIND_STRUCTURES, { filter: (s) => s.structureType === STRUCTURE_CONTAINER })
      .forEach((c) => { supply += c.store[RESOURCE_ENERGY] || 0; });
    room.find(FIND_DROPPED_RESOURCES, { filter: (r) => r.resourceType === RESOURCE_ENERGY })
      .forEach((r) => { supply += r.amount; });
    if (supply < 100) return; // 源头没货，不生成屯仓任务
    tasks.push({
      id: `store:${storage.id}`,
      type: 'store',
      targetId: storage.id,
      pos: { x: storage.pos.x, y: storage.pos.y, roomName: room.name },
      baseValue: 55, // 低于 fill(95)/upgrade，高于空闲；只在孵化满足后吸走过剩能量
      capacity: Math.min(4, Math.max(1, Math.ceil(supply / 1000))),
      meta: {},
    });
  },

  /** RCL6 terminal 交易燃料任务：terminal 内有可售资源却没有能量时，市场层永远无法成交。
   *  这里把“补足 terminal 能量储备”表达成普通市场任务，不写死某个 creep/role。
   *  只从 storage 有余量时补，避免抽干新殖民地；目标储备可由 Memory.econ.terminalEnergyReserve 调整。 */
  _collectTerminalFuel(room, tasks) {
    const terminal = room.terminal;
    const storage = room.storage;
    if (!terminal || !storage) return;
    const econ = Memory.econ || {};
    const reserve = Math.max(1000, econ.terminalEnergyReserve || 20000);
    const current = terminal.store[RESOURCE_ENERGY] || 0;
    if (current >= reserve) return;
    const storageEnergy = storage.store[RESOURCE_ENERGY] || 0;
    // 保住房间自用底仓；可由 Memory.econ.storageFuelFloor 调整。
    const storageFloor = Math.max(0, econ.storageFuelFloor || 10000);
    if (storageEnergy <= storageFloor) return;
    // 只有 terminal 里真有非能量资源，或显式要求预热时才补交易燃料。
    let hasCargo = !!econ.prefuelTerminal;
    if (!hasCargo) {
      for (const res in terminal.store) {
        if (res !== RESOURCE_ENERGY && terminal.store[res] > 0) { hasCargo = true; break; }
      }
    }
    if (!hasCargo) return;
    const need = Math.min(reserve - current, storageEnergy - storageFloor);
    if (need <= 0) return;
    tasks.push({
      id: `terminalFuel:${terminal.id}`,
      type: 'terminalFuel',
      targetId: terminal.id,
      pos: { x: terminal.pos.x, y: terminal.pos.y, roomName: room.name },
      baseValue: current < 1000 ? 88 : 62,
      capacity: Math.min(2, Math.max(1, Math.ceil(need / 1000))),
      meta: { need, reserve, sourceId: storage.id },
    });
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
      let importance = {
        [STRUCTURE_SPAWN]: 90, [STRUCTURE_EXTENSION]: 70, [STRUCTURE_TOWER]: 75,
        [STRUCTURE_CONTAINER]: 65, [STRUCTURE_STORAGE]: 80, [STRUCTURE_LINK]: 82, [STRUCTURE_ROAD]: 35,
      }[site.structureType] || 45;
      // ⭐ 2026-07-01 keystone link: storage/controller 旁的 link 是能量物流效率总开关
      //   (source→storage/controller 瞬移)。但 fill(95) 因 30 ext 总有一个不满而永远存在,
      //   build(82) 永远抢不过 → 工地卡死(线上实测 storage link 卡 4786/5000 数十 tick)。
      //   故 keystone link 提到 96(刚超 fill) 让它一次性插队建成; 建成后无此工地, 恢复常态。
      //   source link 保持 82(不扰孵化 spawn fill)。
      if (site.structureType === STRUCTURE_LINK) {
        const nearStorage = room.storage && site.pos.inRangeTo(room.storage, 2);
        const nearCtrl = room.controller && site.pos.inRangeTo(room.controller, 2);
        if (nearStorage || nearCtrl) importance = 96;
      }
      tasks.push({
        id: `build:${site.id}`,
        type: 'build',
        targetId: site.id,
        pos: { x: site.pos.x, y: site.pos.y, roomName: room.name },
        baseValue: importance,
        // 并发看“剩余工程量”而不是总造价；且单工地最多 3 人，防止 RCL6 的
        // terminal(100k)+3 labs(50k each)虚构出 50 个 builder 槽并诱发人口爆炸。
        capacity: Math.min(3, Math.max(1, Math.ceil((site.progressTotal - site.progress) / 20000))),
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
    // ★ 修复 2026-06-30【Repairer 军队挤压升级】：有 tower 时，轻微衰减交给 tower 自动修，
    //   只给 worker 生成「严重受损(超 repairWorkerThresh)」的 repair 任务。这从源头削掉
    //   虚高的 repair 缺口(原本每个衰减的路/container 都生任务 → gap 2000+ 霸占 topType)。
    //   阈值由基因 repairWorkerThresh 决定(不写死)。无 tower 时不门控(原逻辑)。
    const _gr = (Memory.brain && Memory.brain.genome && Memory.brain.genome.genes) || {};
    const repThresh = (typeof _gr.repairWorkerThresh === 'number' && isFinite(_gr.repairWorkerThresh)) ? _gr.repairWorkerThresh : 0.5;
    const hasTower = room.find(FIND_MY_STRUCTURES, { filter: (s) => s.structureType === STRUCTURE_TOWER }).length > 0;
    for (const s of damaged) {
      const dmgRatio = 1 - s.hits / s.hitsMax;
      // 有 tower 且受损未超阈 → 交给 tower，不给 worker 生任务(避免 Repairer 军队)
      if (hasTower && dmgRatio < repThresh) continue;
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

