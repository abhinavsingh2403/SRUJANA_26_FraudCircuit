# Observed loopback checks

API is unauthenticated by design. Not a security audit.

{'test': 'oversized', 'expected': 413, 'actual': 413, 'passed': True}
{'test': 'malformed', 'expected': 422, 'actual': 422, 'passed': True}
{'test': 'duplicate ID', 'expected': 422, 'actual': 422, 'passed': True}
{'test': 'PaySim-shaped', 'expected': 422, 'actual': 422, 'passed': True}
