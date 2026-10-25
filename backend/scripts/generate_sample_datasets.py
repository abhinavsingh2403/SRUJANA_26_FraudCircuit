#!/usr/bin/env python3
"""
Generate rich sample datasets for TraceGuard graph visualization and testing.
Includes authentic fraud sequences from PaySim and multi-topology laundering networks.
"""
import csv
from datetime import datetime, timedelta, timezone
from pathlib import Path
import pandas as pd

EXAMPLES_DIR = Path(__file__).resolve().parents[1] / "examples"
PAYSIM_PATH = r"D:\hack\archive (1)\PS_20174392719_1491204439457_log.csv"
BASE_TIME = datetime(2026, 10, 25, 9, 0, 0, tzinfo=timezone.utc)

def generate_complex_graph_dataset():
    """
    Creates a rich multi-topology dataset demonstrating:
    1. 4-Hop Layering Chain: ALPHA -> LAYER-1 -> LAYER-2 -> LAYER-3 -> VAULT-EXIT
    2. Directed Smurfing Cycle: RING-A -> RING-B -> RING-C -> RING-A
    3. Fan-Out Rapid Dispersal: DISPERSAL-HUB -> 6 distinct mule accounts
    4. Fan-In Mule Aggregation: 4 source accounts -> COLLECTOR-MULE
    5. Amount Deviation Outlier: Consistent $150 history followed by $75,000 anomaly
    """
    rows = []
    t = BASE_TIME

    # 1. Layered Chain (4-hop)
    chain = ["CHAIN-SRC-ALPHA", "MULE-LAYER-01", "MULE-LAYER-02", "MULE-LAYER-03", "OFFSHORE-VAULT"]
    amounts = [250000.0, 245000.0, 240000.0, 235000.0]
    for i in range(len(amounts)):
        rows.append({
            "transaction_id": f"TX-LAYER-0{i+1}",
            "timestamp": (t + timedelta(minutes=i * 4)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "sender_id": chain[i],
            "recipient_id": chain[i+1],
            "amount": amounts[i],
            "transaction_type": "TRANSFER"
        })

    # 2. Directed Cycle (Circular Flow)
    ring = ["RING-NODE-A", "RING-NODE-B", "RING-NODE-C"]
    ring_amounts = [50000.0, 48000.0, 46000.0]
    for i in range(3):
        rows.append({
            "transaction_id": f"TX-RING-0{i+1}",
            "timestamp": (t + timedelta(minutes=20 + i * 5)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "sender_id": ring[i],
            "recipient_id": ring[(i+1) % 3],
            "amount": ring_amounts[i],
            "transaction_type": "TRANSFER"
        })

    # 3. Fan-Out Dispersal Burst
    hub = "DISPERSAL-HUB"
    mules = [f"RECV-MULE-0{i}" for i in range(1, 7)]
    for i, m in enumerate(mules):
        rows.append({
            "transaction_id": f"TX-FANOUT-0{i+1}",
            "timestamp": (t + timedelta(minutes=35 + i)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "sender_id": hub,
            "recipient_id": m,
            "amount": 9500.0,  # Structuring under 10k threshold
            "transaction_type": "TRANSFER"
        })

    # 4. Fan-In Mule Aggregation
    collector = "COLLECTOR-MULE"
    smurfs = [f"SMURF-ACCT-0{i}" for i in range(1, 5)]
    for i, s in enumerate(smurfs):
        rows.append({
            "transaction_id": f"TX-FANIN-0{i+1}",
            "timestamp": (t + timedelta(minutes=45 + i * 2)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "sender_id": s,
            "recipient_id": collector,
            "amount": 4900.0,
            "transaction_type": "TRANSFER"
        })
    # Collector rapid pass-through
    rows.append({
        "transaction_id": "TX-FANIN-OUTFLOW",
        "timestamp": (t + timedelta(minutes=55)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sender_id": collector,
        "recipient_id": "CRYPTO-GATEWAY",
        "amount": 19000.0,
        "transaction_type": "TRANSFER"
    })

    # 5. Amount Deviation Outlier
    user_acct = "CORP-PAYROLL-ACCT"
    vendor = "RELIABLE-SUPPLIER-LTD"
    # 5 normal baseline transactions
    for i in range(5):
        rows.append({
            "transaction_id": f"TX-BASE-0{i+1}",
            "timestamp": (t - timedelta(days=5 - i)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "sender_id": user_acct,
            "recipient_id": vendor,
            "amount": 150.0 + i * 10,
            "transaction_type": "PAYMENT"
        })
    # Sudden extreme deviation
    rows.append({
        "transaction_id": "TX-OUTLIER-ANOMALY",
        "timestamp": (t + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sender_id": user_acct,
        "recipient_id": "UNKNOWN-OFFSHORE-CORP",
        "amount": 89500.0,
        "transaction_type": "TRANSFER"
    })

    out_file = EXAMPLES_DIR / "complex_graph_topology.csv"
    with open(out_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["transaction_id", "timestamp", "sender_id", "recipient_id", "amount", "transaction_type"])
        writer.writeheader()
        writer.writerows(rows)
    print(f"[+] Created {out_file} ({len(rows)} transactions)")
    return out_file

def generate_paysim_fraud_dataset():
    """
    Extracts authentic fraud episodes directly from the real PaySim dataset.
    """
    if not Path(PAYSIM_PATH).is_file():
        print("[-] PaySim dataset not found; skipping extraction.")
        return None

    print(f"[*] Extracting authentic fraud episodes from: {PAYSIM_PATH}")
    df = pd.read_csv(PAYSIM_PATH, nrows=500000)
    fraud = df[df["isFraud"] == 1]
    
    rows = []
    t = BASE_TIME
    # Extract 20 authentic fraud episodes
    for idx, (_, r) in enumerate(fraud.head(20).iterrows(), 1):
        step = int(r["step"])
        dt = t + timedelta(hours=step, minutes=idx * 2)
        rows.append({
            "transaction_id": f"PAYSIM-FRD-{idx:03d}",
            "timestamp": dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "sender_id": str(r["nameOrig"]),
            "recipient_id": str(r["nameDest"]),
            "amount": float(r["amount"]),
            "transaction_type": str(r["type"])
        })

    # Add 10 benign background transactions for realistic contrast
    benign = df[df["isFraud"] == 0].head(10)
    for idx, (_, r) in enumerate(benign.iterrows(), 1):
        step = int(r["step"])
        dt = t + timedelta(hours=step, minutes=idx * 3)
        rows.append({
            "transaction_id": f"PAYSIM-NORM-{idx:03d}",
            "timestamp": dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "sender_id": str(r["nameOrig"]),
            "recipient_id": str(r["nameDest"]),
            "amount": float(r["amount"]),
            "transaction_type": str(r["type"])
        })

    out_file = EXAMPLES_DIR / "paysim_real_fraud_cases.csv"
    with open(out_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["transaction_id", "timestamp", "sender_id", "recipient_id", "amount", "transaction_type"])
        writer.writeheader()
        writer.writerows(rows)
    print(f"[+] Created {out_file} ({len(rows)} real PaySim transactions)")
    return out_file

def main():
    EXAMPLES_DIR.mkdir(parents=True, exist_ok=True)
    generate_complex_graph_dataset()
    generate_paysim_fraud_dataset()
    print("[*] Sample datasets generation complete!")

if __name__ == "__main__":
    main()
