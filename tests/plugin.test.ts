import { describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import HeadingLinkSyncPlugin, { skipText, undoText } from '../src/main';
import { countText, editPreview, hiddenText, MAX_ROWS, previewModel, PreviewModal, selectedText } from '../src/modals';
import { bindPro, isPro, onProChange } from '../src/pro';
import { DEFAULT_SETTINGS, excludedList, isExcluded, normalizeSettings } from '../src/settings';
import { changedLines, snapshotOf } from '../src/watch';
import { applyEdits, planRewrite, undoRecord, type Edit } from '../src/links';
import { undoApplied, type FilePlan } from '../src/sync';
import manifest from '../manifest.json';

describe('HeadingLinkSyncPlugin', () => {
	it('loads with default settings against an in-memory vault', async () => {
		const app = App.createConfigured__({ files: { 'notes/a.md': '# Hello world' } });
		const plugin = new HeadingLinkSyncPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(isPro()).toBe(false);
	});
});

describe('settings', () => {
	it('repairs bad saved settings', () => {
		expect(normalizeSettings({ mode: 'later' as never, delayMs: 'x' as never, markdownLinks: 1 as never })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
	});
	it('clamps the pause', () => {
		expect(normalizeSettings({ delayMs: 10 }).delayMs).toBe(500);
		expect(normalizeSettings({ delayMs: 99999 }).delayMs).toBe(5000);
		expect(normalizeSettings({ delayMs: 1234.4 }).delayMs).toBe(1234);
	});
	it('reads excluded folders and matches whole folder names only', () => {
		const list = excludedList({ ...DEFAULT_SETTINGS, excludedFolders: ' /Templates/ \n\nArchive/2024\n' });
		expect(list).toEqual(['Templates', 'Archive/2024']);
		expect(isExcluded('Templates/Day.md', list)).toBe(true);
		expect(isExcluded('Templates2/Day.md', list)).toBe(false);
		expect(isExcluded('Archive/2024/a.md', list)).toBe(true);
	});
});

describe('Pro facade', () => {
	it('is off with no manager and follows the bound GitHub Sponsors manager', () => {
		bindPro(null);
		expect(isPro()).toBe(false);
		let pro = false;
		const listeners = new Set<() => void>();
		const fake = { isPro: () => pro, onChange: (cb: () => void) => (listeners.add(cb), () => listeners.delete(cb)) };
		bindPro(fake as never);
		const seen: boolean[] = [];
		const off = onProChange(() => seen.push(isPro()));
		pro = true;
		listeners.forEach((cb) => cb());
		off();
		pro = false;
		listeners.forEach((cb) => cb());
		expect(seen).toEqual([true]);
		expect(isPro()).toBe(false);
		bindPro(null);
	});
});

describe('notice and preview text', () => {
	it('counts links and notes', () => {
		expect(countText([{ edits: [1, 2] }, { edits: [3] }, { edits: [] }])).toBe('3 links in 2 notes');
		expect(countText([{ edits: [1] }])).toBe('1 link in 1 note');
	});
	it('says which links were left alone', () => {
		const s = (reason: string) => ({ line: 0, original: '', kind: 'markdown' as const, reason: reason as never });
		expect(skipText([s('pro-markdown'), s('pro-markdown'), s('pro-block')])).toBe('Not updated: 2 Markdown links and 1 block ID link (Pro).');
		expect(skipText([s('ambiguous')])).toBe('1 link was left alone because the new text is not safe to link to.');
		expect(skipText([])).toBe('');
	});
	it('shows the whole link before and after', () => {
		const text = 'See [[T#Old|alias]] here';
		const plan = planRewrite(text, { isTarget: () => true, before: [{ text: 'Old', level: 2 }], after: [{ text: 'New', level: 2 }], markdown: true, blockLinks: true });
		expect(editPreview(text, plan.edits[0]!)).toEqual({ from: '[[T#Old|alias]]', to: '[[T#New|alias]]' });
	});
});

describe('Pro preview model', () => {
	const edit = (n: number): Edit => ({ start: n * 20, end: n * 20 + 4, from: '#Old', to: '#New', line: n, kind: 'wikilink', reason: 'renamed' });
	const plan = (count: number) => ({ edits: Array.from({ length: count }, (_, n) => edit(n)) });
	it('has a row limit of 500', () => {
		expect(MAX_ROWS).toBe(500);
	});
	it('counts the changes with no row and their notes when a plan is larger than the limit', () => {
		const m = previewModel([plan(300), plan(0), plan(400), plan(1040)]);
		expect(m.shown.map((g) => [g.plan, g.edits.length])).toEqual([
			[0, 300],
			[2, 200],
		]);
		expect([m.links, m.notes, m.shownLinks, m.hiddenLinks, m.hiddenNotes]).toEqual([1740, 3, 500, 1240, 2]);
		expect(hiddenText(m)).toBe('The list shows the first 500 links. Not shown: 1,240 links in 2 notes. "Apply selected" also changes the links that are not shown.');
		expect(selectedText(m, 1740, 3)).toBe('Selected: 1,740 links in 3 notes, 1,240 of them not shown.');
		expect(selectedText(m, 1739, 3)).toBe('Selected: 1,739 links in 3 notes, 1,240 of them not shown.');
	});
	it('says nothing about hidden changes when every change has a row', () => {
		const m = previewModel([plan(499), plan(1)]);
		expect([m.links, m.notes, m.shownLinks, m.hiddenLinks, m.hiddenNotes]).toEqual([500, 2, 500, 0, 0]);
		expect(hiddenText(m)).toBe('');
		expect(selectedText(m, 499, 1)).toBe('Selected: 499 links in 1 note.');
	});
	it('counts one hidden change in one note', () => {
		const m = previewModel([plan(3)], 2);
		expect([m.shownLinks, m.hiddenLinks, m.hiddenNotes]).toEqual([2, 1, 1]);
		expect(hiddenText(m)).toContain('Not shown: 1 link in 1 note.');
	});
});

describe('Pro preview dialog', () => {
	const text = (count: number) => Array.from({ length: count }, () => 'See [[T#Old]].').join('\n');
	const filePlan = (path: string, count: number): FilePlan => {
		const before = text(count);
		const { edits, skipped } = planRewrite(before, { isTarget: () => true, before: [{ text: 'Old', level: 2 }], after: [{ text: 'New', level: 2 }], markdown: true, blockLinks: true });
		return { file: { path } as never, before, edits, skipped };
	};
	const open = (plans: FilePlan[]) => {
		const app = App.createConfigured__({ files: {} });
		const got: (FilePlan[] | null)[] = [];
		const modal = new PreviewModal(app as never, 'Heading "Old" is now "New" in T.', plans, (p) => got.push(p));
		modal.onOpen();
		return { modal, got };
	};
	it('shows the totals and the hidden count before the user applies, and applies what it says', () => {
		const { modal, got } = open([filePlan('a.md', 450), filePlan('b.md', 100), filePlan('c.md', 30)]);
		const el = modal.contentEl;
		expect(el.querySelectorAll('.hls-row input[type=checkbox]').length).toBe(500);
		expect([...el.querySelectorAll('.hls-file')].map((f) => f.textContent)).toEqual(['a.md', 'b.md']);
		expect(el.textContent).toContain('This changes 580 links in 3 notes.');
		expect(el.querySelector('.hls-more')?.textContent).toBe('The list shows the first 500 links. Not shown: 80 links in 2 notes. "Apply selected" also changes the links that are not shown.');
		expect(el.textContent).toContain('Selected: 580 links in 3 notes, 80 of them not shown.');
		const box = el.querySelector<HTMLInputElement>('.hls-row input[type=checkbox]')!;
		box.checked = false;
		box.dispatchEvent(new Event('change'));
		expect(el.textContent).toContain('Selected: 579 links in 3 notes, 80 of them not shown.');
		[...el.querySelectorAll('button')].find((b) => b.textContent === 'Apply selected')!.click();
		expect(got.length).toBe(1);
		expect(got[0]!.map((p) => [p.edits.length, p.partial])).toEqual([
			[449, true],
			[100, false],
			[30, false],
		]);
	});
	it('shows no hidden line when every change has a row', () => {
		const { modal } = open([filePlan('a.md', 2), filePlan('b.md', 1)]);
		const el = modal.contentEl;
		expect(el.querySelectorAll('.hls-row input[type=checkbox]').length).toBe(3);
		expect(el.querySelector('.hls-more')).toBeNull();
		expect(el.textContent).toContain('This changes 3 links in 2 notes.');
		expect(el.textContent).not.toContain('Selected');
	});
});

describe('undo in the vault', () => {
	const opts = { isTarget: () => true, before: [{ text: 'Old', level: 2 }], after: [{ text: 'New', level: 2 }], markdown: true, blockLinks: true };
	const applied = (path: string, before: string) => {
		const { edits } = planRewrite(before, opts);
		const written = applyEdits(before, edits);
		return { written, file: { path, edits, undo: undoRecord(written, edits) } };
	};
	it('restores the notes it is certain of, leaves the others as they are and names them', async () => {
		const a = applied('a.md', 'See [[T#Old]].');
		const b = applied('b.md', 'Is #New here? See [[T#Old]].');
		const c = applied('c.md', 'See [[T#Old]].');
		const bNow = `Is #New here? The link is gone.`;
		const app = App.createConfigured__({ files: { 'a.md': `Top line.\n${a.written}`, 'b.md': bNow } });
		const result = await undoApplied(app as never, [a.file, b.file, c.file]);
		expect(result).toEqual({ restored: 1, failed: ['b.md', 'c.md'] });
		expect(await app.vault.read(app.vault.getFileByPath('a.md')!)).toBe('Top line.\nSee [[T#Old]].');
		expect(await app.vault.read(app.vault.getFileByPath('b.md')!)).toBe(bNow);
	});
	it('names the notes that it did not restore', () => {
		expect(undoText(31, [])).toBe('Restored links in 31 notes.');
		expect(undoText(30, ['Meetings/a.md'])).toBe('Restored links in 30 notes. 1 note changed too much to restore and was left as it is: Meetings/a.md.');
		expect(undoText(0, ['1.md', '2.md', '3.md', '4.md', '5.md', '6.md', '7.md'])).toBe('Restored links in 0 notes. 7 notes changed too much to restore and were left as they are: 1.md, 2.md, 3.md, 4.md, 5.md and 2 more.');
	});
});

describe('watcher snapshots', () => {
	const pos = (line: number, offset: number) => ({ start: { line, col: 0, offset }, end: { line, col: 5, offset: offset + 5 } });
	const cache = (heading: string, block: string) =>
		({
			headings: [{ heading: 'Top', level: 1, position: pos(0, 0) }, { heading, level: 2, position: pos(4, 40) }],
			blocks: { [block.toLowerCase()]: { id: block, position: pos(8, 80) } },
		}) as never;
	it('reads headings, levels, lines and block IDs in order', () => {
		expect(snapshotOf(cache('Setup', 'abc'))).toEqual({ headings: [{ text: 'Top', level: 1 }, { text: 'Setup', level: 2 }], headingLines: [0, 4], blocks: ['abc'], blockLines: [8] });
		expect(snapshotOf(null)).toEqual({ headings: [], headingLines: [], blocks: [], blockLines: [] });
	});
	it('gives the lines of renamed headings and blocks', () => {
		const a = snapshotOf(cache('Setup', 'abc'));
		expect(changedLines(a, snapshotOf(cache('Install', 'abc')))).toEqual([4]);
		expect(changedLines(a, snapshotOf(cache('Setup', 'xyz')))).toEqual([8]);
		expect(changedLines(a, snapshotOf(cache('setup', 'ABC')))).toBeNull();
	});
});

describe('diffSpan', () => {
	it('finds the changed middle so the editor keeps the rest', async () => {
		const { diffSpan } = await import('../src/sync');
		expect(diffSpan('a [[T#New]] b', 'a [[T#Old]] b')).toEqual({ start: 6, endA: 9, endB: 9 });
		expect(diffSpan('same', 'same')).toEqual({ start: 4, endA: 4, endB: 4 });
		expect(diffSpan('ab', 'axb')).toEqual({ start: 1, endA: 1, endB: 2 });
	});
});
