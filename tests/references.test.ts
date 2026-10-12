import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import { referenceLines } from '../src/references';
import { ReferenceMarker } from '../src/reference-gutter';
import { normalizeSettings } from '../src/settings';

const position = (line: number) => ({ start: { line, col: 0, offset: line * 20 }, end: { line, col: 10, offset: line * 20 + 10 } });
const heading = (heading: string, level: number, line: number) => ({ heading, level, position: position(line) });
const link = (link: string) => ({ link, original: `[[${link}]]`, position: position(0) });
function fixture() {
	const app = App.createConfigured__({ files: { 'Folder/Target.md': '# A\n## Notes\n# B\n## Notes', 'Source.md': '', 'Ignore/Source.md': '', 'Other.md': '' } });
	const target = app.vault.getFileByPath('Folder/Target.md')!;
	let sourceLinks = [link('Target#Notes'), link('Target#B#Notes'), link('Target#^ABC'), link('Target#Missing'), link('Other#Notes'), link('Target')];
	const read = vi.spyOn(app.vault, 'cachedRead');
	vi.spyOn(app.metadataCache, 'getFileCache').mockImplementation((file) => {
		if (file.path === target.path) return { headings: [heading('A', 1, 0), heading('Notes', 2, 1), heading('B', 1, 2), heading('Notes', 2, 3)], blocks: { abc: { id: 'abc', position: position(4) } }, links: [link('#Notes')] } as never;
		if (file.path === 'Source.md') return { links: sourceLinks, embeds: [link('Target#Notes')], frontmatterLinks: [{ link: 'Target#Notes', key: 'related', original: '[[Target#Notes]]' }] } as never;
		if (file.path === 'Ignore/Source.md') return { links: [link('Target#Notes')] } as never;
		return null;
	});
	vi.spyOn(app.metadataCache, 'getFirstLinkpathDest').mockImplementation((path) => path === 'Target' ? target : app.vault.getFileByPath('Other.md'));
	app.metadataCache.resolvedLinks = { 'Source.md': { [target.path]: 6 }, 'Ignore/Source.md': { [target.path]: 1 } };
	return { app, target, read, change: () => { sourceLinks = [link('Target#B#Notes')]; } };
}
afterEach(() => vi.restoreAllMocks());

describe('reference counts in the app index', () => {
	it('counts links, embeds, properties, same-note links and block IDs without reading notes', () => {
		const { app, target, read } = fixture();
		expect([...referenceLines(app as never, target as never, [])]).toEqual([[1, 5], [3, 1], [4, 1]]);
		expect(read).not.toHaveBeenCalled();
	});
	it('omits excluded source notes and excluded targets', () => {
		const { app, target } = fixture();
		expect(referenceLines(app as never, target as never, ['Ignore']).get(1)).toBe(4);
		expect(referenceLines(app as never, target as never, ['Folder']).size).toBe(0);
	});
	it('uses the new source cache after a link is changed or deleted', () => {
		const { app, target, change } = fixture();
		change();
		expect([...referenceLines(app as never, target as never, [])]).toEqual([[1, 4], [3, 1]]);
		delete app.metadataCache.resolvedLinks['Source.md'];
		expect([...referenceLines(app as never, target as never, [])]).toEqual([[1, 2]]);
	});
	it('has no markers before the note cache is available', () => {
		const { app, target } = fixture();
		vi.mocked(app.metadataCache.getFileCache).mockReturnValue(null);
		expect(referenceLines(app as never, target as never, []).size).toBe(0);
	});
});

describe('reference marker', () => {
	it('shows the count with a readable label and compares counts', () => {
		const marker = new ReferenceMarker(2);
		const el = marker.toDOM();
		expect(el.textContent).toBe('2');
		expect(el.getAttribute('title')).toBe('2 links to this heading or block ID');
		expect(el.getAttribute('aria-label')).toBe(el.title);
		expect(marker.eq(new ReferenceMarker(2))).toBe(true);
		expect(marker.eq(new ReferenceMarker(1))).toBe(false);
		expect(new ReferenceMarker(1).toDOM().title).toBe('1 link to this heading or block ID');
	});
	it('defaults the free setting on and keeps a saved choice to hide counts', () => {
		expect(normalizeSettings(null).referenceCounts).toBe(true);
		expect(normalizeSettings({ referenceCounts: false }).referenceCounts).toBe(false);
		expect(normalizeSettings({ referenceCounts: 'yes' as never }).referenceCounts).toBe(true);
	});
});
