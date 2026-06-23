const https=require('https');const zlib=require('zlib');
const token='3456b576-97ec-41bb-90a3-5951670ba79b';
function get(path){return new Promise((res,rej)=>{https.get('https://screeps.com'+path,{headers:{'X-Token':token}},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});}
(async()=>{
  const raw=await get('/api/user/memory?path=brain&shard=shard3');
  const j=JSON.parse(raw);
  let data=j.data;
  if(typeof data==='string'&&data.startsWith('gz:')){
    const buf=Buffer.from(data.slice(3),'base64');
    data=JSON.parse(zlib.gunzipSync(buf).toString());
  }
  console.log('=== genome ===');console.log(JSON.stringify(data.genome,null,2));
  console.log('=== cpu ===');console.log(JSON.stringify(data.cpu,null,2));
  console.log('=== _diag ===');console.log(JSON.stringify(data._diag,null,2));
  console.log('=== weights ===');console.log(JSON.stringify(data.weights,null,2));
})();
