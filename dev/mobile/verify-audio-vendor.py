import argparse
import difflib
import hashlib
import json
import pathlib
import subprocess

# Verify the approved decoder snapshot and its complete local patch without network access.
parser = argparse.ArgumentParser()
parser.add_argument("--upstream-root", type=pathlib.Path)
args = parser.parse_args()
repo = pathlib.Path(__file__).resolve().parents[2]
root = repo / "ios/Vendor/AudioStreaming"
manifest = json.loads((repo / "docs/mobile/AUDIO_STREAMING_VENDOR.json").read_text())
assert manifest["version"] == "1.4.5"
assert manifest["revision"] == "e28a74b7b8632fc14312b7a79dcd82fa302779af"
actual = {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file() and ".build" not in p.parts}
expected = set(manifest["files"])
assert actual == expected, f"Vendored source inventory differs: missing={sorted(expected - actual)}, extra={sorted(actual - expected)}"
if (repo / ".git").exists():
    tracked = subprocess.check_output(["git", "ls-files", "-z", "--", root.relative_to(repo).as_posix()], cwd=repo, timeout=10).decode().split("\0")
    names = {pathlib.PurePosixPath(p).relative_to(root.relative_to(repo)).as_posix() for p in tracked if p}
    assert names == expected, f"Git snapshot differs: missing={sorted(expected - names)}, extra={sorted(names - expected)}"
patch = []
changed = []
for name, hashes in sorted(manifest["files"].items()):
    relative = pathlib.PurePosixPath(name)
    assert not relative.is_absolute() and ".." not in relative.parts
    data = (root / name).read_bytes()
    assert hashlib.sha256(data).hexdigest() == hashes["vendoredSHA256"], f"Modified vendor file: {name}"
    if hashes["upstreamSHA256"] != hashes["vendoredSHA256"]:
        changed.append(name)
    if args.upstream_root:
        upstream = (args.upstream_root / name).read_bytes()
        assert hashlib.sha256(upstream).hexdigest() == hashes["upstreamSHA256"], f"Wrong upstream file: {name}"
        if upstream != data:
            patch.extend(difflib.unified_diff(upstream.decode().splitlines(keepends=True), data.decode().splitlines(keepends=True),
                                            fromfile="a/" + name, tofile="b/" + name))
assert changed == ["AudioStreaming/Streaming/Audio Entry/Models/SeekRequest.swift",
                   "AudioStreaming/Streaming/Audio Source/FileAudioSource.swift",
                   "AudioStreaming/Streaming/AudioPlayer/AudioPlayer.swift",
                   "AudioStreaming/Streaming/AudioPlayer/Processors/AudioFileStreamProcessor.swift", "Package.swift"]
if args.upstream_root:
    assert "".join(patch) == (repo / "docs/mobile/AUDIO_STREAMING_VENDOR.patch").read_text(), "Patch differs from vendored changes"
print(f"AudioStreaming {manifest['version']} {manifest['revision'][:12]}: {len(actual)} files verified, {len(changed)} patched")
