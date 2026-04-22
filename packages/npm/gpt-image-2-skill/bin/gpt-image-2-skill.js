#!/usr/bin/env node
const { runCli } = require("../index.cjs");
process.exit(runCli(process.argv.slice(2)));
