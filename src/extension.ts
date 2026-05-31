import * as vscode from 'vscode';
import { exec } from 'child_process';

export function activate(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('my-plugin.runShellScript', (uri: vscode.Uri) => {
        // uri is the file/folder you right-clicked on
        if (!uri) {
            vscode.window.showErrorMessage("No file selected.");
            return;
        }

        const filePath = uri.fsPath;
        const scriptPath = "/absolute/path/to/your/script.sh"; // Change this!

        // Execute the script, passing the file path as an argument
        // We wrap filePath in quotes to handle spaces in filenames
        exec(`${scriptPath} "${filePath}"`, (error, stdout, stderr) => {
            if (error) {
                vscode.window.showErrorMessage(`Error: ${error.message}`);
                return;
            }
            if (stderr) {
                console.error(`Script Stderr: ${stderr}`);
            }
            
            vscode.window.showInformationMessage(`Script executed: ${stdout}`);
        });
    });

    context.subscriptions.push(disposable);
}