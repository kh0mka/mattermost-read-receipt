// i18n for the read-receipt webapp.
//
// The dictionaries live in webapp/i18n (en.json, ru.json); every message ID
// is namespaced with the plugin id so the keys can never collide with the
// core or another plugin in the shared webapp i18n bundle.
//
// React components translate through react-intl (useIntl): the webapp merges
// our dictionary into its message bundle via registry.registerTranslations,
// which is called from plugin.js. Switching the language in the profile
// reloads the webapp translations, so the plugin follows automatically.
//
// The non-React path (the message formatting hook runs outside of React)
// resolves the same keys against the dictionaries directly, using the
// viewer's profile locale from the store: "ru*" gets Russian, "en*" gets
// English, everything else (including an unset locale) falls back to
// English, which is the plugin default.

import en from '../i18n/en.json';
import ru from '../i18n/ru.json';

export const MSG_PREFIX = 'app.com.mst.read-receipt.';

const MESSAGES = {
    en: en,
    ru: ru,
};

const DEFAULT_LOCALE = 'en';

let i18nStore = null;

export function bindStore(store) {
    i18nStore = store;
}

function viewerLocale() {
    try {
        const state = i18nStore && i18nStore.getState();
        const users = state && state.entities.users;
        const profile = users && users.profiles && users.profiles[users.currentUserId];
        const locale = (profile && profile.locale) || '';
        if (locale) {
            return locale;
        }
        // Match the webapp: an empty profile locale falls back to the
        // server's DefaultClientLocale, so the hook and the UI agree.
        const config = state.entities.general && state.entities.general.config;
        return (config && config.DefaultClientLocale) || '';
    } catch (e) {
        return '';
    }
}

export function pickLocale(locale) {
    const code = String(locale || '').toLowerCase();
    if (code.indexOf('ru') === 0) {
        return 'ru';
    }
    if (code.indexOf('en') === 0) {
        return 'en';
    }
    return DEFAULT_LOCALE;
}

export function currentLocale() {
    return pickLocale(viewerLocale());
}

// Translation source for registry.registerTranslations: the webapp calls it
// with the webapp locale on every translation load (startup and language
// switch). Russian for "ru*", English for everything else.
export function getTranslationsForLocale(locale) {
    return MESSAGES[pickLocale(locale)];
}

function translate(locale, key, vars) {
    const full = MSG_PREFIX + key;
    let str = MESSAGES[locale] && MESSAGES[locale][full];
    if (str === undefined && locale !== 'en') {
        str = MESSAGES.en[full];
    }
    if (str === undefined) {
        return key;
    }
    if (vars) {
        Object.keys(vars).forEach((name) => {
            str = str.split('{' + name + '}').join(String(vars[name]));
        });
    }
    return str;
}

// Synchronous translation bound to the current viewer locale. Safe outside
// of React: the message formatting hook is invoked by the webapp renderer,
// not inside a component.
export function t(key, vars) {
    return translate(currentLocale(), key, vars);
}

