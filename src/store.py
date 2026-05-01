import hashlib
import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .money import format_minor_units


def create_default_state():
    return {"expenses": [], "idempotencyKeys": {}}


# Tie each idempotency key to the logical request body so conflicting retries can be rejected.
def create_request_hash(expense_input):
    payload = json.dumps(
        {
            "amount": expense_input["amount"],
            "category": expense_input["category"],
            "description": expense_input["description"],
            "date": expense_input["date"],
        },
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# Sort newest dates first and fall back to creation time for same-day expenses.
def sort_key(expense):
    return expense["date"], expense["createdAt"]


def to_public_expense(expense):
    return {
        "id": expense["id"],
        "amount": format_minor_units(expense["amountMinor"]),
        "category": expense["category"],
        "description": expense["description"],
        "date": expense["date"],
        "created_at": expense["createdAt"],
    }


def normalize_loaded_state(parsed_state):
    if not isinstance(parsed_state, dict):
        return create_default_state()

    expenses = parsed_state.get("expenses")
    idempotency_keys = parsed_state.get("idempotencyKeys")

    return {
        "expenses": expenses if isinstance(expenses, list) else [],
        "idempotencyKeys": idempotency_keys if isinstance(idempotency_keys, dict) else {},
    }


# Keep a small in-memory view for reads and persist to disk after every mutation.
class ExpenseStore:
    def __init__(self, file_path):
        self.file_path = Path(file_path)
        self.lock = threading.RLock()
        self.state = create_default_state()
        self.initialize()

    # Return the visible expense list, total, and filter options used by the UI.
    def get_expense_view(self, user_identity, category="", sort=""):
        with self.lock:
            all_expenses = [
                expense
                for expense in self.state["expenses"]
                if expense.get("ownerId") == user_identity["id"]
            ]
            normalized_category = category.strip().lower()

            if normalized_category:
                filtered_expenses = [
                    expense
                    for expense in all_expenses
                    if expense["category"].lower() == normalized_category
                ]
            else:
                filtered_expenses = all_expenses

            if sort == "date_desc":
                filtered_expenses.sort(key=sort_key, reverse=True)

            total_minor_units = sum(expense["amountMinor"] for expense in filtered_expenses)
            available_categories = sorted({expense["category"] for expense in all_expenses})

            return {
                "expenses": [to_public_expense(expense) for expense in filtered_expenses],
                "totalAmount": format_minor_units(total_minor_units),
                "availableCategories": available_categories,
            }

    # Create a new expense once, or replay the original result when the same request is retried.
    def create_expense(self, expense_input, user_identity, idempotency_key=None):
        with self.lock:
            request_hash = create_request_hash(expense_input)
            scoped_idempotency_key = (
                f"{user_identity['id']}::{idempotency_key}" if idempotency_key else None
            )

            if scoped_idempotency_key:
                previous_result = self.state["idempotencyKeys"].get(scoped_idempotency_key)

                if previous_result:
                    if previous_result["requestHash"] != request_hash:
                        return {"conflict": True, "created": False, "expense": None}

                    existing_expense = next(
                        (
                            expense
                            for expense in self.state["expenses"]
                            if expense["id"] == previous_result["expenseId"]
                        ),
                        None,
                    )

                    return {
                        "conflict": False,
                        "created": False,
                        "expense": to_public_expense(existing_expense) if existing_expense else None,
                    }

            new_expense = {
                "id": str(uuid.uuid4()),
                "amountMinor": expense_input["amountMinor"],
                "category": expense_input["category"],
                "description": expense_input["description"],
                "date": expense_input["date"],
                "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "ownerId": user_identity["id"],
                "ownerName": user_identity["name"],
            }

            self.state["expenses"].append(new_expense)

            if scoped_idempotency_key:
                self.state["idempotencyKeys"][scoped_idempotency_key] = {
                    "expenseId": new_expense["id"],
                    "requestHash": request_hash,
                    "createdAt": new_expense["createdAt"],
                }

            self.persist()

            return {
                "conflict": False,
                "created": True,
                "expense": to_public_expense(new_expense),
            }

    # Load persisted state on startup and create the backing file on first run.
    def initialize(self):
        self.file_path.parent.mkdir(parents=True, exist_ok=True)

        if self.file_path.exists():
            with self.file_path.open("r", encoding="utf-8") as file:
                self.state = normalize_loaded_state(json.load(file))
            return

        self.state = create_default_state()
        self.persist()

    # Persist through an atomic file replacement so interrupted writes do not leave partial JSON.
    def persist(self):
        temp_file_path = self.file_path.with_suffix(f"{self.file_path.suffix}.tmp")

        with temp_file_path.open("w", encoding="utf-8") as file:
            json.dump(self.state, file, indent=2)

        temp_file_path.replace(self.file_path)
