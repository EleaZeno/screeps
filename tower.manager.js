'use strict';

/*
 * tower.manager.js — Tower 自动防御 + 修理
 * ------------------------------------------------------------------
 * 优先级：打敌人 > 治疗友军 > 修理快坏的建筑（非墙）
 * 几乎不耗 CPU，常开。
 */
module.exports = {
  run(room) {
    const towers = room.find(FIND_MY_STRUCTURES, { filter: (s) => s.structureType === STRUCTURE_TOWER });
    if (!towers.length) return;

    const hostiles = room.find(FIND_HOSTILE_CREEPS);
    for (const tower of towers) {
      // 1. 优先攻击最近的敌人
      if (hostiles.length) {
        const target = tower.pos.findClosestByRange(hostiles);
        tower.attack(target);
        continue;
      }
      // 2. 治疗受伤友军
      const hurt = tower.pos.findClosestByRange(FIND_MY_CREEPS, { filter: (c) => c.hits < c.hitsMax });
      if (hurt) { tower.heal(hurt); continue; }
      // 3. 能量充足时修理快坏的建筑（>50% 能量才修，留余量防御）
      if (tower.store[RESOURCE_ENERGY] > tower.store.getCapacity(RESOURCE_ENERGY) * 0.5) {
        const damaged = tower.pos.findClosestByRange(FIND_STRUCTURES, {
          filter: (s) =>
            s.hits < s.hitsMax &&
            s.structureType !== STRUCTURE_WALL &&
            s.structureType !== STRUCTURE_RAMPART,
        });
        if (damaged) tower.repair(damaged);
      }
    }
  },
};
