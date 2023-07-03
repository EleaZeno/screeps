var roleHarvester = require('role.harvester');
var roleUpgrader = require('role.upgrader');
var roleBuilder = require('role.builder');
var spawner = require('spawner');
var pathFinder = require('pathFinder');
var memoryUtils = require('memoryUtils');

var lastMemoryCleanupTick = 0;
var lastSpawningTextUpdateTick = 0;
var lastPathFindingTick = 0; // 上次路径计算的 Tick
var pathFindingInterval = 10; // 路径计算的间隔
var allCreeps = Object.values(Game.creeps);


    module.exports.loop = function () {
    // 内存清理
    memoryUtils.cleanUpMemory();

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
    spawner.spawnCreeps();
    // 路径计算函数
    pathFinder.calculatePaths(allCreeps, lastPathFindingTick, pathFindingInterval);
};
    //测试