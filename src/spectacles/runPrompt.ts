import * as vscode from 'vscode';

const OUTPUT_CHANNEL_NAME = 'Spectacles';

let outputChannel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
	if (!outputChannel) {
		outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
	}
	return outputChannel;
}
