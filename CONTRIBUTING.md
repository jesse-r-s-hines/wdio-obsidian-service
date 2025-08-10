# Contributing

You'll need Node 18 or higher and [pnpm](https://pnpm.io/installation).

To setup local development just clone the repo and run:
```bash
pnpm install
pnpm run build
pnpm run test
```

Sometimes you need to `pnpm install` a second time after the build to get the binaries in the sub-workspaces to setup
correctly (this only seems to be an issue on Windows).

To run tests for a single package, pass the package to the pnpm `--filter` param, e.g.:
```bash
pnpm run -F obsidian-launcher test:unit
```

Make sure to rebuild after any code changes before running the tests again.
