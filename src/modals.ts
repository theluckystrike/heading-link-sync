import { Modal, Setting, type App } from 'obsidian';
import { findLinks, type Edit } from './links';
import type { BrokenLink, FilePlan } from './sync';

/** The most rows that a list shows. */
export const MAX_ROWS = 500;

function num(n: number): string {
	return n.toLocaleString('en-US');
}

function plural(n: number, one: string, many: string): string {
	return `${num(n)} ${n === 1 ? one : many}`;
}

/** Counts in words: "12 links in 5 notes". */
export function countPhrase(links: number, notes: number): string {
	return `${plural(links, 'link', 'links')} in ${plural(notes, 'note', 'notes')}`;
}

export function countText(plans: readonly { edits: readonly unknown[] }[]): string {
	return countPhrase(
		plans.reduce((n, p) => n + p.edits.length, 0),
		plans.filter((p) => p.edits.length > 0).length,
	);
}

/** Free confirm: one question with the counts. */
export class AskModal extends Modal {
	private decided = false;

	constructor(
		app: App,
		private readonly title: string,
		private readonly plans: readonly FilePlan[],
		private readonly onDecide: (apply: boolean) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Update links?');
		this.contentEl.createEl('p', { text: this.title });
		this.contentEl.createEl('p', { text: `This changes ${countText(this.plans)}.` });
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText('Skip').onClick(() => this.decide(false)))
			.addButton((b) =>
				b
					.setButtonText('Update links')
					.setCta()
					.onClick(() => this.decide(true)),
			);
	}

	private decide(apply: boolean): void {
		this.decided = true;
		this.close();
		this.onDecide(apply);
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.decided) this.onDecide(false);
	}
}

/** The link before and after one edit, for display. */
export function editPreview(before: string, e: Edit): { from: string; to: string } {
	const link = findLinks(before).find((l) => l.subStart === e.start);
	if (!link) return { from: e.from, to: e.to };
	const original = before.slice(link.start, link.end);
	return { from: original, to: original.slice(0, e.start - link.start) + e.to + original.slice(e.end - link.start) };
}

export interface PreviewModel {
	/** The rows on screen: the index of each plan that has rows, and its edits that fit below the row limit. */
	shown: { plan: number; edits: Edit[] }[];
	/** Every planned change, shown or not. */
	links: number;
	notes: number;
	shownLinks: number;
	/** Changes with no row, and the notes that have one or more of them. */
	hiddenLinks: number;
	hiddenNotes: number;
}

/** What the preview shows and what it cannot show, so that the dialog says both before the user applies. */
export function previewModel(plans: readonly { edits: readonly Edit[] }[], cap = MAX_ROWS): PreviewModel {
	const shown: PreviewModel['shown'] = [];
	let links = 0;
	let notes = 0;
	let hiddenNotes = 0;
	let room = Math.max(0, cap);
	plans.forEach((p, plan) => {
		if (p.edits.length === 0) return;
		links += p.edits.length;
		notes++;
		const edits = p.edits.slice(0, room);
		room -= edits.length;
		if (edits.length > 0) shown.push({ plan, edits });
		if (edits.length < p.edits.length) hiddenNotes++;
	});
	const shownLinks = Math.max(0, cap) - room;
	return { shown, links, notes, shownLinks, hiddenLinks: links - shownLinks, hiddenNotes };
}

/** The line above the buttons when the list is not complete, or '' when every change has a row. */
export function hiddenText(m: PreviewModel): string {
	if (m.hiddenLinks === 0) return '';
	return `The list shows the first ${plural(m.shownLinks, 'link', 'links')}. Not shown: ${countPhrase(m.hiddenLinks, m.hiddenNotes)}. "Apply selected" also changes the links that are not shown.`;
}

/** The text beside the buttons: what "Apply selected" changes now. Links with no row are always selected. */
export function selectedText(m: PreviewModel, links: number, notes: number): string {
	return `Selected: ${countPhrase(links, notes)}${m.hiddenLinks ? `, ${num(m.hiddenLinks)} of them not shown` : ''}.`;
}

/** Pro confirm: a check box for each change up to the row limit, and the count of the changes with no row. */
export class PreviewModal extends Modal {
	private decided = false;
	private readonly chosen: Set<Edit>[];

	constructor(
		app: App,
		private readonly title: string,
		private readonly plans: readonly FilePlan[],
		private readonly onDecide: (plans: FilePlan[] | null) => void,
	) {
		super(app);
		this.chosen = plans.map((p) => new Set(p.edits));
	}

	onOpen(): void {
		this.setTitle('Review link updates');
		this.modalEl.addClass('hls-preview');
		const model = previewModel(this.plans);
		this.contentEl.createEl('p', { text: `${this.title} This changes ${countPhrase(model.links, model.notes)}.` });
		const list = this.contentEl.createDiv({ cls: 'hls-list' });
		if (model.hiddenLinks > 0) this.contentEl.createEl('p', { cls: 'hls-more', text: hiddenText(model) });
		const footer = new Setting(this.contentEl);
		// With a complete list the rows say it all. With hidden changes, the text beside the buttons gives the totals.
		const showSelected = (): void => {
			if (model.hiddenLinks === 0) return;
			const sizes = this.chosen.map((c) => c.size);
			footer.setDesc(
				selectedText(
					model,
					sizes.reduce((n, s) => n + s, 0),
					sizes.filter((s) => s > 0).length,
				),
			);
		};
		for (const group of model.shown) {
			const plan = this.plans[group.plan]!;
			const chosen = this.chosen[group.plan]!;
			list.createDiv({ cls: 'hls-file', text: plan.file.path });
			for (const e of group.edits) {
				const p = editPreview(plan.before, e);
				const row = list.createEl('label', { cls: 'hls-row' });
				const box = row.createEl('input', { type: 'checkbox' });
				box.checked = true;
				box.addEventListener('change', () => {
					if (box.checked) chosen.add(e);
					else chosen.delete(e);
					showSelected();
				});
				row.createSpan({ cls: 'hls-line', text: `${e.line + 1}` });
				row.createEl('code', { cls: 'hls-from', text: p.from });
				row.createSpan({ text: '→' });
				row.createEl('code', { cls: 'hls-to', text: p.to });
			}
		}
		showSelected();
		footer
			.addButton((b) => b.setButtonText('Skip').onClick(() => this.decide(null)))
			.addButton((b) =>
				b
					.setButtonText('Apply selected')
					.setCta()
					.onClick(() => this.decide(this.plans.map((p, i) => ({ ...p, edits: p.edits.filter((e) => this.chosen[i]!.has(e)), partial: this.chosen[i]!.size !== p.edits.length })))),
			);
	}

	private decide(plans: FilePlan[] | null): void {
		this.decided = true;
		this.close();
		this.onDecide(plans);
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.decided) this.onDecide(null);
	}
}

/** Pro report: broken heading and block links with a fix button for each. */
export class BrokenModal extends Modal {
	constructor(
		app: App,
		private readonly items: BrokenLink[],
		private readonly fix: (b: BrokenLink) => Promise<boolean>,
		private readonly reveal: (b: BrokenLink) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Broken heading and block links');
		this.modalEl.addClass('hls-preview');
		const fixable = this.items.filter((b) => b.fix);
		if (this.items.length === 0) {
			this.contentEl.createEl('p', { text: 'No broken heading or block links found.' });
			return;
		}
		this.contentEl.createEl('p', { text: `${plural(this.items.length, 'broken link', 'broken links')}, ${fixable.length} with a suggested fix.` });
		const buttons: { b: BrokenLink; set: () => void }[] = [];
		new Setting(this.contentEl).addButton((btn) =>
			btn
				.setButtonText('Fix all with a suggestion')
				.setCta()
				.setDisabled(fixable.length === 0)
				.onClick(async () => {
					btn.setDisabled(true);
					for (const x of buttons) if (await this.fix(x.b)) x.set();
				}),
		);
		const list = this.contentEl.createDiv({ cls: 'hls-list' });
		for (const b of this.items.slice(0, MAX_ROWS)) {
			const row = list.createDiv({ cls: 'hls-row' });
			const where = row.createEl('a', { cls: 'hls-file', text: b.frontmatter ? `${b.source.path} (properties)` : `${b.source.path}:${b.line + 1}` });
			where.addEventListener('click', () => this.reveal(b));
			row.createEl('code', { cls: 'hls-broken', text: b.original });
			if (!b.fix) {
				row.createSpan({ cls: 'hls-none', text: 'No close heading or block ID' });
				continue;
			}
			row.createSpan({ text: '→' });
			row.createEl('code', { cls: 'hls-to', text: b.fixLabel });
			const btn = row.createEl('button', { text: 'Fix' });
			const set = () => {
				btn.disabled = true;
				btn.setText('Fixed');
			};
			buttons.push({ b, set });
			btn.addEventListener('click', () => {
				void this.fix(b).then((ok) => (ok ? set() : btn.setText('Not found')));
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
