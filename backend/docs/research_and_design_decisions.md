# Research and design decisions

**Research snapshot:** 24 October 2026. Sources below support context and engineering choices; they do not prove TraceGuard is effective or novel. Re-check all links before presentation if the date changes.

## Current Indian threat context

- **CERT-In Advisory CIAD-2026-0046, issued 9 October 2026:** describes attacks on payment/disbursement APIs in BFSI/fintech contexts, including unauthorized transfers and mule accounts. This establishes an adjacent threat context. It does not imply TraceGuard detects API compromise; TraceGuard analyzes transaction records only. [Official advisory](https://www.cert-in.org.in/s2cMainServlet?VLCODE=CIAD-2026-0046&pageid=PUBVLNOTES02)
- **I4C–RBIH collaboration, 12 May 2026:** government announcement described AI-based mule-account detection work. This supports the relevance of mule-account risk as a research theme, but TraceGuard has no access to the Suspect Registry or institution data. [PIB/MHA press release](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2260277&lang=1&reg=1)
- **Srujana official event page:** use it for event schedule and submission rules; the uploaded participant rubric governs judging weights. [Official event page](https://www.srujanacu.in/events/hackathon)

## Open-source implementation references

- **IBM AMLSim:** a synthetic banking transaction simulator with known money-laundering patterns for research on ML and graph algorithms. Its repository advertises Apache-2.0, but its README still references older Java/Python/NetworkX dependencies. It is a reference, not a project dependency for a 36-hour build. [GitHub](https://github.com/IBM/AMLSim)
- **Neo4j graph fraud example:** demonstrates graph-based analysis on a PaySim-style dataset. It proves graph analysis itself is not a new claim; our demonstration must be justified by evidence, usability and testing. [GitHub](https://github.com/neo4j-graph-examples/fraud-detection)
- **OWASP API Security Top 10 (2023):** calls attention to broken object-level authorization, authentication, unrestricted resource consumption, security misconfiguration, and related API risks. This local prototype does not implement production authentication/authorization and must remain local. [OWASP](https://devguide.owasp.org/en/07-training-education/07-api-top-ten/)

## Data and evaluation references

- **PaySim paper / dataset:** PaySim is simulated mobile-money data, not real Indian UPI records. The published article discusses the simulation and dataset construction. [Open-access paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC9560719/)
- **A labeled synthetic mobile-money dataset paper (Data in Brief):** its limitations section says labels come from predefined rules/scenarios and the dataset has not been evaluated for utility on real-world test sets. This is a useful reminder that synthetic labels can encode simulator assumptions. [Open-access article](https://pmc.ncbi.nlm.nih.gov/articles/PMC12036017/)
- **scikit-learn TimeSeriesSplit:** reference for time-aware validation; dataset-specific equal-step grouping is still a responsibility of the adapter. [Documentation](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html)
- **scikit-learn average precision:** use a precision-recall summary for imbalanced classification, alongside precision, recall, false positives, and precision at top K. [Documentation](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.average_precision_score.html)

## Decisions adopted in this prototype

1. Prioritize a working investigation workflow over more model families, APIs or infrastructure.
2. Use deterministic synthetic fixtures for demo repeatability and independent acceptance tests.
3. Keep risk signals, context signals and coverage limitations separate.
4. Never auto-suppress an alert just because a transaction matches a routine-looking context feature.
5. Use the current HIGH policy documented in `rule_policy.md`: linked structural/corroborating evidence, at least three rules and four triggers, plus R6 or R7. This remains a heuristic review priority.
6. Bound uploaded files, row counts, error messages, linked transactions, accounts and evidence returned in cases.
7. Make truncation explicit instead of silently omitting data.
8. Make reviewer outcome separate from review workflow status.
9. Keep the ML API empty until actual training and chronological evaluation run; never fabricate metrics.
10. Use no external service or paid API for core demo behavior.

## Claims the project must not make

- “We detect all fraud” / “zero false positives” / “bank-grade” / “real-time UPI protection.”
- “The model has X% accuracy” before the team runs, records and reproduces the evaluation.
- “Graph analysis is new” or “no other product does this.”
- “A HIGH case means a fraud is confirmed.”
- “The government Suspect Registry or bank transactions are connected to this prototype.”
