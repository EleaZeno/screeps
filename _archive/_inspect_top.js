const https = require('https');
const zlib = require('zlib');
const TOKEN = '3456b576-97ec-41bb-90a3-5951670ba79b';
function api(path){return new Promise((res,rej)=>{
  const req=https.request({host:'screeps.com',path:'/api/'+path,method:'GET',headers:{'X-Token':TOKEN,'X-Username':TOKEN}},r=>{
    let ch=[];r.on('data',c=>ch.push(c));r.on('end',()=>{let b=Buffer.concat(ch);if(r.headers['content-encoding']==='gzip'){try{b=zlib.gunzipSync(b);}catch(e){}}res({status:r.statusCode,body:b.toString()});});
  });req.on('error',rej);req.end();
});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const TARGETS = ['E18N52','E17N56','E18N53','E15N58','E17N51','E11N52','E11N55'];

function dist(a,b){return Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));}

(async()=>{
  for (const room of TARGETS) {
    try {
      const r = await api('game/room-objects?room='+room+'&shard=shard3');
      const j = JSON.parse(r.body); const objs=j.objects||[];
      const sources=objs.filter(o=>o.type==='source').map(o=>({x:o.x,y:o.y}));
      const ctrl=objs.find(o=>o.type==='controller');
      const min=objs.find(o=>o.type==='mineral');
      // terrain swamp ratio
      let swampPct='?';
      const t=await api('game/room-terrain?room='+room+'&shard=shard3&encoded=1');
      try{const tj=JSON.parse(t.body);const ter=tj.terrain[0].terrain;let s=0;for(const ch of ter)if(ch==='2')s++;swampPct=(100*s/ter.length).toFixed(0)+'%';}catch(e){}
      // source spacing & source-to-controller
      let srcSpacing='-', s2c='-';
      if(sources.length>=2) srcSpacing=dist(sources[0],sources[1]);
      if(ctrl&&sources.length){ s2c=sources.map(s=>dist(s,{x:ctrl.x,y:ctrl.y})).join('/'); }
      console.log(`${room}: ctrl@${ctrl?ctrl.x+','+ctrl.y:'?'} sources=[${sources.map(s=>s.x+','+s.y).join(' ')}] srcSpacing=${srcSpacing} src→ctrl=${s2c} mineral=${min?min.mineralType:'?'} swamp=${swampPct}`);
      await sleep(150);
    } catch(e){ console.log(room,'ERR',e.message); }
  }
})();
