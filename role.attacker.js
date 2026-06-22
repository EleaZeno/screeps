'use strict';

/*
 * role.attacker.js — 进攻 creep（默认不孵化，由 config.military.attack 控制）
 * ------------------------------------------------------------------
 * 跨房间去打 targetRoom：移动到目标房间 → 优先拆 spawn/打 creep。
 * 支持近战(melee)和远程(ranged)，由身体部件决定行为。
 */
const utils = require('utils');

module.exports = {
  run(creep) {
    const targetRoom = creep.memory.targetRoom;

    // 1. 不在目标房间 → 先走过去
    if (targetRoom && creep.room.name !== targetRoom) {
      const exitDir = creep.room.findExitTo(targetRoom);
      const exit = creep.pos.findClosestByRange(exitDir);
      if (exit) utils.moveTo(creep, exit, '#ff0000');
      return;
    }

    const hasRanged = creep.body.some((p) => p.type === RANGED_ATTACK);

    // 2. 在目标房间：找目标，优先敌人 creep，再拆 spawn/建筑
    let target = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
    if (!target) {
      target = creep.pos.findClosestByRange(FIND_HOSTILE_SPAWNS);
    }
    if (!target) {
      target = creep.pos.findClosestByRange(FIND_HOSTILE_STRUCTURES);
    }

    if (target) {
      if (hasRanged) {
        const range = creep.pos.getRangeTo(target);
        if (range <= 3) creep.rangedAttack(target);
        if (range > 1) utils.moveTo(creep, target, '#ff0000');
      } else {
        if (creep.attack(target) === ERR_NOT_IN_RANGE) utils.moveTo(creep, target, '#ff0000');
      }
    }
    // 没目标 = 房间清空了，原地待命
  },
};
