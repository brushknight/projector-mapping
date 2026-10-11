package show

import (
	"encoding/json"

	"projmap/internal/apitest"
)

func jsonInto(m apitest.Msg, v any) error { return json.Unmarshal(m.D, v) }
