"""Stands in for `openhands` inside asp's launch script: builds the agent context exactly as the
OpenHands CLI does (project skills from the work dir, user skills from HOME, hooks) and reports what
the model would see and what the shadow home provides. No LLM call."""
import json
import os
from pathlib import Path

from openhands.sdk.context import AgentContext, load_project_skills
from openhands.sdk.hooks.config import HookConfig

work = os.environ["OPENHANDS_WORK_DIR"]
ctx = AgentContext(skills=load_project_skills(work), load_user_skills=True, load_public_skills=False)
prompt = ctx.get_system_message_suffix() or ""
home = Path.home()
mcp = home / ".openhands" / "mcp.json"
report = {
    "home_is_shadow": str(home) == os.environ.get("HOME") and "/runs/" in str(home),
    "always_on_instructions": "You are running as the ASP agent" in prompt,
    "project_claude_md_native": "Run migrations before tests." in prompt,
    "skill_advertised": "fix-flaky" in prompt,
    "rule_skill_advertised": "rule-rules-testing" in prompt,
    "memory_index": "Migrations first" in prompt,
    "hooks_loaded": not HookConfig.load(working_dir=work).is_empty(),
    "mcp_secret_expanded": mcp.exists() and json.loads(mcp.read_text())["mcpServers"]["github"]["env"]["GITHUB_TOKEN"] == "probe-token",
    "mcp_file_private": mcp.exists() and mcp.is_symlink() and not str(mcp.resolve()).startswith("/mnt/") and (mcp.resolve().stat().st_mode & 0o077) == 0,
    "real_dotfiles_linked": (home / ".local").is_symlink() or (home / ".bashrc").is_symlink() or (home / ".profile").is_symlink(),
    "real_openhands_untouched": not (home / ".openhands").is_symlink(),
}
print("ASP-PROBE " + json.dumps(report))
