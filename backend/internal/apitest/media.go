package apitest

import (
	"bytes"
	"encoding/binary"
	"math"
	"os"
	"path/filepath"
	"testing"
)

// WAV is a 16-bit PCM WAV of a 440 Hz tone at amplitude 0.8.
func WAV(rate, channels int, seconds float64) []byte {
	frames := int(float64(rate) * seconds)
	var data bytes.Buffer
	for i := 0; i < frames; i++ {
		v := int16(0.8 * 32767 * math.Sin(2*math.Pi*440*float64(i)/float64(rate)))
		for c := 0; c < channels; c++ {
			_ = binary.Write(&data, binary.LittleEndian, v)
		}
	}
	var b bytes.Buffer
	b.WriteString("RIFF")
	_ = binary.Write(&b, binary.LittleEndian, uint32(36+data.Len()))
	b.WriteString("WAVEfmt ")
	for _, v := range []any{uint32(16), uint16(1), uint16(channels), uint32(rate), uint32(rate * channels * 2), uint16(channels * 2), uint16(16)} {
		_ = binary.Write(&b, binary.LittleEndian, v)
	}
	b.WriteString("data")
	_ = binary.Write(&b, binary.LittleEndian, uint32(data.Len()))
	b.Write(data.Bytes())
	return b.Bytes()
}

// ToolsPath makes a folder with the given executable scripts (name → body) and sets PATH to it plus /usr/bin and /bin,
// so the server finds exactly these media tools.
func ToolsPath(t *testing.T, scripts map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for name, body := range scripts {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", dir+":/usr/bin:/bin")
	return dir
}
