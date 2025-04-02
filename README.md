[![Test](https://github.com/jesse-r-s-hines/wdio-obsidian-service/actions/workflows/test.yaml/badge.svg?branch=main)](https://github.com/jesse-r-s-hines/wdio-obsidian-service/actions/workflows/test.yaml)
# WDIO Obsidian Service

Test your [Obsidian](https://obsidian.md) plugins end-to-end using [WebdriverIO](https://webdriver.io)!

For instructions on how to set up e2e tests using `wdio-obsidian-service` see the
[wdio-obsidian-service README](./packages/wdio-obsidian-service/README.md) or get started quickly by using the 
[sample plugin](https://github.com/jesse-r-s-hines/wdio-obsidian-service-sample-plugin) as a template.

This project is split into several NPM packages:
- [wdio-obsidian-service](./packages/wdio-obsidian-service/README.md): A WebdriverIO service to test Obsidian plugins
- [obsidian-launcher](./packages/obsidian-launcher/README.md): Package for downloading and launching different versions of Obsidian
- [wdio-obsidian-reporter](./packages/wdio-obsidian-reporter/README.md): Wrapper around [@wdio/spec-reporter](https://www.npmjs.com/package/@wdio/spec-reporter) that logs Obsidian version instead of Chromium version

API docs for all the packages are available [here](https://jesse-r-s-hines.github.io/wdio-obsidian-service).

## Contributing
PRs and issues welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for instructions on how to setup local development.

