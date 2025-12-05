// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { getEnvExtApi } from './pythonEnvsApi';
import { MicromambaEnvManager } from './micromambaEnvManager';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
    const msg = "⚠️ This extension is deprecated. Please install the new 'Micromamba Envs' version for better stability and performance.";
    const btnLabel = "Install New Version";

    // Show warning with a button to open the new extension page
    vscode.window.showWarningMessage(msg, btnLabel).then(selection => {
        if (selection === btnLabel) {
            // Opens the new extension page directly in VS Code
            vscode.commands.executeCommand('extension.open', 'symzn.vscode-micromamba-envs');
        }
    });
    const api = await getEnvExtApi();

    const log = vscode.window.createOutputChannel('Micromamba Environment Manager', { log: true });
    context.subscriptions.push(log);
    const manager = new MicromambaEnvManager(api, log, context);
    context.subscriptions.push(api.registerEnvironmentManager(manager));
}

// This method is called when your extension is deactivated
export function deactivate() {}