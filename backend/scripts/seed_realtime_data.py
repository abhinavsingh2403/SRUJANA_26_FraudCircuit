#!/usr/bin/env python3
"""
TraceGuard Real-Time Data Feeder & Sample Data Seeder
Populates the TraceGuard server with complex network topologies and real PaySim fraud episodes.
"""
import sys
import time
import argparse
from pathlib import Path
import httpx

EXAMPLES_DIR = Path(__file__).resolve().parents[1] / "examples"

def post_csv(url: str, file_path: Path):
    if not file_path.is_file():
        print(f"[-] File not found: {file_path}")
        return None
    data = file_path.read_bytes()
    try:
        r = httpx.post(
            f"{url.rstrip('/')}/api/transactions/import",
            content=data,
            headers={"content-type": "text/csv"},
            timeout=30.0
        )
        if r.status_code == 200:
            res = r.json()
            print(f"[+] Successfully imported {file_path.name}:")
            print(f"    - Transactions: {res.get('transaction_count')}")
            print(f"    - Cases Created: {res.get('case_count')}")
            print(f"    - Run ID: {res.get('run_id')}")
            for c in res.get("cases", []):
                print(f"      * {c['case_id']} [{c['priority']}]: {', '.join(c['rule_codes'])} ({len(c['account_ids'])} nodes)")
            return res
        else:
            print(f"[-] Import failed ({r.status_code}): {r.text}")
            return None
    except Exception as e:
        print(f"[-] Connection error: {e}")
        return None

def stream_batches(url: str, delay_seconds: float = 1.0):
    """Simulates real-time streaming transactions with intervals."""
    complex_file = EXAMPLES_DIR / "complex_graph_topology.csv"
    paysim_file = EXAMPLES_DIR / "paysim_real_fraud_cases.csv"

    print("[*] Starting real-time transaction streaming simulation...")
    print(f"[*] Step 1: Feeding multi-cluster graph network from {complex_file.name}...")
    post_csv(url, complex_file)

    time.sleep(delay_seconds)

    print(f"\n[*] Step 2: Feeding real PaySim mobile-money fraud episodes from {paysim_file.name}...")
    post_csv(url, paysim_file)

    # Check total cases
    r = httpx.get(f"{url.rstrip('/')}/api/cases")
    if r.status_code == 200:
        total = r.json().get("total", 0)
        print(f"\n[+] Total cases now active in database queue: {total}")

def main():
    parser = argparse.ArgumentParser(description="Seed server with real-time and sample data")
    parser.add_argument("--url", default="http://127.0.0.1:8000", help="TraceGuard backend URL")
    parser.add_argument("--delay", type=float, default=0.5, help="Delay between streaming batches")
    args = parser.parse_args()

    stream_batches(args.url, args.delay)

if __name__ == "__main__":
    main()
