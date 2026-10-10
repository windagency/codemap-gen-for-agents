package legacy

type Encoder struct{}

func (Encoder) Encode(value any) error {
	return nil
}

func normalize(path string) string {
	return path
}
