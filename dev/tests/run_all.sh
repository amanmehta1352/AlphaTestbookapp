#!/usr/bin/env bash
# Run every test suite against the built index.html. Usage: dev/tests/run_all.sh
cd "$(dirname "$0")"
APP="$(cd ../.. && pwd)/index.html"
OUT="$(mktemp -d)"
SUITES="test_u1_reg test_u2_v4 test_u3 test_u4a test_u4b test_u4c test_u5 test_a test_c1 test_c2 test_f1 test_clean test_pwa test_defaults test_sql_v2 test_studio test_robot test_hindi test_tagger test_profile test_v3 test_keycheck test_health test_ops"
fail=0
for t in $SUITES; do
  case $t in
    test_clean) args="$APP $OUT/$t.json $PWD/old_backup.json" ;;
    test_c2) args="$OUT" ;;
    test_a) args="$APP $OUT" ;;
    test_pwa|test_sql_v2|test_robot|test_hindi|test_tagger|test_keycheck|test_health|test_ops) args="" ;;
    test_studio|test_profile) args="$OUT" ;;
    *) args="$APP $OUT/$t.json" ;;
  esac
  timeout 900 python3 "$t.py" $args > "$OUT/$t.log" 2>&1; code=$?
  line=$(grep -cE '^FAIL' "$OUT/$t.log")
  if [ "$code" != "0" ] || [ "$line" != "0" ] || ! grep -qE '^PASS' "$OUT/$t.log"; then echo "✕ $t (log: $OUT/$t.log)"; fail=1; else echo "✓ $t ($(grep -cE '^PASS' "$OUT/$t.log") checks)"; fi
  echo "$t $code" >> "$OUT/_codes.txt"
done
# machine-readable summary for the Control Room (Health Robot reads it from the "test-summary" artifact)
python3 - "$OUT" "${TEST_SUMMARY:-$OUT/summary.json}" <<'PY'
import json, re, sys, os, datetime
out, dest = sys.argv[1], sys.argv[2]; suites = []
for ln in open(os.path.join(out, '_codes.txt')):
    t, code = ln.split(); log = open(os.path.join(out, t + '.log'), errors='replace').read().splitlines()
    fails = [l[5:].strip()[:200] for l in log if l.startswith('FAIL')]
    passes = sum(1 for l in log if l.startswith('PASS'))
    err = [l.strip()[:200] for l in log if re.search(r'Error|Traceback|assert', l)][-3:]
    suites.append({'suite': t, 'ok': code == '0' and not fails and passes > 0, 'passed': passes, 'failed': len(fails), 'fails': fails[:5], 'errors': err if code != '0' else []})
json.dump({'at': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'), 'suites': suites,
           'passed': sum(s['passed'] for s in suites), 'failed_suites': [s['suite'] for s in suites if not s['ok']]}, open(dest, 'w'), indent=1)
PY
exit $fail
