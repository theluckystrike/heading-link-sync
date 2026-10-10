// Real-app proof: type a new heading in Project Plan.md and check the text of every linking note.
import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { lastNotice } from './load';

const PLAN = 'Project Plan.md';

interface Result {
	links: number;
	notes: number;
	skipped: { reason: string }[];
}

const TOKEN_ID = 'heading-link-sync-github-token';
const FAKE_TOKEN = `gho_${'0'.repeat(36)}`;
const SPONSOR_5 = {
	status: 200,
	json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: 'tier', monthlyPriceInCents: 500, isOneTime: false } } } } },
};

/** Pro on through a stubbed GitHub Sponsors answer (no request reaches github.com), or signed out. */
async function setPro(on: boolean): Promise<boolean> {
	return browser.executeObsidian(
		async ({ app }, tokenId, token, reply, want) => {
			interface Pro {
				opts: { http: unknown };
				refreshNow(): Promise<void>;
				signOut(): void;
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, { pro: Pro; isPro(): boolean }> } }).plugins.plugins['heading-link-sync']!;
			if (!want) {
				p.pro.signOut();
				return p.isPro();
			}
			p.pro.opts.http = () => Promise.resolve(reply);
			app.secretStorage.setSecret(tokenId, token);
			await p.pro.refreshNow();
			return p.isPro();
		},
		TOKEN_ID,
		FAKE_TOKEN,
		SPONSOR_5,
		on,
	);
}

/** Puts the vault and the settings back, and clears the last result and notices. */
async function fresh(settings: Record<string, unknown>, pro = false): Promise<void> {
	const apply = () =>
		browser.executeObsidian(async ({ app }, s) => {
			const w = window as unknown as { __hlsErr?: string[] };
			if (!w.__hlsErr) {
				w.__hlsErr = [];
				window.addEventListener('error', (e) => w.__hlsErr!.push(String(e.message)));
				window.addEventListener('unhandledrejection', (e) => w.__hlsErr!.push(String((e.reason as Error)?.stack ?? e.reason)));
			}
			document.querySelectorAll('.modal-close-button, .modal-container .modal-header-button').forEach((b) => (b as HTMLElement).click());
			const p = (app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins.plugins['heading-link-sync'] as { settings: Record<string, unknown>; lastResult: unknown; lastApplied: unknown[]; saveSettings(): Promise<void> };
			Object.assign(p.settings, { mode: 'auto', delayMs: 1500, excludedFolders: 'Templates', markdownLinks: true, blockLinks: true }, s);
			await p.saveSettings();
			p.lastResult = null;
			p.lastApplied = [];
			document.querySelectorAll('.notice').forEach((n) => n.remove());
		}, settings);
	// Auto mode while the vault resets: a reset inside the edit window looks like a rename back and must not open a dialog.
	await apply();
	await obsidianPage.resetVault();
	await browser.pause(2500);
	await apply();
	expect(await setPro(pro)).toBe(pro);
}

/** All note texts in the vault. */
async function vaultText(): Promise<Record<string, string>> {
	return browser.executeObsidian(async ({ app, obsidian }) => {
		// Save open editors first: the plugin edits the open note in the editor, which saves a moment later.
		for (const leaf of app.workspace.getLeavesOfType('markdown')) if (leaf.view instanceof obsidian.MarkdownView) await leaf.view.save();
		const out: Record<string, string> = {};
		for (const f of app.vault.getMarkdownFiles()) out[f.path] = await app.vault.read(f);
		return out;
	});
}

/** Opens the plan, selects the text of one line and types new text over it with the keyboard, then leaves the line. */
async function typeOver(path: string, lineText: string, from: number, typed: string): Promise<void> {
	await obsidianPage.openFile(path);
	// Focus the editor with a real click: a notice or a settings refresh can hold the focus.
	await browser.$('.workspace-leaf.mod-active .cm-content').click();
	await browser.executeObsidian(({ app, obsidian }, args) => {
		((app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins.plugins['heading-link-sync'] as { lastResult: unknown }).lastResult = null;
		const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;
		const ed = view.editor;
		const line = ed.getValue().split('\n').indexOf(args.lineText);
		if (line < 0) throw new Error(`line not found: ${args.lineText}`);
		ed.focus();
		ed.setSelection({ line, ch: args.from }, { line, ch: args.lineText.length });
	}, { lineText, from });
	await browser.keys(typed.split(''));
	await browser.pause(300);
	await browser.keys(['ArrowDown', 'ArrowDown']);
}

/** Errors and editor state, for a failure message. */
async function diag(): Promise<string> {
	return browser.executeObsidian(({ app }) => {
		const w = window as unknown as { __hlsErr?: string[] };
		const ed = (app.workspace.activeLeaf?.view as unknown as { editor?: { getValue(): string; getCursor(): { line: number } } }).editor;
		return JSON.stringify({ errors: w.__hlsErr ?? [], file: app.workspace.getActiveFile()?.path, cursor: ed?.getCursor(), headings: ed?.getValue().split('\n').filter((l) => l.startsWith('#') || l.startsWith('^')) });
	});
}

async function waitResult(): Promise<Result> {
	let r: Result | null = null;
	await browser.waitUntil(
		async () => {
			r = await browser.executeObsidian(({ app }) => ((app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins.plugins['heading-link-sync'] as { lastResult: Result | null }).lastResult);
			return r !== null;
		},
		{ timeout: 15000, interval: 250, timeoutMsg: 'no sync result' },
	).catch(async (e: unknown) => {
		throw new Error(`${String(e)} ${await diag()}`);
	});
	return r!;
}

describe('heading rename by typing', function () {
	let original: Record<string, string> = {};

	before(async function () {
		await fresh({});
		original = await vaultText();
	});

	it('updates every wikilink, embed, nested and property link in 31 notes, and nothing else', async function () {
		await fresh({});
		await typeOver(PLAN, '## Milestones', 3, 'Roadmap');
		const r = await waitResult();
		expect([r.links, r.notes]).toEqual([36, 31]);
		expect(r.skipped.map((s) => s.reason)).toEqual(Array(7).fill('pro-markdown'));
		await browser.waitUntil(async () => (await lastNotice()).includes('Updated 36 links in 31 notes'), { timeout: 5000 });
		expect(await lastNotice()).toContain('Not updated: 7 Markdown links (Pro).');
		const now = await vaultText();
		expect(now['Meetings/2026-01-05 kickoff.md']).toBe(original['Meetings/2026-01-05 kickoff.md']!.replace('related: "[[Project Plan#Milestones]]"', 'related: "[[Project Plan#Roadmap]]"').replace('See [[Project Plan#Milestones]].', 'See [[Project Plan#Roadmap]].'));
		expect(now['Meetings/2026-01-06 content audit.md']).toContain('[[Project Plan#Roadmap|the milestones]]');
		expect(now['Meetings/2026-01-06 content audit.md']).toContain('[the plan](Project%20Plan.md#Milestones)');
		expect(now['Meetings/2026-01-07 site map.md']).toContain('![[Project Plan#Roadmap]]');
		expect(now['Meetings/2026-01-08 design review.md']).toContain('[[Project Plan#Roadmap#Phase 1]]');
		expect(now['Meetings/2026-01-09 component library.md']).toContain('[[Project Plan#Roadmap]] before Friday');
		expect(now['Meetings/2026-01-11 analytics.md']).toContain('```md\n[[Project Plan#Milestones]]\n```');
		expect(now['Templates/Meeting template.md']).toBe(original['Templates/Meeting template.md']);
		expect(now[PLAN]).toContain('## Roadmap\n');
		expect(now[PLAN]).toContain('See [[#Roadmap]] for dates.');
		const changed = Object.keys(now).filter((k) => now[k] !== original[k]);
		expect(changed.length).toBe(31);
	});

	it('Undo in the notice restores every linking note exactly', async function () {
		await fresh({});
		await typeOver(PLAN, '## Milestones', 3, 'Roadmap');
		await waitResult();
		await browser.waitUntil(async () => (await lastNotice()).includes('Updated'), { timeout: 5000 });
		await browser.$('.notice .hls-undo').click();
		await browser.waitUntil(async () => (await lastNotice()).includes('Restored links in 31 notes'), { timeout: 8000 });
		const now = await vaultText();
		for (const k of Object.keys(original)) if (k !== PLAN) expect([k, now[k]]).toEqual([k, original[k]]);
		expect(now[PLAN]).toBe(original[PLAN]!.replace('## Milestones', '## Roadmap'));
	});

	it('Ask first shows the counts and changes nothing on Skip', async function () {
		await fresh({ mode: 'ask' });
		await typeOver(PLAN, '## Milestones', 3, 'Roadmap');
		await browser.$('.modal').waitForDisplayed({ timeout: 15000 });
		expect(await browser.$('.modal').getText()).toContain('This changes 36 links in 31 notes.');
		await browser.$('button=Skip').click();
		await browser.pause(500);
		const now = await vaultText();
		for (const k of Object.keys(original)) if (k !== PLAN) expect(now[k]).toBe(original[k]);
	});

	it('Ask first applies on Update links', async function () {
		await fresh({ mode: 'ask' });
		await typeOver(PLAN, '## Milestones', 3, 'Roadmap');
		await browser.$('.modal').waitForDisplayed({ timeout: 15000 });
		await browser.$('button=Update links').click();
		const r = await waitResult();
		expect([r.links, r.notes]).toEqual([36, 31]);
	});

	it('the broken link report needs Pro', async function () {
		await fresh({});
		await browser.executeObsidianCommand('heading-link-sync:find-broken-links');
		await browser.waitUntil(async () => (await lastNotice()).toLowerCase().includes('pro feature'), { timeout: 5000 });
	});
});

describe('Pro', function () {
	it('updates Markdown links with %20 and angle brackets too', async function () {
		await fresh({}, true);
		await typeOver(PLAN, '## Milestones', 3, 'Roadmap and dates');
		const r = await waitResult();
		expect([r.links, r.notes, r.skipped.length]).toEqual([43, 31, 0]);
		const now = await vaultText();
		expect(now['Meetings/2026-01-06 content audit.md']).toContain('[the plan](Project%20Plan.md#Roadmap%20and%20dates)');
		expect(now['Meetings/2026-01-06 content audit.md']).toContain('[budget](Project%20Plan.md#Budget)');
		expect(now['Tasks/Pick a font.md'] ?? now['Tasks/Move images to a CDN.md']).toBeDefined();
		const angle = Object.values(now).filter((t) => t.includes('[milestones](<Project Plan.md#Roadmap and dates>)'));
		expect(angle.length).toBe(3);
	});

	it('follows a ^block-id rename in links and embeds', async function () {
		await fresh({}, true);
		await typeOver(PLAN, '^budget-table', 1, 'costs');
		const r = await waitResult();
		expect([r.links, r.notes]).toEqual([5, 5]);
		const now = await vaultText();
		expect(now['Status report.md']).toContain('[[Project Plan#^costs|the budget table]]');
		expect(now['Meetings/2026-01-08 design review.md']).toContain('[[Project Plan#^costs]]');
	});

	it('the preview lists every change and applies only the checked ones', async function () {
		await fresh({ mode: 'ask' }, true);
		await typeOver(PLAN, '## Milestones', 3, 'Roadmap');
		await browser.$('.hls-preview').waitForDisplayed({ timeout: 15000 });
		const rows = await browser.$$('.hls-preview .hls-row input[type=checkbox]');
		expect(await rows.length).toBe(43);
		await rows[0]!.click();
		await browser.$('button=Apply selected').click();
		const r = await waitResult();
		expect(r.links).toBe(42);
	});

	it('the broken link report fixes links with a close heading or block ID', async function () {
		await fresh({}, true);
		await browser.executeObsidianCommand('heading-link-sync:find-broken-links');
		await browser.$('.hls-preview').waitForDisplayed({ timeout: 5000 });
		expect(await browser.$('.hls-preview').getText()).toContain('4 broken links, 3 with a suggested fix.');
		await browser.$('button=Fix all with a suggestion').click();
		await browser.pause(1000);
		const text = await obsidianPage.read('Reading list.md');
		expect(text).toContain('- [[Project Plan#Milestones]]\n- [[Project Plan#Budget]]\n- [[Project Plan#^phase-one]]\n- [[Project Plan#Timeline]]');
	});
});
