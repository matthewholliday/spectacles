import * as vscode from 'vscode';

interface RequirementsData {
	id: string;
	lastReviewedBy: string[];
	targetAudience: string[];
	body: string;
}

function parseFrontMatter(text: string): RequirementsData {
	const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/);
	if (!match) {
		return { id: '', lastReviewedBy: [], targetAudience: [], body: text };
	}

	const yaml = match[1];
	const body = match[2] ?? '';

	const getScalar = (key: string): string => {
		const m = yaml.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
		return m ? m[1].trim() : '';
	};

	const getArray = (key: string): string[] => {
		const m = yaml.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
		if (!m) { return []; }
		const val = m[1].trim();
		if (!val || val === '[]') { return []; }
		return val
			.replace(/^\[|\]$/g, '')
			.split(',')
			.map(s => s.trim().replace(/^["']|["']$/g, ''))
			.filter(Boolean);
	};

	return {
		id: getScalar('id'),
		lastReviewedBy: getArray('last_reviewed_by'),
		targetAudience: getArray('target_audience'),
		body,
	};
}

function stringifyDocument(data: RequirementsData): string {
	const arr = (a: string[]) =>
		a.length === 0 ? '[]' : `[${a.map(s => `"${s}"`).join(', ')}]`;
	const yaml = [
		`id: ${data.id}`,
		`last_reviewed_by: ${arr(data.lastReviewedBy)}`,
		`target_audience: ${arr(data.targetAudience)}`,
	].join('\n');
	return `---\n${yaml}\n---\n${data.body}`;
}

export class RequirementsEditorProvider implements vscode.CustomTextEditorProvider {

	public static readonly viewType = 'spectacles.requirementsEditor';

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		return vscode.window.registerCustomEditorProvider(
			RequirementsEditorProvider.viewType,
			new RequirementsEditorProvider(context),
			{ webviewOptions: { retainContextWhenHidden: true } }
		);
	}

	constructor(private readonly context: vscode.ExtensionContext) {}

	public async resolveCustomTextEditor(
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken
	): Promise<void> {
		webviewPanel.webview.options = { enableScripts: true };
		webviewPanel.webview.html = this.getHtmlForWebview();

		function updateWebview() {
			const parsed = parseFrontMatter(document.getText());
			webviewPanel.webview.postMessage({ type: 'update', ...parsed });
		}

		updateWebview();

		const changeSubscription = vscode.workspace.onDidChangeTextDocument(e => {
			if (e.document.uri.toString() === document.uri.toString()) {
				updateWebview();
			}
		});

		webviewPanel.onDidDispose(() => changeSubscription.dispose());

		webviewPanel.webview.onDidReceiveMessage(e => {
			if (e.type !== 'edit') { return; }

			const current = parseFrontMatter(document.getText());

			switch (e.key) {
				case 'id':
					current.id = e.value;
					break;
				case 'lastReviewedBy':
					current.lastReviewedBy = e.value
						? (e.value as string).split(',').map((s: string) => s.trim()).filter(Boolean)
						: [];
					break;
				case 'targetAudience':
					current.targetAudience = e.value
						? (e.value as string).split(',').map((s: string) => s.trim()).filter(Boolean)
						: [];
					break;
				case 'body':
					current.body = e.value;
					break;
			}

			const newText = stringifyDocument(current);
			const edit = new vscode.WorkspaceEdit();
			edit.replace(
				document.uri,
				new vscode.Range(0, 0, document.lineCount, 0),
				newText
			);
			vscode.workspace.applyEdit(edit);
		});
	}

	private getHtmlForWebview(): string {
		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Requirements Editor</title>
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
  .section-label {
    font-size: 0.75em;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    opacity: 0.5;
    margin-bottom: 14px;
  }
  .front-matter-panel {
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
    padding-bottom: 28px;
    margin-bottom: 28px;
  }
  .front-matter-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .field.full-width {
    grid-column: span 2;
  }
  label {
    font-size: 0.82em;
    font-weight: 500;
    opacity: 0.7;
  }
  input, textarea {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px;
    padding: 5px 8px;
    font-family: inherit;
    font-size: inherit;
    outline: none;
    width: 100%;
  }
  input::placeholder, textarea::placeholder {
    color: var(--vscode-input-placeholderForeground);
  }
  input:focus, textarea:focus {
    border-color: var(--vscode-focusBorder, #007fd4);
    outline: 1px solid var(--vscode-focusBorder, #007fd4);
    outline-offset: -1px;
  }
  textarea {
    resize: vertical;
    min-height: 420px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: var(--vscode-editor-font-size, 13px);
    line-height: 1.6;
  }
  .hint {
    font-size: 0.78em;
    opacity: 0.45;
  }
  .body-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
</style>
</head>
<body>

<div class="front-matter-panel">
  <div class="section-label">Front Matter</div>
  <div class="front-matter-grid">

    <div class="field">
      <label for="id-input">ID</label>
      <input type="text" id="id-input" placeholder="req-spec" spellcheck="false" autocomplete="off" />
    </div>

    <div class="field">
      <label for="target-audience-input">Target Audience</label>
      <input type="text" id="target-audience-input" placeholder="Product, Engineering" />
      <span class="hint">Comma-separated</span>
    </div>

    <div class="field full-width">
      <label for="last-reviewed-by-input">Last Reviewed By</label>
      <input type="text" id="last-reviewed-by-input" placeholder="Alice, Bob" />
      <span class="hint">Comma-separated</span>
    </div>

  </div>
</div>

<div class="body-panel">
  <div class="section-label">Body</div>
  <textarea id="body-input" spellcheck="true" placeholder="# Requirements: Feature Name&#10;&#10;## 1. Executive Summary&#10;..."></textarea>
</div>

<script>
  const vscode = acquireVsCodeApi();

  const idInput = document.getElementById('id-input');
  const lastReviewedByInput = document.getElementById('last-reviewed-by-input');
  const targetAudienceInput = document.getElementById('target-audience-input');
  const bodyInput = document.getElementById('body-input');

  function makeDebounce(delay) {
    let timer = null;
    return (fn) => {
      clearTimeout(timer);
      timer = setTimeout(fn, delay);
    };
  }

  const debounceId = makeDebounce(300);
  const debounceLastReviewedBy = makeDebounce(300);
  const debounceTargetAudience = makeDebounce(300);
  const debounceBody = makeDebounce(400);

  idInput.addEventListener('input', e =>
    debounceId(() => vscode.postMessage({ type: 'edit', key: 'id', value: e.target.value }))
  );
  lastReviewedByInput.addEventListener('input', e =>
    debounceLastReviewedBy(() => vscode.postMessage({ type: 'edit', key: 'lastReviewedBy', value: e.target.value }))
  );
  targetAudienceInput.addEventListener('input', e =>
    debounceTargetAudience(() => vscode.postMessage({ type: 'edit', key: 'targetAudience', value: e.target.value }))
  );
  bodyInput.addEventListener('input', e =>
    debounceBody(() => vscode.postMessage({ type: 'edit', key: 'body', value: e.target.value }))
  );

  window.addEventListener('message', event => {
    const msg = event.data;
    if (msg.type !== 'update') { return; }

    if (document.activeElement !== idInput) {
      idInput.value = msg.id || '';
    }
    if (document.activeElement !== lastReviewedByInput) {
      lastReviewedByInput.value = (msg.lastReviewedBy || []).join(', ');
    }
    if (document.activeElement !== targetAudienceInput) {
      targetAudienceInput.value = (msg.targetAudience || []).join(', ');
    }
    if (document.activeElement !== bodyInput) {
      bodyInput.value = msg.body || '';
    }
  });
</script>
</body>
</html>`;
	}
}
