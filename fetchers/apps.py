import sys
import urllib.request
from datetime import datetime, timezone

from .utils import _cfg

_HEALTH_PRIORITY = ["failed", "degraded", "locked", "in_flight", "healthy", "unknown"]


def _check_health(url: str, timeout: int = 5) -> str:
    """GET a health endpoint — 200 = healthy, non-200 = degraded, error = failed."""
    if not url:
        return "unknown"
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return "healthy" if resp.status == 200 else "degraded"
    except Exception:
        return "failed"


def fetch_apps_data(progress=None) -> dict:
    """
    Fetch app health from configurable health endpoints.

    Configure in config.json:
      "apps": [
        {
          "name": "my-api",
          "environments": {
            "production": {
              "health_url":    "https://my-api.com/health",
              "dashboard_url": "https://deploy-tool.example.com/apps/my-api"
            },
            "staging": {
              "health_url":    "https://staging.my-api.com/health",
              "dashboard_url": "https://deploy-tool-staging.example.com/apps/my-api"
            }
          }
        }
      ]

    Returns data keyed under appData[name].deploy so the dashboard renders it
    without modification.
    """
    apps_config = _cfg.get("apps", [])
    if not apps_config:
        return {"appData": {}, "appsRefreshedAt": datetime.now(timezone.utc).isoformat()}

    app_data: dict = {}

    for app in apps_config:
        name = app.get("name", "")
        if not name:
            continue

        envs = app.get("environments", {})
        env_entries: dict = {}

        for env_name, env_cfg in envs.items():
            label = f"Apps {env_name[:4]} {name}..."
            if progress:
                progress.step(label)
            else:
                print(f"  Checking {label}", file=sys.stderr)

            health = _check_health(env_cfg.get("health_url", ""))
            env_entries[env_name] = {
                "appName":         name,
                "environment":     env_name,
                "health":          health,
                "releaseInFlight": False,
                "locked":          False,
                "autodeploy":      None,
                "tier":            None,
                "trackedBranch":   "",
                "latestRelease":   {},
                "services":        [],
                "deployUrl":       env_cfg.get("dashboard_url", ""),
            }

        healths = [e["health"] for e in env_entries.values()]
        overall = min(healths, key=lambda h: _HEALTH_PRIORITY.index(h) if h in _HEALTH_PRIORITY else 99) if healths else "unknown"
        env_entries["health"] = overall

        app_data[name] = {"deploy": env_entries}

    return {
        "appData":         app_data,
        "appsRefreshedAt": datetime.now(timezone.utc).isoformat(),
    }
