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
        let enc = r.headers['content-encoding'];
        if (enc === 'gzip') { try { buf = zlib.gunzipSync(buf); } catch(e){} }
        resolve({ status: r.statusCode, body: buf.toString() });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  // Room objects in E2N53
  const ro = await api('game/room-objects?room=E2N53&shard=shard3');
  console.log('=== room-objects E2N53 status', ro.status, '===');
  try {
    const j = JSON.parse(ro.body);
    const objs = j.objects || [];
    const byType = {};
    let myStructs = [];
    for (const o of objs) {
      byType[o.type] = (byType[o.type] || 0) + 1;
      if (o.type === 'controller') {
        console.log('CONTROLLER:', JSON.stringify({ level: o.level, user: o.user, progress: o.progress, downgradeTime: o.downgradeTime, reservation: o.reservation, safeMode: o.safeMode }));
      }
      if (['spawn','tower','extension','storage'].includes(o.type) && o.user) myStructs.push(o.type+'@'+o.x+','+o.y+' user='+o.user);
    }
    console.log('TYPES:', JSON.stringify(byType));
    console.log('MY-ISH STRUCTS:', myStructs.slice(0,20).join(' | '));
  } catch (e) { console.log(ro.body.slice(0,400)); }

  // World status — can we respawn?
  const ws = await api('user/world-status');
  console.log('=== world-status status', ws.status, '===');
  console.log(ws.body.slice(0,300));

  const wst = await api('user/world-start-room');
  console.log('=== world-start-room ===');
  console.log(wst.body.slice(0,300));
})();
