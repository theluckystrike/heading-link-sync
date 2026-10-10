// Pro through GitHub Sponsors (packages/license, github.ts). product.yaml pro: holds the same values; fx check compares them.
// The one facade for Pro checks: code outside this file and main.ts calls isPro() and onProChange() only.
import type { SponsorsConfig, SponsorsManager } from './license/index';

export const SPONSORS: SponsorsConfig = {
	// Public client id of the seller's OAuth App (device flow on, no client secret anywhere).
	clientId: 'Ov23lic5UPGPZqhBlBGg',
	sponsorLogin: 'theluckystrike',
	minMonthlyUsd: 5,
	oneTimeUsd: 15,
	// 0 = a one-time sponsorship turns Pro on for life.
	oneTimeMonths: 0,
	// Read-only profile access: the sponsorship tier fields need it. No repository or write access.
	scope: 'read:user',
};

export const PRO_UI = {
	proSummary: 'Pro updates Markdown links and block ID links, shows every change before it is applied, and finds broken heading links with one-click fixes.',
	priceText: 'Sponsor $5 a month, or $15 once. When you have paid $15 in total, Pro stays on.',
};

let manager: SponsorsManager | null = null;

/** main.ts binds the GitHub Sponsors manager once in onload, and unbinds it in onunload. */
export function bindPro(m: SponsorsManager | null): void {
	manager = m;
}

/** True when Pro features are on, from the cached GitHub Sponsors answer. Never sends a request. */
export function isPro(): boolean {
	return manager?.isPro() ?? false;
}

/** Calls cb each time the Pro state changes. Returns a function that removes cb. */
export function onProChange(cb: () => void): () => void {
	return manager ? manager.onChange(cb) : () => undefined;
}
