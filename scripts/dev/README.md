# scripts/dev — maintainer helpers (not run in production)

| Script | Use |
|---|---|
| `resolve-merge.py FILE SPEC` | Resolve git conflict hunks in FILE from a JSON list (one entry per hunk): a literal string, `"@both"` (HEAD then THEIRS, de-duplicated), `"@head"`, `"@theirs"`. Built for merging parallel area branches, where conflicts are two independent additions to the same list. With the area kit (`scripts/sync-areas.js`) most of those conflicts no longer occur. |
| `local-server.js [port]` | Serve the site locally as Vercel would (public/ statically, vercel.json rewrites into `api/router.js`, its headers) without `vercel dev`; `bash scripts/verify-hub.sh http://localhost:3000` runs the live checks against it. |
| `quote-check.js --changed \| <url> …` | Monday `source-changed` triage: fetch each page as the watcher does and test every served record's `quote` fragments against it. All present = the page changed, the figures did not (refresh the baseline with `scripts/sources.js`, re-run `scripts/check-sources.js`); a missing fragment = read the page. Pages no served record cites (exam-board landing pages, BMAS announcements) report `none` and need the area's own check. |
