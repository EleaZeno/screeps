import json, os, glob
def isWall(terr, x, y): return int(terr[y*50+x]) & 1
def analyze(path):
    d = json.load(open(path))
    terr = d['terrain']; rm = d['room']
    print(f"=== {rm} ===")
    spots = []
    for s in d['sources']:
        x, y = s['x'], s['y']
        op = 0
        for dx in (-1,0,1):
            for dy in (-1,0,1):
                if dx==0 and dy==0: continue
                nx, ny = x+dx, y+dy
                if 0<=nx<50 and 0<=ny<50 and not isWall(terr,nx,ny): op += 1
        spots.append(op)
        print(f"  source @({x},{y}) 可站采集者={op}")
    cx, cy = d['ctrl']['x'], d['ctrl']['y']
    print(f"  controller @({cx},{cy})")
    if len(d['sources'])==2:
        s1,s2=d['sources']
        sd=max(abs(s1['x']-s2['x']),abs(s1['y']-s2['y']))
        print(f"  两source间距={sd}")
    dists=[max(abs(s['x']-cx),abs(s['y']-cy)) for s in d['sources']]
    print(f"  source到controller距离={dists}")
    w=sum(1 for i in range(2500) if int(terr[i])&1)
    sw=sum(1 for i in range(2500) if int(terr[i])&2)
    print(f"  地形: 平地{round((2500-w-sw)/2500*100)}% 沼泽{round(sw/2500*100)}% 墙{round(w/2500*100)}%")
    score = sum(spots)*3 - (max(dists) if dists else 0) - round(sw/2500*100)//5
    print(f"  >>> 综合评分={score} (越高越好)")
    print()
    return rm, score

results=[]
for f in sorted(glob.glob(os.path.join(os.environ['TEMP'],'room_*.json'))):
    results.append(analyze(f))
results.sort(key=lambda x:-x[1])
print("=== 排名 ===")
for rm,sc in results: print(f"  {rm}: {sc}")
