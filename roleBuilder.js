/*
 * Module code goes here. Use 'module.exports' to export things:
 * module.exports.thing = 'a thing';
 *
 * You can import it from another modules like this:
 * var mod = require('roleBuilder');
 * mod.thing == 'a thing'; // true
 */
module.exports = {
  run: function (creep) {
    if (creep.memory.building && creep.store[RESOURCE_ENERGY] === 0) {
      creep.memory.building = false;
      creep.say('🔄 harvest');
    }
    if (!creep.memory.building && creep.store.getFreeCapacity() === 0) {
      creep.memory.building = true;
      creep.say('🚧 build');
    }

    if (creep.memory.building) {
      const targets = creep.room.find(FIND_MY_CONSTRUCTION_SITES);
      if (targets.length > 0) {
        const buildResult = creep.build(targets[0]);
        if (buildResult === ERR_NOT_IN_RANGE) {
          creep.moveTo(targets[0], { visualizePathStyle: { stroke: '#0000ff' } });
        } else if (buildResult !== OK) {
          console.log(`Failed to build construction site: ${buildResult}`);
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

