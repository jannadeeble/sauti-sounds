from __future__ import annotations

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
