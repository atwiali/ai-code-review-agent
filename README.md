# ai-code-review-agent

An agentic AI code reviewer that takes a GitHub PR URL, autonomously fetches the diff, analyzes code quality and security issues, and posts a structured review — deciding on its own which files need deeper inspection.

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- An [Anthropic API key](https://console.anthropic.com/)
- A [GitHub personal access token](https://github.com/settings/tokens)

### GitHub Token Permissions

The token needs **read and write** access to pull requests so the agent can fetch PR data and post review comments.

**Classic token** — select the `repo` scope (includes full read/write access).

**Fine-grained token** — enable these repository permissions:
| Permission | Access |
|---|---|
| **Pull requests** | Read and Write |
| **Issues** | Read and Write |
| **Contents** | Read |

## Setup

```bash
# Install dependencies
npm install

# Copy the env template and fill in your keys
cp .env.example .env
```

Edit `.env` with your keys:

```
GITHUB_TOKEN=ghp_your_github_token_here
ANTHROPIC_API_KEY=sk-ant-your_anthropic_key_here
```

## Usage

```bash
# Review a pull request
npx ts-node src/index.ts https://github.com/owner/repo/pull/123

# Or use the npm script
npm run review -- https://github.com/owner/repo/pull/123
```

The agent will:

1. Fetch the list of changed files
2. Read the full diff
3. Inspect files that need deeper analysis
4. Post a structured review as a PR comment
5. Print a colored summary to your terminal

> See [EXAMPLE.md](EXAMPLE.md) for a full walkthrough with terminal output and screenshots.

## How It Works

This is an **agentic** application — Claude drives the review loop autonomously. It decides which tools to call and when, continuing until it has reviewed everything important.

```
CLI input (PR URL)
    │
    ▼
┌─────────────────────────────────────────────┐
│              Agentic Loop                   │
│                                             │
│  Claude ──► list_pr_files ──► fetch_pr_diff │
│    │                                        │
│    ├──► get_file_content (for complex files) │
│    │                                        │
│    └──► post_review_comment (when done)     │
│                                             │
│  Loop continues until stop_reason=end_turn  │
└─────────────────────────────────────────────┘
    │
    ▼
Console output (colored review) + PR comment
```

## Project Structure

```
src/
├── index.ts      — Entry point: parses PR URL, validates env, orchestrates the review
├── reviewer.ts   — Core agentic loop: sends messages to Claude, handles tool calls
├── tools.ts      — Tool definitions (JSON Schema) and GitHub API implementations
├── prompts.ts    — System prompt that defines Claude's reviewer persona
├── formatter.ts  — Formats review output for GitHub (markdown) and terminal (ANSI)
└── types.ts      — Shared TypeScript interfaces for the entire project
```

## Available Tools

Claude can call these tools during a review:

| Tool | Parameters | Description |
|------|-----------|-------------|
| `list_pr_files` | `owner`, `repo`, `pull_number` | Lists all changed files with status, additions/deletions, and patches |
| `fetch_pr_diff` | `owner`, `repo`, `pull_number` | Fetches the full unified diff of the pull request |
| `get_file_content` | `owner`, `repo`, `path`, `ref` | Reads the complete source of a file at a specific git ref |
| `post_review_comment` | `owner`, `repo`, `pull_number`, `body` | Posts the final formatted review as a PR comment |

## Guardrails

The agent has built-in stopping conditions to prevent runaway loops:

- **Max tool calls**: 20 (then asks Claude to wrap up)
- **Token budget**: 50,000 tokens (input + output combined)
- **Hard iteration cap**: prevents infinite loops
- **Graceful degradation**: injects a "wrap up" message instead of hard-cutting

## Review Output

The agent produces structured findings with:

- **Severity**: `critical` / `warning` / `info`
- **Category**: `security` / `performance` / `style` / `bug` / `best-practice`
- **File and line number** for each finding
- **Description** and actionable **suggestion**

## Tech Stack

- **TypeScript** with strict mode
- **Anthropic SDK** (`@anthropic-ai/sdk`) — Claude Sonnet with extended thinking
- **Octokit** (`@octokit/rest`) — GitHub REST API client
- **dotenv** — Environment variable loading

## License

ISC
