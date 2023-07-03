/*
 * Module code goes here. Use 'module.exports' to export things:
 * module.exports.thing = 'a thing';
 *
 * You can import it from another modules like this:
 * var mod = require('memoryUtils');
 * mod.thing == 'a thing'; // true
 */

module.exports = {
  cleanUpMemory: function () {
    if (Game.time - Memory.lastMemoryCleanupTick >= 100) {
      for (var name in Memory.creeps) {
        if (!Game.creeps[name]) {
          delete Memory.creeps[name];
          console.log('Clearing non-existing creep memory:', name);
        }
      }
      Memory.lastMemoryCleanupTick = Game.time;
    }
  },
  
  getHarvesters: function () {
    var allCreeps = Object.values(Game.creeps);
    return allCreeps.filter((creep) => creep.memory.role === 'harvester');
  },
  
  getUpgraders: function () {
    var allCreeps = Object.values(Game.creeps);
    return allCreeps.filter((creep) => creep.memory.role === 'upgrader');
  },
  
  getBuilders: function () {
    var allCreeps = Object.values(Game.creeps);
    return allCreeps.filter((creep) => creep.memory.role === 'builder');
  }
};
