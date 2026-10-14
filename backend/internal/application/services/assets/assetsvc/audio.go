package assetsvc

import (
	"encoding/binary"
	"errors"
	"math"
	"path/filepath"
	"strings"
)

// Sound mime types (protocol §14: WAV, MP3, M4A, AIFF, OGG).
const (
	MimeWAV  = "audio/wav"
	MimeMP3  = "audio/mpeg"
	MimeM4A  = "audio/mp4"
	MimeAIFF = "audio/aiff"
	MimeOGG  = "audio/ogg"
)

// SniffSound returns the mime type of an accepted sound file, from its first bytes and its file name's extension, or
// "" when it is not one.
func SniffSound(b []byte, fileName string) string {
	ext := strings.ToLower(filepath.Ext(fileName))
	switch {
	case len(b) >= 12 && string(b[:4]) == "RIFF" && string(b[8:12]) == "WAVE":
		return MimeWAV
	case len(b) >= 12 && string(b[:4]) == "FORM" && (string(b[8:12]) == "AIFF" || string(b[8:12]) == "AIFC"):
		return MimeAIFF
	case len(b) >= 4 && string(b[:4]) == "OggS":
		return MimeOGG
	case len(b) >= 3 && string(b[:3]) == "ID3":
		if ext == ".m4a" || ext == ".aac" {
			return "" // an ID3 tag in front of raw AAC: not one of the accepted containers
		}
		return MimeMP3
	case len(b) >= 12 && string(b[4:8]) == "ftyp":
		brand := string(b[8:12])
		if brand == "M4A " || brand == "M4B " || brand == "M4P " || ext == ".m4a" {
			return MimeM4A
		}
	case len(b) >= 2 && b[0] == 0xFF && b[1]&0xE0 == 0xE0 && b[1]&0x06 != 0 && ext != ".aac":
		// an MPEG audio frame sync with a layer set (ADTS AAC has layer 0)
		return MimeMP3
	}
	return ""
}

// errAudio is a file the pure-Go readers cannot read.
var errAudio = errors.New("unsupported audio encoding")

// pcm is decoded audio: frames of channels, read sample by sample.
type pcm struct {
	frames   int
	channels int
	rate     float64
	// sample returns the sample of channel ch in frame i, -1..1.
	sample func(i, ch int) float64
}

func (p pcm) duration() float64 {
	if p.rate <= 0 {
		return 0
	}
	return float64(p.frames) / p.rate
}

// Peaks is the largest absolute sample per equal slice of the frames, n slices (fewer frames than n give fewer).
func (p pcm) peaks(n int) []float64 {
	out := make([]float64, 0, n)
	if p.frames == 0 {
		return out
	}
	if p.frames < n {
		n = p.frames
	}
	for k := 0; k < n; k++ {
		from, to := k*p.frames/n, (k+1)*p.frames/n
		m := 0.0
		for i := from; i < to; i++ {
			for ch := 0; ch < p.channels; ch++ {
				if v := math.Abs(p.sample(i, ch)); v > m {
					m = v
				}
			}
		}
		out = append(out, round3(math.Min(m, 1)))
	}
	return out
}

// PeaksOf is the peaks of mono samples.
func PeaksOf(samples []float32, n int) []float64 {
	return pcm{frames: len(samples), channels: 1, rate: 1, sample: func(i, _ int) float64 { return float64(samples[i]) }}.peaks(n)
}

func round3(v float64) float64 { return math.Round(v*1000) / 1000 }

// ReadWAV reads a RIFF WAVE file's duration and peaks: PCM 8/16/24/32 bit and IEEE float 32/64, plain or extensible.
func ReadWAV(b []byte, n int) (float64, []float64, error) {
	p, err := decodeWAV(b)
	if err != nil {
		return 0, nil, err
	}
	return p.duration(), p.peaks(n), nil
}

func decodeWAV(b []byte) (pcm, error) {
	if len(b) < 12 || string(b[:4]) != "RIFF" || string(b[8:12]) != "WAVE" {
		return pcm{}, errAudio
	}
	var format, channels, bits int
	var rate float64
	var data []byte
	haveFmt := false
	for off := 12; off+8 <= len(b); {
		id := string(b[off : off+4])
		size := int(binary.LittleEndian.Uint32(b[off+4 : off+8]))
		body := b[off+8:]
		if size > len(body) {
			size = len(body) // a truncated or streamed file: take what is there
		}
		body = body[:size]
		switch id {
		case "fmt ":
			if size < 16 {
				return pcm{}, errAudio
			}
			format = int(binary.LittleEndian.Uint16(body[0:2]))
			channels = int(binary.LittleEndian.Uint16(body[2:4]))
			rate = float64(binary.LittleEndian.Uint32(body[4:8]))
			bits = int(binary.LittleEndian.Uint16(body[14:16]))
			if format == 0xFFFE && size >= 26 {
				format = int(binary.LittleEndian.Uint16(body[24:26])) // the sub-format GUID starts with the format code
			}
			haveFmt = true
		case "data":
			data = body
		}
		off += 8 + size + size%2
	}
	if !haveFmt || data == nil || channels < 1 || rate <= 0 {
		return pcm{}, errAudio
	}
	return framesOf(data, format == 3, bits, channels, rate, binary.LittleEndian)
}

// framesOf wraps interleaved samples; float says IEEE float, otherwise signed PCM (8 bit WAV is unsigned).
func framesOf(data []byte, float bool, bits, channels int, rate float64, order binary.ByteOrder) (pcm, error) {
	bytesPer := bits / 8
	if bits%8 != 0 || bytesPer < 1 || bytesPer > 8 {
		return pcm{}, errAudio
	}
	block := bytesPer * channels
	frames := len(data) / block
	var sample func(i, ch int) float64
	at := func(i, ch int) []byte { o := i*block + ch*bytesPer; return data[o : o+bytesPer] }
	switch {
	case float && bits == 32:
		sample = func(i, ch int) float64 { return float64(math.Float32frombits(order.Uint32(at(i, ch)))) }
	case float && bits == 64:
		sample = func(i, ch int) float64 { return math.Float64frombits(order.Uint64(at(i, ch))) }
	case float:
		return pcm{}, errAudio
	case bits == 8 && order == binary.ByteOrder(binary.LittleEndian):
		sample = func(i, ch int) float64 { return (float64(at(i, ch)[0]) - 128) / 128 }
	case bits == 8:
		sample = func(i, ch int) float64 { return float64(int8(at(i, ch)[0])) / 128 }
	case bits == 16:
		sample = func(i, ch int) float64 { return float64(int16(order.Uint16(at(i, ch)))) / 32768 }
	case bits == 24:
		sample = func(i, ch int) float64 {
			s := at(i, ch)
			var v int32
			if order == binary.ByteOrder(binary.LittleEndian) {
				v = int32(s[0]) | int32(s[1])<<8 | int32(int8(s[2]))<<16
			} else {
				v = int32(int8(s[0]))<<16 | int32(s[1])<<8 | int32(s[2])
			}
			return float64(v) / 8388608
		}
	case bits == 32:
		sample = func(i, ch int) float64 { return float64(int32(order.Uint32(at(i, ch)))) / 2147483648 }
	default:
		return pcm{}, errAudio
	}
	return pcm{frames: frames, channels: channels, rate: rate, sample: sample}, nil
}

// ReadAIFF reads an AIFF or AIFF-C file's duration and peaks: big-endian PCM ("NONE"), little-endian PCM ("sowt")
// and 32/64-bit float ("fl32", "fl64").
func ReadAIFF(b []byte, n int) (float64, []float64, error) {
	p, err := decodeAIFF(b)
	if err != nil {
		return 0, nil, err
	}
	return p.duration(), p.peaks(n), nil
}

func decodeAIFF(b []byte) (pcm, error) {
	if len(b) < 12 || string(b[:4]) != "FORM" {
		return pcm{}, errAudio
	}
	aifc := string(b[8:12]) == "AIFC"
	if !aifc && string(b[8:12]) != "AIFF" {
		return pcm{}, errAudio
	}
	var channels, bits, frames int
	var rate float64
	comp := "NONE"
	var data []byte
	haveComm := false
	for off := 12; off+8 <= len(b); {
		id := string(b[off : off+4])
		size := int(binary.BigEndian.Uint32(b[off+4 : off+8]))
		body := b[off+8:]
		if size > len(body) {
			size = len(body)
		}
		body = body[:size]
		switch id {
		case "COMM":
			if size < 18 {
				return pcm{}, errAudio
			}
			channels = int(binary.BigEndian.Uint16(body[0:2]))
			frames = int(binary.BigEndian.Uint32(body[2:6]))
			bits = int(binary.BigEndian.Uint16(body[6:8]))
			rate = extended(body[8:18])
			if aifc && size >= 22 {
				comp = string(body[18:22])
			}
			haveComm = true
		case "SSND":
			if size < 8 {
				return pcm{}, errAudio
			}
			skip := int(binary.BigEndian.Uint32(body[0:4]))
			if 8+skip <= len(body) {
				data = body[8+skip:]
			}
		}
		off += 8 + size + size%2
	}
	if !haveComm || data == nil || channels < 1 || rate <= 0 {
		return pcm{}, errAudio
	}
	var p pcm
	var err error
	switch comp {
	case "NONE", "twos":
		p, err = framesOf(data, false, (bits+7)/8*8, channels, rate, binary.BigEndian)
	case "sowt":
		order := binary.ByteOrder(binary.LittleEndian)
		if bits <= 8 {
			order = binary.BigEndian // one byte has no order, and 8 bit AIFF is signed (framesOf reads LE 8 bit as WAV's unsigned)
		}
		p, err = framesOf(data, false, (bits+7)/8*8, channels, rate, order)
	case "fl32", "FL32":
		p, err = framesOf(data, true, 32, channels, rate, binary.BigEndian)
	case "fl64", "FL64":
		p, err = framesOf(data, true, 64, channels, rate, binary.BigEndian)
	default:
		return pcm{}, errAudio
	}
	if err != nil {
		return pcm{}, err
	}
	if frames > 0 && frames < p.frames {
		p.frames = frames
	}
	return p, nil
}

// extended decodes an 80-bit IEEE 754 extended float (AIFF's sample rate).
func extended(b []byte) float64 {
	exp := int(binary.BigEndian.Uint16(b[0:2]))
	sign := 1.0
	if exp&0x8000 != 0 {
		sign = -1
	}
	exp &= 0x7FFF
	mant := binary.BigEndian.Uint64(b[2:10])
	if exp == 0 && mant == 0 {
		return 0
	}
	return sign * float64(mant) * math.Pow(2, float64(exp-16383-63))
}
