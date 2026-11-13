# Lesson 01 — Variables, Types, Input & Math

**Project:** Help Desk Ticket Intake ⏱️ ~1–2 days

## Why this matters for your job
Every help desk runs on tickets: who has the problem, what it is, how bad it is. Tools like
ServiceNow and Jira are just programs that **take input, store it in variables, do some math,
and display results**. That's exactly what you're learning today.

---

## Concepts

### 1. `print()`: show output
```python
print("System online")
print("Users:", 42)          # print can take several things, separated by commas
```

### 2. Variables: named boxes that hold values
```python
hostname = "web-server-01"
open_tickets = 17
```
- The name goes on the **left**, the value on the **right**. `=` means "store", not "equals".
- Name variables with `snake_case`: lowercase words joined by underscores.
- Pick names that say what's inside: `failed_logins`, not `x`.

### 3. Types: what kind of value it is
| Type | Example | Used for |
|---|---|---|
| `str` (string) | `"Printer offline"` | text, always in quotes |
| `int` (integer) | `5` | whole numbers |
| `float` | `2.5` | decimal numbers |
| `bool` | `True` / `False` | yes/no (Lesson 03) |

```python
print(type("hello"))   # <class 'str'>
print(type(5))         # <class 'int'>
print(type(2.5))       # <class 'float'>
```

> ⚠️ `"5"` and `5` are **different**. `"5"` is text that looks like a number. `"5" + "5"` gives `"55"`.

### 4. `input()`: ask the user
```python
name = input("Your name: ")
print("Hello", name)
```
**`input()` ALWAYS gives you a string**, even when the user types a number. To do math with it, convert it:

```python
users = int(input("Affected users: "))     # "5"   → 5
hours = float(input("Hours down: "))        # "2.5" → 2.5
```

### 5. Math
| Operator | Meaning | Example | Result |
|---|---|---|---|
| `+` `-` `*` `/` | add, subtract, multiply, divide | `7 / 2` | `3.5` |
| `//` | divide, drop the decimal | `7 // 2` | `3` |
| `%` | remainder ("modulo") | `7 % 2` | `1` |
| `**` | power | `2 ** 10` | `1024` |

```python
total_seconds = 7384
hours = total_seconds // 3600              # 2
minutes = (total_seconds % 3600) // 60     # 3
```
> Security fact: `2 ** 128` is the number of possible 128-bit keys. Run `print(2 ** 128)` and look at how big it is.

### 6. Reading errors (you WILL see these)
```
ValueError: invalid literal for int() with base 10: 'five'
```
Read the **last line first**. Here, `int()` got text that isn't a number. The lines above it show
**which line of your file** caused it.

---

## 🛡️ Security concept: the CIA Triad
*Security+ Domain 1: General Security Concepts*

Every security decision protects at least one of three things:

| Letter | Means | Example of it breaking |
|---|---|---|
| **C**onfidentiality | Only the right people can see data | Payroll file leaked |
| **I**ntegrity | Data isn't changed without permission | Attacker edits a bank transfer amount |
| **A**vailability | Systems work when people need them | Ransomware, DDoS, a printer outage |

Your project's **impact score** measures an **availability** problem: how many people are blocked,
and for how long. Real incident response teams rank incidents with this kind of math.

**Quiz yourself:** a hacker changes a student's grade in a database. Which letter of CIA is that?
*(Answer: Integrity.)*

---

## Practice (do this first)
Open [`practice.py`](practice.py), follow the TODOs, and run it after each one:
```bash
cd python-to-hired/phase-1-foundations/01-variables-and-input
python practice.py
```

---

## 🛠️ Project: Help Desk Ticket Intake

Open [`ticket_intake.py`](ticket_intake.py) and build a program that asks for the following
**in this exact order**:

1. Your name
2. Department
3. Issue description
4. Number of affected users (whole number)
5. How many hours the issue has lasted (can be a decimal)

Then print a ticket that looks **exactly** like this:

```
=== HELP DESK TICKET ===
Name: Nic
Department: Finance
Issue: Printer offline
Affected users: 5
Duration (hours): 2.5
Impact score: 12.5
Minutes down: 150.0
========================
```

**Rules:**
- **Impact score** = affected users × hours
- **Minutes down** = hours × 60
- The prompts inside `input("...")` can say whatever you like. The tests only check the ticket lines.

### Check your work
```bash
pytest test_01_ticket_intake.py -v
```
All green = done. Red = read the message. It tells you which line is missing or wrong.

### ⭐ Stretch goals (optional, no tests)
- Add a **Ticket ID** line: the department's first 3 letters + the impact score (you'll learn how in Lesson 02, but try it).
- Add **Est. cost of downtime**: users × hours × $45/hour.
- Run the program and type `five` as the number of users. Read the error, and remember it for Lesson 08.

### Commit it
```bash
git add .
git commit -m "Complete lesson 01: help desk ticket intake"
git push
```

## Interview questions you can now answer
1. What's the difference between `"5"` and `5` in Python?
2. What type does `input()` return?
3. What's the difference between `/` and `//`?
4. What does `%` do, and where might you use it? *(Hint: even/odd checks, wrapping around a clock.)*

**Next:** [Lesson 02 — Strings](../02-strings/README.md)
