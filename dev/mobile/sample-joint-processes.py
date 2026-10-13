import json
import os
from pathlib import Path
import plistlib
import signal
import subprocess
import sys
import time

# sample-joint-processes.py — bounded simulator-only XCTest plus system footprint snapshots of its exact WebKit processes.
PREFIX = "FOLIA_JOINT_PROCESS "
DONE = "FOLIA_JOINT_PROCESS_DONE"
BUNDLE = "app.folia.validation.App"


def identify(marker, simulator):
    result = {}
    for role in ("host", "web", "gpu"):
        pid = marker[role]
        if type(pid) is not int or pid <= 0:
            raise ValueError("invalid process identity")
        path = subprocess.check_output(["ps", "-p", str(pid), "-o", "comm="], text=True, timeout=5).strip()
        if role == "host":
            if f"/{simulator}/data/Containers/Bundle/Application/" not in path:
                raise ValueError("host is outside the requested simulator")
            bundle = Path(path).parent
            with (bundle / "Info.plist").open("rb") as source:
                if plistlib.load(source).get("CFBundleIdentifier") != BUNDLE:
                    raise ValueError("host is not the independent QA App")
        elif not path.endswith("/com.apple.WebKit." + ("WebContent" if role == "web" else "GPU")):
            raise ValueError("unexpected WebKit process executable")
        result[role] = {"pid": pid, "executable": path}
    if len({value["pid"] for value in result.values()}) != 3:
        raise ValueError("process identities must be distinct")
    return result


def main():
    if len(sys.argv) != 4:
        raise SystemExit("usage: sample-joint-processes.py command.json simulator-uuid NEW-output-directory")
    command = json.loads(Path(sys.argv[1]).read_text())
    simulator, directory = sys.argv[2], Path(sys.argv[3])
    if command[:2] != ["xcodebuild", "test-without-building"] or (
        "platform=iOS Simulator,id=" + simulator not in command
    ):
        raise ValueError("only an explicit simulator test command is accepted")
    directory.mkdir(parents=True, exist_ok=False)
    log = directory / "test.log"
    started = time.monotonic()
    markers, samples, identities = [], [], {}
    marker, last_sample, log_offset = None, started, 0
    last_output, size, shown = started, 0, started
    failure, sampling_done = None, False
    # Read complete log lines only. The completion marker may arrive during the last footprint invocation.
    def read_updates(now):
        nonlocal log_offset, marker, sampling_done
        with log.open() as reader:
            reader.seek(log_offset)
            while True:
                line = reader.readline()
                if not line.endswith("\n"):
                    break
                log_offset = reader.tell()
                if line.strip() == DONE:
                    sampling_done = True
                elif PREFIX in line:
                    marker = json.loads(line.split(PREFIX, 1)[1])
                    marker["observedElapsed"] = now - started
                    markers.append(marker)
                    key = tuple(marker[role] for role in ("host", "web", "gpu"))
                    if key not in identities:
                        identities[key] = identify(marker, simulator)
    def interrupted(_signal, _frame):
        raise KeyboardInterrupt("process sampler interrupted")
    signal.signal(signal.SIGTERM, interrupted)
    with log.open("w") as output:
        child = subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        print(f"PID={child.pid} log={log}", flush=True)
        try:
            while child.poll() is None:
                time.sleep(0.25)
                now = time.monotonic()
                current_size = log.stat().st_size
                if current_size != size:
                    size, last_output = current_size, now
                    read_updates(now)
                if now - last_output > 60 or now - started > 540:
                    raise TimeoutError("test produced no output for 60s or exceeded 540s")
                if marker and not sampling_done and now - last_sample >= 1:
                    key = tuple(marker[role] for role in ("host", "web", "gpu"))
                    phase = marker["phase"]
                    target = directory / f"footprint-{len(samples):04d}.json"
                    arguments = ["/usr/bin/footprint", "--noCategories", "-j", str(target)]
                    for pid in key:
                        arguments.extend(["-p", str(pid)])
                    before = time.monotonic()
                    captured = subprocess.run(arguments, capture_output=True, text=True, timeout=10)
                    read_updates(time.monotonic())
                    if captured.returncode != 0:
                        if sampling_done:
                            continue
                        raise RuntimeError("footprint failed: " + captured.stderr[-500:])
                    data = json.loads(target.read_text())
                    actual = {item["pid"] for item in data.get("processes", [])}
                    if data.get("errors") or actual != set(key) or data.get("unit") != "byte":
                        if sampling_done:
                            continue
                        raise RuntimeError("footprint did not measure the exact three live processes")
                    samples.append({"phase": phase, "elapsed": before - started,
                        "captureSeconds": time.monotonic() - before, "file": target.name,
                        "processes": identities[key]})
                    last_sample = time.monotonic()
                if now - shown >= 5:
                    tail = log.read_text(errors="replace").splitlines()[-1:]
                    print(f"elapsed={now-started:.0f}s samples={len(samples)} phase={marker['phase'] if marker else 'startup'} "
                          + " | ".join(tail)[:250], flush=True)
                    shown = now
            code = child.wait(timeout=8)
            read_updates(time.monotonic())
        except BaseException as error:
            failure = str(error)
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait(timeout=5)
            code = child.returncode
        finally:
            (directory / "samples.json").write_text(json.dumps({"simulator": simulator, "bundleId": BUNDLE,
                "runnerPID": os.getpid(), "testPID": child.pid, "testExitCode": child.returncode,
                "failure": failure, "samplingDone": sampling_done, "markers": markers, "samples": samples}, indent=2) + "\n")
    expected = {f"joint-consecutive-{index}-{phase}" for index in range(3)
                for phase in ("baseline", "models", "handover", "recovery")}
    expected.update(f"round-{index}-cleanup" for index in range(3))
    measured = {sample["phase"] for sample in samples}
    if failure or code != 0 or not sampling_done or not expected.issubset(measured):
        raise SystemExit(f"Incomplete measurement: exit={code}; error={failure}; done={sampling_done}; missing={sorted(expected - measured)}")
    print(f"PASS samples={len(samples)} phases={len(measured)} elapsed={time.monotonic()-started:.1f}s", flush=True)


if __name__ == "__main__":
    main()
