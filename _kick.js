const https = require('https');
const zlib = require('zlib');
const TOKEN = '3456b576-97ec-41bb-90a3-5951670ba79b';
function api(path,method,body){return new Promise((res,rej)=>{
  const data=body?JSON.stringify(body):null;
  const opts={host:'screeps.com',path:'/api/'+path,method:method||'GET',headers:{'X-Token':TOKEN,'X-Username':TOKEN}};
  if(data){opts.headers['Content-Type']='application/json';opts.headers['Content-Length']=Buffer.byteLength(data);}
  const req=https.request(opts,r=>{let ch=[];r.on('data',c=>ch.push(c));r.on('end',()=>{let b=Buffer.concat(ch);if(r.headers['content-encoding']==='gzip'){try{b=zlib.gunzipSync(b);}catch(e){}}res({status:r.statusCode,body:b.toString()});});});
  req.on('error',rej);if(data)req.write(data);req.end();
});}

(async()=>{
  // Run console eval: report mining-spot memory + reassign one upgrader to builder to rush extensions
  const expr = `
    var room = Game.rooms['E9N52'];
    var out = {spots: room.memory.sources, rcl: room.controller.level, cap: room.energyCapacityAvailable, sites: room.find(FIND_MY_CONSTRUCTION_SITES).length};
    var roles = {};
    for (var n in Game.creeps){ var c=Game.creeps[n]; roles[c.memory.role]=(roles[c.memory.role]||0)+1; }
    out.roles = roles;
    // convert 1 upgrader -> builder to rush extensions
    var conv=null;
    for (var n in Game.creeps){ var c=Game.creeps[n]; if(c.memory.role==='upgrader'){ c.memory.role='builder'; c.memory.working=false; conv=c.name; break; } }
    out.converted = conv;
    Memory.__probe = out;
    JSON.stringify(out);
  `;
  const r = await api('user/console','POST',{expression:expr, shard:'shard3'});
  console.log('console:', r.status, r.body.slice(0,300));
})();
