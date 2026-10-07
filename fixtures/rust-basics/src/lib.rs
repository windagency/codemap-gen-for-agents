mod sub;

use crate::sub;
use serde::Serialize;

pub fn run() {
    sub::do_thing();
    helper();
}

fn helper() {}

#[cfg(test)]
mod tests {
    #[test]
    fn it_works() {}
}
