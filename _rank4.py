import json, os, glob
def isWall(terr, x, y): return int(terr[y*50+x]) & 1
def analyze(path):
    d = json.load(open(path))
    terr = d['terrain']; rm = d['room']
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
    cx, cy = d['ctrl']['x'], d['ctrl']['y']
    dists=[max(abs(s['x']-cx),abs(s['y']-cy)) for s in d['sources']]
    w=sum(1 for i in range(2500) if int(terr[i])&1)
    sw=sum(1 for i in range(2500) if int(terr[i])&2)
    swp=round(sw/2500*100)
    # 评分：开采位*3 - 最远source距离 - 沼泽惩罚
    score = sum(spots)*3 - max(dists) - swp//5
    return {'rm':rm,'spots':spots,'total':sum(spots),'dists':dists,'swamp':swp,'score':score}

res=[analyze(f) for f in glob.glob(os.path.join(os.environ['TEMP'],'rm_*.json'))]
res.sort(key=lambda x:-x['score'])
print("排名  房间    开采位      总位  source-ctrl距离  沼泽  评分")
for r in res:
    print(f"  {r['rm']:6} spots={r['spots']} total={r['total']:2} dist={r['dists']} swamp={r['swamp']:2}% score={r['score']}")
print()
print(f"WINNER: {res[0]['rm']}")
