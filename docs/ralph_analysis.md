# Ralph 架构深度分析

Ralph 是一个**自主编码代理循环（Autonomous Coding Agent Loop）**系统，旨在解决长程编码任务中的上下文退化（Context Decay）和目标漂移（Goal Drift）问题。

它的核心理念是：**"Context Reset"（上下文重置）**。

与传统的长对话模式不同，Ralph 将大型任务切分为一系列**原子化的短迭代**。在每次迭代中，Agent 都是一个全新的进程，拥有干净的上下文窗口，通过文件系统（`prd.json`, `progress.txt`, git） "继承" 之前的记忆。

---

## 1. 核心执行流程 (`ralph.sh`)

`ralph.sh` 是整个系统的编排器（Orchestrator）。它本质上是一个简单的 Bash 脚本，负责管理生命周期、工具调用和状态归档。

### 1.1 初始化与归档机制
脚本首先检查是否切换了 Git 分支。如果检测到新分支（即新功能开发）：
- 它会自动将上一次运行的 `prd.json` 和 `progress.txt` **归档**到 `archive/` 目录。
- 初始化新的 `progress.txt`。
- **目的**：防止不同任务之间的状态污染（State Pollution），确保 Agent 专注于当前功能的 PRD。

### 1.2 循环执行 (The Loop)
默认运行 10 次迭代（可配置）。单次迭代流程如下：

1.  **启动 Agent**：调用 `amp` 或 `claude`（Claude Code）。
    - *Amp 模式*: `cat prompt.md | amp`
    - *Claude 模式*: `claude < CLAUDE.md`
    - **关键点**：每次调用都是全新的进程。Agent 不知道之前的历史，除非它去读取文件。
2.  **捕获输出**：将 Agent 的标准输出和标准错误重定向捕获。
3.  **终止判断**：检查输出中是否包含 `<promise>COMPLETE</promise>` 标记。
    - **是**：任务全部完成，退出循环 (Exit 0)。
    - **否**：休眠 2 秒，进入下一次迭代。
4.  **超时处理**：如果达到最大迭代次数仍未收到完成信号，则以此报错退出。

### 1.3 任务分发机制 (Task Selection)

这是一个关键设计：**任务是由模型自己"拉取" (Pull) 的，而不是脚本"推送" (Push) 的。**

- **脚本 (`ralph.sh`)**：完全不知道当前还有什么任务。它只负责"唤醒" Agent。
- **Agent (模型)**：
    1. 醒来后读取 `prd.json`。
    2. 遍历列表，寻找 `priority` 最高（数值通常最小，如 1）且 `passes: false` 的项目。
    3. 自主决定："好吧，这次迭代我做 Story #3"。

这种机制的好处是 **Self-Healing（自愈）**：如果上一次迭代 Agent 尝试做 Story #3 但失败了（没有标记 `passes: true`），下一次唤醒的新 Agent 会再次看到 Story #3 仍然是未完成状态，从而自动重试。

### 1.4 任务队列与强制顺序

`prd.json` 本质上是一个**优先队列 (Priority Queue)**。
- **容量**：可以包含任意数量的故事（10个、20个甚至更多）。
- **顺序强制性**：是的，有强制顺序。Prompt 明确要求 "Pick the **highest priority** user story"。
    - 这意味着如果 `Story A (Priority 1)` 没有完成 (`passes: false`)，Agent **绝对不会** 去碰 `Story B (Priority 2)`。
    - 这保证了依赖关系（先建表，再写 API，再写 UI）得到严格遵守。

### 1.5 动态修改权限 (Dynamic Modification)

用户常问：**模型能改 PRD 里的需求吗？**

答案是：**能力上有 (Yes)，但指令上没有 (No)。**

1.  **物理能力**：Agent 拥有写文件的工具，所以它 *技术上* 完全可以打开 `prd.json` 把 Story 4 删掉，或者把 Priority 改掉。
2.  **指令约束**：Prompt 明确规定了它的权限仅限于：
    > "Update the PRD to set `passes: true` for the completed story"
    
    标准版的 Ralph **不鼓励** Agent 可以在运行时修改需求（Scope Creep）。`prd.json` 被视为“神谕”（Word of God），Agent 的职责是**执行**而非**质疑**。
    
    *例外情况*：如果你想做一个更高级的“自适应 Ralph”，你完全可以修改 Prompt，告诉它：“发现行不通时，可以修改后续的 Story 描述”。但这是高级用法，不是默认行为。

### 1.6 Story 的生成时机 (The Lifecycle)

你需要区分 **Planning（规划）** 和 **Execution（执行）** 两个阶段：

1.  **Planning 阶段（循环启动前）**：
    - 这是“产生很多 Story”的时刻。
    - 通常由人类或另一个 AI（如 `skills/ralph`）将一个通过自然语言描述的“大功能”拆解为 10~20 个细粒度的 **User Stories**。
    - **这个阶段是爆炸式的**：1 个需求 -> N 个 Stories。
    - 产物是固定的 `prd.json`。

2.  **Execution 阶段（循环运行中）**：
    - 这是 Ralph 运行的时刻。
    - Agent 只是**消费**这些 Story，通常**不会产生**新的 Story。
    - 如果某个 Story 太大导致 Agent 做不完，标准流程是 Agent 失败（超时或报错），然后要求人类重新拆分 `prd.json`，而不是 Agent 自己在运行时拆分。

---

## 2. Prompt 设计架构

Ralph 的 Prompt (`prompt.md` / `CLAUDE.md`) 是其智能的核心。它不是一个简单的 "帮我写代码" 指令，而是一个**递归算法**的自然语言描述。

### 2.1 角色定义
> "You are an autonomous coding agent working on a software project."

### 2.2 递归算法步骤 (The Algorithm)
Prompt 明确规定了 Agent 在每次生命周期中必须严格执行的 10 个步骤：

1.  **上下文恢复 (Context Recovery)**：
    - 读取 `prd.json` 获取任务列表。
    - 读取 `progress.txt` 获取历史进度和**代码库模式 (Codebase Patterns)**。
2.  **分支管理**：
    - 检查当前 Git 分支是否符合 PRD 要求，不符合则切换/创建。
3.  **原子任务选择**：
    - 选择**优先级最高**且 `passes: false` 的**单个**用户故事 (Story)。
    - **原则**：One Iteration, One Story (一次迭代，一个故事)。
4.  **执行与验证**：
    - 实现代码。
    - 运行质量检查（Lint, Test, Typecheck）。
    - **强制浏览器测试**（针对前端任务）：要求加载 `dev-browser` skill 并截图验证。
5.  **知识外化 (Knowledge Externalization)**：
    - 将发现的**可重用模式 (Reusable Patterns)** 更新到 `progress.txt` 顶部的 `Codebase Patterns` 区域。
    - 将目录特定的知识更新到局部的 `AGENTS.md` / `CLAUDE.md` 文件中。
6.  **状态提交**：
    - 只有在检查通过后才 Commit 代码。
    - 更新 `prd.json` 中该 Story 的状态为 `passes: true`。
    - 追加日志到 `progress.txt`。

### 2.3 终止条件 (Stop Condition)
Agent 必须在每次任务完成后自我检查：
- 只有当 `prd.json` 中**所有** Story 都为 `passes: true` 时，才输出 `<promise>COMPLETE</promise>`。
- 否则，正常结束回复（让外部 shell 脚本启动下一个 Agent 实例）。

### 2.4 System Prompt 定量分析 (Quantitative Analysis)

我对 `prompt.md` 进行了逐条拆解和统计，发现它虽然短小（约 100 行），但包含 **约 41 条** 明确的指令。这些指令可以被精确地分为四大类：

| 类别 | 占比 | 关键指令示例 | 作用 |
| :--- | :--- | :--- | :--- |
| **1. 流程控制 (Flow Control)** | ~35% | "Read PRD", "Pick highest priority", "Stop Condition" | 定义 Agent 的**算法生命周期** (The Loop)。 |
| **2. 记忆管理 (Memory Mgmt)** | ~35% | "Append to progress.txt", "Update AGENTS.md", "Consolidate Patterns" | 定义**读写状态**的方式，防止健忘。 |
| **3. 质量保证 (QA)** | ~20% | "Run quality checks", "Browser Testing", "Do NOT commit broken code" | 定义**裁判**标准，强制自我反思。 |
| **4. 元指令 (Meta)** | ~10% | "Work on ONE story", "Keep changes focused" | 定义**行为准则**，防止目标漂移。 |

这种 **3:3:2** 的比例分布非常健康：它花了同样多的篇幅在“怎么做” (Flow) 和“怎么记” (Memory) 上，这是 Autonomous Agent 能够长期稳定运行的秘诀。

---

## 3. 状态管理系统 (State Management)

Ralph 摒弃了向量数据库等复杂记忆，采用了最原始但有效的**文件系统记忆**。

### 3.1 任务队列 (`prd.json`)
结构化的任务清单，充当短期记忆（Short-term Memory）和进度条。
- 包含：Story ID, Description, Priority, **Passes (Boolean)**。
- Agent 直接修改此文件来标记进度。

### 3.2 长期记忆 (`progress.txt`)
Append-only 的日志文件，充当长期记忆（Long-term Memory）。

**文件格式规范（由 Prompt 严格定义）：**

```markdown
# Ralph Progress Log
## Codebase Patterns (置顶区 - 全局知识)
- Example: Use `sql<number>` template for aggregations
- Example: Always use `IF NOT EXISTS` for migrations

Started: Fri Jan 24...
---
## [Date/Time] - [Story ID] (日志区 - 追加记录)
Thread: https://ampcode.com/threads/xxxx
- What was implemented
- Files changed
- **Learnings for future iterations:** (最重要的部分!)
  - Patterns discovered (发现的模式)
  - Gotchas encountered (踩过的坑)
  - Useful context (有用的上下文)
---
...
```

**关键机制：**
- **Section 1: Codebase Patterns**（置顶）：存放全局架构规范，会随着迭代不断丰富。Prompt 要求 Agent "Only add patterns that are **general and reusable**"。
- **Section 2: Iteration Log**（追加）：记录每次迭代的流水账。
  - **Learnings**: 这是核心。Prompt 强调 "The learnings section is critical"。它强制 Agent 在退出前把脑子里的知识“dump”到硬盘上，供下一任 Agent 读取。

### 3.4 关于重复执行的记录 (Retry Logs)

**如果同一个 Story 执行了多次，`progress.txt` 会有重复记录吗？**

**是的，绝对会有。** 这正是 append-only 设计的特性。

假设 Story 1 很难，Agent 尝试了 3 次才通过：
- **Iteration 1**: 尝试做 Story 1 -> 失败/报错 -> 记录 "Unable to migrate DB..." -> 退出。
- **Iteration 2**: 读取 Story 1 (仍是 false) -> 重试 -> 修复了 DB 但测试没过 -> 记录 "Fixed DB, but tests failed..." -> 退出。
- **Iteration 3**: 读取 Story 1 (仍是 false) -> 重试 -> 此时结合了前两次的 Learnings -> 成功 -> 记录 "Completed Story 1" -> 更新 `prd.json`。

**`progress.txt` 会完整保留这 3 次的历史**。
这非常有价值，因为它不仅仅是“进度条”，更是一份完整的**调试日志（Debug Trail）**。当人类回头检查时，能清楚地看到 Agent 是如何一步步试错并最终成功的。

### 3.5 成果判断与错误传播 (Feedback Loop)

**Q: 模型怎么知道自己是成功还是失败的？**
**A: 通过工具调用的返回结果。**

模型在运行步骤 6 "Run quality checks" 时，会调用终端工具运行命令（如 `npm test` 或 `tsc`）。
- **模型“看到”了终端输出**：如果不通过，它会看到红色的 Error 报错信息。
- **自我感知**：模型此时就知道“我失败了”。

**Q: 错误信息是谁写入的？**
**A: 是模型自己（Agent）写入的。**

这是一个由 Agent **自报告 (Self-Reporting)** 的机制，而不是外部监控机制。
- **Prompt 的要求**：无论成功失败，最后一步都是 "Append progress to progress.txt"。
- **失败时的行为**：如果测试挂了，Agent 应该（依据 Prompt 中的 `Learnings` 指令）在日志里写下：“尝试实现功能，但在运行测试时遇到了 XYZ 错误，怀疑是 Schema 没更新。”
- **下一轮的参考**：下一个 Agent 醒来看到这条“遗言”，就知道先去修 Schema，而不是重蹈覆辙。

**风险点**：如果 Agent 在运行中途直接**崩溃**（Crash，例如网络断开或 token 超限），甚至没来得及写 `progress.txt` 就退出了，那么这次迭代的教训就会**彻底丢失**。这是 Ralph 架构的一个已知局限性。

### 3.3 局部记忆 (`AGENTS.md` / `CLAUDE.md`)
这是一种**分布式知识库**模式。
- Agent 被鼓励在修改某个目录时，检查该目录下是否有 `AGENTS.md`。
- 如果有，就将关于该模块的特定知识（如测试命令、目录结构约定）写入其中。
- 这使得知识**物理地**靠近代码，随代码库一起演进。

---

## 4. 执行与验证指令详解 (Execution & Verification Prompts)

是的，在 Ralph 架构中，**Player (执行者) 和 Referee (裁判/验证者) 是同一个 Agent**。它既要写代码，又要自己负责测试代码。

以下是 `prompt.md` 中关于这两个环节的具体指令原文与解析：

### 4.1 规定“如何执行” (How to Execute)

这是 Prompt 中的 **Your Task** 部分，它定义了执行的原子步骤：

> **5. Implement that single user story**
> **105. Work on ONE story per iteration**
> **107. Keep CI green**

以及 **Quality Requirements（质量要求）** 部分：

> **77. Keep changes focused and minimal**
> **78. Follow existing code patterns**

**解析**：
指令非常精简。它没有教 Agent *如何写代码*（因为模型本身就会），而是重点约束了 *工作范围*：
- **"ONE story per iteration"**：这是最重要的约束。防止 Agent 贪多嚼不烂，试图一次性把所有功能都写了。
- **"Focused and minimal"**：要求最小化改动，降低破坏现有代码的风险。

### 4.2 规定“如何验证” (How to Verify)

验证分为两个层面：**代码层面**（CI/Test）和 **视觉层面**（Browser）。

#### A. 代码级验证 (Automated Checks)

Prompt 在主流程中明确要求：

> **6. Run quality checks (e.g., typecheck, lint, test - use whatever your project requires)**

并在下方再次强调：

> **75. ALL commits must pass your project's quality checks (typecheck, lint, test)**
> **76. Do NOT commit broken code**

**解析**：
这赋予了 Agent **“自我否决权”**。如果它运行 `npm test` 失败了，Prompt 明确禁止它提交代码（Do NOT commit）。这就强迫 Agent 必须进入 "Fix -> Retry" 的循环，或者在失败日志中承认自己做不到。

#### B. 视觉级验证 (Browser Verification) - *针对前端*

这是 Ralph 比较独特的地方，它强制要求进行浏览器交互测试：

> **83. Browser Testing (Required for Frontend Stories)**
>
> For any story that changes UI, you MUST verify it works in the browser:
>
> 1. Load the `dev-browser` skill
> 2. Navigate to the relevant page
> 3. Verify the UI changes work as expected
> 4. Take a screenshot if helpful for the progress log
>
> **92. A frontend story is NOT complete until browser verification passes.**

**解析**：
对于前端任务，光通过单元测试是不够的。Ralph 强迫 Agent 使用 `dev-browser` 工具去“看”一眼。如果 Agent 偷懒不看，它就违反了 "NOT complete until..." 的指令。

---

## 5. 关于死循环与偷懒 (Infinite Loops & Laziness)

你提到的两个问题是所有 Autonomous Agent 的通病。Ralph 的架构通过“短迭代”缓解了这个问题，但在 Prompt 层面可以做得更好。

### 5.1 针对“死循环” (Stubbornness)
你在 Claude Code 中遇到的“在一个轮次里反复尝试同样的错误”，在 Ralph 中通过 **Context Reset (上下文重置)** 得到了部分解决。
- **机制**：Ralph 强制每次迭代都是新的。
- **效果**：即使 Agent 在第 N 次迭代中陷入了思维定势（钻牛角尖），只要它没能提交代码并退出（或者超时被 kill），第 N+1 次迭代的 Agent 会是一个“新的人”，它不会背负上一个人的思维包袱。

**Prompt 中的相关约束**：
不幸的是，当前的 `prompt.md` **并没有显式禁止**而在单次迭代内部的死循环。它依赖于外部的 `ralph.sh` 设置超时（虽然脚本里只有简单的 sleep，没有复杂的 timeout 逻辑，这是一个改进点）。

### 5.2 针对“偷懒/改需求” (Laziness/Goal Drift)
Prompt 通以下几点来对抗“更改意图”：

1.  **"Do NOT commit broken code"**：
    禁止为了提交而提交。如果测试不过，绝对不允许提交。这防止了 Agent 提交烂代码来糊弄事。

2.  **"One story per iteration"**：
    通过极大地缩小任务范围，降低了 Agent 感到“太难了，我要走捷径”的心理压力。

3.  **缺乏显式的“承认失败”指令**：
    你观察得很敏锐。当前的 Prompt **缺少** 一条明确的指令，例如：
    > "If you cannot solve the problem after 3 attempts, STOP and write your findings in progress.txt. Do NOT try to bypass the requirements."
    
    加上这条指令会显著改善你提到的“偷懒”问题。目前的 Prompt 倾向于让 Agent 只要没做完就别停（直到超时），这确实可能导致 Agent 试图通过降低标准来达成 "Pass"。

---

## 6. 终止机制详解 (Termination Logic)

系统的终止依赖于 Agent 与脚本之间的 **“暗号”握手 (Handshake)**。

### 6.1 Agent 侧的判断
Prompt 中有一个明确的 **"Stop Condition"** 章节：
> **96. After completing a user story, check if ALL stories have `passes: true`.**
> **99. If ALL stories are complete and passing, reply with: `<promise>COMPLETE</promise>`**

Agent 在每次做完手头的工作后，必须“回头看一眼” `prd.json`。只有当它确认清单里 **所有** 任务的状态都变成了 `true`，它才会输出这个特殊的 XML 标签。

### 6.2 脚本侧的监听 (`ralph.sh`)
Bash 脚本通过 `grep` 监听 Agent 的输出：
```bash
# woody.sh line 99
if echo "$OUTPUT" | grep -q "<promise>COMPLETE</promise>"; then
  echo "Ralph completed all tasks!"
  exit 0
fi
```
- **从不主动停止**：只要没看到这个暗号，脚本就会认为“活还没干完”，无脑启动下一次迭代。
- **保底机制**：脚本有一个 `MAX_ITERATIONS`（默认 10），防止 Agent 永远不发暗号导致无限循环消耗 Token。

---

## 7. 总结：Ralph vs. 传统 Agent

| 特性 | 传统 Agent (Long Session) | Ralph (Autonomous Loop) |
| :--- | :--- | :--- |
| **上下文窗口** | 随时间填满，最终溢出或产生幻觉 | **永久清新**，每次迭代都是空状态 |
| **记忆方式** | 隐式（Implicit），在聊天记录中 | **显式（Explicit）**，在文件中 (`progress.txt`) |
| **错误恢复** | 容易陷入错误循环 | 失败的迭代不会污染下一次（可以通过回滚 Git 重试） |
| **可扩展性** | 难以处理超大任务 | 理论上可以无限循环，直到处理完 100+ 个 Story |
| **操作模式** | "Copilot" (副驾驶) | "Factory Worker" (流水线工人) |
