export type Priority = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT_HISTORY";
export type CaseStatus = "OPEN" | "INVESTIGATING" | "ESCALATED" | "CLOSED";
export type ReviewOutcome = "CONFIRMED_SUSPICIOUS" | "FALSE_POSITIVE" | "INCONCLUSIVE";
export type EvidenceKind = "RULE_SIGNAL" | "CONTEXT_SIGNAL" | "COVERAGE_LIMITATION";

export interface Transaction {
  transaction_id: string;
  timestamp: string;
  sender_id: string;
  recipient_id: string;
  amount: number;
  transaction_type: string;
  currency?: string | null;
}

export interface Evidence {
  evidence_id: string;
  rule_id: string;
  title: string;
  kind: EvidenceKind;
  description: string;
  trigger_transaction_id: string;
  transaction_ids: string[];
  account_ids: string[];
  observed: Record<string, unknown>;
  caveats: string[];
}

export interface CaseCounts {
  trigger_transactions_total: number;
  context_transactions_total: number;
  account_ids_total: number;
  evidence_total: number;
  rule_signals_total: number;
  context_signals_total: number;
}

export interface CaseTruncation {
  trigger_transactions: boolean;
  context_transactions: boolean;
  account_ids: boolean;
  evidence: boolean;
}

export interface ScoreComponents {
  rule_codes: string[];
  context_codes: string[];
  model_score: null;
  model_status: "not_configured";
}

export interface ReviewLogEvent {
  id: number;
  case_id: string;
  previous_status: string;
  new_status: CaseStatus;
  previous_outcome: ReviewOutcome | null;
  new_outcome: ReviewOutcome | null;
  reviewer: string;
  note: string;
  created_at: string;
  prev_hash: string;
  event_hash: string;
}

export interface CaseRecord {
  case_id: string;
  run_id: string;
  source_scenario_id: string;
  priority: Priority;
  status: CaseStatus;
  review_outcome: ReviewOutcome | null;
  transaction_ids: string[];
  context_transaction_ids: string[];
  account_ids: string[];
  rule_codes: string[];
  context_codes: string[];
  evidence: Evidence[];
  trigger_transactions: Transaction[];
  context_transactions: Transaction[];
  score_components: ScoreComponents;
  summary: string;
  limitations: string[];
  counts: CaseCounts;
  truncation: CaseTruncation;
  review_history?: ReviewLogEvent[];
  created_at?: string;
  updated_at?: string;
}

export interface Scenario {
  id: string;
  title: string;
  purpose: string;
  expected: string;
}

export interface CaseListResponse {
  count: number;
  total: number;
  offset: number;
  limit: number;
  cases: CaseRecord[];
}

export interface GraphSummary {
  transactions_analyzed: number;
  directed_cycles_detected: number;
  layered_chains_detected: number;
  cycle_search_budget_exhausted: number;
  chain_search_budget_exhausted: number;
  graph_search_expansion_limit: number;
  graph_analysis_incomplete: number;
}

export interface ReplayResponse {
  scenario_id: string;
  run_id: string;
  transaction_count: number;
  case_count: number;
  graph_summary: GraphSummary;
  analysis_warnings: string[];
  expected_outcome: string;
  cases: CaseRecord[];
  notice: string;
}

export interface ReplayAllResponse {
  scenario_count: number;
  transaction_count: number;
  case_count: number;
  results: ReplayResponse[];
  cases: CaseRecord[];
  analysis_warnings: string[];
  notice: string;
}

export interface ImportResponse {
  run_id: string;
  transaction_count: number;
  currency: string | null;
  case_count: number;
  graph_summary: GraphSummary;
  cases_returned: number;
  cases_truncated: boolean;
  dropped_columns: string[];
  warnings: string[];
  analysis_warnings: string[];
  cases: CaseRecord[];
  notice: string;
}

export interface HealthResponse {
  status: string;
  service: string;
  model_status: string;
}

export interface AuditResponse {
  case_id: string;
  valid: boolean;
  event_count: number;
  head_hash?: string;
  warning?: string;
  broken_at_event_id?: number;
  reason?: string;
}

export interface ReviewOutcomeSummary {
  total_cases: number;
  closed_cases: number;
  reviewed_cases_with_outcome: number;
  outcome_counts: Record<string, number>;
  warning: string;
}

export interface EvaluationSummary {
  model_status: string;
  evaluation_status: string;
  metrics: null;
  dataset: null;
  message: string;
  required_reporting: string[];
}
