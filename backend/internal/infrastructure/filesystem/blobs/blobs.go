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

func (s *Store) PutFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	_, err = io.Copy(h, f)
	f.Close()
	if err != nil {
		return "", err
	}
	sha := hex.EncodeToString(h.Sum(nil))
	p := s.Path(sha)
	if _, err := os.Stat(p); err == nil {
		_ = os.Remove(path)
		return sha, nil
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return "", err
	}
	if err := os.Rename(path, p); err != nil {
		// another volume: copy
		if err := copyFile(path, p+".tmp"); err != nil {
			return "", err
		}
		_ = os.Remove(path)
		return sha, os.Rename(p+".tmp", p)
	}
	return sha, nil
}

func copyFile(from, to string) error {
	in, err := os.Open(from)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(to)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

func (s *Store) Remove(sha string) error {
	if !valid(sha) {
		return fmt.Errorf("bad sha")
	}
	if err := os.Remove(s.Path(sha)); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
