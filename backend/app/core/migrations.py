from pathlib import Path

from .database import Base, engine


PROJECT_ROOT = Path(__file__).resolve().parents[3]


def run_migrations() -> None:
    try:
        from alembic import command
        from alembic.config import Config
        from sqlalchemy import inspect
    except ImportError:
        Base.metadata.create_all(bind=engine)
        return

    config = Config(str(PROJECT_ROOT / "backend" / "alembic.ini"))
    config.set_main_option("script_location", str(PROJECT_ROOT / "backend" / "migrations"))

    with engine.begin() as connection:
        config.attributes["connection"] = connection
        inspection = inspect(connection)
        has_existing_schema = inspection.has_table("users") and not inspection.has_table("alembic_version")
        if has_existing_schema:
            command.stamp(config, "head")
        else:
            command.upgrade(config, "head")
