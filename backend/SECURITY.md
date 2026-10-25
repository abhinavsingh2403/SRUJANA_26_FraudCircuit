# Security notes

This is an unauthenticated hackathon development backend. It is not production-ready and is not connected to a bank or payment system. Keep it bound to localhost unless the team deliberately exposes only the frontend on a trusted private LAN. Never expose this API to the public internet.

Implemented guardrails include request byte limit on CSV import, row and field bounds, strict CSV parsing, all-or-nothing import validation, maximum response sizes for case contents, Pydantic request validation, parameterized SQL and bounded review notes. These controls reduce some risks but do not constitute complete API security.

Not implemented: authentication, authorization/object-level access controls, rate limiting, tenancy, production CSRF policy, external audit anchoring, secrets management, deployment hardening or full penetration testing. Do not upload real customer/financial data. Do not scan or test systems without authorization.

The hash-chained review log detects some stored event edits/reordering but is not cryptographically protected against a database owner rewriting the entire chain or deleting its tail. Keep a copy of any important final evaluation artefacts outside the database if they must be preserved.

See `docs/known_limitations.md` and the [OWASP API Security Top 10](https://devguide.owasp.org/en/07-training-education/07-api-top-ten/).

Update 2026-10-25: JSON mutation requests now have a 256 KiB streaming byte bound. Requests with a browser Origin other than the request origin or explicitly configured CORS origins are rejected before mutation; cross-site Fetch Metadata without Origin is also rejected. This narrows browser-based attacks but does not authenticate clients, prevent DNS rebinding, or replace the production controls listed above.
