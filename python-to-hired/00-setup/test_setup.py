"""Checks that hello.py runs and prints something."""
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).parent / "hello.py"


def test_hello_prints_something():
    result = subprocess.run(
        [sys.executable, str(SCRIPT)], capture_output=True, text=True, timeout=10
    )
    assert result.returncode == 0, f"hello.py crashed:\n{result.stderr}"
    assert result.stdout.strip() != "", "hello.py ran but printed nothing. Add a print() line!"
