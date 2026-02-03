"""
Image Generation Router

Provides REST API for image generation using configured AI model.
"""

import os
import base64
import uuid
import time
import re
from pathlib import Path
from typing import Optional, List

import requests
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter()

SUBDIR_NAME = "_generate"


class GenerateImageRequest(BaseModel):
    prompt: str
    filename: Optional[str] = None
    reference_images: Optional[List[str]] = None  # List of data URLs


class GenerateImageResponse(BaseModel):
    status: str
    file_path: str
    mime_type: str
    width: int
    height: int
    note: Optional[str] = None


def get_mime_type_from_header(image_data: bytes) -> str:
    """Determine MIME type from image header bytes."""
    if image_data[:8] == b'\x89PNG\r\n\x1a\n':
        return "image/png"
    elif image_data[:2] == b'\xff\xd8':
        return "image/jpeg"
    elif image_data[:6] in (b'GIF87a', b'GIF89a'):
        return "image/gif"
    elif image_data[:4] == b'RIFF' and len(image_data) >= 12 and image_data[8:12] == b'WEBP':
        return "image/webp"
    return "image/png"


def get_image_dimensions(image_data: bytes) -> tuple[int, int]:
    """Get image dimensions using PIL if available."""
    try:
        from PIL import Image
        from io import BytesIO
        img = Image.open(BytesIO(image_data))
        return img.size
    except ImportError:
        return (0, 0)


def extract_base64_from_data_url(data_url: str) -> tuple[bytes, str]:
    """Extract binary data and MIME type from a data URL."""
    if data_url.startswith("data:"):
        header, b64_data = data_url.split(",", 1)
        mime_part = header.split(";")[0]
        mime_type = mime_part.replace("data:", "")
        return base64.b64decode(b64_data), mime_type
    return base64.b64decode(data_url), "image/png"


def sanitize_filename(value: str) -> str:
    """Sanitize filename to be filesystem-safe."""
    base = os.path.basename(value or "")
    base = os.path.splitext(base)[0]
    base = re.sub(r"[^A-Za-z0-9_-]+", "-", base).strip("-")
    return base or "image"


def resolve_output_path(root_dir: str, filename: str, ext: str) -> str:
    """Generate a unique output path for the generated image."""
    target_dir = os.path.join(os.path.abspath(root_dir), SUBDIR_NAME)
    os.makedirs(target_dir, exist_ok=True)

    base = sanitize_filename(filename)
    candidate = os.path.join(target_dir, f"{base}{ext}")
    if not os.path.exists(candidate):
        return candidate

    # Avoid name collision with a short suffix
    for _ in range(10):
        suffix = uuid.uuid4().hex[:4]
        candidate = os.path.join(target_dir, f"{base}-{suffix}{ext}")
        if not os.path.exists(candidate):
            return candidate

    # Fallback to timestamp
    suffix = str(int(time.time()))
    return os.path.join(target_dir, f"{base}-{suffix}{ext}")


@router.post("/generate", response_model=GenerateImageResponse)
async def generate_image(request: Request, body: GenerateImageRequest):
    """
    Generate an image from a text prompt with optional reference images.

    Uses the configured image generation endpoint (OpenAI or Chat Completions format).
    """
    settings = request.app.state.settings
    image_gen_config = settings.image_gen

    # Get endpoint name and model from image_gen config
    endpoint_name = image_gen_config.selected_endpoint
    model_name = image_gen_config.model_name

    if not endpoint_name:
        raise HTTPException(status_code=400, detail="Image generation endpoint not configured")
    if not model_name:
        raise HTTPException(status_code=400, detail="Image generation model not configured")

    # Find the endpoint configuration in model.endpoints
    endpoint_config = None
    for ep in settings.model.endpoints:
        if ep.name == endpoint_name:
            endpoint_config = ep
            break

    if not endpoint_config or not endpoint_config.endpoint:
        raise HTTPException(
            status_code=400,
            detail=f"Endpoint '{endpoint_name}' not found or has no URL configured"
        )

    # Get output directory
    workdir = settings.default_workdir or os.getcwd()

    # Generate filename if not provided
    filename = body.filename or f"generated-{uuid.uuid4().hex[:8]}"

    # Build request headers
    headers = {"Content-Type": "application/json"}
    if endpoint_config.api_key:
        headers["Authorization"] = f"Bearer {endpoint_config.api_key}"

    # Build API URL - append /v1/chat/completions if needed (same logic as agent_client.py)
    api_url = endpoint_config.endpoint
    if not api_url.endswith("/chat/completions") and not api_url.endswith("/images/generations"):
        api_url = api_url.rstrip("/") + "/v1/chat/completions"

    # Determine API format
    is_chat_api = "/chat/completions" in api_url

    if is_chat_api:
        # Chat Completions format (Gemini style) - supports multiple images
        if body.reference_images and len(body.reference_images) > 0:
            content = [{"type": "text", "text": body.prompt}]

            for ref_image in body.reference_images:
                # Reference images are already data URLs
                content.append({
                    "type": "image_url",
                    "image_url": {"url": ref_image}
                })

            messages = [{"role": "user", "content": content}]
        else:
            messages = [{"role": "user", "content": body.prompt}]

        payload = {
            "model": model_name,
            "messages": messages,
            "max_tokens": 4096
        }
    else:
        # Standard OpenAI /v1/images/generations format
        payload = {
            "model": model_name,
            "prompt": body.prompt,
            "n": 1,
            "response_format": "b64_json"
        }

        # Only use first reference image for this format
        if body.reference_images and len(body.reference_images) > 0:
            ref_bytes, _ = extract_base64_from_data_url(body.reference_images[0])
            payload["image"] = base64.b64encode(ref_bytes).decode("utf-8")

    # Make API request
    try:
        resp = requests.post(
            api_url,
            headers=headers,
            json=payload,
            timeout=180
        )
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Failed to connect to image generation API: {str(e)}")

    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=f"API error: {resp.text[:500]}")

    result = resp.json()

    # Extract image data
    image_data = None
    mime_type = None
    note = None

    # Chat Completions format: choices[].message.images[]
    if "choices" in result and len(result["choices"]) > 0:
        choice = result["choices"][0]
        message = choice.get("message", {})

        if message.get("content"):
            note = message["content"]

        images = message.get("images", [])
        if images and len(images) > 0:
            img_item = images[0]
            if isinstance(img_item, dict):
                img_url = img_item.get("image_url", {}).get("url", "")
                if img_url:
                    image_data, mime_type = extract_base64_from_data_url(img_url)

    # OpenAI /v1/images/generations format
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

    # Non-standard formats
    elif "image" in result:
        image_data = base64.b64decode(result["image"])
    elif "images" in result and len(result["images"]) > 0:
        image_data = base64.b64decode(result["images"][0])

    if not image_data:
        raise HTTPException(status_code=500, detail="No image data in API response")

    # Determine file format
    if not mime_type:
        mime_type = get_mime_type_from_header(image_data)

    ext = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/gif": ".gif",
        "image/webp": ".webp"
    }.get(mime_type, ".png")

    # Save image
    file_path = resolve_output_path(workdir, filename, ext)

    with open(file_path, "wb") as f:
        f.write(image_data)

    # Get dimensions
    width, height = get_image_dimensions(image_data)

    return GenerateImageResponse(
        status="success",
        file_path=file_path,
        mime_type=mime_type,
        width=width,
        height=height,
        note=note
    )
