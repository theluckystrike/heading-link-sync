// Finds heading and block ID edits as you type. A change counts as done after a pause, or when the
// cursor leaves the changed line. Until then the last finished state ("base") stays the reference.
import { MarkdownView, TFile, type App, type CachedMetadata, type Plugin } from 'obsidian';
import { diffBlocks, diffHeadings, type Heading } from './links';

export interface Snapshot {
	headings: Heading[];
	headingLines: number[];
	blocks: string[];
	blockLines: number[];
}

export function snapshotOf(cache: CachedMetadata | null): Snapshot {
	const headings = cache?.headings ?? [];
	const blocks = Object.values(cache?.blocks ?? {}).sort((a, b) => a.position.start.offset - b.position.start.offset);
	return {
		headings: headings.map((h) => ({ text: h.heading, level: h.level })),
		headingLines: headings.map((h) => h.position.start.line),
		blocks: blocks.map((b) => b.id),
		blockLines: blocks.map((b) => b.position.end.line),
	};
}

/** Lines of the headings and blocks that differ between two snapshots, or null when nothing was renamed. */
export function changedLines(before: Snapshot, after: Snapshot): number[] | null {
	const h = diffHeadings(before.headings, after.headings) ?? [];
	const b = diffBlocks(before.blocks, after.blocks) ?? [];
	if (h.length === 0 && b.length === 0) return null;
	const lines = h.map((c) => after.headingLines[c.index]!);
	for (const r of b) {
		const i = after.blocks.indexOf(r.to);
		if (i >= 0) lines.push(after.blockLines[i]!);
	}
	return lines;
}

interface Pending {
	after: Snapshot;
	lines: number[];
	timer: number;
}

/** An edit from the editor counts for this long; a metadata change later than that came from somewhere else. */
const EDIT_WINDOW_MS = 5000;
const CURSOR_TICK_MS = 250;

export class HeadingWatcher {
	private readonly base = new Map<string, Snapshot>();
	private readonly pending = new Map<string, Pending>();
	private readonly lastEdit = new Map<string, number>();

	constructor(
		private readonly app: App,
		private readonly plugin: Plugin,
		private readonly delay: () => number,
		private readonly ignored: (path: string) => boolean,
		private readonly onCommit: (file: TFile, before: Snapshot, after: Snapshot) => Promise<void>,
	) {}

	start(): void {
		const { app, plugin } = this;
		plugin.registerEvent(app.workspace.on('file-open', (file) => file && this.ensureBase(file)));
		plugin.registerEvent(
			app.workspace.on('editor-change', (_editor, info) => {
				if (!info.file) return;
				this.ensureBase(info.file);
				this.lastEdit.set(info.file.path, Date.now());
			}),
		);
		plugin.registerEvent(app.metadataCache.on('changed', (file, _data, cache) => this.onChanged(file, cache)));
		plugin.registerEvent(
			app.vault.on('rename', (file, oldPath) => {
				for (const map of [this.base, this.lastEdit] as Map<string, unknown>[]) {
					const v = map.get(oldPath);
					map.delete(oldPath);
					if (v !== undefined) map.set(file.path, v);
				}
				this.drop(oldPath);
			}),
		);
		plugin.registerEvent(
			app.vault.on('delete', (file) => {
				this.base.delete(file.path);
				this.lastEdit.delete(file.path);
				this.drop(file.path);
			}),
		);
		plugin.registerInterval(window.setInterval(() => this.checkCursor(), CURSOR_TICK_MS));
		app.workspace.onLayoutReady(() => {
			app.workspace.iterateAllLeaves((leaf) => {
				if (leaf.view instanceof MarkdownView && leaf.view.file) this.ensureBase(leaf.view.file);
			});
		});
	}

	/** Stops every timer. Pending edits are dropped, not applied. */
	stop(): void {
		for (const p of this.pending.values()) window.clearTimeout(p.timer);
		this.pending.clear();
	}

	hasPending(): boolean {
		return this.pending.size > 0;
	}

	private ensureBase(file: TFile): void {
		if (file.extension !== 'md' || this.base.has(file.path)) return;
		this.base.set(file.path, snapshotOf(this.app.metadataCache.getFileCache(file)));
	}

	private drop(path: string): void {
		const p = this.pending.get(path);
		if (p) window.clearTimeout(p.timer);
		this.pending.delete(path);
	}

	private onChanged(file: TFile, cache: CachedMetadata): void {
		const base = this.base.get(file.path);
		if (!base) return;
		const now = snapshotOf(cache);
		const edited = Date.now() - (this.lastEdit.get(file.path) ?? 0) < EDIT_WINDOW_MS;
		if (!edited || this.ignored(file.path)) {
			this.drop(file.path);
			this.base.set(file.path, now);
			return;
		}
		const structural = diffHeadings(base.headings, now.headings) === null || diffBlocks(base.blocks, now.blocks) === null;
		const lines = changedLines(base, now);
		const prev = this.pending.get(file.path);
		if (lines === null) {
			// A heading was added or removed while a rename waited: finish the rename first, then take the new state.
			if (prev && structural) void this.commit(file.path).then(() => this.base.set(file.path, now));
			else {
				this.drop(file.path);
				this.base.set(file.path, now);
			}
			return;
		}
		if (prev) window.clearTimeout(prev.timer);
		const timer = window.setTimeout(() => void this.commit(file.path), this.delay());
		this.pending.set(file.path, { after: now, lines, timer });
	}

	private checkCursor(): void {
		if (this.pending.size === 0) return;
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		for (const [path, p] of [...this.pending]) {
			const here = view?.file?.path === path;
			if (here && p.lines.includes(view.editor.getCursor().line)) continue;
			void this.commit(path);
		}
	}

	/** Applies the pending rename of a note now. */
	async commit(path: string): Promise<void> {
		const p = this.pending.get(path);
		if (!p) return;
		window.clearTimeout(p.timer);
		this.pending.delete(path);
		const before = this.base.get(path);
		this.base.set(path, p.after);
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!before || !(file instanceof TFile)) return;
		await this.onCommit(file, before, p.after);
	}

	/** Commits every pending rename (used by tests and before the plugin unloads). */
	async flush(): Promise<void> {
		for (const path of [...this.pending.keys()]) await this.commit(path);
	}
}
