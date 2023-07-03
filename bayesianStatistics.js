/*
 * Module code goes here. Use 'module.exports' to export things:
 * module.exports.thing = 'a thing';
 *
 * You can import it from another modules like this:
 * var mod = require('bayesianStatistics');
 * mod.thing == 'a thing'; // true
 */

var bayesianStatistics = {
  updateEnergySourceScore: function(energySourceId, score) {
    if (!Memory.energySources) {
      Memory.energySources = {};
    }

    // 检查能量源是否存在于内存中，如果不存在则创建
    if (!Memory.energySources[energySourceId]) {
      Memory.energySources[energySourceId] = {
        score: 0
      };
    }

    // 更新能量源的判断值
    Memory.energySources[energySourceId].score += score;
  }
};

module.exports = bayesianStatistics;



