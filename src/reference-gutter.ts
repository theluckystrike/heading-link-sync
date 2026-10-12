import { StateEffect, type Extension } from '@codemirror/state';
import { GutterMarker, ViewPlugin, gutter, type EditorView, type ViewUpdate } from '@codemirror/view';
import { editorInfoField, type App } from 'obsidian';
import { referenceLines } from './references';

const refreshCounts = StateEffect.define<null>();

/** One count beside a heading or block ID. */
export class ReferenceMarker extends GutterMarker {
	elementClass = 'hls-reference-cell';
	constructor(readonly count: number) {
		super();
	}

	eq(other: GutterMarker): boolean {
		return other instanceof ReferenceMarker && other.count === this.count;
	}

	toDOM(): HTMLElement {
		const label = createSpan({ cls: 'hls-reference-count', text: String(this.count) });
		const hint = `${this.count} ${this.count === 1 ? 'link' : 'links'} to this heading or block ID`;
		label.setAttribute('aria-label', hint);
		label.setAttribute('title', hint);
		return label;
	}
}

/** One extension and its live editors. The plugin owns the refresh timer and its cleanup. */
export function referenceGutter(app: App, excluded: () => readonly string[], enabled: () => boolean): { extension: Extension; refresh: () => void; indexed: (path: string, text: string) => void } {
	const live = new Set<EditorView>();
	const indexedText = new Map<string, string>();
	const fileOf = (view: EditorView) => view.state.field(editorInfoField, false)?.file;
	// Drop the indexed text of a note that no editor shows. The note can change on disk while it is closed.
	const forget = (path: string | undefined): void => {
		if (path && ![...live].some((view) => fileOf(view)?.path === path)) indexedText.delete(path);
	};
	class Counts {
		lines = new Map<number, number>();
		constructor(readonly view: EditorView) {
			live.add(view);
			this.read();
		}
		read(): void {
			const file = this.view.state.field(editorInfoField, false)?.file;
			this.lines = enabled() && file && (!indexedText.has(file.path) || indexedText.get(file.path) === this.view.state.doc.toString()) ? referenceLines(app, file, excluded()) : new Map<number, number>();
		}
		update(update: ViewUpdate): void {
			// Clear old line positions while the app indexes an edit.
			const before = update.startState.field(editorInfoField, false)?.file;
			if (before !== fileOf(this.view)) {
				forget(before?.path);
				this.read();
			} else if (update.docChanged) this.lines.clear();
			if (update.transactions.some((t) => t.effects.some((e) => e.is(refreshCounts)))) this.read();
		}
		destroy(): void {
			live.delete(this.view);
			forget(fileOf(this.view)?.path);
		}
	}
	const counts = ViewPlugin.define((view) => new Counts(view));
	return {
		extension: [counts, gutter({
			class: 'hls-reference-gutter',
			lineMarker: (view, block) => {
				const line = view.state.doc.lineAt(block.from).number - 1;
				const count = view.plugin(counts)?.lines.get(line);
				return count ? new ReferenceMarker(count) : null;
			},
			lineMarkerChange: (update) => update.docChanged || update.startState.field(editorInfoField, false)?.file !== update.state.field(editorInfoField, false)?.file || update.transactions.some((t) => t.effects.some((e) => e.is(refreshCounts))),
		})],
		indexed: (path, text) => {
			if ([...live].some((view) => fileOf(view)?.path === path)) indexedText.set(path, text);
		},
		refresh: () => {
			for (const view of live) view.dispatch({ effects: refreshCounts.of(null) });
		},
	};
}
