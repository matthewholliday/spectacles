import * as vscode from 'vscode';

interface DesignData {
	id: string;
	architectureStyle: string;
	dependencies: string[];
	body: string;
}

function parseFrontMatter(text: string): DesignData {
	const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/);
	if (!match) {
		return { id: '', architectureStyle: '', dependencies: [], body: text };
	}

	const yaml = match[1];
	const body = match[2] ?? '';

	const getScalar = (key: string): string => {
		const m = yaml.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
		if (!m) { return ''; }
		return m[1].replace(/#.*$/, '').trim().replace(/^["']|["']$/g, '');
	};

	const getArray = (key: string): string[] => {
		const m = yaml.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
		if (!m) { return []; }
		const val = m[1].replace(/#.*$/, '').trim();
		if (!val || val === '[]') { return []; }
		return val
			.replace(/^\[|\]$/g, '')
			.split(',')
			.map(s => s.trim().replace(/^["']|["']$/g, ''))
			.filter(Boolean);
	};

	return {
		id: getScalar('id'),
		architectureStyle: getScalar('architecture_style'),
		dependencies: getArray('dependencies'),
		body,
	};
}

function stringifyDocument(data: DesignData): string {
	const arr = (a: string[]) =>
		a.length === 0 ? '[]' : `[${a.map(s => `"${s}"`).join(', ')}]`;
	const yaml = [
		`id: ${data.id}`,
		`architecture_style: ${data.architectureStyle}`,
		`dependencies: ${arr(data.dependencies)}`,
	].join('\n');
	return `---\n${yaml}\n---\n${data.body}`;
}

export class DesignEditorProvider implements vscode.CustomTextEditorProvider {

	public static readonly viewType = 'spectacles.designEditor';

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		return vscode.window.registerCustomEditorProvider(
			DesignEditorProvider.viewType,
			new DesignEditorProvider(context),
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
				case 'architectureStyle':
					current.architectureStyle = e.value;
					break;
				case 'dependencies':
					current.dependencies = e.value
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
<title>Design Editor</title>
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
      <input type="text" id="id-input" placeholder="design-spec" spellcheck="false" autocomplete="off" />
    </div>

    <div class="field">
      <label for="architecture-style-input">Architecture Style</label>
      <input type="text" id="architecture-style-input" placeholder="e.g. Event-driven, MVC, Micro-frontend" />
    </div>

    <div class="field full-width">
      <label for="dependencies-input">Dependencies</label>
      <input type="text" id="dependencies-input" placeholder="postgres, redis, stripe" />
      <span class="hint">Comma-separated system-level dependencies</span>
    </div>

  </div>
</div>

<div class="body-panel">
  <div class="section-label">Body</div>
  <textarea id="body-input" spellcheck="true" placeholder="# Technical Design: Feature Name&#10;&#10;## 1. System Architecture&#10;..."></textarea>
</div>

<script>
  const vscode = acquireVsCodeApi();

  const idInput = document.getElementById('id-input');
  const architectureStyleInput = document.getElementById('architecture-style-input');
  const dependenciesInput = document.getElementById('dependencies-input');
  const bodyInput = document.getElementById('body-input');

  function makeDebounce(delay) {
    let timer = null;
    return (fn) => {
      clearTimeout(timer);
      timer = setTimeout(fn, delay);
    };
  }

  const debounceId = makeDebounce(300);
  const debounceArchStyle = makeDebounce(300);
  const debounceDeps = makeDebounce(300);
  const debounceBody = makeDebounce(400);

  idInput.addEventListener('input', e =>
    debounceId(() => vscode.postMessage({ type: 'edit', key: 'id', value: e.target.value }))
  );
  architectureStyleInput.addEventListener('input', e =>
    debounceArchStyle(() => vscode.postMessage({ type: 'edit', key: 'architectureStyle', value: e.target.value }))
  );
  dependenciesInput.addEventListener('input', e =>
    debounceDeps(() => vscode.postMessage({ type: 'edit', key: 'dependencies', value: e.target.value }))
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
    if (document.activeElement !== architectureStyleInput) {
      architectureStyleInput.value = msg.architectureStyle || '';
    }
    if (document.activeElement !== dependenciesInput) {
      dependenciesInput.value = (msg.dependencies || []).join(', ');
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
