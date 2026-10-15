package services

import (
	"encoding/json"
	"sync"
	"time"
)

// ParamDelay is how long after the last param on a path the server commits it (protocol §3).
const ParamDelay = 200 * time.Millisecond

// Coalescer collects continuous values per key and calls flush once a key has been quiet for the delay.
type Coalescer struct {
	delay time.Duration
	flush func(key string, value json.RawMessage, by string)

	mu sync.Mutex
	m  map[string]*pending
}

type pending struct {
	value json.RawMessage
	by    string
	timer *time.Timer
}

// NewCoalescer makes a coalescer.
func NewCoalescer(delay time.Duration, flush func(key string, value json.RawMessage, by string)) *Coalescer {
	return &Coalescer{delay: delay, flush: flush, m: map[string]*pending{}}
}

// Put records the latest value for key and restarts its quiet timer.
func (c *Coalescer) Put(key string, value json.RawMessage, by string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	p, ok := c.m[key]
	if !ok {
		p = &pending{}
		c.m[key] = p
	}
	p.value, p.by = value, by
	if p.timer != nil {
		p.timer.Stop()
	}
	p.timer = time.AfterFunc(c.delay, func() { c.fire(key, p) })
}

func (c *Coalescer) fire(key string, p *pending) {
	c.mu.Lock()
	if c.m[key] != p {
		c.mu.Unlock()
		return
	}
	delete(c.m, key)
	v, by := p.value, p.by
	c.mu.Unlock()
	c.flush(key, v, by)
}

// Pending returns the uncommitted values (path → value).
func (c *Coalescer) Pending() map[string]json.RawMessage {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make(map[string]json.RawMessage, len(c.m))
	for k, p := range c.m {
		out[k] = p.value
	}
	return out
}

// FlushAll commits every pending value now.
func (c *Coalescer) FlushAll() {
	c.mu.Lock()
	all := c.m
	c.m = map[string]*pending{}
	c.mu.Unlock()
	for k, p := range all {
		p.timer.Stop()
		c.flush(k, p.value, p.by)
	}
}

// Taken is one value Take removed.
type Taken struct {
	Value json.RawMessage
	By    string
}

// Take removes every pending value without calling flush and returns them (path → value), so the caller can commit
// them itself (before a structural patch that could shift the indexes they address).
func (c *Coalescer) Take() map[string]Taken {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.m) == 0 {
		return nil
	}
	out := make(map[string]Taken, len(c.m))
	for k, p := range c.m {
		p.timer.Stop()
		out[k] = Taken{Value: p.value, By: p.by}
	}
	c.m = map[string]*pending{}
	return out
}
