#!/usr/bin/env python3
"""
Light Module Job Poller
- Polls backend for jobs to start/stop the rear light service
- Expected job types: start_light_module / stop_light_module
- Expects a systemd service called "bike-light"
"""

import time
import requests
import signal
import sys
import os
import subprocess
from datetime import datetime
from pathlib import Path

# Configuration
API_URL = "https://bike-api.dyntech.workers.dev"
PI_ID = "lightpi"
POLL_INTERVAL = 5  # seconds
STOP_FILE = "/tmp/stop_light_pi"
SERVICE_NAME = "bike-light"

running = True


def signal_handler(signum, frame):
    global running
    print(f"\n[{datetime.now()}] Signal {signum} received. Shutting down gracefully...")
    running = False


def check_stop_file():
    return os.path.exists(STOP_FILE)


def remove_stop_file():
    if os.path.exists(STOP_FILE):
        try:
            os.remove(STOP_FILE)
            print(f"[{datetime.now()}] Removed stop file: {STOP_FILE}")
        except Exception as e:
            print(f"[{datetime.now()}] Warning: Could not remove stop file: {e}")


def poll_for_job():
    try:
        response = requests.get(
            f"{API_URL}/api/job/poll",
            params={"pi_id": PI_ID},
            timeout=10
        )

        if response.status_code != 200:
            print(f"[{datetime.now()}] Poll failed with status {response.status_code}")
            return None

        data = response.json()
        job = data.get("job")

        if job:
            print(f"[{datetime.now()}] Received job: {job['job_id']} (type: {job['type']})")

        return job

    except requests.exceptions.Timeout:
        print(f"[{datetime.now()}] Poll request timed out")
        return None
    except requests.exceptions.RequestException as e:
        print(f"[{datetime.now()}] Poll request failed: {e}")
        return None
    except Exception as e:
        print(f"[{datetime.now()}] Unexpected error during poll: {e}")
        return None


def execute_job(job):
    job_id = job["job_id"]
    job_type = job["type"]
    params = job.get("params", {})

    print(f"[{datetime.now()}] Executing job {job_id}...")

    start_time = time.time()

    try:
        if job_type == "start_light_module":
            result = start_light()
            status = "done"
            output = result
        elif job_type == "stop_light_module":
            result = stop_light()
            status = "done"
            output = result
        else:
            status = "failed"
            output = f"Unknown job type: {job_type}"
            print(f"[{datetime.now()}] {output}")

        duration_ms = int((time.time() - start_time) * 1000)
        report_result(job_id, status, output, duration_ms)

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        error_msg = f"Job execution failed: {str(e)}"
        print(f"[{datetime.now()}] {error_msg}")
        report_result(job_id, "failed", error_msg, duration_ms)


def start_light():
    """Start the light service via systemd."""
    print(f"[{datetime.now()}] Starting {SERVICE_NAME} service")

    result = subprocess.run(
        ["sudo", "systemctl", "start", SERVICE_NAME],
        capture_output=True,
        text=True,
        timeout=10
    )
    if result.returncode != 0:
        raise Exception(f"Failed to start service: {result.stderr}")

    time.sleep(1)
    status = subprocess.run(
        ["systemctl", "is-active", SERVICE_NAME],
        capture_output=True,
        text=True
    )
    if status.stdout.strip() == "active":
        return f"{SERVICE_NAME} started"
    raise Exception(f"{SERVICE_NAME} did not start (status: {status.stdout.strip()})")


def stop_light():
    """Stop the light service via systemd."""
    print(f"[{datetime.now()}] Stopping {SERVICE_NAME} service")

    result = subprocess.run(
        ["sudo", "systemctl", "stop", SERVICE_NAME],
        capture_output=True,
        text=True,
        timeout=10
    )
    if result.returncode != 0:
        raise Exception(f"Failed to stop service: {result.stderr}")

    time.sleep(1)
    status = subprocess.run(
        ["systemctl", "is-active", SERVICE_NAME],
        capture_output=True,
        text=True
    )
    if status.stdout.strip() in ["inactive", "failed"]:
        return f"{SERVICE_NAME} stopped"
    raise Exception(f"{SERVICE_NAME} did not stop (status: {status.stdout.strip()})")


def report_result(job_id, status, output, duration_ms):
    try:
        response = requests.post(
            f"{API_URL}/api/job/result",
            json={
                "job_id": job_id,
                "status": status,
                "output": output,
                "duration_ms": duration_ms
            },
            timeout=10
        )
        if response.status_code == 200:
            print(f"[{datetime.now()}] Job {job_id} result reported: {status} ({duration_ms}ms)")
        else:
            print(f"[{datetime.now()}] Failed to report result: HTTP {response.status_code}")
    except Exception as e:
        print(f"[{datetime.now()}] Error reporting result: {e}")


def main():
    global running

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    remove_stop_file()

    print(f"[{datetime.now()}] Light Job Poller started")
    print(f"[{datetime.now()}] API URL: {API_URL}")
    print(f"[{datetime.now()}] PI ID: {PI_ID}")
    print(f"[{datetime.now()}] Poll interval: {POLL_INTERVAL}s")

    try:
        while running:
            if check_stop_file():
                print(f"[{datetime.now()}] Stop file detected. Shutting down...")
                remove_stop_file()
                break

            job = poll_for_job()
            if job:
                execute_job(job)

            for _ in range(POLL_INTERVAL):
                if not running or check_stop_file():
                    break
                time.sleep(1)

    except Exception as e:
        print(f"[{datetime.now()}] Fatal error: {e}")
        return 1
    finally:
        print(f"[{datetime.now()}] Light Job Poller stopped")
        remove_stop_file()
    return 0


if __name__ == "__main__":
    sys.exit(main())
