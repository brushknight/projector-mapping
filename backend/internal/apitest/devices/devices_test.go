package devices

import (
	"net/http"
	"testing"

	"projmap/internal/apitest"
)

func TestInfo(t *testing.T) {
	h := apitest.New(t)
	m := h.Do("GET", "/api/v1/info", nil).Map(t)
	if m["name"] != "projmap" || m["port"] != float64(7400) || m["pairingRequired"] != false || m["hostname"] == "" {
		t.Fatalf("info %v", m)
	}
	if h.Remote("GET", "/api/v1/info", nil, "").Map(t)["pairingRequired"] != true {
		t.Fatal("a LAN client without a token needs pairing")
	}
}

func TestPairing(t *testing.T) {
	h := apitest.New(t)
	apitest.ExpectErr(t, h.Remote("GET", "/api/v1/pair/code", nil, ""), http.StatusForbidden, "forbidden")
	code := h.Do("GET", "/api/v1/pair/code", nil).Map(t)
	if len(code["code"].(string)) != 4 || code["expiresAt"] == nil {
		t.Fatalf("code %v", code)
	}
	if again := h.Do("GET", "/api/v1/pair/code", nil).Map(t); again["code"] != code["code"] {
		t.Fatal("the code stays until it expires")
	}
	apitest.ExpectErr(t, h.Remote("POST", "/api/v1/pair", map[string]any{"code": "ZZZZ", "name": "phone"}, ""), http.StatusUnauthorized, "unauthorized")
	apitest.ExpectErr(t, h.Remote("POST", "/api/v1/pair", map[string]any{}, ""), http.StatusBadRequest, "bad_request")
	apitest.ExpectErr(t, h.Remote("POST", "/api/v1/pair", map[string]any{"code": code["code"], "role": "agent"}, ""), http.StatusBadRequest, "bad_request")
	r := h.Remote("POST", "/api/v1/pair", map[string]any{"code": code["code"], "name": "Grisha's iPhone", "role": "remote"}, "")
	apitest.Expect(t, r, http.StatusOK)
	var pr struct {
		Token  string
		Device struct {
			ID, Name, Role string
		}
	}
	r.Into(t, &pr)
	if pr.Token == "" || pr.Device.Role != "remote" || pr.Device.Name != "Grisha's iPhone" {
		t.Fatalf("pair %s", r.Body)
	}
	// one code, one device
	apitest.ExpectErr(t, h.Remote("POST", "/api/v1/pair", map[string]any{"code": code["code"], "name": "x"}, ""), http.StatusUnauthorized, "unauthorized")
	// the token works from the LAN; no token does not
	apitest.Expect(t, h.Remote("GET", "/api/v1/scenes", nil, pr.Token), http.StatusOK)
	apitest.ExpectErr(t, h.Remote("GET", "/api/v1/scenes", nil, ""), http.StatusUnauthorized, "unauthorized")
	apitest.ExpectErr(t, h.Remote("GET", "/api/v1/scenes", nil, "tok_bad"), http.StatusUnauthorized, "unauthorized")
	// a remote cannot revoke; the editor can
	apitest.ExpectErr(t, h.Remote("DELETE", "/api/v1/devices/"+pr.Device.ID, nil, pr.Token), http.StatusForbidden, "forbidden")
	list := h.Do("GET", "/api/v1/devices", nil).List(t)
	if len(list) != 1 || list[0].(map[string]any)["online"] != false {
		t.Fatalf("devices %v", list)
	}
	apitest.Expect(t, h.Do("DELETE", "/api/v1/devices/"+pr.Device.ID, nil), http.StatusNoContent)
	apitest.ExpectErr(t, h.Do("DELETE", "/api/v1/devices/"+pr.Device.ID, nil), http.StatusNotFound, "not_found")
	apitest.ExpectErr(t, h.Remote("GET", "/api/v1/scenes", nil, pr.Token), http.StatusUnauthorized, "unauthorized")
}

func TestLoginLink(t *testing.T) {
	h := apitest.New(t)
	apitest.ExpectErr(t, h.Remote("POST", "/api/v1/login-links", nil, ""), http.StatusForbidden, "forbidden")
	l := h.Do("POST", "/api/v1/login-links", nil).Map(t)
	r := h.Remote("POST", "/api/v1/login", map[string]any{"code": l["code"], "name": "studio mac"}, "")
	apitest.Expect(t, r, http.StatusOK)
	tok := r.Map(t)["token"].(string)
	apitest.Expect(t, h.Remote("PATCH", "/api/v1/settings", map[string]any{"agentMayPreview": true}, tok), http.StatusOK)
	apitest.ExpectErr(t, h.Remote("POST", "/api/v1/login", map[string]any{"code": l["code"]}, ""), http.StatusUnauthorized, "unauthorized")
}
