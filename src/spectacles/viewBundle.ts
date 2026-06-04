import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { getWorkspaceRootUri, resolveLayoutUri, pathExists } from './layout';
import { getOutputChannel } from './runPrompt';

interface BundleMetadata {
	spec_version: string;
	name: string;
	id: string;
	status: string;
	description?: string;
	version?: string;
	timestamps?: { created: string; updated: string };
}

interface BundleData {
	metadata: BundleMetadata;
}

const openPanels = new Map<string, { panel: vscode.WebviewPanel; uri: vscode.Uri }>();

async function readFileText(uri: vscode.Uri): Promise<string | null> {
	try {
		const bytes = await vscode.workspace.fs.readFile(uri);
		return new TextDecoder().decode(bytes);
	} catch {
		return null;
	}
}

async function readBundleData(dirUri: vscode.Uri): Promise<BundleData | null> {
	const metadataUri = vscode.Uri.joinPath(dirUri, 'metadata.json');
	const metadataText = await readFileText(metadataUri);
	if (!metadataText) {
		return null;
	}

	let metadata: BundleMetadata;
	try {
		metadata = JSON.parse(metadataText);
	} catch {
		return null;
	}

	if (!metadata.spec_version || !metadata.name || !metadata.id || !metadata.status) {
		return null;
	}

	return { metadata };
}

const STATUS_ORDER = ['not_started', 'requirements_complete', 'design_complete', 'ready_for_dev', 'complete'] as const;

function stepsCompleted(status: string): [boolean, boolean, boolean, boolean] {
	const idx = STATUS_ORDER.indexOf(status as typeof STATUS_ORDER[number]);
	return [idx >= 1, idx >= 2, idx >= 3, idx >= 4];
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function stepCircle(checked: boolean): string {
	return checked
		? `<div class="step-circle checked">✓</div>`
		: `<div class="step-circle unchecked"></div>`;
}

function buildHtml(data: BundleData): string {
	const { metadata } = data;
	const [reqDone, designDone, tasksDone, allDone] = stepsCompleted(metadata.status);

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Spectacles</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family, system-ui, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 24px 28px 48px;
    line-height: 1.5;
  }
  h1 { font-size: 1.5em; font-weight: 600; margin-bottom: 4px; }
  h2 { font-size: 1em; font-weight: 600; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.6; }
  .subtitle { font-size: 0.95em; opacity: 0.75; margin-top: 4px; }
  .header { margin-bottom: 28px; }
  .header-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .spec-id { opacity: 0.5; font-size: 0.85em; font-family: var(--vscode-editor-font-family, monospace); }
  .meta-row { margin-top: 6px; opacity: 0.65; font-size: 0.85em; }
  .description { margin-top: 10px; opacity: 0.8; }
  .empty { opacity: 0.45; font-style: italic; }
  .refresh-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 12px;
    border-radius: 4px;
    border: 1px solid var(--vscode-button-border, transparent);
    background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.15));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    font-size: 0.85em;
    font-family: var(--vscode-font-family, system-ui, sans-serif);
    cursor: pointer;
    margin-left: auto;
  }
  .refresh-btn:hover {
    background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.25));
  }
  .steps {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    margin-bottom: 28px;
  }
  .step {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 8px;
    min-width: 96px;
    padding: 0 8px;
  }
  .step-connector {
    flex: 1;
    height: 2px;
    background: var(--vscode-editorWidget-border, rgba(128,128,128,0.35));
    margin-top: 13px;
    min-width: 24px;
  }
  .step-circle {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.85em;
    font-weight: 700;
    flex-shrink: 0;
    transition: background 0.2s;
  }
  .step-circle.checked {
    background: #22c55e;
    color: #fff;
  }
  .step-circle.unchecked {
    background: transparent;
    border: 2px solid var(--vscode-editorWidget-border, rgba(128,128,128,0.45));
    color: var(--vscode-foreground);
    opacity: 0.4;
  }
  .step-label {
    font-weight: 500;
    font-size: 0.9em;
  }
  .actions {
    display: flex;
    justify-content: center;
    margin-top: 8px;
  }
  .draft-btn {
    padding: 7px 18px;
    border-radius: 4px;
    border: 1px solid var(--vscode-button-border, transparent);
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    font-size: 0.9em;
    font-family: var(--vscode-font-family, system-ui, sans-serif);
    cursor: pointer;
  }
  .draft-btn:hover {
    background: var(--vscode-button-hoverBackground);
  }
</style>
</head>
<body>

<div class="header">
  <div class="header-row">
    <h1>Spectacles</h1>
    <button class="refresh-btn" onclick="refresh()">↻ Refresh</button>
  </div>
  <p class="subtitle">Spec Name: ${escapeHtml(metadata.name)}</p>
  ${metadata.description ? `<p class="description">${escapeHtml(metadata.description)}</p>` : ''}
</div>

<div class="steps">
  <div class="step">
    ${stepCircle(reqDone)}
    <div class="step-label">Requirements</div>
  </div>
  <div class="step-connector"></div>
  <div class="step">
    ${stepCircle(designDone)}
    <div class="step-label">Design</div>
  </div>
  <div class="step-connector"></div>
  <div class="step">
    ${stepCircle(tasksDone)}
    <div class="step-label">Tasks</div>
  </div>
  <div class="step-connector"></div>
  <div class="step">
    ${stepCircle(allDone)}
    <div class="step-label">Done</div>
  </div>
</div>

<div class="actions">
  <button class="draft-btn" onclick="draftDesign()">Draft design from requirements</button>
</div>

<script>
  const vscode = acquireVsCodeApi();
  function refresh() { vscode.postMessage({ command: 'refresh' }); }
  function draftDesign() { vscode.postMessage({ command: 'draftDesign' }); }
</script>
</body>
</html>`;
}

function stripFrontMatter(content: string): string {
	if (!content.startsWith('---')) { return content; }
	const end = content.indexOf('\n---', 3);
	if (end === -1) { return content; }
	return content.slice(end + 4).trimStart();
}

async function runDraftDesign(bundleUri: vscode.Uri): Promise<void> {
	const root = getWorkspaceRootUri();
	if (!root) {
		vscode.window.showErrorMessage('Open a folder/workspace first.');
		return;
	}

	const agentUri = resolveLayoutUri(root, '.cursor/agents/spectacles.draft-design.md');
	if (!(await pathExists(agentUri))) {
		vscode.window.showErrorMessage(
			'spectacles.draft-design agent not found. Run Spectacles: Init first.'
		);
		return;
	}

	const bytes = await vscode.workspace.fs.readFile(agentUri);
	const agentContent = stripFrontMatter(Buffer.from(bytes).toString('utf8'));
	const fullPrompt = `${agentContent}\n\n${bundleUri.fsPath}\n`;

	const output = getOutputChannel();
	output.clear();
	output.appendLine(`[spectacles] draft-design → ${bundleUri.fsPath}`);
	output.appendLine('');
	output.show(true);

	const child = spawn('cursor', ['agent', '--print', fullPrompt], {
		cwd: root.fsPath,
		shell: false,
	});

	child.stdout.on('data', (d: Buffer) => output.append(d.toString()));
	child.stderr.on('data', (d: Buffer) => output.append(d.toString()));

	child.on('close', (code) => {
		output.appendLine('');
		if (code !== 0) {
			output.appendLine(`[spectacles] exited with code ${code}`);
			vscode.window.showErrorMessage(
				`draft-design failed (exit ${code}). See Output → Spectacles.`
			);
		} else {
			output.appendLine('[spectacles] done');
			vscode.window.showInformationMessage('Design drafted. See Output → Spectacles.');
		}
	});

	child.on('error', (err: Error) => {
		output.appendLine(`[spectacles] error: ${err.message}`);
		vscode.window.showErrorMessage(`draft-design error: ${err.message}`);
	});
}

export async function runViewBundleStatus(
	uri: vscode.Uri,
	context: vscode.ExtensionContext
): Promise<void> {
	if (!uri) {
		vscode.window.showErrorMessage('No folder selected.');
		return;
	}

	const data = await readBundleData(uri);
	if (!data) {
		vscode.window.showErrorMessage(
			'Not a valid specification bundle. The directory must contain a metadata.json with spec_version, name, id, and status.'
		);
		return;
	}

	const panelId = data.metadata.id;

	const existing = openPanels.get(panelId);
	if (existing) {
		existing.panel.reveal();
		existing.panel.webview.html = buildHtml(data);
		return;
	}

	const panel = vscode.window.createWebviewPanel(
		'spectacles.bundleStatus',
		'Spectacles',
		vscode.ViewColumn.Beside,
		{ enableScripts: true, retainContextWhenHidden: true }
	);

	panel.webview.html = buildHtml(data);

	panel.webview.onDidReceiveMessage(async (message) => {
		if (message.command === 'refresh') {
			const refreshed = await readBundleData(uri);
			if (refreshed) {
				panel.webview.html = buildHtml(refreshed);
			}
		} else if (message.command === 'draftDesign') {
			await runDraftDesign(uri);
		}
	}, null, context.subscriptions);

	openPanels.set(panelId, { panel, uri });
	panel.onDidDispose(() => openPanels.delete(panelId), null, context.subscriptions);
}
