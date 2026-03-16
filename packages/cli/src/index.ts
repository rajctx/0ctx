#!/usr/bin/env node
import { parseArgs } from './cli-core/args';
import { normalizeVersionCommandArgs, resolveCommandOperation } from './cli-core/output';
import { runParsedCommand } from './entry/dispatch';
import { runWithoutArgs } from './entry/no-args';
import { createCliRegistry } from './entry/registry';
import { captureEvent, initTelemetry, shutdownTelemetry } from './telemetry';

const cli = createCliRegistry();

async function main(): Promise<number> {
    const argv = normalizeVersionCommandArgs(process.argv.slice(2));
    let deviceId: string | undefined;
    try {
        const state = cli.readConnectorState();
        if (state) deviceId = state.machineId;
    } catch {
        // Read failures only affect telemetry enrichment.
    }
    initTelemetry(deviceId);
    if (argv.length === 0) {
        return runWithoutArgs({
            ...cli,
            captureEvent,
            stdinIsTTY: Boolean(process.stdin.isTTY),
            stdoutIsTTY: Boolean(process.stdout.isTTY),
            shellMode: process.env.CTX_SHELL_MODE === '1'
        });
    }
    const parsed = parseArgs(argv);
    captureEvent('cli_command_executed', { command: parsed.command, subcommand: parsed.subcommand });
    return cli.runCommandWithOpsSummary(resolveCommandOperation(parsed), () => runParsedCommand(parsed, cli), {
        command: parsed.command,
        subcommand: parsed.subcommand ?? null,
        interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY)
    });
}

main()
    .then(async code => {
        await shutdownTelemetry();
        process.exitCode = code;
    })
    .catch(async error => {
        await shutdownTelemetry();
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
