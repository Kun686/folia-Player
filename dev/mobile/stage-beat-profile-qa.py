import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

# stage-beat-profile-qa.py — verified original references and fixed model in the independent simulator sandbox only.
ROOT = Path(__file__).resolve().parents[2]
BUNDLE = "app.folia.validation.App"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    if len(sys.argv) != 4:
        raise SystemExit("usage: stage-beat-profile-qa.py simulator-uuid reference-directory NEW-report.json")
    reference, record_path = Path(sys.argv[2]), Path(sys.argv[3])
    if record_path.exists():
        raise SystemExit("refusing to replace earlier evidence")
    report = json.loads((reference / "report.json").read_text())
    for path, expected in report["sources"].items():
        if digest(ROOT / path) != expected:
            raise ValueError("reference source changed: " + path)
    model = ROOT / ".mobile-test-results/automix-probe/assets/beat_this.onnx"
    pinned = next(m for m in json.loads((ROOT / "shared/modelManifest.json").read_text())["models"] if m["name"] == "beat_this")
    if digest(model) != pinned["sha256"] or report["modelSHA256"] != pinned["sha256"]:
        raise ValueError("model identity mismatch")
    if any(Path(name).name != name or name in (".", "..") for name in report["files"]):
        raise ValueError("fixture names must be plain filenames")
    files = {name: reference / name for name in report["files"]}
    for name, path in files.items():
        if digest(path) != report["files"][name]["sha256"] or path.stat().st_size != report["files"][name]["bytes"]:
            raise ValueError("reference fixture changed: " + name)
    files.update({"report.json": reference / "report.json", "beat_this.onnx": model})
    container = subprocess.run(["xcrun", "simctl", "get_app_container", sys.argv[1], BUNDLE, "data"],
                               capture_output=True, text=True, check=True, timeout=20).stdout.strip()
    destination = Path(container) / "Documents/BeatQA"
    destination.mkdir(parents=True, exist_ok=True)
    records = {}
    for name, source in files.items():
        target = destination / name
        shutil.copyfile(source, target)
        expected = digest(source)
        if digest(target) != expected:
            raise ValueError("staged fixture mismatch: " + name)
        records[name] = {"bytes": source.stat().st_size, "sha256": expected}
    with record_path.open("x") as output:
        json.dump({"bundleId": BUNDLE, "simulator": sys.argv[1], "files": records}, output, indent=2)
        output.write("\n")
    print(json.dumps({"bundleId": BUNDLE, "verifiedFiles": len(files)}))


if __name__ == "__main__":
    main()
