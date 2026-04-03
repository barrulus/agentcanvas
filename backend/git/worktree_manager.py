"""Git worktree management for agent isolation."""

import asyncio
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


class WorktreeManager:
    """Creates and manages git worktrees for agent sessions."""

    async def _run_git(self, *args: str, cwd: str | None = None) -> tuple[int, str, str]:
        proc = await asyncio.create_subprocess_exec(
            "git", *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
        )
        stdout, stderr = await proc.communicate()
        return (
            proc.returncode or 0,
            stdout.decode("utf-8", errors="replace").strip(),
            stderr.decode("utf-8", errors="replace").strip(),
        )

    async def _get_repo_root(self, path: str) -> str | None:
        """Get the git repo root for a given path, or None if not a git repo."""
        rc, out, _ = await self._run_git("rev-parse", "--show-toplevel", cwd=path)
        return out if rc == 0 else None

    async def create_worktree(self, repo_path: str) -> str | None:
        """Create a worktree for a session. Returns worktree path, or None if not a git repo."""
        root = await self._get_repo_root(repo_path)
        if not root:
            return None

        import uuid
        session_short = uuid.uuid4().hex[:8]
        wt_dir = Path(root) / ".agentcanvas-worktrees"
        wt_dir.mkdir(exist_ok=True)

        wt_path = wt_dir / session_short
        branch_name = f"agentcanvas/{session_short}"

        rc, _, err = await self._run_git(
            "worktree", "add", str(wt_path), "-b", branch_name,
            cwd=root,
        )
        if rc != 0:
            logger.error("Failed to create worktree: %s", err)
            return None

        logger.info("Created worktree at %s on branch %s", wt_path, branch_name)
        return str(wt_path)

    async def remove_worktree(self, worktree_path: str, repo_path: str | None = None) -> None:
        """Remove a worktree and its branch."""
        cwd = repo_path or str(Path(worktree_path).parent.parent)

        rc, _, err = await self._run_git("worktree", "remove", worktree_path, "--force", cwd=cwd)
        if rc != 0:
            logger.warning("Failed to remove worktree %s: %s", worktree_path, err)

    async def get_diff(self, worktree_path: str) -> str:
        """Get combined staged and unstaged diff from a worktree."""
        _, unstaged, _ = await self._run_git("diff", cwd=worktree_path)
        _, staged, _ = await self._run_git("diff", "--cached", cwd=worktree_path)
        parts = []
        if staged:
            parts.append(f"=== Staged Changes ===\n{staged}")
        if unstaged:
            parts.append(f"=== Unstaged Changes ===\n{unstaged}")
        return "\n\n".join(parts) if parts else "No changes"

    async def get_status(self, worktree_path: str) -> list[dict]:
        """Get git status as a list of {status, path} dicts."""
        _, out, _ = await self._run_git("status", "--porcelain", cwd=worktree_path)
        result = []
        for line in out.splitlines():
            if len(line) >= 4:
                result.append({"status": line[:2].strip(), "path": line[3:]})
        return result
