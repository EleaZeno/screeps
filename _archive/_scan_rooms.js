const https = require('https');
const zlib = require('zlib');
const TOKEN = '3456b576-97ec-41bb-90a3-5951670ba79b';

function api(path, method, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = { host: 'screeps.com', path: '/api/' + path, method: method || 'GET',
      headers: { 'X-Token': TOKEN, 'X-Username': TOKEN } };
    if (data) { opts.headers['Content-Type'] = 'application/json'; opts.headers['Content-Length'] = Buffer.byteLength(data); }
    const req = https.request(opts, r => {
      let chunks = [];
      r.on('data', c => chunks.push(c));
      r.on('end', () => {
        let buf = Buffer.concat(chunks);
        if (r.headers['content-encoding'] === 'gzip') { try { buf = zlib.gunzipSync(buf); } catch(e){} }
        resolve({ status: r.statusCode, body: buf.toString() });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Build a list of rooms in shard3 sectors near home E-N quadrant.
// Screeps sector centers every 10. We'll scan a band around E0-E20, N40-N60.
function genRooms() {
  const list = [];
  for (let ex = 0; ex <= 20; ex++) {
    for (let ny = 40; ny <= 60; ny++) {
      list.push('E' + ex + 'N' + ny);
    }
  }
  return list;
}

(async () => {
  const rooms = genRooms();
  console.log('Scanning', rooms.length, 'rooms in shard3 (E0-E20, N40-N60)...');
  const results = [];
  for (const room of rooms) {
    try {
      const r = await api('game/room-objects?room=' + room + '&shard=shard3');
      if (r.status !== 200) { continue; }
      const j = JSON.parse(r.body);
      const objs = j.objects || [];
      let sources = 0, mineral = null, controller = null, owned = false, ownerUser = null, hostileStructs = 0, keeperLairs = 0;
      for (const o of objs) {
        if (o.type === 'source') sources++;
        else if (o.type === 'mineral') mineral = o.mineralType;
        else if (o.type === 'controller') { controller = o; }
        else if (o.type === 'keeperLair') keeperLairs++;
        else if (['spawn','tower','storage','extension','terminal'].includes(o.type) && o.user) hostileStructs++;
      }
      // classify
      let owner = controller && controller.user ? controller.user : null;
      let level = controller ? (controller.level||0) : null;
      let reserved = controller && controller.reservation ? controller.reservation.user : null;
      let isHighway = !controller; // no controller = highway
      let isSK = keeperLairs > 0;
      results.push({ room, sources, mineral, level, owner, reserved, hostileStructs, isHighway, isSK });
    } catch (e) {}
    await sleep(120); // rate limit politeness
  }
  // Filter: claimable, 2 sources, no owner, not highway, not SK, no hostile structures
  const good = results.filter(x => !x.isHighway && !x.isSK && x.sources >= 2 && !x.owner && x.hostileStructs === 0);
  good.sort((a,b) => b.sources - a.sources);
  console.log('\n=== CANDIDATE ROOMS (2+ sources, unowned, no SK, no hostiles) ===');
  for (const g of good) {
    console.log(`${g.room}  sources=${g.sources}  mineral=${g.mineral}  reserved=${g.reserved||'-'}`);
  }
  console.log('\nTotal candidates:', good.length, '/ scanned', results.length);
  // Also show home neighbors quickly
  console.log('\n=== ALL with 2 sources (incl owned/reserved) ===');
  for (const x of results.filter(r=>r.sources>=2)) {
    console.log(`${x.room} src=${x.sources} min=${x.mineral} owner=${x.owner?'Y':'-'} resv=${x.reserved||'-'} SK=${x.isSK?'Y':'-'} hwy=${x.isHighway?'Y':'-'}`);
  }
})();
