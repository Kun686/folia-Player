import argparse
import hashlib
import json
import os
import pathlib
import stat
import tempfile
import zipfile

# prepare-ort.py — offline installation/verification of the approved, unmodified Apple ORT archive.
root = pathlib.Path(__file__).resolve().parents[2]
manifest = json.loads((root / "docs/mobile/ONNX_RUNTIME_VENDOR.json").read_text())
target = root / "ios/Vendor/ONNXRuntime"


def inventory(folder):
    result = {}
    for path in sorted(folder.rglob("*")):
        name = path.relative_to(folder).as_posix()
        if path.is_symlink():
            result[name] = {"link": os.readlink(path)}
        elif path.is_file():
            result[name] = {"sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    return result


def verify(folder):
    if inventory(folder) != manifest["files"]:
        raise ValueError("ORT vendor tree differs from the approved archive; reinstall from the pinned ZIP")


parser = argparse.ArgumentParser()
parser.add_argument("--archive", type=pathlib.Path, help="Install from a previously downloaded pinned ZIP")
args = parser.parse_args()
if args.archive:
    if hashlib.sha256(args.archive.read_bytes()).hexdigest() != manifest["sha256"]:
        raise ValueError("ORT archive hash mismatch")
    if target.exists():
        verify(target)  # Never overwrite an unexpected existing directory.
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=".ort-", dir=target.parent) as temp:
            stage = pathlib.Path(temp) / "runtime"
            stage.mkdir()
            with zipfile.ZipFile(args.archive) as archive:
                for entry in archive.infolist():
                    path = stage / entry.filename
                    if not path.resolve().is_relative_to(stage.resolve()):
                        raise ValueError("Unsafe archive entry")
                    if entry.is_dir():
                        path.mkdir(parents=True, exist_ok=True)
                    else:
                        path.parent.mkdir(parents=True, exist_ok=True)
                        data = archive.read(entry)
                        if stat.S_ISLNK(entry.external_attr >> 16):
                            link = data.decode()
                            if not (path.parent / link).resolve().is_relative_to(stage.resolve()):
                                raise ValueError("Unsafe archive link")
                            path.symlink_to(link)
                        else:
                            path.write_bytes(data)
            verify(stage)
            stage.rename(target)
verify(target)
notices = root / "ios/App/App/ORTNotices"
if hashlib.sha256((notices / "LICENSE.txt").read_bytes()).hexdigest() != manifest["files"]["LICENSE"]["sha256"]:
    raise ValueError("ORT license differs from the pinned archive")
if hashlib.sha256((notices / "ThirdPartyNotices.txt").read_bytes()).hexdigest() != manifest["notices"]["sha256"]:
    raise ValueError("ORT third party notices differ from the versioned upstream source")
print(f"ONNX Runtime {manifest['version']}: {len(manifest['files'])} pinned files/links verified")
