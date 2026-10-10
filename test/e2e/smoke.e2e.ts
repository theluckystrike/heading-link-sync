import { browser, expect } from '@wdio/globals';
import { pluginId, reloadPlugin } from './load';

describe(`${pluginId} smoke test`, function () {
	it('is enabled and reloads with no console errors', async function () {
		const state = await reloadPlugin(pluginId);
		expect(state).toEqual({ enabled: true, reloaded: true, errors: [] });
	});

	it('registers its commands', async function () {
		const ids = await browser.executeObsidian(({ app }) => Object.keys((app as unknown as { commands: { commands: Record<string, unknown> } }).commands.commands).filter((id) => id.startsWith('heading-link-sync:')).sort());
		expect(ids).toEqual(['heading-link-sync:find-broken-links', 'heading-link-sync:undo-last-update']);
	});
});
