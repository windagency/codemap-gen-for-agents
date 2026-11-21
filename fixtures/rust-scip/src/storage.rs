pub trait Store {
    fn save(&self, data: &str);
}

pub struct FileStore;

impl Store for FileStore {
    fn save(&self, _data: &str) {}
}

pub struct MemoryStore;

impl Store for MemoryStore {
    fn save(&self, _data: &str) {}
}

pub fn load(path: &str) -> String {
    path.to_string()
}
