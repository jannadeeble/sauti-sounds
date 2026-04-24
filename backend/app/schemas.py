from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class AuthLoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=8, max_length=256)


class AuthRegisterRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=8, max_length=256)
    name: str = Field(default="", max_length=120)
    invite_code: str | None = Field(default=None, alias="inviteCode", max_length=120)

    model_config = {"populate_by_name": True}


class PlaylistCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)


class PlaylistAddItemsRequest(BaseModel):
    track_ids: list[str] = Field(alias="trackIds", min_length=1)

    model_config = {"populate_by_name": True}


class LibrarySnapshotRequest(BaseModel):
    tracks: list[dict[str, Any]] = Field(default_factory=list)
    playlists: list[dict[str, Any]] = Field(default_factory=list)
    folders: list[dict[str, Any]] = Field(default_factory=list)


class AppStateSnapshotRequest(BaseModel):
    notifications: list[dict[str, Any]] = Field(default_factory=list)
    history: list[dict[str, Any]] = Field(default_factory=list)
    listen_events: list[dict[str, Any]] = Field(default_factory=list, alias="listenEvents")
    mixes: list[dict[str, Any]] = Field(default_factory=list)
    taste_profile: dict[str, Any] | None = Field(default=None, alias="tasteProfile")
    settings: dict[str, Any] = Field(default_factory=dict)
    ui: dict[str, Any] = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


class LLMChatRequest(BaseModel):
    provider: str = Field(min_length=1, max_length=40)
    api_key: str = Field(alias="apiKey", min_length=1, max_length=4096)
    model: str | None = Field(default=None, max_length=200)
    messages: list[dict[str, Any]] = Field(default_factory=list)
    max_tokens: int = Field(default=2048, alias="maxTokens", ge=1, le=65536)
    thinking_budget: int | None = Field(default=None, alias="thinkingBudget", ge=0, le=64000)
    system_blocks: list[dict[str, Any]] | None = Field(default=None, alias="systemBlocks")
    use_route_enhancements: bool = Field(default=True, alias="useRouteEnhancements")

    model_config = {"populate_by_name": True}
