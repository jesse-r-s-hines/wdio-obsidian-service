#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.14"
# dependencies = ["mitmproxy==12.2.3"]
# ///
"""
Wrapper proxy to cache requests to download Obsidian assets.

Pass the command to wrap, e.g.
    ./scripts/proxy.py -- npx obsidian-launcher watch -v latest
"""
import asyncio, os, sys, tempfile, socket, argparse, shutil
import urllib.request
from pathlib import Path
from mitmproxy.tools.dump import DumpMaster
from mitmproxy.http import HTTPFlow
from mitmproxy.options import Options


def get_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        return s.getsockname()[1]


class Intercept:
    def __init__(self, cache: Path, file_server_url) -> None:
        self.cache = cache
        self.file_server_url = file_server_url
        self.ready = asyncio.Event()

    def running(self) -> None:
        self.ready.set()

    def request(self, flow: HTTPFlow) -> None:
        prefixes = [
            "https://github.com/obsidianmd/obsidian-releases/releases/download/",
            "https://releases.obsidian.md/release/",
        ]
        if any(flow.request.url.startswith(p) for p in prefixes):
            name = flow.request.url.split("/")[-1]
            cache_path = self.cache / name
            if not cache_path.exists():
                cache_path.parent.mkdir(exist_ok=True, parents=True)
                tmp = cache_path.parent / f".{cache_path.name}.tmp"
                headers = {k: v for k, v in flow.request.headers.items() if k != 'host'}
                request = urllib.request.Request(flow.request.url, headers=headers)
                with urllib.request.urlopen(request) as response, open(tmp, "wb") as f:
                    shutil.copyfileobj(response, f)
                tmp.rename(cache_path)
            flow.request.url = f'{self.file_server_url}/{name}'


async def run_proxy(cmd: list[str], cache: Path) -> int:
    file_server_port = get_free_port()
    proxy_port = get_free_port()
    confdir = Path(tempfile.mkdtemp(prefix="mitmproxy-"))
    cache.mkdir(exist_ok=True, parents=True)

    file_server = await asyncio.subprocess.create_subprocess_exec(
        sys.executable, "-m", "http.server", str(file_server_port),
        cwd=cache, stderr=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.DEVNULL,
    )
    proxy_server = DumpMaster(
        Options(listen_host="127.0.0.1", listen_port=proxy_port, confdir=str(confdir)),
        with_termlog=False, with_dumper=False,
    )
    intercept = Intercept(cache, f"http://127.0.0.1:{file_server_port}")
    proxy_server.addons.add(intercept)

    proxy_server_task = asyncio.ensure_future(proxy_server.run())
    try:
        await intercept.ready.wait()

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            env={
                **os.environ,
                "HTTP_PROXY": f"http://127.0.0.1:{proxy_port}", "HTTPS_PROXY": f"http://127.0.0.1:{proxy_port}",
                "NO_PROXY": "", "NODE_USE_ENV_PROXY": "1",
                "NODE_EXTRA_CA_CERTS": str(confdir / "mitmproxy-ca-cert.pem"),
            },
        )
        return await proc.wait()
    finally:
        proxy_server.shutdown()
        file_server.terminate()
        await proxy_server_task
        await file_server.wait()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description = __doc__.strip(),
        allow_abbrev = False,
        formatter_class = argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('--cache', required=True, type=Path)
    parser.add_argument("cmd", nargs='+')
    args = parser.parse_args()

    try:
        sys.exit(asyncio.run(run_proxy(cmd=args.cmd, cache=args.cache)))
    except KeyboardInterrupt:
        sys.exit(130)
