#!/usr/bin/env bash
# Run every test suite against the built index.html. Usage: dev/tests/run_all.sh
cd "$(dirname "$0")"
APP="$(cd ../.. && pwd)/index.html"
OUT="$(mktemp -d)"
SUITES="test_u1_reg test_u2_v4 test_u3 test_u4a test_u4b test_u4c test_u5 test_a test_c1 test_c2 test_f1 test_clean test_pwa test_defaults test_sql_v2 test_studio test_robot test_hindi test_tagger"
fail=0
for t in $SUITES; do
  case $t in
    test_clean) args="$APP $OUT/$t.json $PWD/old_backup.json" ;;
    test_c2) args="$OUT" ;;
    test_a) args="$APP $OUT" ;;
    test_pwa|test_sql_v2|test_robot|test_hindi|test_tagger) args="" ;;
    test_studio) args="$OUT" ;;
    *) args="$APP $OUT/$t.json" ;;
  esac
  timeout 900 python3 "$t.py" $args > "$OUT/$t.log" 2>&1; code=$?
  line=$(grep -cE '^FAIL' "$OUT/$t.log")
  if [ "$code" != "0" ] || [ "$line" != "0" ] || ! grep -qE '^PASS' "$OUT/$t.log"; then echo "✕ $t (log: $OUT/$t.log)"; fail=1; else echo "✓ $t ($(grep -cE '^PASS' "$OUT/$t.log") checks)"; fi
done
exit $fail
