package com.example.app;

import static com.example.text.Text.normalize;

import com.example.storage.FileStore;
import com.example.storage.Loader;
import com.example.storage.Store;
import java.util.ArrayList;
import java.util.List;

public class Service {
    public static List<String> run(FileStore store, String path) {
        store.save(Loader.load(normalize(path)));
        List<String> lines = new ArrayList<>();
        lines.add(path);
        return lines;
    }

    public static void flush(Store store) {
        store.save("");
    }
}
