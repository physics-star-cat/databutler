#!/usr/bin/env bash
# Build the ChatGPT plugin directory package (dist/databutler-chatgpt-plugin.zip)
# from chatgpt-plugin/. Upload it at platform.openai.com → Plugins.
# Procedure and requirements: chatgpt-plugin/README.md.
set -euo pipefail
cd "$(dirname "$0")/.."
cp public/icon.png chatgpt-plugin/assets/icon.png
if grep -q REPLACE_WITH_VIDEO_URL chatgpt-plugin/plugin.json; then
  echo "note: review.demo_recording_url is still a placeholder (required before submitting for review)" >&2
fi
python3 -c "import json;json.load(open('chatgpt-plugin/plugin.json'));json.load(open('chatgpt-plugin/mcp.json'))"
mkdir -p dist
rm -f dist/databutler-chatgpt-plugin.zip
(cd chatgpt-plugin && zip -qr ../dist/databutler-chatgpt-plugin.zip plugin.json mcp.json assets skills)
unzip -l dist/databutler-chatgpt-plugin.zip
