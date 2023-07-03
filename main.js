// main.js
var roleHarvester = require('roleHarvester');
var roleUpgrader = require('roleUpgrader');
var roleBuilder = require('roleBuilder');
var spawner = require('spawner');
var pathFinder = require('pathFinder');
var memoryUtils = require('memoryUtils');

module.exports.loop = function () {
  // 内存清理
  var lastMemoryCleanupTick = 0; // 上次内存清理的 Tick
  if (Game.time - lastMemoryCleanupTick >= 100) {
    memoryUtils.cleanUpMemory();
    lastMemoryCleanupTick = Game.time;
  }

  // 获取筛选后的角色数组
  var harvesters = memoryUtils.getHarvesters();
  var upgraders = memoryUtils.getUpgraders();
  var builders = memoryUtils.getBuilders();

  // 角色执行逻辑
  for (var name in harvesters) {
    roleHarvester.run(harvesters[name]);
  }

  for (var name in upgraders) {
    roleUpgrader.run(upgraders[name]);
  }

  for (var name in builders) {
    roleBuilder.run(builders[name]);
  }

  // 生成新的 creep
  var lastSpawningTextUpdateTick = 0; // 上次生成提示更新的 Tick
  if (Game.time - lastSpawningTextUpdateTick >= 5) {
    spawner.spawnCreeps();
    lastSpawningTextUpdateTick = Game.time;
  }

  // 路径计算函数
  var lastPathFindingTick = 0; // 上次路径计算的 Tick
  var pathFindingInterval = 10; // 路径计算的间隔
  if (Game.time - lastPathFindingTick >= pathFindingInterval) {
    var allCreeps = Object.values(Game.creeps);
    var cachedPaths = memoryUtils.getCachedPaths(Game.time);

    if (cachedPaths) {
      pathFinder.applyCachedPaths(allCreeps, cachedPaths);
    } else {
      var paths = pathFinder.calculatePaths(allCreeps, lastPathFindingTick, pathFindingInterval);
      memoryUtils.updatePathCache(Game.time, paths);
    }

    lastPathFindingTick = Game.time;
  }
};
