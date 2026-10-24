import type {
  AuditResponse,
  CaseListResponse,
  CaseRecord,
  EvaluationSummary,
  HealthResponse,
  ImportResponse,
  ReplayAllResponse,
  ReplayResponse,
  ReviewOutcomeSummary,
  Scenario,
} from "../types/domain";

const BASE = "http://127.0.0.1:8000";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(120_000),
    headers: {
      Accept: "application/json",
      ...options.headers,
    },
  });

  const contentType = res.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await res.json()
    : await res.text();

  if (!res.ok) {
    const detail =
      typeof body === "object" && body !== null ? body.detail : body;
    const message =
      typeof detail === "string"
        ? detail
        : JSON.stringify(detail ?? `HTTP ${res.status}`);
    throw new Error(message);
  }

  return body as T;
}

export const api = {
  health(): Promise<HealthResponse> {
    return request("/health");
  },

  scenarios(): Promise<{ scenarios: Scenario[] }> {
    return request("/api/scenarios");
  },

  replayScenario(
    scenarioId: string,
    params?: { gap_scale?: number; amount_scale?: number }
  ): Promise<ReplayResponse> {
    return request(`/api/scenarios/${encodeURIComponent(scenarioId)}/replay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params: params ?? {} }),
    });
  },

  replayAll(): Promise<ReplayAllResponse> {
    return request("/api/scenarios/replay-all", { method: "POST" });
  },

  importCsv(file: File): Promise<ImportResponse> {
    return request("/api/transactions/import", {
      method: "POST",
      headers: { "Content-Type": "text/csv" },
      body: file,
    });
  },

  cases(params: {
    priority?: string;
    status?: string;
    outcome?: string;
    run_id?: string;
    limit?: number;
    offset?: number;
  }): Promise<CaseListResponse> {
    const search = new URLSearchParams();
    if (params.priority) search.set("priority", params.priority);
    if (params.status) search.set("status", params.status);
    if (params.outcome) search.set("outcome", params.outcome);
    if (params.run_id) search.set("run_id", params.run_id);
    search.set("limit", String(params.limit ?? 100));
    search.set("offset", String(params.offset ?? 0));
    return request(`/api/cases?${search.toString()}`);
  },

  caseDetail(caseId: string): Promise<CaseRecord> {
    return request(`/api/cases/${encodeURIComponent(caseId)}`);
  },

  updateReview(
    caseId: string,
    body: {
      status: string;
      outcome?: string | null;
      reviewer: string;
      note: string;
    }
  ): Promise<CaseRecord> {
    const payload: Record<string, unknown> = {
      status: body.status,
      reviewer: body.reviewer,
      note: body.note,
    };
    if (body.status === "CLOSED" && body.outcome) {
      payload.outcome = body.outcome;
    }
    return request(`/api/cases/${encodeURIComponent(caseId)}/review`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  audit(caseId: string): Promise<AuditResponse> {
    return request(`/api/cases/${encodeURIComponent(caseId)}/audit`);
  },

  reviewOutcomes(): Promise<ReviewOutcomeSummary> {
    return request("/api/analytics/review-outcomes");
  },

  evaluation(): Promise<EvaluationSummary> {
    return request("/api/evaluation/summary");
  },
};
