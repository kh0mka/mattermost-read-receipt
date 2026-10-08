import React from 'react';

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
    if (document.getElementById('mst-rr-style')) {
        return;
    }
    const style = document.createElement('style');
    style.id = 'mst-rr-style';
    style.textContent = [
        '.mst-rr-btn{border:0;background:transparent;padding:0 2px;margin-left:4px;line-height:0;cursor:pointer;color:inherit;}',
        '.mst-rr-btn:focus-visible{outline:2px solid ' + BLUE + ';outline-offset:1px;border-radius:4px;}',
        '.mst-rr-pop{position:fixed;z-index:2000;min-width:220px;max-width:320px;max-height:360px;overflow:auto;background:var(--center-channel-bg,#fff);color:var(--center-channel-color,#1c2430);border:1px solid rgba(63,67,80,.16);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);padding:8px 10px;text-align:left;font-size:12px;line-height:1.35;}',
        '.mst-rr-row{display:flex;gap:8px;align-items:flex-start;margin:6px 0;}',
        '.mst-rr-group{margin:8px 0;}',
        '.mst-rr-label{font-weight:600;min-width:78px;}',
        '.mst-rr-group .mst-rr-label{display:block;min-width:0;margin-bottom:2px;}',
        '.mst-rr-people{margin:0;padding:0;list-style:none;}',
        '.mst-rr-people li{margin:2px 0;}',
        '.mst-rr-fallback{display:contents;}',
        '.mst-rr-fallback-row{display:flex;justify-content:flex-end;}',
        '.mst-rr-marks{display:inline-flex;align-items:center;}',
    ].join('');
    document.head.appendChild(style);
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
    return React.useSyncExternalStore(subscribe, () => cache.get(postId) || null);
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
        return 'Not yet';
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
    try {
        return new Intl.DateTimeFormat(undefined, options).format(new Date(ms));
    } catch (e) {
        delete options.timeZone;
        try {
            return new Intl.DateTimeFormat(undefined, options).format(new Date(ms));
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

export function formatNoteMessage(post, message) {
    if (!message || !isReceiptNote(post)) {
        return message;
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
    if (!status || status.channel_type === 'D') {
        return false;
    }
    if (status.channel_type === 'G' || status.channel_type === 'O' || status.channel_type === 'P') {
        return true;
    }
    return (status.recipients || []).length > 1;
}

function labelFor(status) {
    const grouped = usesGroupedList(status);
    if (status && status.status === 'read') {
        return grouped ? 'Read by everyone' : 'Seen';
    }
    if (status && status.status === 'partial') {
        return grouped ? 'Read by some' : 'Seen by some';
    }
    return 'Sent';
}

function sortedPeople(list) {
    return (list || []).slice().sort((a, b) => {
        const an = (a.display_name || a.username || '').toLowerCase();
        const bn = (b.display_name || b.username || '').toLowerCase();
        return an.localeCompare(bn);
    });
}

function personName(person) {
    return person.display_name || person.username || 'Someone';
}

function people(list, timeField, emptyLabel) {
    const rows = sortedPeople(list);
    if (!rows.length) {
        return <div>{emptyLabel}</div>;
    }
    return (
        <ul className='mst-rr-people'>
            {rows.map((person) => (
                <li key={person.user_id}>
                    {timeField ? personName(person) + ' · ' + formatTime(person[timeField]) : personName(person)}
                </li>
            ))}
        </ul>
    );
}

function Popover({status, anchor}) {
    const rect = anchor.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 336));
    const top = rect.bottom + 6;
    const recipients = status.recipients || [];
    const deliveredAt = status.create_at;
    let body;
    if (usesGroupedList(status)) {
        body = (
            <React.Fragment>
                <div className='mst-rr-group'>
                    <span className='mst-rr-label'>Read</span>
                    {people(recipients.filter((person) => person.seen_at), 'seen_at', 'No one yet')}
                </div>
                <div className='mst-rr-group'>
                    <span className='mst-rr-label'>Not yet read</span>
                    {people(recipients.filter((person) => !person.seen_at), '', 'No one')}
                </div>
            </React.Fragment>
        );
    } else {
        const seenAt = recipients[0] && recipients[0].seen_at;
        body = (
            <React.Fragment>
                <div className='mst-rr-row'>
                    <Double first={BLUE} second={BLUE}/>
                    <span><span className='mst-rr-label'>Seen</span>{formatTime(seenAt)}</span>
                </div>
                <div className='mst-rr-row'>
                    <Single color={GREY}/>
                    <span><span className='mst-rr-label'>Delivered</span>{formatTime(deliveredAt)}</span>
                </div>
            </React.Fragment>
        );
    }
    return (
        <div className='mst-rr-pop' style={{top, left}} role='dialog' aria-label='Message status'>
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
    const status = useStatus(post && post.id);
    const btnRef = React.useRef(null);
    const [open, setOpen] = React.useState(false);

    React.useEffect(() => {
        if (!open) {
            return undefined;
        }
        const close = (event) => {
            if (btnRef.current && btnRef.current.contains(event.target)) {
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

    if (!trackedPost(post) || !status || status.status === 'skipped') {
        return null;
    }
    const label = labelFor(status);
    return (
        <React.Fragment>
            <button
                ref={btnRef}
                type='button'
                className='mst-rr-btn'
                aria-label={label}
                title={label}
                aria-expanded={open}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setOpen((value) => !value);
                }}
            >
                <Marks status={status.status}/>
            </button>
            {open && btnRef.current ? <Popover status={status} anchor={btnRef.current}/> : null}
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
