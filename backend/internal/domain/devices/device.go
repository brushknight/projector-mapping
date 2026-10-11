// Package devices holds paired devices, their roles and tokens, pairing codes and presence.
package devices

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"time"
)

// Role of a client.
type Role string

const (
	RoleOutput Role = "output"
	RoleEditor Role = "editor"
	RoleRemote Role = "remote"
	RoleAgent  Role = "agent"
)

func (r Role) IsValid() bool {
	return r == RoleOutput || r == RoleEditor || r == RoleRemote || r == RoleAgent
}

// CanControl tells whether the role may change scenes and the show (editor, remote).
func (r Role) CanControl() bool { return r == RoleEditor || r == RoleRemote }

// Telemetry is what an output reports every 2 s.
type Telemetry struct {
	FPS     float64 `json:"fps"`
	Dropped int     `json:"dropped"`
	Width   int     `json:"width"`
	Height  int     `json:"height"`
	Refresh float64 `json:"refresh"`
}

// Device is a paired client.
type Device struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Role      Role       `json:"role"`
	LastSeen  time.Time  `json:"lastSeen"`
	Online    bool       `json:"online"`
	Telemetry *Telemetry `json:"telemetry,omitempty"`
	TokenHash string     `json:"-"`
	Local     bool       `json:"-"`
	// SessionID scopes an agent token to one agent session.
	SessionID string `json:"-"`
}

// NewToken is a random device token and its stored hash.
func NewToken() (plain, hash string) {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	plain = "tok_" + hex.EncodeToString(b)
	return plain, HashToken(plain)
}

// HashToken is how a token is stored.
func HashToken(t string) string {
	s := sha256.Sum256([]byte(t))
	return hex.EncodeToString(s[:])
}

// CodeAlphabet has no 0/O, 1/I/L.
const CodeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

// CodeTTL is how long a pairing code lives.
const CodeTTL = 5 * time.Minute

// PairCode is the 4-character code the output shows.
type PairCode struct {
	Code      string    `json:"code"`
	ExpiresAt time.Time `json:"expiresAt"`
}

// NewCode makes a fresh code.
func NewCode(now time.Time) PairCode {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	c := make([]byte, 4)
	for i := range b {
		c[i] = CodeAlphabet[int(b[i])%len(CodeAlphabet)]
	}
	return PairCode{Code: string(c), ExpiresAt: now.Add(CodeTTL)}
}
