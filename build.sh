#!/bin/sh
# Build the single self-contained dist/index.html.
#
# Two things here are load-bearing:
#   * <meta charset="utf-8"> must land inside the first 1024 bytes. With ~1 MB
#     of Chinese dictionary text inlined and no HTTP header at file://, that
#     tag is the only encoding signal the browser gets. It is emitted first,
#     before any script payload, and the build verifies its byte offset.
#   * "</script>" occurring inside any inlined JS would terminate the script
#     element early, so it is escaped.
set -e
cd "$(dirname "$0")"
node tools/build.js "$@"
