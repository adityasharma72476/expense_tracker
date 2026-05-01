import re
from datetime import date

from .money import format_minor_units, parse_amount_to_minor_units

DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class AppValidationError(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.status_code = status_code


# Normalize request data into the consistent internal shape used by the store.
def normalize_expense_input(payload):
    if not isinstance(payload, dict):
        raise AppValidationError("Request body must be a JSON object.")

    try:
        amount_minor = parse_amount_to_minor_units(payload.get("amount"))
    except ValueError as error:
        raise AppValidationError(str(error)) from error

    category = require_string(payload.get("category"), "Category", 50)
    description = require_string(payload.get("description"), "Description", 200)
    expense_date = require_string(payload.get("date"), "Date", 10)

    if not is_valid_date(expense_date):
        raise AppValidationError("Date must be a valid ISO date in YYYY-MM-DD format.")

    return {
        "amount": format_minor_units(amount_minor),
        "amountMinor": amount_minor,
        "category": category,
        "description": description,
        "date": expense_date,
    }


# Accept a client-supplied idempotency key so retries can safely reuse the original creation result.
def get_idempotency_key(raw_value):
    if raw_value is None:
        return None

    normalized_value = str(raw_value).strip()

    if not normalized_value:
        return None

    if len(normalized_value) > 200:
        raise AppValidationError("Idempotency-Key must be 200 characters or fewer.")

    return normalized_value


# Treat a simple user name as the lightweight identity used to keep expenses separated per person.
def get_user_identity(raw_value):
    if not isinstance(raw_value, str) or not raw_value.strip():
        raise AppValidationError("Sign in with a name to continue.", 401)

    user_name = require_string(raw_value, "User name", 50)
    normalized_name = " ".join(user_name.split())

    return {"id": normalized_name.casefold(), "name": normalized_name}


def require_string(raw_value, label, max_length):
    if not isinstance(raw_value, str):
        raise AppValidationError(f"{label} is required.")

    normalized_value = raw_value.strip()

    if not normalized_value:
        raise AppValidationError(f"{label} is required.")

    if len(normalized_value) > max_length:
        raise AppValidationError(f"{label} must be {max_length} characters or fewer.")

    return normalized_value


def is_valid_date(value):
    if not DATE_PATTERN.fullmatch(value):
        return False

    try:
        date.fromisoformat(value)
    except ValueError:
        return False

    return True
