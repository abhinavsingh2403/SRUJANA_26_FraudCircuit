# Research/source ledger — verified links and scope

**Research snapshot:** 24 October 2026. This ledger distinguishes what each source says from what TraceGuard implements. Open a source before repeating an exact number or current claim in the final pitch.

## Official Indian context

### CERT-In Advisory CIAD-2026-0046 — 9 October 2026
Link: https://www.cert-in.org.in/s2cMainServlet?VLCODE=CIAD-2026-0046&pageid=PUBVLNOTES02

The advisory describes threat actors abusing payment/disbursement APIs to initiate unauthorized transfers, including movement to mule accounts, and recommends API inventory/controls, authentication, limits, transaction validation, monitoring and logging. This establishes a current adjacent threat context.

**What it does not establish:** It does not evaluate TraceGuard, supply a transaction dataset, prove that a transaction-only model detects API compromise, or permit this prototype to block payments. TraceGuard only analyses supplied transaction rows.

### I4C–RBIH agreement — 12 May 2026
Link: https://www.pib.gov.in/PressReleasePage.aspx?PRID=2260277&lang=1&reg=1

The Ministry of Home Affairs release describes collaboration to improve AI-driven mule-account/cyber-financial-fraud detection and sharing of suspect-registry intelligence for participating systems.

**Scope boundary:** TraceGuard has no access to I4C's Suspect Registry or RBIH/MuleHunter.ai systems. The announcement supports why connected-account/mule risk is relevant; it is not evidence of TraceGuard accuracy.

### Srujana Tech Fest 2026 official hackathon page
Link: https://www.srujanacu.in/events/hackathon

The page states dates 24–26 October 2026, 48 hours, teams of 2–4, continuous evaluation every 8 hours, a one-minute working demo as the main first-round shortlisting basis, and a requirement for project code and documentation. Check it again if deadlines or submission instructions matter.

The participant rubric supplied by the team is included verbatim in `references/Srujana_2026_Participant_Evaluation_Rubric_Source.pdf` and gives separate weights to technical depth, domain correctness, reliability, validation, UX, relevance and originality.

## Dataset/research context

### PaySim / synthetic mobile-money dataset article
Link: https://pmc.ncbi.nlm.nih.gov/articles/PMC9560719/

This article describes PaySim as simulated mobile-money data, reporting 6,362,620 transactions, 8,213 fraud examples and 743 simulation time steps covering a simulated 30-day period. The article reports the field `step` as an hourly simulation step in the dataset description.

**Implications:** PaySim is not real Indian UPI data. Rows with the same `step` have no sub-step chronology represented by the `step` column; keep same-step rows in one temporal split. Before using a downloaded file, inspect the actual header, step range, row count and label counts rather than assuming the file matches a paper or an online repository.

### Labeled synthetic mobile-money dataset limitations
Link: https://pmc.ncbi.nlm.nih.gov/articles/PMC12036017/

The article's limitations state that labels were based on predefined rules/scenarios and may not cover all evolving fraud tactics; the paper does not establish utility on real-world test data. This is a direct reminder that synthetic labels encode simulator assumptions.

### scikit-learn temporal validation and metric documentation
- `TimeSeriesSplit`: https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html
- `average_precision_score`: https://scikit-learn.org/stable/modules/generated/sklearn.metrics.average_precision_score.html

These are useful references for temporal validation and precision-recall evaluation. The generic `TimeSeriesSplit` is not a magic adapter: the team still has to group records sharing a discrete timestamp/step and check class distribution in each split.

## Open-source code references

### IBM AMLSim
Link: https://github.com/IBM/AMLSim

The repository describes a simulator for synthetic banking transactions with known laundering patterns, designed for experimentation with machine-learning models and graph algorithms. Its published README references older Java/Python and library versions. Use it as an algorithm/data-generation reference, not as a required dependency for this 36-hour build.

### Neo4j graph fraud example
Link: https://github.com/neo4j-graph-examples/fraud-detection

This public example demonstrates graph-based fraud analysis on a synthetic transaction dataset. It shows that “uses a graph” is not, by itself, a novel claim. TraceGuard should differentiate through the working investigation workflow, transparent evidence, robustness and measured evaluation.

### OWASP API Security Top 10 (2023)
Link: https://devguide.owasp.org/en/07-training-education/07-api-top-ten/

OWASP covers API risks including broken object-level authorization, broken authentication, unrestricted resource consumption and security misconfiguration. TraceGuard's local backend limits some inputs, but has no authentication or authorization and is **not production hardened**. Keep it local or on a trusted test network.

## Design recommendations derived from sources + engineering judgement

The following are engineering choices, not direct claims made by the sources:

- Use evidence and case triage rather than outputting a bare “fraud/not fraud” label.
- Include a legitimate high-volume case and insufficient-history case in the demo.
- Keep labels, existing fraud flags and ambiguous post-event fields out of inference features. The current importer strips recognized label/flag/common balance columns; a future PaySim ML adapter must separately document its point-in-time features.
- Use chronological evaluation with class-distribution checks and report precision, recall, false positives, average precision and precision at top K. Accuracy alone is misleading under severe imbalance.
- Keep the ML model unconfigured until its artifact and held-out evaluation actually exist.
