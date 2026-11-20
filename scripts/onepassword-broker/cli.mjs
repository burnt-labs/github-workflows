import { writeBrokerConfiguration } from "./reader.mjs";

try {
  await writeBrokerConfiguration(process.env);
} catch (error) {
  process.stderr.write(`::error::${error.message}\n`);
  process.exitCode = 1;
}
