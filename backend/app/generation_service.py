from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
import json
import threading
import time
import uuid
from typing import Any, Callable

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import GenerationRun, LibraryPlaylist, LibraryTrack, SessionLocal, UserAppStateSnapshot
from .llm_runner import run_llm_task
from .schemas import GenerationPlaylistRequest, LLMChatRequest
from .tidal_service import tidal_manager

FRESH_TTL_MS = 1000 * 60 * 60 * 24 * 2
ACCEPT_SCORE = 0.82
REJECT_SCORE = 0.55


class GenerationFailure(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class UserGenerationContext:
    library_tracks: list[dict[str, Any]]
    app_playlists: list[dict[str, Any]]
    taste_profile: dict[str, Any] | None
    provider: str
    api_key: str
    model: str | None


def _normalize(value: str) -> str:
    return "".join(char for char in value.lower() if char.isalnum())


def _tokenize(value: str) -> list[str]:
    token = []
    normalized = value.lower()
    tokens: list[str] = []
    for char in normalized:
        if char.isalnum():
            token.append(char)
        elif token:
            tokens.append("".join(token))
            token = []
    if token:
        tokens.append("".join(token))
    return tokens


def _levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    curr = [0] * (len(b) + 1)
    for i in range(1, len(a) + 1):
        curr[0] = i
        for j in range(1, len(b) + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            curr[j] = min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
        prev, curr = curr, prev
    return prev[len(b)]


def _levenshtein_ratio(a: str, b: str) -> float:
    if not a and not b:
        return 1.0
    max_len = max(len(a), len(b))
    if max_len == 0:
        return 1.0
    return 1 - (_levenshtein(a, b) / max_len)


def _token_set_similarity(a: str, b: str) -> float:
    set_a = set(_tokenize(a))
    set_b = set(_tokenize(b))
    if not set_a and not set_b:
        return 1.0
    inter = len(set_a & set_b)
    return (2 * inter) / (len(set_a) + len(set_b))


def _has_qualifier(value: str) -> bool:
    lowered = value.lower()
    return any(
        qualifier in lowered
        for qualifier in ("live", "karaoke", "cover", "remix", "edit", "version", "remaster", "acoustic", "instrumental")
    )


def _mix_id(kind: str) -> str:
    return f"mix-{kind}-{int(time.time() * 1000)}-{uuid.uuid4().hex[:4]}"


def _now_envelope() -> dict[str, int]:
    generated_at = int(time.time() * 1000)
    return {"generatedAt": generated_at, "expiresAt": generated_at + FRESH_TTL_MS}


def _read_library_tracks(db: Session, user_id: str) -> list[dict[str, Any]]:
    rows = db.scalars(
        select(LibraryTrack).where(LibraryTrack.user_id == user_id).order_by(LibraryTrack.updated_at.desc())
    ).all()
    return [json.loads(row.payload) for row in rows]


def _read_library_playlists(db: Session, user_id: str) -> list[dict[str, Any]]:
    rows = db.scalars(
        select(LibraryPlaylist).where(LibraryPlaylist.user_id == user_id).order_by(LibraryPlaylist.updated_at.desc())
    ).all()
    return [json.loads(row.payload) for row in rows]


def _read_app_state_payload(db: Session, user_id: str) -> dict[str, Any]:
    row = db.get(UserAppStateSnapshot, user_id)
    if row is None:
        return {
            "notifications": [],
            "history": [],
            "listenEvents": [],
            "mixes": [],
            "tasteProfile": None,
            "settings": {},
            "ui": {},
        }
    return json.loads(row.payload)


def _write_app_state_payload(db: Session, user_id: str, payload: dict[str, Any]) -> None:
    now = int(time.time() * 1000)
    row = db.get(UserAppStateSnapshot, user_id)
    encoded = json.dumps(payload)
    if row is None:
        row = UserAppStateSnapshot(user_id=user_id, payload=encoded, updated_at=now)
        db.add(row)
    else:
        row.payload = encoded
        row.updated_at = now
    db.commit()


def _write_library_snapshot(
    db: Session,
    user_id: str,
    tracks: list[dict[str, Any]],
    playlists: list[dict[str, Any]],
) -> None:
    now = int(time.time() * 1000)
    db.query(LibraryTrack).filter(LibraryTrack.user_id == user_id).delete()
    db.query(LibraryPlaylist).filter(LibraryPlaylist.user_id == user_id).delete()
    db.add_all(
        [
            LibraryTrack(
                user_id=user_id,
                id=str(track["id"]),
                payload=json.dumps(track),
                updated_at=int(track.get("addedAt") or now),
            )
            for track in tracks
        ]
    )
    db.add_all(
        [
            LibraryPlaylist(
                user_id=user_id,
                id=str(playlist["id"]),
                payload=json.dumps(playlist),
                updated_at=int(playlist.get("updatedAt") or now),
            )
            for playlist in playlists
        ]
    )
    db.commit()


def _create_generated_playlist(name: str, description: str, mix_id: str, prompt: str) -> dict[str, Any]:
    now = int(time.time() * 1000)
    return {
        "id": f"app-{now}-{uuid.uuid4().hex[:6]}",
        "name": name,
        "description": description,
        "items": [],
        "createdAt": now,
        "updatedAt": now,
        "kind": "app",
        "writable": True,
        "trackCount": 0,
        "origin": "generated",
        "generatedFromMixId": mix_id,
        "generatedPrompt": prompt,
    }


def _track_to_playlist_item(track: dict[str, Any]) -> dict[str, Any]:
    provider_track_id = track.get("providerTrackId")
    if track.get("source") == "tidal" and isinstance(provider_track_id, str) and provider_track_id:
        return {"source": "tidal", "providerTrackId": provider_track_id}
    return {"source": "local", "trackId": str(track["id"])}


class MusicGenerationService:
    def __init__(self, db: Session, *, base_url: str) -> None:
        self.db = db
        self.base_url = base_url

    def _load_context(self, user_id: str) -> UserGenerationContext:
        app_state = _read_app_state_payload(self.db, user_id)
        settings = app_state.get("settings") or {}
        provider = settings.get("llmProvider")
        api_key = settings.get("llmApiKey")
        if not isinstance(provider, str) or not provider or not isinstance(api_key, str) or not api_key:
            raise GenerationFailure("provider_unconfigured", "Configure an AI provider in Settings before generating playlists.")
        return UserGenerationContext(
            library_tracks=_read_library_tracks(self.db, user_id),
            app_playlists=[playlist for playlist in _read_library_playlists(self.db, user_id) if playlist.get("kind") == "app"],
            taste_profile=app_state.get("tasteProfile") if isinstance(app_state.get("tasteProfile"), dict) else None,
            provider=provider,
            api_key=api_key,
            model=settings.get("llmModel") if isinstance(settings.get("llmModel"), str) and settings.get("llmModel") else None,
        )

    def _build_suggestion_context(
        self,
        library_tracks: list[dict[str, Any]],
        taste_profile: dict[str, Any] | None,
        seed_label: str,
        seed_body: str,
        include_profile: bool = True,
    ) -> tuple[str, str]:
        sample_size = 150
        sorted_tracks = sorted(
            library_tracks,
            key=lambda track: (
                0 if isinstance(track.get("tags"), dict) else 1,
                -(int(track.get("addedAt") or 0)),
            ),
        )
        sample = sorted_tracks[:sample_size]
        parts: list[str] = []
        if include_profile and taste_profile:
            parts.extend(
                [
                    "## Taste profile",
                    f"- Identity: {taste_profile.get('coreIdentity', 'Music enthusiast')}",
                    f"- Primary genres: {', '.join(str(item) for item in taste_profile.get('primaryGenres', []))}",
                    (
                        f"- Energy sweet spot: "
                        f"{(taste_profile.get('energyPreference') or {}).get('sweet_spot', 0.5)} "
                        f"(range {(taste_profile.get('energyPreference') or {}).get('min', 0.2)}-"
                        f"{(taste_profile.get('energyPreference') or {}).get('max', 0.8)})"
                    ),
                    f"- Cultural markers: {', '.join(str(item) for item in taste_profile.get('culturalMarkers', []))}",
                    f"- Favorite artists: {', '.join(str(item) for item in taste_profile.get('favoriteArtists', []))}",
                    f"- Mood preferences: {', '.join(str(item) for item in taste_profile.get('moodPreferences', []))}",
                    f"- Avoids: {', '.join(str(item) for item in taste_profile.get('antiPreferences', []))}",
                ]
            )
        if sample:
            library_lines = [f'## Library sample ({len(sample)} of {len(library_tracks)} tracks; library is a taste signal — recommendations should expand it, not repeat it)']
            for track in sample:
                tags = track.get("tags") if isinstance(track.get("tags"), dict) else None
                tag_list = []
                if tags:
                    mood = tags.get("mood")
                    if isinstance(mood, str) and mood:
                        tag_list.append(mood)
                    genres = tags.get("genres")
                    if isinstance(genres, list):
                        tag_list.extend(str(item) for item in genres[:4])
                    vibes = tags.get("vibeDescriptors")
                    if isinstance(vibes, list):
                        remaining = max(0, 4 - len(tag_list))
                        tag_list.extend(str(item) for item in vibes[:remaining])
                suffix = f" [{', '.join(tag_list[:4])}]" if tag_list else ""
                library_lines.append(f'- "{track.get("title", "Unknown")}" — {track.get("artist", "Unknown")}{suffix}')
            parts.append("\n".join(library_lines))
        prefix = "\n\n".join(part for part in parts if part)
        tail = f"{seed_label}\n{seed_body}"
        return prefix, tail

    def _make_llm_payload(
        self,
        context: UserGenerationContext,
        *,
        task_type: str,
        instruction: str,
        tail: str,
        prefix: str,
        max_tokens: int,
    ) -> LLMChatRequest:
        system_prompt = (
            "You are an expert music curator and DJ. You deeply understand musical flow, energy, mood, genre, and cultural context.\n\n"
            'Always respond with a valid JSON object shaped like {"recommendations":[{"artist":"...","title":"...","reason":"..."}]}. '
            "No markdown, no explanation outside the JSON."
        )
        return LLMChatRequest(
            provider=context.provider,
            apiKey=context.api_key,
            model=context.model,
            messages=[
                {"role": "user", "content": f"{instruction}\n\n{tail}"},
            ],
            maxTokens=max_tokens,
            thinkingBudget=0,
            systemBlocks=[
                {"type": "text", "text": system_prompt},
                {"type": "text", "text": prefix},
            ],
            taskType=task_type,
            responseMode="json_object",
            useRouteEnhancements=False,
            temperature=0,
        )

    def _resolve_recommendations(
        self,
        recommendations: list[dict[str, str]],
        library_tracks: list[dict[str, Any]],
        context: UserGenerationContext,
    ) -> tuple[list[dict[str, Any]], int]:
        exclude_ids = {
            str(value)
            for track in library_tracks
            for value in (track.get("id"), track.get("providerTrackId"))
            if value
        }
        resolved: list[dict[str, Any]] = []
        vetoed = 0
        search_failures = 0

        for recommendation in recommendations:
            wanted_artist = recommendation["artist"]
            wanted_title = recommendation["title"]
            try:
                search = tidal_manager.search_tracks(f"{wanted_artist} {wanted_title}", 5)
                candidates = [track for track in search if track.get("id") not in exclude_ids]
            except Exception:
                search_failures += 1
                candidates = []
            if not candidates:
                vetoed += 1
                continue
            scored: list[tuple[float, dict[str, Any]]] = []
            for candidate in candidates:
                title_sim = _levenshtein_ratio(wanted_title.lower(), str(candidate.get("title", "")).lower())
                artist_sim = _token_set_similarity(wanted_artist, str(candidate.get("artist", "")))
                score = (title_sim * 0.6) + (artist_sim * 0.4)
                if _has_qualifier(str(candidate.get("title", ""))) and not _has_qualifier(wanted_title):
                    score -= 0.25
                scored.append((max(0, min(1, score)), candidate))
            scored.sort(key=lambda item: item[0], reverse=True)
            top_score, top_candidate = scored[0]
            if top_score <= REJECT_SCORE:
                vetoed += 1
                continue
            pick = top_candidate
            if REJECT_SCORE < top_score < ACCEPT_SCORE:
                adjudication_payload = LLMChatRequest(
                    provider=context.provider,
                    apiKey=context.api_key,
                    model=context.model,
                    messages=[
                        {
                            "role": "user",
                            "content": (
                                "Pick the candidate that is the best match for the wanted track. Reject if it's a clearly different track "
                                '(a cover, live version, karaoke, or different artist). Respond with strict JSON only: {"pickIndex": <number>} '
                                f'or {{"pickIndex": null}}.\n\n{json.dumps({"wanted": {"artist": wanted_artist, "title": wanted_title}, "candidates": [{"index": index, "title": candidate.get("title"), "artist": candidate.get("artist"), "album": candidate.get("album")} for index, (_, candidate) in enumerate(scored)]})}'
                            ),
                        }
                    ],
                    maxTokens=128,
                    taskType="adjudication",
                    responseMode="json_object",
                    thinkingBudget=0,
                    useRouteEnhancements=False,
                    temperature=0,
                )
                try:
                    adjudicated = run_llm_task(adjudication_payload, self.base_url)
                    pick_index = adjudicated.data.get("pickIndex") if isinstance(adjudicated.data, dict) else None
                    if isinstance(pick_index, int) and 0 <= pick_index < len(scored):
                        pick = scored[pick_index][1]
                except Exception:
                    pick = top_candidate
            exclude_ids.add(str(pick.get("id")))
            provider_track_id = pick.get("providerTrackId")
            if provider_track_id:
                exclude_ids.add(str(provider_track_id))
            resolved.append(pick)

        if search_failures == len(recommendations) and recommendations:
            raise GenerationFailure("tidal_search_failed", "TIDAL search failed while resolving AI picks. Check the backend/TIDAL connection and try again.")
        return resolved, vetoed

    def _build_blurb(self, context: UserGenerationContext, payload: dict[str, Any]) -> str:
        request = LLMChatRequest(
            provider=context.provider,
            apiKey=context.api_key,
            model=context.model or "claude-haiku-4-5-20251001",
            messages=[
                {
                    "role": "user",
                    "content": (
                        'Write a 1-2 sentence blurb for a "mood" music mix. Voice: warm, knowledgeable, conversational. '
                        f"No headers, no quotes, no markdown — just the sentences. Context:\n{json.dumps(payload)}"
                    ),
                }
            ],
            maxTokens=200,
            taskType="blurb",
            responseMode="text",
            temperature=0.4,
        )
        try:
            return run_llm_task(request, self.base_url).text.strip()
        except Exception:
            return ""

    def generate_mood_playlist(
        self,
        user_id: str,
        request: GenerationPlaylistRequest,
        on_phase_change: Callable[[str], None] | None = None,
    ) -> dict[str, Any]:
        context = self._load_context(user_id)
        prefix, tail = self._build_suggestion_context(
            context.library_tracks,
            context.taste_profile if request.use_taste else None,
            "## Mood prompt",
            request.prompt.strip(),
        )
        instruction = (
            f"Mood playlist: build a {request.count}-track playlist matching the user's prompt. "
            "Think energy flow — the opener, the build, the closer. Respect the taste profile."
        )
        llm_payload = self._make_llm_payload(
            context,
            task_type="recommendations",
            instruction=f"{instruction}\n\nReturn exactly {request.count} tracks.",
            tail=tail,
            prefix=prefix,
            max_tokens=8192,
        )
        llm_result = run_llm_task(llm_payload, self.base_url)
        data = llm_result.data if isinstance(llm_result.data, dict) else {}
        recommendations = data.get("recommendations") if isinstance(data.get("recommendations"), list) else []
        if not recommendations:
            raise GenerationFailure("provider_empty", "The AI provider returned no recommendations.")

        if on_phase_change:
            on_phase_change("resolving")
        resolved_tracks, vetoed = self._resolve_recommendations(recommendations, context.library_tracks, context)
        if not resolved_tracks:
            raise GenerationFailure("no_tracks_resolved", "Sauti generated recommendations, but none could be matched to playable tracks.")

        mix_id = _mix_id("mood-playlist")
        blurb = self._build_blurb(context, {"prompt": request.prompt, "resolvedCount": len(resolved_tracks)})
        mix = {
            "id": mix_id,
            "kind": "mood-playlist",
            "seedRef": {"type": "mood", "prompt": request.prompt},
            "title": request.prompt[:80],
            "blurb": blurb,
            "trackIds": [track["id"] for track in resolved_tracks],
            "unresolvedCount": vetoed,
            "focusPrompt": request.prompt,
            "status": "saved",
            **_now_envelope(),
        }

        playlist_name = request.title_override.strip() if isinstance(request.title_override, str) and request.title_override.strip() else mix["title"]
        playlist = _create_generated_playlist(playlist_name, blurb, mix_id, request.prompt)
        playlist["items"] = [_track_to_playlist_item(track) for track in resolved_tracks]
        playlist["trackCount"] = len(playlist["items"])
        playlist["updatedAt"] = int(time.time() * 1000)

        if on_phase_change:
            on_phase_change("saving")
        tracks_by_id = {str(track["id"]): track for track in context.library_tracks}
        for track in resolved_tracks:
            tracks_by_id[str(track["id"])] = track
        next_tracks = sorted(tracks_by_id.values(), key=lambda track: int(track.get("addedAt") or 0), reverse=True)
        next_playlists = [playlist, *[item for item in context.app_playlists if item.get("id") != playlist["id"]]]
        _write_library_snapshot(self.db, user_id, next_tracks, next_playlists)

        app_state = _read_app_state_payload(self.db, user_id)
        mixes = [mix, *[item for item in app_state.get("mixes", []) if item.get("id") != mix_id]]
        app_state["mixes"] = mixes
        _write_app_state_payload(self.db, user_id, app_state)

        return {
            "mix": mix,
            "playlist": playlist,
            "trackCount": len(resolved_tracks),
        }

    def process_generation_run(self, run_id: str) -> None:
        run = self.db.get(GenerationRun, run_id)
        if run is None:
            return
        request_payload = json.loads(run.request_payload)
        request = GenerationPlaylistRequest.model_validate(request_payload)
        run.status = "running"
        run.phase = "recommendations"
        run.attempt_count = (run.attempt_count or 0) + 1
        run.started_at = int(time.time() * 1000)
        run.updated_at = int(time.time() * 1000)
        self.db.commit()

        def set_phase(phase: str) -> None:
            run.phase = phase
            run.updated_at = int(time.time() * 1000)
            self.db.commit()

        try:
            result = self.generate_mood_playlist(run.user_id, request, on_phase_change=set_phase)
            run.status = "succeeded"
            run.phase = "saving"
            run.result_payload = json.dumps(
                {
                    "playlistId": result["playlist"]["id"],
                    "mixId": result["mix"]["id"],
                    "name": result["playlist"]["name"],
                    "blurb": result["playlist"].get("description") or result["mix"].get("blurb") or "",
                    "trackCount": result["trackCount"],
                }
            )
            run.mix_id = result["mix"]["id"]
            run.playlist_id = result["playlist"]["id"]
            run.error_code = None
            run.error_message = None
        except GenerationFailure as exc:
            run.status = "failed"
            run.error_code = exc.code
            run.error_message = exc.message
        except HTTPException as exc:
            detail = str(exc.detail)
            run.status = "failed"
            lowered = detail.lower()
            if "finish reason: length" in lowered:
                run.error_code = "provider_length_exhausted"
            elif "repair failed" in lowered:
                run.error_code = "repair_failed"
            elif "schema" in lowered or "valid json" in lowered:
                run.error_code = "schema_invalid"
            else:
                run.error_code = "provider_empty"
            run.error_message = detail
        except Exception as exc:
            run.status = "failed"
            run.error_code = "save_failed"
            run.error_message = str(exc)
        finally:
            now = int(time.time() * 1000)
            run.finished_at = now
            run.updated_at = now
            self.db.commit()


class GenerationWorker:
    def __init__(self, *, base_url: str) -> None:
        self.base_url = base_url
        self._lock = threading.Lock()
        self._active: set[str] = set()
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="generation-worker")

    def submit(self, run_id: str) -> None:
        with self._lock:
            if run_id in self._active:
                return
            self._active.add(run_id)
        self._executor.submit(self._run, run_id)

    def recover(self) -> None:
        db = SessionLocal()
        try:
            runs = db.scalars(select(GenerationRun).where(GenerationRun.status.in_(("queued", "running")))).all()
            for run in runs:
                if run.status == "running":
                    run.status = "queued"
                    run.updated_at = int(time.time() * 1000)
            db.commit()
            for run in runs:
                self.submit(run.id)
        finally:
            db.close()

    def _run(self, run_id: str) -> None:
        db = SessionLocal()
        try:
            MusicGenerationService(db, base_url=self.base_url).process_generation_run(run_id)
        finally:
            db.close()
            with self._lock:
                self._active.discard(run_id)
