import unittest
import uuid
from pathlib import Path
import shutil

import httpx

from src.main import create_app

TEMP_ROOT = Path("tests/.tmp")


class ExpenseApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp_directory = TEMP_ROOT / f"fenmo-{uuid.uuid4().hex}"
        self.temp_directory.mkdir(parents=True, exist_ok=True)
        data_file = self.temp_directory / "expenses.json"
        self.app = create_app(data_file=data_file)
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.app),
            base_url="http://testserver",
        )

    async def asyncTearDown(self):
        await self.client.aclose()
        shutil.rmtree(self.temp_directory, ignore_errors=True)

    async def test_post_expenses_creates_and_get_expenses_supports_sorting_and_filtering(self):
        first_expense = {
            "amount": "899.50",
            "category": "Groceries",
            "description": "Weekly produce",
            "date": "2026-04-01",
        }
        second_expense = {
            "amount": "1200.00",
            "category": "Travel",
            "description": "Metro card top-up",
            "date": "2026-04-05",
        }

        first_create_response = await self.post_expense(first_expense, "create-first")
        second_create_response = await self.post_expense(second_expense, "create-second")

        self.assertEqual(first_create_response.status_code, 201)
        self.assertEqual(second_create_response.status_code, 201)

        sorted_response = await self.client.get("/expenses?sort=date_desc")
        sorted_payload = sorted_response.json()

        self.assertEqual(sorted_response.status_code, 200)
        self.assertEqual(len(sorted_payload["expenses"]), 2)
        self.assertEqual(sorted_payload["expenses"][0]["category"], "Travel")
        self.assertEqual(sorted_payload["expenses"][1]["category"], "Groceries")
        self.assertEqual(sorted_payload["total_amount"], "2099.50")

        filtered_response = await self.client.get("/expenses?category=Groceries&sort=date_desc")
        filtered_payload = filtered_response.json()

        self.assertEqual(filtered_response.status_code, 200)
        self.assertEqual(len(filtered_payload["expenses"]), 1)
        self.assertEqual(filtered_payload["expenses"][0]["description"], "Weekly produce")
        self.assertEqual(filtered_payload["available_categories"], ["Groceries", "Travel"])
        self.assertEqual(filtered_payload["total_amount"], "899.50")

    async def test_post_expenses_replays_safely_when_the_same_idempotency_key_is_retried(self):
        payload = {
            "amount": "510.00",
            "category": "Dining",
            "description": "Lunch with team",
            "date": "2026-04-03",
        }

        first_response = await self.post_expense(payload, "same-request")
        first_body = first_response.json()
        second_response = await self.post_expense(payload, "same-request")
        second_body = second_response.json()
        list_response = await self.client.get("/expenses?sort=date_desc")
        list_body = list_response.json()

        self.assertEqual(first_response.status_code, 201)
        self.assertEqual(second_response.status_code, 200)
        self.assertEqual(first_body["expense"]["id"], second_body["expense"]["id"])
        self.assertTrue(second_body["replayed"])
        self.assertEqual(len(list_body["expenses"]), 1)

    async def test_post_expenses_rejects_invalid_data_and_conflicting_idempotency_reuse(self):
        invalid_response = await self.post_expense(
            {
                "amount": "-12.00",
                "category": "Bills",
                "description": "Late fee",
                "date": "2026-04-02",
            },
            "invalid-expense",
        )

        valid_response = await self.post_expense(
            {
                "amount": "12.00",
                "category": "Bills",
                "description": "Late fee",
                "date": "2026-04-02",
            },
            "conflicting-key",
        )

        conflicting_response = await self.post_expense(
            {
                "amount": "15.00",
                "category": "Bills",
                "description": "Different payload",
                "date": "2026-04-02",
            },
            "conflicting-key",
        )

        self.assertEqual(invalid_response.status_code, 400)
        self.assertEqual(valid_response.status_code, 201)
        self.assertEqual(conflicting_response.status_code, 409)

    async def post_expense(self, payload, idempotency_key):
        return await self.client.post(
            "/expenses",
            headers={"Content-Type": "application/json", "Idempotency-Key": idempotency_key},
            json=payload,
        )
