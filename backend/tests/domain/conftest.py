from collections.abc import Generator

import pytest


@pytest.fixture(scope="session", autouse=True)
def db() -> Generator[None]:
    """Override the template autouse database fixture: these tests are pure and need no database."""
    yield None
