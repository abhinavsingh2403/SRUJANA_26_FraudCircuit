# TraceGuard one-minute demo script

The official Srujana page says the one-minute working demo is the main basis for first-round shortlisting. Rehearse this against the actual built app. Do not fake metrics or show a nonfunctional button.

## 0–8 seconds — Frame the problem

“Fraud may be hard to see in one payment. TraceGuard links the sequence and gives investigators the evidence behind a review priority.”

Show the case queue and the visible synthetic-data label.

## 8–20 seconds — Replay the linked pattern

Choose `compound-layered-cycle` and click Replay. Open the generated case. Show the transaction timeline and account graph. Point to the linked structural evidence and repeated-value burst; HIGH requires the composite policy in `backend/docs/rule_policy.md`. Explain that HIGH is a review priority, not a fraud probability.

## 20–32 seconds — Show evidence, not just score

Open the evidence cards. Show the specific observed values, trigger transaction IDs and supporting transactions. Mention that related signals may be correlated and the pattern can have legitimate explanations.

## 32–43 seconds — Show a legitimate case

Replay `legitimate-high-volume`. Show that the configured rules produce no case for this fixture. State that it is a constructed test scenario, not proof of a real-world false-positive rate.

## 43–52 seconds — Show uncertainty/review

Replay `insufficient-history`. Explain why the system shows a coverage limitation rather than calling the account fraudulent. Close a case only with a human outcome if time allows.

## 52–60 seconds — Be honest about model status

If a benchmark model has genuinely been trained and evaluated, show actual recorded held-out metrics and the dataset label. If not, show “ML model not configured” and say the current demo uses transparent rules. Never invent an accuracy number.

## Backup plan

Have a local seeded data scenario and a screen recording. If the live server or download fails, tell judges it is a recorded fallback; do not present the recording as a live model inference.
