"""Convert the curated STEP footprint library to browser-ready GLB files.

Run this script through FreeCADCmd. FreeCAD's glTF exporter uses meters and a
Y-up coordinate system; the viewer converts those values back to millimetres
and Z-up when it instantiates a model.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

import FreeCAD as App
import Import


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--root",
        default=os.environ.get("GERBER3D_PROJECT_ROOT"),
        help="Project root containing footprint/",
    )
    parser.add_argument(
        "--tolerance",
        type=float,
        default=float(os.environ.get("GERBER3D_TOLERANCE", "0.03")),
        help="Tessellation tolerance in mm",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        default=os.environ.get("GERBER3D_FORCE") == "1",
        help="Rebuild GLB files even when current",
    )
    args, _freecad_arguments = parser.parse_known_args()
    if not args.root:
        parser.error("--root or GERBER3D_PROJECT_ROOT is required")
    return args


def convert_model(source: Path, target: Path, tolerance: float) -> None:
    document = App.newDocument("FootprintConversion")
    temporary = target.with_suffix(".tmp.glb")
    try:
        Import.insert(str(source), document.Name)
        document.recompute()
        exportable = []
        for obj in document.Objects:
            shape = getattr(obj, "Shape", None)
            if shape is None or shape.isNull():
                continue
            shape.tessellate(tolerance)
            exportable.append(obj)

        if not exportable:
            raise RuntimeError("STEP contains no exportable shape")

        target.parent.mkdir(parents=True, exist_ok=True)
        if temporary.exists():
            temporary.unlink()
        Import.export(exportable, str(temporary))
        if not temporary.exists() or temporary.stat().st_size < 512:
            raise RuntimeError("FreeCAD produced an empty GLB")
        os.replace(temporary, target)
    finally:
        if temporary.exists():
            temporary.unlink()
        App.closeDocument(document.Name)


def main() -> int:
    args = parse_args()
    root = Path(args.root).resolve()
    footprint_root = root / "footprint"
    manifest_path = footprint_root / "library-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    entries = [
        entry for entry in manifest.get("entries", [])
        if entry.get("status") == "copied" and entry.get("file")
    ]

    converted = 0
    skipped = 0
    failed: list[tuple[str, str]] = []
    for index, entry in enumerate(entries, start=1):
        source = footprint_root / entry["file"]
        target = source.with_suffix(".glb")
        label = entry.get("alias", source.stem)
        if not source.exists():
            failed.append((label, "STEP file is missing"))
            print(f"[{index}/{len(entries)}] missing: {source}")
            continue
        if (
            not args.force
            and target.exists()
            and target.stat().st_size >= 512
            and target.stat().st_mtime >= source.stat().st_mtime
        ):
            skipped += 1
            print(f"[{index}/{len(entries)}] current: {label}")
            continue

        try:
            convert_model(source, target, args.tolerance)
            converted += 1
            print(f"[{index}/{len(entries)}] converted: {label} -> {target.name}")
        except Exception as error:  # FreeCAD exposes several nonstandard exceptions.
            failed.append((label, str(error)))
            print(f"[{index}/{len(entries)}] failed: {label}: {error}", file=sys.stderr)

    print(
        json.dumps(
            {
                "models": len(entries),
                "converted": converted,
                "current": skipped,
                "failed": len(failed),
            },
            ensure_ascii=False,
        )
    )
    for label, message in failed:
        print(f"FAILED {label}: {message}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
