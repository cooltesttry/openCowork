#!/usr/bin/env python3
"""
Doc MCP Server

提供文档到 Markdown 的转换能力。
支持格式: Word (.docx), PowerPoint (.pptx), Excel (.xlsx, .xls), HTML

使用方法:
    python markitdown_mcp.py

MCP 配置:
    {
        "Doc": {
            "command": "python",
            "args": ["backend/mcp/markitdown_mcp.py"]
        }
    }
"""

import sys
import json
from pathlib import Path

# 支持的文件扩展名
SUPPORTED_EXTENSIONS = {'.docx', '.pptx', '.xlsx', '.xls', '.html', '.htm'}

# MCP 工具定义
TOOLS = [
    {
        "name": "read",
        "description": (
            "Read and convert documents to Markdown format. "
            "Supports: Word (.docx), PowerPoint (.pptx), Excel (.xlsx, .xls), HTML. "
            "Returns the document content as clean Markdown text."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Absolute path to the document file"
                }
            },
            "required": ["path"]
        }
    }
]

# 延迟加载 MarkItDown 实例
_markitdown_instance = None

def get_markitdown():
    """延迟导入并创建 MarkItDown 实例"""
    global _markitdown_instance
    if _markitdown_instance is None:
        try:
            # 抑制 pdfminer 等库的警告信息
            import warnings
            import logging
            warnings.filterwarnings("ignore")
            logging.getLogger("pdfminer").setLevel(logging.ERROR)

            from markitdown import MarkItDown
            _markitdown_instance = MarkItDown()
        except ImportError as e:
            raise RuntimeError(
                "MarkItDown not installed. Run: pip install 'markitdown[pdf,docx,pptx,xlsx,xls]'"
            ) from e
    return _markitdown_instance


def handle_read(args: dict) -> str:
    """处理 read 工具调用"""
    path_str = args.get("path", "")

    if not path_str:
        raise ValueError("Missing required parameter: path")

    path = Path(path_str)

    # 检查文件存在
    if not path.exists():
        raise FileNotFoundError(f"File not found: {path_str}")

    if not path.is_file():
        raise ValueError(f"Path is not a file: {path_str}")

    # 检查扩展名
    ext = path.suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(
            f"Unsupported file type: {ext}. "
            f"Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}"
        )

    # 转换文档
    md = get_markitdown()
    result = md.convert(str(path))

    return result.text_content


def handle_request(req: dict) -> dict | None:
    """处理 MCP 请求"""
    method = req.get("method", "")
    req_id = req.get("id")

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {
                    "name": "doc",
                    "version": "1.0.0"
                }
            }
        }

    elif method == "tools/list":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"tools": TOOLS}
        }

    elif method == "tools/call":
        params = req.get("params", {})
        name = params.get("name")
        args = params.get("arguments", {})

        try:
            if name == "read":
                content = handle_read(args)
            else:
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {
                        "code": -32601,
                        "message": f"Unknown tool: {name}"
                    }
                }

            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [{"type": "text", "text": content}]
                }
            }
        except Exception as e:
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {
                    "code": -32000,
                    "message": str(e)
                }
            }

    elif method == "notifications/initialized":
        # 通知消息不需要响应
        return None

    else:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {
                "code": -32601,
                "message": f"Method not found: {method}"
            }
        }


def main():
    """MCP 服务器主循环"""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            req = json.loads(line)
            resp = handle_request(req)
            if resp:
                print(json.dumps(resp), flush=True)
        except json.JSONDecodeError as e:
            # 无效 JSON，跳过
            error_resp = {
                "jsonrpc": "2.0",
                "id": None,
                "error": {
                    "code": -32700,
                    "message": f"Parse error: {str(e)}"
                }
            }
            print(json.dumps(error_resp), flush=True)


if __name__ == "__main__":
    main()
