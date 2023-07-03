/*
 * Module code goes here. Use 'module.exports' to export things:
 * module.exports.thing = 'a thing';
 *
 * You can import it from another modules like this:
 * var mod = require('role.upgrader');
 * mod.thing == 'a thing'; // true
 */

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
      const sources = creep.room.find(FIND_SOURCES_ACTIVE);
      if (sources.length > 0) {
        const harvestResult = creep.harvest(sources[0]);
        if (harvestResult === ERR_NOT_IN_RANGE) {
          creep.moveTo(sources[0], { visualizePathStyle: { stroke: '#ffaa00' } });
        } else if (harvestResult !== OK) {
          console.log(`Failed to harvest energy: ${harvestResult}`);
        }
      }
    }
  },
};






