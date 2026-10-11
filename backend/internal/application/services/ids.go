// Package services holds what the section services share: id generation.
package services

import (
	"crypto/rand"
	"encoding/hex"
)

// NewID is prefix + "_" + 8 random hex characters (scn_1a2b3c4d).
func NewID(prefix string) string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return prefix + "_" + hex.EncodeToString(b)
}
