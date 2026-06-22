const https = require('https');
const TOKEN = process.env.SC_TOKEN;
const SHARD = 'shard3';
function api(p){return new Promise((res,rej)=>{const o={host:'screeps.com',path:'/api/'+p,method:'GET',headers:{'X-Token':TOKEN,'X-Username':TOKEN}};const r=https.request(o,x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res({status:x.statusCode,body:d}));});r.on('error',rej);r.end();});}
(async()=>{
  const m=await api(`user/memory?shard=${SHARD}&path=creeps`);
  let out=m.body;try{const j=JSON.parse(m.body);out=JSON.stringify(j.data!==undefined?j.data:j);}catch(e){}
  // count roles
  try{const j=JSON.parse(m.body);const data=j.data||{};const roles={};for(const k in data){const r=data[k].role;roles[r]=(roles[r]||0)+1;}console.log('creep count:',Object.keys(data).length,'roles:',JSON.stringify(roles));}catch(e){console.log('raw:',out.slice(0,400));}
  const g=await api(`user/memory?shard=${SHARD}&path=guardian`);console.log('guardian:',g.body.slice(0,200));
})();
