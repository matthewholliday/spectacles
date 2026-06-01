import { exec } from 'child_process';
import * as vscode from 'vscode';
import {
	getWorkspaceRootUri,
	pathExists,
	resolveLayoutUri,
} from './layout';

const OUTPUT_CHANNEL_NAME = 'Spectacles';

let outputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel {
	if (!outputChannel) {
		outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
	}
	return outputChannel;
}

export async function runWorkspaceScript(
	scriptName: string,
	uri: vscode.Uri
): Promise<void> {
	if (!uri) {
		vscode.window.showErrorMessage('No file selected.');
		return;
	}

	const root = getWorkspaceRootUri();
	if (!root) {
		vscode.window.showErrorMessage('Open a folder/workspace first.');
		return;
	}

	const scriptUri = resolveLayoutUri(root, `.spectacles/scripts/${scriptName}`);
	if (!(await pathExists(scriptUri))) {
		vscode.window.showErrorMessage(
			`Script not found: .spectacles/scripts/${scriptName}. Run Spectacles: Init first.`
		);
		return;
	}

	const scriptPath = scriptUri.fsPath;
	const filePath = uri.fsPath;
	const output = getOutputChannel();
	const command = `bash "${scriptPath}" "${filePath}"`;

	output.clear();
	output.appendLine(`$ ${command}`);
	output.show(true);

	exec(command, (error, stdout, stderr) => {
		if (stdout.trim()) {
			output.appendLine(stdout.trimEnd());
		}
		if (stderr.trim()) {
			output.appendLine(stderr.trimEnd());
		}

		if (error) {
			const detail = stderr.trim() || error.message;
			output.appendLine(`Exit code: ${error.code ?? 1}`);
			vscode.window.showErrorMessage(`Error: ${detail}`);
			return;
		}

		vscode.window.showInformationMessage(
			`${scriptName} finished. See Output → ${OUTPUT_CHANNEL_NAME}.`
		);
	});
}
