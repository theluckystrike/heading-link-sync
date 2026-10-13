import { Notice, Plugin, type TFile } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors, guardSponsorsPro } from './license/github-obsidian';
import { diffBlocks, diffHeadings, headingKey, type Skip } from './links';
import { AskModal, BrokenModal, countText, PreviewModal } from './modals';
import { bindPro, isPro, onProChange, SPONSORS } from './pro';
import { DEFAULT_SETTINGS, excludedList, HeadingLinkSyncSettingTab, isExcluded, normalizeSettings, type HeadingLinkSyncSettings } from './settings';
import { applyPlans, findBroken, fixBroken, planVault, undoApplied, type AppliedFile, type FilePlan, type SyncRequest } from './sync';
import { HeadingWatcher, type Snapshot } from './watch';
import { referenceGutter } from './reference-gutter';

const NOTICE_MS = 10_000;
/** How many note names the undo notice lists. */
const MAX_NAMES = 5;
/** How often a signed-in user's sponsorship is checked again (the manager decides if a request is due). */
const PRO_TICK_MS = 60 * 60 * 1000;

export interface SyncResult {
	links: number;
	notes: number;
	skipped: Skip[];
}

export default class HeadingLinkSyncPlugin extends Plugin {
	settings: HeadingLinkSyncSettings = { ...DEFAULT_SETTINGS };
	watcher: HeadingWatcher | null = null;
	/** The last applied update, for the undo command. */
	lastApplied: AppliedFile[] = [];
	/** Result of the last sync, for tests and the notice. */
	lastResult: SyncResult | null = null;
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	private settingTab: HeadingLinkSyncSettingTab | null = null;
	private refreshReferences: (() => void) | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		// No request here: a request needs a GitHub sign in first (Settings, Pro, Sign in with GitHub).
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		// Redraw the settings only while they are on screen: update() on a closed tab draws it into the page.
		this.register(onProChange(() => (this.settingTab?.containerEl.isConnected ? this.settingTab.update() : undefined)));
		this.settingTab = new HeadingLinkSyncSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
		});

		const watcher = new HeadingWatcher(
			this.app,
			this,
			() => this.settings.delayMs,
			(path) => isExcluded(path, excludedList(this.settings)),
			(file, before, after) => this.sync(file, before, after),
		);
		const references = referenceGutter(this.app, () => excludedList(this.settings), () => this.settings.referenceCounts);
		this.registerEditorExtension(references.extension);
		this.refreshReferences = references.refresh;
		let referenceTimer: number | null = null;
		const refresh = (): void => {
			if (referenceTimer !== null) window.clearTimeout(referenceTimer);
			referenceTimer = window.setTimeout(() => { referenceTimer = null; references.refresh(); }, 250);
		};
		this.register(() => { if (referenceTimer !== null) window.clearTimeout(referenceTimer); this.refreshReferences = null; });
		this.registerEvent(this.app.metadataCache.on('changed', (file, data) => { references.indexed(file.path, data); refresh(); }));
		this.registerEvent(this.app.metadataCache.on('resolved', refresh));
		this.registerEvent(this.app.metadataCache.on('deleted', refresh));
		this.registerEvent(this.app.vault.on('rename', refresh));
		this.app.workspace.onLayoutReady(refresh);
		watcher.start();
		this.watcher = watcher;

		this.addCommand({
			id: 'undo-last-update',
			name: 'Undo the last link update',
			checkCallback: (checking) => {
				if (this.lastApplied.length === 0) return false;
				if (!checking) void this.undo();
				return true;
			},
		});
		this.addCommand({
			id: 'find-broken-links',
			name: 'Find broken heading and block links',
			callback: guardSponsorsPro(pro, () => this.openBrokenReport()),
		});
	}

	onunload(): void {
		this.watcher?.stop();
		bindPro(null);
	}

	/** Pro from the cached GitHub Sponsors answer. Never sends a request. */
	isPro(): boolean {
		return isPro();
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<HeadingLinkSyncSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.refreshReferences?.();
	}

	/** Builds the request for one finished heading or block ID edit, or null when there is nothing to do. */
	private request(file: TFile, before: Snapshot, after: Snapshot): SyncRequest | null {
		const headings = diffHeadings(before.headings, after.headings) ?? [];
		const blocks = diffBlocks(before.blocks, after.blocks) ?? [];
		if (headings.length === 0 && blocks.length === 0) return null;
		if (headings.some((c) => headingKey(c.to) === '')) return null;
		return {
			target: file,
			before: headings.length ? before.headings : after.headings,
			after: after.headings,
			blocks,
			markdown: isPro() && this.settings.markdownLinks,
			blockLinks: isPro() && this.settings.blockLinks,
			excluded: excludedList(this.settings),
		};
	}

	private describe(req: SyncRequest): string {
		const changes = diffHeadings(req.before, req.after) ?? [];
		const one = changes.length === 1 && req.blocks.length === 0 ? changes[0] : null;
		if (one) return `Heading "${one.from}" is now "${one.to}" in ${req.target.basename}.`;
		const block = changes.length === 0 && req.blocks.length === 1 ? req.blocks[0] : null;
		if (block) return `Block ID ^${block.from} is now ^${block.to} in ${req.target.basename}.`;
		return `${changes.length + req.blocks.length} headings or block IDs changed in ${req.target.basename}.`;
	}

	/** Called by the watcher when a heading or block ID edit is done. */
	async sync(file: TFile, before: Snapshot, after: Snapshot): Promise<void> {
		const req = this.request(file, before, after);
		if (!req) return;
		const plans = await planVault(this.app, req);
		const skipped = plans.flatMap((p) => p.skipped);
		const count = plans.reduce((n, p) => n + p.edits.length, 0);
		if (count === 0) {
			this.lastResult = { links: 0, notes: 0, skipped };
			if (skipped.length) new Notice(skipText(skipped), NOTICE_MS);
			return;
		}
		if (this.settings.mode === 'ask') {
			const chosen = await this.ask(req, plans);
			if (!chosen) return;
			await this.apply(req, chosen, skipped);
			return;
		}
		await this.apply(req, plans, skipped);
	}

	private ask(req: SyncRequest, plans: FilePlan[]): Promise<FilePlan[] | null> {
		return new Promise((resolve) => {
			if (isPro()) new PreviewModal(this.app, this.describe(req), plans, resolve).open();
			else new AskModal(this.app, this.describe(req), plans, (yes) => resolve(yes ? plans : null)).open();
		});
	}

	private async apply(req: SyncRequest, plans: FilePlan[], skipped: Skip[]): Promise<void> {
		const done = await applyPlans(this.app, req, plans);
		const links = done.reduce((n, f) => n + f.edits.length, 0);
		this.lastApplied = done;
		this.lastResult = { links, notes: done.length, skipped };
		if (links === 0) return;
		const text = `Updated ${countText(done)}.${skipped.length ? ` ${skipText(skipped)}` : ''}`;
		const frag = createFragment((f) => {
			f.createSpan({ text });
			const btn = f.createEl('button', { text: 'Undo', cls: 'hls-undo' });
			btn.addEventListener('click', () => void this.undo());
		});
		new Notice(frag, NOTICE_MS);
	}

	/** Restores every link that the last update changed. */
	async undo(): Promise<void> {
		const files = this.lastApplied;
		this.lastApplied = [];
		if (files.length === 0) return;
		const { restored, failed } = await undoApplied(this.app, files);
		new Notice(undoText(restored, failed), failed.length ? NOTICE_MS : undefined);
	}

	/** Pro: the broken link report. The command guards it with guardSponsorsPro. */
	openBrokenReport(): void {
		const items = findBroken(this.app, excludedList(this.settings));
		new BrokenModal(
			this.app,
			items,
			(b) => fixBroken(this.app, b),
			(b) => void this.app.workspace.getLeaf(false).openFile(b.source, { eState: { line: Math.max(0, b.line) } }),
		).open();
	}
}

/** What the undo did, with the names of the notes that it left as they are. */
export function undoText(restored: number, failed: readonly string[]): string {
	const done = `Restored links in ${restored} notes.`;
	if (failed.length === 0) return done;
	const one = failed.length === 1;
	const more = failed.length > MAX_NAMES ? ` and ${failed.length - MAX_NAMES} more` : '';
	return `${done} ${failed.length} ${one ? 'note' : 'notes'} changed too much to restore and ${one ? 'was left as it is' : 'were left as they are'}: ${failed.slice(0, MAX_NAMES).join(', ')}${more}.`;
}

/** One sentence about links that were left alone. */
export function skipText(skipped: readonly Skip[]): string {
	const n = (r: Skip['reason']) => skipped.filter((s) => s.reason === r).length;
	const parts: string[] = [];
	const md = n('pro-markdown');
	const block = n('pro-block');
	if (md) parts.push(`${md} Markdown ${md === 1 ? 'link' : 'links'}`);
	if (block) parts.push(`${block} block ID ${block === 1 ? 'link' : 'links'}`);
	const out: string[] = [];
	if (parts.length) out.push(`Not updated: ${parts.join(' and ')} (Pro).`);
	const other = n('ambiguous') + n('empty') + n('frontmatter-quote');
	if (other) out.push(`${other} ${other === 1 ? 'link was' : 'links were'} left alone because the new text is not safe to link to.`);
	return out.join(' ');
}
