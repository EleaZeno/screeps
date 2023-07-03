/*
 * Module code goes here. Use 'module.exports' to export things:
 * module.exports.thing = 'a thing';
 *
 * You can import it from another modules like this:
 * var mod = require('bayesianLogic');
 * mod.thing == 'a thing'; // true
 */

var bayesianLogic = {
  selectEnergySource: function(creep) {
    var energySources = creep.room.find(FIND_SOURCES);
    // 使用贝叶斯逻辑选择最佳能量源
    var bestEnergySource = null;
    var bestEnergySourceScore = -Infinity;

    for (var i = 0; i < energySources.length; i++) {
    var energySource = energySources[i];

    // 计算能量源的分数，根据你的需求进行定义
    var score = calculateEnergySourceScore(creep, energySource);

    // 更新最佳能量源
    if (score > bestEnergySourceScore) {
    bestEnergySource = energySource;
    bestEnergySourceScore = score;
  }
}

    // 存储评估分数到全局内存对象
    if (!Memory.bayesianScores) {
    Memory.bayesianScores = {};
    }
    if (!Memory.bayesianScores.energySources) {
    Memory.bayesianScores.energySources = {};
    }
    Memory.bayesianScores.energySources[bestEnergySource.id] = bestEnergySourceScore;

    return bestEnergySource;

  }
};

function calculateEnergySourceScore(creep, energySource) {
  if (!energySource) {
    return -Infinity; // 如果能量源不存在，返回一个较低的分数
  }

  // 根据你的需求计算能量源的分数
  // 可以考虑距离、能量剩余量等因素

  // 示例：根据距离计算分数，距离越近，分数越高
  var distance = creep.pos.getRangeTo(energySource);
  var score = -distance; // 取负数以便最远的能量源分数最低

  return score;
}


module.exports = bayesianLogic;

