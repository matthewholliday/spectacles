import * as vscode from 'vscode';
import { runInit } from './spectacles/init';
import { runWorkspaceScript } from './spectacles/runScript';
import { runValidate } from './spectacles/validate';

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('spectacles.init', () => runInit(context)),
		vscode.commands.registerCommand('spectacles.validateProject', () => runValidate()),
		vscode.commands.registerCommand('spectacles.codeToSpec', (uri: vscode.Uri) =>
			runWorkspaceScript('code-to-spec.sh', uri)
		),
		vscode.commands.registerCommand('spectacles.specToCode', (uri: vscode.Uri) =>
			runWorkspaceScript('spec-to-code.sh', uri)
		),
	);
}
