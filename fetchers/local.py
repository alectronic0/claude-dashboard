import json
import os
import re
import sys

from .utils import JIRA_PROJECT


def _parse_skill_description(filepath):
    """Extract first description line from SKILL.md YAML frontmatter."""
    try:
        with open(filepath) as f:
            lines = f.read().splitlines()
        in_fm = in_desc = False
        for line in lines:
            if line.strip() == "---":
                if not in_fm:
                    in_fm = True
                    continue
                break
            if not in_fm:
                continue
            if line.startswith("description:"):
                rest = line.split(":", 1)[1].strip()
                if rest and rest != "|":
                    return rest.strip("'\"")
                in_desc = True
                continue
            if in_desc and line.startswith(" ") and line.strip():
                return line.strip()
    except Exception:
        pass
    return ""


def fetch_claude_data(progress=None):
    """Read Claude filesystem: skills, agents, hooks, MCP server names."""
    if progress:
        progress.step("Reading Claude filesystem...")
    else:
        print("  Reading Claude filesystem...", file=sys.stderr)

    claude_dir = os.path.expanduser("~/.claude")
    data = {"skills": [], "agents": [], "hooks": {}, "mcpServers": []}

    skills_dir = os.path.join(claude_dir, "skills")
    if os.path.isdir(skills_dir):
        for name in sorted(os.listdir(skills_dir)):
            skill_file = os.path.join(skills_dir, name, "SKILL.md")
            if os.path.isfile(skill_file):
                data["skills"].append({
                    "name":        name,
                    "description": _parse_skill_description(skill_file),
                })

    agents_dir = os.path.join(claude_dir, "agents")
    if os.path.isdir(agents_dir):
        for f in sorted(os.listdir(agents_dir)):
            if f.endswith(".md"):
                data["agents"].append({"name": f[:-3]})

    settings_path = os.path.join(claude_dir, "settings.json")
    if os.path.isfile(settings_path):
        try:
            with open(settings_path) as f:
                settings = json.load(f)
            data["hooks"] = {k: len(v) for k, v in settings.get("hooks", {}).items()}
        except Exception as e:
            print(f"  Warning: could not read settings.json — {e}", file=sys.stderr)

    claude_json = os.path.expanduser("~/.claude.json")
    if os.path.isfile(claude_json):
        try:
            with open(claude_json) as f:
                config = json.load(f)
            data["mcpServers"] = sorted(config.get("mcpServers", {}).keys())
        except Exception as e:
            print(f"  Warning: could not read .claude.json — {e}", file=sys.stderr)

    return data


def parse_internal_priorities():
    """Parse internal priority overrides from active-work.md."""
    active_work_path = os.path.expanduser("~/.claude/memory/active-work.md")
    result = {}
    try:
        with open(active_work_path) as f:
            content = f.read()
        in_section = False
        for line in content.splitlines():
            if line.strip() == "## Internal Priority Overrides":
                in_section = True
                continue
            if in_section and line.startswith("## "):
                break
            if not in_section or not line.startswith("|"):
                continue
            if line.startswith("|---") or "Ticket" in line.split("|")[1:2]:
                continue
            parts = [p.strip() for p in line.split("|")]
            parts = [p for p in parts if p]
            if len(parts) >= 2:
                result[parts[0]] = parts[1]
    except Exception as e:
        print(f"  Warning: could not parse internal priorities — {e}", file=sys.stderr)
    return result


def parse_next_actions():
    """Parse next actions from the Dashboard — Work table in active-work.md."""
    active_work_path = os.path.expanduser("~/.claude/memory/active-work.md")
    result = {}
    try:
        with open(active_work_path) as f:
            content = f.read()
        in_work = False
        for line in content.splitlines():
            if line.strip() == "## Dashboard — Work":
                in_work = True
                continue
            if in_work and line.startswith("## "):
                break
            if not in_work or not line.startswith("|"):
                continue
            if line.startswith("|---") or "Ticket" in line.split("|")[1:2]:
                continue
            parts = [p.strip() for p in line.split("|")]
            parts = [p for p in parts if p != ""]
            if len(parts) < 5:
                continue
            keys        = re.findall(rf'{re.escape(JIRA_PROJECT)}-\d+', parts[1]) if JIRA_PROJECT else []
            next_action = re.sub(r'\*\*([^*]+)\*\*', r'\1', parts[4])
            for key in keys:
                result[key] = next_action
    except Exception as e:
        print(f"  Warning: could not parse active-work.md next actions — {e}", file=sys.stderr)
    return result


def fetch_plans(progress=None):
    """Read plan files and match with Plans table from active-work.md."""
    if progress:
        progress.step("Reading plans...")
    else:
        print("  Reading plans...", file=sys.stderr)

    plans_dir        = os.path.expanduser("~/.claude/plans")
    active_work_path = os.path.expanduser("~/.claude/memory/active-work.md")

    plan_meta = {}
    try:
        with open(active_work_path) as f:
            content = f.read()
        in_plans = False
        for line in content.splitlines():
            if line.startswith("## Plans"):
                in_plans = True
                continue
            if in_plans and line.startswith("## "):
                break
            if not in_plans or not line.startswith("|"):
                continue
            if line.startswith("|---") or "Plan" in line.split("|")[1:2]:
                continue
            parts = [p.strip() for p in line.split("|") if p.strip()]
            if len(parts) < 3:
                continue
            m = re.match(r'\[([^\]]+)\]\(([^)]+)\)', parts[0])
            if not m:
                continue
            name     = m.group(1)
            filename = os.path.basename(m.group(2))
            what     = parts[1]
            kickoff  = parts[2].strip('"').strip("'")
            plan_meta[filename] = {"name": name, "what": what, "kickoff": kickoff}
    except Exception as e:
        print(f"  Warning: could not parse active-work.md plans — {e}", file=sys.stderr)

    plans = []
    if os.path.isdir(plans_dir):
        for f in sorted(os.listdir(plans_dir)):
            if not f.endswith(".md"):
                continue
            meta         = plan_meta.get(f, {})
            default_name = f[:-3].replace("-", " ").title()
            name         = meta.get("name", default_name)
            plans.append({
                "filename":     f,
                "name":         name,
                "what":         meta.get("what", ""),
                "kickoff":      meta.get("kickoff", f"Let's look into {name}, what can you tell me about this before we start?"),
                "inPlansTable": f in plan_meta,
            })
    return plans
