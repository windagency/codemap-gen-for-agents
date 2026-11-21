from app.storage import FileStore, load


def run(path: str):
    store = FileStore()
    store.save(load(path))
    return path.encode()
