use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn contribution_rate(total: u32, done: u32) -> f64 {
    if total == 0 {
        return 0.0;
    }

    let clamped_done = done.min(total);
    clamped_done as f64 / total as f64
}

#[wasm_bindgen]
pub fn contribution_level(total: u32, done: u32) -> u8 {
    if total == 0 {
        return 0;
    }

    let rate = contribution_rate(total, done);
    if (rate - 1.0).abs() < f64::EPSILON {
        return 3;
    }

    if rate < 0.5 {
        return 1;
    }

    2
}
