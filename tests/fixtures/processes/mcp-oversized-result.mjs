const bytes = Number(process.env.FIXTURE_RESULT_BYTES ?? 16 * 1024 * 1024 + 1);
process.stdin.resume();
process.stdin.once("end", () => process.stdout.write("x".repeat(bytes)));
