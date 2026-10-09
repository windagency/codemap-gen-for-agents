class FileStore:
    def save(self, data):
        return len(data)


class MemoryStore:
    def save(self, data):
        return data


def load(path):
    return path
