import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { App } from 'obsidian-test-mocks/obsidian';
import { editorInfoField } from 'obsidian';
import { referenceGutter } from '../src/reference-gutter';

const current = vi.hoisted(() => ({ file: null as unknown }));
vi.mock('obsidian', async (original) => {
	const { StateField } = await import('@codemirror/state');
	return { ...await original<object>(), editorInfoField: StateField.define({ create: () => ({ file: current.file }), update: (value: { file: unknown }) => (value.file === current.file ? value : { file: current.file }) }) };
});

const views: EditorView[] = [];
afterEach(() => { views.forEach((view) => view.destroy()); views.length = 0; vi.restoreAllMocks(); });

function editor() {
	const app = App.createConfigured__({ files: { 'Target.md': '# Setup', 'Source.md': '[[Target#Setup]]' } });
	const file = app.vault.getFileByPath('Target.md')!;
	current.file = file;
	let count = 1;
	const pos = { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 7, offset: 7 } };
	vi.spyOn(app.metadataCache, 'getFileCache').mockImplementation((f) => f.path === file.path ? { headings: [{ heading: 'Setup', level: 1, position: pos }] } as never : { links: Array.from({ length: count }, () => ({ link: 'Target#Setup', original: '[[Target#Setup]]', position: pos })) } as never);
	vi.spyOn(app.metadataCache, 'getFirstLinkpathDest').mockReturnValue(file);
	app.metadataCache.resolvedLinks = { 'Source.md': { 'Target.md': 1 } };
	let enabled = true;
	const refs = referenceGutter(app as never, () => [], () => enabled);
	const parent = document.createElement('div');
	document.body.append(parent);
	const view = new EditorView({ state: EditorState.create({ doc: '# Setup', extensions: [editorInfoField, refs.extension] }), parent });
	views.push(view);
	const counts = () => [...parent.querySelectorAll('.hls-reference-count')].map((el) => el.textContent);
	const split = () => { const el = document.createElement('div'); document.body.append(el); const other = new EditorView({ state: EditorState.create({ doc: '# Setup', extensions: [editorInfoField, refs.extension] }), parent: el }); views.push(other); return other; };
	return { app, file, refs, view, split, counts, setCount: (n: number) => { count = n; }, hide: () => { enabled = false; } };
}

describe('reference gutter lifetime', () => {
	it('refreshes counts without a document change and applies the hide setting', () => {
		const { refs, counts, setCount, hide } = editor();
		expect(counts()).toEqual(['1']);
		setCount(3);
		refs.refresh();
		expect(counts()).toEqual(['3']);
		hide();
		refs.refresh();
		expect(counts()).toEqual([]);
	});
	it('clears old positions during typing and waits for the matching indexed text', () => {
		const { refs, view, counts } = editor();
		refs.indexed('Target.md', '# Setup');
		view.dispatch({ changes: { from: 7, insert: ' ' } });
		expect(counts()).toEqual([]);
		refs.refresh();
		expect(counts()).toEqual([]);
		refs.indexed('Target.md', '# Setup ');
		refs.refresh();
		expect(counts()).toEqual(['1']);
		view.destroy();
		expect(() => refs.refresh()).not.toThrow();
	});
	it('keeps the indexed text while a second split of the note is open', () => {
		const { refs, view, split, counts } = editor();
		const other = split();
		refs.indexed('Target.md', '# Setup');
		other.destroy();
		view.dispatch({ changes: { from: 7, insert: ' ' } });
		refs.refresh();
		expect(counts()).toEqual([]);
	});
	it('forgets the indexed text when the editor leaves the note, so a later outside change does not hide the counts', () => {
		const { app, file, refs, view, counts } = editor();
		refs.indexed('Target.md', '# Setup');
		// The same leaf opens another note. Then Target.md changes on disk (sync, or a link update) while it is closed.
		current.file = app.vault.getFileByPath('Source.md');
		view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '[[Target#Setup]]' } });
		refs.indexed('Target.md', '# Setup\nmore');
		current.file = file;
		view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '# Setup\nmore' } });
		expect(counts()).toEqual(['1']);
	});
});
