# Expense Tracker

A minimal full-stack expense tracker built for the assignment. It includes:

- `POST /expenses` to create expenses
- `GET /expenses` to list, filter, and sort expenses
- A simple browser UI for adding and reviewing expenses
- Retry-safe submissions using idempotency keys
- JSON-file persistence and automated API tests

## Setup

```bash
pip install -r requirements.txt
```

## Run locally

```bash
python main.py
```

Then open `http://localhost:3000`.

## Run tests

```bash
python -m unittest discover -s tests -p "test_*.py"
```

## API

### `POST /expenses`

Creates a new expense.

Request body:

```json
{
  "amount": "1250.00",
  "category": "Groceries",
  "description": "Weekly produce",
  "date": "2026-04-01"
}
```

Recommended header for retry-safe behavior:

```text
Idempotency-Key: <unique-client-generated-key>
```

The frontend generates and reuses this key automatically, so repeated submits or page-refresh retries do not create duplicates.

### `GET /expenses`

Optional query parameters:

- `category`
- `sort=date_desc`

Example:

```text
/expenses?category=Groceries&sort=date_desc
```

## Persistence choice

I kept a JSON file (`data/expenses.json`) as the persistence layer because it is easy to inspect during review, requires no database setup, and is enough to demonstrate durability across refreshes and app restarts in a small assignment.

Internally, money is stored in minor units as integers to avoid floating-point issues. The API accepts and returns human-readable decimal strings such as `"1250.00"`.

## Key design decisions

- Used FastAPI to keep the backend simple to explain while still serving both the API and static frontend from one app.
- Stored money as integer minor units internally for correctness.
- Added idempotency-key support on `POST /expenses` to handle retries safely without collapsing legitimate duplicate expenses.
- Persisted unfinished browser submissions in `localStorage` so a refresh after submit can safely retry the same request.
- Kept query behavior explicit: category filtering is exact, and date sorting is enabled through `sort=date_desc`.

## Trade-offs because of the timebox

- I kept JSON-file persistence instead of moving to SQLite so the migration stayed focused on API behavior and resilience.
- The JSON-file store is not intended for multi-process production workloads; a production version would likely move idempotency tracking and expenses into a database.
- I added API-level tests, but not full browser automation.

## Intentionally not done

- Authentication and user accounts
- Editing or deleting expenses
- Pagination
- Rich analytics beyond the visible-list total
- Full production deployment configuration

## Notes on realistic behavior

- Duplicate clicks are safe because the frontend reuses the same idempotency key while a submission is unresolved.
- Refresh-after-submit is safe because the unfinished request is persisted locally and replayed on reload.
- Slow or failed API responses surface loading and error states in the UI, while preserving the pending request for safe retry.
