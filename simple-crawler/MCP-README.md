# Simple Crawler MCP Server

一个轻量级的网页抓取 MCP Server，提供 `web_fetch` 工具用于获取网页主体内容。

## 功能

- 🌐 抓取网页并返回清洗后的 Markdown
- 🔗 保留正文中的链接 `[text](url)`
- 🤖 自动处理 JavaScript 渲染页面
- 🛡️ 内置反检测（Stealth 插件）

## 安装

```bash
cd simple-crawler
npm install
npx playwright install chromium
```

## 使用方式

### 1. 开发模式

```bash
npm run mcp
```

### 2. MCP 客户端配置

**Claude Desktop / Cherry Studio:**

```json
{
  "mcpServers": {
    "simple-crawler": {
      "command": "npx",
      "args": ["tsx", "/path/to/simple-crawler/src/mcp-server.ts"]
    }
  }
}
```

**使用 node 运行（需先 build）:**

```bash
npm run build
```

```json
{
  "mcpServers": {
    "simple-crawler": {
      "command": "node",
      "args": ["/path/to/simple-crawler/dist/mcp-server.js"]
    }
  }
}
```

## Tool 定义

### web_fetch

```json
{
  "name": "web_fetch",
  "description": "Fetch a single web page and return its main content as clean Markdown. Links in the content are preserved as Markdown links [text](url).",
  "inputSchema": {
    "type": "object",
    "properties": {
      "url": {
        "type": "string",
        "description": "The URL to fetch."
      }
    },
    "required": ["url"]
  }
}
```

### 示例调用

**输入:**
```json
{ "url": "https://example.com" }
```

**输出:**
```markdown
# Example Domain

**URL:** https://example.com/

---

# Example Domain

This domain is for use in documentation examples.

[Learn more](https://iana.org/domains/example)
```

## 调试

使用 MCP Inspector:

```bash
npx @modelcontextprotocol/inspector npx tsx src/mcp-server.ts
```

## License

MIT
