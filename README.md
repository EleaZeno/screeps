# Screeps v2 — 干净 · 低 CPU · 可扩展的早期脚本

> 重写自旧版 `EleaZeno/screeps`。修掉了旧版所有崩溃点 + 死代码 + 假贝叶斯，
> 换成生产级早期玩法的标准做法。本地已通过语法检查 + 主循环冒烟测试。

## 为什么去掉贝叶斯？
旧版给"能量源"打贝叶斯分数 —— **方向错了**：
- 房间里的 Source 是**固定、已知、确定**的（就 2-3 个），不需要概率推断。
- 贝叶斯擅长**不确定决策**（敌情预测、市场套利），早期采矿用不上。
- 每 tick 跑概率计算纯烧 CPU，正好撞上"20 CPU 跑不动"。

**替代方案 = 固定分配 + 缓存**（`source.manager.js`）：
按 source 周围空地数算出每个 source 能站几人，把 harvester **绑定**到固定 source，
不抢不挤、又快又稳。这是高分玩家的标准做法。

> 想玩"智能算法"？真正值得上的地方是**多房间扩张 / 防御兵力预测 / 市场套利**，
> 那时再上贝叶斯或 RL 才有意义。早期阶段，确定性贪心就是最优。

## 文件结构
| 文件 | 职责 |
|---|---|
| `main.js` | 主循环、Memory 初始化、死 creep 清理、统计打印 |
| `spawn.manager.js` | 孵化：数量随 RCL 动态、身体随能量自适应、不写死 Spawn1 |
| `source.manager.js` | 算 source 容量 + harvester 固定分配 |
| `role.harvester.js` | 采集 → 回填 spawn/extension/tower/storage |
| `role.upgrader.js` | 专职升级 controller |
| `role.builder.js` | 建造工地 → 无工地则修理 → 再无则升级 |
| `utils.js` | 移动(reusePath 缓存)、找回填目标、取能量 |

## 相比旧版修了什么
- ❌ 删掉每 tick 把路径塞 Memory 却没人读的 CPU 黑洞
- ❌ 删掉 main.js 里只 console.log 的死 class 体系
- ❌ 修掉 `Memory.statistics` / `lastMemoryCleanupTick` 首 tick 崩溃 (NaN/undefined)
- ❌ 去掉写死 `Game.spawns['Spawn1']`，改遍历所有 spawn/房间
- ❌ 修掉离谱的"一上来要 30 个 creep"，改成随 RCL 渐进
- ✅ 移动统一 `moveTo(reusePath:8)`，寻路 CPU 大降
- ✅ 身体随 `energyCapacityAvailable` 自适应（能量越多身体越大）
- ✅ harvester 固定绑 source，均匀分布防拥堵
- ✅ 紧急兜底：0 个 harvester 时强制出最小身体，防经济崩盘
- ✅ 每个角色 run 包 try/catch，单个 creep 报错不会拖垮整个 loop

## 怎么用
1. 把这 7 个 `.js` 文件（**不含 `_smoketest.js`**）复制到 Screeps 客户端的脚本目录，
   或推到你绑定的分支。文件名保持不变（Screeps 用 `require('spawn.manager')` 按文件名引用）。
2. 在房间里放好 Spawn，脚本会自动开始孵化采集者。
3. 控制台每 10 tick 打印一行：`RCL / 进度 / 能量 / 各角色数 / CPU`。

## 本地自测
```
node --check *.js        # 语法检查（全部 OK）
node _smoketest.js       # mock 全局跑 3 tick 主循环（PASSED）
```
`_smoketest.js` 仅本地验证用，**不要上传到 Screeps**。

## 下一步可加（按 RCL 阶段）
- RCL3+：tower 防御逻辑（自动打敌人 / 修墙）
- RCL3+：container 矿位 + 专职 miner（静态采矿，效率翻倍）
- RCL4+：storage 中转 + hauler（搬运工分离）
- RCL5+：link 网络、remote mining（外矿）
- 想要的话我可以继续按阶段加。
