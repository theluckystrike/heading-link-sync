// Reference counts use the app index. No note reads and no network requests.
import { parseLinktext, type App, type TFile } from 'obsidian';
import { referenceCounts } from './links';
import { isExcluded } from './settings';
import { snapshotOf } from './watch';

export interface HeadingReference {
	source: TFile;
	/** Zero-based source line, or -1 for a property. */
	line: number;
	original: string;
	subpath: string;
}

/** Indexed references to this note, including its own links. */
function* linkedReferences(app: App, target: TFile, excluded: readonly string[]): Generator<HeadingReference> {
	if (isExcluded(target.path, excluded)) return;
	const sources = new Set([target.path, ...Object.keys(app.metadataCache.resolvedLinks).filter((p) => !!app.metadataCache.resolvedLinks[p]?.[target.path])]);
	for (const path of sources) {
		if (isExcluded(path, excluded)) continue;
		const source = app.vault.getFileByPath(path);
		if (!source || source.extension !== 'md') continue;
		const cache = app.metadataCache.getFileCache(source);
		for (const ref of [...(cache?.links ?? []), ...(cache?.embeds ?? []), ...(cache?.frontmatterLinks ?? [])]) {
			const link = parseLinktext(ref.link);
			if (!link.subpath) continue;
			const dest = link.path === '' ? source : app.metadataCache.getFirstLinkpathDest(link.path, path);
			if (dest?.path === target.path) yield { source, subpath: link.subpath, original: ref.original, line: 'position' in ref ? ref.position.start.line : -1 };
		}
	}
}

/** Counts on 0-based lines of one note. A heading and a block ID on the same line share one count. */
export function referenceLines(app: App, target: TFile, excluded: readonly string[]): Map<number, number> {
	const lines = new Map<number, number>();
	const snapshot = snapshotOf(app.metadataCache.getFileCache(target));
	const counts = referenceCounts(snapshot.headings, snapshot.blocks, [...linkedReferences(app, target, excluded)].map((r) => r.subpath));
	const add = (line: number, count: number): void => {
		if (count > 0) lines.set(line, (lines.get(line) ?? 0) + count);
	};
	counts.headings.forEach((count, i) => add(snapshot.headingLines[i]!, count));
	counts.blocks.forEach((count, i) => add(snapshot.blockLines[i]!, count));
	return lines;
}

/** Source links for the count on one target line. Uses the same resolution rules as the count. */
export function referencesAtLine(app: App, target: TFile, line: number, excluded: readonly string[]): HeadingReference[] {
	const snapshot = snapshotOf(app.metadataCache.getFileCache(target));
	return [...linkedReferences(app, target, excluded)].filter((ref) => {
		const counts = referenceCounts(snapshot.headings, snapshot.blocks, [ref.subpath]);
		return counts.headings.some((n, i) => n > 0 && snapshot.headingLines[i] === line) || counts.blocks.some((n, i) => n > 0 && snapshot.blockLines[i] === line);
	});
}
