#!/usr/bin/env node
import { runTaskboardCli } from "../index.js";

const exitCode = await runTaskboardCli();
process.exitCode = exitCode;
