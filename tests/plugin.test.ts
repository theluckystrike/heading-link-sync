import { describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import HeadingLinkSyncPlugin, { skipText } from '../src/main';
import { countText, editPreview } from '../src/modals';
import { bindPro, isPro, onProChange } from '../src/pro';
import { DEFAULT_SETTINGS, excludedList, isExcluded, normalizeSettings } from '../src/settings';
import { changedLines, snapshotOf } from '../src/watch';
import { planRewrite } from '../src/links';
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
