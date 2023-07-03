var roleHarvester = require('role.harvester');
var roleUpgrader = require('role.upgrader');
var roleBuilder = require('role.builder');
var spawner = require('spawner');
var pathFinder = require('pathFinder');

var lastMemoryCleanupTick = 0;
var lastSpawningTextUpdateTick = 0;
var lastPathFindingTick = 0; // 上次路径计算的 Tick
var pathFindingInterval = 10; // 路径计算的间隔

module.exports.loop = function () {
    // 内存清理
    if (Game.time - lastMemoryCleanupTick >= 100) {
        for (var name in Memory.creeps) {
            if (!Game.creeps[name]) {
                delete Memory.creeps[name];
                console.log('Clearing non-existing creep memory:', name);
            }
        }
        lastMemoryCleanupTick = Game.time;
    }

    var allCreeps = Object.values(Game.creeps); // 全局筛选 creep 并存储在变量中
    var harvesters = allCreeps.filter((creep) => creep.memory.role == 'harvester');
    var upgraders = allCreeps.filter((creep) => creep.memory.role == 'upgrader');
    var builders = allCreeps.filter((creep) => creep.memory.role == 'builder');

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
