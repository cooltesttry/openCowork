# Agent SDK Overview

> Build production AI agents with Claude Code as a library

The Claude Code SDK has been renamed to the Claude Agent SDK. If you're migrating from the old SDK, see the [Migration Guide](https://docs.anthropic.com/docs/en/agent-sdk/migration-guide).

Build AI agents that autonomously read files, run commands, search the web, edit code, and more. The Agent SDK gives you the same tools, agent loop, and context management that power Claude Code, programmable in Python and TypeScript.

```python
import asyncio
from claude_agent_sdk import query, ClaudeAgentOptions

async def main():
    async for message in query(
        prompt="Find and fix the bug in auth.py",
        options=ClaudeAgentOptions(allowed_tools=["Read", "Edit", "Bash"])
    ):
        print(message)  # Claude reads the file, finds the bug, edits it

asyncio.run(main())
```

The Agent SDK includes built-in tools for reading files, running commands, and editing code, so your agent can start working immediately without you implementing tool execution.

- [Quickstart - Build a bug-fixing agent in minutes](https://docs.anthropic.com/docs/en/agent-sdk/quickstart)
- [Example agents](https://github.com/anthropics/claude-agent-sdk-demos)

## Capabilities

Everything that makes Claude Code powerful is available in the SDK.

### Claude Code Features

The SDK also supports Claude Code's filesystem-based configuration. To use these features, set `setting_sources=["project"]` (Python) or `settingSources: ['project']` (TypeScript) in your options.

| Feature | Path |
|---------|------|
| [Skills](https://docs.anthropic.com/docs/en/agent-sdk/skills) | `.claude/skills/SKILL.md` |
| [Slash commands](https://docs.anthropic.com/docs/en/agent-sdk/slash-commands) | `.claude/commands/*.md` |
| [Memory](https://docs.anthropic.com/docs/en/agent-sdk/modifying-system-prompts) | `CLAUDE.md` or `.claude/CLAUDE.md` |
| [Plugins](https://docs.anthropic.com/docs/en/agent-sdk/plugins) | `plugins` |

## Get Started

### 1. Install Claude Code

The SDK uses Claude Code as its runtime:

**macOS/Linux/WSL:**
```bash
curl -fsSL https://claude.ai/install.sh | bash
```

**Homebrew:**
```bash
brew install claude-code
```

See [Claude Code setup](https://code.claude.com/docs/en/setup) for Windows and other options.

### 2. Install the SDK

**Python:**
```bash
pip install claude-agent-sdk
```

**TypeScript:**
```bash
npm install @anthropic-ai/claude-agent-sdk
```

### 3. Set Your API Key

```bash
export ANTHROPIC_API_KEY=your-api-key
```

Get your key from the [Console](https://platform.claude.com/).

The SDK also supports authentication via third-party API providers:
- **Amazon Bedrock**: set `CLAUDE_CODE_USE_BEDROCK=1` environment variable and configure AWS credentials
- **Google Vertex AI**: set `CLAUDE_CODE_USE_VERTEX=1` environment variable and configure Google Cloud credentials
- **Microsoft Foundry**: set `CLAUDE_CODE_USE_FOUNDRY=1` environment variable and configure Azure credentials

> **Note:** Unless previously approved, we do not allow third party developers to offer Claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Please use the API key authentication methods described above.

### 4. Run Your First Agent

This example creates an agent that lists files in your current directory using built-in tools:

```python
import asyncio
from claude_agent_sdk import query, ClaudeAgentOptions

async def main():
    async for message in query(
        prompt="What files are in this directory?",
        options=ClaudeAgentOptions(allowed_tools=["Bash", "Glob"])
    ):
        if hasattr(message, "result"):
            print(message.result)

asyncio.run(main())
```

## Compare the Agent SDK to Other Claude Tools

The Claude platform offers multiple ways to build with Claude. Here's how the Agent SDK fits in:

| Tool | Best For |
|------|----------|
| **Agent SDK** | Building autonomous agents with file/command/code access |
| **Messages API** | Direct LLM API calls for chat and completion |
| **Claude.ai** | Interactive chat interface |
| **Claude Code CLI** | Command-line coding assistant |

## Changelog

View the full changelog for SDK updates, bug fixes, and new features:
- TypeScript SDK: [CHANGELOG.md](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md)
- Python SDK: [CHANGELOG.md](https://github.com/anthropics/claude-agent-sdk-python/blob/main/CHANGELOG.md)

## Reporting Bugs

If you encounter bugs or issues with the Agent SDK:
- TypeScript SDK: [Report issues on GitHub](https://github.com/anthropics/claude-agent-sdk-typescript/issues)
- Python SDK: [Report issues on GitHub](https://github.com/anthropics/claude-agent-sdk-python/issues)

## Branding Guidelines

For partners integrating the Claude Agent SDK, use of Claude branding is optional. When referencing Claude in your product:

**Allowed:**
- "Claude Agent" (preferred for dropdown menus)
- "Claude" (when within a menu already labeled "Agents")
- "{YourAgentName} Powered by Claude" (if you have an existing agent name)

**Not permitted:**
- "Claude Code" or "Claude Code Agent"
- Claude Code-branded ASCII art or visual elements that mimic Claude Code

Your product should maintain its own branding and not appear to be Claude Code or any Anthropic product.

## License and Terms

Use of the Claude Agent SDK is governed by [Anthropic's Commercial Terms of Service](https://www.anthropic.com/legal/commercial-terms), including when you use it to power products and services that you make available to your own customers and end users, except to the extent a specific component or dependency is covered by a different license as indicated in that component's LICENSE file.

## Next Steps

- [Quickstart - Build an agent that finds and fixes bugs in minutes](https://docs.anthropic.com/docs/en/agent-sdk/quickstart)
- [Example agents - Email assistant, research agent, and more](https://github.com/anthropics/claude-agent-sdk-demos)
- [TypeScript SDK - Full TypeScript API reference and examples](https://docs.anthropic.com/docs/en/agent-sdk/typescript)
- [Python SDK - Full Python API reference and examples](https://docs.anthropic.com/docs/en/agent-sdk/python)
