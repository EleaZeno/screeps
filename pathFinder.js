/*
 * Module code goes here. Use 'module.exports' to export things:
 * module.exports.thing = 'a thing';
 *
 * You can import it from another modules like this:
 * var mod = require('pathFinder');
 * mod.thing == 'a thing'; // true
 */
var memoryUtils = require('memoryUtils');

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

var lastPathFindingTick = 0; // 上次路径计算的 Tick

module.exports.calculatePaths = function (creeps, pathFindingInterval) {
  if (Game.time - lastPathFindingTick >= pathFindingInterval) {
    var groupedCreeps = groupCreepsByTarget(creeps);

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
