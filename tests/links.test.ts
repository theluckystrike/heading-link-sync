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
	referenceCounts,
	revertEdits,
	rewrite,
	safeDecode,
	similarity,
	splitSubpath,
	stripHeading,
	stripHeadingForLink,
	suggestHeading,
	textStamp,
	undoRecord,
	type Heading,
} from '../src/links';

const h = (text: string, level = 2): Heading => ({ text, level });

describe('golden vectors (packages/spec/vectors/heading-link-sync.json)', () => {
	for (const c of vectors.cases) {
		it(c.name, () => {
			if ('function' in c && c.function === 'referenceCounts') {
				const [headings, blocks, subpaths] = c.args as Parameters<typeof referenceCounts>;
				expect(referenceCounts(headings, blocks, subpaths)).toEqual(c.expected);
				return;
			}
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
	const rec = undoRecord(changed, plan.edits);
	it('applies and restores exactly', () => {
		expect(changed).toBe('A [[T#New name]] B [[T#New name|x]] C');
		expect(revertEdits(changed, rec)).toBe(text);
	});
	it('restores after other text in the note changed', () => {
		expect(revertEdits(`Intro line\n${changed} more`, rec)).toBe(`Intro line\n${text} more`);
	});
	it('gives null when a changed link is gone', () => {
		expect(revertEdits('A [[T#Something else]]', rec)).toBeNull();
	});
	it('refuses edits that do not match the text', () => {
		expect(() => applyEdits('other text entirely', plan.edits)).toThrow();
	});
});

describe('undo restores only the links that the update wrote', () => {
	const opts = { isTarget: (p: string) => p === 'T' || p === 'T.md', before: [h('Old')], after: [h('New')], markdown: true, blockLinks: true };
	/** Runs the forward path on a note. Gives the written text and the undo record. */
	const write = (text: string, o: Parameters<typeof planRewrite>[1] = opts) => {
		const plan = planRewrite(text, o);
		const written = applyEdits(text, plan.edits);
		return { written, edits: plan.edits.length, rec: undoRecord(written, plan.edits) };
	};

	it('unchanged note: restores by offset on the fast path', () => {
		const text = 'The #New plan.\n```\n[[T#New]]\n```\n[[T#New]] and [[T#Old]] and [t](T.md#Old).';
		const { written, edits, rec } = write(text);
		expect(edits).toBe(2);
		expect(written).toBe('The #New plan.\n```\n[[T#New]]\n```\n[[T#New]] and [[T#New]] and [t](T.md#New).');
		expect(rec.stamp).toBe(textStamp(written));
		expect(revertEdits(written, rec)).toBe(text);
	});
	it('unchanged note: the fast path does not need the parser, so a link that it cannot read is restored too', () => {
		const text = 'See [[T#Old]].';
		const { written, rec } = write(text, { ...opts, after: [h('a]b')] });
		expect(written).toBe('See [[T#a]b]].');
		expect(rec.edits[0]!.link).toBe('');
		expect(revertEdits(written, rec)).toBe(text);
		expect(revertEdits(`x ${written}`, rec)).toBeNull();
	});
	it('changed note: the new text as plain text before the link stays as it is', () => {
		const text = 'The #New plan is in T#New.\nSee [[T#Old]].';
		const { written, rec } = write(text);
		expect(written).toBe('The #New plan is in T#New.\nSee [[T#New]].');
		expect(revertEdits(`A new first line.\n${written}`, rec)).toBe(`A new first line.\n${text}`);
	});
	it('changed note: the same link in a fenced code block stays as it is', () => {
		const text = 'Example:\n```md\n[[T#New]]\n```\nInline `[[T#New]]` too.\nSee [[T#Old]].';
		const { written, rec } = write(text);
		expect(written).toBe('Example:\n```md\n[[T#New]]\n```\nInline `[[T#New]]` too.\nSee [[T#New]].');
		expect(revertEdits(`A new first line.\n${written}`, rec)).toBe(`A new first line.\n${text}`);
	});
	it('changed note: of two equal links, only the one that the update wrote is restored', () => {
		const text = 'First [[T#New]], which the update did not write.\nThen [[T#Old]].';
		const { written, edits, rec } = write(text);
		expect(edits).toBe(1);
		expect(written).toBe('First [[T#New]], which the update did not write.\nThen [[T#New]].');
		expect(rec.edits[0]).toMatchObject({ link: '[[T#New]]', nth: 1, of: 2 });
		expect(revertEdits(`A new first line.\n${written}`, rec)).toBe(`A new first line.\n${text}`);
	});
	it('changed note: a link with the same heading in another note stays as it is', () => {
		const text = 'See [[Other#New]] and [[T#Old|the plan]].';
		const { written, rec } = write(text);
		expect(written).toBe('See [[Other#New]] and [[T#New|the plan]].');
		expect(revertEdits(`${written} More text.`, rec)).toBe(`${text} More text.`);
		expect(revertEdits('See [[Other#New]] and more text.', rec)).toBeNull();
	});
	it('changed note: finds Markdown links, embeds and property links again', () => {
		const text = '---\nrel: "[[T#Old]]"\n---\nBody [t](T.md#Old) and ![[T#Old]] and [u](<T.md#Old>).';
		const { written, edits, rec } = write(text);
		expect(edits).toBe(4);
		expect(revertEdits(`${written}\nA new last line with #New in it.`, rec)).toBe(`${text}\nA new last line with #New in it.`);
	});
	it('changed note: gives null when the count of equal links changed, so the written one is not certain', () => {
		const text = '- [[T#Old]]\n- [[T#New]]\n';
		const { written, rec } = write(text);
		expect(written).toBe('- [[T#New]]\n- [[T#New]]\n');
		// The written line is deleted: the other link is now at the same offset, but the update did not write it.
		expect(revertEdits('- [[T#New]]\n', rec)).toBeNull();
		expect(revertEdits(`${written}- [[T#New]]\n`, rec)).toBeNull();
	});
	it('changed note: gives null when the written link is now in a code block', () => {
		const { written, rec } = write('See [[T#Old]].');
		expect(revertEdits(`\`\`\`\n${written}\n\`\`\``, rec)).toBeNull();
	});
	it('changed note: restores all links or none', () => {
		const text = 'One [[T#Old]].\nTwo ![[T#Old]].';
		const { written, rec } = write(text);
		expect(revertEdits(`Top.\n${written}`, rec)).toBe(`Top.\n${text}`);
		expect(revertEdits('Top.\nOne [[T#New]].\nTwo is gone.', rec)).toBeNull();
	});
	it('changed note: follows links that moved in the note', () => {
		const text = 'One [[T#Old|a]].\nTwo [[T#Old|b]].';
		const { rec } = write(text);
		expect(revertEdits('Two [[T#New|b]].\nOne [[T#New|a]].', rec)).toBe('Two [[T#Old|b]].\nOne [[T#Old|a]].');
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

describe('large notes', () => {
	it('reads a long paragraph with much inline code in linear time', () => {
		// 2 MB list with no blank line: each inline code span used to search to the paragraph end again.
		const list = '- item `code` and [[A#B]]\n'.repeat(80_000);
		const start = performance.now();
		expect(findLinks(list)).toHaveLength(80_000);
		expect(performance.now() - start).toBeLessThan(20000);
	});
});
