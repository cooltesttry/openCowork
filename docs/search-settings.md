# Search Settings Module (全文/向量检索)

本文档覆盖“搜索/设置模块”的整体实现与配置，包括代码结构、数据库设计、界面（UI）、CPP 组件、模型与接口算法。内容基于当前仓库实现。

## 1. 代码结构

**后端（FastAPI）**
- `backend/core/search/indexer.py`  
  索引构建与查询核心逻辑（分块、向量写入、FTS 写入、文件聚合、重排）。
- `backend/core/search/embeddings.py`  
  Embedding 提供器：支持 HTTP（llama-server）或本地 `llama-cpp-python`。
- `backend/core/search/extractors.py`  
  文本提取与二进制过滤；PDF/Office/HTML 走 MarkItDown。
- `backend/core/search/tokenizer.py`  
  FTS 分词策略（CJK 2/3-gram + 英文/数字 token）。
- `backend/core/search/paths.py`  
  索引库路径、向量扩展、模型路径、embedding server URL 规则。
- `backend/routers/search.py`  
  搜索 API：索引、查询、状态。
- `backend/models/search.py`  
  搜索请求/响应模型（`mode=files|chunks`、`rerank`、`alpha` 等）。
- `backend/models/settings.py` + `backend/routers/config.py`  
  设置模块（配置持久化、搜索设置、默认工作目录等）。

**前端（Next.js）**
- `frontend/src/app/search-lab/page.tsx`  
  Search Lab 页面：文件搜索 vs Retrieval 搜索；开关、路径过滤、rerank。
- `frontend/src/lib/api.ts`  
  API 根路径与配置读取。

**脚本与存储**
- `start.sh`  
  启动 backend/frontend/embedding server。
- `storage/config.json`  
  设置持久化（包含 `default_workdir` 与搜索配置）。
- `storage/bin/vec0.dylib`  
  sqlite-vec 向量扩展二进制。
- `storage/models/embeddinggemma-q8_0.gguf`  
  Embedding 模型默认路径。

## 2. 数据库设计

索引库路径：  
`<workdir>/.opencowork/search/search.sqlite`

表结构（`backend/core/search/indexer.py`）：

- `documents`
  - `id` INTEGER PRIMARY KEY
  - `path` TEXT UNIQUE
  - `filename` TEXT
  - `mtime` REAL
  - `size` INTEGER
  - `type` TEXT（文件后缀）
  - `language` TEXT（`cjk` / `en`）

- `chunks`
  - `id` INTEGER PRIMARY KEY
  - `doc_id` INTEGER (FK -> documents.id)
  - `text` TEXT
  - `start_line` INTEGER
  - `end_line` INTEGER

- `chunks_fts` (FTS5)
  - `text` TEXT（写入经过 token 化的文本）
  - `rowid == chunks.id`

- `vec_chunks` (sqlite-vec)
  - `chunk_id` INTEGER PRIMARY KEY
  - `embedding` FLOAT[768] (cosine)
  - `doc_id` INTEGER

数据库模式：
- `PRAGMA journal_mode = WAL`
- FTS 使用 `tokenize='unicode61'`，但文本先经过自定义 CJK 2/3-gram 处理。

**新目录初始化**
- 首次调用 `/api/search/index` 或 `/api/search/query` 会自动创建数据库与表（若文件不存在）。

## 3. 界面（UI）

Search Lab 页面：`frontend/src/app/search-lab/page.tsx`

核心功能：
- 双模式：  
  - **文件搜索**（`mode=files`）  
  - **Retrieval 搜索**（`mode=chunks`）
- 参数输入：
  - 内容关键词
  - 文件名关键词（文件搜索模式可选）
  - 路径过滤 `path_prefix`
  - `limit` / `vector_k`
- 开关：
  - 向量搜索 / 全文搜索 / 文件名搜索
- 重排：
  - RRF
  - BM25
  - Alpha 融合（0~1 slider）
- 结果展示：路径、片段、行号、RRF/score/BM25/distance

## 4. 源码（CPP）

**Embedding Server（llama.cpp）**
- 目录：`third_party/llama.cpp`
- 二进制：`third_party/llama.cpp/build/bin/llama-server`
- 启动方式：`start.sh` 自动启动  
  `llama-server -m storage/models/embeddinggemma-q8_0.gguf --embd-gemma-default --port 39289`

**向量扩展（sqlite-vec）**
- 二进制：`storage/bin/vec0.dylib`
- 通过 SQLite `load_extension()` 加载
- 源码不在仓库（仅包含构建产物）

## 5. 模型

默认 Embedding 模型：
- 路径：`storage/models/embeddinggemma-q8_0.gguf`
- 向量维度：768
- 默认服务地址：`http://127.0.0.1:39289`

可配置环境变量：
- `OPENCOWORK_EMBEDDING_MODEL_PATH`  
  覆盖 GGUF 模型路径
- `OPENCOWORK_EMBEDDING_SERVER_URL`  
  覆盖 embedding server URL
- `OPENCOWORK_VEC0_PATH`  
  覆盖 sqlite-vec 扩展路径

Prompt 格式（EmbeddingGemma 推荐）：
- Query：`task: search result | query: <query>`
- Document：`title: <filename> | text: <chunk>`

## 6. 接口与算法（你要求的实现细节）

### API 接口

**索引**
- `POST /api/search/index`
- body：`IndexRequest { workdir?, paths?, rebuild? }`
- `rebuild=true` 会删库重建

**搜索**
- `POST /api/search/query`
- body：`SearchRequest { query, limit, vector_k, use_vector, use_fts, path_prefix?, filename_query?, rerank, alpha, mode }`
- `mode=chunks` → Retrieval  
  `mode=files` → 文件级聚合

**状态**
- `GET /api/search/status?workdir=...`
- 返回文档数与 chunk 数

**设置（配置模块）**
- `GET/PUT /api/config/search`（SearchConfig：provider/api_key/max_results/enabled）
- `GET/PUT /api/config/agent`（default_workdir/allowed_tools/max_turns）
- `GET/PUT /api/config/model`（模型接口配置）

### 索引算法

1. **文件扫描**
   - `os.walk` 跳过隐藏目录（以 `.` 开头）。
2. **提取文本**
   - `.pdf/.docx/.pptx/.xlsx/.xls/.html` 走 MarkItDown
   - 其它文本按 UTF-8 读取
   - 二进制文件直接跳过
3. **分块**
   - `chunk_size = 1500 chars`
   - `overlap = 250 chars`
   - 记录 `start_line/end_line`
4. **FTS 写入**
   - 先用 CJK 2/3-gram + 英文 token 切词
   - 写入 `chunks_fts`
5. **向量写入**
   - 对每个 chunk 生成 embedding
   - 写入 `vec_chunks` (cosine)

### 搜索算法

**FTS 查询（BM25）**
- `chunks_fts MATCH <tokenized query>`
- `ORDER BY bm25(...)` （数值越小越好）

**向量查询（sqlite-vec）**
- `vec_chunks.embedding MATCH <query_embedding> AND k=?`
- `ORDER BY distance` （距离越小越好）

**重排策略**
- `rrf`：RRF 融合（rank-based）
- `bm25`：BM25 优先（只对 FTS 有意义）
- `alpha`：`score = (1-alpha)*fts_rank + alpha*vec_rank`

**文件级聚合**
- 从 chunk 结果聚合为文件结果  
  - `rrf/alpha`：取单文件最佳 chunk score  
  - `bm25`：取最佳（最小）bm25  
- 可叠加 `filename_query` 文件名匹配加分

### 路径过滤

`path_prefix` 可为相对路径，最终会 resolve 到工作目录下作为前缀匹配：
```
WHERE d.path LIKE '<prefix>%'
```

---

如需补充“新目录初始化策略”、更详细的 UI 流程或配置示例，我可以继续补充到该文档。  
