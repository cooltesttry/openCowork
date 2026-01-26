# OpenCowork 安装指南

本文档面向本地部署与开发环境，覆盖快速安装、手动安装、配置与常见问题。

## 1. 前置条件

### 1.1 必需工具

- **Python 3.11+**
- **Node.js 20+**
- **npm**
- **Git**

### 1.2 说明

- 安装过程中需要访问 npm/pip 源以下载依赖。
- Simple-Crawler 使用 Playwright，首次安装会下载 Chromium 浏览器。
- Windows 建议使用 WSL2 或类 Unix 环境运行脚本。

## 2. 快速安装（推荐）

在项目根目录执行：

```bash
chmod +x install.sh
./install.sh
```

该脚本会自动完成：

- Python 虚拟环境创建与依赖安装
- 前端 npm 依赖安装
- Simple-Crawler 依赖安装与 Playwright Chromium 下载
- 检查 API Key 配置

## 3. 配置 API Key

创建 `backend/.env` 文件：

```bash
echo 'ANTHROPIC_API_KEY=your_api_key_here' > backend/.env
```

可选搜索 API（若使用搜索功能）：

```
SERPER_API_KEY=...
TAVILY_API_KEY=...
BRAVE_API_KEY=...
```

也可通过前端设置页面配置并持久化到 `storage/config.json`。

## 4. 启动与停止

### 4.1 快速启动

```bash
./start.sh
```

### 4.2 前台运行（便于调试）

```bash
./start.sh -f
```

### 4.3 停止/重启

```bash
./start.sh stop
./start.sh restart
```

默认端口：

- 前端：`http://localhost:3000`
- 后端：`http://localhost:8000`
- API 文档：`http://localhost:8000/docs`

## 5. 手动安装（可选）

### 5.1 后端

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py
```

### 5.2 前端

```bash
cd frontend
npm install
npm run dev
```

### 5.3 Simple-Crawler

```bash
cd simple-crawler
npm install
npx playwright install chromium
npm run build
```

## 6. 常见问题排查

### 6.1 端口冲突

- `start.sh` 会自动清理 3000/8000 端口占用。
- 如果仍冲突，手动检查并关闭占用进程。

### 6.2 Playwright 浏览器下载失败

- 可能需要代理或镜像源。
- Linux 可尝试：
  - `npx playwright install-deps`
  - `npx playwright install chromium`

### 6.3 Node 或 Python 版本不符合

- `install.sh` 会校验版本。
- 请升级到 Python 3.11+ / Node.js 20+。

### 6.4 权限问题

- 确保 `install.sh`、`start.sh` 可执行：
  - `chmod +x install.sh start.sh`

## 7. 生产构建（前端）

如需构建生产版本：

```bash
cd frontend
npm run build
npm run start
```
