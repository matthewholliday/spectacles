import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { runViewBundleStatus } from './viewBundle';

interface SpecEntry {
	name: string;
	id: string;
	status: string;
	folder: string;
	description?: string;
}

export class HomePageViewProvider implements vscode.WebviewViewProvider {
	static readonly viewId = 'spectacles.homepage';

	private _view: vscode.WebviewView | undefined;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly context: vscode.ExtensionContext
	) {}

	async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
		this._view = webviewView;
		webviewView.webview.options = { enableScripts: true };
		webviewView.webview.html = await this.buildHtml(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(async (message) => {
			if (message.command === 'refresh' && this._view) {
				this._view.webview.html = await this.buildHtml(this._view.webview);
			} else if (message.command === 'openBundleDetails') {
				const folders = vscode.workspace.workspaceFolders;
				if (!folders || folders.length === 0) { return; }
				const specUri = vscode.Uri.joinPath(folders[0].uri, '.spectacles', 'specs', message.folder);
				await runViewBundleStatus(specUri, this.context);
			} else if (message.command === 'implement') {
				const folders = vscode.workspace.workspaceFolders;
				if (!folders || folders.length === 0) { return; }
				const specUri = vscode.Uri.joinPath(folders[0].uri, '.spectacles', 'specs', message.folder);
				await vscode.commands.executeCommand('spectacles.implement', specUri);
			}
		});
	}

	private async readSpecs(): Promise<SpecEntry[]> {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) { return []; }

		const specsUri = vscode.Uri.joinPath(folders[0].uri, '.spectacles', 'specs');

		let entries: [string, vscode.FileType][];
		try {
			entries = await vscode.workspace.fs.readDirectory(specsUri);
		} catch {
			return [];
		}

		const specs: SpecEntry[] = [];
		for (const [name, type] of entries) {
			if (type !== vscode.FileType.Directory) { continue; }
			const metaUri = vscode.Uri.joinPath(specsUri, name, 'metadata.json');
			try {
				const bytes = await vscode.workspace.fs.readFile(metaUri);
				const meta = JSON.parse(new TextDecoder().decode(bytes));
				if (meta.name && meta.id && meta.status) {
					specs.push({
						name: meta.name,
						id: meta.id,
						status: meta.status,
						folder: name,
						description: meta.description,
					});
				}
			} catch {
				// skip malformed bundles
			}
		}

		return specs;
	}

	private async buildHtml(webview: vscode.Webview): Promise<string> {
		const svgPath = path.join(this.extensionUri.fsPath, 'eyeglasses-icon.svg');
		const svgContent = fs.readFileSync(svgPath, 'utf8');

		const specs = await this.readSpecs();

		const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)))
			.map(b => b.toString(16).padStart(2, '0'))
			.join('');

		const specRows = specs.length === 0
			? `<p class="empty-state">No specs found. Run <strong>Spectacles: New Spec</strong> to get started.</p>`
			: specs.map(s => {
				const desc = s.description
					? `<div class="spec-desc">${escapeHtml(s.description)}</div>`
					: '';
				return `
<details>
  <summary>
    <span class="spec-name">${escapeHtml(s.name)}</span>
    <span class="badge badge--${escapeHtml(s.status)}">${escapeHtml(s.status.replace(/_/g, ' '))}</span>
  </summary>
  <div class="spec-body">
    <div class="spec-id">ID: ${escapeHtml(s.id)}</div>
    ${desc}
    <div class="spec-actions">
      <button class="spec-btn spec-btn--primary" data-folder="${escapeHtml(s.folder)}" data-action="implement">Implement</button>
      <button class="spec-btn spec-btn--secondary" data-folder="${escapeHtml(s.folder)}" data-action="edit">Edit</button>
    </div>
  </div>
</details>`;
			}).join('\n');

		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';" />
  <title>Spectacles</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }

    body {
      margin: 0;
      padding: 12px 12px 16px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
    }

    /* ── Header ── */
    .header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
    }

    .icon {
      width: 24px;
      height: 24px;
      flex-shrink: 0;
      opacity: 0.9;
    }

    .icon svg {
      width: 100%;
      height: 100%;
      fill: var(--vscode-foreground);
    }

    .title {
      flex: 1;
      margin: 0;
      font-size: 1.1em;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: var(--vscode-foreground);
    }

    .refresh-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--vscode-foreground);
      opacity: 0.7;
      padding: 4px 6px;
      border-radius: 3px;
      font-size: 1.4em;
      line-height: 1;
      transition: opacity 0.15s;
    }

    .refresh-btn:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }
    .refresh-btn:active { opacity: 0.6; }

    /* ── Divider ── */
    hr {
      border: none;
      border-top: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
      margin: 0 0 10px;
    }

    /* ── Accordion ── */
    details {
      border-radius: 4px;
      margin-bottom: 4px;
      overflow: hidden;
    }

    summary {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 6px;
      cursor: pointer;
      border-radius: 4px;
      list-style: none;
      user-select: none;
    }

    summary::-webkit-details-marker { display: none; }

    summary::before {
      content: '▶';
      font-size: 0.6em;
      opacity: 0.6;
      transition: transform 0.15s;
      flex-shrink: 0;
    }

    details[open] > summary::before { transform: rotate(90deg); }

    summary:hover { background: var(--vscode-list-hoverBackground); }

    .spec-name {
      flex: 1;
      font-size: 0.9em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* ── Status badges ── */
    .badge {
      font-size: 0.7em;
      padding: 1px 6px;
      border-radius: 10px;
      flex-shrink: 0;
      font-weight: 500;
      text-transform: capitalize;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }

    .badge--draft           { background: var(--vscode-charts-yellow,  #d4a900); color: #000; }
    .badge--complete        { background: var(--vscode-testing-iconPassed, #388a34); color: #fff; }
    .badge--ready_for_dev   { background: var(--vscode-charts-blue, #1e88e5); color: #fff; }
    .badge--design_complete { background: var(--vscode-charts-purple, #8e24aa); color: #fff; }
    .badge--requirements_complete { background: var(--vscode-charts-orange, #e65100); color: #fff; }

    /* ── Spec detail body ── */
    .spec-body {
      padding: 6px 10px 8px 22px;
      font-size: 0.82em;
      color: var(--vscode-descriptionForeground);
      line-height: 1.5;
    }

    .spec-id {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 0.9em;
      opacity: 0.7;
      margin-bottom: 2px;
    }

    .spec-desc { margin-top: 2px; }

    /* ── Spec action buttons ── */
    .spec-actions {
      display: flex;
      gap: 6px;
      margin-top: 8px;
    }

    .spec-btn {
      padding: 3px 10px;
      border-radius: 3px;
      border: 1px solid transparent;
      font-size: 0.82em;
      font-family: var(--vscode-font-family);
      cursor: pointer;
      line-height: 1.4;
    }

    .spec-btn--primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: var(--vscode-button-border, transparent);
    }
    .spec-btn--primary:hover { background: var(--vscode-button-hoverBackground); }

    .spec-btn--secondary {
      background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.15));
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      border-color: var(--vscode-button-border, transparent);
    }
    .spec-btn--secondary:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.25)); }

    /* ── Empty state ── */
    .empty-state {
      margin: 8px 4px 0;
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="icon">${svgContent}</div>
    <h1 class="title">Spectacles</h1>
    <button class="refresh-btn" id="refresh" title="Refresh spec list">↺</button>
  </div>
  <hr />
  <div id="spec-list">
    ${specRows}
  </div>
  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();
      document.getElementById('refresh').addEventListener('click', function() {
        this.style.opacity = '0.4';
        vscode.postMessage({ command: 'refresh' });
      });
      document.getElementById('spec-list').addEventListener('click', function(e) {
        const btn = e.target.closest('[data-action]');
        if (!btn) { return; }
        const folder = btn.dataset.folder;
        const action = btn.dataset.action;
        if (action === 'edit') {
          vscode.postMessage({ command: 'openBundleDetails', folder });
        } else if (action === 'implement') {
          vscode.postMessage({ command: 'implement', folder });
        }
      });
    })();
  </script>
</body>
</html>`;
	}
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}
