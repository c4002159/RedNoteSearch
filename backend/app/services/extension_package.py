"""Package only the checked-in runtime, never credentials, tests, or arbitrary directories."""

from io import BytesIO
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

RUNTIME_FILES = ("manifest.json", "parse.js", "popup.html", "popup.js")
EXTENSION_DIRECTORY = Path(__file__).resolve().parents[3] / "extensions/results-helper"


def extension_package(directory: Path = EXTENSION_DIRECTORY) -> bytes:
    output = BytesIO()
    with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
        for name in RUNTIME_FILES:
            path = directory / name
            if path.is_symlink() or not path.is_file():
                raise OSError("Extension runtime file unavailable")
            archive.writestr(f"results-helper/{name}", path.read_bytes())
    return output.getvalue()
