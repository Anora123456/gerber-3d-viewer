#!/usr/bin/env python3
"""把 3D 封装模型压缩包铺回 footprint/3dmodels/。

压缩包结构约定（应用侧契约，见 src/footprint-categories.ts）：

    <任意包装目录>/<中文分类>.3dshapes/<模型>.step

包装目录会被自动剥离，最终落盘为 `footprint/3dmodels/<中文分类>.3dshapes/<模型>.step`。
这是应用 `import.meta.glob('/footprint/**/*.step')` 索引与两级导航所依赖的目录契约，
因此脚本不会重排文件，只做校验、剥离与原子写入。

用法：

    python scripts/extract-3dmodels-archive.py <压缩包>            # 干跑预览
    python scripts/extract-3dmodels-archive.py <压缩包> --write    # 正式解压
    python scripts/extract-3dmodels-archive.py <压缩包> --write --check-folder-map footprint/3dmodels-folder-map.csv

退出码：0 成功、1 存在被拒绝的条目、2 参数或压缩包不可用。
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import shutil
import sys
import time
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DEST = REPO_ROOT / "footprint" / "3dmodels"

# 与 server/kingdee_server.py 的 ALLOWED_MODEL_SUFFIXES 保持一致。
ALLOWED_SUFFIXES = frozenset({".step", ".stp", ".glb"})
CATEGORY_SUFFIX = ".3dshapes"
INVALID_NAME_CHARS = frozenset('<>:"/\\|?*')
JUNK_NAMES = frozenset({"thumbs.db", "desktop.ini", ".ds_store"})
JUNK_DIR_NAMES = frozenset({"__macosx"})
MAX_NAME_LENGTH = 120
PROGRESS_INTERVAL = 500


class Rejected(RuntimeError):
    """条目不符合落盘契约，应被跳过并记录原因。"""


def archive_entries(archive: Path) -> list[zipfile.ZipInfo]:
    with zipfile.ZipFile(archive) as handle:
        return [info for info in handle.infolist() if not info.is_dir()]


def normalized_name(info: zipfile.ZipInfo) -> str | None:
    """返回正斜杠分隔的相对路径；垃圾条目返回 None。"""
    name = info.filename.replace("\\", "/").strip()
    while name.startswith("./"):
        name = name[2:]
    if not name:
        return None
    parts = [part for part in name.split("/") if part not in ("", ".")]
    if not parts:
        return None
    if parts[0].lower() in JUNK_DIR_NAMES or parts[-1].lower() in JUNK_NAMES:
        return None
    if parts[-1].startswith("._") or parts[-1].startswith("~$"):
        return None
    return "/".join(parts)


def detect_wrapper_prefix(names: list[str], requested: str) -> str | None:
    """识别需要剥离的包装目录。"""
    if requested == "none":
        return None
    if requested != "auto":
        return requested
    tops = {name.split("/")[0] for name in names}
    if len(tops) != 1:
        return None
    top = tops.pop()
    # 全部条目都在该目录之下，且它本身不像分类目录，才判定为包装目录。
    if any(len(name.split("/")) == 1 for name in names):
        return None
    if top.lower().endswith(CATEGORY_SUFFIX):
        return None
    return top


def validate_segment(segment: str, label: str) -> None:
    if not segment or segment in {".", ".."}:
        raise Rejected(f"{label}名无效：{segment!r}")
    if any(character in segment for character in INVALID_NAME_CHARS):
        raise Rejected(f"{label}名包含非法字符：{segment!r}")
    if segment.endswith((" ", ".")):
        raise Rejected(f"{label}名以空格或点结尾：{segment!r}")
    if len(segment) > MAX_NAME_LENGTH:
        raise Rejected(f"{label}名过长（{len(segment)} 字符）：{segment!r}")


def split_target(relative: str) -> tuple[str, str]:
    """把剥离前缀后的相对路径拆成（分类目录, 文件名）。"""
    if relative.startswith("/") or ":" in relative.split("/")[0]:
        raise Rejected(f"绝对路径：{relative!r}")
    parts = relative.split("/")
    if any(part == ".." for part in parts):
        raise Rejected(f"路径穿越：{relative!r}")
    if len(parts) != 2:
        raise Rejected(f"层级不符（期望 <分类>.3dshapes/<模型>）：{relative!r}")
    category, filename = parts
    validate_segment(category, "分类目录")
    validate_segment(filename, "文件")
    if not category.lower().endswith(CATEGORY_SUFFIX):
        raise Rejected(f"分类目录缺少 {CATEGORY_SUFFIX} 后缀：{category!r}")
    if Path(filename).suffix.lower() not in ALLOWED_SUFFIXES:
        raise Rejected(f"不支持的文件类型：{filename!r}")
    return category, filename


def check_against_folder_map(categories: set[str], mapping_path: Path) -> dict[str, list[str]]:
    """与 3dmodels-folder-map.csv 的中文目录名交叉核对。"""
    with mapping_path.open(encoding="utf-8-sig", newline="") as stream:
        expected = {row["ChineseName"].strip() for row in csv.DictReader(stream) if row.get("ChineseName")}
    return {
        "mapping": str(mapping_path),
        "mapping_count": len(expected),
        "missing_from_archive": sorted(expected - categories),
        "not_in_mapping": sorted(categories - expected),
    }


def plan(archive: Path, dest: Path, strip: str) -> dict:
    """只读扫描压缩包，产出落盘计划。"""
    entries = archive_entries(archive)
    planned: list[tuple[str, str, zipfile.ZipInfo]] = []
    relative_names: list[str] = []
    for info in entries:
        name = normalized_name(info)
        if name is None:
            continue
        relative_names.append(name)

    prefix = detect_wrapper_prefix(relative_names, strip)
    rejected: list[dict[str, str]] = []
    for info in entries:
        name = normalized_name(info)
        if name is None:
            continue
        relative = name[len(prefix) + 1 :] if prefix and name.startswith(prefix + "/") else name
        try:
            category, filename = split_target(relative)
        except Rejected as exc:
            rejected.append({"entry": info.filename, "reason": str(exc)})
            continue
        planned.append((category, filename, info))

    seen: dict[tuple[str, str], int] = {}
    for category, filename, _ in planned:
        key = (category, filename)
        seen[key] = seen.get(key, 0) + 1
    duplicates = [
        {"category": category, "filename": filename, "count": count}
        for (category, filename), count in sorted(seen.items())
        if count > 1
    ]

    categories = sorted({category for category, _, _ in planned})
    return {
        "archive": str(archive),
        "archive_bytes": archive.stat().st_size,
        "dest": str(dest),
        "wrapper_prefix": prefix,
        "entries": len(entries),
        "planned": planned,
        "rejected": rejected,
        "duplicates": duplicates,
        "categories": categories,
        "total_bytes": sum(info.file_size for _, _, info in planned),
        "suffixes": _suffix_counts(planned),
    }


def _suffix_counts(planned: list[tuple[str, str, zipfile.ZipInfo]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for _, filename, _ in planned:
        suffix = Path(filename).suffix.lower()
        counts[suffix] = counts.get(suffix, 0) + 1
    return dict(sorted(counts.items()))


def write_models(archive: Path, dest: Path, plan_result: dict, overwrite: bool) -> dict:
    """按计划原子写入模型文件，返回写入统计。"""
    planned: list[tuple[str, str, zipfile.ZipInfo]] = plan_result["planned"]
    by_entry = {id(info): info for _, _, info in planned}
    written = 0
    overwritten = 0
    existing = 0
    failures: list[dict[str, str]] = []
    total = len(planned)
    started = time.perf_counter()

    with zipfile.ZipFile(archive) as handle:
        for index, (category, filename, info) in enumerate(planned, 1):
            target_dir = dest / category
            target = target_dir / filename
            try:
                if target.exists() and not overwrite:
                    existing += 1
                    continue
                target_dir.mkdir(parents=True, exist_ok=True)
                was_present = target.exists()
                descriptor, temporary_name = _mkstemp(target_dir, filename)
                with handle.open(info) as source, os.fdopen(descriptor, "wb") as sink:
                    shutil.copyfileobj(source, sink, 1024 * 1024)
                os.replace(temporary_name, target)
                _restore_mtime(target, info)
                written += 1
                overwritten += 1 if was_present else 0
            except (OSError, zipfile.BadZipFile, RuntimeError) as exc:
                failures.append({"entry": info.filename, "reason": f"{type(exc).__name__}: {exc}"})
            if index % PROGRESS_INTERVAL == 0 or index == total:
                elapsed = time.perf_counter() - started
                print(f"  ... {index}/{total} 个（{elapsed:.0f}s）", flush=True)

    return {
        "written": written,
        "overwritten": overwritten,
        "existing": existing,
        "failures": failures,
        "elapsed_s": round(time.perf_counter() - started, 1),
    }


def _mkstemp(directory: Path, filename: str) -> tuple[int, str]:
    import tempfile

    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{filename}.", suffix=".tmp", dir=directory)
    return descriptor, temporary_name


def _restore_mtime(target: Path, info: zipfile.ZipInfo) -> None:
    try:
        stamp = time.mktime((*info.date_time, 0, 0, -1))
    except (ValueError, OverflowError):
        return
    try:
        os.utime(target, (stamp, stamp))
    except OSError:
        pass


def verify_footprint(dest: Path, expected: dict | None = None) -> dict:
    """回读落盘结果做校验。"""
    categories: dict[str, int] = {}
    if dest.is_dir():
        for category_dir in sorted(dest.iterdir()):
            if not category_dir.is_dir():
                continue
            count = sum(
                1
                for entry in category_dir.iterdir()
                if entry.is_file() and entry.suffix.lower() in ALLOWED_SUFFIXES
            )
            categories[category_dir.name] = count
    files = sum(categories.values())
    total_bytes = sum(
        entry.stat().st_size
        for category_dir in dest.iterdir() if category_dir.is_dir()
        for entry in category_dir.iterdir()
        if entry.is_file() and entry.suffix.lower() in ALLOWED_SUFFIXES
    ) if dest.is_dir() else 0
    result = {
        "dest": str(dest),
        "category_count": len(categories),
        "file_count": files,
        "total_bytes": total_bytes,
        "categories": categories,
    }
    if expected:
        result["matches_plan"] = (
            len(categories) == len(expected["categories"]) and files == len(expected["planned"])
        )
    return result


def print_plan(result: dict, list_categories: bool, folder_map: dict | None) -> None:
    print(f"压缩包      : {result['archive']}  ({result['archive_bytes'] / 1024 / 1024:.1f} MB)")
    print(f"目标目录    : {result['dest']}")
    print(f"包装目录    : {result['wrapper_prefix'] or '（无）'}")
    print(f"压缩包条目  : {result['entries']}")
    print(f"待写入      : {len(result['planned'])} 个文件 / {result['total_bytes'] / 1024 / 1024:.1f} MB")
    print(f"分类目录    : {len(result['categories'])}")
    print(f"文件类型    : {result['suffixes']}")
    print(f"被拒绝条目  : {len(result['rejected'])}")
    for item in result["rejected"][:20]:
        print(f"  - {item['entry']} → {item['reason']}")
    print(f"重复目标    : {len(result['duplicates'])}")
    for item in result["duplicates"][:20]:
        print(f"  - {item['category']}/{item['filename']} ×{item['count']}")
    if list_categories:
        print("分类清单    :")
        for category in result["categories"]:
            print(f"  - {category}")
    else:
        print(f"分类清单    : {result['categories'][:6]} …（共 {len(result['categories'])} 个，加 --list-categories 看全部）")
    if folder_map:
        print(f"映射表核对  : {folder_map['mapping']}（{folder_map['mapping_count']} 条）")
        print(f"  压缩包缺少 : {folder_map['missing_from_archive'] or '无'}")
        print(f"  映射表未登记: {folder_map['not_in_mapping'] or '无'}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="把 3D 封装模型压缩包铺回 footprint/3dmodels/",
    )
    parser.add_argument("archive", type=Path, help="压缩包路径（zip）")
    parser.add_argument("--dest", type=Path, default=DEFAULT_DEST, help=f"目标目录，默认 {DEFAULT_DEST}")
    parser.add_argument("--write", action="store_true", help="正式解压；缺省为只读干跑")
    parser.add_argument("--overwrite", action="store_true", help="覆盖已存在的同名模型")
    parser.add_argument(
        "--strip-prefix",
        default="auto",
        help="包装目录名（auto 自动识别 / none 不剥离 / <名称> 指定）",
    )
    parser.add_argument("--check-folder-map", type=Path, help="与中文目录名映射表交叉核对")
    parser.add_argument("--list-categories", action="store_true", help="列出全部分类目录名")
    parser.add_argument("--report", type=Path, help="把 JSON 报告写入该路径")
    args = parser.parse_args()

    archive = args.archive.expanduser().resolve()
    if not archive.is_file():
        print(f"压缩包不存在：{archive}", file=sys.stderr)
        return 2
    dest = args.dest.expanduser()
    if not dest.is_absolute():
        dest = (REPO_ROOT / dest).resolve()

    try:
        result = plan(archive, dest, args.strip_prefix)
    except zipfile.BadZipFile as exc:
        print(f"压缩包无法解析：{exc}", file=sys.stderr)
        return 2

    folder_map = None
    if args.check_folder_map:
        mapping_path = args.check_folder_map if args.check_folder_map.is_absolute() else REPO_ROOT / args.check_folder_map
        if not mapping_path.is_file():
            print(f"映射表不存在：{mapping_path}", file=sys.stderr)
            return 2
        folder_map = check_against_folder_map(set(result["categories"]), mapping_path)

    print_plan(result, args.list_categories, folder_map)

    report: dict = {
        "archive": result["archive"],
        "dest": result["dest"],
        "wrapper_prefix": result["wrapper_prefix"],
        "planned_files": len(result["planned"]),
        "planned_bytes": result["total_bytes"],
        "category_count": len(result["categories"]),
        "suffixes": result["suffixes"],
        "rejected": result["rejected"],
        "duplicates": result["duplicates"],
        "folder_map": folder_map,
        "written": False,
    }

    if not args.write:
        print("\n干跑完成，未写入任何文件。加 --write 执行解压。")
        report["verify"] = None
    else:
        print(f"\n开始写入 {dest} …")
        write_result = write_models(archive, dest, result, args.overwrite)
        print(
            f"写入完成：新增 {write_result['written']} 个（其中覆盖 {write_result['overwritten']} 个），"
            f"跳过已存在 {write_result['existing']} 个，失败 {len(write_result['failures'])} 个，"
            f"耗时 {write_result['elapsed_s']}s"
        )
        for failure in write_result["failures"][:20]:
            print(f"  - {failure['entry']} → {failure['reason']}")
        verification = verify_footprint(dest, result)
        print(
            f"落盘校验：{verification['category_count']} 个分类 / {verification['file_count']} 个模型 / "
            f"{verification['total_bytes'] / 1024 / 1024:.1f} MB，与计划一致={verification.get('matches_plan')}"
        )
        report["write"] = write_result
        report["verify"] = verification
        report["written"] = True

    if args.report:
        report_path = args.report if args.report.is_absolute() else REPO_ROOT / args.report
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"报告已写入：{report_path}")

    return 1 if result["rejected"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
