"""One-shot deploy: local public+dist -> 10.20.49.60. Usage: python tools/_deploy_p5_once.py"""
from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import paramiko

REPO = Path(__file__).resolve().parents[1]
HOST = os.environ.get("TOWER_DEPLOY_HOST", "10.20.49.60")
USER = os.environ.get("TOWER_DEPLOY_USER", "root")
PASSWORD = os.environ.get("TOWER_DEPLOY_PASSWORD", "cloudmap")
BACKEND_ROOT = "/root/compute-tower/backend"


def run(ssh: paramiko.SSHClient, cmd: str, timeout: int = 600) -> tuple[int, str]:
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = (stdout.read() + stderr.read()).decode("utf-8", errors="replace")
    return stdout.channel.recv_exit_status(), out


def git_short() -> str:
    try:
        return (
            subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=REPO, text=True)
            .strip()
        )
    except Exception:
        return "unknown"


def main() -> None:
    fe_build = REPO / "frontend" / "build"
    be_dist = REPO / "backend" / "dist"
    be_pkg = REPO / "backend" / "package.json"
    if not fe_build.is_dir():
        raise SystemExit(f"missing frontend build: {fe_build}")
    if not be_dist.is_dir():
        raise SystemExit(f"missing backend dist: {be_dist}")

    commit = git_short()
    stamp = {
        "builtAt": datetime.now(timezone.utc).isoformat(),
        "version": "1.0.3",
        "gitCommit": commit,
        "features": [
            "p5-srv6-hub-conflict-reuse-vrf",
            "fix-hub-reuse-vrf-false-conflicts",
            "fix-hub-alert-copy",
        ],
    }
    stamp_path = fe_build / ".tower-build-stamp.json"
    stamp_path.write_text(json.dumps(stamp, ensure_ascii=False), encoding="utf-8")

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_name = f"backup-tower-{ts}.tar.gz"

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        stage = tmp_path / "stage"
        public_dir = stage / "public"
        dist_dir = stage / "dist"

        def copy_tree(src: Path, dst: Path) -> None:
            import shutil

            if dst.exists():
                shutil.rmtree(dst)
            shutil.copytree(src, dst)

        copy_tree(fe_build, public_dir)
        copy_tree(be_dist, dist_dir)
        (stage / "package.json").write_bytes(be_pkg.read_bytes())

        tarball = tmp_path / "tower-deploy.tar.gz"
        with tarfile.open(tarball, "w:gz") as tar:
            tar.add(stage / "public", arcname="public")
            tar.add(stage / "dist", arcname="dist")
            tar.add(stage / "package.json", arcname="package.json")

        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect(HOST, username=USER, password=PASSWORD, timeout=30)

        code, out = run(
            ssh,
            f"cd {BACKEND_ROOT} && tar czf /root/{backup_name} public dist package.json 2>/dev/null; echo BACKUP_OK",
        )
        print(out)

        sftp = ssh.open_sftp()
        remote_tar = f"/root/tower-deploy-{ts}.tar.gz"
        sftp.put(str(tarball), remote_tar)
        sftp.close()

        cmds = [
            f"cd {BACKEND_ROOT} && rm -rf public dist && tar xzf {remote_tar} -C {BACKEND_ROOT}",
            f"cd {BACKEND_ROOT} && npm install --omit=dev 2>&1 | tail -15",
            "pm2 restart compute-tower",
        ]
        for c in cmds:
            code, out = run(ssh, c, timeout=900)
            sys.stdout.buffer.write(
                f"=== {c[:80]} ===\n{out}\nexit={code}\n\n".encode("utf-8", errors="replace")
            )

        import time

        time.sleep(10)
        for c in [
            "curl -s -o /dev/null -w %{http_code} http://127.0.0.1:5001/",
            f"grep -l isIdempotentHubIpv6Route {BACKEND_ROOT}/dist/src/routes/sdn/srv6.conflict.js && echo CONFLICT_JS_OK",
            f"cat {BACKEND_ROOT}/public/.tower-build-stamp.json",
            "pm2 list | head -6",
        ]:
            code, out = run(ssh, c)
            sys.stdout.buffer.write(
                (f"=== {c} ===\n{out.strip()}\n\n").encode("utf-8", errors="replace")
            )

        ssh.close()
        print(f"DEPLOY_DONE host={HOST} commit={commit} backup=/root/{backup_name}")


if __name__ == "__main__":
    main()
