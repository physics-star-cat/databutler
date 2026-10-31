#!/usr/bin/env bash
# Live verification of the front door. Usage: scripts/verify-hub.sh [https://databutler.dev]
# The block between the sync-areas markers is generated from api/_areas/*.js
# (each area's `verify` list) by `node scripts/sync-areas.js`; edit the modules, not the block.
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
check changed "$(inner "$(tool what_changed_since '{"since":"2026-06-01"}')")" \
  "d['since']=='2026-06-01' and isinstance(d['entries'],list) and d['coverageStart']=='2026-08-31'"
check call-unknown "$(inner "$(tool call '{"tool":"linear_regresion","arguments":{}}')")" "d['covered']==False and d['nearest'][0]=='linear_regression'"
check rest-changes "$(curl -sS "$BASE/api/changes?since=2026-06-01&area=uk-rates")" "d['area']=='uk-rates' and 'cite' in d"

# sync-areas:checks start
check tools/list "$(rpc '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')" \
  "[t['name'] for t in d['result']['tools']]==['uk_rates_lookup','exam_topic_paper','domain_provenance','package_provenance','take_home_pay','what_changed_since','get_fact','resolve_fact','coverage','catalogue','call']"
check catalogue "$(inner "$(tool catalogue '{}')")" "d['count']==34"
# uk-rates
check rates "$(inner "$(tool uk_rates_lookup '{"category":"income-tax"}')")" \
  "d['freshness']['staleness'] in ('fresh','due','overdue') and d['cite']['url']=='https://databutler.dev/r/uk/rates?category=income-tax'"
check call-nearmiss-rates "$(inner "$(tool uk_rates_lookup '{"category":"incme"}')")" \
  "d['covered']==False and 'income-tax' in d['nearest']"
check rest-rates-envelope "$(curl -sS "$BASE/api/uk/rates?category=vat")" "'freshness' in d and 'cite' in d"
# uk-exams
check topic "$(inner "$(tool exam_topic_paper '{"topic":"electricity","board":"aqa","subject":"physics"}')")" \
  "d['results'][0]['paper']==1 and d['cite']['url'].startswith('https://databutler.dev/r/uk/exams/topic?')"
check coverage "$(inner "$(tool coverage '{"area":"uk-exams"}')")" \
  "'aqa' in d['boards']"
# provenance
check domain "$(inner "$(tool domain_provenance '{"domain":"databutler.dev"}')")" \
  "d['freshness']['staleness']=='live' and 'cite' in d"
check package "$(inner "$(tool package_provenance '{"ecosystem":"npm","name":"express"}')")" \
  "d['freshness']['staleness']=='live'"
# stats
check call-stats "$(inner "$(tool call '{"tool":"distribution","arguments":{"dist":"normal","at":1.96}}')")" \
  "abs(d['cdf']-0.975)<0.001 and d['cite']['url'].startswith('https://databutler.dev/r/stats?op=distribution')"
# vehicles
check call-fr-recalls "$(inner "$(tool call '{"tool":"fr_recalls_for_model","arguments":{"brand":"peugeot","model":"208"}}')")" \
  "d['count']>0 and d['recalls'][0]['link'].startswith('https://rappel.conso.gouv.fr/') and d['freshness']['verifiedDate']"
check call-uk-recalls "$(inner "$(tool call '{"tool":"uk_recalls_for_model","arguments":{"make":"Vauxhall","model":"Corsa"}}')")" \
  "d['count']>0 and d['recalls'][0]['link'].startswith('https://www.check-vehicle-recalls.service.gov.uk/') and d['freshness']['verifiedDate']"
check rest-uk-recalls-search "$(curl -sS "$BASE/api/vehicles/uk/recalls-search?text=airbag&since=2025-01-01")" "'freshness' in d and d['cite']['url'].startswith('https://databutler.dev/r/vehicles/uk/recalls-search?')"
check call-jp-recalls "$(inner "$(tool call '{"tool":"jp_recalls_for_model","arguments":{"make":"toyota","model":"prius"}}')")" \
  "d['count']>0 and d['recalls'][0]['officialPdf'].startswith('https://renrakuda.mlit.go.jp/mt/recallpdf/')"
check call-mot-search "$(inner "$(tool call '{"tool":"uk_mot_vehicle_search","arguments":{"q":"golf"}}')")" \
  "('vehicles' in d and d['upstreamProvenance']['attribution']=='whatbreaks.uk') or d.get('error')=='upstream unavailable'"
check rest-fr-recalls "$(curl -sS "$BASE/api/vehicles/fr/recalls?brand=peugeot&model=208")" "'freshness' in d and d['cite']['url'].startswith('https://databutler.dev/r/vehicles/fr/recalls?')"
# tax
check take-home-uk "$(inner "$(tool take_home_pay '{"country":"uk","gross":50000}')")" \
  "(d['currency']=='GBP' and d['taxYear'] and d['net']['annual']<50000 and d['upstreamProvenance']['attribution']=='lifebynumbers.net' and d['cite']['url'].startswith('https://databutler.dev/r/tax/take-home?country=uk')) or d.get('error')=='upstream unavailable'"
check take-home-es "$(inner "$(tool take_home_pay '{"country":"es","gross":40000}')")" \
  "(d['currency']=='EUR' and d['taxYear']=='2026' and d['net']['annual']<40000) or d.get('error')=='upstream unavailable'"
check take-home-bad "$(inner "$(tool take_home_pay '{"country":"zz","gross":1}')")" \
  "d['covered']==False and 'uk' in d['coverage']"
check rest-take-home "$(curl -sS "$BASE/api/tax/take-home?country=de&gross=48000")" "'freshness' in d and (d.get('currency')=='EUR' or d.get('error')=='upstream unavailable')"
check rest-take-home-400 "$(curl -sS "$BASE/api/tax/take-home?country=uk")" "'missing' in d['error']"
# software-eol
check call-support-status "$(inner "$(tool call '{"tool":"support_status","arguments":{"product":"nodejs","version":"18.19.0"}}')")" \
  "d['cycle']=='18' and d['supported']==False and d['eol']=='2025-04-30' and d['upstreamProvenance']['attribution']=='endoflife.date' and d['freshness']['staleness'] in ('fresh','due','overdue') and d['cite']['url']=='https://databutler.dev/r/software-eol/status?product=nodejs&version=18.19.0'"
check rest-software-eol-timeline "$(curl -sS "$BASE/api/software-eol/timeline?product=python")" "d['product']=='python' and d['cycleCount']>10 and 'freshness' in d"
check rest-software-eol-400 "$(curl -sS "$BASE/api/software-eol/status?product=nodejs")" "'missing' in d['error']"
# policy-rates
check call-policy-boe "$(inner "$(tool call '{"tool":"policy_rate","arguments":{"bank":"boe"}}')")" \
  "d['bank']=='boe' and d['figures'][0]['key']=='bank-rate' and d['source'].startswith('https://www.bankofengland.co.uk/') and d['freshness']['staleness'] in ('fresh','due','overdue') and d['cite']['url']=='https://databutler.dev/r/policy-rates?bank=boe'"
check call-policy-all "$(inner "$(tool call '{"tool":"policy_rate","arguments":{"all":true}}')")" \
  "d['count']==3 and [b['bank'] for b in d['banks']]==['boe','fed','ecb'] and all(b['source'] and b['effectiveFrom'] and b['nextDecision'] for b in d['banks'])"
check call-policy-bad "$(inner "$(tool call '{"tool":"policy_rate","arguments":{"bank":"boj"}}')")" \
  "d['covered']==False and 'boe' in d['coverage']"
check rest-policy-rates "$(curl -sS "$BASE/api/policy-rates?bank=ecb")" "d['bank']=='ecb' and len(d['figures'])==3 and 'freshness' in d and d['cite']['url']=='https://databutler.dev/r/policy-rates?bank=ecb'"
check rest-policy-rates-400 "$(curl -sS "$BASE/api/policy-rates")" "'missing' in d['error']"
# us-rates
check us-rates-listing "$(inner "$(tool call '{"tool":"us_rates_lookup","arguments":{}}')")" \
  "'categories' in d and 'freshness' in d and d['taxYear']=='2026' and 'income-tax' in d['categories']"
check call-us-rates-income-tax "$(inner "$(tool call '{"tool":"us_rates_lookup","arguments":{"category":"income-tax"}}')")" \
  "d['category']=='income-tax' and d['source'].startswith('https://www.irs.gov/') and len(d['figures'])>=10 and d['freshness']['staleness'] in ('fresh','due','overdue') and d['cite']['url']=='https://databutler.dev/r/us/rates?category=income-tax'"
check call-us-rates-nearmiss "$(inner "$(tool call '{"tool":"us_rates_lookup","arguments":{"category":"incme"}}')")" \
  "d['covered']==False and 'income-tax' in d['nearest'] and 'social-security' in d['coverage']"
check rest-us-rates "$(curl -sS "$BASE/api/us/rates?category=social-security")" "d['category']=='social-security' and 'freshness' in d and d['cite']['url']=='https://databutler.dev/r/us/rates?category=social-security'"
# de-rates
check de-rates-listing "$(inner "$(tool call '{"tool":"de_rates_lookup","arguments":{}}')")" \
  "'categories' in d and 'freshness' in d and d['taxYear']=='2026' and 'social-insurance' in d['categories']"
check call-de-rates-income-tax "$(inner "$(tool call '{"tool":"de_rates_lookup","arguments":{"category":"income-tax"}}')")" \
  "d['category']=='income-tax' and d['source'].startswith('https://www.gesetze-im-internet.de/') and all(f['term'] for f in d['figures']) and d['freshness']['staleness'] in ('fresh','due','overdue') and d['cite']['url']=='https://databutler.dev/r/de/rates?category=income-tax'"
check call-de-rates-nearmiss "$(inner "$(tool call '{"tool":"de_rates_lookup","arguments":{"category":"kirchensteuer"}}')")" \
  "d['covered']==False and 'income-tax' in d['coverage'] and len(d['nearest'])>0"
check rest-de-rates "$(curl -sS "$BASE/api/de/rates?category=minimum-wage")" "d['category']=='minimum-wage' and 'freshness' in d and d['cite']['url']=='https://databutler.dev/r/de/rates?category=minimum-wage'"
# uk-vehicle-rules
check uk-vehicle-rules-listing "$(inner "$(tool call '{"tool":"uk_vehicle_rules_lookup","arguments":{}}')")" \
  "'categories' in d and 'ved-first-year' in d['categories'] and 'freshness' in d"
check uk-vehicle-rules-rest-listing "$(curl -sS "$BASE/api/uk/vehicle-rules")" "'categories' in d and 'cite' in d"
check call-uk-vehicle-rules-standard "$(inner "$(tool call '{"tool":"uk_vehicle_rules_lookup","arguments":{"category":"ved-standard"}}')")" \
  "d['category']=='ved-standard' and d['figures'][0]['value']==200 and d['source'].startswith('https://www.gov.uk/') and d['freshness']['staleness'] in ('fresh','due','overdue') and d['cite']['url']=='https://databutler.dev/r/uk/vehicle-rules?category=ved-standard'"
check call-uk-vehicle-rules-nearmiss "$(inner "$(tool call '{"tool":"uk_vehicle_rules_lookup","arguments":{"category":"mot-fees"}}')")" \
  "(d.get('covered')==False and 'mot' in d['nearest']) or d.get('category')=='mot'"
check rest-uk-vehicle-rules-mot "$(curl -sS "$BASE/api/uk/vehicle-rules?category=mot")" "d['category']=='mot' and any(f['key']=='max-fee-car' and f['value']==54.85 for f in d['figures']) and 'freshness' in d and d['cite']['url']=='https://databutler.dev/r/uk/vehicle-rules?category=mot'"
# uk-exam-dates
check uk-exam-dates-listing "$(inner "$(tool call '{"tool":"uk_exam_dates","arguments":{}}')")" \
  "'kinds' in d and 'boards' in d and 'freshness' in d"
check uk-exam-dates-results-jcq "$(inner "$(tool call '{"tool":"uk_exam_dates","arguments":{"kind":"results","board":"jcq","qualification":"gcse"}}')")" \
  "d['kind']=='results' and any(f['key']=='jcq-gcse-results-day' and f['value']=='2027-08-19' for f in d['figures']) and d['cite']['url'].startswith('https://databutler.dev/r/uk/exam-dates?')"
check uk-exam-dates-rest-listing "$(curl -sS "$BASE/api/uk/exam-dates")" "'kinds' in d and 'cite' in d"
check uk-exam-dates-rest-nearmiss "$(curl -sS "$BASE/api/uk/exam-dates?kind=timetable&board=cie")" "d['covered']==False and 'nearest' in d"
# calendar
check call-calendar-uk-2027 "$(inner "$(tool call '{"tool":"calendar_facts","arguments":{"country":"uk","kind":"holidays","year":2027}}')")" \
  "d['region']=='england-and-wales' and d['count']==8 and d['holidays'][1]['date']=='2027-03-26' and d['freshness']['staleness'] in ('fresh','due','overdue') and d['cite']['url']=='https://databutler.dev/r/calendar?country=uk&kind=holidays&year=2027'"
check call-next-holiday-by "$(inner "$(tool call '{"tool":"next_holiday","arguments":{"country":"de","from":"2026-12-27","region":"BY"}}')")" \
  "d['next']['date']=='2027-01-01' and d['following'][0]['key']=='heilige-drei-koenige' and d['region']=='BY'"
check call-calendar-nearmiss "$(inner "$(tool call '{"tool":"calendar_facts","arguments":{"country":"spain","kind":"holidays"}}')")" \
  "d['covered']==False and 'uk' in d['coverage']"
check rest-calendar-fr-dst "$(curl -sS "$BASE/api/calendar?country=fr&kind=dst&year=2027")" "d['observed']==True and d['transitions']['2027']['clocksForward']=='2027-03-28' and 'freshness' in d and d['cite']['url']=='https://databutler.dev/r/calendar?country=fr&kind=dst&year=2027'"
check rest-calendar-listing "$(curl -sS "$BASE/api/calendar")" "'countries' in d and 'cite' in d"
check rest-calendar-next-400 "$(curl -sS "$BASE/api/calendar/next")" "'missing' in d['error']"
# uk-gov-process
check uk-gov-process-listing "$(inner "$(tool call '{"tool":"uk_gov_process","arguments":{}}')")" \
  "'passport-renewal-adult' in d['categories'] and 'aliases' in d and 'freshness' in d"
check uk-gov-process-rest-listing "$(curl -sS "$BASE/api/uk/gov-process")" "'categories' in d and 'cite' in d"
check call-uk-gov-process-passport "$(inner "$(tool call '{"tool":"uk_gov_process","arguments":{"service":"passport"}}')")" \
  "d['service']=='passport-renewal-adult' and any(f['key']=='fee-online-uk' and f['value']==102 for f in d['figures']) and d['source'].startswith('https://www.gov.uk/') and d['freshness']['staleness'] in ('fresh','due','overdue') and d['cite']['url']=='https://databutler.dev/r/uk/gov-process?service=passport'"
check rest-uk-gov-process-eta "$(curl -sS "$BASE/api/uk/gov-process?service=eta")" "d['service']=='eta' and any(f['key']=='fee' and f['value']==20 for f in d['figures']) and 'freshness' in d"
check call-uk-gov-process-nearmiss "$(inner "$(tool call '{"tool":"uk_gov_process","arguments":{"service":"zzz-passprt"}}')")" \
  "d.get('covered')==False and len(d['nearest'])>0"
# jp-vehicle-costs
check jp-vehicle-costs-listing "$(inner "$(tool call '{"tool":"jp_vehicle_costs_lookup","arguments":{}}')")" \
  "'categories' in d and 'cali' in d['categories'] and 'freshness' in d"
check jp-vehicle-costs-rest-listing "$(curl -sS "$BASE/api/jp/vehicle-costs")" "'categories' in d and 'cite' in d"
check call-jp-vehicle-costs-weight-tax "$(inner "$(tool call '{"tool":"jp_vehicle_costs_lookup","arguments":{"category":"weight-tax"}}')")" \
  "d['category']=='weight-tax' and any(f['key']=='passenger-standard-per-0.5t-2y' and f['value']==8200 for f in d['figures']) and d['source'].startswith('https://www.mlit.go.jp/') and d['freshness']['staleness'] in ('fresh','due','overdue') and d['cite']['url']=='https://databutler.dev/r/jp/vehicle-costs?category=weight-tax'"
check rest-jp-vehicle-costs-cali "$(curl -sS "$BASE/api/jp/vehicle-costs?category=cali")" "d['category']=='cali' and any(f['key']=='passenger-24m' and f['value']==17650 for f in d['figures']) and any(f['key']=='passenger-24m-from-2026-11' and f['value']==18560 for f in d['figures'])"
check call-jp-vehicle-costs-nearmiss "$(inner "$(tool call '{"tool":"jp_vehicle_costs_lookup","arguments":{"category":"jibaiseki"}}')")" \
  "d.get('covered')==False and len(d['nearest'])>0"
# jp-living-costs
check jp-living-costs-listing "$(inner "$(tool call '{"tool":"jp_living_costs_lookup","arguments":{}}')")" \
  "'categories' in d and 'minimum-wage' in d['categories'] and 'freshness' in d"
check jp-living-costs-rest-listing "$(curl -sS "$BASE/api/jp/living-costs")" "'categories' in d and 'cite' in d"
check call-jp-living-costs-minimum-wage "$(inner "$(tool call '{"tool":"jp_living_costs_lookup","arguments":{"category":"minimum-wage"}}')")" \
  "d['category']=='minimum-wage' and any(f['key']=='tokyo' and f['value']==1280 and f['effectiveFrom']=='2026-10-01' for f in d['figures']) and d['source'].startswith('https://www.mhlw.go.jp/') and d['freshness']['staleness'] in ('fresh','due','overdue') and d['cite']['url']=='https://databutler.dev/r/jp/living-costs?category=minimum-wage'"
check rest-jp-living-costs-health-insurance "$(curl -sS "$BASE/api/jp/living-costs?category=health-insurance")" "d['category']=='health-insurance' and any(f['key']=='tokyo' and f['value']==9.85 for f in d['figures']) and any(f['key']=='child-rearing-levy' and f['value']==0.23 for f in d['figures'])"
check call-jp-living-costs-nearmiss "$(inner "$(tool call '{"tool":"jp_living_costs_lookup","arguments":{"category":"saiteichingin"}}')")" \
  "d.get('covered')==False and len(d['nearest'])>0"
for name in uk-rates uk-exams provenance stats vehicles tax software-eol policy-rates us-rates de-rates uk-vehicle-rules uk-exam-dates calendar uk-gov-process jp-vehicle-costs jp-living-costs; do
  check "legacy $name tools/list" "$(curl -sS -X POST "$BASE/api/mcp/$name" -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')" "len(d['result']['tools'])>0"
done
# sync-areas:checks end

R="$(curl -sS -D - "$BASE/r/uk/rates?category=income-tax")"
if grep -qi 'x-robots-tag: noindex' <<<"$R" && grep -q 'income-tax-rates' <<<"$R" && grep -q 'Personal Allowance' <<<"$R"; then echo "PASS /r page"; else echo "FAIL /r page"; FAILED=1; fi
CODE="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/cron/watch-sources")"
if [ "$CODE" = "401" ]; then echo "PASS cron unauth"; else echo "FAIL cron unauth ($CODE)"; FAILED=1; fi

# Verified Facts (docs/FACTS_PROTOCOL.md) — hand-written, outside the sync-areas block
FACTS="$BASE/api/mcp/facts"
check f-get "$(curl -sS "$BASE/f/uk/income-tax/personal-allowance?max_age=400d")" \
  "d['status']=='fresh' and d['hash'].startswith('sha256:') and 'jws' in d['signature'] and d['value']==12570"
check f-miss "$(curl -sS "$BASE/f/zz/no/such-fact")" "d['error']=='unknown key' and isinstance(d['candidates'],list)"
TXT="$(curl -sS "$BASE/f/uk/income-tax/personal-allowance?format=txt")"
if [[ "$TXT" =~ ^[0-9] ]]; then echo "PASS f-txt"; else echo "FAIL f-txt"; echo "$TXT" | head -c 300; echo; FAILED=1; fi
check f-resolve "$(curl -sS "$BASE/f/resolve?q=ECB%20deposit%20rate")" "d['candidates'][0]['key']=='eu/ecb/deposit-facility' and d['best']['key']=='eu/ecb/deposit-facility'"
check f-batch "$(curl -sS "$BASE/f?keys=uk/bank-rate,us/social-security/wage-base,zz/missing/key")" "d['count']==3 and d['results'][2]['covered']==False"
check facts-mcp-list "$(curl -sS -X POST "$FACTS" -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')" \
  "[t['name'] for t in d['result']['tools']]==['get_fact','resolve_fact','what_changed_since']"
check facts-well-known "$(curl -sS "$BASE/.well-known/facts.json")" "d['protocol']=='verified-facts/0.2' and d['conformance']=='L3'"
check facts-jwks "$(curl -sS "$BASE/.well-known/jwks.json")" "len(d['keys'])>=1 and all(k['crv']=='Ed25519' and 'd' not in k for k in d['keys'])"
check facts-server-card "$(curl -sS "$FACTS/server-card")" "d['name']=='io.github.physics-star-cat/databutler-facts'"
check facts-openapi "$(curl -sS "$BASE/openapi.json")" "d['x-verified-facts']=='0.2'"
if node "$(dirname "$0")/verify-fact.js" "$BASE/f/uk/income-tax/personal-allowance" --jwks "$BASE/.well-known/jwks.json" > /dev/null; then echo "PASS verify-fact"; else echo "FAIL verify-fact"; FAILED=1; fi

[ "$FAILED" = 0 ] && echo "ALL PASS" || { echo "SOME FAILED"; exit 1; }
