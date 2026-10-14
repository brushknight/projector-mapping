// Package realtime holds the ports the services use to reach connected clients: publishing on channels and calling
// clients (server → client RPC). The WebSocket hub implements them.
package realtime

import (
	"context"
	"encoding/json"
)

// Message is one WebSocket frame (protocol §3).
type Message struct {
	T    string          `json:"t"`
	Ch   string          `json:"ch,omitempty"`
	ID   string          `json:"id,omitempty"`
	Re   string          `json:"re,omitempty"`
	V    *int64          `json:"v,omitempty"`
	Base *int64          `json:"base,omitempty"`
	D    json.RawMessage `json:"d,omitempty"`
}

// Ver is a pointer to v.
func Ver(v int64) *int64 { return &v }

// Data marshals v for Message.D.
func Data(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}

// Publisher fans messages out to channel subscribers.
type Publisher interface {
	// Publish sends m to every subscriber of ch.
	Publish(ch string, m Message)
	// PublishExcept sends m to every subscriber of ch but the connection exceptConn.
	PublishExcept(ch string, m Message, exceptConn string)
}

// Target picks the client an RPC goes to.
type Target struct {
	// Role, when set, limits to clients of that role.
	Role string
	// Cap, when set, limits to clients announcing that capability.
	Cap string
	// DeviceID, when set, picks that device.
	DeviceID string
}

// Caller sends server → client requests.
type Caller interface {
	// Call sends rpc{method,args} to the newest matching client and waits for rpc.result (or rpc.error, or ctx).
	Call(ctx context.Context, to Target, method string, args any) (json.RawMessage, error)
	// Has tells whether a matching client is connected.
	Has(to Target) bool
}

// Nop publishes nowhere (tests, CLI).
type Nop struct{}

func (Nop) Publish(string, Message)               {}
func (Nop) PublishExcept(string, Message, string) {}

// Presence tells which devices are connected (the hub implements it).
type Presence interface {
	Online(deviceID string) bool
	// Telemetry is the output's last report, nil when none.
	Telemetry(deviceID string) any
	// Kick closes a device's connections (after a revoke).
	Kick(deviceID string)
}

// Direct sends messages that belong to no channel (sound.play, sound.stop) to chosen connections.
type Direct interface {
	// SendDirect queues m (ordered) on every connection matching to (role and cap; DeviceID is ignored) and says how
	// many got it.
	SendDirect(to Target, m Message) int
}
