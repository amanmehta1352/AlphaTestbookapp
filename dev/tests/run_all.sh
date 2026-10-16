#!/usr/bin/env bash
# Run every test suite against the built index.html. Usage: dev/tests/run_all.sh
cd "$(dirname "$0")"
APP="$(cd ../.. && pwd)/index.html"
OUT="$(mktemp -d)"
SUITES="test_u1_reg test_u2_v4 test_u3 test_u4a test_u4b test_u4c test_u5 test_a test_c1 test_c2 test_f1 test_clean test_pwa test_defaults"
fail=0
for t in $SUITES; do
  case $t in
    test_clean) args="$APP $OUT/$t.json $PWD/old_backup.json" ;;
    test_c2) args="$APP" ;;
    test_pwa) args="" ;;
    *) args="$APP $OUT/$t.json" ;;
  esac
  line=$(timeout 900 python3 "$t.py" $args 2>&1 | tee "$OUT/$t.log" | grep -cE '^FAIL')
  code=${PIPESTATUS[0]}
  if [ "$line" != "0" ] || ! grep -qE '^PASS' "$OUT/$t.log"; then echo "✕ $t (log: $OUT/$t.log)"; fail=1; else echo "✓ $t ($(grep -cE '^PASS' "$OUT/$t.log") checks)"; fi
done
exit $fail
