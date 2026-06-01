import * as vscode from 'vscode';

export type LayoutEntryType = 'directory' | 'file';

export interface LayoutEntry {
	relativePath: string;
	type: LayoutEntryType;
}

export const SPECTACLES_LAYOUT: LayoutEntry[] = [
	{ relativePath: '.spectacles', type: 'directory' },
	{ relativePath: '.spectacles/specs', type: 'directory' },
	{ relativePath: '.spectacles/scripts', type: 'directory' },
	{ relativePath: '.spectacles/scripts/code-to-spec.sh', type: 'file' },
	{ relativePath: '.spectacles/scripts/spec-to-code.sh', type: 'file' },
];

export function getWorkspaceRootUri(): vscode.Uri | undefined {
	return vscode.workspace.workspaceFolders?.[0]?.uri;
}

export function resolveLayoutUri(root: vscode.Uri, relativePath: string): vscode.Uri {
	return vscode.Uri.joinPath(root, ...relativePath.split('/'));
}

export async function pathExists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

export async function validateLayoutEntry(
	root: vscode.Uri,
	entry: LayoutEntry
): Promise<string | undefined> {
	const uri = resolveLayoutUri(root, entry.relativePath);
	if (!(await pathExists(uri))) {
		return entry.relativePath;
	}
	try {
		const stat = await vscode.workspace.fs.stat(uri);
		if (entry.type === 'directory' && stat.type !== vscode.FileType.Directory) {
			return entry.relativePath;
		}
		if (entry.type === 'file' && stat.type !== vscode.FileType.File) {
			return entry.relativePath;
		}
	} catch {
		return entry.relativePath;
	}
	return undefined;
}
