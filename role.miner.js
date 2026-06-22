'use strict';

/*
 * role.miner.js — 静态采矿者（急速发育核心）
 * ------------------------------------------------------------------
 * 钉在 source 旁的 container 上，只采矿不动，能量直接掉进 container。
 * 一个满身 WORK 的 miner 可榨干一个 source（5 WORK = 10 energy/tick = source 上限）。
 * hauler 负责把 container 的能量搬走。
 * 【关键修复 2026-06-23】原地采矿改用 utils.work()，采到能量即清零卡死计数 _stk，
 * 杜绝“站在 container 上静止采矿（不走 moveTo）→ _stk 永不重置 → 累加到阈值被
 * guardian 误判焊死 suicide”的致命 bug。
 */
const sourceManager = require('source.manager');
const utils = require('utils');

module.exports = {
  run(creep) {
    // 绑定 source（每 source 专属 1 miner）
    if (!creep.memory.sourceId) sourceManager.assignSourceForMiner(creep);
    const source = creep.memory.sourceId ? Game.getObjectById(creep.memory.sourceId) : null;
    if (!source) return;

    // 找 source 旁的 container，站上去采（能量自动掉进 container）
    const container = source.pos.findInRange(FIND_STRUCTURES, 1, {
      filter: (s) => s.structureType === STRUCTURE_CONTAINER,
    })[0];

    if (container) {
      if (!creep.pos.isEqualTo(container.pos)) {
        utils.moveTo(creep, container, '#ffaa00');
      } else {
        utils.work(creep, 'harvest', source); // 站定采矿，清零卡死计数防误杀
      }
    } else {
      // 还没 container：就近采，能量先掉地上（hauler 会来捡）
      if (utils.work(creep, 'harvest', source) === ERR_NOT_IN_RANGE) {
        utils.moveTo(creep, source, '#ffaa00');
      }
    }
  },
};
