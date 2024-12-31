#!/bin/env node
import { Command } from 'commander';

const program = new Command("obsidian-plugin-testing-library");

const run = new Command("run")
    .option('-s, --subtract')
    .argument('<a>', 'A')
    .argument('<b>', 'B')
    .action((a, b, opts) => {
        if (opts.subtract) {
            console.log(`RUN ${a} - ${b} = ${(+a) - (+b)}`)
        } else {
            console.log(`RUN ${a} + ${b} = ${(+a) + (+b)}`)
        }
    })

program
  .version(process.env.npm_package_version ?? "dev")
  .addCommand(run)

program.parse();
