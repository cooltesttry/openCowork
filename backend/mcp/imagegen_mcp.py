#!/usr/bin/env python3
"""
Image Generation MCP Server - stdio 版本
通过 OpenAI 风格 API 调用生图模型

环境变量配置:
  IMAGEGEN_ENDPOINT - API URL (必须)
  IMAGEGEN_MODEL    - 模型名称 (必须)
  IMAGEGEN_API_KEY  - API Key (可选)
  IMAGEGEN_WORKDIR  - 默认输出目录 (默认: /tmp)
"""

import sys
import json
import os
import time
import base64
import uuid
import re
from io import BytesIO

import requests

# 尝试导入 PIL，用于获取图片尺寸
try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

# 从环境变量读取配置
ENDPOINT = os.environ.get("IMAGEGEN_ENDPOINT", "")
MODEL = os.environ.get("IMAGEGEN_MODEL", "")
API_KEY = os.environ.get("IMAGEGEN_API_KEY", "")
WORKDIR = os.environ.get("IMAGEGEN_WORKDIR", "/tmp")

SUBDIR_NAME = "_generate"

TOOLS = [
    {
        "name": "generate_image",
        "description": "Generate an image from a text prompt. Multiple reference images are supported. Returns the file path, mime type, and dimensions of the generated image.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "Text prompt describing the image to generate"
                },
                "filename": {
                    "type": "string",
                    "description": "Required. A descriptive name for the output image (no path, no extension)."
                },
                "images": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "(Optional) Reference image file paths for img2img generation. Must be absolute file paths."
                }
            },
            "required": ["prompt", "filename"]
        }
    }
]


def encode_image_to_base64(image_path: str) -> str:
    """将图片文件编码为 base64"""
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def load_image_as_base64_and_mime(image_path: str) -> tuple[str, str]:
    """从文件路径加载图片并返回 base64 和 MIME 类型
    
    Args:
        image_path: 绝对文件路径
        
    Returns:
        (base64_string, mime_type)
    """
    if not os.path.exists(image_path):
        raise FileNotFoundError(f"Image file not found: {image_path}")
    
    b64_str = encode_image_to_base64(image_path)
    with open(image_path, "rb") as f:
        img_header = f.read(12)
    mime_type = get_mime_type(img_header)
    return b64_str, mime_type


def get_image_dimensions(image_data: bytes) -> tuple[int, int]:
    """获取图片尺寸"""
    if HAS_PIL:
        img = Image.open(BytesIO(image_data))
        return img.size  # (width, height)
    return (0, 0)


def get_mime_type(image_data: bytes) -> str:
    """根据图片头部判断 MIME 类型"""
    if image_data[:8] == b'\x89PNG\r\n\x1a\n':
        return "image/png"
    elif image_data[:2] == b'\xff\xd8':
        return "image/jpeg"
    elif image_data[:6] in (b'GIF87a', b'GIF89a'):
        return "image/gif"
    elif image_data[:4] == b'RIFF' and image_data[8:12] == b'WEBP':
        return "image/webp"
    return "image/png"  # 默认


def extract_base64_from_data_url(data_url: str) -> tuple[bytes, str]:
    """从 data URL 中提取 base64 数据和 MIME 类型"""
    # 格式: data:image/jpeg;base64,/9j/4AAQ...
    if data_url.startswith("data:"):
        header, b64_data = data_url.split(",", 1)
        # 提取 MIME 类型
        mime_part = header.split(";")[0]  # data:image/jpeg
        mime_type = mime_part.replace("data:", "")  # image/jpeg
        return base64.b64decode(b64_data), mime_type
    # 纯 base64
    return base64.b64decode(data_url), "image/png"


def _sanitize_filename(value: str) -> str:
    base = os.path.basename(value or "")
    base = os.path.splitext(base)[0]
    base = re.sub(r"[^A-Za-z0-9_-]+", "-", base).strip("-")
    return base or "image"


def _resolve_output_path(root_dir: str, filename: str, ext: str) -> str:
    target_dir = os.path.join(os.path.abspath(root_dir), SUBDIR_NAME)
    os.makedirs(target_dir, exist_ok=True)

    base = _sanitize_filename(filename)
    candidate = os.path.join(target_dir, f"{base}{ext}")
    if not os.path.exists(candidate):
        return candidate

    # Avoid name collision with a short suffix.
    for _ in range(10):
        suffix = uuid.uuid4().hex[:4]
        candidate = os.path.join(target_dir, f"{base}-{suffix}{ext}")
        if not os.path.exists(candidate):
            return candidate

    # Fallback to a timestamp if collisions persist.
    suffix = str(int(time.time()))
    return os.path.join(target_dir, f"{base}-{suffix}{ext}")


def generate_image(prompt: str, filename: str, images: list = None) -> dict:
    """调用生图 API 并保存结果
    
    支持两种 API 格式:
    1. 标准 OpenAI /v1/images/generations 格式 (只使用第一张图片)
    2. Chat Completions 格式 (Gemini 风格，支持多张图片)
    
    Args:
        prompt: 生成图片的文本提示
        filename: 输出文件名（可不含扩展名）
        images: 参考图片文件路径列表 (可选)
    """
    if not ENDPOINT:
        raise ValueError("IMAGEGEN_ENDPOINT environment variable is not set")
    if not MODEL:
        raise ValueError("IMAGEGEN_MODEL environment variable is not set")
    if not filename or not str(filename).strip():
        raise ValueError("filename is required")

    output_root = WORKDIR
    
    # 构建请求头
    headers = {"Content-Type": "application/json"}
    if API_KEY:
        headers["Authorization"] = f"Bearer {API_KEY}"
    
    # 判断 API 类型: chat completions vs images generations
    is_chat_api = "/chat/completions" in ENDPOINT
    
    if is_chat_api:
        # Chat Completions 格式 (Gemini 风格) - 支持多张图片
        if images and len(images) > 0:
            content = [{"type": "text", "text": prompt}]
            
            # 添加所有参考图片
            for image_path in images:
                image_b64, img_mime = load_image_as_base64_and_mime(image_path)
                content.append({
                    "type": "image_url", 
                    "image_url": {"url": f"data:{img_mime};base64,{image_b64}"}
                })
            
            messages = [{"role": "user", "content": content}]
        else:
            messages = [{"role": "user", "content": prompt}]
        
        payload = {
            "model": MODEL,
            "messages": messages,
            "max_tokens": 4096
        }
    else:
        # 标准 OpenAI /v1/images/generations 格式 - 只支持单张图片
        payload = {
            "model": MODEL,
            "prompt": prompt,
            "n": 1,
            "response_format": "b64_json"
        }
        
        # 只使用第一张图片
        if images and len(images) > 0:
            image_b64, _ = load_image_as_base64_and_mime(images[0])
            payload["image"] = image_b64
    
    # 发送请求
    resp = requests.post(ENDPOINT, headers=headers, json=payload, timeout=180)
    
    if resp.status_code != 200:
        raise Exception(f"API error ({resp.status_code}): {resp.text}")
    
    result = resp.json()
    
    # 提取图片数据
    image_data = None
    mime_type = None
    note = None
    
    # Chat Completions 格式: choices[].message.images[]
    if "choices" in result and len(result["choices"]) > 0:
        choice = result["choices"][0]
        message = choice.get("message", {})
        
        # 提取文字内容
        if message.get("content"):
            note = message["content"]
        
        # 提取图片 (images 数组)
        images = message.get("images", [])
        if images and len(images) > 0:
            img_item = images[0]
            # 格式: {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,..."}}
            if isinstance(img_item, dict):
                img_url = img_item.get("image_url", {}).get("url", "")
                if img_url:
                    image_data, mime_type = extract_base64_from_data_url(img_url)
    
    # OpenAI /v1/images/generations 格式
    elif "data" in result and len(result["data"]) > 0:
        item = result["data"][0]
        
        if "b64_json" in item:
            image_data = base64.b64decode(item["b64_json"])
        elif "url" in item:
            img_resp = requests.get(item["url"], timeout=60)
            if img_resp.status_code == 200:
                image_data = img_resp.content
        
        if "revised_prompt" in item:
            note = item["revised_prompt"]
    
    # 非标准格式
    elif "image" in result:
        image_data = base64.b64decode(result["image"])
    elif "images" in result and len(result["images"]) > 0:
        image_data = base64.b64decode(result["images"][0])
    
    if not image_data:
        raise Exception(f"No image data in response: {json.dumps(result)[:500]}")
    
    # 确定文件格式和保存 (优先使用从 data URL 提取的 mime_type)
    if not mime_type:
        mime_type = get_mime_type(image_data)
    ext = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/gif": ".gif",
        "image/webp": ".webp"
    }.get(mime_type, ".png")

    # 生成输出路径（子目录 + 文件名，避免冲突）
    file_path = _resolve_output_path(output_root, filename, ext)
    
    with open(file_path, "wb") as f:
        f.write(image_data)
    
    # 获取尺寸
    width, height = get_image_dimensions(image_data)
    
    output = {
        "file_path": file_path,
        "mime_type": mime_type,
        "width": width,
        "height": height
    }
    
    if note:
        output["note"] = note
    
    return output


def handle_generate_image(args: dict) -> str:
    """处理 generate_image 工具调用"""
    prompt = args.get("prompt", "")
    filename = args.get("filename", "")
    images = args.get("images")  # 数组格式
    
    result = generate_image(prompt, filename, images)
    return json.dumps(result, ensure_ascii=False, indent=2)


def handle_request(req: dict) -> dict:
    """处理 JSON-RPC 请求"""
    method = req.get("method", "")
    req_id = req.get("id")
    
    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "imagegen", "version": "1.0.0"}
            }
        }
    
    elif method == "tools/list":
        return {"jsonrpc": "2.0", "id": req_id, "result": {"tools": TOOLS}}
    
    elif method == "tools/call":
        params = req.get("params", {})
        name = params.get("name")
        args = params.get("arguments", {})
        
        try:
            if name == "generate_image":
                content = handle_generate_image(args)
            else:
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32601, "message": f"Unknown tool: {name}"}
                }
            
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {"content": [{"type": "text", "text": content}]}
            }
        except Exception as e:
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32000, "message": str(e)}
            }
    
    elif method == "notifications/initialized":
        return None
    
    else:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32601, "message": f"Method not found: {method}"}
        }


def main():
    """主循环: 从 stdin 读取 JSON-RPC 请求"""
    # 启动日志 (写到 stderr，不影响 stdio 通信)
    sys.stderr.write(f"[imagegen] Starting MCP server\n")
    sys.stderr.write(f"[imagegen] ENDPOINT={ENDPOINT}\n")
    sys.stderr.write(f"[imagegen] MODEL={MODEL}\n")
    sys.stderr.write(f"[imagegen] WORKDIR={WORKDIR}\n")
    sys.stderr.flush()
    
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
            sys.stderr.write(f"[imagegen] JSON decode error: {e}\n")
            sys.stderr.flush()


if __name__ == "__main__":
    main()
