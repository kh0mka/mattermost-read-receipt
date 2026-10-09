package main

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"

	"github.com/mattermost/mattermost/server/public/plugin"
	_ "modernc.org/sqlite"
)

type receiptRow struct {
	PostID           string
	ChannelID        string
	AuthorID         string
	CreateAt         int64
	RequestedAt      int64
	RequestedBy      string
	Status           string
	States           map[string]recipientState
	PublicNoteAt     int64
	PublicNoteID     string
}

type receiptStore struct {
	api plugin.API
	mu  sync.Mutex
	db  *sql.DB
}

func newStore(api plugin.API) *receiptStore {
	return &receiptStore{api: api}
}

func (s *receiptStore) conn() (*sql.DB, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db != nil {
		return s.db, nil
	}
	dir := s.dataDir()
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", filepath.Join(dir, "read_receipts.db"))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(`
CREATE TABLE IF NOT EXISTS read_receipts (
  post_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  create_at INTEGER NOT NULL,
  requested_at INTEGER NOT NULL,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL,
  recipient_states TEXT NOT NULL,
  public_note_at INTEGER NOT NULL DEFAULT 0,
  public_note_id TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_read_receipts_status ON read_receipts(status);
`); err != nil {
		_ = db.Close()
		return nil, err
	}
	hasNoteID, err := columnExists(db, "read_receipts", "public_note_id")
	if err != nil {
		_ = db.Close()
		return nil, err
	}
	if !hasNoteID {
		if _, alterErr := db.Exec(`ALTER TABLE read_receipts ADD COLUMN public_note_id TEXT NOT NULL DEFAULT ''`); alterErr != nil {
			_ = db.Close()
			return nil, alterErr
		}
	}
	s.db = db
	return db, nil
}

func columnExists(db *sql.DB, table, column string) (bool, error) {
	rows, err := db.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var cid, notnull, pk int
		var name, ctype string
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return false, err
		}
		if name == column {
			return true, nil
		}
	}
	return false, rows.Err()
}

func (s *receiptStore) dataDir() string {
	bundle, appErr := s.api.GetBundlePath()
	if appErr != nil || bundle == "" {
		return "data"
	}
	dir := filepath.Join(filepath.Dir(bundle), "..", "data", pluginID)
	if abs, err := filepath.Abs(dir); err == nil {
		return abs
	}
	return dir
}

func (s *receiptStore) Insert(row receiptRow) error {
	db, err := s.conn()
	if err != nil {
		return err
	}
	raw, err := json.Marshal(row.States)
	if err != nil {
		return err
	}
	_, err = db.Exec(`
INSERT INTO read_receipts
  (post_id, channel_id, author_id, create_at, requested_at, requested_by, status, recipient_states, public_note_at, public_note_id)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(post_id) DO NOTHING`,
		row.PostID, row.ChannelID, row.AuthorID, row.CreateAt, row.RequestedAt, row.RequestedBy, row.Status, string(raw), row.PublicNoteAt, row.PublicNoteID)
	return err
}

func (s *receiptStore) Get(postID string) (*receiptRow, error) {
	db, err := s.conn()
	if err != nil {
		return nil, err
	}
	var row receiptRow
	var raw string
	err = db.QueryRow(`
SELECT post_id, channel_id, author_id, create_at, requested_at, requested_by, status, recipient_states, public_note_at, public_note_id
FROM read_receipts WHERE post_id = ?`, postID).Scan(
		&row.PostID, &row.ChannelID, &row.AuthorID, &row.CreateAt, &row.RequestedAt, &row.RequestedBy, &row.Status, &raw, &row.PublicNoteAt, &row.PublicNoteID)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	row.States = map[string]recipientState{}
	if raw != "" {
		_ = json.Unmarshal([]byte(raw), &row.States)
	}
	return &row, nil
}

func (s *receiptStore) ListOpen(limit int) ([]receiptRow, error) {
	db, err := s.conn()
	if err != nil {
		return nil, err
	}
	if limit < 1 {
		limit = 100
	}
	rows, err := db.Query(`
SELECT post_id, channel_id, author_id, create_at, requested_at, requested_by, status, recipient_states, public_note_at, public_note_id
FROM read_receipts
WHERE status != ? AND status != ?
ORDER BY create_at ASC
LIMIT ?`, statusRead, statusSkipped, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []receiptRow
	for rows.Next() {
		var row receiptRow
		var raw string
		if err := rows.Scan(&row.PostID, &row.ChannelID, &row.AuthorID, &row.CreateAt, &row.RequestedAt, &row.RequestedBy, &row.Status, &raw, &row.PublicNoteAt, &row.PublicNoteID); err != nil {
			return nil, err
		}
		row.States = map[string]recipientState{}
		if raw != "" {
			_ = json.Unmarshal([]byte(raw), &row.States)
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func (s *receiptStore) SaveState(postID, status string, states map[string]recipientState, publicNoteAt int64) error {
	db, err := s.conn()
	if err != nil {
		return err
	}
	raw, err := json.Marshal(states)
	if err != nil {
		return err
	}
	_, err = db.Exec(`UPDATE read_receipts SET status = ?, recipient_states = ?, public_note_at = ? WHERE post_id = ?`,
		status, string(raw), publicNoteAt, postID)
	return err
}

func (s *receiptStore) SaveNote(postID string, publicNoteAt int64, publicNoteID string) error {
	db, err := s.conn()
	if err != nil {
		return err
	}
	_, err = db.Exec(`UPDATE read_receipts SET public_note_at = ?, public_note_id = ? WHERE post_id = ?`,
		publicNoteAt, publicNoteID, postID)
	return err
}

func (s *receiptStore) ListRecent(limit int) ([]receiptRow, error) {
	db, err := s.conn()
	if err != nil {
		return nil, err
	}
	if limit < 1 {
		limit = noteBackfillLimit
	}
	rows, err := db.Query(`
SELECT post_id, channel_id, author_id, create_at, requested_at, requested_by, status, recipient_states, public_note_at, public_note_id
FROM read_receipts
WHERE status != ?
ORDER BY create_at DESC
LIMIT ?`, statusSkipped, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []receiptRow
	for rows.Next() {
		var row receiptRow
		var raw string
		if err := rows.Scan(&row.PostID, &row.ChannelID, &row.AuthorID, &row.CreateAt, &row.RequestedAt, &row.RequestedBy, &row.Status, &raw, &row.PublicNoteAt, &row.PublicNoteID); err != nil {
			return nil, err
		}
		row.States = map[string]recipientState{}
		if raw != "" {
			_ = json.Unmarshal([]byte(raw), &row.States)
		}
		out = append(out, row)
	}
	return out, rows.Err()
}
