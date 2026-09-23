import { installEditorThemeFollow, resolveEditorUiTheme } from '../editor-theme';

/**
 * Default interface theme for the editor. The v9 loader's light default is
 * already `theme-white` (Modern Light). We pass it through
 * `customization.uiTheme`, which api.js turns into the `uitheme=` frame
 * parameter -- and that parameter wins over the editor's own stored choice at
 * boot. So respect a theme the user has already picked in the editor
 * (same-origin `ui-theme-id`) and only fall back to Modern Light when there is
 * none, otherwise every open would reset their preference.
 */
export const DEFAULT_UI_THEME = 'theme-white';
export const UI_THEME_STORAGE_KEY = 'ui-theme-id';

export function resolveUiTheme(): string {
  // Follows the site's ranui theme (dark site -> Modern Dark / theme-night)
  // unless the user picked a theme inside the editor; see lib/editor-theme.ts.
  return resolveEditorUiTheme(DEFAULT_UI_THEME);
}

// Keep a mounted editor in step with the site theme (top-bar switch, OS
// switch in system mode) for the page's lifetime; idempotent per module.
if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  installEditorThemeFollow(DEFAULT_UI_THEME);
}
