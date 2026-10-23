import {
    AttachmentStatus,
    HeaderStatus,
    bindStore,
    formatNoteMessage,
    installStyles,
    onSocket,
    refreshNow,
    scheduleRefresh,
    socketEvent,
} from './status';
import {bindStore as bindI18nStore, getTranslationsForLocale} from './i18n';
import {
    AllowedRolesSetting,
    AllowedUserIDsSetting,
    AutoChannelSetting,
    AutoDMSetting,
    AutoGMSetting,
    EnabledSetting,
    PollIntervalSetting,
    ThreadNoteSetting,
} from './admin_console_settings';

// The console settings are drawn by localized custom components (the schema
// strings in plugin.json are rendered verbatim by the platform).
const CONSOLE_SETTINGS = [
    ['Enabled', EnabledSetting],
    ['AllowedRoles', AllowedRolesSetting],
    ['AllowedUserIDs', AllowedUserIDsSetting],
    ['PollIntervalSeconds', PollIntervalSetting],
    ['AutoReceiptForAllowedSendersInDM', AutoDMSetting],
    ['AutoReceiptIncludeGM', AutoGMSetting],
    ['AutoReceiptIncludeChannel', AutoChannelSetting],
    ['PostPublicReceiptOnRead', ThreadNoteSetting],
];

export default class ReadReceiptPlugin {
    initialize(registry, store) {
        bindStore(store);
        bindI18nStore(store);
        installStyles();
        try {
            registry.registerPostHeaderComponent(HeaderStatus);
        } catch (e) {
            // Older servers only get the fallback under the message.
        }
        registry.registerPostMessageAttachmentComponent(AttachmentStatus);
        try {
            registry.registerMessageWillFormatHook(formatNoteMessage);
        } catch (e) {
            // The stored note stays without a clock time when this hook is missing.
        }
        registry.registerWebSocketEventHandler(socketEvent, onSocket);
        registry.registerReconnectHandler(refreshNow);
        try {
            // The webapp merges our dictionary into its i18n bundle on every
            // translation load, so useIntl in the components follows the
            // viewer's language automatically.
            registry.registerTranslations(getTranslationsForLocale);
        } catch (e) {
            // Without it the components fall back to the English defaults.
        }
        CONSOLE_SETTINGS.forEach(([key, component]) => {
            try {
                registry.registerAdminConsoleCustomSetting(key, component, {showTitle: false});
            } catch (e) {
                // The platform row (English labels) stays as a fallback.
            }
        });
        this.unsubscribe = store.subscribe(scheduleRefresh);
        scheduleRefresh();
    }

    uninitialize() {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
    }
}
