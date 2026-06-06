import * as vscode from 'vscode';
import {
	agentActionCss,
	agentActionHtml,
	agentActionJs,
	runAgentAction,
	resolveLayoutUri,
	getWorkspaceRootUri,
	type LogEntry,
	type PostFn,
} from './agentActionComponent';

// ---------------------------------------------------------------------------
// Bundle-specific types
// ---------------------------------------------------------------------------

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

interface LogSession {
	sessionId: string;
	logFile: string;
	startedAt: string;
	status: 'active' | 'complete';
	endedAt?: string;
}

interface PanelState {
	panel: vscode.WebviewPanel;
	uri: vscode.Uri;
	logWatcher: vscode.FileSystemWatcher | null;
	currentLogFile: string | null;
	currentLineCount: number;
}

const openPanels = new Map<string, PanelState>();

// The component instance ID used on this page
const DRAFT_DESIGN_TARGET = 'dd';

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

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
	if (!metadataText) { return null; }

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

// ---------------------------------------------------------------------------
// Log reading (for the webview feed, driven by file-system watcher + hooks)
// ---------------------------------------------------------------------------

async function readActiveSession(root: vscode.Uri): Promise<LogSession | null> {
	const uri = vscode.Uri.joinPath(root, '.spectacles', 'logs', 'active-session.json');
	const text = await readFileText(uri);
	if (!text) { return null; }
	try { return JSON.parse(text); } catch { return null; }
}

async function readLogEntries(root: vscode.Uri, logFile: string): Promise<LogEntry[]> {
	const uri = vscode.Uri.joinPath(root, '.spectacles', 'logs', logFile);
	const text = await readFileText(uri);
	if (!text) { return []; }
	return text
		.split('\n')
		.filter((l) => l.trim())
		.map((l) => { try { return JSON.parse(l) as LogEntry; } catch { return null; } })
		.filter((e): e is LogEntry => e !== null);
}

// ---------------------------------------------------------------------------
// Status / HTML
// ---------------------------------------------------------------------------

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
		? `<div class="step-circle checked">&#10003;</div>`
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
  .description { margin-top: 10px; opacity: 0.8; }
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
  .refresh-btn:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.25)); }
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
    width: 28px; height: 28px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 0.85em; font-weight: 700; flex-shrink: 0;
    transition: background 0.2s;
  }
  .step-circle.checked { background: #22c55e; color: #fff; }
  .step-circle.unchecked {
    background: transparent;
    border: 2px solid var(--vscode-editorWidget-border, rgba(128,128,128,0.45));
    opacity: 0.4;
  }
  .step-label { font-weight: 500; font-size: 0.9em; }
  ${agentActionCss()}
</style>
</head>
<body>

<script>
  // Expose the VS Code API under a stable name so the component IIFE can reach it.
  window.__vscodeApi = acquireVsCodeApi();
  function refresh() { window.__vscodeApi.postMessage({ command: 'refresh' }); }
</script>

<div class="header">
  <div class="header-row">
    <h1>Spectacles</h1>
    <button class="refresh-btn" onclick="refresh()">&#8635; Refresh</button>
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

${agentActionHtml({ buttonLabel: 'Draft design from requirements', command: 'draftDesign', id: DRAFT_DESIGN_TARGET })}
${agentActionJs({ command: 'draftDesign', id: DRAFT_DESIGN_TARGET })}

</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Log feed updates for a panel (driven by FileSystemWatcher + IDE hooks)
// ---------------------------------------------------------------------------

async function sendCurrentLogs(
	root: vscode.Uri,
	panel: vscode.WebviewPanel,
	state: Pick<PanelState, 'currentLogFile' | 'currentLineCount'>,
	mode: 'set' | 'append'
): Promise<void> {
	const session = await readActiveSession(root);
	const isActive = session?.status === 'active';

	if (!session) {
		if (mode === 'set') {
			panel.webview.postMessage({ command: 'setLogs', target: DRAFT_DESIGN_TARGET, entries: [], isActive: false });
		}
		return;
	}

	if (mode === 'set' || session.logFile !== state.currentLogFile) {
		state.currentLogFile = session.logFile;
		state.currentLineCount = 0;
		const entries = await readLogEntries(root, session.logFile);
		state.currentLineCount = entries.length;
		panel.webview.postMessage({ command: 'setLogs', target: DRAFT_DESIGN_TARGET, entries, isActive });
		return;
	}

	const entries = await readLogEntries(root, session.logFile);
	if (entries.length > state.currentLineCount) {
		const newEntries = entries.slice(state.currentLineCount);
		state.currentLineCount = entries.length;
		panel.webview.postMessage({ command: 'appendLogs', target: DRAFT_DESIGN_TARGET, entries: newEntries, isActive });
	}
}

// ---------------------------------------------------------------------------
// Command entry point
// ---------------------------------------------------------------------------

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
	const root = getWorkspaceRootUri();

	const existing = openPanels.get(panelId);
	if (existing) {
		existing.panel.reveal();
		existing.panel.webview.html = buildHtml(data);
		if (root) {
			setTimeout(() => sendCurrentLogs(root, existing.panel, existing, 'set'), 150);
		}
		return;
	}

	const panel = vscode.window.createWebviewPanel(
		'spectacles.bundleStatus',
		'Spectacles',
		vscode.ViewColumn.Beside,
		{ enableScripts: true, retainContextWhenHidden: true }
	);

	panel.webview.html = buildHtml(data);

	const state: PanelState = {
		panel,
		uri,
		logWatcher: null,
		currentLogFile: null,
		currentLineCount: 0,
	};

	if (root) {
		const watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(root, '.spectacles/logs/**')
		);

		const onLogChange = () => sendCurrentLogs(root, panel, state, 'append');
		watcher.onDidChange(onLogChange, null, context.subscriptions);
		watcher.onDidCreate(onLogChange, null, context.subscriptions);

		state.logWatcher = watcher;

		setTimeout(() => sendCurrentLogs(root, panel, state, 'set'), 150);
	}

	const postToPanel: PostFn = (command, payload) =>
		panel.webview.postMessage({ command, ...payload });

	panel.webview.onDidReceiveMessage(async (message) => {
		if (message.command === 'refresh') {
			const refreshed = await readBundleData(uri);
			if (refreshed) {
				panel.webview.html = buildHtml(refreshed);
				if (root) {
					setTimeout(() => sendCurrentLogs(root, panel, state, 'set'), 150);
				}
			}
		} else if (message.command === 'draftDesign') {
			if (!root) {
				vscode.window.showErrorMessage('Open a folder/workspace first.');
				return;
			}
			const agentUri = resolveLayoutUri(root, '.cursor/agents/spectacles.draft-design.md');
			await runAgentAction({
				agentUri,
				promptSuffix: uri.fsPath,
				post: postToPanel,
				root,
				target: DRAFT_DESIGN_TARGET,
			});
		}
	}, null, context.subscriptions);

	openPanels.set(panelId, state);

	panel.onDidDispose(() => {
		openPanels.delete(panelId);
		state.logWatcher?.dispose();
	}, null, context.subscriptions);
}
