# Contributing

You'll need Node 18 or higher and npm.

To setup local development just clone the repo and run:
```bash
npm install
npm run build
npm test
```

Sometimes you need to `npm install` a second time after the build to get the binaries in the sub-workspaces to setup
correctly (this only seems to be an issue on Windows).

To run tests for a single package, pass the package to the npm `--workspace` param, e.g.:
```bash
npm run -w packages/obsidian-launcher test:unit
```

Make sure to rebuild after any code changes before running the tests again.
