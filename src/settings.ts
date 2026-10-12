import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { isPro, PRO_UI } from './pro';
import type HeadingLinkSyncPlugin from './main';

export type SyncMode = 'auto' | 'ask';

export interface HeadingLinkSyncSettings {
	/** Show the number of links beside headings and block IDs in the editor. */
	referenceCounts: boolean;
	/** auto: update links at once and show a notice with Undo. ask: ask before each update. */
	mode: SyncMode;
	/** Pause in ms after the last key press before a heading edit counts as done. */
	delayMs: number;
	/** One folder per line. Notes in these folders are never changed, and heading edits in them are ignored. */
	excludedFolders: string;
	/** Pro: update Markdown links too. */
	markdownLinks: boolean;
	/** Pro: update links to block IDs when you edit a ^block-id. */
	blockLinks: boolean;
}

export const DELAY_MIN = 500;
export const DELAY_MAX = 5000;

export const DEFAULT_SETTINGS: HeadingLinkSyncSettings = {
	referenceCounts: true,
	mode: 'auto',
	delayMs: 1500,
	excludedFolders: '',
	markdownLinks: true,
	blockLinks: true,
};

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<HeadingLinkSyncSettings> | null | undefined): HeadingLinkSyncSettings {
	const s = saved ?? {};
	const delay = typeof s.delayMs === 'number' && Number.isFinite(s.delayMs) ? Math.round(s.delayMs) : DEFAULT_SETTINGS.delayMs;
	return {
		referenceCounts: typeof s.referenceCounts === 'boolean' ? s.referenceCounts : DEFAULT_SETTINGS.referenceCounts,
		mode: s.mode === 'ask' || s.mode === 'auto' ? s.mode : DEFAULT_SETTINGS.mode,
		delayMs: Math.min(DELAY_MAX, Math.max(DELAY_MIN, delay)),
		excludedFolders: typeof s.excludedFolders === 'string' ? s.excludedFolders : DEFAULT_SETTINGS.excludedFolders,
		markdownLinks: typeof s.markdownLinks === 'boolean' ? s.markdownLinks : DEFAULT_SETTINGS.markdownLinks,
		blockLinks: typeof s.blockLinks === 'boolean' ? s.blockLinks : DEFAULT_SETTINGS.blockLinks,
	};
}

/** The excluded folders as clean prefixes without slashes at the ends. */
export function excludedList(settings: HeadingLinkSyncSettings): string[] {
	return settings.excludedFolders
		.split('\n')
		.map((l) => l.trim().replace(/^\/+|\/+$/g, ''))
		.filter((l) => l.length > 0);
}

/** True when the path is inside one of the excluded folders. */
export function isExcluded(path: string, folders: readonly string[]): boolean {
	return folders.some((f) => path === f || path.startsWith(`${f}/`));
}

export class HeadingLinkSyncSettingTab extends PluginSettingTab {
	plugin: HeadingLinkSyncPlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: HeadingLinkSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
			{
				name: 'Show reference counts',
				desc: 'Show the number of links beside each referenced heading or block ID in the editor.',
				control: { type: 'toggle', key: 'referenceCounts', defaultValue: DEFAULT_SETTINGS.referenceCounts },
			},
			{
				name: 'When a heading changes',
				desc: 'Update links at once and show a notice with an undo button, or ask first.',
				control: { type: 'dropdown', key: 'mode', defaultValue: DEFAULT_SETTINGS.mode, options: { auto: 'Update links at once', ask: 'Ask first' } },
			},
			{
				name: 'Pause before an update',
				desc: `Milliseconds without typing before a heading edit counts as done, from ${DELAY_MIN} to ${DELAY_MAX}. Moving the cursor off the heading line also ends the edit.`,
				control: { type: 'slider', key: 'delayMs', defaultValue: DEFAULT_SETTINGS.delayMs, min: DELAY_MIN, max: DELAY_MAX, step: 250 },
			},
			{
				name: 'Excluded folders',
				desc: 'One folder per line. Notes in these folders are never changed, and heading edits in them do not update links.',
				control: { type: 'textarea', key: 'excludedFolders', defaultValue: DEFAULT_SETTINGS.excludedFolders, placeholder: 'Templates\nArchive/2024', rows: 3 },
			},
			{
				name: 'Update Markdown links',
				desc: 'Pro. Also update links like [text](note.md#heading), with spaces written as %20.',
				control: { type: 'toggle', key: 'markdownLinks', defaultValue: DEFAULT_SETTINGS.markdownLinks, disabled: () => !isPro() },
			},
			{
				name: 'Update block ID links',
				desc: 'Pro. When you edit a ^block-id, update every link and embed to it.',
				control: { type: 'toggle', key: 'blockLinks', defaultValue: DEFAULT_SETTINGS.blockLinks, disabled: () => !isPro() },
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
		// saveSettings also refreshes the reference counts in open editors.
		await this.plugin.saveSettings();
	}
}
