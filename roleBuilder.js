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
    if (creep.memory.building && creep.store[RESOURCE_ENERGY] == 0) {
      creep.memory.building = false;
      creep.say('🔄 harvest');
    }
    if (!creep.memory.building && creep.store.getFreeCapacity() == 0) {
      creep.memory.building = true;
      creep.say('🚧 build');
    }

    if (creep.memory.building) {
      var target = creep.pos.findClosestByPath(FIND_MY_CONSTRUCTION_SITES);
      if (target) {
        if (creep.build(target) == ERR_NOT_IN_RANGE) {
          creep.moveTo(target, { visualizePathStyle: { stroke: '#0000ff' } });
        }
      }
    } else {
      var target = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: (structure) => {
          return (
            structure.structureType == STRUCTURE_EXTENSION &&
            structure.store.getUsedCapacity(RESOURCE_ENERGY) > 0
          );
        },
      });
      if (target) {
        if (creep.withdraw(target, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
          creep.moveTo(target);
        }
      } else {
        var sources = creep.room.find(FIND_SOURCES);
        if (creep.harvest(sources[0]) == ERR_NOT_IN_RANGE) {
          creep.moveTo(sources[0], { visualizePathStyle: { stroke: '#ffaa00' } });
        }
      }
    }
  },
};
