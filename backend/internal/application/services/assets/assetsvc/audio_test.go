package assetsvc

import (
	"bytes"
	"encoding/binary"
	"math"
	"testing"
)

// WAV builds a 16-bit PCM WAV of a sine whose amplitude ramps from 0 to 1 over the file.
func WAV(rate, channels int, seconds float64) []byte {
	frames := int(float64(rate) * seconds)
	var data bytes.Buffer
	for i := 0; i < frames; i++ {
		amp := float64(i) / float64(frames)
		v := int16(amp * 32767 * math.Sin(2*math.Pi*440*float64(i)/float64(rate)))
		for c := 0; c < channels; c++ {
			_ = binary.Write(&data, binary.LittleEndian, v)
		}
	}
	var b bytes.Buffer
	b.WriteString("RIFF")
	_ = binary.Write(&b, binary.LittleEndian, uint32(36+data.Len()))
	b.WriteString("WAVEfmt ")
	_ = binary.Write(&b, binary.LittleEndian, uint32(16))
	_ = binary.Write(&b, binary.LittleEndian, uint16(1))
	_ = binary.Write(&b, binary.LittleEndian, uint16(channels))
	_ = binary.Write(&b, binary.LittleEndian, uint32(rate))
	_ = binary.Write(&b, binary.LittleEndian, uint32(rate*channels*2))
	_ = binary.Write(&b, binary.LittleEndian, uint16(channels*2))
	_ = binary.Write(&b, binary.LittleEndian, uint16(16))
	b.WriteString("data")
	_ = binary.Write(&b, binary.LittleEndian, uint32(data.Len()))
	b.Write(data.Bytes())
	return b.Bytes()
}

// aiff builds a 16-bit big-endian AIFF of constant amplitude 0.5.
func aiff(rate, frames int) []byte {
	var data bytes.Buffer
	for i := 0; i < frames; i++ {
		v := int16(16384)
		if i%2 == 1 {
			v = -16384
		}
		_ = binary.Write(&data, binary.BigEndian, v)
	}
	var comm bytes.Buffer
	_ = binary.Write(&comm, binary.BigEndian, uint16(1))
	_ = binary.Write(&comm, binary.BigEndian, uint32(frames))
	_ = binary.Write(&comm, binary.BigEndian, uint16(16))
	comm.Write(ext80(float64(rate)))
	var b bytes.Buffer
	b.WriteString("FORM")
	_ = binary.Write(&b, binary.BigEndian, uint32(4+8+comm.Len()+8+8+data.Len()))
	b.WriteString("AIFFCOMM")
	_ = binary.Write(&b, binary.BigEndian, uint32(comm.Len()))
	b.Write(comm.Bytes())
	b.WriteString("SSND")
	_ = binary.Write(&b, binary.BigEndian, uint32(8+data.Len()))
	_ = binary.Write(&b, binary.BigEndian, uint32(0))
	_ = binary.Write(&b, binary.BigEndian, uint32(0))
	b.Write(data.Bytes())
	return b.Bytes()
}

func ext80(f float64) []byte {
	exp := int(math.Floor(math.Log2(f)))
	mant := uint64(f / math.Pow(2, float64(exp-63)))
	b := make([]byte, 10)
	binary.BigEndian.PutUint16(b, uint16(exp+16383))
	binary.BigEndian.PutUint64(b[2:], mant)
	return b
}

func TestWAV(t *testing.T) {
	d, peaks, err := ReadWAV(WAV(8000, 2, 2.5), 128)
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(d-2.5) > 1e-6 || len(peaks) != 128 {
		t.Fatalf("duration %v, %d peaks", d, len(peaks))
	}
	if peaks[0] > 0.02 || peaks[127] < 0.95 || peaks[64] < 0.45 || peaks[64] > 0.55 {
		t.Fatalf("peaks do not ramp: %v %v %v", peaks[0], peaks[64], peaks[127])
	}
	for i := 1; i < len(peaks); i++ {
		if peaks[i]+0.02 < peaks[i-1] {
			t.Fatalf("peak %d falls: %v → %v", i, peaks[i-1], peaks[i])
		}
	}
	if _, _, err := ReadWAV([]byte("RIFF0000WAVEjunk"), 128); err == nil {
		t.Fatal("a WAV without fmt and data reads")
	}
}

func TestAIFF(t *testing.T) {
	d, peaks, err := ReadAIFF(aiff(22050, 22050*3), 128)
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(d-3) > 1e-6 || len(peaks) != 128 || peaks[10] != 0.5 {
		t.Fatalf("duration %v, peaks %v", d, peaks[:4])
	}
	if math.Abs(extended(ext80(44100))-44100) > 1e-9 {
		t.Fatal("80-bit float")
	}
}

func TestPeaksShortAndSniff(t *testing.T) {
	if p := PeaksOf([]float32{0.1, -0.9, 0.3}, 128); len(p) != 3 || p[1] != 0.9 {
		t.Fatalf("short peaks %v", p)
	}
	if p := PeaksOf(nil, 128); len(p) != 0 {
		t.Fatal("no samples, no peaks")
	}
	cases := map[string]struct {
		b    []byte
		name string
	}{
		MimeWAV:  {WAV(8000, 1, 0.01), "a.wav"},
		MimeAIFF: {aiff(8000, 10), "a.aiff"},
		MimeOGG:  {[]byte("OggS\x00\x02rest"), "a.ogg"},
		MimeMP3:  {[]byte("ID3\x04\x00rest"), "a.mp3"},
		MimeM4A:  {[]byte("\x00\x00\x00\x20ftypM4A \x00\x00"), "a.m4a"},
	}
	for want, c := range cases {
		if got := SniffSound(c.b, c.name); got != want {
			t.Errorf("%s sniffs as %q", want, got)
		}
	}
	if SniffSound([]byte("\x00\x00\x00\x20ftypisom\x00\x00"), "clip.mp4") != "" {
		t.Error("an mp4 video is not a sound")
	}
	if SniffSound([]byte("\x89PNG\r\n\x1a\n"), "x.wav") != "" || SniffSound([]byte("hello"), "x.mp3") != "" {
		t.Error("non-audio sniffs as audio")
	}
	if SniffSound([]byte{0xFF, 0xFB, 0x90, 0x00}, "beat.mp3") != MimeMP3 {
		t.Error("a bare MPEG frame is MP3")
	}
}
