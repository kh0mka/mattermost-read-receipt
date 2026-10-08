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

export default class ReadReceiptPlugin {
    initialize(registry, store) {
        bindStore(store);
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
