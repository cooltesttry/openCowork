import asyncio
import pty
import os
import fcntl
import struct
import termios
import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["terminal"])

class TerminalSession:
    def __init__(self, working_dir: str = None):
        self.master_fd = None
        self.pid = None
        self.working_dir = working_dir or os.path.expanduser("~")
    
    def start(self):
        """Start PTY terminal"""
        try:
            self.master_fd, slave_fd = pty.openpty()
            
            self.pid = os.fork()
            if self.pid == 0:  # Child process
                os.setsid()
                os.dup2(slave_fd, 0)
                os.dup2(slave_fd, 1)
                os.dup2(slave_fd, 2)
                os.close(slave_fd)
                os.close(self.master_fd)
                
                os.chdir(self.working_dir)
                shell = os.environ.get('SHELL', '/bin/zsh')
                os.execvp(shell, [shell])
            else:
                os.close(slave_fd)
                # Set non-blocking
                flags = fcntl.fcntl(self.master_fd, fcntl.F_GETFL)
                fcntl.fcntl(self.master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)
                logger.info(f"Terminal session started with PID {self.pid}")
        except Exception as e:
            logger.error(f"Failed to start terminal: {e}")
            raise
    
    def resize(self, cols: int, rows: int):
        """Resize terminal"""
        if self.master_fd:
            winsize = struct.pack('HHHH', rows, cols, 0, 0)
            fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, winsize)
    
    def write(self, data: str):
        """Write data to terminal"""
        if self.master_fd:
            os.write(self.master_fd, data.encode())
    
    def read(self) -> bytes:
        """Read data from terminal"""
        try:
            if self.master_fd:
                return os.read(self.master_fd, 4096)
        except (OSError, BlockingIOError):
            return b''
        return b''
    
    def close(self):
        """Close terminal"""
        logger.info(f"Closing terminal session {self.pid}")
        if self.master_fd:
            os.close(self.master_fd)
            self.master_fd = None
        if self.pid:
            try:
                os.kill(self.pid, 9)
                os.waitpid(self.pid, 0)
            except:
                pass
            self.pid = None


# Active terminal sessions
terminal_sessions: dict[str, TerminalSession] = {}


@router.websocket("/terminal/{session_id}")
async def terminal_websocket(websocket: WebSocket, session_id: str):
    await websocket.accept()
    
    # Create or reuse terminal session? For now, create new one per connection/session_id
    # To support persistence, we might need to look up existing session.
    # For now, let's just create a new one.
    
    terminal = TerminalSession(working_dir=os.getcwd()) # Use project root as cwd
    try:
        terminal.start()
        terminal_sessions[session_id] = terminal
        
        # Task to read from terminal
        async def read_terminal():
            while True:
                await asyncio.sleep(0.01)
                output = terminal.read()
                if output:
                    try:
                        await websocket.send_text(output.decode('utf-8', errors='replace'))
                    except Exception as e:
                        logger.error(f"Error sending to websocket: {e}")
                        break
        
        read_task = asyncio.create_task(read_terminal())
        
        # Handle messages from client
        try:
            while True:
                message = await websocket.receive_text()
                data = json.loads(message)
                
                if data['type'] == 'input':
                    terminal.write(data['data'])
                elif data['type'] == 'resize':
                    terminal.resize(data['cols'], data['rows'])
        except WebSocketDisconnect:
            logger.info("WebSocket disconnected")
        except Exception as e:
             logger.error(f"WebSocket error: {e}")
        finally:
            read_task.cancel()
    
    finally:
        terminal.close()
        if session_id in terminal_sessions:
            del terminal_sessions[session_id]
