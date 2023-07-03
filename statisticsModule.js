/*
 * Module code goes here. Use 'module.exports' to export things:
 * module.exports.thing = 'a thing';
 *
 * You can import it from another modules like this:
 * var mod = require('statisticsModule');
 * mod.thing == 'a thing'; // true
 */
// 获取存储在内存中的能量获取量
var statisticsModule = {
  updateStatistics: function() {
    var energyGained = Memory.statistics.energyGained || 0; // 获取存储在内存中的能量获取量
    var energyTotal = Game.spawns['Spawn1'].room.energyAvailable; // 获取当前能量总量

    var energyGainedThisTick = energyTotal - energyGained; // 计算当前能量获取量

    Memory.statistics.energyGained = energyTotal; // 更新存储在内存中的能量获取量

    var currentTick = Game.time;
    if (currentTick % 3 === 0) {
      var timestamp = getTimestamp(); // 获取当前北京时间的时间戳（24小时制）
      if (!Memory.statistics.energyGrowthThreeTick) {
        Memory.statistics.energyGrowthThreeTick = {};
      }
      Memory.statistics.energyGrowthThreeTick[timestamp] = energyGainedThisTick;

      if (!Memory.statistics.controllerEfficiency) {
        Memory.statistics.controllerEfficiency = {};
      }
      Memory.statistics.controllerEfficiency[timestamp] = calculateControllerEfficiency();

      // 保留最近 500 个时间段的统计
      var growthKeys = Object.keys(Memory.statistics.energyGrowthThreeTick);
      if (growthKeys.length > 500) {
        var oldestTimestamp = growthKeys[0];
        delete Memory.statistics.energyGrowthThreeTick[oldestTimestamp];
        delete Memory.statistics.controllerEfficiency[oldestTimestamp];
      }
    }

    return energyGainedThisTick; // 返回本次统计的能量获取量
  }
};

function getTimestamp() {
  var date = new Date();
  var year = date.getUTCFullYear();
  var month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  var day = date.getUTCDate().toString().padStart(2, '0');
  var hours = date.getUTCHours().toString().padStart(2, '0');
  var minutes = date.getUTCMinutes().toString().padStart(2, '0');
  var seconds = date.getUTCSeconds().toString().padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function calculateControllerEfficiency() {
  var controller = Game.spawns['Spawn1'].room.controller; // 获取房间控制器对象
  var progress = controller.progress; // 获取当前控制器进度
  var progressTotal = controller.progressTotal; // 获取控制器升级所需总进度

  var efficiency = (progress / progressTotal) * 100; // 计算控制器能量获取速度的百分比表示

  return efficiency;
}

module.exports = statisticsModule;







