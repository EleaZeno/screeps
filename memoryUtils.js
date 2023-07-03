/*
 * Module code goes here. Use 'module.exports' to export things:
 * module.exports.thing = 'a thing';
 *
 * You can import it from another modules like this:
 * var mod = require('memoryUtils');
 * mod.thing == 'a thing'; // true
 */

var pathCache = new Map(); // 路径缓存对象

module.exports = {
  cleanUpMemory: function () {
    // 每100个游戏 Tick 进行一次内存清理
    if (Game.time - Memory.lastMemoryCleanupTick >= 100) {
      for (var name in Memory.creeps) {
        // 删除已经不存在的 creep 的内存
        if (!Game.creeps[name]) {
          delete Memory.creeps[name];
          console.log('Clearing non-existing creep memory:', name);
        }
      }
      Memory.lastMemoryCleanupTick = Game.time;
    }
  },

  getHarvesters: function () {
    var creepNames = Object.keys(Game.creeps);
    return creepNames.map((name) => Game.creeps[name]).filter((creep) => creep.memory.role === 'harvester');
  },

  getUpgraders: function () {
    var creepNames = Object.keys(Game.creeps);
    return creepNames.map((name) => Game.creeps[name]).filter((creep) => creep.memory.role === 'upgrader');
  },

  getBuilders: function () {
    var creepNames = Object.keys(Game.creeps);
    return creepNames.map((name) => Game.creeps[name]).filter((creep) => creep.memory.role === 'builder');
  },

  updatePathCache: function (tick, paths) {
    // 更新路径缓存
    pathCache.set(tick, paths);
  },

  getCachedPaths: function (tick) {
    // 获取缓存的路径
    return pathCache.get(tick);
  },

  clearPathCache: function () {
    // 清空路径缓存
    pathCache.clear();
  }
};

