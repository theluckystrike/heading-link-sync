import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';

describe('free reference counts', function () {
	it('shows and refreshes heading and block counts in the editor', async function () {
		await obsidianPage.write('references/Target.md', '# Setup\n\nText. ^abc\n\n## Unlinked\n');
		await obsidianPage.write('references/Source.md', '[[Target#Setup]] ![[Target#Setup]] [block](Target.md#^abc)');
		await browser.executeObsidian(async ({ app }) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins.plugins['heading-link-sync'] as unknown as { settings: { referenceCounts: boolean; excludedFolders: string }; saveSettings(): Promise<void> };
			plugin.settings.referenceCounts = true;
			plugin.settings.excludedFolders = '';
			await plugin.saveSettings();
			await app.workspace.getLeaf(false).openFile(app.vault.getFileByPath('references/Target.md')!, { state: { mode: 'source', source: true } });
		});
		const counts = async () => browser.execute(() => Array.from(document.querySelectorAll('.workspace-leaf.mod-active .hls-reference-count')).map((el) => el.textContent));
		await browser.waitUntil(async () => JSON.stringify(await counts()) === '["2","1"]', { timeout: 10000 });
		expect(await counts()).toEqual(['2', '1']);
		await obsidianPage.write('references/Source.md', '[[Target#Setup]]');
		await browser.waitUntil(async () => JSON.stringify(await counts()) === '["1"]', { timeout: 10000 });
		await browser.executeObsidian(async ({ app }) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins.plugins['heading-link-sync'] as unknown as { settings: { referenceCounts: boolean }; saveSettings(): Promise<void> };
			plugin.settings.referenceCounts = false;
			await plugin.saveSettings();
		});
		await browser.waitUntil(async () => (await counts()).length === 0, { timeout: 10000 });
		await browser.executeObsidian(async ({ app }) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins.plugins['heading-link-sync'] as unknown as { settings: { referenceCounts: boolean; excludedFolders: string }; saveSettings(): Promise<void> };
			plugin.settings.referenceCounts = true;
			plugin.settings.excludedFolders = 'references';
			await plugin.saveSettings();
		});
		expect(await counts()).toEqual([]);
		await browser.executeObsidian(async ({ app }) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins.plugins['heading-link-sync'] as unknown as { settings: { excludedFolders: string }; saveSettings(): Promise<void> };
			plugin.settings.excludedFolders = '';
			await plugin.saveSettings();
		});
		await browser.waitUntil(async () => JSON.stringify(await counts()) === '["1"]', { timeout: 10000 });
	});
	it('shows counts in Live Preview', async function () {
		await obsidianPage.write('references/Target.md', '# Setup\n\nText. ^abc\n');
		await obsidianPage.write('references/Source.md', '[[Target#Setup]] [block](Target.md#^abc)');
		await browser.executeObsidian(async ({ app }) => {
			await app.workspace.getLeaf(false).openFile(app.vault.getFileByPath('references/Target.md')!, { state: { mode: 'source', source: false } });
		});
		const counts = async () => browser.execute(() => Array.from(document.querySelectorAll('.workspace-leaf.mod-active .is-live-preview .hls-reference-count')).filter((el) => (el as HTMLElement).offsetParent !== null).map((el) => el.textContent));
		await browser.waitUntil(async () => JSON.stringify(await counts()) === '["1","1"]', { timeout: 10000 });
		// The settings tab path, as a click on the switch, must hide the counts at once.
		const setCounts = async (on: boolean) => browser.executeObsidian(async ({ app }, value) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins.plugins['heading-link-sync'] as unknown as { settingTab: { setControlValue(key: string, value: unknown): Promise<void> } };
			await plugin.settingTab.setControlValue('referenceCounts', value);
		}, on);
		await setCounts(false);
		await browser.waitUntil(async () => (await counts()).length === 0, { timeout: 2000 });
		await setCounts(true);
		await browser.waitUntil(async () => JSON.stringify(await counts()) === '["1","1"]', { timeout: 2000 });
	});
});

