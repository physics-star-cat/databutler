# ChatGPT plugin directory package

Source for the Data Butler listing in the ChatGPT (and Codex) plugin directory.
Build with `scripts/build-chatgpt-plugin.sh` → `dist/databutler-chatgpt-plugin.zip`.

Format: Agent Plugins (`plugin.json` + `mcp.json` + `skills/` + `assets/`), OpenAI
fields under `extensions.com.openai`. Spec: developers.openai.com/plugins/deploy/submission.

## Submitting (owner steps)

1. **Verify the OpenAI organisation once** (platform.openai.com → Settings → Organization →
   Verifications → Individual). Submission is blocked until this is done.
2. **Demo video** (required for MCP review): a 1–3 minute screen recording of the five positive
   test cases in ChatGPT with the connector added (developer mode), uploaded somewhere a reviewer
   can open (unlisted YouTube or Loom). Put the URL in `review.demo_recording_url` and rebuild.
3. Upload the zip: platform.openai.com → Plugins → Upload new or existing plugin.
4. **Domain verification**: the MCPs tab shows a challenge token. Save it, exactly and alone, as
   `public/.well-known/openai-apps-challenge` (no newline needed), push, wait for the deploy, then
   click Connect. Keep the file afterwards.
5. Wait for the tool scan, resolve findings, Submit for review, attest.

## Updating

Tool changes on the server are picked up by OpenAI's daily scan (or Rescan); no new zip.
Listing text, icons, skills or test cases → bump `version`, rebuild, upload to the existing plugin.
The MCP URL cannot be changed after publication without support.
