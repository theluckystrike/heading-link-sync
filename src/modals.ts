import { Modal, Setting, type App } from 'obsidian';
import { findLinks, type Edit } from './links';
import type { BrokenLink, FilePlan } from './sync';

const MAX_ROWS = 500;

function plural(n: number, one: string, many: string): string {
	return `${n} ${n === 1 ? one : many}`;
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

/** Pro confirm: every change with a check box. */
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
		this.contentEl.createEl('p', { text: `${this.title} This changes ${countText(this.plans)}.` });
		const list = this.contentEl.createDiv({ cls: 'hls-list' });
		let rows = 0;
		this.plans.forEach((plan, i) => {
			if (plan.edits.length === 0) return;
			list.createDiv({ cls: 'hls-file', text: plan.file.path });
			for (const e of plan.edits) {
				if (rows++ >= MAX_ROWS) return;
				const p = editPreview(plan.before, e);
				const row = list.createEl('label', { cls: 'hls-row' });
				const box = row.createEl('input', { type: 'checkbox' });
				box.checked = true;
				box.addEventListener('change', () => {
					if (box.checked) this.chosen[i]!.add(e);
					else this.chosen[i]!.delete(e);
				});
				row.createSpan({ cls: 'hls-line', text: `${e.line + 1}` });
				row.createEl('code', { cls: 'hls-from', text: p.from });
				row.createSpan({ text: '→' });
				row.createEl('code', { cls: 'hls-to', text: p.to });
			}
		});
		new Setting(this.contentEl)
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
