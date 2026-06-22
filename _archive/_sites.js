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
  const r=await api('game/room-objects?room=E9N52&shard=shard3');
  const j=JSON.parse(r.body); const objs=j.objects||[];
  const spawn=objs.find(o=>o.type==='spawn');
  const sites=objs.filter(o=>o.type==='constructionSite');
  console.log('spawn@'+spawn.x+','+spawn.y);
  for(const s of sites){
    const d=Math.max(Math.abs(s.x-spawn.x),Math.abs(s.y-spawn.y));
    console.log('  site',s.structureType,'@'+s.x+','+s.y,'progress',(s.progress||0)+'/'+(s.progressTotal||'?'),'distFromSpawn',d);
  }
})();
