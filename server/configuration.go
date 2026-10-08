package main

import (
	"fmt"
	"reflect"
	"strings"

	"github.com/mattermost/mattermost/server/public/model"
)

type configuration struct {
	Enabled                          bool
	AllowedRoles                     string
	AllowedUserIDs                   string
	PollIntervalSeconds              float64
	AutoReceiptForAllowedSendersInDM bool
	AutoReceiptIncludeGM             bool
	AutoReceiptIncludeChannel        bool
	PostPublicReceiptOnRead          bool
}

func (p *ReadReceiptPlugin) getConfiguration() *configuration {
	p.configurationLock.RLock()
	defer p.configurationLock.RUnlock()
	if p.configuration == nil {
		return &configuration{
			Enabled:             true,
			AllowedRoles:        "system_admin",
			PollIntervalSeconds: 20,
		}
	}
	return p.configuration
}

func (p *ReadReceiptPlugin) setConfiguration(c *configuration) {
	p.configurationLock.Lock()
	defer p.configurationLock.Unlock()
	if c != nil && p.configuration == nil {
		p.configuration = c
		return
	}
	if c == nil || (p.configuration != nil && reflect.DeepEqual(p.configuration, c)) {
		return
	}
	p.configuration = c
}

func (p *ReadReceiptPlugin) OnConfigurationChange() error {
	var cfg configuration
	if err := p.API.LoadPluginConfiguration(&cfg); err != nil {
		return fmt.Errorf("load plugin configuration: %w", err)
	}
	if strings.TrimSpace(cfg.AllowedRoles) == "" && strings.TrimSpace(cfg.AllowedUserIDs) == "" {
		cfg.AllowedRoles = "system_admin"
	}
	if cfg.PollIntervalSeconds < 5 {
		cfg.PollIntervalSeconds = 20
	}
	p.setConfiguration(&cfg)
	return nil
}

func shouldTrack(cfg *configuration, channelType model.ChannelType) bool {
	if cfg == nil || !cfg.Enabled {
		return false
	}
	switch channelType {
	case model.ChannelTypeDirect:
		return cfg.AutoReceiptForAllowedSendersInDM
	case model.ChannelTypeGroup:
		return cfg.AutoReceiptIncludeGM
	case model.ChannelTypeOpen, model.ChannelTypePrivate:
		return cfg.AutoReceiptIncludeChannel
	default:
		return false
	}
}

func (p *ReadReceiptPlugin) pollInterval() int {
	n := int(p.getConfiguration().PollIntervalSeconds)
	if n < 5 {
		return 20
	}
	return n
}

func splitCSV(raw string) []string {
	var out []string
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func (p *ReadReceiptPlugin) userAllowed(userID string) bool {
	if userID == "" {
		return false
	}
	cfg := p.getConfiguration()
	for _, id := range splitCSV(cfg.AllowedUserIDs) {
		if id == userID {
			return true
		}
	}
	allowedRoles := splitCSV(cfg.AllowedRoles)
	if len(allowedRoles) == 0 {
		return false
	}
	user, appErr := p.API.GetUser(userID)
	if appErr != nil || user == nil {
		return false
	}
	have := map[string]bool{}
	for _, role := range strings.Fields(user.Roles) {
		have[role] = true
	}
	for _, role := range allowedRoles {
		if have[role] {
			return true
		}
	}
	return false
}
