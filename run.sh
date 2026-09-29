#!/usr/bin/env bash
set -euo pipefail

# Launch an agent workload kit with this local mixin, with the display on.
# Usage: ./run.sh [workspace] [extra sbx run args...]
#   SBX_WORKLOAD  the workload kit to compose onto (default: Claude Code)
#   SBX_NAME      sandbox name (default: <agent>-browser)
# Examples:
#   ./run.sh .
#   SBX_WORKLOAD=docker.io/docker/sbx-kit-codex:latest ./run.sh .

kit_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
workload="${SBX_WORKLOAD:-docker.io/docker/sbx-kit-claude:latest}"
agent="$(basename "${workload%%:*}")"
name="${SBX_NAME:-${agent#sbx-kit-}-browser}"
workspace="${1:-.}"

if [[ $# -gt 0 ]]; then
  shift
fi

exec sbx run "$workload" --display --kit "$kit_dir" --name "$name" "$workspace" "$@"
