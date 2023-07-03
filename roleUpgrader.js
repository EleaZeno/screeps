/*
 * Module code goes here. Use 'module.exports' to export things:
 * module.exports.thing = 'a thing';
 *
 * You can import it from another modules like this:
 * var mod = require('roleUpgrader');
 * mod.thing == 'a thing'; // true
 */

var bayesianLogic = require('bayesianLogic');

module.exports = {
  run: function (creep) {
    if (creep.memory.upgrading && creep.store[RESOURCE_ENERGY] === 0) {
      creep.memory.upgrading = false;
      creep.say('🔄 harvest');
    }
    if (!creep.memory.upgrading && creep.store.getFreeCapacity() === 0) {
      creep.memory.upgrading = true;
      creep.say('⚡ upgrade');
    }

    if (creep.memory.upgrading) {
      const controller = creep.room.controller;
      if (controller) {
        const upgradeResult = creep.upgradeController(controller);
        if (upgradeResult === ERR_NOT_IN_RANGE) {
          creep.moveTo(controller, { visualizePathStyle: { stroke: '#ffffff' } });
        } else if (upgradeResult !== OK) {
          console.log(`Failed to upgrade controller: ${upgradeResult}`);
        }
      }
    } else {
      var bestEnergySource = bayesianLogic.selectEnergySource(creep);
      if (bestEnergySource) {
        const harvestResult = creep.harvest(bestEnergySource);
        if (harvestResult === ERR_NOT_IN_RANGE) {
          creep.moveTo(bestEnergySource, { visualizePathStyle: { stroke: '#ffaa00' } });
        } else if (harvestResult !== OK) {
          console.log(`Failed to harvest energy: ${harvestResult}`);
        }
      }
    }
  },
};





