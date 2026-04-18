from __future__ import annotations

import threading
import time
import uuid
from concurrent.futures import Future
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import requests
import tidalapi
from sqlalchemy.orm import Session

from .config import settings
from .database import SessionLocal, get_setting_json, set_setting_json
from .security import create_playback_token

TIDAL_SESSION_KEY = "tidal_oauth_session"


@dataclass
class LoginAttempt:
    attempt_id: str
    started_at: float
    session: tidalapi.Session
    login: Any
    future: Future[Any]
    error: str | None = None


class TidalManager:
    def __init__(self) -> None:
        self._session: tidalapi.Session | None = None
        self._lock = threading.RLock()
        self._attempts: dict[str, LoginAttempt] = {}
        # Last payload we wrote to the DB. Used to detect when the
        # tidalapi library has silently refreshed the access token (e.g. via
        # an internal token_refresh()) so we can persist the new credentials
        # back to settings — otherwise the refreshed token only lives in
        # memory and is lost on the next process restart, which presents to
        # the user as "TIDAL became disconnected".
        self._saved_payload: dict[str, Any] | None = None

    def _create_session(self) -> tidalapi.Session:
        config = tidalapi.Config(quality=settings.tidal_quality)
        return tidalapi.Session(config=config)

    @staticmethod
    def _payload_from_session(session: tidalapi.Session) -> dict[str, Any]:
        return {
            "token_type": session.token_type,
            "access_token": session.access_token,
            "refresh_token": session.refresh_token,
            "expiry_time": session.expiry_time.isoformat() if session.expiry_time else None,
            "is_pkce": bool(session.is_pkce),
        }

    def _persist_if_changed(self) -> None:
        """Persist the current session credentials if they differ from what
        we last wrote to the DB. Safe to call frequently — it short-circuits
        when nothing has changed."""
        with self._lock:
            session = self._session
            if session is None:
                return
            payload = self._payload_from_session(session)
            if payload == self._saved_payload:
                return
            db = SessionLocal()
            try:
                set_setting_json(db, TIDAL_SESSION_KEY, payload)
                db.commit()
                self._saved_payload = payload
            finally:
                db.close()

    def load_from_db(self, db: Session) -> bool:
        payload = get_setting_json(db, TIDAL_SESSION_KEY)
        if not payload:
            return False

        session = self._create_session()
        loaded = session.load_oauth_session(
            token_type=payload.get("token_type"),
            access_token=payload.get("access_token"),
            refresh_token=payload.get("refresh_token"),
            expiry_time=datetime.fromisoformat(payload["expiry_time"])
            if payload.get("expiry_time")
            else None,
            is_pkce=bool(payload.get("is_pkce", False)),
        )
        if not loaded:
            return False

        # If the access token has expired, attempt an explicit refresh using
        # the stored refresh token before giving up. tidalapi's check_login()
        # only looks at expiry_time and does not refresh on its own.
        if not session.check_login() and payload.get("refresh_token"):
            try:
                session.token_refresh(payload["refresh_token"])
            except Exception:  # noqa: BLE001
                pass

        if not session.check_login():
            return False

        with self._lock:
            self._session = session
            self._saved_payload = self._payload_from_session(session)
        # Persist immediately in case the refresh above produced new tokens.
        self._persist_if_changed()
        return True

    def save_to_db(self, db: Session) -> None:
        session = self.require_session()
        payload = self._payload_from_session(session)
        set_setting_json(db, TIDAL_SESSION_KEY, payload)
        with self._lock:
            self._saved_payload = payload

    def clear(self, db: Session) -> None:
        with self._lock:
            self._session = None
            self._attempts.clear()
            self._saved_payload = None
        set_setting_json(db, TIDAL_SESSION_KEY, None)

    def get_session(self) -> tidalapi.Session | None:
        with self._lock:
            return self._session

    def require_session(self) -> tidalapi.Session:
        session = self.get_session()
        if session is None:
            raise ValueError("TIDAL session not connected")

        if not session.check_login():
            # Try to refresh before giving up. The tidalapi library exposes
            # token_refresh(refresh_token) for this.
            refresh_token = getattr(session, "refresh_token", None)
            if refresh_token:
                try:
                    session.token_refresh(refresh_token)
                except Exception:  # noqa: BLE001
                    pass
            if not session.check_login():
                raise ValueError("TIDAL session not connected")

        # tidalapi may have rotated tokens during check_login/token_refresh;
        # also any prior API call on this session could have refreshed in
        # response to a 401. Persist the latest credentials so a process
        # restart doesn't silently disconnect the user.
        self._persist_if_changed()
        return session

    def start_login(self) -> LoginAttempt:
        with self._lock:
            session = self._create_session()
            login, future = session.login_oauth()
            attempt = LoginAttempt(
                attempt_id=uuid.uuid4().hex,
                started_at=time.time(),
                session=session,
                login=login,
                future=future,
            )
            self._attempts[attempt.attempt_id] = attempt
            return attempt

    @staticmethod
    def normalize_external_url(url: str | None) -> str | None:
        if not url:
            return url
        if url.startswith("http://") or url.startswith("https://"):
            return url
        return f"https://{url.lstrip('/')}"

    def get_attempt(self, attempt_id: str) -> LoginAttempt | None:
        with self._lock:
            return self._attempts.get(attempt_id)

    def resolve_attempt(self, db: Session, attempt_id: str) -> dict[str, Any]:
        attempt = self.get_attempt(attempt_id)
        if attempt is None:
            return {"status": "missing", "connected": False, "error": "Unknown login attempt"}

        if not attempt.future.done():
            return {
                "status": "pending",
                "connected": False,
                "verificationUri": self.normalize_external_url(attempt.login.verification_uri),
                "verificationUriComplete": self.normalize_external_url(attempt.login.verification_uri_complete),
            }

        try:
            attempt.future.result()
        except Exception as exc:  # noqa: BLE001
            attempt.error = str(exc)
            with self._lock:
                self._attempts.pop(attempt_id, None)
            return {"status": "error", "connected": False, "error": attempt.error}

        session = attempt.session
        with self._lock:
            self._session = session

        active = self.require_session()
        self.save_to_db(db)
        with self._lock:
            self._attempts.pop(attempt_id, None)
        return {
            "status": "connected",
            "connected": True,
            "user": self.serialize_user(active.user),
        }

    def cleanup_attempts(self) -> None:
        cutoff = time.time() - 60 * 15
        with self._lock:
            stale = [attempt_id for attempt_id, attempt in self._attempts.items() if attempt.started_at < cutoff]
            for attempt_id in stale:
                self._attempts.pop(attempt_id, None)

    @staticmethod
    def serialize_user(user: Any) -> dict[str, Any] | None:
        if user is None:
            return None
        return {
            "id": user.id,
            "username": getattr(user, "username", None),
            "email": getattr(user, "email", None),
            "name": getattr(user, "name", None),
        }

    def serialize_track(self, track: Any, *, is_favorite: bool = False) -> dict[str, Any]:
        artists = getattr(track, "artists", None) or []
        album = getattr(track, "album", None)
        artwork_url = None
        if album is not None:
            try:
                artwork_url = album.image(640)
            except Exception:  # noqa: BLE001
                artwork_url = None
        provider_track_id = str(track.id)
        added_at = getattr(track, "user_date_added", None)
        return {
            "id": f"tidal-{provider_track_id}",
            "title": getattr(track, "name", "Unknown"),
            "artist": ", ".join(artist.name for artist in artists) or "Unknown Artist",
            "album": getattr(album, "name", "Unknown Album") if album else "Unknown Album",
            "duration": int(getattr(track, "duration", 0) or 0),
            "source": "tidal",
            "providerTrackId": provider_track_id,
            "providerAlbumId": str(album.id) if album and getattr(album, "id", None) else None,
            "providerArtistIds": [str(artist.id) for artist in artists if getattr(artist, "id", None)],
            "providerUrl": getattr(track, "listen_url", "") or getattr(track, "share_url", ""),
            "audioUrl": self.build_stream_url(provider_track_id),
            "artworkUrl": artwork_url,
            "genre": None,
            "isFavorite": is_favorite,
            "addedAt": int(added_at.timestamp() * 1000) if added_at else int(time.time() * 1000),
        }

    def serialize_playlist(self, playlist: Any) -> dict[str, Any]:
        artwork_url = None
        try:
            artwork_url = playlist.image(480)
        except Exception:  # noqa: BLE001
            artwork_url = None

        writable = playlist.__class__.__name__ == "UserPlaylist"
        created = getattr(playlist, "created", None)
        updated = getattr(playlist, "last_updated", None) or created
        return {
            "id": f"tidal-{playlist.id}",
            "name": playlist.name,
            "description": playlist.description or "",
            "artworkUrl": artwork_url,
            "items": [],
            "createdAt": int(created.timestamp() * 1000) if created else int(time.time() * 1000),
            "updatedAt": int(updated.timestamp() * 1000) if updated else int(time.time() * 1000),
            "kind": "tidal",
            "providerPlaylistId": str(playlist.id),
            "writable": writable,
            "trackCount": int(getattr(playlist, "num_tracks", 0) or 0),
        }

    def build_stream_url(self, track_id: str) -> str:
        token = create_playback_token(track_id)
        return f"/api/tidal/tracks/{track_id}/stream?token={token}"

    def search_tracks(self, query: str, limit: int = 20) -> list[dict[str, Any]]:
        session = self.require_session()
        results = session.search(query, models=[tidalapi.media.Track], limit=limit)
        return [self.serialize_track(track) for track in results["tracks"]]

    def get_track(self, track_id: str) -> dict[str, Any]:
        session = self.require_session()
        track = session.track(track_id, with_album=True)
        return self.serialize_track(track)

    def get_favorite_tracks(self) -> list[dict[str, Any]]:
        session = self.require_session()
        tracks = session.user.favorites.tracks()
        return [self.serialize_track(track, is_favorite=True) for track in tracks]

    def add_favorite_track(self, track_id: str) -> bool:
        session = self.require_session()
        return bool(session.user.favorites.add_track(track_id))

    def remove_favorite_track(self, track_id: str) -> bool:
        session = self.require_session()
        return bool(session.user.favorites.remove_track(track_id))

    def get_playlists(self) -> list[dict[str, Any]]:
        session = self.require_session()
        playlists = session.user.playlist_and_favorite_playlists()
        return [self.serialize_playlist(playlist) for playlist in playlists]

    def create_playlist(self, name: str, description: str) -> dict[str, Any]:
        session = self.require_session()
        playlist = session.user.create_playlist(name, description)
        return self.serialize_playlist(playlist)

    def get_playlist(self, playlist_id: str) -> dict[str, Any]:
        session = self.require_session()
        playlist = session.playlist(playlist_id)
        items = [item for item in playlist.items() if item.__class__.__name__ == "Track"]
        data = self.serialize_playlist(playlist)
        data["items"] = [
            {"source": "tidal", "providerTrackId": str(item.id)}
            for item in items
        ]
        data["tracks"] = [self.serialize_track(item) for item in items]
        return data

    def add_playlist_items(self, playlist_id: str, track_ids: list[str]) -> dict[str, Any]:
        session = self.require_session()
        playlist = session.playlist(playlist_id)
        if playlist.__class__.__name__ != "UserPlaylist":
            raise ValueError("Playlist is not writable")
        playlist.add(track_ids)
        return self.get_playlist(playlist_id)

    def remove_playlist_item(self, playlist_id: str, track_id: str) -> dict[str, Any]:
        session = self.require_session()
        playlist = session.playlist(playlist_id)
        if playlist.__class__.__name__ != "UserPlaylist":
            raise ValueError("Playlist is not writable")
        playlist.remove_by_id(track_id)
        return self.get_playlist(playlist_id)

    def get_stream_response(self, track_id: str, range_header: str | None) -> tuple[requests.Response, dict[str, str]]:
        session = self.require_session()
        track = session.track(track_id, with_album=True)
        stream_url = track.get_url()

        headers = {"Range": range_header} if range_header else {}
        upstream = requests.get(stream_url, headers=headers, stream=True, timeout=30)
        response_headers: dict[str, str] = {
            "Accept-Ranges": upstream.headers.get("Accept-Ranges", "bytes"),
            "Content-Type": upstream.headers.get("Content-Type", "audio/mpeg"),
            "Cache-Control": "no-store",
        }
        for header_name in ("Content-Length", "Content-Range", "Content-Disposition"):
            value = upstream.headers.get(header_name)
            if value:
                response_headers[header_name] = value
        return upstream, response_headers


tidal_manager = TidalManager()
