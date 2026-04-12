from __future__ import annotations

from pydantic import BaseModel, Field


class AppLoginRequest(BaseModel):
    password: str = Field(min_length=1)


class PlaylistCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)


class PlaylistAddItemsRequest(BaseModel):
    track_ids: list[str] = Field(alias="trackIds", min_length=1)

    model_config = {"populate_by_name": True}
