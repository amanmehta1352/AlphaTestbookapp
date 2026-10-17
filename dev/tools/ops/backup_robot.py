"""💾 Backup Robot: ops_backup_now('auto') + ops_backup_verify (checksum + rebuild test). Fails loudly if the check fails."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import opslib


def main():
    if not opslib.key(): print('❌ SUPABASE_SECRET_KEY नहीं मिला'); return 1
    note = (os.environ.get('NOTE') or '').strip()[:200] or None
    b = opslib.sb('POST', '/rest/v1/rpc/ops_backup_now', {'p_kind': 'manual' if note else 'auto', 'p_note': note}, actor='backup-robot', timeout=180)
    v = opslib.sb('POST', '/rest/v1/rpc/ops_backup_verify', {'p_id': b['id']}, actor='backup-robot', timeout=180)
    c = b['counts']
    line = f"💾 Backup #{b['id']} · जाँच: {v} · सवाल {c.get('questions')} · students {c.get('profiles')} · जवाब {c.get('attempts')} · टेस्ट {c.get('results')}"
    print(line)
    if os.environ.get('GITHUB_STEP_SUMMARY'): open(os.environ['GITHUB_STEP_SUMMARY'], 'a').write('### ' + line + '\n')
    opslib.write_counts(sum(v2 for v2 in c.values() if isinstance(v2, int)), 1, line)
    return 0 if v == 'ok' else 2


if __name__ == '__main__':
    sys.exit(main())
