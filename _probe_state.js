const https = require('https');
const TOKEN = '3456b576-97ec-41bb-90a3-5951670ba79b';

function api(path, method, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      host: 'screeps.com',
      path: '/api/' + path,
      method: method || 'GET',
      headers: { 'X-Token': TOKEN, 'X-Username': TOKEN }
    };
    if (data) {
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = https.request(opts, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => resolve({ status: r.statusCode, body: d }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  try {
    const me = await api('auth/me');
    console.log('=== auth/me status', me.status, '===');
    try {
      const j = JSON.parse(me.body);
      console.log(JSON.stringify({ username: j.username, gcl: j.gcl, cpu: j.cpu, money: j.money, credits: j.credits, badge: !!j.badge }, null, 2));
    } catch (e) { console.log(me.body.slice(0, 400)); }

    const rooms = await api('user/rooms');
    console.log('=== user/rooms status', rooms.status, '===');
    console.log(rooms.body.slice(0, 600));

    const overview = await api('user/overview?interval=8&statName=energyControl');
    console.log('=== user/overview status', overview.status, '===');
    console.log(overview.body.slice(0, 600));
  } catch (e) {
    console.log('ERROR', e.message);
  }
})();
