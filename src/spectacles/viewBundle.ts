import * as vscode from 'vscode';

interface BundleMetadata {
	spec_version: string;
	name: string;
	id: string;
	status: string;
	description?: string;
	version?: string;
	timestamps?: { created: string; updated: string };
}

interface Task {
	id: string;
	title: string;
	status: string;
	description?: string;
	estimated_effort?: string;
}

interface BundleData {
	metadata: BundleMetadata;
	requirementsStatus: string | null;
	designStatus: string | null;
	tasksStatus: string | null;
	tasks: Task[];
}

const openPanels = new Map<string, vscode.WebviewPanel>();

function extractFrontMatterStatus(content: string): string | null {
	const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
	if (!match) {
		return null;
	}
	const statusMatch = match[1].match(/^status:\s*["']?([a-z_]+)["']?/m);
	return statusMatch ? statusMatch[1] : null;
}

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

	const requirementsText = await readFileText(vscode.Uri.joinPath(dirUri, 'requirements.md'));
	const designText = await readFileText(vscode.Uri.joinPath(dirUri, 'design.md'));
	const tasksText = await readFileText(vscode.Uri.joinPath(dirUri, 'tasks.json'));

	const requirementsStatus = requirementsText ? extractFrontMatterStatus(requirementsText) : null;
	const designStatus = designText ? extractFrontMatterStatus(designText) : null;

	let tasksStatus: string | null = null;
	let tasks: Task[] = [];
	if (tasksText) {
		try {
			const parsed = JSON.parse(tasksText);
			tasksStatus = parsed.status ?? null;
			tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
		} catch {
			// leave defaults
		}
	}

	return { metadata, requirementsStatus, designStatus, tasksStatus, tasks };
}

function statusColor(status: string | null): string {
	switch (status) {
		case 'approved':
		case 'done':
			return '#22c55e';
		case 'in_progress':
			return '#3b82f6';
		case 'review':
			return '#f59e0b';
		case 'blocked':
		case 'deprecated':
			return '#ef4444';
		case 'draft':
		case 'todo':
		default:
			return '#6b7280';
	}
}

function statusLabel(status: string | null): string {
	if (!status) {
		return 'unknown';
	}
	return status.replace(/_/g, ' ');
}

function badge(status: string | null): string {
	const color = statusColor(status);
	const label = statusLabel(status);
	return `<span class="badge" style="background:${color}">${label}</span>`;
}

function taskRow(task: Task): string {
	const color = statusColor(task.status);
	const effort = task.estimated_effort
		? `<span class="effort">${task.estimated_effort}</span>`
		: '';
	return `
		<div class="task-row">
			<span class="task-id">${escapeHtml(task.id)}</span>
			<span class="task-title">${escapeHtml(task.title)}</span>
			${effort}
			<span class="badge" style="background:${color}">${statusLabel(task.status)}</span>
		</div>`;
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function buildHtml(data: BundleData): string {
	const { metadata, requirementsStatus, designStatus, tasksStatus, tasks } = data;

	const doneCount = tasks.filter((t) => t.status === 'done').length;
	const totalCount = tasks.length;
	const progressPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

	const tasksByStatus = {
		in_progress: tasks.filter((t) => t.status === 'in_progress'),
		todo: tasks.filter((t) => t.status === 'todo'),
		blocked: tasks.filter((t) => t.status === 'blocked'),
		done: tasks.filter((t) => t.status === 'done'),
	};

	const orderedTasks = [
		...tasksByStatus.in_progress,
		...tasksByStatus.blocked,
		...tasksByStatus.todo,
		...tasksByStatus.done,
	];

	const updatedAt = metadata.timestamps?.updated
		? new Date(metadata.timestamps.updated).toLocaleDateString(undefined, {
				year: 'numeric',
				month: 'short',
				day: 'numeric',
			})
		: null;

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
  .badge {
    display: inline-block;
    padding: 2px 9px;
    border-radius: 12px;
    font-size: 0.78em;
    font-weight: 600;
    color: #fff;
    text-transform: capitalize;
    white-space: nowrap;
  }
  .steps {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 28px;
  }
  .step {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: var(--vscode-editorWidget-background, rgba(128,128,128,0.1));
    border: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,0.2));
    border-radius: 8px;
  }
  .step-number {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--vscode-editorWidget-border, rgba(128,128,128,0.3));
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.78em;
    font-weight: 700;
    flex-shrink: 0;
  }
  .step-label {
    flex: 1;
    font-weight: 500;
  }
  .section { margin-bottom: 28px; }
  .progress-wrap { margin-bottom: 16px; }
  .progress-info { display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 0.85em; opacity: 0.7; }
  .progress-bar-bg {
    height: 8px;
    border-radius: 4px;
    background: var(--vscode-editorWidget-border, rgba(128,128,128,0.25));
    overflow: hidden;
  }
  .progress-bar-fill {
    height: 100%;
    border-radius: 4px;
    background: #22c55e;
    transition: width 0.3s ease;
  }
  .task-list { display: flex; flex-direction: column; gap: 6px; }
  .task-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 6px;
    background: var(--vscode-editorWidget-background, rgba(128,128,128,0.08));
    border: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,0.15));
    flex-wrap: wrap;
  }
  .task-id {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.78em;
    opacity: 0.55;
    white-space: nowrap;
    min-width: 60px;
  }
  .task-title { flex: 1; min-width: 100px; }
  .effort {
    font-size: 0.75em;
    padding: 1px 7px;
    border-radius: 10px;
    border: 1px solid currentColor;
    opacity: 0.55;
    white-space: nowrap;
  }
  .empty { opacity: 0.45; font-style: italic; }
  .stat-row { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 12px; }
  .stat { display: flex; align-items: center; gap: 5px; font-size: 0.85em; }
  .stat-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .divider { border: none; border-top: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,0.2)); margin: 24px 0; }
</style>
</head>
<body>

<div class="header">
  <div class="header-row">
    <h1>Spectacles</h1>
    ${badge(metadata.status)}
  </div>
  <p class="subtitle">Spec Name: ${escapeHtml(metadata.name)}</p>
  ${metadata.description ? `<p class="description">${escapeHtml(metadata.description)}</p>` : ''}
</div>

<div class="steps">
  <div class="step">
    <div class="step-number">1</div>
    <div class="step-label">Requirements</div>
    ${requirementsStatus ? badge(requirementsStatus) : '<span class="empty">not found</span>'}
  </div>
  <div class="step">
    <div class="step-number">2</div>
    <div class="step-label">Design</div>
    ${designStatus ? badge(designStatus) : '<span class="empty">not found</span>'}
  </div>
  <div class="step">
    <div class="step-number">3</div>
    <div class="step-label">Tasks</div>
    ${tasksStatus ? badge(tasksStatus) : '<span class="empty">not found</span>'}
  </div>
</div>

<hr class="divider">

<div class="section">
  <h2>Tasks (${doneCount} / ${totalCount} done)</h2>

  ${
		totalCount > 0
			? `
  <div class="progress-wrap">
    <div class="progress-info">
      <span>${progressPct}% complete</span>
      <span>${doneCount} done</span>
    </div>
    <div class="progress-bar-bg">
      <div class="progress-bar-fill" style="width:${progressPct}%"></div>
    </div>
  </div>
  <div class="stat-row">
    <div class="stat"><div class="stat-dot" style="background:#3b82f6"></div>${tasksByStatus.in_progress.length} in progress</div>
    <div class="stat"><div class="stat-dot" style="background:#ef4444"></div>${tasksByStatus.blocked.length} blocked</div>
    <div class="stat"><div class="stat-dot" style="background:#6b7280"></div>${tasksByStatus.todo.length} todo</div>
    <div class="stat"><div class="stat-dot" style="background:#22c55e"></div>${tasksByStatus.done.length} done</div>
  </div>
  <div class="task-list">
    ${orderedTasks.map(taskRow).join('')}
  </div>`
			: '<p class="empty">No tasks defined yet.</p>'
	}
</div>

</body>
</html>`;
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
		existing.reveal();
		existing.webview.html = buildHtml(data);
		return;
	}

	const panel = vscode.window.createWebviewPanel(
		'spectacles.bundleStatus',
		'Spectacles',
		vscode.ViewColumn.Beside,
		{ enableScripts: false, retainContextWhenHidden: true }
	);

	panel.webview.html = buildHtml(data);

	openPanels.set(panelId, panel);
	panel.onDidDispose(() => openPanels.delete(panelId), null, context.subscriptions);
}
