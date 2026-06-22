'use strict';

/*
 * role.defender.js — 防御 creep（有敌入侵时自动孵化）
 * ------------------------------------------------------------------
 * 近战 ATTACK，冲向房间内最近的敌人。tower 的补充火力。
 */
const utils = require('utils');

module.exports = {
  run(creep) {
    const hostile = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
    if (hostile) {
      if (creep.attack(hostile) === ERR_NOT_IN_RANGE) {
        utils.moveTo(creep, hostile, '#ff0000');
      }
    } else {
      // 没敌人就回 spawn 附近待命
      const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
      if (spawn && !creep.pos.inRangeTo(spawn, 3)) utils.moveTo(creep, spawn, '#ffffff');
    }
  },
};
