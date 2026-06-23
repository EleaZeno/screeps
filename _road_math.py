# Road timing ROI: early vs late road-building. ASCII only.
# Physics from worldmodel.js
HARVEST=2; CARRY=50; REGEN=10; ROAD_COST=300
spawn=(18,43); s1=(12,36); s2=(34,36); ctrl=(14,43)
def cheb(a,b): return max(abs(a[0]-b[0]),abs(a[1]-b[1]))
dS1=cheb(spawn,s1); dS2=cheb(spawn,s2); dC=cheb(spawn,ctrl)
print("=== E9N54 distances (Chebyshev tiles) ===")
print(f"spawn->src1={dS1}  spawn->src2={dS2}  spawn->ctrl={dC}")
print()
print("=== KEY PHYSICS ===")
print("Loaded creep on PLAIN: if MOVE>=burden -> 1 tick/tile already; road -> 0.5 tick/tile.")
print("E9N54 is 0% swamp, so NO swamp-hell that roads rescue (swamp 5->1 is the big win, absent here).")
print("So on plains the road only saves the LOADED leg: 1 -> 0.5 tick/tile = 2x on that leg only.")
print()
# Quantify a hauler round trip spawn<->source, 6 CARRY = 300 cap
print("=== Hauler round-trip cost (6-CARRY, move-balanced) ===")
for name,d in [("src1",dS1),("src2",dS2)]:
    noRoad = d*2*1.0   # move-balanced, no road: 1 tick/tile loaded
    road   = d*2*0.5   # on road: 0.5 tick/tile
    save   = noRoad-road
    print(f"{name} d={d}: roundtrip noRoad={noRoad:.0f}t road={road:.0f}t  save={save:.0f}t/trip")
print()
print("=== Cost to build the main road spawn->src1 ===")
roadLen=dS1
roadEnergy=roadLen*ROAD_COST
print(f"road spawn->src1: {roadLen} segments x 300 = {roadEnergy} energy")
earlyRate=6  # early colony ~6 e/tick net
buildTicks=roadEnergy/earlyRate
print(f"at early ~{earlyRate} e/tick this road consumes ~{buildTicks:.0f} ticks of TOTAL energy")
print(f"  (RCL1->2 needs only 200 progress = trivial; RCL2->3 needs 135000 progress)")
print()
# When does the road pay back? It saves 'save' ticks per hauler trip.
# A hauler trip moves 300 energy. Trips/1000t at d distance:
print("=== Payback: how long until the road's energy cost is recovered ===")
for name,d in [("src1",dS1)]:
    save=d*2*0.5  # ticks saved per round trip
    # value of a saved tick ~ extra energy a hauler could move. hauler moves 300 per (2d) loaded ticks
    # saved 'save' ticks/trip -> fraction of an extra trip. energy value per saved tick:
    perTick = 300/(2*d*1.0)  # e/tick a hauler delivers w/o road
    extraEnergyPerTrip = save*perTick
    # but cost is one-time 300/seg * roadLen; net maintenance ~0.05/seg/tick
    print(f"{name}: each trip saves {save:.0f}t -> ~{extraEnergyPerTrip:.1f} e equiv/trip")
print()
print("=== VERDICT ===")
print("In a 0% swamp room, building roads BEFORE extensions/static-mining is NET NEGATIVE early,")
print("because: (a) the energy pulled into 300/seg roads is energy NOT going into RCL progress or miners;")
print("(b) plains roads only halve the loaded leg (1->0.5), a small absolute saving;")
print("(c) the big road payoff (swamp 5->1, and cutting hauler MOVE parts) needs sustained traffic that")
print("    only exists AFTER static mining + many haulers are running (RCL3+).")
print("BUT: roads on the spawn<->source spine DO help once static mining starts (RCL2 containers placed),")
print("because haulers then run that spine constantly. So the OPTIMAL is: roads right AFTER RCL2 containers,")
print("NOT at RCL3-after-all-extensions (current gate is slightly too late for the source spine).")
