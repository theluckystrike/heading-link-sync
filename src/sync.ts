// Vault side of the sync: which notes link to the changed note, what to change in each, and how to undo it.
import { MarkdownView, parseLinktext, resolveSubpath, type App, type CachedMetadata, type TFile } from 'obsidian';
import {
	applyEdits,
	findLinks,
	headingKey,
	pathTo,
	planRewrite,
	revertEdits,
	similarity,
	splitSubpath,
	suggestHeading,
	encodePart,
	type BlockRename,
	type Edit,
	type Heading,
	type Range,
	type Skip,
	type UndoRecord,
	undoRecord,
} from './links';
import { isExcluded } from './settings';

export interface FilePlan {
	file: TFile;
	before: string;
	edits: Edit[];
	skipped: Skip[];
	/** True when the user picked only some edits: a file that changed since planning is then left alone. */
	partial?: boolean;
}

export interface SyncRequest {
	target: TFile;
	before: Heading[];
	after: Heading[];
	blocks: BlockRename[];
	markdown: boolean;
	blockLinks: boolean;
	excluded: string[];
}

export interface AppliedFile {
	path: string;
	edits: Edit[];
	/** The note as it was written, so that undo finds the same links again. */
	undo: UndoRecord;
}

const MAX_FILES = 5000;

/** Code and math sections that the app found, as offsets. Only valid while the text matches the cache. */
function cacheExclusions(cache: CachedMetadata | null): Range[] {
	return (cache?.sections ?? []).filter((s) => s.type === 'code' || s.type === 'math').map((s) => ({ start: s.position.start.offset, end: s.position.end.offset }));
}

/** The open editor of a file, if any. */
export function editorFor(app: App, file: TFile): MarkdownView | null {
	let found: MarkdownView | null = null;
	app.workspace.iterateAllLeaves((leaf) => {
		if (!found && leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path && leaf.view.getMode() === 'source') found = leaf.view;
	});
	return found;
}

/** Notes that link to the target, plus the target itself (for links inside the same note). */
export function linkingNotes(app: App, target: TFile, excluded: readonly string[]): TFile[] {
	const out: TFile[] = [];
	const resolved = app.metadataCache.resolvedLinks;
	for (const src of Object.keys(resolved)) {
		if (out.length >= MAX_FILES) break;
		if (src === target.path || !resolved[src]?.[target.path] || isExcluded(src, excluded)) continue;
		const f = app.vault.getFileByPath(src);
		if (f && f.extension === 'md') out.push(f);
	}
	if (!isExcluded(target.path, excluded)) out.unshift(target);
	return out;
}

function planOne(app: App, req: SyncRequest, file: TFile, text: string, exclude: Range[]): { edits: Edit[]; skipped: Skip[] } {
	return planRewrite(text, {
		isTarget: (p) => (p === '' ? file.path === req.target.path : app.metadataCache.getFirstLinkpathDest(p, file.path)?.path === req.target.path),
		before: req.before,
		after: req.after,
		blocks: req.blocks,
		markdown: req.markdown,
		blockLinks: req.blockLinks,
		exclude,
	});
}

/** Works out every change in the vault. Reads files, writes nothing. */
export async function planVault(app: App, req: SyncRequest): Promise<FilePlan[]> {
	const plans: FilePlan[] = [];
	for (const file of linkingNotes(app, req.target, req.excluded)) {
		const view = file.path === req.target.path ? editorFor(app, file) : null;
		const text = view ? view.editor.getValue() : await app.vault.cachedRead(file);
		const exclude = view ? [] : cacheExclusions(app.metadataCache.getFileCache(file));
		const { edits, skipped } = planOne(app, req, file, text, exclude);
		if (edits.length || skipped.length) plans.push({ file, before: text, edits, skipped });
	}
	return plans;
}

/** Writes the planned edits. Re-plans a file that changed after planning. Returns what was really written. */
export async function applyPlans(app: App, req: SyncRequest, plans: readonly FilePlan[]): Promise<AppliedFile[]> {
	const done: AppliedFile[] = [];
	for (const plan of plans) {
		if (plan.edits.length === 0) continue;
		const view = plan.file.path === req.target.path ? editorFor(app, plan.file) : null;
		if (view) {
			const editor = view.editor;
			const text = editor.getValue();
			if (text !== plan.before && plan.partial) continue;
			const edits = text === plan.before ? plan.edits : planOne(app, req, plan.file, text, []).edits;
			if (edits.length === 0) continue;
			editor.transaction({ changes: edits.map((e) => ({ from: editor.offsetToPos(e.start), to: editor.offsetToPos(e.end), text: e.to })) });
			done.push({ path: plan.file.path, edits, undo: undoRecord(editor.getValue(), edits) });
			continue;
		}
		let used: Edit[] = [];
		let undo = undoRecord('', []);
		await app.vault.process(plan.file, (data) => {
			if (data !== plan.before && plan.partial) return data;
			used = data === plan.before ? plan.edits : planOne(app, req, plan.file, data, []).edits;
			const written = applyEdits(data, used);
			undo = undoRecord(written, used);
			return written;
		});
		if (used.length) done.push({ path: plan.file.path, edits: used, undo });
	}
	return done;
}

/**
 * Undoes an earlier apply. Returns how many notes were restored, and the paths of the notes that were left
 * as they are because a written link was not found again for certain.
 */
export async function undoApplied(app: App, files: readonly AppliedFile[]): Promise<{ restored: number; failed: string[] }> {
	let restored = 0;
	const failed: string[] = [];
	for (const f of files) {
		const file = app.vault.getFileByPath(f.path);
		if (!file) {
			failed.push(f.path);
			continue;
		}
		let ok = false;
		const view = editorFor(app, file);
		if (view) {
			// The open note: change the editor, so unsaved typing is kept and the cursor stays.
			const editor = view.editor;
			const text = editor.getValue();
			const back = revertEdits(text, f.undo);
			ok = back !== null;
			if (back !== null) {
				const d = diffSpan(text, back);
				editor.replaceRange(back.slice(d.start, d.endB), editor.offsetToPos(d.start), editor.offsetToPos(d.endA));
			}
		} else {
			await app.vault.process(file, (data) => {
				const back = revertEdits(data, f.undo);
				ok = back !== null;
				return back ?? data;
			});
		}
		if (ok) restored++;
		else failed.push(f.path);
	}
	return { restored, failed };
}

/** The changed middle of two texts: a[start, endA) became b[start, endB). */
export function diffSpan(a: string, b: string): { start: number; endA: number; endB: number } {
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) start++;
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA--;
		endB--;
	}
	return { start, endA, endB };
}

export interface BrokenLink {
	source: TFile;
	target: TFile;
	/** 0-based line, or -1 for a link in properties. */
	line: number;
	frontmatter: boolean;
	original: string;
	path: string;
	subpath: string;
	/** The new subpath parts, or null when no close heading or block ID exists. */
	fix: string[] | null;
	fixLabel: string;
}

const MAX_BROKEN = 2000;

function suggestionFor(cache: CachedMetadata, parts: string[]): { fix: string[] | null; label: string } {
	if (parts[0]?.startsWith('^')) {
		const want = parts[0].slice(1).toLowerCase();
		let best: string | null = null;
		let score = 0.5;
		for (const b of Object.values(cache.blocks ?? {})) {
			const s = similarity(want, b.id.toLowerCase());
			if (s >= score) {
				best = b.id;
				score = s;
			}
		}
		return best ? { fix: [`^${best}`], label: `^${best}` } : { fix: null, label: '' };
	}
	const headings: Heading[] = (cache.headings ?? []).map((h) => ({ text: h.heading, level: h.level }));
	const i = suggestHeading(parts, headings);
	const path = i < 0 ? null : pathTo(headings, i);
	return path ? { fix: path, label: headings[i]!.text } : { fix: null, label: '' };
}

/** Every heading or block link in the vault whose note exists but whose heading or block does not. */
export function findBroken(app: App, excluded: readonly string[]): BrokenLink[] {
	const out: BrokenLink[] = [];
	for (const source of app.vault.getMarkdownFiles()) {
		if (out.length >= MAX_BROKEN) break;
		if (isExcluded(source.path, excluded)) continue;
		const cache = app.metadataCache.getFileCache(source);
		if (!cache) continue;
		const refs = [
			...(cache.links ?? []).map((l) => ({ link: l.link, original: l.original, line: l.position.start.line, fm: false })),
			...(cache.embeds ?? []).map((l) => ({ link: l.link, original: l.original, line: l.position.start.line, fm: false })),
			...(cache.frontmatterLinks ?? []).map((l) => ({ link: l.link, original: l.original, line: -1, fm: true })),
		];
		for (const ref of refs) {
			const { path, subpath } = parseLinktext(ref.link);
			if (!subpath) continue;
			const target = path === '' ? source : app.metadataCache.getFirstLinkpathDest(path, source.path);
			if (!target || target.extension !== 'md') continue;
			const tcache = app.metadataCache.getFileCache(target);
			if (!tcache || resolveSubpath(tcache, subpath)) continue;
			const parts = splitSubpath(subpath);
			if (parts.length === 0 || parts.every((p) => headingKey(p) === '' && !p.startsWith('^'))) continue;
			const s = suggestionFor(tcache, parts);
			out.push({ source, target, line: ref.line, frontmatter: ref.fm, original: ref.original, path, subpath, fix: s.fix, fixLabel: s.label });
		}
	}
	return out;
}

/** Rewrites one broken link to its suggested subpath. Returns false when the link is no longer in the note. */
export async function fixBroken(app: App, b: BrokenLink): Promise<boolean> {
	if (!b.fix) return false;
	const fix = b.fix;
	let ok = false;
	await app.vault.process(b.source, (data) => {
		const hit = findLinks(data).find((l) => (b.frontmatter ? l.frontmatter : l.line === b.line) && l.subpath === b.subpath && l.path === b.path);
		if (!hit) return data;
		ok = true;
		const to = `#${fix.map((p) => encodePart(p, hit.style)).join('#')}`;
		return data.slice(0, hit.subStart) + to + data.slice(hit.subEnd);
	});
	return ok;
}
