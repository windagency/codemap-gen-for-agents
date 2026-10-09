package app

import (
	"encoding/json"
	"os"

	"example.com/goscip/storage"
)

func Run(path string) error {
	store := storage.FileStore{}
	store.Save(storage.Load(normalize(path)))
	return json.NewEncoder(os.Stdout).Encode(path)
}
