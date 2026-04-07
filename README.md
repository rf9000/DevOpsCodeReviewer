# DevOps Code Reviewer

An Azure DevOps automation service that monitors pull requests and performs automated code reviews using Claude AI.

## What does it do?

This service:
- **Polls Azure DevOps** every 30 minutes for active pull requests with a `code-review` label
- **Reviews the code changes** by invoking a 6-agent parallel review skill via the Claude Agent SDK (safety, performance, structure, naming, security, integration)
- **Posts the review** as a comment thread on the PR
- **Removes the label** after a successful review
- **Tracks state** to avoid re-reviewing, with daily review limits

## Getting started

1. Clone the repo and install dependencies:
   ```bash
   git clone <your-repo-url>
   cd DevOpsCodeReviewer
   bun install
   ```
2. Copy `.env.example` to `.env` and fill in your configuration:
   ```bash
   cp .env.example .env
   ```
3. Run tests to verify everything works:
   ```bash
   bun test
   ```

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AZURE_DEVOPS_PAT` | yes | — | Azure DevOps personal access token |
| `AZURE_DEVOPS_ORG` | yes | — | Azure DevOps organization name |
| `AZURE_DEVOPS_PROJECT` | yes | — | Azure DevOps project name |
| `AZURE_DEVOPS_REPO_IDS` | yes | — | Comma-separated repository IDs to monitor |
| `TARGET_REPO_PATH` | yes | — | Local path to the repository clone |
| `POLL_INTERVAL_MINUTES` | no | `30` | Polling interval in minutes |
| `MAX_REVIEWS_PER_DAY` | no | `10` | Maximum reviews per day |
| `CLAUDE_MODEL` | no | `claude-sonnet-4-6` | Claude model to use |
| `REVIEW_LABEL` | no | `code-review` | PR label that triggers a review |
| `STATE_DIR` | no | `.state` | Directory for state persistence |

## CLI Commands

### `watch` — Continuous polling

Start the long-running watcher that polls for labeled PRs at the configured interval.

```bash
bun run start
# or
bun src/cli/index.ts watch
bun src/cli/index.ts watch --dry-run   # review but don't post or remove labels
```

On first run, existing labeled PRs are seeded as "already processed" to avoid reviewing a backlog. The watcher shuts down gracefully on SIGINT/SIGTERM.

### `run-once` — Single poll cycle

Run one poll cycle and exit. Useful for cron jobs or manual triggers.

```bash
bun run once
# or
bun src/cli/index.ts run-once
bun src/cli/index.ts run-once --dry-run
```

### `review-pr` — Review a specific PR

Review a single pull request and post the results to Azure DevOps.

```bash
bun src/cli/index.ts review-pr <repoId> <prId>
bun src/cli/index.ts review-pr <repoId> <prId> --dry-run
```

The review is posted as a comment thread and the `code-review` label is removed (if present).

### `test-pr` — Dry-run review

Review a single PR without posting results or removing labels. Always runs in dry-run mode.

```bash
bun src/cli/index.ts test-pr <repoId> <prId>
```

### `reset-state` — Clear processed state

Clear the tracked state of which PRs have been reviewed. After reset, the next `watch` or `run-once` will seed existing labeled PRs again.

```bash
bun src/cli/index.ts reset-state
```

### `help` — Show help

```bash
bun src/cli/index.ts help
```

## Development

| Command | Description |
|---------|-------------|
| `bun test` | Run all tests |
| `bun run test:unit` | Run unit tests only |
| `bun run test:integration` | Run integration tests (requires credentials) |
| `bun run typecheck` | TypeScript type checking |

## Project structure

```
src/
├── cli/index.ts                # CLI entry point
├── config/index.ts             # Zod-based environment validation
├── sdk/
│   ├── azure-devops-client.ts  # Azure DevOps PR API client with retry
│   └── agent-workspace.ts      # Workspace staging (symlinks .claude/ into target repo)
├── services/
│   ├── watcher.ts              # Polling loop with graceful shutdown
│   ├── processor.ts            # PR review orchestrator (git diff, invoke skill, post comment)
│   └── reviewer.ts             # Claude Agent SDK invocation with skill discovery
├── state/state-store.ts        # JSON state persistence with daily limits
└── types/index.ts              # Shared TypeScript interfaces

.claude/
├── skills/code-review/         # 6-agent parallel review skill
│   ├── SKILL.md                # Orchestrator logic
│   ├── agents/                 # Specialized review agent prompts
│   └── references/             # Output format, examples, checklist
└── rules/                      # Coding rules referenced by review agents

tests/                          # Mirrors src/ with full test coverage
```

## How it works

1. The **watcher** polls Azure DevOps for active PRs across configured repositories
2. For each PR, it fetches labels and filters for the `code-review` label
3. The **processor** runs `git diff` on the local clone to get the unified diff
4. The **reviewer** stages `.claude/` (containing the review skill) into the target repo via symlinks, then invokes the Claude Agent SDK
5. The SDK agent invokes the `code-review` skill, which dispatches 6 specialized subagents in parallel:
   - Safety & Correctness
   - Performance
   - Code Structure & Design
   - Naming & Style
   - Security
   - Integration
6. The skill collects findings, deduplicates by file+line, sorts by severity, and produces a formatted report
7. The **processor** converts the report to HTML and posts it as a PR comment thread
8. The `code-review` label is removed from the PR
