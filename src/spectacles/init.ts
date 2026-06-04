import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import {
	getWorkspaceRootUri,
	pathExists,
	resolveLayoutUri,
	SPECTACLES_LAYOUT,
} from './layout';

const SCRIPT_TEMPLATES = ['code-to-spec.sh', 'spec-to-code.sh'] as const;
const PROMPT_TEMPLATES = ['code-to-spec.md', 'spec-to-code.md'] as const;
const AGENT_TEMPLATES = ['spectacles.draft-design.md', 'spectacles.generate-tasks.md'] as const;

const SPECTACLES_HOOK_EVENTS = [
	'sessionStart',
	'afterAgentResponse',
	'afterAgentThought',
	'postToolUse',
	'stop',
] as const;

const HOOK_COMMAND = '.cursor/hooks/spectacles-logger.sh';

interface HooksJson {
	version: number;
	hooks: Record<string, Array<{ command: string }>>;
}

async function installHooks(context: vscode.ExtensionContext, root: vscode.Uri): Promise<void> {
	const hooksDir = resolveLayoutUri(root, '.cursor/hooks');
	await vscode.workspace.fs.createDirectory(hooksDir);

	const scriptSrc = path.join(context.extensionPath, 'resources', 'hooks', 'spectacles-logger.sh');
	const scriptContent = await fs.readFile(scriptSrc);
	const scriptDest = resolveLayoutUri(root, '.cursor/hooks/spectacles-logger.sh');
	await vscode.workspace.fs.writeFile(scriptDest, scriptContent);

	// Make the hook script executable
	try {
		await fs.chmod(scriptDest.fsPath, 0o755);
	} catch {
		// Non-fatal: chmod may fail on Windows
	}

	// Merge our hooks into .cursor/hooks.json (preserve any existing hooks)
	const hooksJsonUri = resolveLayoutUri(root, '.cursor/hooks.json');
	let existing: HooksJson = { version: 1, hooks: {} };

	const existingText = await (async () => {
		try {
			const bytes = await vscode.workspace.fs.readFile(hooksJsonUri);
			return new TextDecoder().decode(bytes);
		} catch {
			return null;
		}
	})();

	if (existingText) {
		try {
			existing = JSON.parse(existingText);
		} catch {
			// Malformed hooks.json — start fresh
		}
	}

	if (!existing.hooks) {
		existing.hooks = {};
	}

	for (const event of SPECTACLES_HOOK_EVENTS) {
		const list = existing.hooks[event] ?? [];
		const alreadyInstalled = list.some((h) => h.command === HOOK_COMMAND);
		if (!alreadyInstalled) {
			existing.hooks[event] = [...list, { command: HOOK_COMMAND }];
		}
	}

	await vscode.workspace.fs.writeFile(
		hooksJsonUri,
		new TextEncoder().encode(JSON.stringify(existing, null, 2) + '\n')
	);
}

export async function runInit(context: vscode.ExtensionContext): Promise<void> {
	const root = getWorkspaceRootUri();
	if (!root) {
		vscode.window.showErrorMessage('Open a folder/workspace first.');
		return;
	}

	const spectaclesDir = resolveLayoutUri(root, '.spectacles');
	const alreadyInitialized = await pathExists(spectaclesDir);

	for (const entry of SPECTACLES_LAYOUT) {
		if (entry.type === 'directory') {
			await vscode.workspace.fs.createDirectory(resolveLayoutUri(root, entry.relativePath));
		}
	}

	for (const scriptName of SCRIPT_TEMPLATES) {
		const templatePath = path.join(
			context.extensionPath,
			'resources',
			'scripts',
			scriptName
		);
		const content = await fs.readFile(templatePath);
		const destUri = resolveLayoutUri(root, `.spectacles/scripts/${scriptName}`);
		await vscode.workspace.fs.writeFile(destUri, content);
	}

	for (const promptName of PROMPT_TEMPLATES) {
		const templatePath = path.join(
			context.extensionPath,
			'resources',
			'prompts',
			promptName
		);
		const content = await fs.readFile(templatePath);
		const destUri = resolveLayoutUri(root, `.spectacles/prompts/${promptName}`);
		await vscode.workspace.fs.writeFile(destUri, content);
	}

	const cursorAgentsDir = resolveLayoutUri(root, '.cursor/agents');
	await vscode.workspace.fs.createDirectory(cursorAgentsDir);

	for (const agentName of AGENT_TEMPLATES) {
		const templatePath = path.join(
			context.extensionPath,
			'resources',
			'agents',
			agentName
		);
		const content = await fs.readFile(templatePath);
		const destUri = resolveLayoutUri(root, `.cursor/agents/${agentName}`);
		await vscode.workspace.fs.writeFile(destUri, content);
	}

	await installHooks(context, root);

	if (alreadyInitialized) {
		vscode.window.showInformationMessage('Spectacles project files updated.');
	} else {
		vscode.window.showInformationMessage(
			'Spectacles initialized. On Unix, run chmod +x on scripts in .spectacles/scripts/ if needed.'
		);
	}
}
