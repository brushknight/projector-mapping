// Package show is the storage port of the live state and the server settings (a key/value table).
package show

import "context"

// KV stores small JSON values by key (show state, settings, server id).
type KV interface {
	// Get returns nil, nil when the key is not set.
	Get(ctx context.Context, key string) ([]byte, error)
	Put(ctx context.Context, key string, value []byte) error
}
