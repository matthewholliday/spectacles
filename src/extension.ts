import * as vscode from 'vscode';
import { runInit } from './spectacles/init';
import { runAgentPrompt } from './spectacles/runPrompt';
import { runValidate } from './spectacles/validate';

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('spectacles.init', () => runInit(context)),
		vscode.commands.registerCommand('spectacles.validateProject', () => runValidate()),
		vscode.commands.registerCommand('spectacles.codeToSpec', (uri: vscode.Uri) =>
			runAgentPrompt('code-to-spec', uri)
		),
		vscode.commands.registerCommand('spectacles.specToCode', (uri: vscode.Uri) =>
			runAgentPrompt('spec-to-code', uri)
		),
	);
}
