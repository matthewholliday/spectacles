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
const PROMPT_TEMPLATES = ['code-to-spec.md', 'spec-to-code.md'] as const;
const FRAGMENT_TEMPLATES = ['plan.md'] as const;

export async function runInit(context: vscode.ExtensionContext): Promise<void> {
	const root = getWorkspaceRootUri();
	if (!root) {
		vscode.window.showErrorMessage('Open a folder/workspace first.');
		return;
	}

	const spectaclesDir = resolveLayoutUri(root, '.spectacles');
	const alreadyInitialized = await pathExists(spectaclesDir);

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

	for (const promptName of PROMPT_TEMPLATES) {
		const templatePath = path.join(
			context.extensionPath,
			'resources',
			'prompts',
			promptName
		);
		const content = await fs.readFile(templatePath);
		const destUri = resolveLayoutUri(root, `.spectacles/prompts/${promptName}`);
		await vscode.workspace.fs.writeFile(destUri, content);
	}

	for (const fragmentName of FRAGMENT_TEMPLATES) {
		const templatePath = path.join(
			context.extensionPath,
			'resources',
			'prompts',
			'fragments',
			fragmentName
		);
		const content = await fs.readFile(templatePath);
		const destUri = resolveLayoutUri(root, `.spectacles/prompts/fragments/${fragmentName}`);
		await vscode.workspace.fs.writeFile(destUri, content);
	}

	if (alreadyInitialized) {
		vscode.window.showInformationMessage('Spectacles project files updated.');
	} else {
		vscode.window.showInformationMessage(
			'Spectacles initialized. On Unix, run chmod +x on scripts in .spectacles/scripts/ if needed.'
		);
	}
}
