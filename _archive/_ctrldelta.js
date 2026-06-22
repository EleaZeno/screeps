const https=require('https');
const T=process.env.SC_TOKEN;
function api(p){return new Promise((r)=>{https.get({host:'screeps.com',path:'/api/'+p,headers:{'X-Token':T,'X-Username':T}},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>r(d));});});}
async function snap(){
  const ro=JSON.parse(await api('game/room-objects?room=E9N52&shard=shard3')).objects||[];
  const ctrl=ro.find(o=>o.type==='controller');
  const cr=ro.filter(o=>o.type==='creep');
  return {p:ctrl.progress,n:cr.length};
}
(async()=>{
  const a=await snap();
  console.log('t0 ctrl:',a.p,'creeps:',a.n);
  await new Promise(r=>setTimeout(r,20000));
  const b=await snap();
  console.log('t1(+20s) ctrl:',b.p,'creeps:',b.n);
  const d=b.p-a.p;
  console.log('controller delta:',d, d>0?'CLIMBING (upgrading!)':'still frozen');
})();
