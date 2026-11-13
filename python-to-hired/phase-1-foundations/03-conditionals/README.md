# Lesson 03 — Conditionals & Booleans

**Project:** Access Control Gate ⏱️ ~2 days

## Why this matters for your job
Security comes down to decisions: **Should this user get in? Is this alert serious? Does this
file look malicious?** Firewalls, IAM policies and SIEM detection rules are all *if this, then
that* logic. Today you'll build a **role-based access control (RBAC)** gate, the same idea behind
Active Directory groups, AWS IAM and every login system. RBAC is also on the Security+ exam.

---

## Concepts

### 1. Booleans: `True` and `False`
```python
mfa_enabled = True
is_locked = False
```

### 2. Comparisons produce booleans
| Operator | Meaning | Example | Result |
|---|---|---|---|
| `==` | equal to | `"admin" == "admin"` | `True` |
| `!=` | not equal | `5 != 3` | `True` |
| `<` `>` `<=` `>=` | less/greater | `failed_logins >= 5` | depends |

> ⚠️ `=` **stores** a value. `==` **compares** two values. Mixing them up is the #1 beginner bug.

String comparisons are **case-sensitive**: `"Admin" == "admin"` is `False`. That's why you
normalize input with `.strip().lower()` (Lesson 02) before comparing.

### 3. `if` / `elif` / `else`
```python
failed_logins = int(input("Failed logins: "))

if failed_logins >= 10:
    print("CRITICAL: lock account and alert SOC")
elif failed_logins >= 5:
    print("WARNING: flag for review")
else:
    print("OK")
```
- The colon `:` and the **indentation** (4 spaces) matter. Indentation tells Python which lines belong to the `if`.
- Python checks conditions **top to bottom** and runs **only the first one that's true**. Order matters!
- `elif` and `else` are optional.

### 4. Combining conditions: `and`, `or`, `not`
```python
if role == "admin" and mfa == "yes":
    print("Welcome, admin")

if role == "analyst" or role == "admin":
    print("You can see the dashboard")

if not account_active:
    print("Account disabled")
```

### 5. Range checks and membership
```python
if 8 <= hour < 18:                  # chained comparison: between 8 and 17
    print("Business hours")

if resource in ("servers", "reports"):   # is it one of these?
    print("Allowed for analysts")
```

### 6. Nested ifs (use sparingly)
```python
if role == "analyst":
    if resource == "payroll":
        print("Denied")
```
Too much nesting gets hard to read. Often you can flatten it with `and` or `elif`.

### 7. The "guard clause" mindset 🛡️
Real security code **checks for reasons to deny first**, then grants access only at the end.
This is called **default deny**, and it's a core security principle. Your project works this way.

---

## 🛡️ Security concept: AAA, MFA, Least Privilege & Zero Trust
*Security+ Domains 1 & 3: General Security Concepts, Security Architecture*

- **AAA** = **A**uthentication (prove who you are) → **A**uthorization (what you may do) →
  **A**ccounting (logging what you did). Your project does the middle one, and the stretch goal
  adds the third.
- **MFA factors**: something you **know** (password), something you **have** (phone, YubiKey),
  something you **are** (fingerprint). Two passwords is *not* MFA. They're the same factor.
- **Least privilege**: give people the *minimum* access their job needs. Interns don't get payroll.
- **Default deny**: if no rule allows it, it's blocked. Firewalls work this way.
- **Zero Trust**: "never trust, always verify". Check identity, device and context (like time of
  day) on *every* request, even from inside the office network. Your business-hours rule is a
  small zero-trust policy.

**Quiz yourself:** a user logs in with a password and then answers a security question. Is that
MFA? *(Answer: No. Both are "something you know".)*

---

## Practice (do this first)
```bash
cd python-to-hired/phase-1-foundations/03-conditionals
python practice.py
```

---

## 🛠️ Project: Access Control Gate

Build [`access_gate.py`](access_gate.py). It asks for these **in this order**:

1. Username
2. Role (`admin`, `analyst`, or `intern`)
3. MFA verified? (`yes` / `no`)
4. Hour of the request (0–23, whole number)
5. Resource requested (`servers`, `reports`, or `payroll`)

**Normalize** the role, MFA answer and resource with `.strip().lower()` so `"  ADMIN "` works. Strip the username too.

**Access policy.** Check in **exactly this order** and print **only one** result:

| # | Check | Output |
|---|---|---|
| 1 | Hour is below 0 or above 23 | `ERROR: invalid hour` |
| 2 | MFA answer isn't `yes` | `ACCESS DENIED: MFA required` |
| 3 | Role isn't admin, analyst or intern | `ACCESS DENIED: unknown role` |
| 4 | Role is `admin` | `ACCESS GRANTED: <username> -> <resource>` (admins can access anything, any time) |
| 5 | Resource isn't allowed for the role: **analyst** → `servers`, `reports`; **intern** → `reports` only | `ACCESS DENIED: insufficient privileges` |
| 6 | Hour is outside business hours (business hours = **8 up to but not including 18**) | `ACCESS DENIED: outside business hours` |
| 7 | Passed every check | `ACCESS GRANTED: <username> -> <resource>` |

**Examples:**
```
nic / analyst / yes / 10 / servers   →  ACCESS GRANTED: nic -> servers
nic / analyst / yes / 10 / payroll   →  ACCESS DENIED: insufficient privileges
sam / intern  / yes / 20 / reports   →  ACCESS DENIED: outside business hours
root / ADMIN  / yes / 3  / Payroll   →  ACCESS GRANTED: root -> payroll
eve / hacker  / yes / 10 / servers   →  ACCESS DENIED: unknown role
```

### Check your work
```bash
pytest test_03_access.py -v
```

### ⭐ Stretch goals
- After the decision, print a **log line** like a real system would:
  `LOG user=nic role=analyst resource=servers result=GRANTED`
- Add a `contractor` role: `reports` only, and only on weekdays (ask for the day of the week).
- Why does the policy check MFA **before** the role? Write a one-sentence comment in your code explaining it.

### Commit it
```bash
git add .
git commit -m "Complete lesson 03: RBAC access control gate"
git push
```

## Interview questions you can now answer
1. What's the difference between `=` and `==`?
2. What is "default deny" and why does it matter in security?
3. What is RBAC? Give an example.
4. In an `if/elif` chain, if two conditions are both true, which one runs?

**Next:** Lesson 04 — Loops (Password Strength Checker + Login Lockout). Tell me when you've passed this one and I'll build it.
