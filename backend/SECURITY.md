# Security notes

This is an unauthenticated hackathon development backend. It is not production-ready and is not connected to a bank or payment system. Keep it bound to localhost unless the team deliberately exposes only the frontend on a trusted private LAN. Never expose this API to the public internet.

Implemented guardrails include request byte limit on CSV import, row and field bounds, strict CSV parsing, all-or-nothing import validation, maximum response sizes for case contents, Pydantic request validation, parameterized SQL and bounded review notes. These controls reduce some risks but do not constitute complete API security.

Not implemented: authentication, authorization/object-level access controls, rate limiting, tenancy, production CSRF policy, external audit anchoring, secrets management, deployment hardening or full penetration testing. Do not upload real customer/financial data. Do not scan or test systems without authorization.

The hash-chained review log detects some stored event edits/reordering but is not cryptographically protected against a database owner rewriting the entire chain or deleting its tail. Keep a copy of any important final evaluation artefacts outside the database if they must be preserved.

See `docs/known_limitations.md` and the [OWASP API Security Top 10](https://devguide.owasp.org/en/07-training-education/07-api-top-ten/).
