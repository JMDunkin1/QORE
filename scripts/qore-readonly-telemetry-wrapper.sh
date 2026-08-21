#!/usr/bin/env bash
set -euo pipefail

repo_dir=/srv/codex-work/projects/QORE
node_bin=/usr/bin/node-22

if [[ ${EUID} -ne 0 ]]; then
  echo "QORE telemetry wrapper must run through sudo." >&2
  exit 1
fi

run_as_codex() {
  runuser -u codex -- "$node_bin" "$repo_dir/scripts/$1" "${@:2}"
}

case "${1:-}" in
  refresh)
    cd "$repo_dir"
    run_as_codex qore-alpaca-broker.mjs --status --json >/dev/null
    run_as_codex qore-alpaca-order-history.mjs --json >/dev/null
    ;;
  snapshot)
    cd "$repo_dir"
    exec runuser -u codex -- "$node_bin" "$repo_dir/scripts/qore-dashboard-service.mjs" --snapshot-json
    ;;
  *)
    echo "Usage: qore-readonly-telemetry {refresh|snapshot}" >&2
    exit 64
    ;;
esac
