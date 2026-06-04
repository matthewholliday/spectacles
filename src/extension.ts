import * as vscode from 'vscode';
import { runInit } from './spectacles/init';
import { runNewSpec } from './spectacles/newSpec';
import { runAgentPrompt } from './spectacles/runPrompt';
import { runValidate } from './spectacles/validate';
import { runViewBundleStatus } from './spectacles/viewBundle';
import { RequirementsEditorProvider } from './spectacles/requirementsEditor';
import { DesignEditorProvider } from './spectacles/designEditor';

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		RequirementsEditorProvider.register(context),
		DesignEditorProvider.register(context),
		vscode.commands.registerCommand('spectacles.init', () => runInit(context)),
		vscode.commands.registerCommand('spectacles.validateProject', () => runValidate()),
		vscode.commands.registerCommand('spectacles.newSpec', () => runNewSpec()),
		vscode.commands.registerCommand('spectacles.codeToSpec', (uri: vscode.Uri) =>
			runAgentPrompt('code-to-spec', uri)
		),
		vscode.commands.registerCommand('spectacles.specToCode', (uri: vscode.Uri) =>
			runAgentPrompt('spec-to-code', uri)
		),
		vscode.commands.registerCommand('spectacles.viewBundleStatus', (uri: vscode.Uri) =>
			runViewBundleStatus(uri, context)
		),
	);
}
