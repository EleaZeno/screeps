# Screeps V3 — 会思考的大脑（Utility AI + 任务市场 + 战略层）

> 设计日期 2026-06-23。目标：彻底消灭 if 嵌套带来的死锁/互锁/组合爆炸，
> 让系统能自主应对各种情况，自适应存档有用策略，无需反复改代码。

## 一、核心病理诊断（为什么旧系统反复出 bug）

旧 v2 的所有 bug（guardian↔spawn 抢控制、bootstrap 死锁、阈值卡死、4 harvester 挤一格）
**根源同一个**：命令式 if 嵌套。
- 每个边界情况手写一条 if → N 条件 = 2^N 组合，永远漏覆盖
- 多模块各写各的 if → 互相打架（双系统死循环）
- 硬阈值（cap≥500）= 悬崖式切换 → 临界点卡死

## 二、解药：声明式 + 连续效用 + 市场分配

不再写"如果 A 且 B 就做 C"。改为：
1. **描述世界状态**（黑板）
2. **列出所有可能的活**（任务池）
3. **给每个 (creep, 任务) 组合打一个连续分数**（效用函数）
4. **市场撮合**：每个 creep 去做对它效用最高的任务；每个任务被最合适的 creep 抢到
5. **战略层**调节全局权重（现在该冲 RCL 还是囤能量还是防御）

没有 if 嵌套，只有打分函数。加新行为 = 加一个打分函数，不碰其他代码 → 天然无冲突、可扩展。

## 三、三层大脑架构

```
┌──────────────────────────────────────────────────────┐
│ L3 战略层 Strategist —— "想要什么"（每 ~10 tick 跑一次）  │
│  读世界状态 → 输出全局意图权重 weights{}：              │
│   upgrade / build / harvest / defend / expand / store  │
│  例：controller 快降级→defend↑; 能量积压→upgrade↑      │
│  权重存 Memory.brain.weights，可被自适应层调整          │
├──────────────────────────────────────────────────────┤
│ L2 任务层 Blackboard + TaskMarket —— "有哪些活"         │
│  扫世界生成任务池 tasks[]，每个任务有：                  │
│   {type, target, pos, baseValue, capacity, assigned[]}  │
│  任务类型：harvest(钉source格) / haul(搬energy) /        │
│   upgrade / build / repair / fill(spawn/ext/tower) /    │
│   defend / scout / claim / attack                       │
│  任务的 value = baseValue × 战略层权重 × 紧急度          │
├──────────────────────────────────────────────────────┤
│ L1 执行层 Utility Agents —— "谁干"（每 tick 每 creep）    │
│  creep 无固定 role！每 tick：                            │
│   对每个还有空位的任务算 utility(creep, task)            │
│   = task.value × fitness(creep对该任务的胜任度)          │
│      × (1/距离衰减) × 连续性奖励(别频繁改主意)            │
│   选最高分任务认领并执行                                  │
│  body 也按"市场缺什么"动态决定（spawn 也是市场参与者）    │
└──────────────────────────────────────────────────────┘
```

## 四、效用函数设计（关键中的关键）

每个 (creep, task) 的效用：
```
U(c, t) = t.value                      // 任务本身价值（含战略权重）
        × fitness(c, t)                // creep 身体对任务的胜任度 [0..1]
        × proximity(c, t)              // 距离衰减 1/(1+dist*k)
        × continuity(c, t)             // 若 c 上 tick 就在做 t，加成（防抖动）
        × saturation(t)                // 任务已被认领越多，边际效用越低
```
- **fitness**：harvest 任务看 WORK 数；haul 看 CARRY；空载去取能、满载去送货
- **saturation**：一个 source 格被占了，第 2 个 creep 对它效用骤降 → 自动散开
- **continuity**：避免 creep 每 tick 改主意来回跑（迟滞 hysteresis）

效用都是**连续函数**，没有悬崖，没有 if 嵌套。临界点平滑过渡。

## 五、自适应/存档（"会学习"）

- `Memory.brain.weights`：战略权重，战略层每次更新
- `Memory.brain.history`：记录"采取某策略后 N tick 内的产出变化"
- 简单强化：若提高 upgrade 权重后 controller progress 速率↑，则强化该权重
- **关键：策略是数据(Memory)不是代码**。系统调自己的参数，不用改代码重新部署
- 存档有用经验：把"在 X 局面下用 Y 权重很有效"写进 Memory.brain.playbook

## 六、模块清单（精简：从 30 文件 → ~8 核心）

```
main.js          —— 入口，调度三层大脑 + 跑 creep 执行
brain.js         —— L3 战略层（产出 weights）
blackboard.js    —— L2 世界状态扫描 + 任务池生成
market.js        —— L2/L1 撮合：creep 竞标任务
utility.js       —— L1 效用函数库（每种任务一个打分函数）
executor.js      —— L1 creep 执行已认领任务的动作
spawning.js      —— spawn 作为市场参与者，按缺口造 body
adaptive.js      —— 自适应：调权重 + 存 playbook
```
复用旧资产（已实战验证，不重写）：
```
utils.js          —— moveTo 防卡死 + work 封装（保留）
source.scheduler  —— 开采格预计算 + 寻路缓存（保留，喂给 blackboard）
layout.planner    —— 基地布局规划（保留）
build.planner     —— 工地规划（保留，产出喂给 build 任务）
visual / dashboard—— 可视化（保留，观测大脑决策）
```
砍掉（被市场取代）：
```
spawn.manager（6k+ 行 if）→ spawning.js（按市场缺口）
colony.guardian（紧急 if）→ 战略层 defend/survival 权重自然涌现
所有 role.*.js（固定角色）→ executor + utility（无 role）
```

## 七、为什么这套消灭了所有已知 bug

| 旧 bug | 新架构如何免疫 |
|---|---|
| guardian↔spawn 抢控制 | 只有一个市场，所有决策同源，无双系统 |
| bootstrap 死锁(攒不出miner) | 没人采矿→harvest任务效用爆表→自动最高优先 |
| 4 harvester 挤一格 | saturation 让被占格效用归零，自动散开 |
| cap≥500 硬阈值卡死 | 无硬阈值，全连续效用曲线，平滑过渡 |
| 加新行为改一堆if | 加一个 utility 函数，零侵入 |
| 旧代码线上没更新 | （流程问题，靠 grunt 部署纪律解决）|

## 八、实施计划（激进但每步验证）

- P0：搭骨架 + 黑板 + 市场 + 最小 utility（harvest/haul/upgrade），本地 mock 测试跑通
- P1：spawning 按市场缺口造 body，验证 bootstrap 无死锁（重放旧死锁场景）
- P2：补 build/fill/repair/defend 任务，多场景冒烟
- P3：战略层 weights + 自适应存档
- P4：grunt 部署到一个**测试分支**（非 default，不影响线上发育），观测真实决策
- P5：稳定后切 default

测试纪律：每个 P 必须有回归测试，尤其重放旧 bug 场景（bootstrap 死锁、挤格、抢控制）证明免疫。
