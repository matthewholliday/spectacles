import * as vscode from 'vscode';
import { getWorkspaceRootUri, pathExists, resolveLayoutUri } from './layout';

function slugify(name: string): string {
	return name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function buildMetadata(name: string, id: string, description: string): string {
	const now = new Date().toISOString();
	return JSON.stringify(
		{
			spec_version: '1.0.0',
			name,
			id,
			description,
			status: 'draft',
			version: '0.1.0',
			authors: [],
			timestamps: {
				created: now,
				updated: now,
			},
		},
		null,
		2
	);
}

function buildRequirements(name: string, id: string): string {
	return `---
id: ${id}
status: draft
last_reviewed_by: []
target_audience: ["Product", "Engineering"]
---

# Requirements: ${name}

## 1. Executive Summary
A brief, high-level overview of what is being built and why it matters.

## 2. User Stories / Use Cases
* **As a** [user role], **I want to** [action] **so that** [value/outcome].

## 3. Functional Requirements
* **FR-1:** The system MUST...

## 4. Non-Functional Requirements
* **NFR-1 (Performance):** ...

## 5. Out of Scope
* Items explicitly excluded from this iteration.
`;
}

function buildDesign(name: string, id: string): string {
	return `---
id: ${id}
status: draft
architecture_style: ""
dependencies: []
---

# Technical Design: ${name}

## 1. System Architecture
High-level architectural approach. Reference components, patterns, and structural decisions.

## 2. Data Models & Schema
Define the data structures, database tables, or key-value structures.

## 3. Interface & API Contracts
Define endpoints, payloads, or internal class interfaces.

## 4. Key Architectural Trade-offs
Trade-off 1: Choosing X over Y to achieve Z.

## 5. Infrastructure & Deployment Considerations
State specific environment variables, cloud infrastructure components, or scaling bottlenecks.
`;
}

function buildTasks(): string {
	return JSON.stringify({ tasks: [] }, null, 2);
}

export async function runNewSpec(): Promise<void> {
	const root = getWorkspaceRootUri();
	if (!root) {
		vscode.window.showErrorMessage('Open a folder/workspace first.');
		return;
	}

	const nameInput = await vscode.window.showInputBox({
		title: 'New Spec: Name',
		prompt: 'Human-readable name for the specification (e.g. "User Authentication")',
		placeHolder: 'My Feature',
		validateInput: (value) => (value.trim() ? undefined : 'Spec name is required.'),
	});
	if (nameInput === undefined) {
		return;
	}

	const description = await vscode.window.showInputBox({
		title: 'New Spec: Description',
		prompt: 'Short description (optional)',
		placeHolder: 'Describe this specification...',
	});
	if (description === undefined) {
		return;
	}

	const specsDir = resolveLayoutUri(root, '.spectacles/specs');
	if (!(await pathExists(specsDir))) {
		vscode.window.showErrorMessage(
			'Spectacles project must be initialized first. Run Spectacles: Init.'
		);
		return;
	}

	const name = nameInput.trim();
	const id = slugify(name);
	const bundleDir = resolveLayoutUri(root, `.spectacles/specs/${id}`);

	if (await pathExists(bundleDir)) {
		vscode.window.showErrorMessage(`A spec named "${id}" already exists.`);
		return;
	}

	const encoder = new TextEncoder();

	await vscode.workspace.fs.createDirectory(bundleDir);
	await vscode.workspace.fs.writeFile(
		vscode.Uri.joinPath(bundleDir, 'metadata.json'),
		encoder.encode(buildMetadata(name, id, description))
	);
	await vscode.workspace.fs.writeFile(
		vscode.Uri.joinPath(bundleDir, 'requirements.md'),
		encoder.encode(buildRequirements(name, id))
	);
	await vscode.workspace.fs.writeFile(
		vscode.Uri.joinPath(bundleDir, 'design.md'),
		encoder.encode(buildDesign(name, id))
	);
	await vscode.workspace.fs.writeFile(
		vscode.Uri.joinPath(bundleDir, 'tasks.json'),
		encoder.encode(buildTasks())
	);

	vscode.window.showInformationMessage(`Spec "${name}" created at .spectacles/specs/${id}/`);
}
