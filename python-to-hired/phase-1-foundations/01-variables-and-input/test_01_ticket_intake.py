"""Auto-grader for Lesson 01. Run:  pytest test_01_ticket_intake.py -v

These tests run your program, type answers into it for you, and check the output.
You don't need to understand this file yet. By Phase 2 you'll write files like it.
"""
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).parent / "ticket_intake.py"


def run_with_inputs(*answers):
    """Run the student's script, feeding each answer as if typed + Enter."""
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


def test_header_and_footer():
    out = run_with_inputs("Nic", "Finance", "Printer offline", "5", "2.5")
    assert_line(out, "=== HELP DESK TICKET ===")
    assert_line(out, "========================")


def test_text_fields():
    out = run_with_inputs("Nic", "Finance", "Printer offline", "5", "2.5")
    assert_line(out, "Name: Nic")
    assert_line(out, "Department: Finance")
    assert_line(out, "Issue: Printer offline")


def test_number_fields():
    out = run_with_inputs("Nic", "Finance", "Printer offline", "5", "2.5")
    assert_line(out, "Affected users: 5")
    assert_line(out, "Duration (hours): 2.5")


def test_impact_score():
    out = run_with_inputs("Nic", "Finance", "Printer offline", "5", "2.5")
    assert_line(out, "Impact score: 12.5")


def test_minutes_down():
    out = run_with_inputs("Nic", "Finance", "Printer offline", "5", "2.5")
    assert_line(out, "Minutes down: 150.0")


def test_different_ticket():
    """Makes sure you used the inputs, not hard-coded values."""
    out = run_with_inputs("Sam", "IT", "VPN won't connect", "12", "0.5")
    assert_line(out, "Name: Sam")
    assert_line(out, "Department: IT")
    assert_line(out, "Issue: VPN won't connect")
    assert_line(out, "Affected users: 12")
    assert_line(out, "Duration (hours): 0.5")
    assert_line(out, "Impact score: 6.0")
    assert_line(out, "Minutes down: 30.0")
