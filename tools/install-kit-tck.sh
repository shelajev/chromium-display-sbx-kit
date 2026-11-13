#!/bin/sh
# m.12 has upstream replace directives, so go install package@version rejects
# it. Build the checksum-verified module as the main module, preserving them.
set -eu
version=v3.0.0-m.12
module=github.com/docker/sandbox-kit-spec/v3
out="${1:-$(go env GOPATH)/bin/kit-tck}"
# Resolve before go -C changes the build working directory.
case "$out" in /*) ;; *) out="$PWD/$out" ;; esac
if [ -d "$out" ]; then out="$out/kit-tck"; fi
mkdir -p "$(dirname "$out")"
out="$(cd "$(dirname "$out")" && pwd -P)/$(basename "$out")"
go mod download "$module@$version"
src="$(go env GOMODCACHE)/$module@$version"
mkdir -p "$(dirname "$out")"
go -C "$src" build -mod=readonly -o "$out" ./cmd/kit-tck
