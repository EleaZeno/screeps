var lastSpawnTick = 0;
var lastSpawningTextUpdateTick = 0;
var spawnCheckInterval = 5;

// Spawner 模块用于生成新的 creep
module.exports.spawnCreeps = function () {
    // 检查是否到达生成 creep 的间隔
    if (Game.time - lastSpawnTick < spawnCheckInterval) {
        return; // 未达到生成间隔，直接返回
    }

    // 更新上次生成 creep 的 Tick
    lastSpawnTick = Game.time;

    // 获取房间能量信息
    var roomEnergy = Game.spawns['Spawn1'].room.energyAvailable;
    var extensionsEnergy = Game.spawns['Spawn1'].room.find(FIND_STRUCTURES, {
        filter: { structureType: STRUCTURE_EXTENSION }
    }).reduce((total, ext) => total + ext.store.energy, 0);
    var totalEnergy = Game.spawns['Spawn1'].store.energy + extensionsEnergy;

    // 设置目标数量和角色的身体部件
    var harvesterTargetCount = totalEnergy < 400 ? 10 : 5;
    var upgraderTargetCount = 10;
    var builderTargetCount = totalEnergy >= 400 ? 10 : 4;

    var harvesterBody = [WORK, CARRY, MOVE];
    var upgraderBody = [WORK, CARRY, MOVE];
    var builderBody = [WORK, CARRY, MOVE];

    // 获取当前已存在的 creep 数量
    var harvesters = _.filter(Game.creeps, (creep) => creep.memory.role == 'harvester');
    var upgraders = _.filter(Game.creeps, (creep) => creep.memory.role == 'upgrader');
    var builders = _.filter(Game.creeps, (creep) => creep.memory.role == 'builder');

    // 根据目标数量生成新的 creep
    if (harvesters.length < harvesterTargetCount) {
        spawnCreep('harvester', harvesterBody);
    } else if (upgraders.length < upgraderTargetCount) {
        spawnCreep('upgrader', upgraderBody);
    } else if (builders.length < builderTargetCount) {
        spawnCreep('builder', builderBody);
    }
};

// 生成指定角色的 creep
function spawnCreep(role, body) {
    var newName = role.charAt(0).toUpperCase() + role.slice(1) + Game.time;
    var spawnResult = Game.spawns['Spawn1'].spawnCreep(body, newName, {
        memory: { role: role }
    });

    // 根据生成结果进行日志输出
    if (spawnResult == OK) {
        console.log('Spawning new ' + role + ': ' + newName);
    } else if (spawnResult == ERR_NOT_ENOUGH_ENERGY) {
        console.log('Not enough energy to spawn ' + role);
    } else {
        console.log('Failed to spawn ' + role + '. Error: ' + spawnResult);
    }
}
