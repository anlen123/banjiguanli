"""Disposable E2E server. Never uses or seeds the real application database."""

import os
import tempfile

if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="class-island-e2e-") as directory:
        os.environ["DATA_DIR"] = directory
        os.environ["APP_ORIGIN"] = "http://127.0.0.1:5179"
        os.environ["COOKIE_SECURE"] = "false"
        import app
        import uvicorn

        app.create_admin("admin", "林班长", "e2e-admin-password")
        uvicorn.run(app.app, host="127.0.0.1", port=8019)
