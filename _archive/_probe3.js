const https=require('https'),zlib=require('zlib');
const TOKEN=process.env.SC_TOKEN,SHARD='shard3';
function api(p){return new Promise((res,rej)=>{const o={host:'screeps.com',path:'/api/'+p,method:'GET',headers:{'X-Token':TOKEN,'X-Username':TOKEN}};const r=https.request(o,x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res({status:x.statusCode,body:d}));});r.on('error',rej);r.end();});}
function dec(body){try{const j=JSON.parse(body);if(j.data&&typeof j.data==='string'&&j.data.startsWith('gz:'))return JSON.parse(zlib.gunzipSync(Buffer.from(j.data.slice(3),'base64')).toString());return j.data!==undefined?j.data:j;}catch(e){return body;}}
(async()=>{
  const g=dec((await api(`user/memory?shard=${SHARD}&path=guardian`)).body);
  console.log('guardian:',JSON.stringify(g));
  // live creeps for the room via room objects
  const ro=await api(`game/room-objects?room=E9N52&shard=${SHARD}`);
  try{const j=JSON.parse(ro.body);const objs=j.objects||[];const mine=objs.filter(o=>o.type==='creep'&&o.user);
    const roles={};mine.forEach(c=>{const r=(c.body?'':'')+ (c.name||'');});
    console.log('live objects total:',objs.length,'| live creeps:',objs.filter(o=>o.type==='creep').length);
    const spawn=objs.find(o=>o.type==='spawn');
    if(spawn)console.log('spawn energy store:',JSON.stringify(spawn.store),'spawning:',JSON.stringify(spawn.spawning));
  }catch(e){console.log('room-objects status',ro.status,ro.body.slice(0,200));}
})();
