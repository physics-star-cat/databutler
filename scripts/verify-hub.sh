#!/usr/bin/env bash
# Live verification of the front door. Usage: scripts/verify-hub.sh [https://databutler.dev]
set -uo pipefail
BASE="${1:-https://databutler.dev}"
MCP="$BASE/api/mcp"
FAILED=0

rpc() { curl -sS -X POST "$MCP" -H 'Content-Type: application/json' -d "$1"; }
tool() { rpc "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":$2}}"; }
inner() { python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d['result']['content'][0]['text'])" "$1"; }
check() { # label, json, python-expression over d
  if python3 -c "import json,sys; d=json.loads(sys.argv[1]); assert ($3), d" "$2" 2>/dev/null; then echo "PASS $1"; else echo "FAIL $1"; echo "$2" | head -c 500; echo; FAILED=1; fi
}

check initialize "$(rpc '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"verify","version":"0"}}}')" \
  "d['result']['serverInfo']['name']=='databutler' and 'what_changed_since' in d['result']['instructions']"
check tools/list "$(rpc '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')" \
  "[t['name'] for t in d['result']['tools']]==['uk_rates_lookup','exam_topic_paper','domain_provenance','package_provenance','what_changed_since','coverage','catalogue','call']"
check rates "$(inner "$(tool uk_rates_lookup '{"category":"income-tax"}')")" \
  "d['freshness']['staleness'] in ('fresh','due','overdue') and d['cite']['url']=='https://databutler.dev/r/uk/rates?category=income-tax'"
check topic "$(inner "$(tool exam_topic_paper '{"topic":"electricity","board":"aqa","subject":"physics"}')")" \
  "d['results'][0]['paper']==1 and d['cite']['url'].startswith('https://databutler.dev/r/uk/exams/topic?')"
check domain "$(inner "$(tool domain_provenance '{"domain":"databutler.dev"}')")" \
  "d['freshness']['staleness']=='live' and 'cite' in d"
check package "$(inner "$(tool package_provenance '{"ecosystem":"npm","name":"express"}')")" \
  "d['freshness']['staleness']=='live'"
check changed "$(inner "$(tool what_changed_since '{"since":"2026-06-01"}')")" \
  "d['since']=='2026-06-01' and isinstance(d['entries'],list) and d['coverageStart']=='2026-08-31'"
check coverage "$(inner "$(tool coverage '{"area":"uk-exams"}')")" "'aqa' in d['boards']"
check catalogue "$(inner "$(tool catalogue '{}')")" "d['count']==19"
check call-stats "$(inner "$(tool call '{"tool":"distribution","arguments":{"dist":"normal","at":1.96}}')")" \
  "abs(d['cdf']-0.975)<0.001 and d['cite']['url'].startswith('https://databutler.dev/r/stats?op=distribution')"
check call-unknown "$(inner "$(tool call '{"tool":"linear_regresion","arguments":{}}')")" "d['covered']==False and d['nearest'][0]=='linear_regression'"
check call-nearmiss-rates "$(inner "$(tool uk_rates_lookup '{"category":"incme"}')")" "d['covered']==False and 'income-tax' in d['nearest']"

for name in uk-rates uk-exams provenance stats vehicles; do
  check "legacy $name tools/list" "$(curl -sS -X POST "$BASE/api/mcp/$name" -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')" "len(d['result']['tools'])>0"
done

check call-fr-recalls "$(inner "$(tool call '{"tool":"fr_recalls_for_model","arguments":{"brand":"peugeot","model":"208"}}')")" \
  "d['count']>0 and d['recalls'][0]['link'].startswith('https://rappel.conso.gouv.fr/') and d['freshness']['verifiedDate']"
check call-jp-recalls "$(inner "$(tool call '{"tool":"jp_recalls_for_model","arguments":{"make":"toyota","model":"prius"}}')")" \
  "d['count']>0 and d['recalls'][0]['officialPdf'].startswith('https://renrakuda.mlit.go.jp/mt/recallpdf/')"
check call-mot-search "$(inner "$(tool call '{"tool":"uk_mot_vehicle_search","arguments":{"q":"golf"}}')")" \
  "('vehicles' in d and d['upstreamProvenance']['attribution']=='whatbreaks.uk') or d.get('error')=='upstream unavailable'"
check rest-fr-recalls "$(curl -sS "$BASE/api/vehicles/fr/recalls?brand=peugeot&model=208")" "'freshness' in d and d['cite']['url'].startswith('https://databutler.dev/r/vehicles/fr/recalls?')"
check rest-changes "$(curl -sS "$BASE/api/changes?since=2026-06-01&area=uk-rates")" "d['area']=='uk-rates' and 'cite' in d"
check rest-rates-envelope "$(curl -sS "$BASE/api/uk/rates?category=vat")" "'freshness' in d and 'cite' in d"

R="$(curl -sS -D - "$BASE/r/uk/rates?category=income-tax")"
if grep -q 'X-Robots-Tag: noindex' <<<"$R" && grep -q 'income-tax-rates' <<<"$R" && grep -q 'Personal Allowance' <<<"$R"; then echo "PASS /r page"; else echo "FAIL /r page"; FAILED=1; fi
CODE="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/cron/watch-sources")"
if [ "$CODE" = "401" ]; then echo "PASS cron unauth"; else echo "FAIL cron unauth ($CODE)"; FAILED=1; fi

[ "$FAILED" = 0 ] && echo "ALL PASS" || { echo "SOME FAILED"; exit 1; }
