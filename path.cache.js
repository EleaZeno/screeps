'use strict';

/*
 * path.cache.js — 全局路径缓存池（用闲置内存换 CPU）
 * ==================================================================
 * PathFinder/moveTo 是 Screeps 最贵的操作之一。高频走的固定路线
 * （spawn→source、source→controller、source→storage）每次重算极浪费。
 * 本模块把序列化路径缓存进 Memory（内存才用 1.8%，海量空间），
 * 命中即复用，未命中才算一次并存入，TTL 过期重算（应对工地/建筑变化）。
 *
 * 设计：
 *  - key = 起点pos+终点pos+range，路径存 packed 字符串（room.serializePath）。
 *  - TTL 默认 1500 tick（约一个 creep 寿命），到期失效防路网变化后走老路。
 *  - 命中计数 + 未命中计数，dashboard 显示命中率，量化省了多少 CPU。
 *  - LRU 上限防内存膨胀（默认 200 条，超了删最老的）。
 */

const DEFAULT_TTL = 1500;
const MAX_ENTRIES = 200;

function key(from, to, range) {
  return `${from.roomName}_${from.x},${from.y}_${to.x},${to.y}_r${range || 1}`;
}

module.exports = {
  init() {
    if (!Memory.pathCache) Memory.pathCache = { entries: {}, hits: 0, misses: 0 };
  },

  /**
   * 取一条缓存路径（命中返回 path 数组；未命中计算并缓存后返回）。
   * @param {RoomPosition} from
   * @param {RoomPosition} to
   * @param {number} range 终点容差
   * @param {Room} room 用于 serialize/find（需可见房）
   */
  get(from, to, range, room) {
    this.init();
    const pc = Memory.pathCache;
    const k = key(from, to, range);
    const hit = pc.entries[k];
    if (hit && Game.time - hit.t < (hit.ttl || DEFAULT_TTL)) {
      pc.hits++;
      hit.lru = Game.time;
      return room ? room.deserializePath(hit.path) : null;
    }
    // 未命中：算一次
    pc.misses++;
    const ret = PathFinder.search(from, { pos: to, range: range || 1 }, {
      plainCost: 2, swampCost: 5, maxOps: 2000,
      roomCallback(rn) {
        const r = Game.rooms[rn];
        if (!r) return;
        const cm = new PathFinder.CostMatrix();
        r.find(FIND_STRUCTURES).forEach((s) => {
          if (s.structureType === STRUCTURE_ROAD) cm.set(s.pos.x, s.pos.y, 1);
          else if (s.structureType !== STRUCTURE_CONTAINER &&
                   (s.structureType !== STRUCTURE_RAMPART || !s.my)) cm.set(s.pos.x, s.pos.y, 255);
        });
        return cm;
      },
    });
    const path = ret.path || [];
    // 存入缓存（packed 字符串省内存）
    if (room) {
      this._evictIfNeeded();
      pc.entries[k] = { path: this._packPath(path), t: Game.time, lru: Game.time, ttl: DEFAULT_TTL };
    }
    return path;
  },

  _packPath(path) {
    // 存为 [{x,y}...] 的紧凑形式（room.serializePath 需 path 含 dx/dy/direction，PathFinder 结果是 RoomPosition[]）
    return path.map((p) => `${p.x},${p.y}`).join('|');
  },

  /** 把缓存的紧凑字符串还原为 {x,y} 数组（供 moveByPath 替代逻辑或 moveTo fallback） */
  unpack(packed) {
    if (!packed) return [];
    return packed.split('|').map((s) => { const [x, y] = s.split(','); return { x: +x, y: +y }; });
  },

  _evictIfNeeded() {
    const e = Memory.pathCache.entries;
    const keys = Object.keys(e);
    if (keys.length < MAX_ENTRIES) return;
    // 删最久未用（LRU）
    let oldest = keys[0];
    for (const k of keys) if (e[k].lru < e[oldest].lru) oldest = k;
    delete e[oldest];
  },

  /** 命中率（供 dashboard） */
  stats() {
    const pc = Memory.pathCache || { hits: 0, misses: 0, entries: {} };
    const total = pc.hits + pc.misses;
    return {
      entries: Object.keys(pc.entries).length,
      hits: pc.hits,
      misses: pc.misses,
      hitRate: total ? +(pc.hits / total * 100).toFixed(1) : 0,
    };
  },
};
