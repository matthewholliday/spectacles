import { spawn } from 'child_process';
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

	const child = spawn('cursor', ['agent', '--print', fullPrompt], {
		cwd: root.fsPath,
		shell: false,
	});

	child.stdout.on('data', (data: Buffer) => {
		output.append(data.toString());
	});

	child.stderr.on('data', (data: Buffer) => {
		output.append(data.toString());
	});

	await new Promise<void>((resolve) => {
		child.on('close', (code) => {
			output.appendLine('');
			if (code !== 0) {
				output.appendLine(`[spectacles] exited with code ${code}`);
				vscode.window.showErrorMessage(
					`${promptName} failed (exit ${code}). See Output → ${OUTPUT_CHANNEL_NAME}.`
				);
			} else {
				output.appendLine('[spectacles] done');
				vscode.window.showInformationMessage(
					`${promptName} finished. See Output → ${OUTPUT_CHANNEL_NAME}.`
				);
			}
			resolve();
		});

		child.on('error', (err) => {
			output.appendLine(`[spectacles] error: ${err.message}`);
			vscode.window.showErrorMessage(`${promptName} error: ${err.message}`);
			resolve();
		});
	});
}
