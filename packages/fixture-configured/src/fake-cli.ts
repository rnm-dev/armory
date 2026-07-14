#!/usr/bin/env node
if (process.argv.includes("--version")) {
  process.stdout.write("fixture-cli 1.0.0\n");
} else {
  process.stdout.write("fixture-cli\n");
}
