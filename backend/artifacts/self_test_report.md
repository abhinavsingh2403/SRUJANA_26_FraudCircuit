# Observed local input-limit checks

API is unauthenticated by design. These checks are not a security audit.

- oversized: expected 413, observed 413, passed=True
- malformed: expected 422, observed 422, passed=True
- duplicate ID: expected 422, observed 422, passed=True
- PaySim-shaped: expected 422, observed 422, passed=True
