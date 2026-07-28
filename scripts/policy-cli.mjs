import process from "node:process";
import { runPolicy } from "./policy.mjs";

try {
  runPolicy();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
