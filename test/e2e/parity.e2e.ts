// Parity: the pure functions in src/links.ts must give the same answers as the app's own functions.
import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { findLinks, resolveHeadingPath, stripHeading, stripHeadingForLink, type Heading } from '../../src/links';

const STRINGS = [
	'Q&A: what? [x]', 'A  B', 'Tag #topic here', 'Pipe | here', 'Percent 100% done', 'Link [[Other]] in', 'Under_score *bold*',
	'Café Notes', ' lead and trail ', 'a%%b', 'x^y', 'back\\slash', 'colon:x', 'dots...end', 'tab\tx', 'em — dash', 'quotes “a” ‘b’',
	"it's", 'a-b_c=d', 'naïve 日本語、テスト。', 'emoji 🚀 here', 'nbsp here', 'a~b`c{d}e', 'x/y\\z', '$money$', '[[a]]b', 'a]]b[[c',
	'1. Intro', '## not', '  ', '«guillemets»', 'a b', '%%', 'x%%y%%z', '50%20off', 'a#b#c',
];

/** Seeded generator so a failure can be replayed. */
function rng(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 2 ** 32;
	};
}
const VOCAB = ['Intro', 'Setup', 'notes', 'Notes', 'Q&A: x', 'Install', 'A  B'];

describe('parity with the app', function () {
	it('strips headings like the app', async function () {
		const app = await browser.executeObsidian(({ obsidian }, list) => list.map((s) => [obsidian.stripHeading(s), obsidian.stripHeadingForLink(s)]), STRINGS);
		expect(STRINGS.map((s) => [stripHeading(s), stripHeadingForLink(s)])).toEqual(app);
	});

	it('resolves nested and duplicate heading paths like the app', async function () {
		const r = rng(7);
		const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
		const notes: { headings: Heading[]; queries: string[][] }[] = [];
		for (let n = 0; n < 12; n++) {
			const headings: Heading[] = Array.from({ length: 4 + Math.floor(r() * 6) }, () => ({ text: pick(VOCAB), level: 1 + Math.floor(r() * 4) }));
			const queries = Array.from({ length: 25 }, () => Array.from({ length: 1 + Math.floor(r() * 3) }, () => pick(VOCAB)));
			notes.push({ headings, queries });
		}
		for (const [i, note] of notes.entries()) await obsidianPage.write(`parity/N${i}.md`, note.headings.map((h) => `${'#'.repeat(h.level)} ${h.text}\n\ntext\n`).join('\n'));
		await browser.pause(1500);
		const app = await browser.executeObsidian(({ app, obsidian }, all) => {
			return all.map((note, i) => {
				const cache = app.metadataCache.getFileCache(app.vault.getFileByPath(`parity/N${i}.md`)!)!;
				const lines = (cache.headings ?? []).map((h) => h.position.start.line);
				return note.queries.map((q) => {
					const res = obsidian.resolveSubpath(cache, `#${q.join('#')}`) as { current?: { position: { start: { line: number } } } } | null;
					return res?.current ? lines.indexOf(res.current.position.start.line) : -1;
				});
			});
		}, notes);
		const mine = notes.map((note) => note.queries.map((q) => resolveHeadingPath(note.headings, q)));
		expect(mine).toEqual(app);
	});

	it('finds the same links as the app', async function () {
		const text = [
			'---', 'up: "[[Target#Intro]]"', 'list:', '  - "[[Target#Setup|S]]"', '---',
			'[[Target#Q&A: what? [x]]]', '[[Target#Q&A what x]]', '[a](Target.md#Caf%C3%A9%20Notes)', '[b](<Target.md#A B>)', '[c](Target.md#Café%20Notes)',
			'![[Target#Setup]] and [[#Local]] and [[Target#^blockid|al]]', '[d](Target#Usage) [e](https://x.org/a#b)', '`[[Target#Usage]]` and ``[[x]] ` `` [[Target#Inline]]',
			'```', '[[Target#Fence]]', '```', '~~~~md', '[[Target#Tilde]]', '~~~~', '%% [[Target#Usage]] %%', '$$', '[[Target#Math]]', '$$',
			'> quote [[Target#Quoted]]', '- item [[Target#Item]]', '| a | [[Target#Cell\\|alias]] |', '[x](<Target.md#Space Name> "title")', '![img](Target.md#Pic)',
			'[[Target#A#B]] [[Target##A]]', '[nested [x]](Target.md#Br)',
		].join('\n');
		await obsidianPage.write('parity/Links.md', text);
		await browser.pause(1500);
		const app = await browser.executeObsidian(({ app }) => {
			const c = app.metadataCache.getFileCache(app.vault.getFileByPath('parity/Links.md')!)!;
			const body = [...(c.links ?? []), ...(c.embeds ?? [])].map((l) => `${l.position.start.line}:${l.link}`);
			const fm = (c.frontmatterLinks ?? []).map((l) => `fm:${l.link}`);
			return [...body, ...fm].sort();
		});
		const mine = findLinks(text)
			.map((l) => (l.frontmatter ? `fm:${l.path}${l.subpath}` : `${l.line}:${l.path}${l.subpath}`))
			.sort();
		expect(mine).toEqual(app);
	});
});
