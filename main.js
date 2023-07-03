var roleHarvester = require('roleHarvester');
var roleUpgrader = require('roleUpgrader');
var roleBuilder = require('roleBuilder');
var spawner = require('spawner');
var pathFinder = require('pathFinder');
var memoryUtils = require('memoryUtils');
var bayesianLogic = require('bayesianLogic');

// 上次内存清理的 Tick
var lastMemoryCleanupTick = 0;

// 上次生成提示更新的 Tick
var lastSpawningTextUpdateTick = 0;

// 上次路径计算的 Tick
var lastPathFindingTick = 0;
var pathFindingInterval = 10; // 路径计算的间隔

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
  if (Game.time - lastMemoryCleanupTick >= 100) {
    memoryUtils.cleanUpMemory();
    lastMemoryCleanupTick = Game.time;
  }

  // 获取筛选后的角色数组
  var harvesters = memoryUtils.getHarvesters();
  var upgraders = memoryUtils.getUpgraders();
  var builders = memoryUtils.getBuilders();

  // 角色执行逻辑
  harvesters.forEach(function (harvester) {
    roleHarvester.run(harvester);
  });

  upgraders.forEach(function (upgrader) {
    roleUpgrader.run(upgrader);
  });

  builders.forEach(function (builder) {
    roleBuilder.run(builder);
  });

  // 生成新的 creep
  if (Game.time - lastSpawningTextUpdateTick >= 5) {
    spawner.spawnCreeps();
    lastSpawningTextUpdateTick = Game.time;
  }

  // 路径计算函数
  if (Game.time - lastPathFindingTick >= pathFindingInterval) {
    var allCreeps = Object.values(Game.creeps);
    var groupedCreeps = groupCreepsByTarget(allCreeps);

    for (var target in groupedCreeps) {
      var targetCreeps = groupedCreeps[target];
      var targetObject = Game.getObjectById(target);

      if (targetObject) {
        targetCreeps.forEach(function (creep) {
          var currentPos = creep.pos;
          var targetPos = targetObject.pos;
          var path = currentPos.findPathTo(targetPos);
          creep.memory.path = path;
        });
      }
    }

    lastPathFindingTick = Game.time;
  }
  // 执行贝叶斯模型的决策
  for (var name in Game.creeps) {
  var creep = Game.creeps[name];
  if (creep.memory.role == 'harvester') {
    var energySource = bayesianLogic.selectEnergySource(creep);
    creep.memory.target = energySource ? energySource.id : null; // 设置采集者的目标能量源
  }
}

}
