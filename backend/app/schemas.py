from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class UserCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=5, max_length=255)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("password")
    @classmethod
    def validate_password_bytes(cls, value: str) -> str:
        if len(value.encode("utf-8")) > 72:
            raise ValueError("Password must be 72 bytes or fewer")
        return value


class UserLogin(BaseModel):
    email: str
    password: str


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    email: str
    created_at: datetime


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class TextTranslationRequest(BaseModel):
    text: str = Field(min_length=1, max_length=10000)
    language: str = "en"


class TranslationResponse(BaseModel):
    text: str
    glosses: list[str]
    motion_paths: list[str]
    status: str = "ready"
    unknown_glosses: list[str] = Field(default_factory=list)
    provider: str = "manifest"


class HistoryCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    gloss: str | None = None
    source_type: str = "text"
    content: str | None = None
    saved: bool = False


class HistoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    gloss: str | None
    source_type: str
    content: str | None
    saved: bool
    created_at: datetime


class UploadResponse(BaseModel):
    filename: str
    source_type: str
    size_bytes: int
    status: str = "uploaded"
    normalized_text: str | None = None
    glosses: list[str] = Field(default_factory=list)
    motion_paths: list[str] = Field(default_factory=list)
    unknown_glosses: list[str] = Field(default_factory=list)
    provider: str | None = None
    message: str | None = None
