import json, os, math
d = json.load(open(os.path.join(os.environ['TEMP'], 'e4n53.json')))
terr = d['terrain']
def g(x, y): return int(terr[y*50+x])
def isWall(x, y): return g(x, y) & 1

print("=== E4N53 房间质量分析 ===")
for s in d['sources']:
    x, y = s['x'], s['y']
    op = 0
    for dx in (-1,0,1):
        for dy in (-1,0,1):
            if dx==0 and dy==0: continue
            nx, ny = x+dx, y+dy
            if 0<=nx<50 and 0<=ny<50 and not isWall(nx,ny): op += 1
    print(f"  source @({x},{y})  可站采集者={op} 个")

cx, cy = d['ctrl']['x'], d['ctrl']['y']
print(f"  controller @({cx},{cy})")

# source 到 controller 的曼哈顿距离（越近越好，upgrader 跑路少）
for s in d['sources']:
    dist = max(abs(s['x']-cx), abs(s['y']-cy))
    print(f"  source({s['x']},{s['y']}) -> controller 切比雪夫距离={dist}")

# 两个 source 之间的距离（近=基地紧凑）
if len(d['sources']) == 2:
    s1, s2 = d['sources']
    sd = max(abs(s1['x']-s2['x']), abs(s1['y']-s2['y']))
    print(f"  两 source 间距={sd}")

w = sum(1 for i in range(2500) if int(terr[i]) & 1)
sw = sum(1 for i in range(2500) if int(terr[i]) & 2)
pl = 2500 - w - sw
print(f"  地形: 平地{round(pl/2500*100)}% 沼泽{round(sw/2500*100)}% 墙{round(w/2500*100)}%")
print(f"  (沼泽<20%好走, 平地越多越好)")
