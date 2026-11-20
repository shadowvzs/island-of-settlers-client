"""Verify the reviewed 144-file cleanup batch; deletion requires explicit --execute."""
import argparse
import datetime
import hashlib
import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[3]
REVIEW = ROOT / "resources/project-reviews/acceptance-2026-10-28/resource-cleanup"
MANIFEST = REVIEW / "followup-candidate-manifest.json"
HASHES = pathlib.Path("/tmp/shared-storage-cleanup-candidate-hashes.json")


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def checked_path(relative):
    path = ROOT / relative
    if not relative.startswith("resources/") or path.resolve() != path or path.is_symlink():
        raise ValueError("Unsafe or symlinked candidate: " + relative)
    return path


def preflight():
    manifest = json.loads(MANIFEST.read_text())
    supplied = json.loads(HASHES.read_text())
    hashes = dict(supplied)
    if len(hashes) != len(supplied) or len(hashes) != 144:
        raise ValueError("Expected 144 unique independently reviewed file hashes")
    if manifest["totals"] != {"directories": 13, "files": 144, "bytes": 91064305}:
        raise ValueError("Reviewed candidate batch changed")
    files, directories, references = [], [], []
    for group in manifest["candidateDirectories"]:
        directory = checked_path(group["directory"])
        if not directory.is_dir() or not directory.name.startswith("wip"):
            raise ValueError("Only the reviewed generated WIP directories are allowed")
        if any(path.is_symlink() for path in directory.rglob("*")):
            raise ValueError("Symlink added to candidate directory: " + group["directory"])
        expected = {row["path"] for row in group["files"]}
        actual = {str(path.relative_to(ROOT)) for path in directory.rglob("*") if path.is_file()}
        if actual != expected:
            raise ValueError("Candidate inventory changed: " + group["directory"])
        for replacement in group["retainedReplacements"]:
            if not (ROOT / replacement).exists():
                raise ValueError("Missing retained replacement: " + replacement)
        for row in group["files"]:
            path = checked_path(row["path"])
            if directory not in path.parents or path.suffix not in (".png", ".json", ".txt"):
                raise ValueError("Unexpected source/model or candidate path: " + row["path"])
            if path.stat().st_size != row["bytes"] or digest(path) != hashes.get(row["path"]):
                raise ValueError("Candidate content changed: " + row["path"])
            files.append({**row, "sha256": hashes[row["path"]]})
        # Exact full and relative directory paths, plus each individual candidate filename path.
        patterns = [group["directory"], group["directory"].removeprefix("resources/")]
        if group["directory"].startswith("resources/settlement-previews/"):
            patterns.append(group["directory"].removeprefix("resources/settlement-previews/"))
        patterns.extend(expected)
        roots = [name for name in (
    "docs", "island-of-settlers-client/src", "island-of-settlers-client/tests",
    "island-of-settlers-client/tests-ui", "island-of-settlers-client/tools",
    "island-of-settlers-worker-generation/src", "island-of-settlers-api/src",
    "island-of-settlers-local-dev", "island-of-settlers-shared"
) if (ROOT / name).exists()]
        command = ["rg", "-n", "-F"]
        for pattern in patterns:
            command.extend(["-e", pattern])
        result = subprocess.run(command + roots, cwd=ROOT, capture_output=True, text=True)
        if result.returncode not in (0, 1):
            raise RuntimeError(result.stderr)
        if result.stdout:
            references.extend(result.stdout.splitlines())
        directories.append(group["directory"])
    if references:
        raise ValueError("New source/test/document references found:\n" + "\n".join(references))
    if set(hashes) != {row["path"] for row in files}:
        raise ValueError("Hash-list and manifest inventories differ")
    return manifest, directories, files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true", help="Delete only after root's shared-storage gate release")
    args = parser.parse_args()
    manifest, directories, files = preflight()
    receipt = {
        "version": 1, "atUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "status": "PREPARED_VERIFIED_NO_DELETION", "totals": manifest["totals"],
        "manifest": str(MANIFEST.relative_to(ROOT)), "hashes": str(HASHES),
        "referenceAudit": "No exact candidate directory/file paths in current docs/runtime/tests/tools/backend",
        "replacementAudit": "Every reviewed retained replacement still exists",
        "scope": "13 reviewed generated WIP directories only; sources/licenses/user fixtures/baselines preserved",
        "files": files, "deleted": []
    }
    output = REVIEW / "followup-preflight.json"
    if args.execute:
        output = REVIEW / "followup-deletion-manifest.json"
        try:
            # Every path/reference/hash has been checked before the first destructive operation.
            for row in files:
                path = checked_path(row["path"])
                if path.stat().st_size != row["bytes"] or digest(path) != row["sha256"]:
                    raise ValueError("Candidate changed after preflight: " + row["path"])
                path.unlink()
                receipt["deleted"].append(row["path"])
            for relative in directories:
                directory = checked_path(relative)
                for child in sorted((path for path in directory.rglob("*") if path.is_dir()),
                                    key=lambda path: len(path.parts), reverse=True):
                    child.rmdir()
                directory.rmdir()
            receipt["status"] = "DELETED"
        except Exception as error:
            receipt["status"] = "PARTIAL_FAILURE"
            receipt["error"] = str(error)
            output.write_text(json.dumps(receipt, indent=2) + "\n")
            raise
    output.write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps({"status": receipt["status"], "totals": receipt["totals"],
                      "receipt": str(output.relative_to(ROOT))}))


if __name__ == "__main__":
    main()
