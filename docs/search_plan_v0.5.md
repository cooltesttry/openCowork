# Full-Text + Vector Search Plan (v0.5)

Date: 2026-01-30

## Goals
- Full-text search + vector search over the workspace
- Offline, single-node, a few thousand files
- Multilingual (CJK + English)
- Memory files are Markdown

## Fixed Choices
- Full-text: SQLite FTS5
- Vector: sqlite-vec (loadable extension)
- Embedding: EmbeddingGemma GGUF 8-bit
- Runtime: llama.cpp `llama-server` (OpenAI-compatible embeddings endpoint)
- Document conversion: reuse existing FastAPI endpoint `POST /api/files/extract`

## Storage Layout
- Per-workspace SQLite file: `<workdir>/.opencowork/search/search.sqlite`
- Shared model file: `storage/models/embeddinggemma-q8_0.gguf`
- Shared sqlite-vec extension: `storage/bin/vec0.(dylib|so|dll)`
- Embedding server URL (default): `http://127.0.0.1:39289`

## Local Embedding Server
- Start via `start.sh` (launches `third_party/llama.cpp/build/bin/llama-server`)
- Logs: `/tmp/stockagent_embedding.log`

## Data Model (conceptual)
- documents
  - id, path, mtime, hash, type, language
- chunks
  - id, doc_id, text, start_line, end_line
- chunks_fts (FTS5)
  - chunk_id, tokens_text
- vec0 virtual table (sqlite-vec)
  - chunk_id, embedding

Notes:
- Exact sqlite-vec DDL and query syntax will follow sqlite-vec docs at implementation time.
- Embedding vector dimension follows the model output (EmbeddingGemma: 768).

## Indexing Pipeline
1. Scan target workdir (from app settings)
2. For each file:
   - If plain text / code / JSON / Markdown: read directly
   - If PDF/DOCX/PPTX/XLSX/HTML: call `POST /api/files/extract` and use returned Markdown
3. Normalize text (strip binary, normalize newlines)
4. Chunking (fixed window + overlap, e.g. 1500 chars, overlap ~250 chars)
5. Tokenize for FTS5:
   - English: regex
   - CJK: n-gram (2/3-gram) baseline
   - Optional: add jieba for Chinese precision
6. Insert into SQLite FTS5 + sqlite-vec

## Query Flow
1. Parse query, detect language
2. Run FTS5 BM25 query
3. Run sqlite-vec KNN query
4. Merge results (RRF or weighted normalization)
5. Return: path, snippet, scores

## API Design (proposed)
- POST `/api/search/index` (full rebuild)
- POST `/api/search/ingest` (single file or batch)
- POST `/api/search/query` (search; `mode=chunks|files`)
- GET `/api/search/status` (stats)

## Dependencies
- New (backend):
  - llama.cpp (`llama-server`) for embeddings
  - sqlite-vec extension (vec0)
  - numpy (embedding vectors, optional)
  - jieba or jieba-pyfast (optional CJK boost)
- Existing:
  - markitdown for `/api/files/extract`

## Phases
Phase 1:
- SQLite FTS5 + plain text indexing
- `/api/files/extract` for PDF/Office/HTML
- Basic BM25 search API

Phase 2:
- EmbeddingGemma GGUF + llama-cpp-python
- sqlite-vec vector search
- Hybrid ranking

Phase 3:
- CJK tokenization improvements (optional jieba)
- Memory Markdown parsing improvements

Phase 4:
- Incremental updates + file watcher integration

## Open Decisions
- sqlite-vec extension build/ship strategy
- Model file location and download workflow
- Index root selection (default_workdir vs custom)
