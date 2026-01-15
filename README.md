# OpenCowork

<p align="center">
  <strong>An open-source implementation of Claude Cowork — the autonomous AI agent for knowledge work</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.11+-blue?logo=python" alt="Python">
  <img src="https://img.shields.io/badge/Node.js-20+-green?logo=node.js" alt="Node.js">
  <img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js" alt="Next.js">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" alt="React">
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="License">
</p>

---

## 🎯 What is OpenCowork?

**OpenCowork** is an open-source alternative to [Claude Cowork](https://anthropic.com), Anthropic's autonomous AI agent designed for knowledge work. Built on the **Claude Agent SDK**, OpenCowork provides a web-based interface for interacting with Claude's agentic capabilities.

While Claude Cowork is a closed macOS desktop application, OpenCowork runs as a self-hosted web application — giving you full control, transparency, and extensibility.

### ✨ Key Features

| Feature | Description |
|---------|-------------|
| 🤖 **Agentic AI** | Powered by Claude Agent SDK with autonomous task execution |
| 🌐 **Web Interface** | Modern React-based UI with real-time streaming responses |
| 🔌 **MCP Support** | Model Context Protocol for extensible tool integration |
| 🔍 **Web Search** | Built-in search integration (Serper, Tavily, Brave) |
| 🕷️ **Web Scraping** | Integrated crawler with Playwright browser automation |
| 🌙 **Dark Mode** | Beautiful dark/light theme with system preference detection |
| 📝 **Markdown** | Rich markdown rendering with syntax highlighting, tables, and math |
| ⚙️ **Configurable** | Flexible model, API, and MCP server configuration |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Frontend                            │
│              (Next.js 16 + React 19 + Tailwind)             │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTP/SSE
┌─────────────────────────▼───────────────────────────────────┐
│                         Backend                             │
│                 (FastAPI + Claude Agent SDK)                │
└─────────────────────────┬───────────────────────────────────┘
                          │ stdio/HTTP
┌─────────────────────────▼───────────────────────────────────┐
│                       MCP Servers                           │
│            (Simple-Crawler, FMP, Custom Tools)              │
└─────────────────────────────────────────────────────────────┘
```

### Components

| Component | Technology | Description |
|-----------|------------|-------------|
| **Frontend** | Next.js 16, React 19, Tailwind CSS 4 | Web UI with real-time chat interface |
| **Backend** | FastAPI, Python 3.11+, Claude Agent SDK | API server with SSE streaming |
| **Simple-Crawler** | Node.js, Playwright, MCP SDK | Web scraping MCP server |

---

## 🚀 Quick Start

### Prerequisites

- **Python** 3.11 or higher
- **Node.js** 20 or higher
- **Claude API Key** from [Anthropic Console](https://console.anthropic.com/)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/opencowork.git
cd opencowork

# Run the smart installer (checks existing installations)
chmod +x install.sh
./install.sh
```

The installer will:
- ✅ Check system dependencies (Python, Node.js, npm, Git)
- ✅ Create Python virtual environment (if not exists)
- ✅ Install Python dependencies (if not installed)
- ✅ Install frontend npm packages (if outdated)
- ✅ Install crawler dependencies and Playwright browser
- ✅ Verify environment configuration

### Configuration

Create your API configuration:

```bash
echo 'ANTHROPIC_API_KEY=your_api_key_here' > backend/.env
```

Or configure via the Web UI after startup (Settings → Model Configuration).

### Start the Application

```bash
# Start in background
./start.sh

# Start in foreground (Ctrl+C to stop)
./start.sh -f

# Stop all services
./start.sh stop

# Restart services
./start.sh restart
```

Access the application:
- **Web UI**: http://localhost:3000
- **API Docs**: http://localhost:8000/docs

---

## 📖 Usage

### Basic Chat

1. Open http://localhost:3000 in your browser
2. Type your message in the chat input
3. Claude will respond with streaming text, tool calls, and rich markdown

### Configure Models

Navigate to **Settings** → **Model Configuration** to:
- Set your API key
- Choose the model (claude-sonnet-4-20250514, claude-opus-4, etc.)
- Configure custom API endpoints (for proxies or local models)

### MCP Tools

OpenCowork supports Model Context Protocol (MCP) for extensible tool integration:

1. Go to **Settings** → **MCP Servers**
2. Add MCP servers (stdio or HTTP transport)
3. The agent will automatically discover and use available tools

**Built-in MCP Server:**
- **Simple-Crawler**: Web scraping with `WebFetch` and `GetLinks` tools

### Web Search

Configure search providers in **Settings** → **Search Configuration**:
- Serper (Google Search)
- Tavily (AI Search)
- Brave Search

---

## 🔧 Manual Installation

If you prefer manual setup over the automated installer:

### Backend

```bash
cd backend

# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate  # Linux/macOS
# .venv\Scripts\activate   # Windows

# Install dependencies
pip install -r requirements.txt

# Start server
python main.py
```

### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

### Simple-Crawler (Optional)

```bash
cd simple-crawler

# Install dependencies
npm install

# Install Playwright browser
npx playwright install chromium

# Build
npm run build
```

---

## 📁 Project Structure

```
opencowork/
├── backend/                 # Python FastAPI backend
│   ├── core/               # Core logic (agent client, MCP)
│   ├── models/             # Pydantic models
│   ├── routers/            # API routes
│   ├── main.py             # Entry point
│   └── requirements.txt    # Python dependencies
├── frontend/               # Next.js frontend
│   ├── src/
│   │   ├── app/           # Next.js app router
│   │   ├── components/    # React components
│   │   └── lib/           # Utilities
│   └── package.json       # Node dependencies
├── simple-crawler/         # MCP web scraper
│   ├── src/               # TypeScript source
│   └── package.json       # Node dependencies
├── storage/               # Persistent configuration
├── install.sh             # Smart installer
├── start.sh               # Startup script
└── README.md              # This file
```

---

## 🛠️ Development

### Run in Development Mode

```bash
# Terminal 1: Backend with hot reload
cd backend
source .venv/bin/activate
python main.py

# Terminal 2: Frontend with hot reload
cd frontend
npm run dev
```

### Build for Production

```bash
# Frontend production build
cd frontend
npm run build
npm start
```

### Logs

- **Backend logs**: `/tmp/stockagent_backend.log` or `backend/debug.log`
- **Frontend logs**: `/tmp/stockagent_frontend.log`

---

## 🔒 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `SERPER_API_KEY` | No | Serper search API key |
| `TAVILY_API_KEY` | No | Tavily search API key |
| `BRAVE_API_KEY` | No | Brave search API key |

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [Anthropic](https://anthropic.com) for Claude and the Agent SDK
- [Claude Cowork](https://anthropic.com) for inspiration
- The open-source community for the amazing tools and libraries

---

<p align="center">
  Made with ❤️ by the OpenCowork Community
</p>
