# Phase 0 — Setup

**Goal:** By the end of this you can write a Python file, run it, test it, and save your work to GitHub.

## 1. Open your coding environment

**Option A: GitHub Codespaces (easiest, works in the browser)**
1. Go to this repository on GitHub.
2. Click the green **Code** button → **Codespaces** tab → **Create codespace on main**
   (or on your working branch).
3. Wait a minute. You'll get VS Code in your browser with a terminal at the bottom.

**Option B: Your own computer**
1. Install Python 3.12+ from [python.org](https://www.python.org/downloads/). On Windows, check **"Add Python to PATH"**.
2. Install [VS Code](https://code.visualstudio.com/) and its **Python** extension (by Microsoft).
3. Install [Git](https://git-scm.com/downloads), then `git clone` this repo.

## 2. The terminal: 8 commands you need now

The terminal is where you type commands to the computer. IT and security jobs use it all day,
so get comfortable early.

| Command | What it does | Example |
|---|---|---|
| `pwd` | Show which folder you're in | `pwd` |
| `ls` | List files in this folder | `ls` |
| `cd folder` | Move into a folder | `cd python-to-hired` |
| `cd ..` | Go up one folder | `cd ..` |
| `mkdir name` | Make a folder | `mkdir scratch` |
| `python file.py` | Run a Python file | `python hello.py` |
| `clear` | Clear the screen | `clear` |
| ↑ arrow | Repeat a previous command | |

> Tip: press **Tab** to autocomplete file and folder names. Type `cd pyt` then Tab.

> On some systems the command is `python3` instead of `python`. If `python` doesn't work, use `python3`.

## 3. Your first program

In the terminal:
```bash
cd python-to-hired/00-setup
python --version
python hello.py
```
You should see a greeting. Now open `hello.py`, change the message, save (`Ctrl+S`), and run it again.
You just edited and ran code.

## 4. Install the test tool

Every project in this course comes with **tests**: code that checks your code. Professional
developers write tests all the time, and you'll learn to write your own in Phase 2.

```bash
pip install pytest
pytest test_setup.py -v
```
Green `PASSED` = good. Red `FAILED` shows what went wrong. Try breaking `hello.py` (delete the
print line), re-run the test, and watch it fail. Then fix it.

## 5. Git: saving your work

Git takes snapshots of your code ("commits"). GitHub stores them online. Employers **will** look
at your GitHub.

```bash
git status                       # what changed?
git add .                        # stage all changes for the next snapshot
git commit -m "Complete setup"   # take the snapshot with a message
git push                         # upload to GitHub
```
Good commit messages say *what you did*: `Add ticket intake project`, not `stuff` or `asdf`.

## 6. Turn off Copilot completions (for now)

`Ctrl+Shift+P` → type **Copilot** → choose the option to **disable completions**.
You'll turn it back on in Phase 4. In Phases 1–2 you need to build the skill yourself. Your
interviews will be done without it.

## ✅ Done when
- [ ] `python hello.py` prints your custom message
- [ ] `pytest test_setup.py` passes
- [ ] You've committed and pushed

**Next:** [Lesson 01 — Variables, types, input & math](../phase-1-foundations/01-variables-and-input/README.md)
