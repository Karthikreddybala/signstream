from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from .core.database import get_db
from .core.security import decode_access_token
from .models import User


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")
DatabaseSession = Annotated[Session, Depends(get_db)]


def get_current_user(token: Annotated[str, Depends(oauth2_scheme)], db: DatabaseSession) -> User:
    subject = decode_access_token(token)
    user = db.get(User, int(subject)) if subject and subject.isdigit() else None
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
