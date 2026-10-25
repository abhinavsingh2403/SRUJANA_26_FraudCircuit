# syntax=docker/dockerfile:1
# Multi-stage Dockerfile for TraceGuard Enterprise Deployment on Render

# --- Stage 1: Build Frontend Assets ---
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm install

COPY frontend/ ./
RUN npm run build

# --- Stage 2: Production Python Runtime ---
FROM python:3.12-slim AS runner
WORKDIR /app

# Install security certificates & curl for health checks
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Python production dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source
COPY . /app

# Ensure built frontend assets are placed in both frontend and backend static directories
COPY --from=frontend-builder /app/frontend /app/frontend
COPY --from=frontend-builder /app/backend/traceguard/static /app/backend/traceguard/static

# Environment settings
ENV PYTHONPATH=/app/backend
ENV PORT=10000
ENV HOST=0.0.0.0
ENV PYTHONUNBUFFERED=1

EXPOSE 10000

# Health check endpoint for container orchestrators
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://127.0.0.1:${PORT}/health || exit 1

# Start uvicorn via root app.py entrypoint
CMD ["python", "app.py"]
