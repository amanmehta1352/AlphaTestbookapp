"""Exercise release drift checks against isolated copies, without touching the repo."""

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

source = Path(__file__).resolve().parents[1] / "app"


def rec(name, ok):
    print("PASS" if ok else "FAIL", name, flush=True)
    if not ok:
        raise AssertionError(name)


with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    app = root / "dev/app"
    shutil.copytree(source, app)
    (root / "admin").mkdir()

    def run(*args, cwd=root):
        return subprocess.run(
            [sys.executable, str(app / "build.py"), *args],
            cwd=cwd,
            text=True,
            capture_output=True,
        )

    rec(
        "missing releases fail without being created",
        run("--check").returncode == 1 and not (root / "index.html").exists(),
    )
    rec("student build works from repository root", run("index.html").returncode == 0)
    rec(
        "studio build works from source directory",
        run("../../admin/index.html", "--studio", cwd=app).returncode == 0,
    )
    rec(
        "both generated releases pass from an unrelated directory",
        run("--check", cwd="/tmp").returncode == 0,
    )
    for relative in ["index.html", "admin/index.html"]:
        target = root / relative
        original = target.read_bytes()
        target.write_bytes(original + b"\n<!-- stale -->")
        changed = target.read_bytes()
        result = run("--check")
        rec(
            f"check rejects stale {relative} without rewriting it",
            result.returncode == 1
            and f"FAIL generated release matches source: {relative}" in result.stdout
            and target.read_bytes() == changed,
        )
        target.write_bytes(original)
    part = app / "src/html/body.html"
    part.write_text(part.read_text() + "\n<!-- source change -->", encoding="utf-8")
    rec(
        "source changes invalidate both generated releases",
        run("--check").stdout.count("FAIL generated release") == 2,
    )
    rec(
        "check rejects ambiguous build arguments",
        run("index.html", "--check").returncode == 2,
    )
