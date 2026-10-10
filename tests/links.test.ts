import { describe, expect, it } from 'vitest';
import vectors from './vectors/heading-link-sync.json';
import {
	applyEdits,
	codeRanges,
	diffBlocks,
	diffHeadings,
	encodePart,
	findLinks,
	frontmatterEnd,
	headingKey,
	pathTo,
	planRewrite,
	resolveHeadingPath,
	revertEdits,
	rewrite,
	safeDecode,
	similarity,
	splitSubpath,
	stripHeading,
	stripHeadingForLink,
	suggestHeading,
	type Heading,
} from '../src/links';

const h = (text: string, level = 2): Heading => ({ text, level });

describe('golden vectors (packages/spec/vectors/heading-link-sync.json)', () => {
	for (const c of vectors.cases) {
		it(c.name, () => {
			const [text, spec] = c.args as [string, Parameters<typeof rewrite>[1]];
			expect(rewrite(text, spec)).toEqual(c.expected);
		});
	}
	it('has a case for each required area', () => {
		const names = vectors.cases.map((c) => c.name).join('\n');
		for (const w of ['alias', 'embed', 'encoded spaces', 'nested', 'letter case', 'same headings', 'fenced code', 'frontmatter', 'block ID', 'same note']) expect(names).toContain(w);
	});
});

describe('stripHeading and stripHeadingForLink (the app examples from obsidian.d.ts)', () => {
	it('match the documented examples', () => {
		expect(stripHeading('foo!"#$%&()*+,.:;<=>?@^`{|}~/\\[]\\\r\nbar')).toBe('foo bar');
		expect(stripHeadingForLink('foo:#|^\\\r\n%%[[]]bar')).toBe('foo bar');
	});
	it('keep letters, digits, dashes, underscores and apostrophes', () => {
		expect(stripHeading("it's a-b_c")).toBe("it's a-b_c");
		expect(stripHeadingForLink('Q&A: what? [x]')).toBe('Q&A what? [x]');
		expect(headingKey('  Café  NOTES ')).toBe('café notes');
	});
});

describe('resolveHeadingPath', () => {
	const hs = [h('Intro', 1), h('Setup'), h('Install', 3), h('Usage'), h('Install', 3)];
	it('takes the first match and walks nested parts in order', () => {
		expect(resolveHeadingPath(hs, ['Install'])).toBe(2);
		expect(resolveHeadingPath(hs, ['Usage', 'Install'])).toBe(4);
		expect(resolveHeadingPath(hs, ['Intro', 'Usage', 'Install'])).toBe(4);
		expect(resolveHeadingPath(hs, ['install'])).toBe(2);
	});
	it('needs each part deeper than the one before and after it', () => {
		expect(resolveHeadingPath(hs, ['Usage', 'Setup'])).toBe(-1);
		expect(resolveHeadingPath(hs, ['Install', 'Install'])).toBe(-1);
		expect(resolveHeadingPath(hs, ['Setup', 'Usage'])).toBe(-1);
		expect(resolveHeadingPath(hs, [])).toBe(-1);
	});
	it('splits subpaths like the app', () => {
		expect(splitSubpath('#A##B#')).toEqual(['A', 'B']);
		expect(splitSubpath('')).toEqual([]);
	});
	it('pathTo gives the shortest path that resolves', () => {
		const dup = [h('A', 1), h('Notes'), h('B', 1), h('Notes')];
		expect(pathTo(dup, 1)).toEqual(['Notes']);
		expect(pathTo(dup, 3)).toEqual(['B', 'Notes']);
		expect(pathTo([h('Notes'), h('Notes')], 1)).toBeNull();
		expect(pathTo([h('?')], 0)).toBeNull();
	});
});

describe('findLinks', () => {
	it('gives kinds, spans, paths, subpaths and lines', () => {
		const text = 'a [[N#H|x]]\n![[N#H]] [t](N.md#A%20B) [u](<N.md#A B>) [v](N.md#Caf%C3%A9)';
		const links = findLinks(text);
		expect(links.map((l) => [l.kind, l.path, l.subpath, l.line, l.style])).toEqual([
			['wikilink', 'N', '#H', 0, 'wiki'],
			['embed', 'N', '#H', 1, 'wiki'],
			['markdown', 'N.md', '#A B', 1, 'plain'],
			['markdown', 'N.md', '#A B', 1, 'angle'],
			['markdown', 'N.md', '#Café', 1, 'encoded'],
		]);
		const first = links[0]!;
		expect(text.slice(first.start, first.end)).toBe('[[N#H|x]]');
		expect(text.slice(first.subStart, first.subEnd)).toBe('#H');
	});
	it('skips links in extra excluded ranges, for example indented code that the app found', () => {
		const text = '    [[N#H]]\n[[N#H]]';
		expect(findLinks(text, [{ start: 0, end: 12 }]).map((l) => l.line)).toEqual([1]);
	});
	it('skips web links, broken Markdown links and wikilinks inside Markdown link text', () => {
		expect(findLinks('[a](http://x.org#h) [b](mailto:a@b.c) [c](N.md#h [d](N.md#h\n)').length).toBe(0);
		expect(findLinks('[[N#H]](x.md)').map((l) => l.kind)).toEqual(['wikilink']);
	});
	it('gives up on very large text instead of hanging', () => {
		expect(findLinks('[[a#b]]'.repeat(800_000))).toEqual([]);
	});
});

describe('frontmatter and code ranges', () => {
	it('finds the end of frontmatter', () => {
		expect(frontmatterEnd('---\na: 1\n---\nbody')).toBe(13);
		expect(frontmatterEnd('---\na: 1\n...\n')).toBe(13);
		expect(frontmatterEnd('body\n---\n')).toBe(0);
		expect(frontmatterEnd('---\nnever closed')).toBe(0);
	});
	it('finds fences, math and inline code', () => {
		const text = 'a `b` c\n```\nx\n```\n$$\ny\n$$\n$$ one line $$\n';
		expect(codeRanges(text).map((r) => text.slice(r.start, r.end))).toEqual(['`b`', '```\nx\n```\n', '$$\ny\n$$\n', '$$ one line $$\n']);
	});
	it('does not close a backtick fence with tildes or a shorter fence', () => {
		const text = '````\n~~~\n```\n[[N#H]]\n````\n[[N#H]]';
		expect(findLinks(text).map((l) => l.line)).toEqual([5]);
	});
});

describe('planRewrite', () => {
	const before = [h('Setup')];
	const after = [h('Install')];
	it('reports the line, kind and reason of each edit', () => {
		const plan = planRewrite('x\n[[T#Setup]]', { isTarget: () => true, before, after, markdown: true, blockLinks: true });
		expect(plan.edits).toEqual([{ start: 5, end: 11, from: '#Setup', to: '#Install', line: 1, kind: 'wikilink', reason: 'renamed' }]);
	});
	it('does nothing when no heading or block changed', () => {
		expect(planRewrite('[[T#Setup]]', { isTarget: () => true, before, after: before, markdown: true, blockLinks: true })).toEqual({ edits: [], skipped: [] });
	});
	it('asks isTarget with the decoded path and with "" for the same note', () => {
		const asked: string[] = [];
		planRewrite('[[#Setup]] [a](My%20Note.md#Setup)', { isTarget: (p) => (asked.push(p), false), before, after, markdown: true, blockLinks: true });
		expect(asked).toEqual(['', 'My Note.md']);
	});
});

describe('applyEdits and revertEdits', () => {
	const text = 'A [[T#Old]] B [[T#Old|x]] C';
	const plan = planRewrite(text, { isTarget: () => true, before: [h('Old')], after: [h('New name')], markdown: true, blockLinks: true });
	const changed = applyEdits(text, plan.edits);
	it('applies and restores exactly', () => {
		expect(changed).toBe('A [[T#New name]] B [[T#New name|x]] C');
		expect(revertEdits(changed, plan.edits)).toBe(text);
	});
	it('restores after other text in the note changed', () => {
		expect(revertEdits(`Intro line\n${changed} more`, plan.edits)).toBe(`Intro line\n${text} more`);
	});
	it('gives null when a changed link is gone', () => {
		expect(revertEdits('A [[T#Something else]]', plan.edits)).toBeNull();
	});
	it('refuses edits that do not match the text', () => {
		expect(() => applyEdits('other text entirely', plan.edits)).toThrow();
	});
});

describe('diffHeadings and diffBlocks', () => {
	it('finds renames by position and ignores case-only changes', () => {
		expect(diffHeadings([h('A'), h('B')], [h('A'), h('C')])).toEqual([{ index: 1, from: 'B', to: 'C' }]);
		expect(diffHeadings([h('A')], [h('a')])).toEqual([]);
	});
	it('gives null when headings were added, removed or changed level', () => {
		expect(diffHeadings([h('A')], [h('A'), h('B')])).toBeNull();
		expect(diffHeadings([h('A', 2)], [h('A', 3)])).toBeNull();
	});
	it('finds block ID renames and rejects bad IDs', () => {
		expect(diffBlocks(['abc', 'x'], ['abd', 'x'])).toEqual([{ from: 'abc', to: 'abd' }]);
		expect(diffBlocks(['abc'], ['ABC'])).toEqual([]);
		expect(diffBlocks(['abc'], ['a b'])).toBeNull();
		expect(diffBlocks(['abc'], [])).toBeNull();
	});
});

describe('suggestions for broken links', () => {
	it('scores similarity', () => {
		expect(similarity('abc', 'abc')).toBe(1);
		expect(similarity('', 'abc')).toBe(0);
		expect(similarity('setup', 'set up')).toBeGreaterThan(0.8);
	});
	it('suggests the closest heading or nothing', () => {
		const hs = [h('Installation'), h('Usage')];
		expect(suggestHeading(['Instalation'], hs)).toBe(0);
		expect(suggestHeading(['Completely different'], hs)).toBe(-1);
		expect(suggestHeading(['?'], hs)).toBe(-1);
	});
});

describe('encoding', () => {
	it('writes parts per link style', () => {
		expect(encodePart('A B', 'wiki')).toBe('A B');
		expect(encodePart('A B', 'angle')).toBe('A B');
		expect(encodePart('A B (1)', 'plain')).toBe('A%20B%20(1)');
		expect(encodePart('Café #1', 'encoded')).toBe('Caf%C3%A9%20%231');
	});
	it('never throws on a bad escape', () => {
		expect(safeDecode('100%%20done')).toBe('100% done');
		expect(safeDecode('A%20B')).toBe('A B');
	});
});
