from __future__ import annotations

import json
import os
import tempfile
import sys
from pathlib import Path

# Allow direct execution as `python scripts/replay_all.py`.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from traceguard import db
from traceguard.fixtures import SCENARIOS, scenario_transactions
from traceguard.pipeline import analyse_transactions


def main() -> None:
    # CLI replay uses a temporary DB unless TRACEGUARD_DB was explicitly set.
    if "TRACEGUARD_DB" not in os.environ:
        os.environ["TRACEGUARD_DB"] = os.path.join(tempfile.gettempdir(), "traceguard-replay.db")
    db.initialize()
    result = []
    for scenario_id in SCENARIOS:
        txs = scenario_transactions(scenario_id)
        run_id, cases = analyse_transactions(txs, scenario_id)
        db.upsert_cases(cases)
        result.append({
            "scenario_id": scenario_id,
            "transaction_count": len(txs),
            "run_id": run_id,
            "cases": [{"case_id": c["case_id"], "priority": c["priority"], "rule_codes": c["rule_codes"], "summary": c["summary"]} for c in cases],
        })
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
