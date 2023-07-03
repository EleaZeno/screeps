var roleHarvester = require('roleHarvester');
var roleUpgrader = require('roleUpgrader');
var roleBuilder = require('roleBuilder');
var spawner = require('spawner');
var pathFinder = require('pathFinder');
var memoryUtils = require('memoryUtils');

// 分组函数：根据目标将 Creep 分组
function groupCreepsByTarget(creeps) {
  var groups = {};
  for (var name in creeps) {
    var creep = creeps[name];
    var target = creep.memory.target;
    if (!groups[target]) {
      groups[target] = [];
    }
    groups[target].push(creep);
  }
  return groups;
}

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
    var groupedCreeps = groupCreepsByTarget(allCreeps);

    for (var target in groupedCreeps) {
      var targetCreeps = groupedCreeps[target];
      var targetObject = Game.getObjectById(target);

      if (targetObject) {
        for (var i = 0; i < targetCreeps.length; i++) {
          var creep = targetCreeps[i];
          var currentPos = creep.pos;
          var targetPos = targetObject.pos;
          var path = currentPos.findPathTo(targetPos);
          creep.memory.path = path;
        }
      }
    }

    lastPathFindingTick = Game.time;
  }
};
