/*
 * Module code goes here. Use 'module.exports' to export things:
 * module.exports.thing = 'a thing';
 *
 * You can import it from another modules like this:
 * var mod = require('bayesianLogic');
 * mod.thing == 'a thing'; // true
 */
var bayesianStatistics = require('bayesianStatistics');

var bayesianLogic = {
  selectEnergySource: function(creep) {
    var energySources = creep.room.find(FIND_SOURCES);

    var bestEnergySource = null;
    var bestEnergySourceScore = -Infinity;

    energySources.map(function(energySource) {
      var score = calculateEnergySourceScore(creep, energySource);

      if (score > bestEnergySourceScore) {
        bestEnergySource = energySource;
        bestEnergySourceScore = score;
      }
    });

    if (bestEnergySource) {
      bayesianStatistics.updateEnergySourceScore(bestEnergySource.id, bestEnergySourceScore, creep.memory.role);
    }

    return bestEnergySource;
  }
};

function calculateEnergySourceScore(creep, energySource) {
  if (!energySource) {
    return -Infinity; // 如果能量源不存在，返回一个较低的分数
  }

  // 根据你的需求计算能量源的分数
  // 考虑距离、能量剩余量、Creep 数目和障碍物数量等因素

  var distanceWeight = 0.5; // 距离权重
  var energyWeight = 0.3; // 能量剩余量权重
  var creepCountWeight = 0.1; // Creep 数目权重
  var assignedCreepCountWeight = 0.1; // 已分配 Creep 数目权重

  var distance = creep.pos.getRangeTo(energySource);
  var energyAvailable = energySource.energy;
  var creepCount = energySource.pos.findInRange(FIND_MY_CREEPS, 1).length;
  var assignedCreepCount = _.filter(Game.creeps, (c) => c.memory.energySourceId === energySource.id).length;
  var obstacleCount = energySource.pos.findInRange(FIND_STRUCTURES, 1, {
    filter: (structure) => {
      return structure.structureType === STRUCTURE_ROAD || structure.structureType === STRUCTURE_CONTAINER;
    }
  }).length;

  // 根据 Creep 数目调整分数
  var creepCountFactor = 1 - (creepCount * creepCountWeight);
  // 根据已分配 Creep 数目调整分数
  var assignedCreepCountFactor = 1 - (assignedCreepCount * assignedCreepCountWeight);

  var score = distanceWeight * (10 - distance) +
              energyWeight * energyAvailable -
              obstacleCount +
              creepCountFactor +
              assignedCreepCountFactor; // 加权计算分数

  return score;
}

module.exports = bayesianLogic;