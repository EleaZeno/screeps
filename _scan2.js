const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const TOKEN = '3456b576-97ec-41bb-90a3-5951670ba79b';
const OUT = '_scan_results.json';

function api(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host: 'screeps.com', path: '/api/' + path, method: 'GET',
      headers: { 'X-Token': TOKEN, 'X-Username': TOKEN } }, r => {
      let chunks = [];
      r.on('data', c => chunks.push(c));
      r.on('end', () => {
        let buf = Buffer.concat(chunks);
        if (r.headers['content-encoding'] === 'gzip') { try { buf = zlib.gunzipSync(buf); } catch(e){} }
        resolve({ status: r.statusCode, body: buf.toString() });
      });
    });
    req.on('error', reject);
    req.end();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Resume support: load existing
let done = {};
if (fs.existsSync(OUT)) { try { done = JSON.parse(fs.readFileSync(OUT,'utf8')); } catch(e){} }

// Sectors near home E0N50. Scan E0-E10 x N45-N55 = the home sector + neighbors (closest land).
function genRooms() {
  const list = [];
  for (let ex = 11; ex <= 18; ex++)
    for (let ny = 45; ny <= 58; ny++)
      list.push('E' + ex + 'N' + ny);
  return list;
}

(async () => {
  const rooms = genRooms().filter(r => !done[r]);
  console.error('To scan:', rooms.length, '(already have', Object.keys(done).length, ')');
  let i = 0;
  for (const room of rooms) {
    try {
      const r = await api('game/room-objects?room=' + room + '&shard=shard3');
      if (r.status === 200) {
        const j = JSON.parse(r.body);
        const objs = j.objects || [];
        let sources = 0, mineral = null, controller = null, keeperLairs = 0, hostileStructs = 0;
        for (const o of objs) {
          if (o.type === 'source') sources++;
          else if (o.type === 'mineral') mineral = o.mineralType;
          else if (o.type === 'controller') controller = o;
          else if (o.type === 'keeperLair') keeperLairs++;
          else if (['spawn','tower','storage','extension','terminal'].includes(o.type) && o.user) hostileStructs++;
        }
        done[room] = {
          sources, mineral,
          level: controller ? (controller.level||0) : null,
          owner: controller && controller.user ? controller.user : null,
          reserved: controller && controller.reservation ? controller.reservation.user : null,
          isHighway: !controller,
          isSK: keeperLairs > 0,
          hostileStructs
        };
      } else {
        done[room] = { err: r.status };
      }
    } catch (e) { done[room] = { err: e.message }; }
    i++;
    if (i % 5 === 0) { fs.writeFileSync(OUT, JSON.stringify(done)); }
    await sleep(40);
  }
  fs.writeFileSync(OUT, JSON.stringify(done));
  console.error('DONE. total', Object.keys(done).length);
})();
