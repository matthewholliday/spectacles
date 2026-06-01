import { Agent, CursorAgentError } from '@cursor/sdk';
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

async function readWorkspaceFile(uri: vscode.Uri): Promise<string> {
	const bytes = await vscode.workspace.fs.readFile(uri);
	return Buffer.from(bytes).toString('utf8');
}

export async function runAgentPrompt(
	promptName: 'code-to-spec' | 'spec-to-code',
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

	const apiKey = process.env.CURSOR_API_KEY;
	if (!apiKey) {
		vscode.window.showErrorMessage(
			'CURSOR_API_KEY is not set. Export it in your shell environment before launching VS Code.'
		);
		return;
	}

	const planUri = resolveLayoutUri(root, '.spectacles/prompts/fragments/plan.md');
	const promptUri = resolveLayoutUri(root, `.spectacles/prompts/${promptName}.md`);

	if (!(await pathExists(planUri))) {
		vscode.window.showErrorMessage('plan.md not found. Run Spectacles: Init first.');
		return;
	}
	if (!(await pathExists(promptUri))) {
		vscode.window.showErrorMessage(
			`${promptName}.md not found. Run Spectacles: Init first.`
		);
		return;
	}

	const planContent = await readWorkspaceFile(planUri);
	const promptContent = await readWorkspaceFile(promptUri);
	const filePath = uri.fsPath;

	const fullPrompt = `${planContent}\n\n${promptContent}${filePath}\n`;

	const output = getOutputChannel();
	output.clear();
	output.appendLine(`[spectacles] ${promptName} → ${filePath}`);
	output.appendLine('');
	output.show(true);

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `Spectacles: running ${promptName}...`,
			cancellable: false,
		},
		async () => {
			try {
				const result = await Agent.prompt(fullPrompt, {
					apiKey,
					local: { cwd: root.fsPath },
				});

				if (result.result) {
					output.appendLine(result.result);
					output.appendLine('');
				}

				if (result.status === 'error') {
					output.appendLine(`[spectacles] run failed (id: ${result.id})`);
					vscode.window.showErrorMessage(
						`${promptName} failed. See Output → ${OUTPUT_CHANNEL_NAME}.`
					);
				} else {
					output.appendLine(`[spectacles] done (status: ${result.status}, id: ${result.id})`);
					vscode.window.showInformationMessage(
						`${promptName} finished. See Output → ${OUTPUT_CHANNEL_NAME}.`
					);
				}
			} catch (err: unknown) {
				if (err instanceof CursorAgentError) {
					output.appendLine(`[spectacles] startup failed: ${err.message}`);
					vscode.window.showErrorMessage(`${promptName} startup error: ${err.message}`);
				} else {
					const message = err instanceof Error ? err.message : String(err);
					output.appendLine(`[spectacles] error: ${message}`);
					vscode.window.showErrorMessage(`${promptName} error: ${message}`);
				}
			}
		}
	);
}
