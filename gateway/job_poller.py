#!/usr/bin/env python3
"""
Gateway Job Poller for Raspberry Pi
Polls the backend for jobs and executes them.

Stop methods:
1. CTRL+C (SIGINT)
2. Create file: /tmp/stop_gateway
3. Send SIGTERM signal
"""

import time
import requests
import signal
import sys
import os
import subprocess
import json
from datetime import datetime
from pathlib import Path

# Configuration
API_URL = "https://bike-api.dyntech.workers.dev"
PI_ID = "gateway"
POLL_INTERVAL = 5  # seconds
STOP_FILE = "/tmp/stop_gateway"

# Global flag for graceful shutdown
running = True


def signal_handler(signum, frame):
    """Handle SIGINT (CTRL+C) and SIGTERM signals"""
    global running
    print(f"\n[{datetime.now()}] Signal {signum} received. Shutting down gracefully...")
    running = False


def check_stop_file():
    """Check if stop file exists"""
    return os.path.exists(STOP_FILE)


def remove_stop_file():
    """Remove stop file if it exists"""
    if os.path.exists(STOP_FILE):
        try:
            os.remove(STOP_FILE)
            print(f"[{datetime.now()}] Removed stop file: {STOP_FILE}")
        except Exception as e:
            print(f"[{datetime.now()}] Warning: Could not remove stop file: {e}")


def poll_for_job():
    """Poll the backend for a new job"""
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
    """Execute a job based on its type"""
    job_id = job["job_id"]
    job_type = job["type"]
    params = job.get("params", {})

    print(f"[{datetime.now()}] Executing job {job_id}...")

    start_time = time.time()

    try:
        if job_type == "gps_read":
            # Execute GPS read script
            result = execute_gps_read(params)
            status = "done"
            output = result
        else:
            # Unknown job type
            status = "failed"
            output = f"Unknown job type: {job_type}"
            print(f"[{datetime.now()}] {output}")

        duration_ms = int((time.time() - start_time) * 1000)

        # Report result back to backend
        report_result(job_id, status, output, duration_ms)

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        error_msg = f"Job execution failed: {str(e)}"
        print(f"[{datetime.now()}] {error_msg}")
        report_result(job_id, "failed", error_msg, duration_ms)


def execute_gps_read(params):
    """Execute GPS read script"""
    device = params.get("device", "unknown")
    print(f"[{datetime.now()}] Reading GPS for device: {device}")

    # Path to GPS reader script (adjust as needed)
    gps_script = Path(__file__).parent / "gps_reader.py"

    if not gps_script.exists():
        raise FileNotFoundError(f"GPS reader script not found: {gps_script}")

    # Execute the GPS reader script
    result = subprocess.run(
        [sys.executable, str(gps_script), device],
        capture_output=True,
        text=True,
        timeout=30  # 30 second timeout
    )

    if result.returncode != 0:
        raise Exception(f"GPS reader failed: {result.stderr}")

    return result.stdout.strip()


def report_result(job_id, status, output, duration_ms):
    """Report job result back to backend"""
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
    """Main polling loop"""
    global running

    # Register signal handlers
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # Remove any existing stop file
    remove_stop_file()

    print(f"[{datetime.now()}] Gateway Job Poller started")
    print(f"[{datetime.now()}] API URL: {API_URL}")
    print(f"[{datetime.now()}] PI ID: {PI_ID}")
    print(f"[{datetime.now()}] Poll interval: {POLL_INTERVAL}s")
    print(f"[{datetime.now()}] Stop methods:")
    print(f"  1. Press CTRL+C")
    print(f"  2. Create file: {STOP_FILE}")
    print(f"  3. Send SIGTERM: kill -TERM <pid>")
    print()

    try:
        while running:
            # Check for stop file
            if check_stop_file():
                print(f"[{datetime.now()}] Stop file detected. Shutting down...")
                remove_stop_file()
                break

            # Poll for new job
            job = poll_for_job()

            if job:
                # Execute job
                execute_job(job)

            # Sleep between polls (check stop conditions more frequently)
            for _ in range(POLL_INTERVAL):
                if not running or check_stop_file():
                    break
                time.sleep(1)

    except Exception as e:
        print(f"[{datetime.now()}] Fatal error: {e}")
        return 1

    finally:
        print(f"[{datetime.now()}] Gateway Job Poller stopped")
        remove_stop_file()

    return 0


if __name__ == "__main__":
    sys.exit(main())
