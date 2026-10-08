package main

import (
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
)

func TestShouldTrackDefaultsOff(t *testing.T) {
	cfg := &configuration{Enabled: true}
	if shouldTrack(cfg, model.ChannelTypeDirect) || shouldTrack(cfg, model.ChannelTypeGroup) {
		t.Fatal("automatic receipts stay off until an admin enables them")
	}
	if shouldTrack(cfg, model.ChannelTypeOpen) || shouldTrack(cfg, model.ChannelTypePrivate) {
		t.Fatal("channel receipts stay off until an admin enables them")
	}
}

func TestShouldTrackDMAndGMFlagsAreSeparate(t *testing.T) {
	cfg := &configuration{Enabled: true, AutoReceiptForAllowedSendersInDM: true}
	if !shouldTrack(cfg, model.ChannelTypeDirect) {
		t.Fatal("expected DM tracking")
	}
	if shouldTrack(cfg, model.ChannelTypeGroup) {
		t.Fatal("GM tracking is a separate switch")
	}
	cfg.AutoReceiptIncludeGM = true
	if !shouldTrack(cfg, model.ChannelTypeGroup) {
		t.Fatal("expected GM tracking")
	}
	cfg.Enabled = false
	if shouldTrack(cfg, model.ChannelTypeDirect) {
		t.Fatal("master switch off")
	}
}

func TestShouldTrackChannelFlagIsSeparate(t *testing.T) {
	cfg := &configuration{Enabled: true, AutoReceiptIncludeGM: true}
	if shouldTrack(cfg, model.ChannelTypeOpen) || shouldTrack(cfg, model.ChannelTypePrivate) {
		t.Fatal("group messages do not turn on channels")
	}
	cfg.AutoReceiptIncludeChannel = true
	if !shouldTrack(cfg, model.ChannelTypeOpen) || !shouldTrack(cfg, model.ChannelTypePrivate) {
		t.Fatal("expected public and private channel tracking")
	}
	if shouldTrack(cfg, model.ChannelTypeDirect) {
		t.Fatal("channel switch does not turn on direct messages")
	}
}
