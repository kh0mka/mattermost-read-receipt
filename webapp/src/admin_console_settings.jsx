// Localized System Console settings for the read-receipt plugin.
//
// The console renders settings_schema strings (display_name, help_text)
// verbatim, so each setting below is drawn by its own component, exactly the
// pattern the official plugins use: the schema entry keeps the value type
// and default, its rendering is replaced with registerAdminConsoleCustomSetting,
// and the labels come through react-intl. The component renders the full row
// (showTitle: false), mirroring the console layout: col-sm-4 label, col-sm-8
// control, form-help under the control.

import React from 'react';
import {useIntl} from 'react-intl';

import {MSG_PREFIX as M} from './i18n';

const LEFT = 'col-sm-4';
const RIGHT = 'col-sm-8';

function Row({label, help, children}) {
    return (
        <div className='form-group'>
            <label className={'control-label ' + LEFT} style={{paddingTop: '8px'}}>{label}</label>
            <div className={RIGHT}>
                {children}
                {help ? <div className='form-help'>{help}</div> : null}
            </div>
        </div>
    );
}

// The schema has no translatable banner of its own, so the page header and
// footer notes are rendered by the first and the last setting.
function Banner({text}) {
    return (
        <div className='banner'>
            <div className='form-help' style={{margin: 0}}>{text}</div>
        </div>
    );
}

function makeSetting({id, labelKey, labelDefault, helpKey, helpDefault, banner}) {
    return function Setting(props) {
        const {formatMessage} = useIntl();
        const label = formatMessage({id: labelKey, defaultMessage: labelDefault});
        const help = formatMessage({id: helpKey, defaultMessage: helpDefault});
        const value = props.value;
        const disabled = props.disabled;

        let control;
        if (id === 'AllowedRoles' || id === 'AllowedUserIDs') {
            control = (
                <input
                    id={id}
                    type='text'
                    className='form-control'
                    value={typeof value === 'string' ? value : ''}
                    disabled={disabled}
                    placeholder={id === 'AllowedRoles' ? 'system_admin' : ''}
                    onChange={(event) => props.onChange(props.id, event.target.value)}
                />
            );
        } else if (id === 'PollIntervalSeconds') {
            const numeric = typeof value === 'number' ? value : '';
            control = (
                <input
                    id={id}
                    type='number'
                    className='form-control'
                    min={5}
                    value={numeric}
                    disabled={disabled}
                    onChange={(event) => {
                        const next = Number(event.target.value);
                        if (event.target.value !== '' && Number.isFinite(next)) {
                            props.onChange(props.id, next);
                        }
                    }}
                />
            );
        } else {
            control = (
                <input
                    id={id}
                    type='checkbox'
                    className='margins'
                    checked={Boolean(value)}
                    disabled={disabled}
                    onChange={(event) => props.onChange(props.id, event.target.checked)}
                />
            );
        }

        return (
            <React.Fragment>
                {banner === 'header' ? <Banner text={formatMessage({id: M + 'console.header', defaultMessage: 'Status is shown only for allowed senders, and only after the matching auto-receipt switch is on. Defaults stay off until an admin starts the pilot.'})}/> : null}
                <Row label={label} help={help}>
                    {control}
                </Row>
                {banner === 'footer' ? <Banner text={formatMessage({id: M + 'console.footer', defaultMessage: "Seen means the recipient's channel view time is at or after the message. It is not proof they read the specific text. Public and private channels with more than 50 other members are not tracked."})}/> : null}
            </React.Fragment>
        );
    };
}

export const EnabledSetting = makeSetting({
    id: 'Enabled',
    labelKey: M + 'console.enabled',
    labelDefault: 'Enabled',
    helpKey: M + 'console.enabled.help',
    helpDefault: 'Master switch. When off, no new receipts are tracked.',
    banner: 'header',
});

export const AllowedRolesSetting = makeSetting({
    id: 'AllowedRoles',
    labelKey: M + 'console.allowedRoles',
    labelDefault: 'Allowed roles',
    helpKey: M + 'console.allowedRoles.help',
    helpDefault: 'Comma-separated role names. A sender needs one of these roles, or an ID in Allowed user IDs.',
});

export const AllowedUserIDsSetting = makeSetting({
    id: 'AllowedUserIDs',
    labelKey: M + 'console.allowedUserIDs',
    labelDefault: 'Allowed user IDs',
    helpKey: M + 'console.allowedUserIDs.help',
    helpDefault: 'Comma-separated Mattermost user IDs (for HR people who do not have a dedicated role).',
});

export const PollIntervalSetting = makeSetting({
    id: 'PollIntervalSeconds',
    labelKey: M + 'console.pollInterval',
    labelDefault: 'Poll interval (seconds)',
    helpKey: M + 'console.pollInterval.help',
    helpDefault: 'How often the server checks whether recipients have opened the conversation. Minimum 5.',
});

export const AutoDMSetting = makeSetting({
    id: 'AutoReceiptForAllowedSendersInDM',
    labelKey: M + 'console.autoDM',
    labelDefault: 'Automatic status in direct messages',
    helpKey: M + 'console.autoDM.help',
    helpDefault: 'When on, every new direct message from an allowed sender gets sent/delivered/seen status.',
});

export const AutoGMSetting = makeSetting({
    id: 'AutoReceiptIncludeGM',
    labelKey: M + 'console.autoGM',
    labelDefault: 'Automatic status in group messages',
    helpKey: M + 'console.autoGM.help',
    helpDefault: 'When on, group messages from allowed senders are tracked too. Direct messages and channels are controlled separately.',
});

export const AutoChannelSetting = makeSetting({
    id: 'AutoReceiptIncludeChannel',
    labelKey: M + 'console.autoChannel',
    labelDefault: 'Automatic status in channels',
    helpKey: M + 'console.autoChannel.help',
    helpDefault: 'When on, posts from allowed senders in public and private channels are tracked. Channels with more than 50 other members are skipped. Direct messages and group messages are controlled separately.',
});

export const ThreadNoteSetting = makeSetting({
    id: 'PostPublicReceiptOnRead',
    labelKey: M + 'console.threadNote',
    labelDefault: 'Thread note',
    helpKey: M + 'console.threadNote.help',
    helpDefault: 'Off. The plugin does not post or update a thread reply. Status is the tick on web. Existing replies are left in place.',
    banner: 'footer',
});
