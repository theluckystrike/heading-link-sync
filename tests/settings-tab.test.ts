import { describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import { DEFAULT_SETTINGS, HeadingLinkSyncSettingTab } from '../src/settings';

describe('settings tab', () => {
	it('saves through the plugin so a changed switch or folder list refreshes the counts at once', async () => {
		const plugin = { settings: { ...DEFAULT_SETTINGS }, pro: null, saveSettings: vi.fn(async () => undefined) };
		const tab = new HeadingLinkSyncSettingTab(App.createConfigured__({}) as never, plugin as never);
		// The app persists the value. This mock only writes it, as the app does before it saves.
		plugin.settings.referenceCounts = false;
		await tab.setControlValue('referenceCounts', false);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
		expect(plugin.settings.referenceCounts).toBe(false);
	});
});
