/*
 * Module code goes here. Use 'module.exports' to export things:
 * module.exports.thing = 'a thing';
 *
 * You can import it from another modules like this:
 * var mod = require('roleHarvester');
 * mod.thing == 'a thing'; // true
 */

var bayesianLogic = require('bayesianLogic');

module.exports = {
  run: function (creep) {
    if (creep.store.getFreeCapacity() > 0) {
      // 背包未满，进行采矿
      var bestEnergySource = bayesianLogic.selectEnergySource(creep);
      if (bestEnergySource) {
        const harvestResult = creep.harvest(bestEnergySource);
        if (harvestResult === ERR_NOT_IN_RANGE) {
          creep.moveTo(bestEnergySource, { visualizePathStyle: { stroke: '#ffaa00' } });
        } else if (harvestResult !== OK) {
          console.log(`Failed to harvest energy: ${harvestResult}`);
        }
      }
    } else {
      // 背包已满，进行能量传输
      const targets = creep.room.find(FIND_MY_STRUCTURES, {
        filter: (structure) => {
          return (
            (structure.structureType === STRUCTURE_EXTENSION ||
              structure.structureType === STRUCTURE_SPAWN ||
              structure.structureType === STRUCTURE_TOWER) &&
            structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0
          );
        },
      });
      if (targets.length > 0) {
        const transferResult = creep.transfer(targets[0], RESOURCE_ENERGY);
        if (transferResult === ERR_NOT_IN_RANGE) {
          creep.moveTo(targets[0], { visualizePathStyle: { stroke: '#ffffff' } });
        } else if (transferResult !== OK) {
          console.log(`Failed to transfer energy: ${transferResult}`);
        }
      }
    }
  },
};

