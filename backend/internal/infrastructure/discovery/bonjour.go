// Package discovery advertises the server over Bonjour as _projmap._tcp (protocol §4).
package discovery

import (
	"os"
	"strings"

	"github.com/grandcat/zeroconf"
)

// Advertise registers the service; call the returned stop on shutdown.
func Advertise(port int, serverID, version string) (func(), error) {
	host, _ := os.Hostname()
	host = strings.TrimSuffix(host, ".local")
	srv, err := zeroconf.Register("projmap on "+host, "_projmap._tcp", "local.", port,
		[]string{"name=" + host, "v=1", "id=" + serverID, "version=" + version}, nil)
	if err != nil {
		return func() {}, err
	}
	return srv.Shutdown, nil
}
