import * as vscode from 'vscode';
import { runInit } from './spectacles/init';
import { runNewSpec } from './spectacles/newSpec';
import { runValidate } from './spectacles/validate';
import { runViewBundleStatus } from './spectacles/viewBundle';
import { RequirementsEditorProvider } from './spectacles/requirementsEditor';
import { DesignEditorProvider } from './spectacles/designEditor';
import { HomePageViewProvider } from './spectacles/homePage';

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		RequirementsEditorProvider.register(context),
		DesignEditorProvider.register(context),
		vscode.window.registerWebviewViewProvider(
			HomePageViewProvider.viewId,
			new HomePageViewProvider(context.extensionUri, context)
		),
		vscode.commands.registerCommand('spectacles.openHomePage', () =>
			vscode.commands.executeCommand(`${HomePageViewProvider.viewId}.focus`)
		),
		vscode.commands.registerCommand('spectacles.init', () => runInit(context)),
		vscode.commands.registerCommand('spectacles.validateProject', () => runValidate()),
		vscode.commands.registerCommand('spectacles.newSpec', () => runNewSpec()),
		vscode.commands.registerCommand('spectacles.viewBundleStatus', (uri: vscode.Uri) =>
			runViewBundleStatus(uri, context)
		),
	);
}
