import os

# Render passes the listening port via $PORT
port = os.environ.get("PORT", "10000")
bind = f"0.0.0.0:{port}"

# Crucial for FastAPI ASGI: run with uvicorn worker, not sync worker
worker_class = "uvicorn.workers.UvicornWorker"
workers = 1
timeout = 120
keepalive = 5
