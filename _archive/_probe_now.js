const https = require('https');
const TOKEN = '3456b576-97ec-41bb-90a3-5951670ba79b';
const SHARD = 'shard3';
const ROOM = 'E9N52';
function api(p){return new Promise((res,rej)=>{const o={host:'screeps.com',path:'/api/'+p,method:'GET',headers:{'X-Token':TOKEN,'X-Username':TOKEN}};const r=https.request(o,x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res({status:x.statusCode,body:d}));});r.on('error',rej);r.end();});}
function mem(path){return api(`user/memory?shard=${SHARD}&path=${path}`);}
(async()=>{
  // 房间对象
  const ro = await api(`game/room-objects?room=${ROOM}&shard=${SHARD}`);
  let objs=[];try{objs=JSON.parse(ro.body).objects||[];}catch(e){console.log('room-objects parse fail', ro.status, ro.body.slice(0,200));}
  const my = objs;
  const byType={};
  for(const o of my){byType[o.type]=(byType[o.type]||[]);byType[o.type].push(o);}
  // controller
  const ctrl=(byType.controller||[])[0];
  console.log('===== ROOM',ROOM,'(',SHARD,') =====');
  if(ctrl) console.log(`RCL ${ctrl.level||0}  progress ${ctrl.progress||0}/${ctrl.progressTotal||0}  downgrade=${ctrl.downgradeTime||'-'}`);
  // spawns + extensions energy => cap
  const spawns=(byType.spawn||[]);
  const exts=(byType.extension||[]);
  let cap=0, cur=0;
  for(const s of spawns){cap+=(s.storeCapacityResource?s.storeCapacityResource.energy:300)||300; cur+=(s.store&&s.store.energy)||0;}
  for(const e of exts){cap+=(e.storeCapacityResource?e.storeCapacityResource.energy:50)||50; cur+=(e.store&&e.store.energy)||0;}
  console.log(`spawns=${spawns.length}  extensions=${exts.length}  energyCap(spawn+ext)=${cap}  energyNow=${cur}`);
  // containers
  const conts=(byType.container||[]);
  console.log(`containers=${conts.length}`);
  conts.forEach((c,i)=>console.log(`  container[${i}] @${c.x},${c.y} energy=${(c.store&&c.store.energy)||0}/2000`));
  // construction sites
  const sites=(byType.constructionSite||[]);
  const siteCount={};sites.forEach(s=>siteCount[s.structureType]=(siteCount[s.structureType]||0)+1);
  console.log('constructionSites=', JSON.stringify(siteCount));
  // towers / storage
  console.log(`towers=${(byType.tower||[]).length}  storage=${(byType.storage||[]).length}  links=${(byType.link||[]).length}`);
  // sources
  const srcs=(byType.source||[]);
  console.log(`sources=${srcs.length}`); srcs.forEach((s,i)=>console.log(`  source[${i}] @${s.x},${s.y} energy=${s.energy}/${s.energyCapacity}`));
  // creeps by role (from memory)
  const cm = await mem('creeps');
  let creeps={};try{const j=JSON.parse(cm.body); creeps=(j.data&&typeof j.data==='string')?JSON.parse(Buffer.from(j.data.split(',')[1]||'','base64').toString()):j.data||{};}catch(e){}
  // creeps from room objects (more reliable)
  const myCreeps=(byType.creep||[]).filter(c=>c.user);
  const roleCount={};
  for(const c of myCreeps){
    const role=(creeps[c.name]&&creeps[c.name].role)||'?';
    roleCount[role]=(roleCount[role]||0)+1;
  }
  console.log('myCreeps total=',myCreeps.length,' byRole=',JSON.stringify(roleCount));
  // config override
  const cfg = await mem('config');
  console.log('Memory.config raw:', cfg.body.slice(0,300));
})().catch(e=>console.log('ERR',e.message));
