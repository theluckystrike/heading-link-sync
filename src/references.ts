// Reference counts use the app index. No note reads and no network requests.
import { parseLinktext, type App, type TFile } from 'obsidian';
import { referenceCounts } from './links';
import { isExcluded } from './settings';
import { snapshotOf } from './watch';

/** Counts on 0-based lines of one note. A heading and a block ID on the same line share one count. */
export function referenceLines(app: App, target: TFile, excluded: readonly string[]): Map<number, number> {
	const lines = new Map<number, number>();
	if (isExcluded(target.path, excluded)) return lines;
	const snapshot = snapshotOf(app.metadataCache.getFileCache(target));
	const subpaths: string[] = [];
	// Include the same note. Other notes must have a resolved link to the target.
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
			if (dest?.path === target.path) subpaths.push(link.subpath);
		}
	}
	const counts = referenceCounts(snapshot.headings, snapshot.blocks, subpaths);
	const add = (line: number, count: number): void => {
		if (count > 0) lines.set(line, (lines.get(line) ?? 0) + count);
	};
	counts.headings.forEach((count, i) => add(snapshot.headingLines[i]!, count));
	counts.blocks.forEach((count, i) => add(snapshot.blockLines[i]!, count));
	return lines;
}
