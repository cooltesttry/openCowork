import os
import shutil
import subprocess
from pathlib import Path
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Form, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

router = APIRouter()

class FileItem(BaseModel):
    name: str
    path: str
    is_directory: bool
    size: Optional[int] = None
    modified_at: Optional[float] = None

class CreateFileRequest(BaseModel):
    path: str
    is_directory: bool = False

class RenameFileRequest(BaseModel):
    old_path: str
    new_path: str

class MoveFileRequest(BaseModel):
    source_path: str
    destination_path: str
    force: bool = False  # If True, overwrite existing file/folder

class DeleteFileRequest(BaseModel):
    path: str

class DuplicateFileRequest(BaseModel):
    path: str

class OpenFileRequest(BaseModel):
    path: str

class SaveFileRequest(BaseModel):
    path: str
    content: str


def get_safe_path(base_dir: str, relative_path: str) -> Path:
    """
    Resolve and verify that the path is within the base_dir.
    """
    try:
        # Resolve base dir
        base = Path(base_dir).resolve()
        # Resolve target path
        # Normalize relative path to avoid leading slashes causing issues
        clean_rel = relative_path.lstrip('/')
        target = (base / clean_rel).resolve()
        
        # Check if target is relative to base
        if not str(target).startswith(str(base)):
             raise HTTPException(status_code=403, detail="Access denied: Path is outside workspace.")
        
        return target
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid path: {str(e)}")


# Forbidden directories for security (system-sensitive paths)
FORBIDDEN_DIRS = ['/etc', '/var', '/usr', '/System', '/Library', '/private', '/bin', '/sbin']

def resolve_file_path(workdir: str, path: str) -> Path:
    """
    Resolve a file path - supports both relative paths (within workdir) 
    and absolute paths (with security restrictions).
    """
    if path.startswith('/'):
        # Absolute path - resolve and check against forbidden dirs
        target_path = Path(path).resolve()
        for forbidden in FORBIDDEN_DIRS:
            if str(target_path).startswith(forbidden):
                raise HTTPException(status_code=403, detail="Access denied: System directory")
        return target_path
    else:
        # Relative path - use workdir as base
        if not workdir:
            raise HTTPException(status_code=500, detail="Default working directory not configured.")
        return get_safe_path(workdir, path)

@router.get("/list")
async def list_files(request: Request, path: str = "", recursive: bool = True):
    """
    List files in a directory relative to WORK_DIR.
    Default returns root files.
    If recursive=True, returns all nested files and directories in a flat list.
    """
    settings = request.app.state.settings
    workdir = settings.default_workdir
    if not workdir:
        raise HTTPException(status_code=500, detail="Default working directory not configured.")
    
    target_path = get_safe_path(workdir, path)
    
    if not target_path.exists():
         raise HTTPException(status_code=404, detail="Directory not found.")
    
    if not target_path.is_dir():
         raise HTTPException(status_code=400, detail="Path is not a directory.")

    results = []
    ignored = {'.git', '.DS_Store', '__pycache__', 'node_modules', '.venv', '.next'}
    
    try:
        if recursive:
            # Recursive scan - walk all subdirectories
            base_path = Path(workdir).resolve()
            for root, dirs, files in os.walk(target_path):
                # Filter ignored directories in-place to prevent walking into them
                dirs[:] = [d for d in dirs if d not in ignored]
                
                # Add directories
                for dir_name in sorted(dirs):
                    dir_path = Path(root) / dir_name
                    rel_route = str(dir_path.relative_to(base_path))
                    results.append(FileItem(
                        name=dir_name,
                        path=rel_route,
                        is_directory=True,
                        size=None
                    ))
                
                # Add files
                for file_name in sorted(files):
                    if file_name in ignored:
                        continue
                    file_path = Path(root) / file_name
                    rel_route = str(file_path.relative_to(base_path))
                    stat = file_path.stat()
                    results.append(FileItem(
                        name=file_name,
                        path=rel_route,
                        is_directory=False,
                        size=stat.st_size,
                        modified_at=stat.st_mtime
                    ))
        else:
            # Non-recursive - only immediate children
            items = sorted(target_path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))
            
            for item in items:
                if item.name in ignored:
                    continue
                
                # rel to workdir for frontend usage
                rel_route = str(item.relative_to(Path(workdir).resolve()))
                stat = item.stat()
                
                results.append(FileItem(
                    name=item.name,
                    path=rel_route,
                    is_directory=item.is_dir(),
                    size=stat.st_size if not item.is_dir() else None,
                    modified_at=stat.st_mtime
                ))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"files": results, "current_path": path}


import re

# ... existing code ...

def rtf_to_html(text: str) -> str:
    """
    Simple regex-based RTF to HTML converter.
    Handles basic formatting: bold, italic, underline, newlines.
    """
    # Basic replacements
    replacements = [
        (r'\\par\s?', '<br>'),
        (r'\\b\s', '<b>'), (r'\\b0\s?', '</b>'),
        (r'\\i\s', '<i>'), (r'\\i0\s?', '</i>'),
        (r'\\ul\s', '<u>'), (r'\\ulnone\s?', '</u>'),
        (r'\\strike\s', '<s>'), (r'\\strike0\s?', '</s>'),
    ]
    
    html = text
    for pattern, promo in replacements:
        html = re.sub(pattern, promo, html)
        
    # Strip remaining RTF tags (keep content)
    # This pattern matches any remaining backslash commands or brace groups that might be metadata
    # We try to be conservative and only strip obvious metadata blocks
    html = re.sub(r"\{\*?\\[^{}]+}", "", html) # Strip blocks like {\stylesheet...}
    html = re.sub(r"\\[a-z0-9]+\s?", "", html) # Strip remaining commands like \fs20
    html = re.sub(r"[{}]", "", html) # Strip remaining braces
    
    return html.strip()

@router.get("/content")
async def get_file_content(request: Request, path: str):
    settings = request.app.state.settings
    workdir = settings.default_workdir
        
    target_path = resolve_file_path(workdir, path)
    
    if not target_path.exists() or not target_path.is_file():
        raise HTTPException(status_code=404, detail="File not found.")
        
    try:
        # Try reading as text
        content = target_path.read_text(encoding="utf-8")
        
        # If it's an RTF file, convert to HTML for better preview
        if path.lower().endswith('.rtf'):
            content = rtf_to_html(content)
            
        return {"content": content}
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="Binary files are not supported for viewing.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


from fastapi.responses import FileResponse

@router.get("/raw")
async def get_raw_file(request: Request, path: str):
    settings = request.app.state.settings
    workdir = settings.default_workdir
        
    target_path = resolve_file_path(workdir, path)
    
    if not target_path.exists() or not target_path.is_file():
        raise HTTPException(status_code=404, detail="File not found.")
        
    return FileResponse(target_path)


import mimetypes

@router.get("/webserver/{file_path:path}")
async def serve_web_file(request: Request, file_path: str):
    """
    Serve files as a static web server.
    This enables HTML files to correctly load their relative resources (CSS, JS, images).
    
    Supports both:
    - Relative paths: resolved within workdir (e.g., /api/files/webserver/test.html)
    - Absolute paths: direct access (e.g., /api/files/webserver//Users/Shared/file.html)
    
    Note: System directories are blocked for security.
    """
    settings = request.app.state.settings
    workdir = settings.default_workdir
    
    # Handle empty path (serve index.html if exists)
    if not file_path or file_path == "":
        file_path = "index.html"
    
    target_path = resolve_file_path(workdir, file_path)
    
    # If path is a directory, try to serve index.html
    if target_path.is_dir():
        index_path = target_path / "index.html"
        if index_path.exists():
            target_path = index_path
        else:
            raise HTTPException(status_code=404, detail="Directory listing not supported. No index.html found.")
    
    if not target_path.exists() or not target_path.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")
    
    # Detect MIME type
    mime_type, _ = mimetypes.guess_type(str(target_path))
    if mime_type is None:
        mime_type = "application/octet-stream"
    
    return FileResponse(
        target_path,
        media_type=mime_type,
        headers={
            # Allow embedding in iframe from any origin (frontend is on different port)
            "X-Frame-Options": "ALLOWALL",
            # Also set Content-Security-Policy to allow framing
            "Content-Security-Policy": "frame-ancestors *",
            # Cache static assets for 1 hour
            "Cache-Control": "public, max-age=3600" if not mime_type.startswith("text/html") else "no-cache"
        }
    )


@router.post("/save")
async def save_file_content(request: Request, body: SaveFileRequest):
    settings = request.app.state.settings
    workdir = settings.default_workdir

    target_path = resolve_file_path(workdir, body.path)
    
    try:
        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.write_text(body.content, encoding="utf-8")
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/create")
async def create_file_or_folder(request: Request, body: CreateFileRequest):
    settings = request.app.state.settings
    workdir = settings.default_workdir
    if not workdir:
        raise HTTPException(status_code=500, detail="Configuration error.")

    target_path = get_safe_path(workdir, body.path)
    
    if target_path.exists():
        raise HTTPException(status_code=409, detail="File or directory already exists.")
        
    try:
        if body.is_directory:
            target_path.mkdir(parents=True, exist_ok=True)
        else:
            target_path.parent.mkdir(parents=True, exist_ok=True)
            target_path.touch()
        return {"status": "success", "path": body.path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/delete")
async def delete_item(request: Request, body: DeleteFileRequest):
    settings = request.app.state.settings
    workdir = settings.default_workdir
    if not workdir:
        raise HTTPException(status_code=500, detail="Configuration error.")

    target_path = get_safe_path(workdir, body.path)
    
    if not target_path.exists():
        raise HTTPException(status_code=404, detail="Item not found.")
        
    try:
        if target_path.is_dir():
            shutil.rmtree(target_path)
        else:
            target_path.unlink()
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/duplicate")
async def duplicate_item(request: Request, body: DuplicateFileRequest):
    """Duplicate a file or folder with 'name copy' naming convention."""
    settings = request.app.state.settings
    workdir = settings.default_workdir
    if not workdir:
        raise HTTPException(status_code=500, detail="Configuration error.")

    source_path = get_safe_path(workdir, body.path)
    
    if not source_path.exists():
        raise HTTPException(status_code=404, detail="Source not found.")
    
    # Generate unique name: "name copy", "name copy 2", etc.
    parent = source_path.parent
    stem = source_path.stem if source_path.is_file() else source_path.name
    suffix = source_path.suffix if source_path.is_file() else ""
    
    counter = 1
    while True:
        if counter == 1:
            new_name = f"{stem}_copy{suffix}"
        else:
            new_name = f"{stem}_copy_{counter}{suffix}"
        
        dest_path = parent / new_name
        if not dest_path.exists():
            break
        counter += 1
    
    try:
        if source_path.is_dir():
            shutil.copytree(source_path, dest_path)
        else:
            shutil.copy2(source_path, dest_path)
        
        # Return the new path relative to workdir
        new_relative_path = str(dest_path.relative_to(workdir))
        return {"status": "success", "new_path": new_relative_path, "new_name": new_name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/open")
async def open_file_with_default_app(request: Request, body: OpenFileRequest):
    """Open a file or folder with the system default application."""
    settings = request.app.state.settings
    workdir = settings.default_workdir
    if not workdir:
        raise HTTPException(status_code=500, detail="Configuration error.")

    target_path = get_safe_path(workdir, body.path)
    
    if not target_path.exists():
        raise HTTPException(status_code=404, detail="File not found.")
    
    try:
        # macOS: use 'open' command to open with default app
        # Linux would use 'xdg-open', Windows would use 'start'
        subprocess.Popen(["open", str(target_path)])
        return {"status": "success", "path": body.path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/rename")
async def rename_item(request: Request, body: RenameFileRequest):
    settings = request.app.state.settings
    workdir = settings.default_workdir
    if not workdir:
        raise HTTPException(status_code=500, detail="Configuration error.")

    old_target = get_safe_path(workdir, body.old_path)
    new_target = get_safe_path(workdir, body.new_path)
    
    if not old_target.exists():
        raise HTTPException(status_code=404, detail="Source not found.")
    
    if new_target.exists():
        raise HTTPException(status_code=409, detail="Destination already exists.")
        
    try:
        old_target.rename(new_target)
        return {"status": "success", "new_path": body.new_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/move")
async def move_item(request: Request, body: MoveFileRequest):
    settings = request.app.state.settings
    workdir = settings.default_workdir
    if not workdir:
        raise HTTPException(status_code=500, detail="Configuration error.")

    source_target = get_safe_path(workdir, body.source_path)
    dest_dir = get_safe_path(workdir, body.destination_path)
    
    if not source_target.exists():
        raise HTTPException(status_code=404, detail="Source not found.")
    
    # Destination must be a directory
    if not dest_dir.exists() or not dest_dir.is_dir():
         raise HTTPException(status_code=400, detail="Destination must be an existing directory.")
    
    # Calculate new full path
    new_full_path = dest_dir / source_target.name
    
    if new_full_path.exists():
        if body.force:
            # User confirmed overwrite - delete existing
            try:
                if new_full_path.is_dir():
                    shutil.rmtree(new_full_path)
                else:
                    new_full_path.unlink()
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Failed to remove existing file: {str(e)}")
        else:
            raise HTTPException(status_code=409, detail="A file with the same name exists in destination.")

    try:
        shutil.move(str(source_target), str(new_full_path))
        return {"status": "success", "new_path": str(new_full_path.relative_to(Path(workdir).resolve()))}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/upload")
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    destination: str = Form(default=""),
    force: bool = Form(default=False)
):
    """
    Upload a file to the workspace.
    - destination: target directory (relative to workdir), empty means root
    - force: if True, overwrite existing file
    """
    settings = request.app.state.settings
    workdir = settings.default_workdir
    if not workdir:
        raise HTTPException(status_code=500, detail="Configuration error.")

    # Determine target directory
    if destination and destination != ".":
        dest_dir = get_safe_path(workdir, destination)
        if not dest_dir.exists() or not dest_dir.is_dir():
            raise HTTPException(status_code=400, detail="Destination directory does not exist.")
    else:
        dest_dir = Path(workdir).resolve()
    
    # Target file path
    target_file = dest_dir / file.filename
    
    if target_file.exists():
        if force:
            try:
                if target_file.is_dir():
                    shutil.rmtree(target_file)
                else:
                    target_file.unlink()
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Failed to remove existing file: {str(e)}")
        else:
            raise HTTPException(status_code=409, detail="A file with the same name already exists.")
    
    try:
        # Save uploaded file
        with open(target_file, "wb") as f:
            content = await file.read()
            f.write(content)
        
        return {
            "status": "success", 
            "path": str(target_file.relative_to(Path(workdir).resolve())),
            "size": len(content)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Import file watcher service (import here to avoid circular imports)
from core.file_watcher import file_watcher_service
import logging

logger = logging.getLogger(__name__)


@router.websocket("/ws/watch")
async def websocket_file_watch(websocket: WebSocket):
    """
    WebSocket endpoint for real-time file change notifications.
    Client connects and receives file_change events when files are modified.
    
    Events sent to client:
    - file_change: Single file changed
      {"type": "file_change", "action": "created|deleted|modified|moved", "path": "...", "is_directory": bool}
    - files_changed: Multiple files changed (batched)
      {"type": "files_changed", "changes": [...], "timestamp": float}
    """
    await websocket.accept()
    logger.info("[FileWatch WS] Client connected")
    
    await file_watcher_service.register_client(websocket)
    
    try:
        while True:
            # Keep connection alive by receiving messages (ping/pong handled by protocol)
            # Client can send "ping" messages to keep alive
            try:
                message = await websocket.receive_text()
                if message == "ping":
                    await websocket.send_json({"type": "pong"})
            except Exception:
                # Connection closed
                break
    except WebSocketDisconnect:
        logger.info("[FileWatch WS] Client disconnected")
    finally:
        await file_watcher_service.unregister_client(websocket)
        logger.info("[FileWatch WS] Client cleanup complete")
