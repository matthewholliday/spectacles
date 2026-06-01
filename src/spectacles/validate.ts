import * as vscode from 'vscode';
import {
	getWorkspaceRootUri,
	SPECTACLES_LAYOUT,
	validateLayoutEntry,
} from './layout';

export async function runValidate(): Promise<void> {
	const root = getWorkspaceRootUri();
	if (!root) {
		vscode.window.showErrorMessage('Open a folder/workspace first.');
		return;
	}

	const missing: string[] = [];
	for (const entry of SPECTACLES_LAYOUT) {
		const missingPath = await validateLayoutEntry(root, entry);
		if (missingPath) {
			missing.push(missingPath);
		}
	}

	if (missing.length === 0) {
		vscode.window.showInformationMessage('Spectacles project layout is valid.');
		return;
	}

	const message = `Spectacles project layout is invalid. Missing:\n${missing.map((p) => `• ${p}`).join('\n')}`;
	vscode.window.showErrorMessage(message);
}
