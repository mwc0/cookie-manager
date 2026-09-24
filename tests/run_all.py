"""
Run every test file and report a total.

    python run_all.py

Exits non-zero if anything failed, so it can be wired into something later if
that's ever wanted. Each file can also be run on its own.
"""

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

FILES = [
    "test_states.py",
    "test_scopes.py",
    "test_partitioned.py",
    "test_editor.py",
    "test_search.py",
    "test_protect.py",
    "test_no_network.py",
    "test_devtools_crosscheck.py",
]


def main():
    failed = []

    for name in FILES:
        result = subprocess.run([sys.executable, str(HERE / name)], cwd=str(HERE))
        if result.returncode != 0:
            failed.append(name)

    print("\n" + "=" * 60)
    if failed:
        print(f"FAILED: {', '.join(failed)}")
        print(f"{len(FILES) - len(failed)}/{len(FILES)} files passed")
        return 1

    print(f"All {len(FILES)} test files passed.")
    print("\nReminder: the permission prompt and incognito behaviour are NOT")
    print("covered here and need checking by hand -- see README.md.")
    print("Both were checked by hand before 1.0.0.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
