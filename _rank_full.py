import json, os, glob
def G(terr,x,y): return int(terr[y*50+x])
def isWall(terr,x,y): return G(terr,x,y)&1

# mineral 稀有度/实用度评分（基础元素都常见，权重低，仅微调）
MIN_VAL = {'H':2,'O':2,'U':3,'L':3,'K':3,'Z':3,'X':5}

def openSpots(terr,x,y):
    op=0
    for dx in(-1,0,1):
        for dy in(-1,0,1):
            if dx==0 and dy==0: continue
            nx,ny=x+dx,y+dy
            if 0<=nx<50 and 0<=ny<50 and not isWall(terr,nx,ny): op+=1
    return op

def exits(terr):
    # 统计4条边的开口段数（出口越少越好守）
    cnt=0
    for x in range(50):
        if not isWall(terr,x,0): cnt+=1
        if not isWall(terr,x,49): cnt+=1
    for y in range(50):
        if not isWall(terr,0,y): cnt+=1
        if not isWall(terr,49,y): cnt+=1
    # 数有几条边有出口
    sides=0
    if any(not isWall(terr,x,0) for x in range(50)): sides+=1
    if any(not isWall(terr,x,49) for x in range(50)): sides+=1
    if any(not isWall(terr,0,y) for y in range(50)): sides+=1
    if any(not isWall(terr,49,y) for y in range(50)): sides+=1
    return cnt, sides

def ctrlSpace(terr,cx,cy):
    # controller 周围5x5可建造空地数
    s=0
    for dx in range(-2,3):
        for dy in range(-2,3):
            nx,ny=cx+dx,cy+dy
            if 0<=nx<50 and 0<=ny<50 and not isWall(terr,nx,ny): s+=1
    return s

def analyze(path):
    d=json.load(open(path)); terr=d['terrain']; rm=d['room']
    spots=[openSpots(terr,s['x'],s['y']) for s in d['sources']]
    cx,cy=d['ctrl']['x'],d['ctrl']['y']
    dists=[max(abs(s['x']-cx),abs(s['y']-cy)) for s in d['sources']]
    if len(d['sources'])==2:
        s1,s2=d['sources']; srcgap=max(abs(s1['x']-s2['x']),abs(s1['y']-s2['y']))
    else: srcgap=0
    w=sum(1 for i in range(2500) if G(terr,i%50,i//50)&1)
    sw=sum(1 for i in range(2500) if G(terr,i%50,i//50)&2)
    swp=round(sw/2500*100)
    exitTiles,exitSides=exits(terr)
    cspace=ctrlSpace(terr,cx,cy)
    mn=d.get('mineral','?'); mval=MIN_VAL.get(mn,2)
    # === 综合评分（权重反映老玩家真实偏好）===
    # 产能(最重要): 开采位*4
    # 紧凑度: -最远source距离 -source间距/2
    # 防守: -出口边数*3 (出口少好守)
    # 基地空间: +controller空地
    # 地形: -沼泽%/3
    # 矿物: +mval
    score = sum(spots)*4 - max(dists) - srcgap//2 - exitSides*3 + cspace - swp//3 + mval
    return {'rm':rm,'spots':spots,'total':sum(spots),'maxdist':max(dists),'srcgap':srcgap,
            'swamp':swp,'exitSides':exitSides,'cspace':cspace,'mineral':mn,'score':score}

res=[analyze(f) for f in glob.glob(os.path.join(os.environ['TEMP'],'full_*.json'))]
res.sort(key=lambda x:-x['score'])
print(f"{'房间':6} {'开采位':10} {'总':3} {'远距':4} {'源距':4} {'沼泽':4} {'出口边':5} {'基地空地':6} {'矿':3} {'评分':5}")
for r in res:
    print(f"{r['rm']:6} {str(r['spots']):10} {r['total']:3} {r['maxdist']:4} {r['srcgap']:4} {r['swamp']:3}% {r['exitSides']:5} {r['cspace']:6} {r['mineral']:3} {r['score']:5}")
print(f"\n>>> 全维度最优: {res[0]['rm']} (评分 {res[0]['score']})")
