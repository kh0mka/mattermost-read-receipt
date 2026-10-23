import React from 'react';
import {useIntl} from 'react-intl';

import {currentLocale, MSG_PREFIX as M, t} from './i18n';
import {id as pluginId} from './manifest';

const GREY = '#8c97a5';
const BLUE = '#1c58d9';
const EVENT = `custom_${pluginId}_read_receipt_updated`;

const cache = new Map();
const listeners = new Set();
let reduxStore = null;
let refreshTimer = null;
let lastFetchKey = '';

function emit() {
    listeners.forEach((fn) => fn());
}

function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

function setStatus(postId, body) {
    if (!postId || !body) {
        return;
    }
    cache.set(postId, body);
    emit();
}

export function bindStore(store) {
    reduxStore = store;
}

export function onSocket(msg) {
    const data = msg && msg.data;
    if (!data || !data.body) {
        return;
    }
    try {
        setStatus(data.post_id, JSON.parse(data.body));
    } catch (e) {
        // ignore malformed payloads
    }
}

export function installStyles() {
    let style = document.getElementById('mst-rr-style');
    if (!style) {
        style = document.createElement('style');
        style.id = 'mst-rr-style';
        document.head.appendChild(style);
    }
    style.textContent = [
        '.mst-rr-header,.mst-rr-fallback-row{pointer-events:auto;}',
        '.mst-rr-btn{border:0;background:transparent;padding:2px 4px;margin-left:4px;line-height:0;cursor:pointer;color:inherit;pointer-events:auto;position:relative;z-index:2;}',
        '.mst-rr-btn:focus-visible{outline:2px solid ' + BLUE + ';outline-offset:1px;border-radius:4px;}',
        '.mst-rr-pop{position:fixed;z-index:10000;pointer-events:auto;min-width:220px;max-width:320px;max-height:360px;overflow:auto;background:var(--center-channel-bg,#fff);color:var(--center-channel-color,#1c2430);border:1px solid rgba(63,67,80,.16);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:8px 10px;text-align:left;font-size:12px;line-height:1.35;}',
        '.mst-rr-row{display:flex;gap:8px;align-items:flex-start;margin:6px 0;}',
        '.mst-rr-group{margin:8px 0;}',
        '.mst-rr-label{font-weight:600;display:inline-block;min-width:78px;}',
        '.mst-rr-group .mst-rr-label{display:block;min-width:0;margin-bottom:2px;}',
        '.mst-rr-people{margin:0;padding:0;list-style:none;}',
        '.mst-rr-people li{margin:2px 0;}',
        '.mst-rr-fallback{display:contents;}',
        '.mst-rr-fallback-row{display:flex;justify-content:flex-end;}',
        '.mst-rr-marks{display:inline-flex;align-items:center;}',
    ].join('');
}

function currentUserId() {
    try {
        return reduxStore.getState().entities.users.currentUserId || '';
    } catch (e) {
        return '';
    }
}

function visibleOwnPostIds() {
    if (!reduxStore) {
        return [];
    }
    let state;
    try {
        state = reduxStore.getState();
    } catch (e) {
        return [];
    }
    const channelId = state.entities && state.entities.channels && state.entities.channels.currentChannelId;
    const me = state.entities && state.entities.users && state.entities.users.currentUserId;
    const channel = channelId && state.entities.channels.channels && state.entities.channels.channels[channelId];
    const channelType = channel && channel.type;
    if (!channel || !me || (channelType !== 'D' && channelType !== 'G' && channelType !== 'O' && channelType !== 'P')) {
        return [];
    }
    const posts = (state.entities.posts && state.entities.posts.posts) || {};
    const blocks = state.entities.posts && state.entities.posts.postsInChannel && state.entities.posts.postsInChannel[channelId];
    const ids = [];
    const push = (id) => {
        const post = posts[id];
        if (!post || post.user_id !== me || post.type || post.delete_at) {
            return;
        }
        if (!/^[a-z0-9]{26}$/.test(id)) {
            return;
        }
        ids.push(id);
    };
    if (Array.isArray(blocks)) {
        blocks.forEach((block) => {
            if (!block) {
                return;
            }
            if (typeof block === 'string') {
                push(block);
                return;
            }
            if (Array.isArray(block.order)) {
                block.order.forEach(push);
            }
        });
    }
    return ids;
}

async function refreshIds(ids) {
    for (let i = 0; i < ids.length; i += 50) {
        const slice = ids.slice(i, i + 50);
        try {
            const res = await fetch(`/plugins/${pluginId}/api/v1/refresh`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                },
                body: JSON.stringify({post_ids: slice}),
            });
            if (!res.ok) {
                continue;
            }
            const data = await res.json();
            const posts = data.posts || {};
            Object.keys(posts).forEach((postId) => setStatus(postId, posts[postId]));
        } catch (e) {
            // sender can retry by switching channels
        }
    }
}

export function scheduleRefresh() {
    const ids = visibleOwnPostIds();
    const key = ids.join(',');
    if (!key) {
        clearTimeout(refreshTimer);
        lastFetchKey = '';
        return;
    }
    if (key === lastFetchKey) {
        return;
    }
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
        const next = visibleOwnPostIds();
        const nextKey = next.join(',');
        if (!nextKey || nextKey === lastFetchKey) {
            return;
        }
        lastFetchKey = nextKey;
        refreshIds(next);
    }, 400);
}

export function refreshNow() {
    lastFetchKey = '';
    scheduleRefresh();
}

function useStatus(postId) {
    const getSnapshot = () => cache.get(postId) || null;
    return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function viewerTimeZone() {
    let tz = '';
    try {
        const users = reduxStore.getState().entities.users;
        const profile = users.profiles && users.profiles[users.currentUserId];
        const timezone = (profile && profile.timezone) || {};
        if (timezone.useAutomaticTimezone === 'false') {
            tz = timezone.manualTimezone || '';
        } else {
            tz = timezone.automaticTimezone || '';
        }
    } catch (e) {
        tz = '';
    }
    if (tz) {
        return tz;
    }
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch (e) {
        return '';
    }
}

function formatTime(ms, withYear) {
    if (!ms) {
        return t('time.notYet');
    }
    const options = {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    };
    if (withYear) {
        options.year = 'numeric';
    }
    const tz = viewerTimeZone();
    if (tz) {
        options.timeZone = tz;
    }
    // The viewer's language, not the browser's: deterministic across clients.
    const locale = currentLocale();
    try {
        return new Intl.DateTimeFormat(locale, options).format(new Date(ms));
    } catch (e) {
        delete options.timeZone;
        try {
            return new Intl.DateTimeFormat(locale, options).format(new Date(ms));
        } catch (err) {
            return '';
        }
    }
}

const NOTE_PROP = 'mst_read_receipt_note';
const SEEN_PROP = 'mst_read_receipt_seen_at';
const UTC_NOTE = / at (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) UTC/;

function isReceiptNote(post) {
    return Boolean(post && post.props && (post.props[NOTE_PROP] === 'true' || post.props[NOTE_PROP] === true));
}

// Shared channel/group notes keep the stored names; only the labels and
// the empty placeholders are localized. The markdown bold markers survive.
function translateSharedNote(message) {
    return message
        .replace(/\*\*Read\*\*/g, '**' + t('note.readLabel') + '**')
        .replace(/\*\*Not yet read\*\*/g, '**' + t('note.notYetReadLabel') + '**')
        .replace(/\bNo one yet\b/g, t('note.noOneYet'))
        .replace(/\bNo one\b/g, t('note.noOne'));
}

function noteReader(name) {
    const trimmed = name.trim();
    if (trimmed === 'the other person') {
        return t('note.otherPerson');
    }
    return trimmed;
}

// Legacy direct-message notes: "Имя Seen by Имя." / "Имя Not yet seen by
// Имя.", optionally followed by " at YYYY-MM-DD HH:MM UTC". The UTC suffix
// is stripped before matching, because "when" already carries the time.
function translateDmNote(message, when) {
    let core = message;
    if (UTC_NOTE.test(core)) {
        core = core.replace(UTC_NOTE, '').replace(/\s+\./, '.').replace(/\s{2,}/g, ' ').trim();
    }
    let match = /^(.*) Seen by (.*)\.$/.exec(core);
    if (match) {
        const reader = noteReader(match[2]);
        return when ? t('note.dmSeenAt', {reader, time: when}) : t('note.dmSeen', {reader});
    }
    match = /^(.*) Not yet seen by (.*)\.$/.exec(core);
    if (match) {
        const reader = noteReader(match[2]);
        return when ? t('note.dmNotYetSeenAt', {reader, time: when}) : t('note.dmNotYetSeen', {reader});
    }
    return null;
}

export function formatNoteMessage(post, message) {
    if (!message || !isReceiptNote(post)) {
        return message;
    }
    // Channel and group notes are a shared Read / Not yet read list. Only
    // the single-line direct-message note gets a viewer-local time.
    if (message.indexOf('\n') !== -1 || message.indexOf('Not yet read') !== -1) {
        return currentLocale() === 'ru' ? translateSharedNote(message) : message;
    }
    let ms = Number(post.props && post.props[SEEN_PROP]);
    if (!ms) {
        const match = UTC_NOTE.exec(message);
        if (match) {
            const parsed = Date.parse(match[1] + 'T' + match[2] + ':00Z');
            if (!Number.isNaN(parsed)) {
                ms = parsed;
            }
        }
    }
    const when = ms ? formatTime(ms, true) : '';
    if (currentLocale() !== 'ru') {
        // English keeps the historical rendering, byte for byte.
        if (when) {
            if (UTC_NOTE.test(message)) {
                return message.replace(UTC_NOTE, ' at ' + when);
            }
            return message.replace(/\.\s*$/, '') + ' at ' + when + '.';
        }
        if (UTC_NOTE.test(message)) {
            return message.replace(UTC_NOTE, '').replace(/\s+\./, '.').replace(/\s{2,}/g, ' ');
        }
        return message;
    }
    const localized = translateDmNote(message, when);
    if (localized) {
        return localized;
    }
    if (when && UTC_NOTE.test(message)) {
        return message.replace(UTC_NOTE, ' · ' + when);
    }
    return message;
}

function Single({color}) {
    return (
        <svg width='14' height='14' viewBox='0 0 16 16' aria-hidden='true'>
            <path d='M3.2 8.4 L6.4 11.4 L12.8 4.6' fill='none' stroke={color} strokeWidth='1.6' strokeLinecap='round' strokeLinejoin='round'/>
        </svg>
    );
}

function Double({first, second}) {
    return (
        <span className='mst-rr-marks'>
            <svg width='18' height='14' viewBox='0 0 20 16' aria-hidden='true'>
                <path d='M1.4 8.4 L4.4 11.4 L10.2 4.8' fill='none' stroke={first} strokeWidth='1.6' strokeLinecap='round' strokeLinejoin='round'/>
                <path d='M6.2 8.4 L9.2 11.4 L15.6 4.8' fill='none' stroke={second} strokeWidth='1.6' strokeLinecap='round' strokeLinejoin='round'/>
            </svg>
        </span>
    );
}

function Marks({status}) {
    if (status === 'read') {
        return <Double first={BLUE} second={BLUE}/>;
    }
    if (status === 'partial') {
        return <Double first={BLUE} second={GREY}/>;
    }
    return <Single color={GREY}/>;
}

function usesGroupedList(status) {
    if (!status) {
        return false;
    }
    // Missing channel_type is a channel or group, not a direct message.
    // A direct message is only the explicit "D" type, which stays Seen / Delivered.
    return status.channel_type !== 'D';
}

function labelFor(status, formatMessage) {
    const grouped = usesGroupedList(status);
    if (status && status.status === 'read') {
        return grouped ?
            formatMessage({id: M + 'status.readByEveryone', defaultMessage: 'Read by everyone'}) :
            formatMessage({id: M + 'status.seen', defaultMessage: 'Seen'});
    }
    if (status && status.status === 'partial') {
        return grouped ?
            formatMessage({id: M + 'status.readBySome', defaultMessage: 'Read by some'}) :
            formatMessage({id: M + 'status.seenBySome', defaultMessage: 'Seen by some'});
    }
    return formatMessage({id: M + 'status.sent', defaultMessage: 'Sent'});
}

function sortedPeople(list) {
    return (list || []).slice().sort((a, b) => {
        const an = (a.display_name || a.username || '').toLowerCase();
        const bn = (b.display_name || b.username || '').toLowerCase();
        return an.localeCompare(bn);
    });
}

function personName(person, formatMessage) {
    return person.display_name || person.username || formatMessage({id: M + 'person.unknown', defaultMessage: 'Someone'});
}

function people(list, timeField, emptyLabel, formatMessage) {
    const rows = sortedPeople(list);
    if (!rows.length) {
        return <div>{emptyLabel}</div>;
    }
    return (
        <ul className='mst-rr-people'>
            {rows.map((person) => (
                <li key={person.user_id}>
                    {timeField ? personName(person, formatMessage) + ' · ' + formatTime(person[timeField]) : personName(person, formatMessage)}
                </li>
            ))}
        </ul>
    );
}

function copyRect(rect) {
    return {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
        height: rect.height,
    };
}

function anchorFromClick(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const midY = (rect.top + rect.bottom) / 2;
    if (rect.width >= 1 && rect.height >= 1 && Math.abs(midY - event.clientY) <= 48) {
        return copyRect(rect);
    }
    // The message list parks every row at the top and moves it with a
    // transform. A box read before that move is not the tick under the pointer.
    const size = 16;
    return {
        top: event.clientY - size / 2,
        bottom: event.clientY + size / 2,
        left: event.clientX - size / 2,
        width: size,
        height: size,
    };
}

function placePopover(rect, height) {
    const width = 320;
    const gap = 6;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    let top = rect.bottom + gap;
    if (top + height > window.innerHeight - 8) {
        const above = rect.top - gap - height;
        if (above >= 8) {
            top = above;
        }
    }
    return {top, left};
}

function mountPopover(node) {
    // The channel post list positions rows with CSS transforms, and the
    // header column clips overflow. A fixed box inside that row is placed
    // against the row and never shows. document.body is outside that box.
    const reactDOM = typeof window !== 'undefined' ? window.ReactDOM : null;
    if (reactDOM && typeof reactDOM.createPortal === 'function' && document.body) {
        return reactDOM.createPortal(node, document.body);
    }
    return node;
}

function Popover({status, anchor, anchorRect, popRef}) {
    const {formatMessage} = useIntl();
    const [box, setBox] = React.useState(() => placePopover(anchorRect, 96));
    React.useLayoutEffect(() => {
        let frame = 0;
        let scrolled = false;
        const update = () => {
            if (!anchor || !anchor.isConnected) {
                return;
            }
            const rect = anchor.getBoundingClientRect();
            if (rect.width < 1 && rect.height < 1) {
                return;
            }
            if (!scrolled && Math.abs(rect.top - anchorRect.top) > 80) {
                return;
            }
            const height = (popRef.current && popRef.current.offsetHeight) || 96;
            setBox(placePopover(rect, height));
        };
        const onScroll = () => {
            scrolled = true;
            window.cancelAnimationFrame(frame);
            frame = window.requestAnimationFrame(update);
        };
        frame = window.requestAnimationFrame(update);
        document.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onScroll);
        return () => {
            window.cancelAnimationFrame(frame);
            document.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onScroll);
        };
    }, [anchor, anchorRect, popRef]);
    const recipients = status.recipients || [];
    const deliveredAt = status.create_at;
    let body;
    if (usesGroupedList(status)) {
        body = (
            <React.Fragment>
                <div className='mst-rr-group'>
                    <span className='mst-rr-label'>{formatMessage({id: M + 'list.read', defaultMessage: 'Read'})}</span>
                    {people(recipients.filter((person) => person.seen_at), 'seen_at', formatMessage({id: M + 'list.noOneYet', defaultMessage: 'No one yet'}), formatMessage)}
                </div>
                <div className='mst-rr-group'>
                    <span className='mst-rr-label'>{formatMessage({id: M + 'list.notYetRead', defaultMessage: 'Not yet read'})}</span>
                    {people(recipients.filter((person) => !person.seen_at), '', formatMessage({id: M + 'list.noOne', defaultMessage: 'No one'}), formatMessage)}
                </div>
            </React.Fragment>
        );
    } else {
        const seenAt = recipients[0] && recipients[0].seen_at;
        body = (
            <React.Fragment>
                <div className='mst-rr-row'>
                    <Double first={BLUE} second={BLUE}/>
                    <span><span className='mst-rr-label'>{formatMessage({id: M + 'list.seen', defaultMessage: 'Seen'})}</span>{formatTime(seenAt)}</span>
                </div>
                <div className='mst-rr-row'>
                    <Single color={GREY}/>
                    <span><span className='mst-rr-label'>{formatMessage({id: M + 'list.delivered', defaultMessage: 'Delivered'})}</span>{formatTime(deliveredAt)}</span>
                </div>
            </React.Fragment>
        );
    }
    return mountPopover(
        <div ref={popRef} className='mst-rr-pop' style={{position: 'fixed', top: box.top, left: box.left}} role='dialog' aria-label={formatMessage({id: M + 'dialog.messageStatus', defaultMessage: 'Message status'})}>
            {body}
        </div>
    );
}

function trackedPost(post) {
    if (!post || !post.id || post.type || post.delete_at) {
        return false;
    }
    if (post.state === 'PENDING' || post.state === 'FAILED' || post.failed) {
        return false;
    }
    if (!/^[a-z0-9]{26}$/.test(post.id)) {
        return false;
    }
    if (post.user_id !== currentUserId()) {
        return false;
    }
    return true;
}

function StatusButton({post}) {
    const {formatMessage} = useIntl();
    const status = useStatus(post && post.id);
    const btnRef = React.useRef(null);
    const popRef = React.useRef(null);
    const [open, setOpen] = React.useState(false);
    const [anchorRect, setAnchorRect] = React.useState(null);
    const visible = trackedPost(post) && status && status.status !== 'skipped';

    React.useLayoutEffect(() => {
        const btn = btnRef.current;
        if (!btn) {
            return undefined;
        }
        const stop = (event) => {
            event.stopPropagation();
            if (event.stopImmediatePropagation) {
                event.stopImmediatePropagation();
            }
        };
        const onClick = (event) => {
            const nextRect = anchorFromClick(event);
            stop(event);
            event.preventDefault();
            setAnchorRect(nextRect);
            setOpen((value) => !value);
        };
        btn.addEventListener('mousedown', stop);
        btn.addEventListener('click', onClick);
        return () => {
            btn.removeEventListener('mousedown', stop);
            btn.removeEventListener('click', onClick);
        };
    }, [visible]);

    React.useEffect(() => {
        if (!open) {
            return undefined;
        }
        const close = (event) => {
            const target = event.target;
            if (btnRef.current && btnRef.current.contains(target)) {
                return;
            }
            if (popRef.current && popRef.current.contains(target)) {
                return;
            }
            setOpen(false);
        };
        const onKey = (event) => {
            if (event.key === 'Escape') {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', close);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', close);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    if (!visible) {
        return null;
    }
    const label = labelFor(status, formatMessage);
    return (
        <React.Fragment>
            <button
                ref={btnRef}
                type='button'
                className='mst-rr-btn'
                aria-label={label}
                title={label}
                aria-expanded={open}
            >
                <Marks status={status.status}/>
            </button>
            {open && anchorRect && btnRef.current ? <Popover status={status} anchor={btnRef.current} anchorRect={anchorRect} popRef={popRef}/> : null}
        </React.Fragment>
    );
}

export function HeaderStatus(props) {
    return (
        <span data-mst-rr-anchor='' className='mst-rr-header'>
            <StatusButton post={props.post}/>
        </span>
    );
}

export function AttachmentStatus(props) {
    const ref = React.useRef(null);
    const [headerMounted, setHeaderMounted] = React.useState(false);
    React.useLayoutEffect(() => {
        const root = ref.current && ref.current.closest('.post');
        setHeaderMounted(Boolean(root && root.querySelector('[data-mst-rr-anchor]')));
    });
    if (!trackedPost(props.post)) {
        return null;
    }
    return (
        <div ref={ref} className='mst-rr-fallback'>
            {headerMounted ? null : (
                <div className='mst-rr-fallback-row'>
                    <StatusButton post={props.post}/>
                </div>
            )}
        </div>
    );
}

export const socketEvent = EVENT;
