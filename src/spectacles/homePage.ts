import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class HomePageViewProvider implements vscode.WebviewViewProvider {
	static readonly viewId = 'spectacles.homepage';

	constructor(private readonly extensionUri: vscode.Uri) {}

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		webviewView.webview.options = { enableScripts: false };
		webviewView.webview.html = this.buildHtml();
	}

	private buildHtml(): string {
		const svgPath = path.join(this.extensionUri.fsPath, 'eyeglasses-icon.svg');
		const svgContent = fs.readFileSync(svgPath, 'utf8');

		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Spectacles</title>
  <style>
    body {
      margin: 0;
      padding: 24px 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
    }

    .icon {
      width: 64px;
      height: 64px;
      margin-bottom: 16px;
      opacity: 0.9;
    }

    .icon svg {
      width: 100%;
      height: 100%;
      fill: var(--vscode-foreground);
    }

    h1 {
      margin: 0;
      font-size: 1.4em;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: var(--vscode-foreground);
    }

    p {
      margin: 10px 0 0;
      font-size: 0.85em;
      text-align: center;
      color: var(--vscode-descriptionForeground);
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="icon">${svgContent}</div>
  <h1>Spectacles</h1>
  <p>Spec-driven development tools.</p>
</body>
</html>`;
	}
}
