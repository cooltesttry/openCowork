# Super-Agent 开发方案（最小化）

目标：基于 Claude Agents SDK，先实现两个核心组件：调度器（Orchestrator）与 Worker。调度器驱动循环式执行；Worker 通过可配置参数（角色模板）运行单次任务；每轮输出持久化，支持中断恢复与最大循环控制。

---

## 1. 组件与职责

### 1.1 Worker（最小运行单元）
- 输入：WorkerConfig + TaskDefinition + TaskInput
- 输出：WorkerResult（结构化结果，含状态与产物）
- 主要配置参数：
  - model：模型类型/名称
  - mcp_servers：连接的 MCP 服务器列表
  - prompt：输入与输出的定义（系统/用户/结构化输出约束）
  - tools：允许/禁用工具列表

### 1.2 Orchestrator（调度器）
- 负责循环式编排：
  - 调用 Worker
  - 检查结果（Checker）
  - 若不达标，更新输入并继续循环
  - 直到合格或达到最大循环次数
- 负责运行控制：
  - 最大循环次数（max_cycles）
  - 每轮等待/超时
  - 触发重置策略（达到上限后的处理）
- 负责持久化与恢复：
  - 每轮结果落盘
  - 中断可恢复到最近一轮

---

## 2. 最小数据结构（建议）

### 2.1 WorkerConfig（角色模板）
- id / name
- model
- mcp_servers
- prompt
- tools_allow / tools_block

### 2.2 TaskDefinition（本次运行的项目/目的）
- task_id / name
- objective（目标描述）
- inputs（初始输入/上下文）
- expected_output（输出规范/格式）

### 2.3 SessionState（编排会话）
- session_id
- worker_config_ref
- task_ref
- status: pending | running | completed | failed
- cycle_count
- input_payload
- last_result
- history（每轮的结果与时间戳）

### 2.4 WorkspaceLayout（工作目录）
- base_dir: `super-agent/workspace/`
- session_dir: `super-agent/workspace/{session_id}/`
- outputs: `super-agent/workspace/{session_id}/outputs/`
- logs: `super-agent/workspace/{session_id}/logs/`
- state: `super-agent/workspace/{session_id}/state/`

---

## 3. 运行流程（最小闭环）

1. 创建 SessionState（pending）
2. 为 Session 创建对应工作目录
3. Orchestrator 启动循环：
   - 调用 Worker.run(input)
   - 结果写入 history 并持久化到 outputs/state
   - Checker(result) 判定是否合格
   - 不合格则更新 input，再次循环
4. 达标 -> completed；超限/异常 -> failed

---

## 4. 持久化与恢复

- 持久化内容：
  - SessionState（JSON，存入 state/）
  - 每轮结果（JSON，存入 outputs/）
  - 运行日志（文本/JSON，存入 logs/）
- 恢复策略：
  - 读取最新 SessionState
  - 从最后一次结果继续循环
  - 若中断，复用同一 session_dir，不新建目录

---

## 5. 里程碑（最小阶段）

### Step 1：骨架与持久化
- 定义 WorkerConfig / TaskDefinition / SessionState 数据结构
- SessionState JSON 持久化 + history 追加
- 统一工作目录结构（workspace/session）
- Orchestrator 循环驱动（无 SDK 细节）

### Step 2：接入 Claude Agents SDK
- Worker.run 接入 SDK
- 参数映射到 SDK（model/mcp/prompt/tools）
- 输出结构化结果落盘

### Step 3：Checker 与恢复
- Checker 接口与默认实现
- 恢复机制：从最新轮继续
- 最大循环/超时策略完善
