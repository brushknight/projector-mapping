// Package devices holds the devices section's service interface: pairing, tokens, roles and presence.
package devices

import (
	"context"

	"projmap/internal/domain/devices"
)

// DeviceService pairs and authenticates devices.
type DeviceService interface {
	// PairCode is the current code (a new one when the last expired).
	PairCode(ctx context.Context) devices.PairCode
	// Pair exchanges a code for a device token; the code then rotates.
	Pair(ctx context.Context, code, name string, role devices.Role) (string, *devices.Device, error)
	// LoginLink makes a one-time editor login code (projmap open).
	LoginLink(ctx context.Context) devices.PairCode
	// Login exchanges a login code for an editor token.
	Login(ctx context.Context, code, name string) (string, *devices.Device, error)
	Authenticate(ctx context.Context, token string) (*devices.Device, error)
	// Local is the trusted device of a localhost client (created on first use).
	Local(ctx context.Context, name string, role devices.Role) (*devices.Device, error)
	// AgentToken issues a token scoped to an agent session.
	AgentToken(ctx context.Context, sessionID, name string) (string, *devices.Device, error)
	List(ctx context.Context) ([]devices.Device, error)
	Get(ctx context.Context, id string) (*devices.Device, error)
	Touch(ctx context.Context, id string)
	Revoke(ctx context.Context, id string) error
	// Broadcast publishes the device list on the devices channel.
	Broadcast(ctx context.Context)
}
