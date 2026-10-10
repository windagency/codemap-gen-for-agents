package app

import "strings"

func normalize(path string) string {
	return strings.TrimSpace(path)
}
