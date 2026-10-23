"""
Builds the Chrome Web Store zip, then checks it.

    python store/package.py

Writes cookie-manager-<version>.zip in the repo root. Nothing is changed on
the way in: every file goes into the zip exactly as it is in src/. The
listing promises that what's published is what's in the source, so keep it
that way.

The main thing it prevents is zipping the src folder itself instead of its
contents. Chrome needs manifest.json at the top of the zip, and the upload
error doesn't make that obvious.
"""

import json
import sys
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SRC = REPO / "src"

# Never shipped in the extension.
NEVER_SHIP = {".map", ".log", ".zip", ".crx", ".pem", ".py", ".md"}
NEVER_SHIP_NAMES = {".DS_Store", "Thumbs.db", "desktop.ini", ".gitignore"}


def collect():
    """Every file in src/, as (path on disk, path inside the zip)."""
    files = []
    for path in sorted(SRC.rglob("*")):
        if not path.is_file():
            continue
        if path.name in NEVER_SHIP_NAMES or path.suffix in NEVER_SHIP:
            print(f"  skipping {path.relative_to(SRC)} (never shipped)")
            continue
        files.append((path, path.relative_to(SRC).as_posix()))
    return files


def check_before(files):
    """Problems that would get the zip rejected by the store."""
    problems = []

    names = {arc for _, arc in files}
    if "manifest.json" not in names:
        problems.append("src/manifest.json is missing")
        return problems, None

    manifest = json.loads((SRC / "manifest.json").read_text(encoding="utf-8"))

    for field in ("name", "version", "description", "manifest_version"):
        if not manifest.get(field):
            problems.append(f"manifest.json has no {field}")

    # The name and description live in _locales/<language>/messages.json, one
    # file per language the store shows the summary in. Check each one.
    for field, key in (("name", "appName"), ("description", "appDesc")):
        if manifest.get(field) != f"__MSG_{key}__":
            problems.append(f"manifest.json's {field} should be __MSG_{key}__")
    default = manifest.get("default_locale")
    if f"_locales/{default}/messages.json" not in names:
        problems.append(f"default_locale is {default!r}, but there is no _locales/{default}/messages.json")
    for arc in sorted(n for n in names if n.startswith("_locales/")):
        try:
            messages = json.loads((SRC / arc).read_text(encoding="utf-8"))
            name = messages["appName"]["message"]
            desc = messages["appDesc"]["message"]
        except (ValueError, KeyError, TypeError) as error:
            problems.append(f"{arc} can't be read, or lacks appName or appDesc: {error}")
            continue
        if not name or not desc:
            problems.append(f"{arc} has an empty name or description")
        if len(desc) > 132:
            problems.append(f"{arc}: the description is over Chrome's 132 character limit")

    # The store refuses a submission with no 128x128 icon, and a missing icon
    # path is a silent failure: the extension loads with a placeholder.
    icons = manifest.get("icons", {})
    if "128" not in icons:
        problems.append("manifest.json declares no 128x128 icon; the store requires one")
    for size, rel in icons.items():
        if rel not in names:
            problems.append(f"icons.{size} points at {rel}, which is not in src/")

    popup = manifest.get("action", {}).get("default_popup")
    if popup and popup not in names:
        problems.append(f"default_popup points at {popup}, which is not in src/")

    return problems, manifest


def check_after(zip_path, files):
    """Read the finished zip back and confirm it is what we meant to make."""
    problems = []
    with zipfile.ZipFile(zip_path) as z:
        inside = set(z.namelist())

        if "manifest.json" not in inside:
            problems.append(
                "manifest.json is not at the root of the zip. Chrome will reject "
                "this: the archive must contain the CONTENTS of src/, not the "
                "src folder itself."
            )

        expected = {arc for _, arc in files}
        for missing in sorted(expected - inside):
            problems.append(f"{missing} did not make it into the zip")
        for extra in sorted(inside - expected):
            problems.append(f"{extra} is in the zip but not in src/")

        for src_path, arc in files:
            if arc in inside and z.read(arc) != src_path.read_bytes():
                problems.append(f"{arc} differs from the file in src/")

        for arc in inside:
            top = arc.split("/")[0]
            if top in {"tests", "docs", "store", ".git"}:
                problems.append(f"{arc} should not be published")

    return problems


def main():
    if not SRC.is_dir():
        print(f"No src directory at {SRC}")
        return 1

    files = collect()
    if not files:
        print("Nothing to package.")
        return 1

    problems, manifest = check_before(files)
    if problems:
        print("\nNot packaging. Fix these first:")
        for p in problems:
            print(f"  - {p}")
        return 1

    version = manifest["version"]
    zip_path = REPO / f"cookie-manager-{version}.zip"

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for src_path, arc in files:
            z.write(src_path, arc)

    problems = check_after(zip_path, files)
    if problems:
        print("\nThe zip is wrong. Fix these before uploading:")
        for p in problems:
            print(f"  - {p}")
        return 1

    size_kb = zip_path.stat().st_size / 1024
    print(f"\n{zip_path.name}  ({size_kb:.0f} KB, {len(files)} files)")
    languages = sorted({arc.split("/")[1] for _, arc in files if arc.startswith("_locales/")})
    print(f"  languages: {', '.join(languages)}")
    print(f"  version: {version}")
    print("\nVerified: manifest.json is at the archive root, every file matches")
    print("src/ byte for byte, and nothing from tests/ or store/ is in it.")

    if version.startswith("0."):
        print(f"\nNote: this is version {version}. If this is the store release,")
        print("bump it in src/manifest.json first, and write the release notes.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
