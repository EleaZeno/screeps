/*
 * Module code goes here. Use 'module.exports' to export things:
 * module.exports.thing = 'a thing';
 *
 * You can import it from another modules like this:
 * var mod = require('pathFinder');
 * mod.thing == 'a thing'; // true
 */

module.exports.calculatePaths = function (creeps, lastPathFindingTick, pathFindingInterval) {
    if (Game.time - lastPathFindingTick >= pathFindingInterval) {
        for (var name in creeps) {
            var creep = creeps[name];
            var target = creep.memory.target; // 角色的移动目标

            // 检查上一次的目标位置...

            // 如果目标位置发生变化或路径为空，计算新的移动路径...
            if (creep.memory.target != target || !creep.memory.path) {
                var path = creep.pos.findPathTo(target);
                creep.memory.path = path;
                creep.memory.target = target;
            }
        }
        lastPathFindingTick = Game.time;
    }
};
