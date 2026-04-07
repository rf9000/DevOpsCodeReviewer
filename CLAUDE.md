# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DevOpsCodeReviewer is an Azure DevOps automation service that monitors pull requests and performs automated code reviews using Claude AI. It polls for PRs with a configurable label (default: `code-review`), invokes a 6-agent parallel code review skill via the Claude Agent SDK, posts the review as a PR comment thread, and removes the label.

## Architecture

- **Runtime:** Bun (TypeScript)
- **Validation:** Zod for environment config
- **AI:** @anthropic-ai/claude-agent-sdk with workspace staging for skill invocation
- **Testing:** Bun's built-in test framework
- **Code Review Skill:** `.claude/skills/code-review/` — 6-agent orchestrator (safety, performance, structure, naming, security, integration)

## Key Patterns

- **Dependency injection** via interfaces on all services for testability
- **Exponential backoff retry** on Azure DevOps API calls (5xx/network errors)
- **JSON state store** with Set-based O(1) lookups and daily review limits
- **Polling watcher** with graceful SIGINT/SIGTERM shutdown
- **Workspace staging** — symlinks `.claude/` into target repo for skill discovery
- **Label-based trigger** — PRs with `code-review` label are reviewed, label removed after

## Commands

- `bun test` — run all tests
- `bun run typecheck` — TypeScript type checking
- `bun run start` — start the watcher (polls every 30 minutes)
- `bun run once` — single poll cycle

## File Layout

- `src/config/` — Zod env validation
- `src/sdk/` — Azure DevOps REST client (PR APIs) and workspace staging
- `src/services/` — business logic (reviewer, processor, watcher)
- `src/state/` — JSON persistence
- `src/types/` — shared interfaces
- `.claude/skills/code-review/` — the 6-agent review skill
- `.claude/rules/` — coding rules referenced by review agents
- `tests/` — mirrors src/ structure
