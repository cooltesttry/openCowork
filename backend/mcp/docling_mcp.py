#!/usr/bin/env python3
"""
Docling MCP Server - HTTP 版本 (支持异步轮询)
通过 HTTP 调用 docling-serve，支持异步任务轮询

使用前先启动: cd /Users/huawang/pyproject/docling && ./start-all.sh
"""

import sys
import json
import time
import re
import requests

DOCLING_URL = "http://localhost:5001"
MAX_WAIT_SECONDS = 120  # 最长等待时间

TOOLS = [
    {
        "name": "read",
        "description": "Read and convert documents to Markdown and image OCR. Supports PDF, DOCX, PPTX, XLSX, Image OCR.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "source": {"type": "string", "description": "Path to the document file"}
            },
            "required": ["source"]
        }
    },
    {
        "name": "extract_tables",
        "description": "Extract all tables from a document as structured JSON data.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "source": {"type": "string", "description": "Path to the document file"}
            },
            "required": ["source"]
        }
    }
]


def call_docling(source: str) -> dict:
    """调用 docling HTTP API (异步 + 轮询)"""
    # 1. 提交异步任务
    with open(source, 'rb') as f:
        resp = requests.post(
            f"{DOCLING_URL}/v1/convert/file/async",
            files={"files": f}
        )
    
    if resp.status_code != 200:
        raise Exception(f"Submit error: {resp.text}")
    
    result = resp.json()
    task_id = result.get("task_id")
    
    if not task_id:
        # 可能直接返回了结果
        return result
    
    # 2. 轮询等待结果
    start_time = time.time()
    while time.time() - start_time < MAX_WAIT_SECONDS:
        status_resp = requests.get(f"{DOCLING_URL}/v1/status/poll/{task_id}")
        if status_resp.status_code == 200:
            status = status_resp.json()
            task_status = status.get("task_status")
            if task_status == "success":
                # 3. 获取结果
                result_resp = requests.get(f"{DOCLING_URL}/v1/result/{task_id}")
                if result_resp.status_code == 200:
                    return result_resp.json()
                raise Exception(f"Result error: {result_resp.text}")
            elif task_status == "failure":
                raise Exception(f"Task failed: {status}")
        time.sleep(2)
    
    raise Exception(f"Timeout waiting for task {task_id}")


def strip_base64_images(md: str) -> str:
    """移除 markdown 中的 base64 图片"""
    return re.sub(r'!\[Image\]\(data:image[^)]+\)', '', md)


def handle_read(args: dict) -> str:
    result = call_docling(args["source"])
    # 返回 markdown
    md_content = ""
    if "document" in result:
        doc = result["document"]
        if isinstance(doc, dict):
            # 优先返回 md_content
            if "md_content" in doc:
                md_content = doc["md_content"]
            elif "md" in doc:
                md_content = doc["md"]
    if not md_content:
        md_content = result.get("markdown", result.get("content", json.dumps(result)))
    # 移除 base64 图片
    return strip_base64_images(md_content)


def handle_extract_tables(args: dict) -> str:
    result = call_docling(args["source"])
    tables = result.get("tables", [])
    return json.dumps(tables, ensure_ascii=False, indent=2)


def handle_request(req: dict) -> dict:
    method = req.get("method", "")
    req_id = req.get("id")
    
    if method == "initialize":
        return {"jsonrpc": "2.0", "id": req_id, "result": {
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "docling", "version": "1.0.0"}
        }}
    
    elif method == "tools/list":
        return {"jsonrpc": "2.0", "id": req_id, "result": {"tools": TOOLS}}
    
    elif method == "tools/call":
        params = req.get("params", {})
        name = params.get("name")
        args = params.get("arguments", {})
        
        try:
            if name == "read":
                content = handle_read(args)
            elif name == "extract_tables":
                content = handle_extract_tables(args)
            else:
                return {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32601, "message": f"Unknown tool: {name}"}}
            
            return {"jsonrpc": "2.0", "id": req_id, "result": {"content": [{"type": "text", "text": content}]}}
        except Exception as e:
            return {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32000, "message": str(e)}}
    
    elif method == "notifications/initialized":
        return None
    
    else:
        return {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32601, "message": f"Method not found: {method}"}}


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            resp = handle_request(req)
            if resp:
                print(json.dumps(resp), flush=True)
        except json.JSONDecodeError:
            pass


if __name__ == "__main__":
    main()
