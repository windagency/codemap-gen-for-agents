use crate::storage::{self, FileStore, Store};
use crate::text::normalize;

pub fn run(store: &FileStore, path: &str) -> Vec<String> {
    store.save(&storage::load(&normalize(path)));
    let mut lines = Vec::new();
    lines.push(path.to_string());
    lines
}

pub fn flush(store: &dyn Store) {
    store.save("");
}
