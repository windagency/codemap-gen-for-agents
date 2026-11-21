package storage

type FileStore struct{}

func (FileStore) Save(data string) int {
	return len(data)
}

type MemoryStore struct{}

func (MemoryStore) Save(data string) int {
	return 0
}

func Load(path string) string {
	return path
}
