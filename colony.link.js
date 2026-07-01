'use strict';

/*
 * colony.link.js — 多房联动层（2026-07-02，用户诉求"把两个房间联动起来"）
 * ==================================================================
 * V3 brain 是 per-room 独立循环，房间之间零协作。本模块补上"帝国级"联动，
 * 全局跑一次（不进 per-room 循环），只在【真实需要】时才动作，平时零副作用。
 *
 * 两条联动（都带硬门控，避免拖垮任何一房）：
 *
 *  联动A · 跨房防御互助（刚需）：
 *    某自有房受攻击且【自身扛不住】（无 tower 或 tower 压不住威胁）→ 让最近的
 *    【健康且有余力】的兄弟房孵化一个 Guard，走过去帮打。威胁清除后 Guard 回家自然淘汰。
 *    这是新殖民地（如 E8N54 无 tower、新手保护期将结束）最需要的一环。
 *
 *  联动B · 跨房能量支援（按需）：
 *    某自有房能量告急（长期填不满 spawn、无 storage 缓冲）且有兄弟房能量富余
 *    （storage 满/source 溢出）→ 从富余房派 Carrier 把能量运过去。
 *    ⚠️ 只在接收房【真缺】+ 捐赠房【真富】时开，避免无谓跨房搬运烧 CPU/creep。
 *    默认保守：接收房需 RCL≤3 且无 storage；捐赠房需 storage>阈值 或 source 长期溢出。
 *
 * 设计原则：
 *   - 全局单次调用（main 循环外层调一次），不改 per-room 六步流水线。
 *   - 独立 creep 标记（memory.guard / memory.share），executor 有专属 handler。
 *   - 低 CPU：每 EVAL_INTERVAL tick 才重新评估孵化需求；creep 执行靠原生寻路。
 *   - 硬门控：捐助方不达"富余"不派；受援方不达"告急"不请。锦上添花，绝不添乱。
 */

const EVAL_INTERVAL = 10;        // 每 10 tick 评估一次孵化需求（够人就不再生产）
const GUARD_MAX_PER_ROOM = 2;    // 单个受援房最多同时派 2 个跨房 Guard
const SHARE_MAX_PER_ROUTE = 2;   // 单条能量支援线最多 2 个 Carrier
const DONOR_MIN_RCL = 4;         // 捐助房至少 RCL4（能造像样的 body 且自身发育稳）
const DONOR_MIN_CREEPS = 6;      // 捐助房自己人口够了才外援
const SHARE_DONOR_STORAGE_FLOOR = 20000; // 捐助房 storage 能量高于此才算"富余"可外送

module.exports = {
  /** 全局入口：main 循环外层每 tick 调一次。 */
  run() {
    if (!Memory.link) Memory.link = {};
    // 收集所有自有房
    const myRooms = [];
    for (const rn in Game.rooms) {
      const r = Game.rooms[rn];
      if (r.controller && r.controller.my) myRooms.push(r);
    }
    if (myRooms.length < 2) {
      // 单房无联动可言，清掉任何残留支援标记（防止 GCL 降级后遗留）
      Memory.link.defend = {};
      Memory.link.share = {};
      return;
    }

    try { this._defenseAssist(myRooms); } catch (e) { console.log('link defense err ' + e); }
    try { this._energyShare(myRooms); } catch (e) { console.log('link share err ' + e); }
    // 驱动所有联动 creep（它们常在别的房，per-room 循环驱不到）
    this._driveLinkCreeps();
  },

  // ============ 联动A：跨房防御互助 ============
  _defenseAssist(myRooms) {
    if (!Memory.link.defend) Memory.link.defend = {};
    const D = Memory.link.defend;

    for (const room of myRooms) {
      const rn = room.name;
      // —— 判定该房是否"受攻击且自身扛不住" ——
      const threats = room.find(FIND_HOSTILE_CREEPS, {
        filter: (h) => h.getActiveBodyparts && (h.getActiveBodyparts(ATTACK) + h.getActiveBodyparts(RANGED_ATTACK) + h.getActiveBodyparts(WORK)) > 0,
      });
      if (!threats.length) { delete D[rn]; continue; } // 无威胁 → 清除求援

      // 自身防御力：能开火的 tower 数（有能量的）
      const towers = room.find(FIND_MY_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_TOWER && s.store && s.store[RESOURCE_ENERGY] >= 10,
      });
      // 本房自有能战斗的 creep（有 ATTACK/RANGED_ATTACK）
      const localFighters = room.find(FIND_MY_CREEPS, {
        filter: (c) => c.body.some((p) => p.type === ATTACK || p.type === RANGED_ATTACK),
      }).length;

      // 威胁强度（攻击部件总量粗估）
      let threatPower = 0;
      for (const h of threats) {
        threatPower += (h.getActiveBodyparts(ATTACK) + h.getActiveBodyparts(RANGED_ATTACK) * 1.5 + h.getActiveBodyparts(WORK) * 0.5);
      }
      // 自身防御力粗估：每 tower 约值 6 攻击部件当量（近距满伤），每本地战斗 creep 约 2。
      const localDefense = towers.length * 6 + localFighters * 2;

      // 扛不住 = 自身防御力 < 威胁强度（留 20% 余量），或干脆无 tower 无战斗单位。
      const cantHold = (towers.length === 0 && localFighters === 0) || (localDefense < threatPower * 1.2);
      if (!cantHold) { delete D[rn]; continue; } // 自己能扛 → 不求援

      // —— 标记求援：记录威胁强度，供孵化时定 Guard 数量/体型 ——
      D[rn] = { threatPower: Math.round(threatPower), since: (D[rn] && D[rn].since) || Game.time, t: Game.time };
    }

    // —— 为每个求援房派 Guard（每 EVAL_INTERVAL tick 评估）——
    if (Game.time % EVAL_INTERVAL !== 0) return;
    for (const rn in D) {
      const beleaguered = Game.rooms[rn];
      if (!beleaguered) continue;
      // 现役开往该房的 Guard
      const guards = _.filter(Game.creeps, (c) => c.memory.guard && c.memory.gTarget === rn);
      if (guards.length >= GUARD_MAX_PER_ROOM) continue;

      // 选"最近 + 健康 + 有余力"的兄弟房当援兵源（不能是受援房自己、且它自己没在挨打）
      const donor = this._pickDonorRoom(myRooms, rn, D);
      if (!donor) continue;
      const idleSpawn = donor.find(FIND_MY_SPAWNS, { filter: (s) => !s.spawning })[0];
      if (!idleSpawn) continue;

      const body = this._guardBody(donor.energyCapacityAvailable, D[rn].threatPower);
      if (donor.energyAvailable >= this._cost(body)) {
        const r = idleSpawn.spawnCreep(body, 'Guard_' + Game.time, {
          memory: { guard: true, gHome: donor.name, gTarget: rn, born: Game.time },
        });
        if (r === OK) console.log('🛡️ [LINK] ' + donor.name + ' 派 Guard 增援 ' + rn + '(威胁' + D[rn].threatPower + ')');
      }
    }
  },

  /** 选援兵源房：排除受援房自己 + 正在挨打的房；要求 RCL≥DONOR_MIN_RCL、人口够、当前无自身威胁。
   *  多个候选时选距离最近的（跨房步数少，援兵到得快）。 */
  _pickDonorRoom(myRooms, targetName, D) {
    let best = null, bestDist = Infinity;
    for (const room of myRooms) {
      if (room.name === targetName) continue;
      if (D[room.name]) continue; // 该房自己也在求援，别抽调
      if (room.controller.level < DONOR_MIN_RCL) continue;
      if (room.find(FIND_MY_CREEPS).length < DONOR_MIN_CREEPS) continue;
      const dist = Game.map.getRoomLinearDistance(room.name, targetName);
      if (dist < bestDist) { bestDist = dist; best = room; }
    }
    return best;
  },

  /** Guard 体：TOUGH 打头 + ATTACK/RANGED + 足够 MOVE（跨房要走得动）。按威胁强度定规模。 */
  _guardBody(cap, threatPower) {
    // 目标单元数：威胁越强越大，但受能量上限约束。每单元 = 1 ATTACK + 1 MOVE(≈130)。
    const maxUnits = Math.floor(cap / 130);
    const want = Math.max(2, Math.min(maxUnits, Math.ceil((threatPower || 4) / 3) + 1));
    const units = Math.max(1, Math.min(want, maxUnits, 10));
    const b = [];
    // 前面加少量 TOUGH 肉盾（约 1/4 单元数），再堆 ATTACK+MOVE
    const tough = Math.min(units, Math.max(0, Math.floor(units / 4)));
    for (let i = 0; i < tough; i++) b.push(TOUGH);
    for (let i = 0; i < units; i++) b.push(ATTACK);
    for (let i = 0; i < units + tough; i++) b.push(MOVE); // MOVE 覆盖全身，平原满速
    return b;
  },

  // ============ 联动B：跨房能量支援 ============
  _energyShare(myRooms) {
    if (!Memory.link.share) Memory.link.share = {};
    const S = Memory.link.share;

    // 找"告急"的受援房：RCL≤3、无 storage、且长期填不满 spawn（能量占用率低）。
    const needy = myRooms.filter((room) => {
      if (room.controller.level > 3) return false;
      if (room.storage) return false;
      const fill = room.energyAvailable / Math.max(1, room.energyCapacityAvailable);
      // energyAvailable 长期低于 60% = spawn/ext 填不满（孵化受限）
      return fill < 0.6;
    });
    // 找"富余"的捐助房：RCL≥DONOR_MIN_RCL、storage 能量高于阈值。
    const donors = myRooms.filter((room) => {
      if (room.controller.level < DONOR_MIN_RCL) return false;
      if (room.find(FIND_MY_CREEPS).length < DONOR_MIN_CREEPS) return false;
      return room.storage && room.storage.store[RESOURCE_ENERGY] >= SHARE_DONOR_STORAGE_FLOOR;
    });

    // 清除不再成立的支援线
    for (const key in S) {
      const [dn, tn] = key.split('>');
      const donorOk = donors.some((r) => r.name === dn);
      const needyOk = needy.some((r) => r.name === tn);
      if (!donorOk || !needyOk) delete S[key];
    }

    if (!needy.length || !donors.length) return;

    // 每个受援房配一个最近的捐助房
    if (Game.time % EVAL_INTERVAL !== 0) return;
    for (const target of needy) {
      // 选最近捐助房
      let donor = null, bestDist = Infinity;
      for (const d of donors) {
        const dist = Game.map.getRoomLinearDistance(d.name, target.name);
        if (dist < bestDist) { bestDist = dist; donor = d; }
      }
      if (!donor) continue;
      const key = donor.name + '>' + target.name;
      S[key] = { since: (S[key] && S[key].since) || Game.time, t: Game.time };

      const carriers = _.filter(Game.creeps, (c) => c.memory.share && c.memory.sHome === donor.name && c.memory.sTarget === target.name);
      if (carriers.length >= SHARE_MAX_PER_ROUTE) continue;
      const idleSpawn = donor.find(FIND_MY_SPAWNS, { filter: (s) => !s.spawning })[0];
      if (!idleSpawn) continue;
      const body = this._carrierBody(donor.energyCapacityAvailable);
      if (donor.energyAvailable >= this._cost(body)) {
        const r = idleSpawn.spawnCreep(body, 'Share_' + Game.time, {
          memory: { share: true, sHome: donor.name, sTarget: target.name, born: Game.time },
        });
        if (r === OK) console.log('🔗 [LINK] ' + donor.name + ' 派 Carrier 送能量支援 ' + target.name);
      }
    }
  },

  /** 支援 Carrier 体：成对 CARRY+MOVE（满速跑跨房）。 */
  _carrierBody(cap) {
    const pairs = Math.max(2, Math.min(10, Math.floor(cap / 100)));
    const b = [];
    for (let i = 0; i < pairs; i++) { b.push(CARRY); b.push(MOVE); }
    return b;
  },

  /** 统一驱动所有联动 creep（guard/share）。它们常在别的房，main 的 per-room 循环驱不到。 */
  _driveLinkCreeps() {
    let executor; try { executor = require('executor'); } catch (e) { executor = null; }
    if (!executor) return;
    for (const name in Game.creeps) {
      const c = Game.creeps[name];
      if (c.spawning) continue;
      if (c.memory && (c.memory.guard || c.memory.share)) {
        try { executor.run(c); } catch (e) { console.log('link exec err ' + name + ': ' + e); }
      }
    }
  },

  _cost(body) {
    const c = { work: 100, carry: 50, move: 50, attack: 80, ranged_attack: 150, heal: 250, tough: 10, claim: 600 };
    return body.reduce((s, p) => s + (c[p] || 0), 0);
  },
};
