# scripts/dev — maintainer helpers (not run in production)

| Script | Use |
|---|---|
| `resolve-merge.py FILE SPEC` | Resolve git conflict hunks in FILE from a JSON list (one entry per hunk): a literal string, `"@both"` (HEAD then THEIRS, de-duplicated), `"@head"`, `"@theirs"`. Built for merging parallel area branches, where conflicts are two independent additions to the same list. With the area kit (`scripts/sync-areas.js`) most of those conflicts no longer occur. |
| `local-server.js [port]` | Serve the site locally as Vercel would (public/ statically, vercel.json rewrites into `api/router.js`, its headers) without `vercel dev`; `bash scripts/verify-hub.sh http://localhost:3000` runs the live checks against it. |
