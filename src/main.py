import json
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .store import ExpenseStore
from .validation import (
    AppValidationError,
    get_idempotency_key,
    get_user_identity,
    normalize_expense_input,
)

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_FILE = BASE_DIR / "data" / "expenses.json"
PUBLIC_DIR = BASE_DIR / "public"
MAX_BODY_BYTES = 1024 * 1024


# Build one FastAPI app that serves both the expense API and the static frontend.
def create_app(data_file=DATA_FILE, public_directory=PUBLIC_DIR):
    app = FastAPI(title="Expense Tracker")
    app.state.store = ExpenseStore(data_file)

    @app.exception_handler(AppValidationError)
    async def handle_validation_error(_request, error):
        return JSONResponse(status_code=error.status_code, content={"error": str(error)})

    @app.get("/health")
    async def get_health():
        return {"ok": True}

    # Build the visible expense list from optional category and sort query parameters.
    @app.get("/expenses")
    async def get_expenses(request: Request, category: str = "", sort: str = ""):
        user_identity = resolve_user_identity(request)

        if sort and sort != "date_desc":
            raise AppValidationError("sort must be omitted or set to date_desc.")

        expense_view = app.state.store.get_expense_view(
            user_identity=user_identity, category=category, sort=sort
        )

        return {
            "expenses": expense_view["expenses"],
            "total_amount": expense_view["totalAmount"],
            "available_categories": expense_view["availableCategories"],
            "current_user": {"name": user_identity["name"]},
        }

    # Validate the incoming expense and let the store enforce retry-safe creation.
    @app.post("/expenses")
    async def create_expense(request: Request):
        user_identity = resolve_user_identity(request)
        idempotency_key = get_idempotency_key(request.headers.get("Idempotency-Key"))
        payload = await read_json_body(request)
        normalized_expense = normalize_expense_input(payload)
        result = app.state.store.create_expense(
            normalized_expense, user_identity=user_identity, idempotency_key=idempotency_key
        )

        if result["conflict"]:
            return JSONResponse(
                status_code=409,
                content={
                    "error": "This Idempotency-Key was already used for a different expense."
                },
            )

        if not result["expense"]:
            raise RuntimeError("The idempotent replay could not locate the original expense.")

        status_code = 201 if result["created"] else 200
        return JSONResponse(
            status_code=status_code,
            content={
                "expense": result["expense"],
                "replayed": not result["created"],
                "current_user": {"name": user_identity["name"]},
            },
        )

    app.mount("/", StaticFiles(directory=str(public_directory), html=True), name="static")

    return app


# Read the raw request body once and fail fast on oversized or invalid JSON payloads.
async def read_json_body(request: Request):
    raw_body = await request.body()

    if not raw_body:
        raise AppValidationError("Request body is required.")

    if len(raw_body) > MAX_BODY_BYTES:
        raise AppValidationError("Request body is too large.", 413)

    try:
        return json.loads(raw_body)
    except json.JSONDecodeError as error:
        raise AppValidationError("Request body must contain valid JSON.") from error


def resolve_user_identity(request: Request):
    raw_user_name = request.headers.get("X-User-Name") or request.cookies.get("fenmo_user_name")
    return get_user_identity(raw_user_name)


app = create_app()
