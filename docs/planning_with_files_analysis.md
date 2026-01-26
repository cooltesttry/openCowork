# Planning with Files 架构深度分析

"Planning with Files" (PwF) 是一种基于 **Context Engineering (上下文工程)** 的 Agent 工作流模式。它的核心灵感来自于 Manus (一个被 Meta 斥巨资收购的 Agent 公司)。

与 Ralph 的 "Context Reset" (重置) 策略完全相反，PwF 的核心理念是 **"Context Offloading" (上下文卸载)**。

---

## 1. 核心哲学 (Core Philosophy)

### 1.1 上下文即 RAM，文件系统即硬盘
- **Context Window = RAM (易失, 昂贵, 有限)**
- **Filesystem = Disk (持久, 廉价, 无限)**

PwF 认为 Agent 不应该把所有东西都记在脑子（Context）里，而应该像人类一样，把重要的东西写在纸上（Files）。

### 1.2 对抗 "Lost in the Middle"
大模型有一个通病：当对话过长（>50 step）时，它会忘记最开始的目标。
PwF 通过 **Recitation (背诵)** 机制来解决这个问题：
- 每次采取重大行动前，强制 Agent 重新阅读 `task_plan.md`。
- 这将“全局目标”重新推送到 Context 的**最末端 (Latest Attention)**，确保 Agent 始终记得"我在哪？我要去哪？"。

---

## 2. 状态管理系统 (State Management)

PwF 使用三个核心 markdown 文件构成了 Agent 的“外挂大脑”：

### 2.1 `task_plan.md` (控制塔)
这是最重要的文件，充当 **短期记忆** 和 **任务栈**。
- **作用**：追踪当前阶段、剩余阶段、关键决策。
- **更新时机**：每完成一个 Phase 必须更新。
- **结构示例**：
  ```markdown
  # Task Plan: Feature X
  ## Goal
  Add feature X to allow user login.
  ## Phases
  - [x] Phase 1: Research ✓
  - [/] Phase 2: Implementation (CURRENT) <-- Agent 随时知道自己在 Phase 2
  - [ ] Phase 3: Testing
  ## Key Decisions
  - Use JWT for auth.
  ```

### 2.2 `findings.md` (知识库)
这是 **长期知识** 的存储地。
- **作用**：存储 Agent 在调研过程中发现的 API 文档、代码片段、URL 等。
- **更新时机**：只要有新发现（Discovery）就立刻写入。
- **原则**：Context 里只留链接，内容全在文件里。

### 2.3 `progress.md` (流水账)
这是 **执行日志**。
- **作用**：记录 Agent 做过的操作历史（类似 Ralph 的 `progress.txt`）。
- **更新时机**：整个会话过程中不断追加。

### 2.4 `findings.md` 的深度解析 (Findings Mechanics)

**Q: 什么时候写 `findings.md`？**
**A: Prompt 定义了两个硬性触发条件：**

1.  **The 2-Action Rule (两步法则)**
    > "After every 2 view/browser/search operations, IMMEDIATELY save key findings to text files."
    > (每进行 2 次浏览/搜索操作后，必须立即将发现保存到文件。)
    
    这是为了防止 Context 里的信息被新的 Token 冲刷掉。
    - *Scenario*: Agent 搜索了 Google，看了两个网页。
    - *Must Do*: 必须立刻停下来，把网页里看到的关键信息（API Endpoint, 错误解决方法）总结写入 `findings.md`。

2.  **Multimodal Loss Prevention (多模态防丢)**
    > "Viewed image/PDF -> Write findings NOW"
    
    因为大部分 Agent 模型（如 Claude）的多模态记忆（Image/PDF）比纯文本记忆更昂贵且更容易丢失/退化。Prompt 强制要求：只要看了一眼 PDF/图片，必须立刻把它转译成 Text 存入文件。

**Q: 执行流程是怎样的？**
典型流程如下：
1.  **Action**: `WebSearch("how to fix error X")`
2.  **Observation**: 获得 5 个 URL。
3.  **Action**: `ReadUrl("url1")` -> 获得内容。
4.  **Action**: `ReadUrl("url2")` -> 获得内容。
5.  **Trigger**: 达到 2 次读取上限。
6.  **Context Check**: "Oops, Context RAM 快满了，我得存盘。"
7.  **Action**: `Write("findings.md", "Found that error X is caused by Y...")`
8.  **Result**: 原始网页内容可以从 Context 丢弃（或自然遗忘），因为核心知识已经持久化到了硬盘。

### 2.5 `findings.md` 的召回机制 (Retrieval Mechanics)

**Q: 记了这么多，什么时候读它？**
**A: Prompt 定义了三个明确的召回时刻 (Retrieval Triggers)：**

1.  **Starting New Phase (启动新阶段时)**
    - 当 `task_plan.md` 里的 Phase 1 完成，准备开始 Phase 2 时。
    - **指令**: `Read plan/findings`
    - **原因**: 既然要开始写代码了，最好先把之前的调研结果（Phase 1 的产出）加载到脑子里。

2.  **Error Occurred (发生错误时)**
    - 当遇到编译错误或运行时异常时。
    - **指令**: `Read relevant file`
    - **原因**: 也许之前调研过类似的错误？或者需要重新确认 API 的用法？

3.  **Resuming after Gap (中断恢复时)**
    - 如果会话被中断，或者这是第二天的第一次启动。
    - **指令**: `Read all planning files`
    - **原因**: "我是谁？我昨天做到哪了？" —— `findings.md` 是恢复长期记忆的关键。

**决策矩阵 (Decision Matrix)**:
Prompt 提供了一个简单的 `Read vs Write` 矩阵，告诉 Agent：
> "Just wrote a file? DON'T read (it's in RAM)."
> "Starting new phase? READ (refresh RAM)."

---

## 3. 执行机制 (Execution Mechanics)

不同于 Ralph 使用外部 Bash 脚本，PwF 是作为 **Claude Skill (插件)** 实现的，利用了 **Hooks (钩子)** 机制。

### 3.1 自动回忆 (PreToolUse Hook)
在 `SKILL.md` 中定义了一个极其关键的 Hook：
```yaml
PreToolUse:
  - matcher: "Write|Edit|Bash"
    hooks:
      - command: "cat task_plan.md 2>/dev/null | head -30 || true"
```
**解读**：
每当 Agent 想要写代码或运行命令时，系统会**自动**把 `task_plan.md` 的前 30 行（包含 Goal 和 Status）“喂”给 Agent。
- **效果**：Agent 被迫在行动前“看一眼”计划书。这就像是工厂里贴在机床前的操作规范，强制工人时刻看见。

### 3.2 2-Action Rule (两步法则)
Prompt 强制规定：
> "After every 2 view/browser/search operations, IMMEDIATELY save key findings to text files."

防止 Agent 看了很多网页（Context 被填满了），结果把最初看到的网页内容给挤出去了（Forgetfulness）。强制它无论看什么，先记笔记。

### 3.3 5-Question Reboot Test (重启测试)
PwF 的设计标准是：如果 Agent 这里突然断电了（Crash），新的 Agent 只需要读这这三个文件，就能完美复原现场。它必须能回答：
1. 我在哪？(Phase in `task_plan.md`)
2. 我要去哪？(Remaining Phases)
3. 目标是什么？(Goal)
4. 我学到了什么？(`findings.md`)
5. 我做了什么？(`progress.md`)

---

## 4. Prompt 设计分析

PwF 的 Prompt 设计非常强调 **Metacognition (元认知)** 和 **Error Recovery (错误恢复)**。

### 4.1 "Never Repeat Failures"
Prompt 指令：
> `if action_failed: next_action != same_action`
> Track what you tried. Mutate the approach.

它明确禁止 Agent 进行无效重试（Insanity definition）。要求 Agent 必须改变方法。

### 4.2 "The 3-Strike Error Protocol"
定义了明确的错误升级路径：
1. **Attempt 1**: 诊断并修复。
2. **Attempt 2**: 换个方法 (Alternative Approach)。
3. **Attempt 3**: 重新思考 (Broader Rethink)。
4. **After 3**: 向人类求助 (Escalate)。

这比 Ralph 的无限重试机制更具智能性。

### 4.3 System Prompt 定量分析 (Quantitative Analysis)

我对 `SKILL.md` 中的指令进行了逐条拆解和统计。这个 Prompt 比 Ralph 的要长与复杂得多，包含了 **约 65 条** 明确的指令点。

**分类统计：**

| 类别 | 占比 | 关键指令示例 | 作用 |
| :--- | :--- | :--- | :--- |
| **1. 核心法则 (Core Rules)** | ~30% | "Create Plan First", "2-Action Rule", "Never Repeat Failures" | 定义系统的**硬性约束**，相当于“宪法”。 |
| **2. 认知流程 (Cognitive Flow)** | ~25% | "Read Before Decide", "Diagnose -> Mutate -> Rethink" | 教导 Agent 如何**思考**，如何从错误中恢复。 |
| **3. 文件协议 (File Protocol)** | ~25% | "Where Files Go", "File Purposes Table", "Templates usage" | 定义**存储层**的读写规范，防止数据乱放。 |
| **4. 元认知 (Metacognition)** | ~20% | "5-Question Reboot Test", "Anti-Patterns" | 强制 Agent 进行**自我审视**，防止迷失。 |

**分析结论**：
与 Ralph (35% 流程控制) 相比，PwF 花了大量篇幅（近 50%）在 **认知流程** 和 **元认知** 上。
- 它不仅仅告诉 Agent "做什么" (Action)。
- 它更侧重于教 Agent "怎么想" (Thinking Process) 以及 "如何像人一样记笔记" (Context Management)。
- 这是一个更高级的 Prompt 设计，试图把 "Senior Engineer" 的思维模式灌输给模型。

### 4.3 强制反思机制 (Forced Reflection)

PwF 的反思不是靠 Agent 的“良心发现”，而是靠 **Hook (钩子)** 物理强制的：

1.  **PreToolUse Hook (行动前反思)**：
    - 还没动手（执行工具）之前，Context 里就被强行插入了 `task_plan.md` 的前 30 行。
    - **强制性**：Agent 不得不看一眼 Goal 再干活。这有效防止了“埋头苦干但跑偏了”的情况。

2.  **3-Strike Protocol (失败后反思)**：
    - 当 Action 失败时，Prompt 启动防御机制：
    - **Step 1**: 必须诊断 (Diagnose)。
    - **Step 2**: 必须换路 (Mutate Approach)。
    - **Step 3**: 必须重构 (Broader Rethink)。
    - 禁止“无脑重试” (Silent Retry)。

---

## 5. 终止与校验 (Termination & Verification)

**Q: 怎么知道任务结束了？**
**A: 也是靠 Hook 和 Script 构成的“硬栅栏”。**

`SKILL.md` 中定义了一个 `Stop` hook：
```yaml
Stop:
  - hooks:
      - command: "${CLAUDE_PLUGIN_ROOT}/scripts/check-complete.sh"
```

1.  **执行终止 (Termination)**：
    - 当 Agent 觉得自己做完了（想退出）时，触发 `Stop` hook。
    - 系统会运行 `check-complete.sh` 脚本。
    - 这个脚本会去**扫描 `task_plan.md`**。

2.  **校验机制 (Verification)**：
    - **扫描规则**：脚本检查是否所有的 Phase 都被标记为 `[x]` (Completed)。
    - **硬性拒绝**：如果发现哪怕一个 `[ ]` (Unchecked)，脚本会直接**报错**，拒绝 Agent 退出，并返回："Hey, Phase 3 is still incomplete!"
    - **自我修正**：Agent 收到这个报错后，必须回去继续干活，或者去更新 Plan 说明为什么这个 Phase 不需要做了。

这构成了一个闭环：**Plan 是神谕。只有 Plan 里的勾都打满了，Agent 才能下班。**

---

## 6. 总结：Planning with Files vs. Ralph

| 维度 | Ralph | Planning with Files |
| :--- | :--- | :--- |
| **核心策略** | **Context Reset** (重置) | **Context Engineering** (工程化管理) |
| **记忆介质** | `prd.json` (Queue) | `task_plan.md` (State Machine) |
| **执行载体** | 外部 Bash 脚本 (Hard Loop) | 内部 Agent Skill (Soft Hooks) |
| **优势** | 解决 Context 污染，适合流水线作业 | 解决 Context 遗忘，适合复杂探索任务 |
| **劣势** | 上下文割裂，难以处理跨步骤依赖 | Context 仍可能过载，依赖模型自觉性 |
| **角色比喻** | **工厂工人** (按单生产) | **研究员** (边走边记) |

**最佳实践建议：**
对于 OpenCowork 这样的复杂项目，可以采用 **Hybrid (混合) 模式**：
- 用 **Planning with Files** 模式来做顶层设计和调研（Architect）。
- 产出明确的 `prd.json`。
- 甩给 **Ralph** 去批量实现具体代码（Worker）。
