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
  const ctrl=objs.find(o=>o.type==='controller');
  const spawn=objs.find(o=>o.type==='spawn');
  const sources=objs.filter(o=>o.type==='source');
  const creeps=objs.filter(o=>o.type==='creep'&&o.user===ctrl.user);
  const exts=objs.filter(o=>o.type==='extension');
  const sites=objs.filter(o=>o.type==='constructionSite');
  const containers=objs.filter(o=>o.type==='container');
  console.log('controller L'+ctrl.level+' progress',ctrl.progress+'/'+(ctrl.progressTotal||'?'),'ticksToDowngrade',ctrl.ticksToDowngrade);
  console.log('spawn',spawn.name,'@'+spawn.x+','+spawn.y,'energy',JSON.stringify(spawn.store));
  console.log('sources:');
  for(const s of sources) console.log('  @'+s.x+','+s.y,'energy',s.energy+'/'+s.energyCapacity);
  console.log('extensions:',exts.length,'containers:',containers.length,'constructionSites:',sites.map(s=>s.structureType).join(',')||'none');
  console.log('CREEPS ('+creeps.length+'):');
  for(const c of creeps){
    const body=(c.body||[]).map(b=>b.type[0]).join('');
    console.log('  '+(c.name||'?')+' role='+((c.memory&&c.memory.role)||'?')+' body='+body+' store='+JSON.stringify(c.store||{}));
  }
})();
