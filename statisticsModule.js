/*
 * Module code goes here. Use 'module.exports' to export things:
 * module.exports.thing = 'a thing';
 *
 * You can import it from another modules like this:
 * var mod = require('statisticsModule');
 * mod.thing == 'a thing'; // true
 */
// 获取存储在内存中的能量获取量
var energyGained = Memory.statistics && Memory.statistics.energyGained || 0;

var statisticsModule = {
  updateStatistics: function() {
  // 获取存储在内存中的能量获取量
  var energyGained = Memory.statistics && Memory.statistics.energyGained || 0;

  // 获取房间对象
  var room = Game.rooms['E15S38'];

  // 获取当前能量总量
  var energyTotal = room.energyAvailable;

  // 计算当前能量获取量
  var energyGainedThisTick = energyTotal - energyGained;

  // 更新存储在内存中的能量获取量
  Memory.statistics = Memory.statistics || {};
  Memory.statistics.energyGained = energyTotal;

  // 返回本次统计的能量获取量
  return energyGainedThisTick;
}

};

module.exports = statisticsModule;




