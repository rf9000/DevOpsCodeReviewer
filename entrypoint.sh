#!/bin/bash
set -e

# Fix ownership of mounted volumes (they mount as root)
if [ "$(id -u)" = "0" ]; then
  chown -R claude:claude /app/.state
  chown -R claude:claude /home/claude/.claude 2>/dev/null || true

  # Verify the target repo is mounted
  if [ -n "$TARGET_REPO_PATH" ] && [ ! -d "$TARGET_REPO_PATH/.git" ]; then
    echo "ERROR: Target repo not found at $TARGET_REPO_PATH"
    echo "Mount the repo from the host, e.g.: ~/repos/<repo-name>:$TARGET_REPO_PATH:ro"
    exit 1
  fi

  # Fix ownership of writable repo mounts
  # Skip read-only mounts to avoid slow no-op chown -R on large repos
  for dir in /repos/*/; do
    [ ! -d "$dir" ] && continue
    if touch "$dir/.chown-test" 2>/dev/null; then
      rm -f "$dir/.chown-test"
      chown -R claude:claude "$dir"
    fi
  done

  exec su claude -c "export HOME=/home/claude && cd /app && bun run start"
fi

exec bun run start
