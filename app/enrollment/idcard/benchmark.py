#!/usr/bin/env python3
"""
Benchmark HIS ID-card endpoint, then benchmark ID card image generation
using payloads pulled from the HIS benchmark.

For Playwright benchmark: include_children=True (Chromium runs as child
processes, so we need to count them too).
"""

import csv
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from time import perf_counter
from typing import List

import psutil

from app.enrollment.his_client import HISClient
from app.enrollment.idcard.generator import IdCardGenerator

client = None


def _refresh_tracked_processes(
    root: psutil.Process, tracked: dict, include_children: bool
):
    """Keeps `tracked` (pid -> psutil.Process) up to date across samples.

    Critically, this REUSES existing Process objects rather than creating
    new ones every call -- psutil.Process.cpu_percent() measures the delta
    since its *own* last call, so a freshly constructed Process object
    always reports 0.0 on its first read. Recreating child Process objects
    every sample (via process.children(...) each time) means their CPU
    usage is silently always 0.0 -- this was happening before.
    """
    if root.pid not in tracked:
        tracked[root.pid] = root

    if not include_children:
        return

    try:
        current_children = root.children(recursive=True)
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        current_children = []

    current_pids = {p.pid for p in current_children}

    # Add newly seen children and prime their cpu_percent baseline. Their
    # CPU usage will read 0.0 for this one sample, then be accurate from
    # the next sample onward -- a one-sample lag is fine at 0.1s intervals.
    for p in current_children:
        if p.pid not in tracked:
            try:
                p.cpu_percent()
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
            tracked[p.pid] = p

    # Drop processes that have exited so `tracked` doesn't grow unbounded
    # over a long benchmark with many short-lived renderer processes.
    for pid in list(tracked.keys()):
        if pid != root.pid and pid not in current_pids:
            del tracked[pid]


def collect_stats(tracked: dict):
    rss = 0
    uss = 0
    cpu = 0
    threads = 0

    for p in list(tracked.values()):
        try:
            mem = p.memory_full_info()
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

        rss += mem.rss
        uss += getattr(mem, "uss", 0)

        try:
            cpu += p.cpu_percent()
            threads += p.num_threads()
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass

    return {
        "rss": rss / (1024 * 1024),
        "uss": uss / (1024 * 1024),
        "cpu": cpu,
        "threads": threads,
    }


@contextmanager
def top(interval=0.1, include_children=False):
    """Samples resource usage on a background thread while the wrapped
    code runs. Yields a dict that gets filled in once the block exits --
    use `with top() as stats:` and read `stats` after the block."""

    process = psutil.Process()
    process.cpu_percent()  # prime it, first call always returns 0.0

    tracked = {}
    _refresh_tracked_processes(process, tracked, include_children)

    samples = []
    stop = threading.Event()

    def sampler():
        while not stop.is_set():
            _refresh_tracked_processes(process, tracked, include_children)
            samples.append(collect_stats(tracked))
            time.sleep(interval)

    thread = threading.Thread(target=sampler, daemon=True)
    thread.start()

    stats = {}
    start = perf_counter()

    try:
        yield stats
    finally:
        stats["elapsed"] = perf_counter() - start
        stop.set()
        thread.join()

        stats["peak_rss"] = max((s["rss"] for s in samples), default=0.0)
        stats["peak_uss"] = max((s["uss"] for s in samples), default=0.0)
        stats["peak_cpu"] = max((s["cpu"] for s in samples), default=0.0)
        stats["avg_cpu"] = (
            sum(s["cpu"] for s in samples) / len(samples) if samples else 0.0
        )
        stats["peak_threads"] = max((s["threads"] for s in samples), default=0)


def get_enrollee_info(enrollee_numbers: List[str], workers: int):
    with ThreadPoolExecutor(max_workers=workers) as executor:
        results = list(executor.map(client.fetch_id_details_from_his, enrollee_numbers))

    success = []
    failed = []

    for r in results:
        if r.success:
            success.append(r.payload)
        else:
            failed.append(str(r.msg or "Unknown API Error"))

    return {"success": success, "failed": failed}


def append_csv(csv_path: str, header: List[str], row: List):
    exists = os.path.exists(csv_path)
    with open(csv_path, "a", newline="") as f:
        writer = csv.writer(f)
        if not exists:
            writer.writerow(header)
        writer.writerow(row)


def benchmark(ids: List[str], workers: int, csv_path: str):
    print(f"\n========== HIS: {workers} Workers ==========")

    with top(include_children=False) as stats:
        result = get_enrollee_info(ids, workers)

    success = len(result["success"])
    failed = len(result["failed"])

    # Note: this is throughput expressed as ms/request (elapsed / success),
    # not each request's real response time -- fine for comparing worker
    # counts against each other, just don't read it as "the server answers
    # in Xms".
    rps = success / stats["elapsed"] if stats["elapsed"] > 0 else 0.0
    latency = (stats["elapsed"] * 1000 / success) if success else 0.0

    print(f"Elapsed        : {stats['elapsed']:.3f}s")
    print(f"Success        : {success}")
    print(f"Failed         : {failed}")
    print(f"Requests/sec   : {rps:.2f}")
    print(f"Latency        : {latency:.2f} ms/request")
    print(f"Peak CPU       : {stats['peak_cpu']:.1f}%")
    print(f"Average CPU    : {stats['avg_cpu']:.1f}%")
    print(f"Peak RSS       : {stats['peak_rss']:.1f} MB")
    print(f"Peak USS       : {stats['peak_uss']:.1f} MB")
    print(f"Peak Threads   : {stats['peak_threads']}")

    if failed:
        print("\nUnique Errors:")
        for err in sorted(set(result["failed"])):
            print(" -", err)

    append_csv(
        csv_path,
        [
            "workers",
            "elapsed_s",
            "requests_per_sec",
            "avg_latency_ms",
            "peak_cpu",
            "avg_cpu",
            "peak_rss_mb",
            "peak_uss_mb",
            "peak_threads",
            "success",
            "failed",
        ],
        [
            workers,
            round(stats["elapsed"], 3),
            round(rps, 2),
            round(latency, 2),
            round(stats["peak_cpu"], 1),
            round(stats["avg_cpu"], 1),
            round(stats["peak_rss"], 1),
            round(stats["peak_uss"], 1),
            stats["peak_threads"],
            success,
            failed,
        ],
    )

    return result["success"]


def benchmark_id_generator(enrollee_payloads, semaphore_count: int, csv_path: str):
    print(
        f"\n========== ID Card: {semaphore_count} concurrent pages, "
        f"{len(enrollee_payloads)} cards =========="
    )

    generator = IdCardGenerator(semaphore_count)

    failed = 0
    with top(include_children=True) as stats:
        try:
            generator.create_id_card_sync(enrollee_payloads)
        except RuntimeError as e:
            # create_id_card_sync raises RuntimeError listing all failed
            # cards rather than crashing -- catch it here so one bad batch
            # doesn't kill the rest of the benchmark loop.
            failed = str(e)
            print(f"  (some cards failed: {e})")

    print(f"Elapsed        : {stats['elapsed']:.1f}s")
    print(f"Peak CPU       : {stats['peak_cpu']:.1f}%")
    print(f"Average CPU    : {stats['avg_cpu']:.1f}%")
    print(f"Peak RSS       : {stats['peak_rss']:.1f} MB")
    print(f"Peak USS       : {stats['peak_uss']:.1f} MB")
    print(f"Peak Threads   : {stats['peak_threads']}")

    append_csv(
        csv_path,
        [
            "semaphore_count",
            "num_cards",
            "elapsed_s",
            "peak_cpu",
            "avg_cpu",
            "peak_rss_mb",
            "peak_uss_mb",
            "peak_threads",
            "failed",
        ],
        [
            semaphore_count,
            len(enrollee_payloads),
            round(stats["elapsed"], 3),
            round(stats["peak_cpu"], 1),
            round(stats["avg_cpu"], 1),
            round(stats["peak_rss"], 1),
            round(stats["peak_uss"], 1),
            stats["peak_threads"],
            failed,
        ],
    )


def main():
    global client
    client = HISClient()

    base_dir = os.path.dirname(os.path.abspath(__file__))
    txt_path = os.path.join(base_dir, "id_no.txt")
    his_csv = os.path.join(base_dir, "benchmark.csv")
    idcard_csv = os.path.join(base_dir, "idcard_benchmark.csv")
    out_dir = os.path.join(base_dir, "id_card_output")
    os.makedirs(out_dir, exist_ok=True)

    with open(txt_path) as f:
        ids = [line.strip() for line in f if line.strip()]

    print("Warm-up...")
    get_enrollee_info(ids[:5], 5)
    print("Done.\n")

    enrollee_payload = []
    enrollee_payload = benchmark(ids, 40, his_csv)

    # Keep this conservative -- Playwright renders are CPU/memory heavy
    # per page, nothing like the cheap HTTP calls above. Start low.
    for semaphore_count in [3, 6, 9, 12]:
        data = [
            (os.path.join(out_dir, f"out_{semaphore_count}_{i}.png"), payload)
            for i, payload in enumerate(enrollee_payload)
        ]
        benchmark_id_generator(data, semaphore_count, idcard_csv)


if __name__ == "__main__":
    main()
