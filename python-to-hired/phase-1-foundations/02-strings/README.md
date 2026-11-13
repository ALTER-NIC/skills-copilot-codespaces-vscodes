# Lesson 02 — Strings

**Project:** New-Hire Username Generator ⏱️ ~1–2 days

## Why this matters for your job
Most data in IT and security is **text**: usernames, log lines, URLs, email headers, file paths.
When a SOC analyst pulls an IP out of a log, or a sysadmin builds 50 accounts from an HR
spreadsheet, they're doing string manipulation. Today you'll automate a task every IT department
does: **creating usernames for new employees** following the company's naming rules.

---

## Concepts

### 1. Strings are sequences of characters
```python
host = "web-server-01"
print(len(host))      # 13, the number of characters
print(host[0])        # 'w'  first character (counting starts at 0)
print(host[-1])       # '1'  last character
```

### 2. Slicing: grab part of a string
`text[start:stop]` goes from `start` up to **but not including** `stop`.
```python
ip = "192.168.1.50"
print(ip[0:3])     # '192'
print(ip[:3])      # '192'   (start defaults to the beginning)
print(ip[-2:])     # '50'    (the last 2 characters)
print(ip[4:])      # '168.1.50'
```

### 3. String methods: built-in tools
A method is a function attached to a value. You call it with a dot: `value.method()`.
| Method | Does | Example → Result |
|---|---|---|
| `.lower()` / `.upper()` | change case | `"ADMIN".lower()` → `"admin"` |
| `.title()` | Capitalize Each Word | `"mary ann".title()` → `"Mary Ann"` |
| `.strip()` | remove spaces at both ends | `"  nic  ".strip()` → `"nic"` |
| `.replace(old, new)` | swap text | `"a-b-c".replace("-", "")` → `"abc"` |
| `.startswith()` / `.endswith()` | check the beginning/end | `"report.pdf".endswith(".pdf")` → `True` |
| `.count(x)` | how many times x appears | `"10.0.0.1".count(".")` → `3` |
| `.split(sep)` | break into a list | `"10.0.0.1".split(".")` → `['10','0','0','1']` |

> 🔑 **Strings never change in place.** `name.lower()` gives you a *new* string. To keep it, store it:
> `name = name.lower()`

You can **chain** methods. They run left to right:
```python
raw = "  JOHN SMITH  "
clean = raw.strip().lower().replace(" ", "")    # 'johnsmith'
```

### 4. Joining strings
```python
first = "Nic"
print("User: " + first)            # + glues strings together
print("=" * 20)                     # * repeats: ====================
```

### 5. f-strings: the cleanest way to build text ⭐
Put `f` before the quotes and variables inside `{}`:
```python
user = "nlopez"
fails = 7
print(f"ALERT: {user} had {fails} failed logins")
print(f"Ratio: {2/3:.2f}")         # :.2f = 2 decimal places → 0.67
print(f"{user.upper()}")           # you can call methods inside {}
```
Use f-strings for nearly all output from now on.

### 6. `in`: is this text inside that text?
```python
log = "Failed password for root from 203.0.113.9"
print("Failed" in log)     # True
print("root" in log)       # True
```
(You'll use this a lot in log analysis, starting in Lesson 07.)

---

## 🛡️ Security concept: Identity & account management
*Security+ Domains 1 & 4: General Security Concepts, Security Operations*

- **Identification** = claiming who you are (your username). **Authentication** = proving it
  (password, MFA). **Authorization** = what you're allowed to do (next lesson).
- **Account lifecycle**: *provisioning* (creating accounts, which your project automates) →
  *changes* when someone switches roles → *deprovisioning* (disabling on the person's last day).
  Accounts left active after someone leaves are a **top real-world breach cause**.
- **Username enumeration:** predictable usernames (`firstinitial + lastname`) help attackers
  guess valid logins from LinkedIn names. That's why the **password and MFA** have to be strong:
  in most companies, usernames are not secret.
- **Input sanitization:** you `.strip()` and clean HR's messy input. Cleaning untrusted input is
  also how you stop attacks like SQL injection, which you'll see in Phase 3.

**Quiz yourself:** an employee quits but their account still works 3 months later. Which lifecycle
step failed? *(Answer: Deprovisioning.)*

---

## Practice (do this first)
```bash
cd python-to-hired/phase-1-foundations/02-strings
python practice.py
```

---

## 🛠️ Project: New-Hire Username Generator

HR gives you a new hire's **first name**, **last name**, and **employee ID**, often typed
messily (extra spaces, ALL CAPS, lowercase). Build [`username_generator.py`](username_generator.py)
that asks for those three things **in that order** and prints:

```
Display name: Lopez, Nic
Username: nlopez482
Email: nlopez482@corp.example.com
Home folder: /home/nlopez482
Initials: N.L.
Username length: 9
```
(for the inputs `  nic `, `LOPEZ`, `100482`)

**The company's naming rules:**
1. **Clean** every input with `.strip()` first.
2. **Display name** = `Last, First` with each word capitalized (`.title()`).
3. **Username** = first letter of the first name + the full last name + the **last 3 characters**
   of the employee ID, all **lowercase**, with **spaces, hyphens (`-`) and apostrophes (`'`) removed**.
4. **Email** = username + `@corp.example.com`
5. **Home folder** = `/home/` + username
6. **Initials** = first letter of first name and first letter of last name, uppercase, each followed by a dot.
7. **Username length** = number of characters in the username.

**More examples the tests will try:**
| First | Last | ID | Username | Display name |
|---|---|---|---|---|
| `mary ann` | `de la cruz` | `E-77310` | `mdelacruz310` | `De La Cruz, Mary Ann` |
| `Liam` | `o'brien` | `55501` | `lobrien501` | `O'Brien, Liam` |
| `Ana` | `Smith-Jones` | `900123` | `asmithjones123` | `Smith-Jones, Ana` |

### Check your work
```bash
pytest test_02_username.py -v
```

### ⭐ Stretch goals
- Print a **warning** if the username is longer than 20 characters (a common system limit). You'll need `if`, from Lesson 03. Peek ahead!
- Generate a **ticket note**: `f"Created account {username} for {display_name}"` padded into a box made of `*`.
- Ask for the hire's department and make the email `username@department.corp.example.com`.

### Commit it
```bash
git add .
git commit -m "Complete lesson 02: new-hire username generator"
git push
```

## Interview questions you can now answer
1. Are strings mutable in Python? What does that mean in practice?
2. What does `text[-3:]` return?
3. How would you remove whitespace from user input?
4. What's an f-string and why is it better than `+`?

**Next:** [Lesson 03 — Conditionals](../03-conditionals/README.md)
