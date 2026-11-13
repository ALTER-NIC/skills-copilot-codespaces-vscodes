"""Auto-grader for Lesson 02. Run:  pytest test_02_username.py -v"""
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parent / "username_generator.py"


def run_with_inputs(*answers):
    result = subprocess.run(
        [sys.executable, str(SCRIPT)],
        input="\n".join(answers) + "\n",
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode == 0, (
        "Your program crashed. Read the error's last line:\n" + result.stderr
    )
    return result.stdout


def assert_line(output, expected):
    assert expected in output, (
        f"Expected to find this line in your output:\n    {expected}\n"
        f"Your program printed:\n{output}"
    )


# (first, last, employee_id) -> expected values
CASES = [
    (("  nic ", "LOPEZ", "100482"),
     {"display": "Lopez, Nic", "user": "nlopez482", "initials": "N.L."}),
    (("mary ann", "de la cruz", "E-77310"),
     {"display": "De La Cruz, Mary Ann", "user": "mdelacruz310", "initials": "M.D."}),
    (("Liam", "o'brien", "55501"),
     {"display": "O'Brien, Liam", "user": "lobrien501", "initials": "L.O."}),
    (("Ana", "Smith-Jones", "900123"),
     {"display": "Smith-Jones, Ana", "user": "asmithjones123", "initials": "A.S."}),
]
IDS = [c[0][1].strip() for c in CASES]


@pytest.mark.parametrize("inputs,expected", CASES, ids=IDS)
def test_display_name(inputs, expected):
    assert_line(run_with_inputs(*inputs), f"Display name: {expected['display']}")


@pytest.mark.parametrize("inputs,expected", CASES, ids=IDS)
def test_username(inputs, expected):
    assert_line(run_with_inputs(*inputs), f"Username: {expected['user']}")


@pytest.mark.parametrize("inputs,expected", CASES, ids=IDS)
def test_email_and_home(inputs, expected):
    out = run_with_inputs(*inputs)
    assert_line(out, f"Email: {expected['user']}@corp.example.com")
    assert_line(out, f"Home folder: /home/{expected['user']}")


@pytest.mark.parametrize("inputs,expected", CASES, ids=IDS)
def test_initials(inputs, expected):
    assert_line(run_with_inputs(*inputs), f"Initials: {expected['initials']}")


@pytest.mark.parametrize("inputs,expected", CASES, ids=IDS)
def test_username_length(inputs, expected):
    assert_line(run_with_inputs(*inputs), f"Username length: {len(expected['user'])}")
