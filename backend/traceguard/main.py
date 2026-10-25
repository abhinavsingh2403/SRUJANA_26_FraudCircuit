"""FastAPI HTTP layer. Core analysis and storage live in separate modules."""
from __future__ import annotations

from contextlib import asynccontextmanager
from enum import Enum
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from fastapi.middleware.cors import CORSMiddleware
import os
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from . import db
from .config import DEFAULT_SETTINGS
from .ingestion import CSVValidationError
from .service import import_csv, list_scenarios, replay_all, replay_scenario


class ReviewStatus(str, Enum):
    OPEN = "OPEN"
    INVESTIGATING = "INVESTIGATING"
    ESCALATED = "ESCALATED"
    CLOSED = "CLOSED"


class ReviewOutcome(str, Enum):
    CONFIRMED_SUSPICIOUS = "CONFIRMED_SUSPICIOUS"
    FALSE_POSITIVE = "FALSE_POSITIVE"
    INCONCLUSIVE = "INCONCLUSIVE"


class ReplayRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    params: dict[str, float] = Field(default_factory=dict)


class ReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: ReviewStatus
    outcome: ReviewOutcome | None = None
    reviewer: str = Field(default="analyst", min_length=1, max_length=100)
    note: str = Field(default="", max_length=1000)

    @model_validator(mode="after")
    def outcome_matches_status(self):
        if self.status == ReviewStatus.CLOSED and self.outcome is None:
            raise ValueError("Closing a case requires an outcome")
        if self.status != ReviewStatus.CLOSED and self.outcome is not None:
            raise ValueError("Outcome can only be set when status is CLOSED")
        return self

    @field_validator("reviewer")
    @classmethod
    def reviewer_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("reviewer must not be blank")
        return value.strip()


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.initialize()
    from .security import initialize
    initialize()
    yield


app = FastAPI(
    title="TraceGuard API",
    summary="Explainable transaction-risk triage and case investigation",
    description=(
        "Prototype decision support using synthetic or user-provided benchmark data. "
        "A rule match is not proof of fraud. No bank or payment-network connection is provided."
    ),
    version="0.4.0",
    lifespan=lifespan,
)


# Local-development CORS only. Override explicitly if the frontend origin changes.
# Do not deploy this development API publicly without authentication and deployment hardening.
_allowed_origins = [item.strip() for item in os.environ.get(
    "TRACEGUARD_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",") if item.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Content-Type", "Accept"],
    max_age=600,
)

_pkg_dir = Path(__file__).resolve().parent
_repo_frontend = _pkg_dir.parents[1] / "frontend"
STATIC_DIR = _repo_frontend if _repo_frontend.is_dir() else (_pkg_dir / "static")


@app.get("/", include_in_schema=False)
def frontend_home() -> FileResponse:
    """Serve the dependency-free same-origin investigation UI."""
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/{page_name}.html", include_in_schema=False)
def frontend_page(page_name: str) -> FileResponse:
    """Serve multi-page HTML entry points."""
    page_file = STATIC_DIR / f"{page_name}.html"
    if page_file.is_file():
        return FileResponse(page_file)
    raise HTTPException(status_code=404, detail="Page not found")


@app.get("/health", tags=["system"])
def health() -> dict[str, Any]:
    from .model_hook import model_status
    return {"status": "ok", "service": "traceguard-backend", **model_status()}


@app.get("/api/scenarios", tags=["scenarios"])
def scenarios() -> dict[str, Any]:
    return {"scenarios": list_scenarios()}


@app.post("/api/scenarios/{scenario_id}/replay", tags=["scenarios"])
def replay_one(scenario_id: str, body: ReplayRequest | None = None) -> dict[str, Any]:
    params = body.params if body else {}
    allowed_params = {"gap_scale", "amount_scale"}
    unknown = sorted(set(params) - allowed_params)
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unsupported scenario parameter(s): {', '.join(unknown)}")
    try:
        return replay_scenario(scenario_id, params, DEFAULT_SETTINGS)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown scenario: {scenario_id}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/scenarios/replay-all", tags=["scenarios"])
def replay_every_scenario() -> dict[str, Any]:
    return replay_all(DEFAULT_SETTINGS)


@app.post("/api/transactions/import", tags=["transactions"])
async def import_transactions(request: Request) -> dict[str, Any]:
    # Enforce the limit while streaming, before buffering an unbounded request.
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > DEFAULT_SETTINGS.max_upload_bytes:
                raise HTTPException(status_code=413, detail="CSV upload exceeds the configured size limit")
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid Content-Length header")
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > DEFAULT_SETTINGS.max_upload_bytes:
            raise HTTPException(status_code=413, detail="CSV upload exceeds the configured size limit")
        chunks.append(chunk)
    raw = b"".join(chunks)
    try:
        return import_csv(raw, DEFAULT_SETTINGS)
    except CSVValidationError as exc:
        raise HTTPException(status_code=422, detail={"message": str(exc), "errors": exc.details}) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/cases", tags=["cases"])
def get_cases(
    priority: str | None = Query(default=None, pattern="^(HIGH|MEDIUM|LOW|INSUFFICIENT_HISTORY)$"),
    status: ReviewStatus | None = Query(default=None),
    scenario_id: str | None = Query(default=None, max_length=100),
    run_id: str | None = Query(default=None, max_length=100),
    outcome: ReviewOutcome | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0, le=100_000),
) -> dict[str, Any]:
    filter_kwargs = dict(priority=priority, status=status.value if status else None,
                         scenario_id=scenario_id, run_id=run_id,
                         outcome=outcome.value if outcome else None)
    total = db.count_cases(**filter_kwargs)
    cases = db.list_cases(**filter_kwargs, limit=limit, offset=offset)
    return {"count": len(cases), "total": total, "offset": offset, "limit": limit, "cases": cases}


@app.get("/api/cases/{case_id}", tags=["cases"])
def get_case(case_id: str) -> dict[str, Any]:
    case = db.get_case(case_id)
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")
    case["review_history"] = db.review_history(case_id)
    from .security import trace_for, related
    case["trace"] = trace_for(case)
    case["related_security_events"] = related(case)
    return case


@app.patch("/api/cases/{case_id}/review", tags=["cases"])
def update_case_review(case_id: str, body: ReviewRequest) -> dict[str, Any]:
    try:
        case = db.update_review(
            case_id, body.status.value, body.reviewer.strip(), body.note.strip(),
            outcome=body.outcome.value if body.outcome else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")
    case["review_history"] = db.review_history(case_id)
    from .security import trace_for, related
    case["trace"] = trace_for(case)
    case["related_security_events"] = related(case)
    return case


@app.get("/api/cases/{case_id}/audit", tags=["cases"])
def verify_case_audit(case_id: str) -> dict[str, Any]:
    result = db.verify_review_chain(case_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Case not found")
    return result


@app.get("/api/analytics/review-outcomes", tags=["analytics"])
def analytics_review_outcomes() -> dict[str, Any]:
    return db.review_outcome_summary()


@app.get("/api/evaluation/summary", tags=["evaluation"])
def evaluation_summary(source_kind: str | None = Query(default=None, pattern="^(synthetic_fixture|uploaded_csv)$")) -> dict[str, Any]:
    from .provenance import summary
    return summary(source_kind)


from .extensions_api import router
app.include_router(router)

# Same-origin UI assets; CORS remains allowlisted for optional Vite development.
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
