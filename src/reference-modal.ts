import { Modal, type App, type TFile } from 'obsidian';
import { referencesAtLine } from './references';

const DISPLAY_LIMIT = 500;

/** Free, read-only source list for a heading or block count. */
export class ReferenceModal extends Modal {
	constructor(app: App, private readonly target: TFile, private readonly line: number, private readonly excluded: readonly string[]) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText('Links to this heading or block');
		const refs = referencesAtLine(this.app, this.target, this.line, this.excluded);
		this.contentEl.createEl('p', { text: `${refs.length} ${refs.length === 1 ? 'link' : 'links'} in the app index.` });
		const list = this.contentEl.createDiv({ cls: 'hls-list' });
		for (const ref of refs.slice(0, DISPLAY_LIMIT)) {
			const row = list.createDiv({ cls: 'hls-row' });
			const button = row.createEl('button', { text: `${ref.source.path} · ${ref.line < 0 ? 'property' : `line ${ref.line + 1}`}` });
			button.addEventListener('click', () => {
				this.close();
				void this.app.workspace.getLeaf(false).openFile(ref.source, { eState: { line: Math.max(0, ref.line) } });
			});
			row.createSpan({ text: ref.original });
		}
		if (refs.length > DISPLAY_LIMIT) this.contentEl.createEl('p', { cls: 'hls-more', text: `Showing the first ${DISPLAY_LIMIT} links. ${refs.length - DISPLAY_LIMIT} ${refs.length - DISPLAY_LIMIT === 1 ? 'link is' : 'links are'} not shown.` });
		if (refs.length === 0) this.contentEl.createEl('p', { text: 'No indexed links remain at this line.' });
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
