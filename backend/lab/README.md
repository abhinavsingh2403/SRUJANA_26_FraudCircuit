# Owned local mock API only

This simulates abuse of a mock payments API we wrote on loopback or an owned private VM network. Never target event Wi-Fi, other teams, banks, UPI rails or any host you do not own. Transaction data alone cannot detect API compromise; these events are supplied separately. API is unauthenticated by design.

From `backend/`, start TraceGuard normally, then:

```
LAB_MODE=1 python -m uvicorn lab.mock_payments_api:app --host 127.0.0.1 --port 8001
LAB_MODE=1 python lab/lab_traffic_sim.py --target http://127.0.0.1:8001 --yes
LAB_MODE=1 python scripts/self_test_limits.py --yes
```

The fixed sequence records five synthetic login failures, three unmatched-reference calls, then explicitly imports a deterministic chain and matching events into TraceGuard. There are no credential attempts or payment executions. Repeated identical events deduplicate; conflicting IDs fail atomically.

For an owned Kali VM, use a host-only private network, firewall port 8001 to that VM and bind the mock to its private interface. The TraceGuard backend can remain loopback on the mock host. Run the same simulator from the VM, naming the owned mock IP. All DNS results must be loopback/RFC1918, and the validated IP is pinned. No redirects or proxy environment are used. Any manual security tools remain outside this script and require separate owner authorization.

Teardown: stop both processes and remove the dedicated lab database named by `TRACEGUARD_DB`; do not delete an analyst database. Do not expose either service publicly.
