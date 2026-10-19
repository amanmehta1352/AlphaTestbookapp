"""Build the student/Admin Studio HTML, or check both release files for drift."""

import argparse
import json
from pathlib import Path
import re

APP = Path(__file__).resolve().parent
ROOT = APP.parent.parent


def render(version=None, studio=False):
    manifest = json.loads((APP / "manifest.json").read_text(encoding="utf-8"))
    parts, script_open = [], False
    for part in manifest["parts"]:
        body = (APP / part["file"]).read_text(encoding="utf-8")
        if part.get("script") and not script_open:
            parts.append("<script>")
            script_open = True
        if not part.get("script") and script_open:
            parts.append("</script>")
            script_open = False
        if "wrap" in part:
            parts.extend([part["wrap"][0], body, part["wrap"][1]])
        else:
            parts.append(body)
    html = "\n".join(parts)
    if version:
        html = re.sub(
            r'(<meta name="app-version" content=")[^"]*(")',
            lambda match: match[1] + version + match[2],
            html,
        )
    if studio:
        html = html.replace(
            "<head>",
            '<head>\n<script>window.MTB_STUDIO = true;</script>\n<meta name="robots" content="noindex">',
            1,
        )
        html = html.replace(
            "<title>TestBook</title>", "<title>TestBook Admin Studio</title>", 1
        )
        html = html.replace('<link rel="manifest" href="manifest.webmanifest">', "", 1)
        html = re.sub(
            r'href="(icon-192\.png|apple-touch-icon\.png)"', r'href="../\1"', html
        )
    return html.encode("utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", nargs="?", type=Path)
    parser.add_argument("version", nargs="?")
    parser.add_argument("--studio", action="store_true")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Verify both checked-in release files without writing",
    )
    args = parser.parse_args()
    if args.check:
        if args.output or args.version or args.studio:
            parser.error(
                "--check checks both release files; do not combine it with build arguments"
            )
        stale = False
        for relative, studio in [("index.html", False), ("admin/index.html", True)]:
            target = ROOT / relative
            matches = target.is_file() and target.read_bytes() == render(studio=studio)
            print(
                f"{'PASS' if matches else 'FAIL'} generated release matches source: {relative}"
            )
            stale |= not matches
        if stale:
            print("Rebuild both files using the commands in dev/app/README.md.")
        return int(stale)
    if not args.output:
        parser.error("provide an output path or use --check")
    data = render(args.version, args.studio)
    args.output.write_bytes(data)
    print(f"built {args.output} ({len(data)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
