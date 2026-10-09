pub struct Encoder;

impl Encoder {
    pub fn push(&mut self, _line: String) {}
}

pub fn normalize(input: &str) -> String {
    input.to_lowercase()
}
