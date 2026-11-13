"""Auto-grader for Lesson 03. Run:  pytest test_03_access.py -v"""
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parent / "access_gate.py"


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


# (username, role, mfa, hour, resource) -> expected decision line
CASES = [
    # happy paths
    (("nic", "analyst", "yes", "10", "servers"), "ACCESS GRANTED: nic -> servers"),
    (("nic", "analyst", "yes", "10", "reports"), "ACCESS GRANTED: nic -> reports"),
    (("sam", "intern", "yes", "9", "reports"), "ACCESS GRANTED: sam -> reports"),
    (("root", "admin", "yes", "3", "payroll"), "ACCESS GRANTED: root -> payroll"),
    # normalization
    (("  root ", "  ADMIN ", " YES ", "3", " Payroll "), "ACCESS GRANTED: root -> payroll"),
    (("nic", "Analyst", "Yes", "8", "SERVERS"), "ACCESS GRANTED: nic -> servers"),
    # boundaries of business hours
    (("nic", "analyst", "yes", "8", "servers"), "ACCESS GRANTED: nic -> servers"),
    (("nic", "analyst", "yes", "17", "servers"), "ACCESS GRANTED: nic -> servers"),
    (("nic", "analyst", "yes", "18", "servers"), "ACCESS DENIED: outside business hours"),
    (("nic", "analyst", "yes", "7", "servers"), "ACCESS DENIED: outside business hours"),
    (("sam", "intern", "yes", "20", "reports"), "ACCESS DENIED: outside business hours"),
    # privileges
    (("nic", "analyst", "yes", "10", "payroll"), "ACCESS DENIED: insufficient privileges"),
    (("sam", "intern", "yes", "10", "servers"), "ACCESS DENIED: insufficient privileges"),
    # privileges are checked BEFORE hours
    (("sam", "intern", "yes", "22", "payroll"), "ACCESS DENIED: insufficient privileges"),
    # MFA
    (("root", "admin", "no", "10", "servers"), "ACCESS DENIED: MFA required"),
    (("nic", "analyst", "maybe", "10", "servers"), "ACCESS DENIED: MFA required"),
    # unknown role (checked after MFA)
    (("eve", "hacker", "yes", "10", "servers"), "ACCESS DENIED: unknown role"),
    (("eve", "hacker", "no", "10", "servers"), "ACCESS DENIED: MFA required"),
    # invalid hour is checked first
    (("nic", "admin", "yes", "24", "servers"), "ERROR: invalid hour"),
    (("nic", "admin", "no", "-1", "servers"), "ERROR: invalid hour"),
]


@pytest.mark.parametrize("inputs,expected", CASES, ids=[" / ".join(c[0]) for c in CASES])
def test_access_decision(inputs, expected):
    out = run_with_inputs(*inputs)
    assert expected in out, (
        f"For inputs {inputs}\nExpected: {expected}\nYour program printed:\n{out}"
    )
    decisions = out.count("ACCESS GRANTED") + out.count("ACCESS DENIED") + out.count("ERROR:")
    assert decisions == 1, (
        f"Your program should print exactly ONE decision, but printed {decisions}:\n{out}\n"
        "Tip: use one if/elif/else chain so only one branch can run."
    )
