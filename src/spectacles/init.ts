import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import {
	getWorkspaceRootUri,
	pathExists,
	resolveLayoutUri,
	SPECTACLES_LAYOUT,
} from './layout';

const SCRIPT_TEMPLATES = ['code-to-spec.sh', 'spec-to-code.sh'] as const;

export async function runInit(context: vscode.ExtensionContext): Promise<void> {
	const root = getWorkspaceRootUri();
	if (!root) {
		vscode.window.showErrorMessage('Open a folder/workspace first.');
		return;
	}

	const spectaclesDir = resolveLayoutUri(root, '.spectacles');
	if (await pathExists(spectaclesDir)) {
		vscode.window.showWarningMessage(
			'Spectacles is already initialized (.spectacles exists).'
		);
		return;
	}

	for (const entry of SPECTACLES_LAYOUT) {
		if (entry.type === 'directory') {
			await vscode.workspace.fs.createDirectory(resolveLayoutUri(root, entry.relativePath));
		}
	}

	for (const scriptName of SCRIPT_TEMPLATES) {
		const templatePath = path.join(
			context.extensionPath,
			'resources',
			'scripts',
			scriptName
		);
		const content = await fs.readFile(templatePath);
		const destUri = resolveLayoutUri(root, `.spectacles/scripts/${scriptName}`);
		await vscode.workspace.fs.writeFile(destUri, content);
	}

	vscode.window.showInformationMessage(
		'Spectacles initialized. On Unix, run chmod +x on scripts in .spectacles/scripts/ if needed.'
	);
}
