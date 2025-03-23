[![Test](https://github.com/jesse-r-s-hines/wdio-obsidian-service/actions/workflows/test.yaml/badge.svg?branch=main)](https://github.com/jesse-r-s-hines/wdio-obsidian-service/actions/workflows/test.yaml)
# WDIO Obsidian Service

This is a collection of npm packages for end to end testing [Obsidian](https://obsidian.md) plugins:
- [wdio-obsidian-service](packages/wdio-obsidian-service/README.md): A [WebdriverIO](https://webdriver.io) service to test Obsidian plugins
- [obsidian-launcher](packages/obsidian-launcher/README.md): package for downloading and launching different versions of Obsidian
- [wdio-obsidian-reporter](packages/wdio-obsidian-reporter/README.md): Wrapper around [@wdio/spec-reporter](https://www.npmjs.com/package/@wdio/spec-reporter) that logs Obsidian version instead of Chromium version

For how to set up e2e tests for Obsidian plugins see
[`wdio-obsidian-service`](https://jesse-r-s-hines.github.io/wdio-obsidian-service/modules/wdio-obsidian-service.html) or
the [sample plugin](https://github.com/jesse-r-s-hines/wdio-obsidian-service-sample-plugin).

API docs for all the packages are available [here](https://jesse-r-s-hines.github.io/wdio-obsidian-service/index.html).

## Contributing
PRs and issues welcome! To setup local development just clone the repo and run:
```
npm install
npm run build // make sure to re-build before re-running tests
npm test
```

Sometimes you need to install a second time after the build to get the binaries to setup right. You'll need Node 18 or
higher.
