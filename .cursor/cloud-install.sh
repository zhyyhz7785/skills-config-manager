#!/usr/bin/env bash
# Cursor Cloud Agent install — Node deps + ensure Rust for npm run verify:tauri
set -euo pipefail

# edition2024 / dlopen2_derive require stable >= 1.85 (see AGENTS.md)
MIN_RUST_MAJOR=1
MIN_RUST_MINOR=85

rust_meets_min() {
  command -v rustc >/dev/null 2>&1 || return 1
  command -v cargo >/dev/null 2>&1 || return 1
  local ver major rest minor
  ver=$(rustc --version 2>/dev/null | awk '{print $2}')
  [[ -n "$ver" ]] || return 1
  major=${ver%%.*}
  rest=${ver#*.}
  minor=${rest%%.*}
  minor=${minor%%-*}
  [[ "$major" =~ ^[0-9]+$ && "$minor" =~ ^[0-9]+$ ]] || return 1
  if (( major > MIN_RUST_MAJOR )); then
    return 0
  fi
  if (( major == MIN_RUST_MAJOR && minor >= MIN_RUST_MINOR )); then
    return 0
  fi
  return 1
}

ensure_rust() {
  if ! command -v rustup >/dev/null 2>&1; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  else
    rustup update stable
    rustup default stable
  fi
  # shellcheck disable=SC1091
  source "${HOME}/.cargo/env" 2>/dev/null || true
  export PATH="${HOME}/.cargo/bin:${PATH}"
}

# shellcheck disable=SC1091
source "${HOME}/.cargo/env" 2>/dev/null || true
export PATH="${HOME}/.cargo/bin:${PATH}"

if ! rust_meets_min; then
  ensure_rust
fi

if ! rust_meets_min; then
  echo "ERROR: rustc/cargo >= ${MIN_RUST_MAJOR}.${MIN_RUST_MINOR} required (edition2024)" >&2
  rustc --version 2>&1 || true
  cargo --version 2>&1 || true
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is required on the Cloud VM base image (or install Node 20+ before npm ci)" >&2
  exit 1
fi

npm ci
