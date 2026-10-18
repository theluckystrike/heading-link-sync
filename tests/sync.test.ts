import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, MarkdownView } from 'obsidian-test-mocks/obsidian';
import { applyPlans, planVault, undoApplied, type SyncRequest } from '../src/sync';

afterEach(() => vi.restoreAllMocks());

function setup() {
	const app = App.createConfigured__({ files: { 'Target.md': '## New', 'Link.md': '[[Target#Old]]' } });
	const target = app.vault.getFileByPath('Target.md')!;
	const linked = app.vault.getFileByPath('Link.md')!;
	app.metadataCache.resolvedLinks = { 'Link.md': { 'Target.md': 1 } };
	vi.spyOn(app.metadataCache, 'getFirstLinkpathDest').mockReturnValue(target);
	vi.spyOn(app.metadataCache, 'getFileCache').mockReturnValue(null);
	let value = 'Unsaved 日本語 [[Target#Old]]';
	const view = Object.create(MarkdownView.prototype) as MarkdownView;
	Object.assign(view, { file: linked, getMode: () => 'source' });
	Object.defineProperty(view, 'editor', { value: {
		getValue: () => value,
		offsetToPos: (ch: number) => ({ line: 0, ch }),
		transaction: ({ changes }: { changes: { from: { ch: number }; to: { ch: number }; text: string }[] }) => {
			for (const c of [...changes].sort((a, b) => b.from.ch - a.from.ch)) value = value.slice(0, c.from.ch) + c.text + value.slice(c.to.ch);
		},
		replaceRange: (text: string, from: { ch: number }, to: { ch: number }) => { value = value.slice(0, from.ch) + text + value.slice(to.ch); },
	} });
	vi.spyOn(app.workspace, 'iterateAllLeaves').mockImplementation((cb) => { cb({ view } as never); });
	const req: SyncRequest = { target: target as never, before: [{ text: 'Old', level: 2 }], after: [{ text: 'New', level: 2 }], blocks: [], markdown: true, blockLinks: true, excluded: [] };
	return { app, req, value: () => value, set: (s: string) => { value = s; } };
}

describe('open linking notes', () => {
	it('plans from unsaved editor text and applies and undoes through the editor', async () => {
		const { app, req, value } = setup();
		const process = vi.spyOn(app.vault, 'process');
		const plans = await planVault(app as never, req);
		expect(plans[0]!.before).toBe('Unsaved 日本語 [[Target#Old]]');
		const done = await applyPlans(app as never, req, plans);
		expect(value()).toBe('Unsaved 日本語 [[Target#New]]');
		expect(process).not.toHaveBeenCalled();
		expect(await undoApplied(app as never, done)).toEqual({ restored: 1, failed: [] });
		expect(value()).toBe('Unsaved 日本語 [[Target#Old]]');
	});
	it('replans when typing moves a link after the preview', async () => {
		const { app, req, value, set } = setup();
		const plans = await planVault(app as never, req);
		set('Extra typing. [[Target#Old]]');
		await applyPlans(app as never, req, plans);
		expect(value()).toBe('Extra typing. [[Target#New]]');
	});
	it('leaves a changed editor alone when the user selected only some edits', async () => {
		const { app, req, value, set } = setup();
		const plans = await planVault(app as never, req);
		plans[0]!.partial = true;
		set('Extra typing. [[Target#Old]]');
		expect(await applyPlans(app as never, req, plans)).toEqual([]);
		expect(value()).toBe('Extra typing. [[Target#Old]]');
	});
});

describe('large rename and undo', () => {
	it('updates and restores 300 linking notes without changing their other text', async () => {
		const notes = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`Link ${i}.md`, `日本語 ${i} [[Target#Old|Alias]]\nKeep this line.`]));
		const app = App.createConfigured__({ files: { 'Target.md': '## New', ...notes } });
		const target = app.vault.getFileByPath('Target.md')!;
		app.metadataCache.resolvedLinks = Object.fromEntries(Object.keys(notes).map((path) => [path, { 'Target.md': 1 }]));
		vi.spyOn(app.metadataCache, 'getFirstLinkpathDest').mockReturnValue(target);
		vi.spyOn(app.metadataCache, 'getFileCache').mockReturnValue(null);
		const req: SyncRequest = { target: target as never, before: [{ text: 'Old', level: 2 }], after: [{ text: 'New', level: 2 }], blocks: [], markdown: false, blockLinks: false, excluded: [] };
		const plans = await planVault(app as never, req);
		const done = await applyPlans(app as never, req, plans);
		expect(done).toHaveLength(300);
		for (const [path, original] of Object.entries(notes)) expect(await app.vault.read(app.vault.getFileByPath(path)!)).toBe(original.replace('#Old', '#New'));
		expect(await undoApplied(app as never, done)).toEqual({ restored: 300, failed: [] });
		for (const [path, original] of Object.entries(notes)) expect(await app.vault.read(app.vault.getFileByPath(path)!)).toBe(original);
	});
});
