import unittest
from types import SimpleNamespace
from unittest.mock import patch

from backend.app.generation_service import MusicGenerationService, UserGenerationContext


class GenerationResolutionTests(unittest.TestCase):
    def _context(self) -> UserGenerationContext:
        return UserGenerationContext(
            library_tracks=[],
            app_playlists=[],
            app_state={},
            taste_profile=None,
            provider="openrouter",
            api_key="test-key",
            model="test-model",
        )

    def test_unresolved_picks_are_recorded_and_refilled(self) -> None:
        service = MusicGenerationService(db=None, base_url="https://example.com")  # type: ignore[arg-type]
        first_response = SimpleNamespace(
            data={
                "recommendations": [
                    {"artist": "Missing Artist", "title": "Missing One", "reason": "fits"},
                    {"artist": "Good Artist", "title": "Good One", "reason": "fits"},
                ]
            }
        )
        refill_response = SimpleNamespace(
            data={
                "recommendations": [
                    {"artist": "Replacement Artist", "title": "Replacement One", "reason": "fills the gap"},
                ]
            }
        )

        def search_tracks(query: str, _limit: int) -> list[dict]:
            if "Missing Artist Missing One" in query:
                return []
            if "Good Artist Good One" in query:
                return [{"id": "tidal-good", "providerTrackId": "good", "artist": "Good Artist", "title": "Good One"}]
            if "Replacement Artist Replacement One" in query:
                return [{"id": "tidal-replacement", "providerTrackId": "replacement", "artist": "Replacement Artist", "title": "Replacement One"}]
            return []

        with (
            patch("backend.app.generation_service.run_llm_task", side_effect=[first_response, refill_response]) as run_llm,
            patch("backend.app.generation_service.tidal_manager.search_tracks", side_effect=search_tracks),
        ):
            resolved, unresolved = service._resolve_recommendations_with_refills(
                context=self._context(),
                library_tracks=[],
                instruction="Build a short playlist.",
                tail="Seed",
                prefix="",
                count=2,
            )

        self.assertEqual(run_llm.call_count, 2)
        self.assertEqual([track["id"] for track in resolved], ["tidal-good", "tidal-replacement"])
        self.assertEqual(len(unresolved), 1)
        self.assertEqual(unresolved[0]["artist"], "Missing Artist")
        self.assertEqual(unresolved[0]["title"], "Missing One")
        self.assertEqual(unresolved[0]["reason"], "no_candidates")
        self.assertEqual(unresolved[0]["round"], 1)


if __name__ == "__main__":
    unittest.main()
