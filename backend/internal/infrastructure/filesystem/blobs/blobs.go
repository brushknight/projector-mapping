// Package blobs stores asset bytes content-addressed under <data>/assets/ab/cd/<sha256>.
package blobs

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"

	assetrepo "projmap/internal/application/ports/repository/assets"
)

// Store is a folder of blobs.
type Store struct{ root string }

var _ assetrepo.Blobs = (*Store)(nil)

// New makes a store under root.
func New(root string) *Store { return &Store{root: root} }

func valid(sha string) bool {
	if len(sha) != 64 {
		return false
	}
	_, err := hex.DecodeString(sha)
	return err == nil
}

func (s *Store) Path(sha string) string {
	if !valid(sha) {
		return ""
	}
	return filepath.Join(s.root, sha[:2], sha[2:4], sha)
}

func (s *Store) Put(b []byte) (string, error) {
	sum := sha256.Sum256(b)
	sha := hex.EncodeToString(sum[:])
	p := s.Path(sha)
	if _, err := os.Stat(p); err == nil {
		return sha, nil
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return "", err
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return "", err
	}
	return sha, os.Rename(tmp, p)
}

func (s *Store) Open(sha string) (io.ReadSeekCloser, error) {
	if !valid(sha) {
		return nil, fmt.Errorf("bad sha")
	}
	return os.Open(s.Path(sha))
}

func (s *Store) Read(sha string) ([]byte, error) {
	if !valid(sha) {
		return nil, fmt.Errorf("bad sha")
	}
	return os.ReadFile(s.Path(sha))
}
