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
from .schemas import GenerationCreateRequest, GenerationPlaylistRequest, LLMChatRequest
from .tidal_service import tidal_manager

FRESH_TTL_MS = 1000 * 60 * 60 * 24 * 2
ACCEPT_SCORE = 0.82
REJECT_SCORE = 0.55
MAX_RESOLUTION_PASSES = 3


class GenerationFailure(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class UserGenerationContext:
    library_tracks: list[dict[str, Any]]
    app_playlists: list[dict[str, Any]]
    app_state: dict[str, Any]
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


def _recommendation_key(recommendation: dict[str, Any]) -> str:
    artist = _normalize(str(recommendation.get("artist") or ""))
    title = _normalize(str(recommendation.get("title") or ""))
    return f"{artist}:{title}" if artist or title else ""


def _unresolved_recommendation(
    recommendation: dict[str, Any],
    reason: str,
    message: str,
    **extra: Any,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "artist": str(recommendation.get("artist") or "").strip(),
        "title": str(recommendation.get("title") or "").strip(),
        "reason": reason,
        "message": message,
    }
    payload.update({key: value for key, value in extra.items() if value is not None})
    return payload


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
            "playback": None,
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


def _find_track(tracks: list[dict[str, Any]], track_id: str | None) -> dict[str, Any] | None:
    if not track_id:
        return None
    wanted = {track_id}
    if track_id.startswith("tidal-"):
        wanted.add(track_id.removeprefix("tidal-"))
    for track in tracks:
        ids = {str(value) for value in (track.get("id"), track.get("providerTrackId")) if value}
        if wanted & ids:
            return track
    return None


def _find_playlist(playlists: list[dict[str, Any]], playlist_id: str | None) -> dict[str, Any] | None:
    if not playlist_id:
        return None
    return next((playlist for playlist in playlists if str(playlist.get("id")) == playlist_id), None)


def _resolve_playlist_tracks(playlist: dict[str, Any], tracks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id = {str(track.get("id")): track for track in tracks if track.get("id")}
    by_provider = {
        str(track.get("providerTrackId")): track
        for track in tracks
        if isinstance(track.get("providerTrackId"), str) and track.get("providerTrackId")
    }
    resolved: list[dict[str, Any]] = []
    for item in playlist.get("items") or []:
        if not isinstance(item, dict):
            continue
        if item.get("source") == "local" and item.get("trackId") in by_id:
            resolved.append(by_id[str(item.get("trackId"))])
        elif item.get("source") == "tidal" and item.get("providerTrackId") in by_provider:
            resolved.append(by_provider[str(item.get("providerTrackId"))])
    return resolved


def _mix_result_payload(mix: dict[str, Any]) -> dict[str, Any]:
    return {
        "mixId": mix["id"],
        "mix": mix,
        "trackIds": mix.get("trackIds", []),
        "trackCount": len(mix.get("trackIds", [])),
        "unresolvedCount": int(mix.get("unresolvedCount") or 0),
        "unresolvedTracks": mix.get("unresolvedTracks", []),
    }


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
            app_state=app_state,
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
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        exclude_ids = {
            str(value)
            for track in library_tracks
            for value in (track.get("id"), track.get("providerTrackId"))
            if value
        }
        resolved: list[dict[str, Any]] = []
        unresolved: list[dict[str, Any]] = []
        search_failures = 0

        for recommendation in recommendations:
            wanted_artist = str(recommendation.get("artist") or "").strip()
            wanted_title = str(recommendation.get("title") or "").strip()
            if not wanted_artist or not wanted_title:
                unresolved.append(_unresolved_recommendation(
                    recommendation,
                    "invalid_recommendation",
                    "The AI returned a recommendation without both artist and title.",
                ))
                continue
            search_error: str | None = None
            try:
                search = tidal_manager.search_tracks(f"{wanted_artist} {wanted_title}", 5)
                candidates = [track for track in search if track.get("id") not in exclude_ids]
            except Exception as exc:
                search_failures += 1
                search_error = str(exc)
                candidates = []
            if not candidates:
                reason = "tidal_search_failed" if search_error else "no_candidates"
                message = (
                    "TIDAL search failed for this recommendation."
                    if reason == "tidal_search_failed"
                    else "TIDAL returned no playable candidates outside the existing library and current mix."
                )
                unresolved.append(_unresolved_recommendation(
                    recommendation,
                    reason,
                    message,
                    error=search_error,
                ))
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
                unresolved.append(_unresolved_recommendation(
                    recommendation,
                    "low_confidence_match",
                    "The best TIDAL candidate looked too different from the AI recommendation.",
                    score=round(top_score, 3),
                    candidate={
                        "artist": top_candidate.get("artist"),
                        "title": top_candidate.get("title"),
                        "album": top_candidate.get("album"),
                    },
                ))
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
                    elif pick_index is None:
                        unresolved.append(_unresolved_recommendation(
                            recommendation,
                            "adjudication_rejected",
                            "The resolver could not confidently choose one of the TIDAL candidates.",
                            score=round(top_score, 3),
                            candidate={
                                "artist": top_candidate.get("artist"),
                                "title": top_candidate.get("title"),
                                "album": top_candidate.get("album"),
                            },
                        ))
                        continue
                except Exception:
                    pick = top_candidate
            exclude_ids.add(str(pick.get("id")))
            provider_track_id = pick.get("providerTrackId")
            if provider_track_id:
                exclude_ids.add(str(provider_track_id))
            resolved.append(pick)

        if search_failures == len(recommendations) and recommendations:
            raise GenerationFailure("tidal_search_failed", "TIDAL search failed while resolving AI picks. Check the backend/TIDAL connection and try again.")
        return resolved, unresolved

    def _request_recommendations(
        self,
        context: UserGenerationContext,
        *,
        instruction: str,
        tail: str,
        prefix: str,
        count: int,
    ) -> list[dict[str, str]]:
        llm_payload = self._make_llm_payload(
            context,
            task_type="recommendations",
            instruction=f"{instruction}\n\nReturn exactly {count} tracks.",
            tail=tail,
            prefix=prefix,
            max_tokens=8192,
        )
        llm_result = run_llm_task(llm_payload, self.base_url)
        data = llm_result.data if isinstance(llm_result.data, dict) else {}
        return data.get("recommendations") if isinstance(data.get("recommendations"), list) else []

    def _resolve_recommendations_with_refills(
        self,
        *,
        context: UserGenerationContext,
        library_tracks: list[dict[str, Any]],
        instruction: str,
        tail: str,
        prefix: str,
        count: int,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        resolved_tracks: list[dict[str, Any]] = []
        unresolved_tracks: list[dict[str, Any]] = []
        attempted_keys: set[str] = set()

        for round_index in range(MAX_RESOLUTION_PASSES):
            needed = count - len(resolved_tracks)
            if needed <= 0:
                break

            round_instruction = instruction
            if round_index > 0:
                rejected = "\n".join(
                    f'- "{item.get("title", "Unknown")}" — {item.get("artist", "Unknown")} ({item.get("reason", "unresolved")})'
                    for item in unresolved_tracks[-20:]
                )
                accepted = "\n".join(
                    f'- "{track.get("title", "Unknown")}" — {track.get("artist", "Unknown")}'
                    for track in resolved_tracks[-20:]
                )
                round_instruction = (
                    f"{instruction}\n\n"
                    f"Replacement pass: {len(unresolved_tracks)} earlier recommendation"
                    f"{'' if len(unresolved_tracks) == 1 else 's'} could not be matched to playable TIDAL tracks. "
                    f"Recommend {needed} different replacement track{'' if needed == 1 else 's'}. "
                    "Do not repeat any accepted or rejected tracks.\n\n"
                    f"Rejected tracks:\n{rejected or '- none'}\n\n"
                    f"Accepted tracks:\n{accepted or '- none'}"
                )

            recommendations = self._request_recommendations(
                context,
                instruction=round_instruction,
                tail=tail,
                prefix=prefix,
                count=needed,
            )
            if not recommendations:
                if round_index == 0:
                    raise GenerationFailure("provider_empty", "The AI provider returned no recommendations.")
                break

            unique_recommendations: list[dict[str, str]] = []
            for recommendation in recommendations:
                key = _recommendation_key(recommendation)
                if key and key in attempted_keys:
                    continue
                if key:
                    attempted_keys.add(key)
                unique_recommendations.append(recommendation)
            if not unique_recommendations:
                break

            batch_resolved, batch_unresolved = self._resolve_recommendations(
                unique_recommendations,
                [*library_tracks, *resolved_tracks],
                context,
            )
            resolved_tracks.extend(batch_resolved)
            unresolved_tracks.extend(
                {**item, "round": round_index + 1}
                for item in batch_unresolved
            )

        return resolved_tracks[:count], unresolved_tracks

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

    def _save_mix_and_tracks(
        self,
        user_id: str,
        context: UserGenerationContext,
        mix: dict[str, Any],
        resolved_tracks: list[dict[str, Any]],
    ) -> None:
        tracks_by_id = {str(track["id"]): track for track in context.library_tracks}
        for track in resolved_tracks:
            tracks_by_id[str(track["id"])] = track
        next_tracks = sorted(tracks_by_id.values(), key=lambda track: int(track.get("addedAt") or 0), reverse=True)
        _write_library_snapshot(self.db, user_id, next_tracks, context.app_playlists)

        app_state = _read_app_state_payload(self.db, user_id)
        mixes = [mix, *[item for item in app_state.get("mixes", []) if item.get("id") != mix["id"]]]
        app_state["mixes"] = mixes
        _write_app_state_payload(self.db, user_id, app_state)

    def _generate_rediscovery_mix(
        self,
        user_id: str,
        context: UserGenerationContext,
        request: GenerationCreateRequest,
    ) -> dict[str, Any]:
        count = request.count or 10
        listen_events = context.app_state.get("listenEvents") if isinstance(context.app_state.get("listenEvents"), list) else []
        history = context.app_state.get("history") if isinstance(context.app_state.get("history"), list) else []
        stats: dict[str, dict[str, int]] = {}
        for event in listen_events:
            if not isinstance(event, dict):
                continue
            track_id = event.get("trackId")
            if not isinstance(track_id, str):
                continue
            item = stats.setdefault(track_id, {"playCount": 0, "lastPlayedAt": 0})
            if event.get("completed") or int(event.get("msListened") or 0) > 30_000:
                item["playCount"] += 1
            item["lastPlayedAt"] = max(item["lastPlayedAt"], int(event.get("startedAt") or 0))
        for event in history:
            if not isinstance(event, dict):
                continue
            track_id = event.get("trackId")
            if not isinstance(track_id, str):
                continue
            item = stats.setdefault(track_id, {"playCount": 0, "lastPlayedAt": 0})
            item["playCount"] += 1
            item["lastPlayedAt"] = max(item["lastPlayedAt"], int(event.get("playedAt") or 0))

        now = int(time.time() * 1000)
        dormant_ms = 1000 * 60 * 60 * 24 * 60
        candidates = []
        for track in context.library_tracks:
            stat = stats.get(str(track.get("id")))
            last_played = int((stat or {}).get("lastPlayedAt") or track.get("addedAt") or 0)
            play_count = int((stat or {}).get("playCount") or 0)
            if play_count >= 1 and now - last_played > dormant_ms:
                candidates.append((play_count, last_played, track))
        candidates.sort(key=lambda item: (-item[0], item[1]))
        tracks = [item[2] for item in candidates[:count]]
        if len(tracks) < 3:
            raise GenerationFailure("insufficient_seed_data", "Not enough listening history yet to build a rediscovery mix.")

        blurb = self._build_blurb(context, {"kind": "rediscovery", "sampleArtists": [track.get("artist") for track in tracks[:3]], "count": len(tracks)})
        mix = {
            "id": _mix_id("rediscovery"),
            "kind": "rediscovery",
            "seedRef": None,
            "title": "Rediscover your library",
            "blurb": blurb,
            "trackIds": [track["id"] for track in tracks],
            "unresolvedCount": 0,
            "status": "fresh",
            **_now_envelope(),
        }
        self._save_mix_and_tracks(user_id, context, mix, [])
        return _mix_result_payload(mix)

    def generate_recommendation_run(
        self,
        user_id: str,
        request: GenerationCreateRequest,
        on_phase_change: Callable[[str], None] | None = None,
    ) -> dict[str, Any]:
        if request.kind == "mood-playlist":
            playlist_request = GenerationPlaylistRequest(
                prompt=request.prompt or "",
                count=request.count,
                titleOverride=request.title_override,
                useTaste=request.use_taste,
                source=request.source,
            )
            result = self.generate_mood_playlist(user_id, playlist_request, on_phase_change=on_phase_change)
            return {
                "playlistId": result["playlist"]["id"],
                "mixId": result["mix"]["id"],
                "name": result["playlist"]["name"],
                "blurb": result["playlist"].get("description") or result["mix"].get("blurb") or "",
                "trackCount": result["trackCount"],
                "unresolvedCount": result.get("unresolvedCount", 0),
                "unresolvedTracks": result.get("unresolvedTracks", []),
                "mix": result["mix"],
            }

        context = self._load_context(user_id)
        if request.kind == "rediscovery":
            return self._generate_rediscovery_mix(user_id, context, request)

        count = request.count
        seed_ref: dict[str, Any] | None = None
        title = ""
        blurb_payload: dict[str, Any] = {"kind": request.kind}
        include_profile = request.use_taste

        if request.kind == "setlist-seed":
            seed = _find_track(context.library_tracks, request.seed_track_id)
            if not seed:
                raise GenerationFailure("seed_not_found", "The seed track could not be found in the synced library.")
            body = f'Seed track: "{seed.get("title", "Unknown")}" — {seed.get("artist", "Unknown")}.'
            if request.focus_prompt:
                body = f"{body}\nFocus: {request.focus_prompt}"
            prefix, tail = self._build_suggestion_context(context.library_tracks, context.taste_profile if include_profile else None, "## Setlist seed", body, include_profile=include_profile)
            instruction = f"Setlist from track: build a {count}-track DJ-friendly set starting from the seed. Respect BPM/energy flow — opener, build, peak, wind-down. Vary artists, no repeats. Prefer tracks that would beatmatch or key-mix well."
            seed_ref = {"type": "track", "id": seed["id"]}
            title = f'Setlist from {seed.get("title", "Unknown")}'
            blurb_payload.update({"seed": {"title": seed.get("title"), "artist": seed.get("artist")}, "focus": request.focus_prompt})
        elif request.kind == "playlist-footer":
            playlist = _find_playlist(context.app_playlists, request.seed_playlist_id)
            if not playlist:
                raise GenerationFailure("seed_not_found", "The seed playlist could not be found in the synced library.")
            playlist_tracks = _resolve_playlist_tracks(playlist, context.library_tracks)
            if len(playlist_tracks) < 3:
                raise GenerationFailure("insufficient_seed_data", "The seed playlist needs at least 3 synced tracks.")
            sample = "\n".join(f'- "{track.get("title", "Unknown")}" — {track.get("artist", "Unknown")}' for track in playlist_tracks[-15:])
            prefix, tail = self._build_suggestion_context(context.library_tracks, context.taste_profile if include_profile else None, f'## Footer for: {playlist.get("name", "Playlist")}', f"Last tracks in playlist:\n{sample}")
            instruction = f"Playlist footer: recommend {count} tracks that would make sense AFTER the last track in this playlist — same energy lane, flowing onward. These should be new to the user's library."
            seed_ref = {"type": "playlist", "id": playlist["id"]}
            title = "You might also like"
            blurb_payload.update({"playlistName": playlist.get("name"), "resolvedCount": count})
        elif request.kind == "track-echo":
            seed = _find_track(context.library_tracks, request.seed_track_id)
            if not seed:
                raise GenerationFailure("seed_not_found", "The seed track could not be found in the synced library.")
            prefix, tail = self._build_suggestion_context(context.library_tracks, context.taste_profile if include_profile else None, "## Track echo seed", f'Seed track: "{seed.get("title", "Unknown")}" — {seed.get("artist", "Unknown")}{f" ({seed.get("album")})" if seed.get("album") else ""}.')
            instruction = 'Track Echo: recommend tracks that flow naturally from the seed track. Match the energy, mood, and genre feel. Vary artists; no duplicates. These should feel like the next track a careful DJ would queue after the seed — not just "similar" tracks.'
            seed_ref = {"type": "track", "id": seed["id"]}
            title = f'Because you have been playing {seed.get("artist", "this artist")}'
            blurb_payload.update({"seed": {"title": seed.get("title"), "artist": seed.get("artist")}, "resolvedCount": count})
        elif request.kind == "playlist-echo":
            playlist = _find_playlist(context.app_playlists, request.seed_playlist_id)
            if not playlist:
                raise GenerationFailure("seed_not_found", "The seed playlist could not be found in the synced library.")
            playlist_tracks = _resolve_playlist_tracks(playlist, context.library_tracks)
            if len(playlist_tracks) < 3:
                raise GenerationFailure("insufficient_seed_data", "The seed playlist needs at least 3 synced tracks.")
            sample = "\n".join(f'- "{track.get("title", "Unknown")}" — {track.get("artist", "Unknown")}' for track in playlist_tracks[:25])
            prefix, tail = self._build_suggestion_context(context.library_tracks, context.taste_profile if include_profile else None, f'## Playlist echo seed: {playlist.get("name", "Playlist")}', f'Seed playlist "{playlist.get("name", "Playlist")}":\n{sample}')
            instruction = "Playlist Echo: recommend tracks that share the spirit of the seed playlist — its energy arc, mood, and sonic signature — but are NEW to the user's library. Vary the artists. These are meant to feel like a natural cousin playlist."
            seed_ref = {"type": "playlist", "id": playlist["id"]}
            title = f'Echoes of {playlist.get("name", "this playlist")}'
            blurb_payload.update({"playlistName": playlist.get("name"), "resolvedCount": count})
        elif request.kind == "similar-artist":
            if not request.seed_artist:
                raise GenerationFailure("seed_not_found", "A seed artist is required.")
            prefix, tail = self._build_suggestion_context(context.library_tracks, context.taste_profile if include_profile else None, "## Similar artist seed", f"Find ONE artist adjacent to {request.seed_artist} that feels like a natural bridge — then recommend {count} of their strongest tracks.")
            instruction = f'Similar Artist bridge: pick a single artist who bridges from the seed artist to new territory the user would love — based on the taste profile. Then list {count} of that artist\'s tracks. Every "artist" field in the response MUST be the SAME artist name.'
            seed_ref = {"type": "artist", "name": request.seed_artist}
            title = ""
            blurb_payload.update({"from": request.seed_artist})
        elif request.kind == "cultural-bridge":
            markers = context.taste_profile.get("culturalMarkers", []) if context.taste_profile else []
            if not markers:
                raise GenerationFailure("insufficient_seed_data", "Analyze taste first so Sauti has cultural markers to bridge.")
            prefix, tail = self._build_suggestion_context(context.library_tracks, context.taste_profile, "## Cultural bridge", f"Build a cross-cultural bridge mix drawing from the user's cultural markers ({', '.join(str(item) for item in markers)}). Span multiple regions/genres that feel connected by rhythm or lineage. Prefer lesser-known gems over obvious hits.")
            instruction = "Cultural Bridge: tracks that connect the user's cultural markers across regions. Think rhythm lineage (afro-roots -> latin, arabic -> flamenco, etc.). Each pick should feel earned — include the bridge reasoning in the reason field."
            seed_ref = None
            title = "A cross-cultural bridge"
            blurb_payload.update({"markers": markers, "resolvedCount": count})
        elif request.kind == "auto-radio":
            seed = _find_track(context.library_tracks, request.seed_track_id)
            if not seed:
                raise GenerationFailure("seed_not_found", "The seed track could not be found in the synced library.")
            prefix, tail = self._build_suggestion_context(context.library_tracks, context.taste_profile if include_profile else None, "## Auto-radio seed", f'Seed: "{seed.get("title", "Unknown")}" — {seed.get("artist", "Unknown")}. Keep the energy lane, expand the horizon. Do not repeat library tracks.')
            instruction = f"Auto-radio: {count} tracks that continue the session. All tracks must be NEW to the library. Vary artists. Focus on natural DJ flow, not just taste similarity."
            seed_ref = {"type": "track", "id": seed["id"]}
            title = "Auto-radio"
            blurb_payload.update({"seed": {"title": seed.get("title"), "artist": seed.get("artist")}})
        else:
            raise GenerationFailure("unsupported_kind", f"Unsupported generation kind: {request.kind}")

        if on_phase_change:
            on_phase_change("resolving")
        resolved_tracks, unresolved_tracks = self._resolve_recommendations_with_refills(
            context=context,
            library_tracks=context.library_tracks,
            instruction=instruction,
            tail=tail,
            prefix=prefix,
            count=count,
        )
        if not resolved_tracks:
            raise GenerationFailure("no_tracks_resolved", "Sauti generated recommendations, but none could be matched to playable tracks.")
        unresolved_count = max(0, count - len(resolved_tracks))

        if request.kind == "auto-radio":
            tracks_by_id = {str(track["id"]): track for track in context.library_tracks}
            for track in resolved_tracks:
                tracks_by_id[str(track["id"])] = track
            next_tracks = sorted(tracks_by_id.values(), key=lambda track: int(track.get("addedAt") or 0), reverse=True)
            _write_library_snapshot(self.db, user_id, next_tracks, context.app_playlists)
            return {
                "trackIds": [track["id"] for track in resolved_tracks],
                "tracks": resolved_tracks,
                "trackCount": len(resolved_tracks),
                "unresolvedCount": unresolved_count,
                "unresolvedTracks": unresolved_tracks,
            }

        bridge_artist = resolved_tracks[0].get("artist") if request.kind == "similar-artist" and resolved_tracks else None
        if request.kind == "similar-artist" and bridge_artist:
            title = f"{bridge_artist} feels like a bridge from {request.seed_artist}"
            blurb_payload["to"] = bridge_artist

        blurb_payload["resolvedCount"] = len(resolved_tracks)
        blurb = self._build_blurb(context, blurb_payload)
        mix = {
            "id": _mix_id(request.kind),
            "kind": request.kind,
            "seedRef": seed_ref,
            "title": title or request.kind,
            "blurb": blurb,
            "trackIds": [track["id"] for track in resolved_tracks],
            "unresolvedCount": unresolved_count,
            "unresolvedTracks": unresolved_tracks,
            "focusPrompt": request.focus_prompt,
            "status": "fresh",
            **_now_envelope(),
        }
        if on_phase_change:
            on_phase_change("saving")
        self._save_mix_and_tracks(user_id, context, mix, resolved_tracks)
        return _mix_result_payload(mix)

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
        if on_phase_change:
            on_phase_change("resolving")
        resolved_tracks, unresolved_tracks = self._resolve_recommendations_with_refills(
            context=context,
            library_tracks=context.library_tracks,
            instruction=instruction,
            tail=tail,
            prefix=prefix,
            count=request.count,
        )
        if not resolved_tracks:
            raise GenerationFailure("no_tracks_resolved", "Sauti generated recommendations, but none could be matched to playable tracks.")
        unresolved_count = max(0, request.count - len(resolved_tracks))

        mix_id = _mix_id("mood-playlist")
        blurb = self._build_blurb(context, {"prompt": request.prompt, "resolvedCount": len(resolved_tracks)})
        mix = {
            "id": mix_id,
            "kind": "mood-playlist",
            "seedRef": {"type": "mood", "prompt": request.prompt},
            "title": request.prompt[:80],
            "blurb": blurb,
            "trackIds": [track["id"] for track in resolved_tracks],
            "unresolvedCount": unresolved_count,
            "unresolvedTracks": unresolved_tracks,
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
            "unresolvedCount": unresolved_count,
            "unresolvedTracks": unresolved_tracks,
        }

    def process_generation_run(self, run_id: str) -> None:
        run = self.db.get(GenerationRun, run_id)
        if run is None:
            return
        request_payload = json.loads(run.request_payload)
        if "kind" not in request_payload:
            request_payload["kind"] = "mood-playlist"
        request = GenerationCreateRequest.model_validate(request_payload)
        run.status = "running"
        run.phase = "recommendations" if request.kind != "rediscovery" else "saving"
        run.attempt_count = (run.attempt_count or 0) + 1
        run.started_at = int(time.time() * 1000)
        run.updated_at = int(time.time() * 1000)
        self.db.commit()

        def set_phase(phase: str) -> None:
            run.phase = phase
            run.updated_at = int(time.time() * 1000)
            self.db.commit()

        try:
            result = self.generate_recommendation_run(run.user_id, request, on_phase_change=set_phase)
            run.status = "succeeded"
            run.phase = "saving"
            run.result_payload = json.dumps(result)
            run.mix_id = result.get("mixId") if isinstance(result.get("mixId"), str) else None
            run.playlist_id = result.get("playlistId") if isinstance(result.get("playlistId"), str) else None
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
