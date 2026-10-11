// Pure link logic. No import from 'obsidian', so vitest runs it as is and the golden vectors in
// packages/spec/vectors/heading-link-sync.json call it directly. stripHeading, stripHeadingForLink and
// resolveHeadingPath copy what the app does; test/e2e/parity.e2e.ts compares them with the app's own
// functions on 1.13.4 and on the latest version.

export interface Heading {
	text: string;
	level: number;
}

export interface Range {
	start: number;
	end: number;
}

export type LinkKind = 'wikilink' | 'embed' | 'markdown';

export interface LinkRef {
	kind: LinkKind;
	/** Span of the whole link in the text. */
	start: number;
	end: number;
	/** Span of the raw subpath (from the first '#' to the end of the target). Equal to the end of the path when there is no subpath. */
	subStart: number;
	subEnd: number;
	/** Decoded link path. '' is a link inside the same note. */
	path: string;
	/** Decoded subpath with its leading '#', or ''. */
	subpath: string;
	/** How a Markdown link writes its target: angle brackets, raw (spaces as %20) or fully percent-encoded. */
	style: 'wiki' | 'angle' | 'plain' | 'encoded';
	frontmatter: boolean;
	/** 0-based line of the link start. */
	line: number;
}

/** Characters that the app removes before it compares a link with a heading. */
const STRIP_CHARS = /[!"#$%&()*+,.:;<=>?@^`{|}~/\\[\]\r\n]/g;
/** Character runs that the app removes when it makes a link to a heading. */
const LINK_CHARS = /%%|\[\[|\]\]|[:#|^\\\r\n]/g;
const MAX_TEXT = 5_000_000;
const MAX_SEGMENTS = 16;

/** Same result as the app's stripHeading: special characters become spaces, spaces collapse, ends trimmed. */
export function stripHeading(heading: string): string {
	return heading.replace(STRIP_CHARS, ' ').replace(/\s+/g, ' ').trim();
}

/** Same result as the app's stripHeadingForLink: the heading text as it goes into a link. */
export function stripHeadingForLink(heading: string): string {
	return heading.replace(LINK_CHARS, ' ').replace(/\s+/g, ' ').trim();
}

/** The key that the app compares: stripped and lower case. */
export function headingKey(text: string): string {
	return stripHeading(text).toLowerCase();
}

/** Splits '#A#B' into ['A', 'B'] and drops empty parts, as the app does. */
export function splitSubpath(subpath: string): string[] {
	return subpath
		.split('#')
		.filter((s) => s.length > 0)
		.slice(0, MAX_SEGMENTS);
}

/**
 * Index of the heading that a nested heading path points to, or -1.
 * Each part must match a later heading that is deeper than the heading of the part before it.
 * The first match wins, so a link to a duplicate heading goes to the first one.
 */
export function resolveHeadingPath(headings: readonly Heading[], segments: readonly string[]): number {
	const parts = segments.map(headingKey);
	if (parts.length === 0) return -1;
	let k = 0;
	let level = 0;
	for (let i = 0; i < headings.length; i++) {
		const h = headings[i]!;
		if (h.level > level && headingKey(h.text) === parts[k]) {
			k++;
			level = h.level;
			if (k === parts.length) return i;
		}
	}
	return -1;
}

/** Offset just after the closing line of YAML frontmatter, or 0 when the note has none. */
export function frontmatterEnd(text: string): number {
	if (!/^---[ \t]*\r?\n/.test(text)) return 0;
	const close = /\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/g;
	close.lastIndex = 3;
	const m = close.exec(text);
	return m ? m.index + m[0].length : 0;
}

/** Fenced code, math blocks and inline code: the app finds no links there, so neither does this module. */
export function codeRanges(text: string, from = 0): Range[] {
	const blocks = blockRanges(text, from);
	const out = [...blocks];
	let pos = from;
	for (const b of [...blocks, { start: text.length, end: text.length }]) {
		inlineCode(text, pos, b.start, out);
		pos = b.end;
	}
	return out.sort((a, b) => a.start - b.start);
}

const FENCE_OPEN = /^(?:[ \t]*>)*[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^(?:[ \t]*>)*[ \t]*(`{3,}|~{3,})[ \t]*$/;

function blockRanges(text: string, from: number): Range[] {
	const out: Range[] = [];
	let fence: { start: number; ch: string; len: number } | null = null;
	let math: number | null = null;
	let pos = from;
	while (pos < text.length) {
		const nl = text.indexOf('\n', pos);
		const end = nl < 0 ? text.length : nl + 1;
		const line = text.slice(pos, nl < 0 ? text.length : nl).replace(/\r$/, '');
		if (fence) {
			const m = FENCE_CLOSE.exec(line);
			if (m && m[1]![0] === fence.ch && m[1]!.length >= fence.len) {
				out.push({ start: fence.start, end });
				fence = null;
			}
		} else if (math !== null) {
			if (line.includes('$$')) {
				out.push({ start: math, end });
				math = null;
			}
		} else {
			const f = FENCE_OPEN.exec(line);
			const body = line.replace(/^(?:[ \t]*>)*[ \t]*/, '');
			if (f && !(f[1]![0] === '`' && f[2]!.includes('`'))) fence = { start: pos, ch: f[1]![0]!, len: f[1]!.length };
			else if (body.startsWith('$$')) {
				if (body.slice(2).includes('$$')) out.push({ start: pos, end });
				else math = pos;
			}
		}
		pos = end;
	}
	if (fence) out.push({ start: fence.start, end: text.length });
	if (math !== null) out.push({ start: math, end: text.length });
	return out;
}

function backtickRun(text: string, at: number): number {
	let n = 0;
	while (text[at + n] === '`') n++;
	return n;
}

/** Pushes inline code spans between from and to. A span ends at a run of the same length before a blank line. */
function inlineCode(text: string, from: number, to: number, out: Range[]): void {
	let i = from;
	while (i < to) {
		const b = text.indexOf('`', i);
		if (b < 0 || b >= to) return;
		const n = backtickRun(text, b);
		const para = /\n[ \t]*\r?\n/g;
		para.lastIndex = b;
		const pm = para.exec(text);
		const limit = Math.min(to, pm ? pm.index : to);
		let j = b + n;
		let closed = -1;
		while (j < limit) {
			const c = text.indexOf('`', j);
			if (c < 0 || c >= limit) break;
			const m = backtickRun(text, c);
			if (m === n) {
				closed = c + m;
				break;
			}
			j = c + m;
		}
		if (closed > 0) {
			out.push({ start: b, end: closed });
			i = closed;
		} else i = b + n;
	}
}

function inRanges(pos: number, ranges: readonly Range[]): boolean {
	return ranges.some((r) => pos >= r.start && pos < r.end);
}

function lineAt(starts: readonly number[], pos: number): number {
	let lo = 0;
	let hi = starts.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (starts[mid]! <= pos) lo = mid;
		else hi = mid - 1;
	}
	return lo;
}

function lineStarts(text: string): number[] {
	const out = [0];
	for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) out.push(i + 1);
	return out;
}

/** decodeURIComponent that never throws: a bad escape keeps the text and only decodes %20. */
export function safeDecode(s: string): string {
	try {
		return decodeURIComponent(s);
	} catch {
		return s.replace(/%20/g, ' ');
	}
}

const WIKI = /(!?)\[\[([^\]\n]+)\]\]/g;
const MD_OPEN = /(!?)\[((?:[^[\]\n]|\[[^[\]\n]*\])*)\]\(/g;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Every wikilink, embed and Markdown link in the text, outside code, math and the given extra ranges.
 * Links in frontmatter are found too (wikilinks only, as the app does for properties).
 */
export function findLinks(text: string, exclude: readonly Range[] = []): LinkRef[] {
	if (text.length > MAX_TEXT) return [];
	const fm = frontmatterEnd(text);
	const skip = [...codeRanges(text, fm), ...exclude];
	const starts = lineStarts(text);
	const out: LinkRef[] = [];
	for (const m of text.matchAll(WIKI)) {
		const start = m.index;
		if (inRanges(start, skip)) continue;
		const inner = m[2]!;
		const innerStart = start + m[1]!.length + 2;
		const pipe = inner.indexOf('|');
		let target = pipe < 0 ? inner : inner.slice(0, pipe);
		if (pipe >= 0 && target.endsWith('\\')) target = target.slice(0, -1);
		const hash = target.indexOf('#');
		const path = (hash < 0 ? target : target.slice(0, hash)).trim();
		out.push({
			kind: m[1] ? 'embed' : 'wikilink',
			start,
			end: start + m[0].length,
			subStart: innerStart + (hash < 0 ? target.length : hash),
			subEnd: innerStart + target.length,
			path,
			subpath: hash < 0 ? '' : target.slice(hash),
			style: 'wiki',
			frontmatter: start < fm,
			line: lineAt(starts, start),
		});
	}
	const wikiSpans: Range[] = out.map((l) => ({ start: l.start, end: l.end }));
	for (const m of text.matchAll(MD_OPEN)) {
		const start = m.index;
		if (start < fm || inRanges(start, skip) || inRanges(start, wikiSpans)) continue;
		const dest = parseDest(text, start + m[0].length);
		if (!dest || SCHEME.test(dest.raw)) continue;
		const hash = dest.raw.indexOf('#');
		const rawPath = hash < 0 ? dest.raw : dest.raw.slice(0, hash);
		const rawSub = hash < 0 ? '' : dest.raw.slice(hash);
		out.push({
			kind: 'markdown',
			start,
			end: dest.end,
			subStart: dest.start + (hash < 0 ? dest.raw.length : hash),
			subEnd: dest.start + dest.raw.length,
			path: safeDecode(rawPath),
			subpath: safeDecode(rawSub),
			style: dest.angle ? 'angle' : /%(?!20)[0-9a-f]{2}/i.test(rawSub) ? 'encoded' : 'plain',
			frontmatter: false,
			line: lineAt(starts, start),
		});
	}
	return out.sort((a, b) => a.start - b.start);
}

/** Reads a Markdown link destination that starts at pos (just after '('). Returns null when it is not a link. */
function parseDest(text: string, pos: number): { start: number; raw: string; end: number; angle: boolean } | null {
	let i = pos;
	while (text[i] === ' ' || text[i] === '\t') i++;
	if (text[i] === '<') {
		const close = text.indexOf('>', i + 1);
		const nl = text.indexOf('\n', i + 1);
		if (close < 0 || (nl >= 0 && nl < close)) return null;
		const after = closeParen(text, close + 1);
		return after < 0 ? null : { start: i + 1, raw: text.slice(i + 1, close), end: after, angle: true };
	}
	const start = i;
	let depth = 0;
	while (i < text.length) {
		const c = text[i]!;
		if (c === '\\') i += 2;
		else if (c === '(') {
			depth++;
			i++;
		} else if (c === ')') {
			if (depth === 0) break;
			depth--;
			i++;
		} else if (/\s/.test(c)) break;
		else i++;
	}
	if (i === start) return null;
	const after = closeParen(text, i);
	return after < 0 ? null : { start, raw: text.slice(start, i), end: after, angle: false };
}

/** Skips an optional title and returns the offset after the closing ')', or -1. */
function closeParen(text: string, pos: number): number {
	const m = /^[ \t]*(?:(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\))[ \t]*)?\)/.exec(text.slice(pos, pos + 500));
	return m ? pos + m[0].length : -1;
}

/** Writes one subpath part for a link of this style. Matches the app: Markdown links get %20 for spaces. */
export function encodePart(part: string, style: LinkRef['style']): string {
	if (style === 'wiki' || style === 'angle') return part;
	if (style === 'encoded') return encodeURI(part).replace(/#/g, '%23');
	let s = part.replace(/ /g, '%20');
	const open = (s.match(/\(/g) ?? []).length;
	const close = (s.match(/\)/g) ?? []).length;
	if (open !== close) s = s.replace(/\(/g, '%28').replace(/\)/g, '%29');
	return s;
}

export interface BlockRename {
	from: string;
	to: string;
}

export interface PlanOptions {
	/** True when a link path points to the note that changed. '' is a link inside the same note. */
	isTarget: (path: string) => boolean;
	/** Headings of the changed note before the edit. */
	before: readonly Heading[];
	/** Headings after the edit, same count and levels as before. */
	after: readonly Heading[];
	/** Block ID renames in the changed note. */
	blocks?: readonly BlockRename[];
	/** Rewrite Markdown links (Pro). Off: they are reported as skipped. */
	markdown: boolean;
	/** Rewrite links to block IDs (Pro). Off: they are reported as skipped. */
	blockLinks: boolean;
	/** Extra ranges with no links, for example indented code that the app found. */
	exclude?: readonly Range[];
}

export type EditReason = 'renamed' | 'kept-target' | 'block';
export type SkipReason = 'pro-markdown' | 'pro-block' | 'ambiguous' | 'empty' | 'frontmatter-quote';

export interface Edit {
	start: number;
	end: number;
	from: string;
	to: string;
	line: number;
	kind: LinkKind;
	reason: EditReason;
}

export interface Skip {
	line: number;
	original: string;
	kind: LinkKind;
	reason: SkipReason;
}

export interface Plan {
	edits: Edit[];
	skipped: Skip[];
}

/** Parent chain of heading i, nearest first. */
function ancestors(headings: readonly Heading[], i: number): number[] {
	const out: number[] = [];
	let level = headings[i]!.level;
	for (let j = i - 1; j >= 0 && level > 1; j--) {
		if (headings[j]!.level < level) {
			out.push(j);
			level = headings[j]!.level;
		}
	}
	return out;
}

/** The shortest heading path that the app resolves to heading i, or null. */
export function pathTo(after: readonly Heading[], i: number): string[] | null {
	const chain = [i, ...ancestors(after, i)];
	for (let n = 1; n <= chain.length; n++) {
		const path = chain
			.slice(0, n)
			.reverse()
			.map((j) => stripHeadingForLink(after[j]!.text));
		if (path.some((p) => headingKey(p) === '')) return null;
		if (resolveHeadingPath(after, path) === i) return path;
	}
	return null;
}

type Decision = { parts: string[]; reason: EditReason } | { skip: SkipReason } | null;

function decideHeading(parts: string[], opts: PlanOptions, renamed: ReadonlySet<number>): Decision {
	const target = resolveHeadingPath(opts.before, parts);
	if (target < 0) return null;
	let touched = false;
	const next = parts.map((p, k) => {
		const at = resolveHeadingPath(opts.before, parts.slice(0, k + 1));
		if (!renamed.has(at)) return p;
		touched = true;
		return stripHeadingForLink(opts.after[at]!.text);
	});
	if (next.some((p) => headingKey(p) === '')) return { skip: 'empty' };
	if (resolveHeadingPath(opts.after, next) === target) return touched ? { parts: next, reason: 'renamed' } : null;
	const fixed = pathTo(opts.after, target);
	if (!fixed) return { skip: 'ambiguous' };
	return { parts: fixed, reason: touched ? 'renamed' : 'kept-target' };
}

function decideBlock(parts: string[], opts: PlanOptions): Decision {
	if (parts.length !== 1) return null;
	const id = parts[0]!.slice(1).trim().toLowerCase();
	const hit = (opts.blocks ?? []).find((b) => b.from.toLowerCase() === id);
	if (!hit) return null;
	return { parts: [`^${hit.to}`], reason: 'block' };
}

/** Finds every link to the changed headings or block IDs and says how to rewrite it. */
export function planRewrite(text: string, opts: PlanOptions): Plan {
	const edits: Edit[] = [];
	const skipped: Skip[] = [];
	const renamed = new Set<number>();
	opts.before.forEach((h, i) => {
		const a = opts.after[i];
		if (a && headingKey(a.text) !== headingKey(h.text)) renamed.add(i);
	});
	if (renamed.size === 0 && !opts.blocks?.length) return { edits, skipped };
	for (const link of findLinks(text, opts.exclude)) {
		if (!link.subpath || !opts.isTarget(link.path)) continue;
		const parts = splitSubpath(link.subpath);
		if (parts.length === 0) continue;
		const isBlock = parts[0]!.startsWith('^');
		const d = isBlock ? decideBlock(parts, opts) : decideHeading(parts, opts, renamed);
		if (!d) continue;
		const original = text.slice(link.start, link.end);
		const skip = (reason: SkipReason) => skipped.push({ line: link.line, original, kind: link.kind, reason });
		if ('skip' in d) {
			skip(d.skip);
			continue;
		}
		if (isBlock && !opts.blockLinks) {
			skip('pro-block');
			continue;
		}
		if (link.kind === 'markdown' && !opts.markdown) {
			skip('pro-markdown');
			continue;
		}
		const to = `#${d.parts.map((p) => encodePart(p, link.style)).join('#')}`;
		if (link.frontmatter && /["']/.test(to)) {
			skip('frontmatter-quote');
			continue;
		}
		const from = text.slice(link.subStart, link.subEnd);
		if (to === from) continue;
		edits.push({ start: link.subStart, end: link.subEnd, from, to, line: link.line, kind: link.kind, reason: d.reason });
	}
	return { edits, skipped };
}

/** Applies edits (positions in the original text). */
export function applyEdits(text: string, edits: readonly Edit[]): string {
	let out = text;
	for (const e of [...edits].sort((a, b) => b.start - a.start)) {
		if (out.slice(e.start, e.end) !== e.from) throw new Error(`edit at ${e.start} does not match the text`);
		out = out.slice(0, e.start) + e.to + out.slice(e.end);
	}
	return out;
}

/** One edit as it was written, with what undo needs to find its link again. */
export interface WrittenEdit {
	/** Offset of the new subpath in the note as written. */
	at: number;
	from: string;
	to: string;
	/** The whole link as written, for example '[[Note#New|alias]]'. '' when findLinks sees no link at that place. */
	link: string;
	/** Offset of the subpath inside the link. */
	subAt: number;
	/** Place of this link among the links with the same text in the written note (0-based), and how many there were. */
	nth: number;
	of: number;
}

export interface UndoRecord {
	/** Length and hash of the note as written. */
	stamp: string;
	/** One entry for each edit, in the order of the note. */
	edits: WrittenEdit[];
}

/** Length and a 64-bit hash of a text. Undo treats two texts with the same stamp as the same text. */
export function textStamp(text: string): string {
	let a = 0xdeadbeef;
	let b = 0x41c6ce57;
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		a = Math.imul(a ^ c, 2654435761);
		b = Math.imul(b ^ c, 1597334677);
	}
	a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
	b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
	return `${text.length}:${(b >>> 0).toString(36)}:${(a >>> 0).toString(36)}`;
}

/** What undo needs for edits that applyEdits made. written is the note text after the edits. */
export function undoRecord(written: string, edits: readonly Edit[]): UndoRecord {
	const seen = new Map<string, number>();
	const bySub = new Map<number, { link: LinkRef; text: string; nth: number }>();
	for (const link of findLinks(written)) {
		const text = written.slice(link.start, link.end);
		const nth = seen.get(text) ?? 0;
		seen.set(text, nth + 1);
		bySub.set(link.subStart, { link, text, nth });
	}
	let delta = 0;
	const out = [...edits]
		.sort((a, b) => a.start - b.start)
		.map((e): WrittenEdit => {
			const at = e.start + delta;
			delta += e.to.length - e.from.length;
			const base = { at, from: e.from, to: e.to };
			const hit = bySub.get(at);
			if (!hit || hit.link.subEnd !== at + e.to.length || written.slice(at, hit.link.subEnd) !== e.to) return { ...base, link: '', subAt: 0, nth: 0, of: 0 };
			return { ...base, link: hit.text, subAt: at - hit.link.start, nth: hit.nth, of: seen.get(hit.text) ?? 0 };
		});
	return { stamp: textStamp(written), edits: out };
}

/** The note is the text that was written: each new subpath is at its recorded offset. */
function writtenSpots(text: string, rec: UndoRecord): number[] | null {
	if (textStamp(text) !== rec.stamp) return null;
	return rec.edits.every((e) => text.slice(e.at, e.at + e.to.length) === e.to) ? rec.edits.map((e) => e.at) : null;
}

/**
 * The note changed: finds each written link with the parser of the forward path, so text in code, plain text
 * and other links never match. A link counts only when the note still has as many links with that exact text
 * as it had when it was written. Then the link at the same place among them is the written one.
 */
function linkSpots(text: string, rec: UndoRecord): number[] | null {
	const same = new Map<string, LinkRef[]>();
	for (const link of findLinks(text)) {
		const key = text.slice(link.start, link.end);
		const list = same.get(key);
		if (list) list.push(link);
		else same.set(key, [link]);
	}
	const spots: number[] = [];
	for (const e of rec.edits) {
		const list = e.link ? same.get(e.link) : undefined;
		if (!list || list.length !== e.of) return null;
		const link = list[e.nth];
		if (!link || link.subStart - link.start !== e.subAt || link.subEnd - link.subStart !== e.to.length) return null;
		spots.push(link.subStart);
	}
	return spots;
}

/**
 * Undoes edits that applyEdits made. An unchanged note is restored by offset. A note that changed since is
 * restored only when every written link is found again for certain (see linkSpots). If one link is gone or
 * can be another link, the result is null and the caller leaves the note as it is. No part of a note is restored alone.
 */
export function revertEdits(text: string, rec: UndoRecord): string | null {
	const spots = writtenSpots(text, rec) ?? linkSpots(text, rec);
	if (!spots) return null;
	const order = rec.edits.map((e, i) => ({ e, at: spots[i]! })).sort((x, y) => y.at - x.at);
	let out = text;
	for (const { e, at } of order) out = out.slice(0, at) + e.from + out.slice(at + e.to.length);
	return out;
}

export interface HeadingChange {
	index: number;
	from: string;
	to: string;
}

/**
 * Heading renames between two heading lists of one note. Null when the structure changed (a heading
 * was added, removed or moved to another level): that is not a rename. Changes in case or in
 * characters that links ignore are not renames either, because every link still works.
 */
export function diffHeadings(before: readonly Heading[], after: readonly Heading[]): HeadingChange[] | null {
	if (before.length !== after.length) return null;
	const out: HeadingChange[] = [];
	for (let i = 0; i < before.length; i++) {
		const b = before[i]!;
		const a = after[i]!;
		if (a.level !== b.level) return null;
		if (headingKey(a.text) !== headingKey(b.text)) out.push({ index: i, from: b.text, to: a.text });
	}
	return out;
}

const BLOCK_ID = /^[A-Za-z0-9-]+$/;

/** Block ID renames between two lists of block IDs in document order. Null when IDs were added or removed. */
export function diffBlocks(before: readonly string[], after: readonly string[]): BlockRename[] | null {
	if (before.length !== after.length) return null;
	const out: BlockRename[] = [];
	for (let i = 0; i < before.length; i++) {
		const b = before[i]!;
		const a = after[i]!;
		if (!BLOCK_ID.test(a)) return null;
		if (a.toLowerCase() !== b.toLowerCase()) out.push({ from: b, to: a });
	}
	return out;
}

/** Similarity from 0 to 1 of two strings (1 - edit distance / longer length). */
export function similarity(a: string, b: string): number {
	if (a === b) return 1;
	const n = Math.min(a.length, 200);
	const m = Math.min(b.length, 200);
	if (n === 0 || m === 0) return 0;
	let prev = Array.from({ length: m + 1 }, (_, j) => j);
	for (let i = 1; i <= n; i++) {
		const cur = [i];
		for (let j = 1; j <= m; j++) cur.push(Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)));
		prev = cur;
	}
	return 1 - prev[m]! / Math.max(n, m);
}

/** For a broken heading path: the index of the closest heading by text, or -1 below the threshold. */
export function suggestHeading(parts: readonly string[], headings: readonly Heading[], threshold = 0.5): number {
	const want = headingKey(parts[parts.length - 1] ?? '');
	if (!want) return -1;
	let best = -1;
	let score = -1;
	headings.forEach((h, i) => {
		const s = similarity(want, headingKey(h.text));
		if (s >= threshold && s > score) {
			best = i;
			score = s;
		}
	});
	return best;
}

/** JSON in, JSON out wrapper for the golden vectors: targets lists the link paths that point to the changed note. */
export function rewrite(
	text: string,
	spec: { targets: string[]; before: Heading[]; after: Heading[]; blocks?: BlockRename[]; markdown?: boolean; blockLinks?: boolean },
): { text: string; edits: number; skipped: SkipReason[] } {
	const targets = new Set(spec.targets.map((t) => t.toLowerCase()));
	const plan = planRewrite(text, {
		isTarget: (p) => targets.has(p.toLowerCase()),
		before: spec.before,
		after: spec.after,
		blocks: spec.blocks,
		markdown: spec.markdown ?? true,
		blockLinks: spec.blockLinks ?? true,
	});
	return { text: applyEdits(text, plan.edits), edits: plan.edits.length, skipped: plan.skipped.map((s) => s.reason) };
}
