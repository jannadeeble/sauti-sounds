import unittest
from unittest.mock import patch

from fastapi import HTTPException

from backend.app import llm_runner
from backend.app.llm_runner import LLMExecutionResult, parse_structured_output, run_llm_task
from backend.app.schemas import LLMChatRequest


class StructuredParsingTests(unittest.TestCase):
    def test_parse_recommendations_accepts_fenced_json(self) -> None:
        parsed = parse_structured_output(
            "recommendations",
            """```json
{"recommendations":[{"artist":"Burna Boy","title":"Last Last","reason":"Fits the energy"}]}
```""",
        )
        self.assertEqual(
            parsed,
            {
                "recommendations": [
                    {
                        "artist": "Burna Boy",
                        "title": "Last Last",
                        "reason": "Fits the energy",
                    }
                ]
            },
        )

    def test_parse_recommendations_accepts_prefixed_text(self) -> None:
        parsed = parse_structured_output(
            "recommendations",
            'Here you go: {"recommendations":[{"artist":"Tems","title":"Free Mind","reason":"Same lane"}]} Thanks.',
        )
        self.assertEqual(parsed["recommendations"][0]["artist"], "Tems")

    def test_parse_recommendations_rejects_truncated_json(self) -> None:
        with self.assertRaises(Exception):
            parse_structured_output(
                "recommendations",
                '{"recommendations":[{"artist":"Amaarae","title":"SAD GIRLZ LUV MONEY","reason":"Close vibe"}]',
            )

    def test_validate_taste_profile_normalizes_shape(self) -> None:
        parsed = parse_structured_output(
            "taste-profile",
            '{"coreIdentity":"Selector","energyPreference":{"sweet_spot":0.7},"primaryGenres":["afrobeats"]}',
        )
        self.assertEqual(parsed["coreIdentity"], "Selector")
        self.assertEqual(parsed["energyPreference"]["sweet_spot"], 0.7)
        self.assertEqual(parsed["energyPreference"]["min"], 0.2)


class StructuredRepairTests(unittest.TestCase):
    def _payload(self) -> LLMChatRequest:
        return LLMChatRequest(
            provider="openrouter",
            apiKey="test-key",
            model="anthropic/claude-sonnet-4.6",
            messages=[{"role": "user", "content": "Recommend tracks"}],
            maxTokens=512,
            taskType="recommendations",
            responseMode="json_object",
            useRouteEnhancements=False,
        )

    def test_run_llm_task_repairs_invalid_json_once(self) -> None:
        broken = LLMExecutionResult(
            text='{"recommendations":[{"artist":"Tems","title":"Higher","reason":"Lift"}',
            finish_reason="stop",
            raw_data={},
        )
        repaired = LLMExecutionResult(
            text='{"recommendations":[{"artist":"Tems","title":"Higher","reason":"Lift"}]}',
            finish_reason="stop",
            raw_data={},
        )
        with patch.object(llm_runner, "_execute_provider", side_effect=[broken, repaired]) as mocked:
            result = run_llm_task(self._payload(), "https://example.com")

        self.assertEqual(mocked.call_count, 2)
        self.assertEqual(
            result.data,
            {
                "recommendations": [
                    {"artist": "Tems", "title": "Higher", "reason": "Lift"},
                ]
            },
        )

    def test_run_llm_task_raises_when_repair_fails(self) -> None:
        broken = LLMExecutionResult(
            text='{"recommendations":[{"artist":"Tems"',
            finish_reason="length",
            raw_data={},
        )
        still_broken = LLMExecutionResult(
            text="not json",
            finish_reason="stop",
            raw_data={},
        )
        with patch.object(llm_runner, "_execute_provider", side_effect=[broken, still_broken]):
            with self.assertRaises(HTTPException) as context:
                run_llm_task(self._payload(), "https://example.com")

        self.assertIn("repair failed", str(context.exception.detail).lower())


if __name__ == "__main__":
    unittest.main()
